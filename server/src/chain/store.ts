import { AsyncLocalStorage } from 'node:async_hooks';

import type { Logger } from '@azerothjs/logger';
import { DataSource, MigrationExecutor, type EntityManager, type EntitySchema, type Logger as OrmLogger } from 'typeorm';

import type { AddressDirection, BlockFilter, TxStatusFilter } from '../schemas.ts';
import { dataSourceOptions, type Connection } from './data-source.ts';
import { Block, Token, Transaction, Transfer } from './entities.ts';
import {
    DAY_SECONDS,
    normalize,
    silentDay,
    ZERO_ADDRESS,
    type BlockEntry,
    type BlockRow,
    type DailyStats,
    type Flow,
    type IndexStats,
    type Page,
    type TokenRow,
    type TotalStats,
    type TransactionRow,
    type TransferRow,
    type WindowStats
} from './rows.ts';
import { tablesIn, type Tables } from './tables.ts';

export type {
    BlockEntry,
    BlockRow,
    DailyStats,
    Flow,
    IndexStats,
    Page,
    TokenRow,
    TotalStats,
    TransactionRow,
    TransferRow,
    WindowStats
} from './rows.ts';

// The index, in PostgreSQL through TypeORM. Everything here is DERIVED from the chain: a schema
// change is a migration (see ./migrations) that may simply truncate and replay from START_BLOCK.
//
// The whole point of this file is the pair of indexes on `transactions(from_addr)` and
// `transactions(to_addr)`. Ethereum JSON-RPC cannot answer "every transaction touching this
// address" - that is the question an explorer exists to answer, and it is answerable only
// because these rows were written down as the chain was read.
//
// TypeORM owns the pool, the transactions, the migrations and the bulk upserts; the reads are SQL
// written out by hand, because they are counts, unions and window aggregates whose exact shape is
// what keeps them on an index. Every result crosses into JS in the type `rows.ts` declares: int8
// counts as numbers (parseInt8), NUMERIC wei as decimal strings - never through a double.

/** Postgres binds at most 65,535 parameters to one statement; a bulk insert is cut to fit. */
const MAX_PARAMETERS = 65_535;

/** A statement slower than this is logged with its text, when the store was handed a log. */
const SLOW_QUERY_MS = 1_000;

export interface StoreOptions
{
    /** Where the index lives - see data-source.ts. */
    connection: Connection;

    /** Where migrations and slow statements are reported. Optional: a test runs quiet. */
    log?: Logger;

    /**
     * Refuse, rather than run, a query made outside the transaction this store has open.
     *
     * Test-only. While a transaction is open, a query that does not carry its frame either belongs
     * to a concurrent caller - which simply takes another pooled connection - or ESCAPED the
     * transaction it was written inside, and then commits on its own whatever the transaction
     * decides. A suite that never runs two callers at once can only see the second kind, and
     * failing it on the spot names the call.
     */
    strict?: boolean;
}

/** The marker a transaction leaves on every call made inside it. */
interface Frame
{
    /** The transaction's own connection; every call made under this frame goes through it. */
    manager: EntityManager;

    /** False from the moment the transaction's work settles; a later call made under it is a bug. */
    live: boolean;

    readOnly: boolean;
}

/** One result row, columns by name. */
type Row = Record<string, unknown>;

/**
 * A column of a result row, read by name.
 *
 * Postgres folds an unquoted alias to lower case - `AS headTime` comes back as `headtime` - so a
 * misspelt or folded name must throw here rather than read as undefined and turn into a zero.
 */
function field(row: Row | undefined, name: string): unknown
{
    if (row === undefined || !Object.hasOwn(row, name))
    {
        throw new Error(`index store: no column '${ name }' in a row of ${ row === undefined ? 'nothing' : Object.keys(row).join(', ') }`);
    }
    return row[name];
}

/** A count, a height or a timestamp - an int8, which crosses as a number. */
function integer(row: Row | undefined, name: string): number
{
    const value = field(row, name);
    if (typeof value !== 'number')
    {
        throw new Error(`index store: column '${ name }' is ${ typeof value }, not a number`);
    }
    return value;
}

/** An int8 that is absent over no rows - MIN or MAX of an empty window. */
function optionalInteger(row: Row | undefined, name: string): number | null
{
    return field(row, name) === null ? null : integer(row, name);
}

/** A TEXT column, or null. */
function text(row: Row | undefined, name: string): string | null
{
    const value = field(row, name);
    if (value !== null && typeof value !== 'string')
    {
        throw new Error(`index store: column '${ name }' is ${ typeof value }, not text`);
    }
    return value;
}

/** A NUMERIC that is an amount: pg hands it over as decimal text, and it stays text. Null over no rows. */
function decimal(row: Row | undefined, name: string): string | null
{
    return text(row, name);
}

/**
 * A NUMERIC that is a measurement rather than an amount - a count of gas units, a mean size - and
 * so fits a double; 0 over no rows. Gas for a whole day of a 30M-limit chain is about 4e12, three
 * orders of magnitude inside what a double holds exactly.
 */
function measure(row: Row | undefined, name: string): number
{
    const value = decimal(row, name);
    return value === null ? 0 : Number(value);
}

/** A height a caller handed in, or null when no row can carry it. */
function height(value: number): number | null
{
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

/**
 * Text a caller handed in, or null when no row can hold it.
 *
 * A NUL byte is the case: a path parameter decodes `%00` into one, no hash, address or name in the
 * index contains it, and Postgres refuses to bind it at all - so it is answered as the miss it is
 * rather than as a 500.
 */
function bindable(value: string): string | null
{
    return value.includes('\u0000') ? null : value;
}

/** Keeps one row per key - the LAST, which is what a row-at-a-time upsert would have left. */
function lastByKey<T>(rows: readonly T[], key: (row: T) => string | number): T[]
{
    return [...new Map(rows.map((row) => [key(row), row] as const)).values()];
}

/** Keeps one row per key - the FIRST, which is what a row-at-a-time `DO NOTHING` would have left. */
function firstByKey<T>(rows: readonly T[], key: (row: T) => string | number): T[]
{
    const seen = new Map<string | number, T>();
    for (const row of rows)
    {
        if (!seen.has(key(row)))
        {
            seen.set(key(row), row);
        }
    }
    return [...seen.values()];
}

/** `timestamp / 86400` - an integer division on BIGINT, so a day is a whole number. */
const DAY_BUCKET = `timestamp / ${ DAY_SECONDS }`;

/**
 * The daily block rollup the charts are drawn from: one row per day of the window.
 *
 * Exported so the query-plan spec explains the very statement the store runs. Every column it
 * reads is in `idx_blocks_daily`, which is what lets a thirty-day window never touch the table.
 */
export function dailyBlocksSql(t: Tables): string
{
    return `
        SELECT ${ DAY_BUCKET } AS day, COUNT(*) AS blocks, AVG(size) AS size,
               SUM(gas_used) AS gas_used, SUM(gas_limit) AS gas_limit,
               MIN(timestamp) AS first_ts, MAX(timestamp) AS last_ts
        FROM ${ t.blocks } WHERE timestamp >= $1 AND timestamp < $2
        GROUP BY day ORDER BY day ASC`;
}

/**
 * Every address the index has seen, once each, excluding $1 (the zero address) - the rich list's
 * candidates and the totals' address count, gathered the same way so the two always agree.
 *
 * Exported for the query-plan spec: every arm of the union reads an index, and a bare scan of any
 * of these tables is the regression it guards.
 */
export function addressesSql(t: Tables): string
{
    return `
        SELECT addr FROM (
            SELECT from_addr AS addr FROM ${ t.transactions }
            UNION ALL SELECT to_addr AS addr FROM ${ t.transactions }
            UNION ALL SELECT miner AS addr FROM ${ t.blocks }
            UNION ALL SELECT from_addr AS addr FROM ${ t.transfers }
            UNION ALL SELECT to_addr AS addr FROM ${ t.transfers }
            UNION ALL SELECT token AS addr FROM ${ t.transfers }
        ) AS seen WHERE addr IS NOT NULL AND addr <> $1 GROUP BY addr`;
}

/**
 * The first appearance of every address in all of history, as `first_ts`.
 *
 * Deliberately NOT filtered by a window: "first time" is a fact about all of history, and an
 * address that has been on this chain for a year would otherwise count as new the moment it
 * appeared inside a thirty-day slice.
 */
function firstSeenSql(t: Tables): string
{
    return `
        SELECT addr, MIN(ts) AS first_ts FROM (
            SELECT from_addr AS addr, timestamp AS ts FROM ${ t.transactions }
            UNION ALL
            SELECT to_addr AS addr, timestamp AS ts FROM ${ t.transactions } WHERE to_addr IS NOT NULL
        ) AS appearances GROUP BY addr`;
}

/** TypeORM's reports, into this server's log: a migration that failed, and statements that crawl. */
class IndexLog implements OrmLogger
{
    readonly #log: Logger;

    constructor(log: Logger)
    {
        this.#log = log;
    }

    public logQuery(): void
    {
        // Every statement would drown the log; the slow ones are what is worth reading.
    }

    public logQueryError(): void
    {
        // A failed statement rejects to its caller, which decides whether it is worth a line.
    }

    public logQuerySlow(time: number, query: string): void
    {
        this.#log.warn('slow index query', { ms: time, query: query.replace(/\s+/g, ' ').trim().slice(0, 500) });
    }

    public logSchemaBuild(): void
    {
        // The schema is the migration's to build; nothing is synchronized from the entities.
    }

    public logMigration(message: string): void
    {
        // TypeORM speaks here only when a migration FAILED; the store logs the ones that ran.
        this.#log.warn('index migration failed', { message });
    }

    public log(level: 'log' | 'info' | 'warn', message: unknown): void
    {
        if (level === 'warn')
        {
            this.#log.warn('typeorm', { message: String(message) });
        }
    }
}

/**
 * Refuses a database this index cannot be correct against, before a single row is written.
 *
 * An int8 that came back as text means something in this process turned pg's parseInt8 off - it is
 * one global switch - and every count would cross as a string the wire schemas reject. An encoding
 * other than UTF8 would turn the first token named outside it into a batch that never commits.
 */
async function verify(source: DataSource): Promise<void>
{
    const [row] = await source.query(`SELECT 1::int8 AS one, current_setting('server_encoding') AS encoding`) as Row[];
    if (typeof field(row, 'one') !== 'number')
    {
        throw new Error('index store: an int8 came back as text - pg\'s parseInt8 is off in this process');
    }
    const encoding = field(row, 'encoding');
    if (encoding !== 'UTF8')
    {
        throw new Error(`index store: the database encoding is ${ String(encoding) }; the index needs UTF8`);
    }
}

/**
 * Applies every pending migration, on ONE connection, inside ONE transaction.
 *
 * The advisory lock belongs to that transaction, so it can never be left behind on a pooled
 * connection: two processes booting at once - a rolling deploy - take turns rather than both
 * creating the same tables, and the second finds nothing pending. Answers with the names of the
 * migrations it applied, which on most boots is none.
 */
async function migrate(source: DataSource, schema: string): Promise<string[]>
{
    const runner = source.createQueryRunner();
    try
    {
        await runner.connect();
        await runner.startTransaction();
        await runner.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`nura-explorer:migrate:${ schema }`]);
        // A migration over a long chain may rewrite every row; the default statement cap is for requests.
        await runner.query('SET LOCAL statement_timeout = 0');
        const executor = new MigrationExecutor(source, runner);
        // Joins the transaction above rather than opening its own.
        executor.transaction = 'all';
        const applied = await executor.executePendingMigrations();
        await runner.commitTransaction();
        return applied.map((migration) => migration.name);
    }
    catch (error)
    {
        if (runner.isTransactionActive)
        {
            await runner.rollbackTransaction().catch(() => undefined);
        }
        throw error;
    }
    finally
    {
        await runner.release();
    }
}

const DEAD_FRAME = 'index store: a call outlived the transaction it was made in';
const ESCAPED = 'index store: a query ran outside the transaction this store has open';
const READ_ONLY = 'index store: a write inside a read-only snapshot';
const CLOSED = 'index store is closed';

export class IndexStore
{
    readonly #source: DataSource;
    readonly #t: Tables;

    /** Per store: a frame of one store says nothing about another. */
    readonly #frames = new AsyncLocalStorage<Frame>();

    readonly #strict: boolean;

    /** Transactions currently open on this store - what `strict` checks a frameless call against. */
    #open = 0;
    #closed = false;

    private constructor(source: DataSource, tables: Tables, strict: boolean)
    {
        this.#source = source;
        this.#t = tables;
        this.#strict = strict;
    }

    /** Connects, refuses a database the index cannot be correct against, and migrates it. */
    public static async open(options: StoreOptions): Promise<IndexStore>
    {
        const settings = dataSourceOptions(options.connection);
        const schema = settings.schema ?? 'public';
        const tables = tablesIn(schema);
        const source = new DataSource(options.log === undefined
            ? settings
            : { ...settings, logger: new IndexLog(options.log), maxQueryExecutionTime: SLOW_QUERY_MS });

        await source.initialize();
        try
        {
            await verify(source);
            const applied = await migrate(source, schema);
            if (applied.length > 0)
            {
                options.log?.info('index migrated', { schema, migrations: applied });
            }
            return new IndexStore(source, tables, options.strict ?? false);
        }
        catch (error)
        {
            await source.destroy().catch(() => undefined);
            throw error;
        }
    }

    /**
     * The connection a call runs on: its transaction's own, when it is made inside one of this
     * store's - otherwise the pool. Taken fresh for EVERY statement, never kept: a manager held
     * across an await would outlive the transaction it belonged to.
     */
    #manager(label: string, writes: boolean): EntityManager
    {
        if (this.#closed)
        {
            throw new Error(CLOSED);
        }
        const frame = this.#frames.getStore();
        if (frame !== undefined)
        {
            if (!frame.live)
            {
                throw new Error(DEAD_FRAME);
            }
            if (writes && frame.readOnly)
            {
                throw new Error(READ_ONLY);
            }
            return frame.manager;
        }
        if (this.#strict && this.#open > 0)
        {
            throw new Error(`${ ESCAPED } ('${ label }')`);
        }
        return this.#source.manager;
    }

    /** One statement's rows. */
    async #rows<T = Row>(label: string, sql: string, parameters: unknown[] = [], writes = false): Promise<T[]>
    {
        return await this.#manager(label, writes).query(sql, parameters) as T[];
    }

    /** One statement's first row, or undefined. */
    async #row<T = Row>(label: string, sql: string, parameters: unknown[] = []): Promise<T | undefined>
    {
        return (await this.#rows<T>(label, sql, parameters))[0];
    }

    /**
     * Runs `work` inside ONE transaction, on one connection. Without it every insert commits on
     * its own, so a batch of a thousand blocks pays a thousand commits - the difference between a
     * backfill that runs at the speed of the RPC and one that runs at the speed of the disk.
     *
     * A call made inside `work` - a nested `transaction()` included - JOINS this transaction: the
     * batch is meant to commit or vanish as one, and a nested BEGIN through the pool would open a
     * second, independent one that commits on its own. Nothing inside `work` may wait on the
     * network, run two store calls at once, or leave one running after it returns: the transaction
     * holds its connection and its row locks until it settles, and a call that outlives it is
     * refused rather than committed on its own.
     */
    public transaction<T>(work: () => Promise<T>): Promise<T>
    {
        return this.#atomically('transaction', false, work);
    }

    /**
     * Runs read-only `work` against ONE consistent state of the index, with no statement cap.
     *
     * For the reads that are several statements but one answer - the charts summary is about ten -
     * and must not straddle an ingest commit: a payload cached for minutes would otherwise serve
     * the half of a batch one statement saw and the other did not. Uncapped because those are the
     * reads that scan a window of the whole chain. A write inside it is refused.
     */
    public snapshot<T>(work: () => Promise<T>): Promise<T>
    {
        return this.#atomically('snapshot', true, work);
    }

    async #atomically<T>(label: string, readOnly: boolean, work: () => Promise<T>): Promise<T>
    {
        if (this.#closed)
        {
            throw new Error(CLOSED);
        }
        const outer = this.#frames.getStore();
        if (outer !== undefined)
        {
            if (!outer.live)
            {
                throw new Error(DEAD_FRAME);
            }
            if (!readOnly && outer.readOnly)
            {
                throw new Error(READ_ONLY);
            }
            return work();
        }
        if (this.#strict && this.#open > 0)
        {
            throw new Error(`${ ESCAPED } ('${ label }')`);
        }

        const runner = this.#source.createQueryRunner();
        this.#open += 1;
        try
        {
            await runner.connect();
            await runner.startTransaction(readOnly ? 'REPEATABLE READ' : undefined);
            if (readOnly)
            {
                await runner.query('SET TRANSACTION READ ONLY');
                await runner.query('SET LOCAL statement_timeout = 0');
            }
            const frame: Frame = { manager: runner.manager, live: true, readOnly };
            try
            {
                // Dead the moment `work` settles - before COMMIT, so nothing it left running can
                // slip a statement in after the outcome is decided.
                const result = await this.#frames.run(frame, () => work().finally(() =>
                {
                    frame.live = false;
                }));
                await runner.commitTransaction();
                return result;
            }
            catch (error)
            {
                frame.live = false;
                if (runner.isTransactionActive)
                {
                    await runner.rollbackTransaction().catch(() => undefined);
                }
                throw error;
            }
        }
        finally
        {
            this.#open -= 1;
            await runner.release();
        }
    }

    /** Closes the pool. A second close is a no-op; any call after the first is refused. */
    public async close(): Promise<void>
    {
        if (this.#closed)
        {
            return;
        }
        this.#closed = true;
        await this.#source.destroy();
    }

    public async getMeta(key: string): Promise<string | null>
    {
        const row = await this.#row('getMeta', `SELECT value FROM ${ this.#t.meta } WHERE key = $1`, [key]);
        return row === undefined ? null : text(row, 'value');
    }

    public async setMeta(key: string, value: string): Promise<void>
    {
        await this.#rows('setMeta',
            `INSERT INTO ${ this.#t.meta } (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
            [key, value], true);
    }

    /** The highest block indexed, or startBlock-1 when the index is empty. */
    public async cursor(fallback: number): Promise<number>
    {
        const value = await this.getMeta('cursor');
        return value === null ? fallback - 1 : Number(value);
    }

    public setCursor(block: number): Promise<void>
    {
        return this.setMeta('cursor', String(block));
    }

    /**
     * The stale-index guard: if the chain behind the RPC is not the one this index was built
     * from (a restarted local node), everything derived is wrong. Wipe and start over - in one
     * transaction, so the wipe and the new genesis land together or not at all.
     */
    public ensureChain(genesisHash: string): Promise<boolean>
    {
        return this.transaction(async () =>
        {
            const known = await this.getMeta('genesis');
            if (known === genesisHash)
            {
                return false;
            }
            if (known !== null)
            {
                const t = this.#t;
                await this.#rows('ensureChain', `TRUNCATE ${ t.blocks }, ${ t.transactions }, ${ t.transfers }, ${ t.tokens }`, [], true);
                await this.#rows('ensureChain', `DELETE FROM ${ t.meta } WHERE key = 'cursor'`, [], true);
            }
            await this.setMeta('genesis', genesisHash);
            return known !== null;
        });
    }

    // ----------------------------------------------------------------------------------
    // Ingest
    // ----------------------------------------------------------------------------------

    public async blockHash(number: number): Promise<string | null>
    {
        const at = height(number);
        if (at === null)
        {
            return null;
        }
        const row = await this.#row('blockHash', `SELECT hash FROM ${ this.#t.blocks } WHERE number = $1`, [at]);
        return row === undefined ? null : text(row, 'hash');
    }

    /** Drops everything at or above `number` - the rollback half of reorg handling. Atomic. */
    public rollbackFrom(number: number): Promise<void>
    {
        return this.transaction(async () =>
        {
            const t = this.#t;
            await this.#rows('rollbackFrom', `DELETE FROM ${ t.transfers } WHERE block_number >= $1`, [number], true);
            await this.#rows('rollbackFrom', `DELETE FROM ${ t.transactions } WHERE block_number >= $1`, [number], true);
            await this.#rows('rollbackFrom', `DELETE FROM ${ t.blocks } WHERE number >= $1`, [number], true);
        });
    }

    /**
     * Bulk-writes rows through TypeORM's insert builder, cut so no statement binds more parameters
     * than Postgres takes. Chunks run one after another: inside a transaction they share its one
     * connection, and two statements at once on a connection is not something pg allows.
     */
    async #insert<T extends object>(
        label: string,
        entity: EntitySchema<T>,
        rows: readonly T[],
        columns: number,
        conflict: { overwrite: string[]; target: string[] } | 'ignore'
    ): Promise<void>
    {
        const size = Math.floor(MAX_PARAMETERS / columns);
        for (let at = 0; at < rows.length; at += size)
        {
            const insert = this.#manager(label, true).createQueryBuilder()
                .insert()
                .into(entity)
                .values(rows.slice(at, at + size))
                .updateEntity(false)
                .callListeners(false);
            await (conflict === 'ignore' ? insert.orIgnore() : insert.orUpdate(conflict.overwrite, conflict.target)).execute();
        }
    }

    /**
     * Writes a batch of blocks with their transactions and transfers, atomically.
     *
     * Rows are de-duplicated before they are written - one row per key, as a row-at-a-time upsert
     * would have left them, and because one multi-row `DO UPDATE` may not touch a row twice - and
     * in key order, so two writers can never take row locks in opposite orders. A re-indexed height
     * refreshes only its hash and parent: the rest of a block is what the chain said, and the hash
     * is what a reorg changes.
     */
    public insertBlocks(entries: readonly BlockEntry[]): Promise<void>
    {
        const blocks = lastByKey(entries.map((entry) => entry.block), (row) => row.number)
            .sort((left, right) => left.number - right.number);
        const transactions = firstByKey(entries.flatMap((entry) => entry.transactions), (row) => row.hash)
            .sort((left, right) => left.block_number - right.block_number || left.tx_index - right.tx_index);
        const transfers = firstByKey(entries.flatMap((entry) => entry.transfers), (row) => `${ row.tx_hash }:${ row.log_index }`)
            .sort((left, right) => left.block_number - right.block_number || left.log_index - right.log_index);

        return this.transaction(async () =>
        {
            await this.#insert('insertBlocks', Block, blocks, 10, { overwrite: ['hash', 'parent_hash'], target: ['number'] });
            await this.#insert('insertBlocks', Transaction, transactions, 13, 'ignore');
            await this.#insert('insertBlocks', Transfer, transfers, 10, 'ignore');
        });
    }

    /** One block - see {@link insertBlocks}. */
    public insertBlock(row: BlockRow, transactions: TransactionRow[], transfers: TransferRow[]): Promise<void>
    {
        return this.insertBlocks([{ block: row, transactions, transfers }]);
    }

    /** Describes tokens, replacing any earlier description of the same address. */
    public async upsertTokens(rows: readonly TokenRow[]): Promise<void>
    {
        const unique = lastByKey(rows, (row) => row.address)
            .sort((left, right) => (left.address < right.address ? -1 : left.address > right.address ? 1 : 0));
        await this.#insert('upsertTokens', Token, unique, 5, { overwrite: ['name', 'symbol', 'decimals', 'kind'], target: ['address'] });
    }

    public upsertToken(row: TokenRow): Promise<void>
    {
        return this.upsertTokens([row]);
    }

    /** Whether this token has already been described. */
    public async knownToken(address: string): Promise<boolean>
    {
        const account = bindable(normalize(address));
        return account !== null
            && (await this.#row('knownToken', `SELECT 1 AS known FROM ${ this.#t.tokens } WHERE address = $1`, [account])) !== undefined;
    }

    /**
     * Which of these tokens have never been described - one lookup for a whole batch.
     *
     * Ingest asks this once per batch rather than once per transfer, so there is no in-memory
     * cache in front of it: on a busy token a cache saved thousands of identical queries, and a set
     * lookup saves the same thousands without a copy of the table that can disagree with it.
     */
    public async unknownTokens(addresses: Iterable<string>): Promise<Set<string>>
    {
        const wanted = [...new Set([...addresses].map(normalize))];
        const askable = wanted.filter((account) => bindable(account) !== null);
        const known = new Set(askable.length === 0
            ? []
            : (await this.#rows('unknownTokens', `SELECT address FROM ${ this.#t.tokens } WHERE address = ANY($1::text[])`, [askable]))
                .map((row) => String(field(row, 'address'))));
        return new Set(wanted.filter((account) => !known.has(account)));
    }

    // ----------------------------------------------------------------------------------
    // Reads
    // ----------------------------------------------------------------------------------

    /** The newest block's height, 0 for an empty index - one seek, where `stats()` counts tables. */
    public async head(): Promise<number>
    {
        return integer(await this.#row('head', `SELECT COALESCE(MAX(number), 0) AS head FROM ${ this.#t.blocks }`), 'head');
    }

    /**
     * What the index holds, counted, and how far it reaches: the height and instant of its newest
     * block and the instant of its oldest. The two instants bound what the index has SEEN - a day
     * between them with nothing in it is a day the chain was silent; a day outside them is one
     * the index never looked at. One statement, so the figures are of one state of the index.
     */
    public async stats(): Promise<IndexStats>
    {
        const t = this.#t;
        const row = await this.#row('stats', `
            SELECT (SELECT COUNT(*) FROM ${ t.blocks }) AS blocks,
                   (SELECT COUNT(*) FROM ${ t.transactions }) AS transactions,
                   (SELECT COUNT(*) FROM ${ t.transfers }) AS transfers,
                   (SELECT COALESCE(MAX(number), 0) FROM ${ t.blocks }) AS head,
                   (SELECT COALESCE(MAX(timestamp), 0) FROM ${ t.blocks }) AS head_time,
                   (SELECT COALESCE(MIN(timestamp), 0) FROM ${ t.blocks }) AS first_time`);
        return {
            blocks: integer(row, 'blocks'),
            transactions: integer(row, 'transactions'),
            transfers: integer(row, 'transfers'),
            head: integer(row, 'head'),
            headTime: integer(row, 'head_time'),
            firstTime: integer(row, 'first_time')
        };
    }

    /** Block times over the most recent window, for the average the summary reports. */
    public recentBlocks(limit: number): Promise<BlockRow[]>
    {
        return this.#rows<BlockRow>('recentBlocks', `SELECT * FROM ${ this.#t.blocks } ORDER BY number DESC LIMIT $1`, [limit]);
    }

    /**
     * One page of blocks, newest first, optionally only the ones that carried a transaction.
     *
     * `tx_count` is read off the row rather than counted through the transactions table: it was
     * written down as the block was indexed, so the narrowing costs a scan of one small column
     * instead of a join per row.
     */
    public async blocksPage(limit: number, offset: number, content: BlockFilter = 'all'): Promise<Page<BlockRow>>
    {
        const where = content === 'filled' ? 'WHERE tx_count > 0' : '';
        const total = integer(await this.#row('blocksPage', `SELECT COUNT(*) AS n FROM ${ this.#t.blocks } ${ where }`), 'n');
        const rows = await this.#rows<BlockRow>('blocksPage',
            `SELECT * FROM ${ this.#t.blocks } ${ where } ORDER BY number DESC LIMIT $1 OFFSET $2`, [limit, offset]);
        return { rows, total };
    }

    public async blockByNumber(number: number): Promise<BlockRow | null>
    {
        const at = height(number);
        return at === null
            ? null
            : (await this.#row<BlockRow>('blockByNumber', `SELECT * FROM ${ this.#t.blocks } WHERE number = $1`, [at])) ?? null;
    }

    public async blockByHash(hash: string): Promise<BlockRow | null>
    {
        const key = bindable(hash.toLowerCase());
        return key === null
            ? null
            : (await this.#row<BlockRow>('blockByHash', `SELECT * FROM ${ this.#t.blocks } WHERE hash = $1`, [key])) ?? null;
    }

    /** The hash of each of these heights the index holds - one lookup for a whole page of rows. */
    public async blockHashes(numbers: Iterable<number>): Promise<Map<number, string>>
    {
        const wanted = [...new Set(numbers)].filter((number) => height(number) !== null);
        if (wanted.length === 0)
        {
            return new Map();
        }
        const rows = await this.#rows('blockHashes',
            `SELECT number, hash FROM ${ this.#t.blocks } WHERE number = ANY($1::bigint[])`, [wanted]);
        return new Map(rows.map((row) => [integer(row, 'number'), String(field(row, 'hash'))]));
    }

    /**
     * One page of the whole chain's transactions, newest first, optionally narrowed to an outcome.
     *
     * `total` counts the NARROWED set rather than the table, because it is what the pager divides
     * into pages - a count of everything would draw pages that are empty the moment a filter is on.
     *
     * A status of `unknown` (-1, a receipt the node never returned) belongs to neither side: it is
     * reachable only with no filter, and a reader asking for reverted transactions must not be
     * handed the ones nobody can say anything about.
     *
     * The total and the rows are two statements; between them an ingest batch may commit, so a
     * count can be a block newer than its page. Harmless for an append-mostly index, and not worth
     * a transaction per request.
     */
    public async transactionsPage(limit: number, offset: number, status: TxStatusFilter = 'all'): Promise<Page<TransactionRow>>
    {
        // Bound rather than interpolated. `status` is already a closed union off a validated enum,
        // so nothing hostile can reach here - but a clause assembled by concatenation is the shape
        // that stops being safe the day somebody widens the type.
        const narrowed = status !== 'all';
        const where = narrowed ? 'WHERE status = $1' : '';
        const bound: unknown[] = narrowed ? [status === 'success' ? 1 : 0] : [];
        const total = integer(await this.#row('transactionsPage', `SELECT COUNT(*) AS n FROM ${ this.#t.transactions } ${ where }`, bound), 'n');
        const rows = await this.#rows<TransactionRow>('transactionsPage', `
            SELECT * FROM ${ this.#t.transactions } ${ where }
            ORDER BY block_number DESC, tx_index DESC LIMIT $${ bound.length + 1 } OFFSET $${ bound.length + 2 }`,
        [...bound, limit, offset]);
        return { rows, total };
    }

    /**
     * One page of a block's transactions, in the order the block executed them. A full block can
     * carry hundreds, and shipping all of them turns a detail page into a download.
     */
    public async transactionsOfBlock(number: number, limit: number, offset: number): Promise<Page<TransactionRow>>
    {
        const at = height(number);
        if (at === null)
        {
            return { rows: [], total: 0 };
        }
        const t = this.#t;
        const total = integer(await this.#row('transactionsOfBlock',
            `SELECT COUNT(*) AS n FROM ${ t.transactions } WHERE block_number = $1`, [at]), 'n');
        const rows = await this.#rows<TransactionRow>('transactionsOfBlock',
            `SELECT * FROM ${ t.transactions } WHERE block_number = $1 ORDER BY tx_index ASC LIMIT $2 OFFSET $3`, [at, limit, offset]);
        return { rows, total };
    }

    public async transactionByHash(hash: string): Promise<TransactionRow | null>
    {
        const key = bindable(hash.toLowerCase());
        return key === null
            ? null
            : (await this.#row<TransactionRow>('transactionByHash', `SELECT * FROM ${ this.#t.transactions } WHERE hash = $1`, [key])) ?? null;
    }

    /** Each of these transactions the index holds, keyed by lower-cased hash - one lookup per page. */
    public async transactionsByHash(hashes: Iterable<string>): Promise<Map<string, TransactionRow>>
    {
        const wanted = [...new Set([...hashes].map((hash) => hash.toLowerCase()))].filter((hash) => bindable(hash) !== null);
        if (wanted.length === 0)
        {
            return new Map();
        }
        const rows = await this.#rows<TransactionRow>('transactionsByHash',
            `SELECT * FROM ${ this.#t.transactions } WHERE hash = ANY($1::text[])`, [wanted]);
        return new Map(rows.map((row) => [row.hash, row]));
    }

    /**
     * Every transaction touching an address, newest first - the query this whole index exists
     * for. One statement over both directional indexes.
     *
     * `direction` picks ONE of those indexes instead of both: an address's inbound history is
     * `idx_tx_to` alone, so narrowing is a smaller seek than the unnarrowed query rather than a
     * filter applied after it.
     *
     * A transaction an address sent to ITSELF answers to both, and appears under either narrowing.
     * That is the honest reading: it really did send, and it really did receive.
     */
    public async transactionsOfAddress(
        address: string,
        limit: number,
        offset: number,
        direction: AddressDirection = 'all'
    ): Promise<Page<TransactionRow>>
    {
        const account = bindable(normalize(address));
        if (account === null)
        {
            return { rows: [], total: 0 };
        }
        const where = direction === 'in' ? 'to_addr = $1' : direction === 'out' ? 'from_addr = $1' : '(from_addr = $1 OR to_addr = $1)';
        const t = this.#t;
        const total = integer(await this.#row('transactionsOfAddress',
            `SELECT COUNT(*) AS n FROM ${ t.transactions } WHERE ${ where }`, [account]), 'n');
        const rows = await this.#rows<TransactionRow>('transactionsOfAddress', `
            SELECT * FROM ${ t.transactions } WHERE ${ where }
            ORDER BY block_number DESC, tx_index DESC LIMIT $2 OFFSET $3`, [account, limit, offset]);
        return { rows, total };
    }

    /**
     * Every token transfer this address took part in - as the sender, as the recipient, OR as the
     * token itself.
     *
     * That third case is the one a from/to pair cannot answer. A token contract is never a party
     * to its own transfers: they move between holders and name the contract only in `token`. So an
     * address page keyed on the counterparties alone showed a token's page an empty ledger while
     * the index held every transfer that token had ever emitted.
     *
     * The three columns are each indexed, so the OR is three seeks rather than a table scan.
     */
    public async transfersOfAddress(address: string, limit: number, offset: number): Promise<Page<TransferRow>>
    {
        const account = bindable(normalize(address));
        if (account === null)
        {
            return { rows: [], total: 0 };
        }
        const t = this.#t;
        const where = 'from_addr = $1 OR to_addr = $1 OR token = $1';
        const total = integer(await this.#row('transfersOfAddress',
            `SELECT COUNT(*) AS n FROM ${ t.transfers } WHERE ${ where }`, [account]), 'n');
        const rows = await this.#rows<TransferRow>('transfersOfAddress', `
            SELECT * FROM ${ t.transfers } WHERE ${ where }
            ORDER BY block_number DESC, log_index DESC LIMIT $2 OFFSET $3`, [account, limit, offset]);
        return { rows, total };
    }

    /**
     * The Etherscan-shaped address query: a block RANGE, a sort direction and offset paging.
     *
     * Separate from {@link transactionsOfAddress} because that one answers the UI's question -
     * newest first, fixed page size - and this one answers a wallet's: "everything this address
     * did between two heights, oldest first, so I can resume from where I stopped."
     */
    public async addressTransactionsInRange(
        address: string,
        fromBlock: number,
        toBlock: number,
        limit: number,
        offset: number,
        ascending: boolean
    ): Promise<TransactionRow[]>
    {
        const account = bindable(normalize(address));
        if (account === null)
        {
            return [];
        }
        // The direction is interpolated, not bound: SQL takes no parameter for a sort direction,
        // and the value is a boolean from the caller, never a string off the query string.
        const direction = ascending ? 'ASC' : 'DESC';
        return this.#rows<TransactionRow>('addressTransactionsInRange', `
            SELECT * FROM ${ this.#t.transactions }
            WHERE (from_addr = $1 OR to_addr = $1) AND block_number >= $2 AND block_number <= $3
            ORDER BY block_number ${ direction }, tx_index ${ direction } LIMIT $4 OFFSET $5`,
        [account, fromBlock, toBlock, limit, offset]);
    }

    /** The same range query over token transfers, optionally narrowed to one token contract. */
    public async addressTransfersInRange(
        address: string,
        fromBlock: number,
        toBlock: number,
        limit: number,
        offset: number,
        ascending: boolean,
        contract: string | null
    ): Promise<TransferRow[]>
    {
        const account = bindable(normalize(address));
        const token = contract === null ? null : bindable(normalize(contract));
        if (account === null || (contract !== null && token === null))
        {
            return [];
        }
        const direction = ascending ? 'ASC' : 'DESC';
        const bound: unknown[] = [account, fromBlock, toBlock];
        if (token !== null)
        {
            bound.push(token);
        }
        const narrowed = token === null ? '' : 'AND token = $4';
        return this.#rows<TransferRow>('addressTransfersInRange', `
            SELECT * FROM ${ this.#t.transfers }
            WHERE (from_addr = $1 OR to_addr = $1) AND block_number >= $2 AND block_number <= $3 ${ narrowed }
            ORDER BY block_number ${ direction }, log_index ${ direction } LIMIT $${ bound.length + 1 } OFFSET $${ bound.length + 2 }`,
        [...bound, limit, offset]);
    }

    /**
     * The transaction that DEPLOYED this contract - who put it there, and when.
     *
     * The chain does not answer this either: a receipt names the contract it created, but nothing
     * maps a contract back to its receipt. It is here for the same reason address history is -
     * the row was written down as the chain was read. The earliest, should an address ever have
     * been deployed to twice.
     */
    public async contractCreation(address: string): Promise<TransactionRow | null>
    {
        const account = bindable(normalize(address));
        return account === null
            ? null
            : (await this.#row<TransactionRow>('contractCreation', `
                SELECT * FROM ${ this.#t.transactions } WHERE contract_address = $1
                ORDER BY block_number ASC, tx_index ASC LIMIT 1`, [account])) ?? null;
    }

    /**
     * One page of the token transfers a transaction emitted, in LOG order.
     *
     * Ascending, unlike every other list here: within one transaction the log index is the order
     * the contract emitted them in, and a distributor's receipt read backwards is a different
     * story from the one that happened.
     */
    public async transfersOfTransaction(hash: string, limit: number, offset: number): Promise<Page<TransferRow>>
    {
        const key = bindable(hash.toLowerCase());
        if (key === null)
        {
            return { rows: [], total: 0 };
        }
        const t = this.#t;
        const total = integer(await this.#row('transfersOfTransaction',
            `SELECT COUNT(*) AS n FROM ${ t.transfers } WHERE tx_hash = $1`, [key]), 'n');
        const rows = await this.#rows<TransferRow>('transfersOfTransaction',
            `SELECT * FROM ${ t.transfers } WHERE tx_hash = $1 ORDER BY log_index ASC LIMIT $2 OFFSET $3`, [key, limit, offset]);
        return { rows, total };
    }

    /**
     * Native value in and out of an address, in wei - the flow ledger's totals.
     *
     * Summed in SQL, exactly: the columns are NUMERIC. A self-send matches both filters and counts
     * on both sides, because the address really did each; a reverted transaction moved nothing.
     */
    public async flowOfAddress(address: string): Promise<Flow>
    {
        const account = bindable(normalize(address));
        if (account === null)
        {
            return { in: '0', out: '0', fees: '0' };
        }
        const row = await this.#row('flowOfAddress', `
            SELECT COALESCE(SUM(value) FILTER (WHERE to_addr = $1), 0) AS inbound,
                   COALESCE(SUM(value) FILTER (WHERE from_addr = $1), 0) AS outbound,
                   COALESCE(SUM(gas_used * effective_gas_price) FILTER (WHERE from_addr = $1), 0) AS fees
            FROM ${ this.#t.transactions } WHERE (from_addr = $1 OR to_addr = $1) AND status = 1`, [account]);
        return { in: decimal(row, 'inbound') ?? '0', out: decimal(row, 'outbound') ?? '0', fees: decimal(row, 'fees') ?? '0' };
    }

    /**
     * Every address the index has seen, deduplicated - the candidate set for the rich list.
     *
     * JSON-RPC has no "who holds the most" call, so a top-accounts list ranks the addresses that
     * have appeared on-chain and reads each balance live against the node. In byte order, so two
     * accounts holding the same balance keep the same places between one ranking and the next.
     * Read as a snapshot because it is a scan of every address column the index has.
     */
    public distinctAddresses(): Promise<string[]>
    {
        return this.snapshot(async () =>
        {
            const rows = await this.#rows('distinctAddresses', `${ addressesSql(this.#t) } ORDER BY addr COLLATE "C"`, [ZERO_ADDRESS]);
            return rows.map((row) => String(field(row, 'addr')));
        });
    }

    // ----------------------------------------------------------------------------------
    // Aggregates - what the charts are drawn from
    // ----------------------------------------------------------------------------------

    /**
     * Every day between `from` and `to` that the index has something for, with the figures the
     * charts draw.
     *
     * A day the chain was silent gets NO row. Filling it with zeros here would make a day the
     * indexer has not reached indistinguishable from a day nothing happened, and only the caller
     * knows which of those it is looking at.
     *
     * Fees are summed in SQL, exactly - the columns are NUMERIC, and a day of products of gas and
     * price is far past what a double holds. The mean interval and the mean size are statistics,
     * computed once here; the mean gas price is truncated to the wei.
     */
    public statsDaily(from: number, to: number): Promise<DailyStats[]>
    {
        return this.snapshot(async () =>
        {
            const t = this.#t;
            const days = new Map<number, DailyStats>();
            const at = (day: number): DailyStats =>
            {
                let row = days.get(day);
                if (row === undefined)
                {
                    row = silentDay(day);
                    days.set(day, row);
                }
                return row;
            };

            // The mean interval is (last - first) / (blocks - 1) rather than an average of
            // per-block differences: inside one day those differences telescope, so this is the
            // same number without a window function or a second pass. In JS, because in SQL it
            // would be an integer division - 2.98 seconds would read as 2.
            for (const row of await this.#rows('statsDaily', dailyBlocksSql(t), [from, to]))
            {
                const entry = at(integer(row, 'day'));
                const blocks = integer(row, 'blocks');
                entry.blocks = blocks;
                entry.blockSize = measure(row, 'size');
                entry.gasUsed = measure(row, 'gas_used');
                entry.gasLimit = measure(row, 'gas_limit');
                entry.blockTime = blocks > 1 ? (integer(row, 'last_ts') - integer(row, 'first_ts')) / (blocks - 1) : 0;
            }

            for (const row of await this.#rows('statsDaily', `
                SELECT ${ DAY_BUCKET } AS day, COUNT(*) AS transactions, COUNT(contract_address) AS contracts,
                       div(SUM(effective_gas_price), COUNT(*)) AS gas_price,
                       SUM(gas_used * effective_gas_price) AS fees
                FROM ${ t.transactions } WHERE timestamp >= $1 AND timestamp < $2
                GROUP BY day ORDER BY day ASC`, [from, to]))
            {
                const entry = at(integer(row, 'day'));
                entry.transactions = integer(row, 'transactions');
                entry.contracts = integer(row, 'contracts');
                entry.gasPrice = decimal(row, 'gas_price') ?? '0';
                entry.fees = decimal(row, 'fees') ?? '0';
            }

            for (const row of await this.#rows('statsDaily', `
                SELECT ${ DAY_BUCKET } AS day, COUNT(*) AS transfers
                FROM ${ t.transfers } WHERE timestamp >= $1 AND timestamp < $2
                GROUP BY day ORDER BY day ASC`, [from, to]))
            {
                at(integer(row, 'day')).transfers = integer(row, 'transfers');
            }

            // UNION and not UNION ALL: an address that both sent and received on the same day was
            // active once, and one that sent to itself was active once too.
            for (const row of await this.#rows('statsDaily', `
                SELECT day, COUNT(*) AS active FROM (
                    SELECT DISTINCT ${ DAY_BUCKET } AS day, from_addr AS addr FROM ${ t.transactions }
                        WHERE timestamp >= $1 AND timestamp < $2
                    UNION
                    SELECT DISTINCT ${ DAY_BUCKET } AS day, to_addr AS addr FROM ${ t.transactions }
                        WHERE timestamp >= $1 AND timestamp < $2 AND to_addr IS NOT NULL
                ) AS active GROUP BY day ORDER BY day ASC`, [from, to]))
            {
                at(integer(row, 'day')).activeAddresses = integer(row, 'active');
            }

            for (const row of await this.#rows('statsDaily', `
                SELECT first_ts / ${ DAY_SECONDS } AS day, COUNT(*) AS fresh FROM (${ firstSeenSql(t) }) AS seen
                WHERE first_ts >= $1 AND first_ts < $2 GROUP BY day`, [from, to]))
            {
                at(integer(row, 'day')).newAddresses = integer(row, 'fresh');
            }

            return [...days.values()].sort((left, right) => left.day - right.day);
        });
    }

    /** The same figures over one arbitrary window - what a headline tile compares against. */
    public statsWindow(from: number, to: number): Promise<WindowStats>
    {
        return this.snapshot(async () =>
        {
            const t = this.#t;
            const blocks = await this.#row('statsWindow', `
                SELECT COUNT(*) AS blocks, SUM(gas_used) AS gas_used, SUM(gas_limit) AS gas_limit,
                       MIN(timestamp) AS first_ts, MAX(timestamp) AS last_ts
                FROM ${ t.blocks } WHERE timestamp >= $1 AND timestamp < $2`, [from, to]);

            const transactions = await this.#row('statsWindow', `
                SELECT COUNT(*) AS transactions, COUNT(contract_address) AS contracts,
                       COALESCE(SUM(gas_used * effective_gas_price), 0) AS fees
                FROM ${ t.transactions } WHERE timestamp >= $1 AND timestamp < $2`, [from, to]);

            const transfers = await this.#row('statsWindow',
                `SELECT COUNT(*) AS n FROM ${ t.transfers } WHERE timestamp >= $1 AND timestamp < $2`, [from, to]);

            const active = await this.#row('statsWindow', `
                SELECT COUNT(*) AS n FROM (
                    SELECT DISTINCT from_addr AS addr FROM ${ t.transactions } WHERE timestamp >= $1 AND timestamp < $2
                    UNION
                    SELECT DISTINCT to_addr AS addr FROM ${ t.transactions } WHERE timestamp >= $1 AND timestamp < $2 AND to_addr IS NOT NULL
                ) AS active`, [from, to]);

            const fresh = await this.#row('statsWindow',
                `SELECT COUNT(*) AS n FROM (${ firstSeenSql(t) }) AS seen WHERE first_ts >= $1 AND first_ts < $2`, [from, to]);

            const count = integer(blocks, 'blocks');
            const first = optionalInteger(blocks, 'first_ts') ?? 0;
            const last = optionalInteger(blocks, 'last_ts') ?? 0;
            const sent = integer(transactions, 'transactions');
            const fees = decimal(transactions, 'fees') ?? '0';
            return {
                blocks: count,
                transactions: sent,
                transfers: integer(transfers, 'n'),
                contracts: integer(transactions, 'contracts'),
                activeAddresses: integer(active, 'n'),
                newAddresses: integer(fresh, 'n'),
                gasUsed: measure(blocks, 'gas_used'),
                gasLimit: measure(blocks, 'gas_limit'),
                blockTime: count > 1 ? (last - first) / (count - 1) : 0,
                fees,
                // Integer division in BigInt: a mean fee is still wei, and a wei that came back
                // through a double is the thing this whole file is written to avoid.
                averageFee: sent === 0 ? '0' : (BigInt(fees) / BigInt(sent)).toString()
            };
        });
    }

    /** Everything the index holds, counted - the cumulative half of the overview. */
    public totals(): Promise<TotalStats>
    {
        return this.snapshot(async () =>
        {
            const t = this.#t;
            const row = await this.#row('totals', `
                SELECT (SELECT COUNT(*) FROM ${ t.blocks }) AS blocks,
                       (SELECT COUNT(*) FROM ${ t.transactions }) AS transactions,
                       (SELECT COUNT(*) FROM ${ t.transfers }) AS transfers,
                       (SELECT COUNT(*) FROM ${ t.tokens }) AS tokens,
                       (SELECT COUNT(*) FROM ${ t.transactions } WHERE contract_address IS NOT NULL) AS contracts`);

            // Counted the same way the rich list gathers its candidates, so the two agree.
            const addresses = await this.#row('totals', `SELECT COUNT(*) AS n FROM (${ addressesSql(t) }) AS addresses`, [ZERO_ADDRESS]);

            return {
                blocks: integer(row, 'blocks'),
                transactions: integer(row, 'transactions'),
                transfers: integer(row, 'transfers'),
                addresses: integer(addresses, 'n'),
                tokens: integer(row, 'tokens'),
                contracts: integer(row, 'contracts')
            };
        });
    }

    public async token(address: string): Promise<TokenRow | null>
    {
        const account = bindable(normalize(address));
        return account === null
            ? null
            : (await this.#row<TokenRow>('token', `SELECT * FROM ${ this.#t.tokens } WHERE address = $1`, [account])) ?? null;
    }

    /** Each of these tokens the index has described, keyed by lower-cased address - one lookup per page. */
    public async tokensOf(addresses: Iterable<string>): Promise<Map<string, TokenRow>>
    {
        const wanted = [...new Set([...addresses].map(normalize))].filter((account) => bindable(account) !== null);
        if (wanted.length === 0)
        {
            return new Map();
        }
        const rows = await this.#rows<TokenRow>('tokensOf', `SELECT * FROM ${ this.#t.tokens } WHERE address = ANY($1::text[])`, [wanted]);
        return new Map(rows.map((row) => [row.address, row]));
    }

    /** Every token, by symbol in byte order - the order a list sorted by eye expects, on any database locale. */
    public tokens(): Promise<TokenRow[]>
    {
        return this.#rows<TokenRow>('tokens', `SELECT * FROM ${ this.#t.tokens } ORDER BY symbol COLLATE "C" ASC, address ASC`);
    }
}
