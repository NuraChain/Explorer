import { AsyncLocalStorage } from 'node:async_hooks';
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import type { AddressDirection, BlockFilter, TxStatusFilter } from '../schemas.ts';
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

// The index. Everything here is DERIVED from the chain, so a schema change is a rebuild, not a
// migration: bump SCHEMA_VERSION and the tables drop and replay from START_BLOCK.
//
// The whole point of this file is the pair of indexes on `transactions(from_addr)` and
// `transactions(to_addr)`. Ethereum JSON-RPC cannot answer "every transaction touching this
// address" - that is the question an explorer exists to answer, and it is answerable only
// because these rows were written down as the chain was read.
//
// Every method is asynchronous, though `node:sqlite` is not: the store's callers interleave, and
// the contract they rely on - a transaction is one unit, a read never lands inside somebody else's
// - has to hold for a database that is a pool of connections as much as for this single handle.

/**
 * Bumped whenever a column changes; the index rebuilds itself from the chain.
 *
 * It reads 2 for a shape that is the same as 1. Version 2 also held three governance tables, and
 * they went again when governance turned out to live in the chain's own `x/gov` module rather
 * than in a contract (see chain/gov.ts) - nothing here indexes it. The number stays where it is
 * so that an index built under 2 is not dropped and replayed for a change that removed tables it
 * can simply stop reading.
 */
const SCHEMA_VERSION = '2';

const DDL = `
CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS blocks (
    number INTEGER PRIMARY KEY,
    hash TEXT NOT NULL,
    parent_hash TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    miner TEXT NOT NULL,
    gas_used TEXT NOT NULL,
    gas_limit TEXT NOT NULL,
    base_fee TEXT,
    size INTEGER NOT NULL,
    tx_count INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_blocks_ts ON blocks (timestamp DESC);
-- The charts aggregation, which is the only query here whose cost grows with the whole chain.
--
-- COVERING, and that is the entire point: idx_blocks_ts already finds the right rows for a
-- windowed rollup, and then the query fetches size, gas_used and gas_limit out of each one. At
-- three-second blocks a thirty-day window is ~864,000 of those fetches - most of the table, a
-- page at a time - and node:sqlite is SYNCHRONOUS, so the whole event loop waits for it. On a
-- million-block chain that was seven to ten seconds during which the server answered nothing at
-- all: a request for /api/healthz issued in the middle of one took 7.3 seconds. With the four
-- columns in the index the rollup never reads the table.
CREATE INDEX IF NOT EXISTS idx_blocks_daily ON blocks (timestamp, size, gas_used, gas_limit);
-- The other half of the same stall. totals() counts distinct addresses by unioning every address
-- column in the database, and miner is one per block - so it read a million rows to learn that
-- this chain has two validators. Every other arm of that union was already covered.
CREATE INDEX IF NOT EXISTS idx_blocks_miner ON blocks (miner);
CREATE TABLE IF NOT EXISTS transactions (
    hash TEXT PRIMARY KEY,
    block_number INTEGER NOT NULL,
    tx_index INTEGER NOT NULL,
    from_addr TEXT NOT NULL,
    to_addr TEXT,
    value TEXT NOT NULL,
    nonce INTEGER NOT NULL,
    input_size INTEGER NOT NULL,
    gas_used TEXT NOT NULL,
    effective_gas_price TEXT NOT NULL,
    status INTEGER NOT NULL,
    contract_address TEXT,
    timestamp INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tx_block ON transactions (block_number DESC, tx_index ASC);
CREATE INDEX IF NOT EXISTS idx_tx_from ON transactions (from_addr, block_number DESC);
CREATE INDEX IF NOT EXISTS idx_tx_to ON transactions (to_addr, block_number DESC);
-- Partial: only a deployment fills contract_address, so the index carries one row per contract
-- on the chain rather than one per transaction, and "who deployed this" stays a single seek.
CREATE INDEX IF NOT EXISTS idx_tx_contract ON transactions (contract_address) WHERE contract_address IS NOT NULL;
CREATE TABLE IF NOT EXISTS token_transfers (
    tx_hash TEXT NOT NULL,
    log_index INTEGER NOT NULL,
    block_number INTEGER NOT NULL,
    token TEXT NOT NULL,
    from_addr TEXT NOT NULL,
    to_addr TEXT NOT NULL,
    value TEXT NOT NULL,
    token_id TEXT,
    kind TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    PRIMARY KEY (tx_hash, log_index)
);
CREATE INDEX IF NOT EXISTS idx_transfer_from ON token_transfers (from_addr, block_number DESC);
CREATE INDEX IF NOT EXISTS idx_transfer_to ON token_transfers (to_addr, block_number DESC);
CREATE INDEX IF NOT EXISTS idx_transfer_token ON token_transfers (token, block_number DESC);
CREATE TABLE IF NOT EXISTS tokens (
    address TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    symbol TEXT NOT NULL,
    decimals INTEGER NOT NULL,
    kind TEXT NOT NULL
);
`;

/**
 * `timestamp / 86400` as sqlite must see it, INTERPOLATED and never bound.
 *
 * A bound JS number arrives as a REAL, and integer / REAL is real division - so every row landed
 * in a bucket of its own and a day of chain came back as three hundred fractional "days". The
 * constant is this file's own, so interpolating it is safe in the way a query string never is.
 */
const DAY_BUCKET = `timestamp / ${ DAY_SECONDS }`;

export interface StoreOptions
{
    /** The sqlite file; ':memory:' for a throwaway index. */
    path: string;

    /**
     * Refuse, rather than queue, a query made outside the transaction this store has open.
     *
     * Test-only. While a transaction is open, a query that does not carry its frame either belongs
     * to a concurrent caller - which waits its turn - or ESCAPED the transaction it was written
     * inside, which on a single connection is a deadlock and on a pool a write that commits on
     * its own. A suite that never runs two callers at once can only see the second kind, and
     * failing it on the spot names the call instead of timing out.
     */
    strict?: boolean;

    /** Fail a call that has waited this long for its turn, naming who held it. Test-only. */
    lockTimeoutMs?: number;
}

/** The marker a transaction leaves on every call made inside it. */
interface Frame
{
    /** False from the moment the transaction's work settles; a later call made under it is a bug. */
    live: boolean;
    readOnly: boolean;
}

/**
 * One caller at a time, in arrival order - the single connection `node:sqlite` is, made explicit
 * now that the callers interleave.
 *
 * A transaction holds its turn across every await inside it, so a read issued meanwhile waits for
 * the commit instead of reading half a batch - the guarantee WAL gave synchronous code for free.
 */
class Turns
{
    #tail: Promise<unknown> = Promise.resolve();
    #holder = '';
    readonly #timeoutMs: number | undefined;

    constructor(timeoutMs: number | undefined)
    {
        this.#timeoutMs = timeoutMs;
    }

    public run<T>(label: string, work: () => Promise<T>): Promise<T>
    {
        const previous = this.#tail;
        const ready = this.#timeoutMs === undefined ? previous : this.#bounded(previous, label);
        const result = ready.then(() =>
        {
            this.#holder = label;
            return work();
        });
        // The next caller waits for the previous holder AND for this one, whether this one ran or
        // gave up waiting - a timed-out waiter must not let the queue skip a holder still running.
        this.#tail = Promise.allSettled([previous, result]);
        return result;
    }

    #bounded(previous: Promise<unknown>, label: string): Promise<unknown>
    {
        const limit = this.#timeoutMs ?? 0;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const expired = new Promise<never>((_resolve, reject) =>
        {
            timer = setTimeout(() => reject(new Error(
                `index store: '${ label }' waited ${ limit } ms for its turn behind '${ this.#holder }'`)), limit);
        });
        return Promise.race([previous, expired]).finally(() => clearTimeout(timer));
    }
}

/** A height a caller handed in, or null when no row can carry it. */
function height(value: number): number | null
{
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

/**
 * Text a caller handed in, or null when no row can hold it.
 *
 * A NUL byte is the case: a path parameter decodes `%00` into one, no hash, address or name in this
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

const DEAD_FRAME = 'index store: a call outlived the transaction it was made in';
const ESCAPED = 'index store: a query ran outside the transaction this store has open';
const READ_ONLY = 'index store: a write inside a read-only snapshot';
const CLOSED = 'index store is closed';

export class IndexStore
{
    readonly #db: DatabaseSync;

    /**
     * Prepared statements, keyed by their SQL. Ingest runs the same handful of INSERTs once per
     * block; re-preparing them each time re-parses and re-plans the statement, which during a
     * backfill costs more than the writes themselves.
     */
    readonly #statements = new Map<string, StatementSync>();

    /** Per store: a frame of one store says nothing about another. */
    readonly #frames = new AsyncLocalStorage<Frame>();

    readonly #turns: Turns;
    readonly #strict: boolean;

    /** Transactions currently open on this store - what `strict` checks a frameless call against. */
    #open = 0;
    #closed = false;

    private constructor(db: DatabaseSync, options: StoreOptions)
    {
        this.#db = db;
        this.#strict = options.strict ?? false;
        this.#turns = new Turns(options.lockTimeoutMs);
    }

    /** Opens (creating if need be) the index at `options.path`, schema included. */
    public static async open(options: StoreOptions): Promise<IndexStore>
    {
        // sqlite creates the FILE but not the directory holding it, so a configured
        // `.data/index.db` fails to open on a fresh clone until someone makes the folder.
        // ':memory:' has no directory at all.
        if (options.path !== ':memory:')
        {
            const parent = dirname(resolve(options.path));
            if (!existsSync(parent))
            {
                mkdirSync(parent, { recursive: true });
            }
        }
        const db = new DatabaseSync(options.path);
        try
        {
            // Every row here is derived from the chain, so durability of the LAST few commits buys
            // nothing: a power cut costs a few blocks that the indexer re-reads from its cursor on
            // the next boot. `synchronous = NORMAL` under WAL drops the fsync per commit, which is
            // the single largest cost of a backfill; the rest give the page cache room to work.
            db.exec(`
                PRAGMA journal_mode = WAL;
                PRAGMA synchronous = NORMAL;
                PRAGMA temp_store = MEMORY;
                PRAGMA cache_size = -65536;
                PRAGMA busy_timeout = 5000;`);
            db.exec(DDL);
            const store = new IndexStore(db, options);
            store.#migrate();
            return store;
        }
        catch (error)
        {
            db.close();
            throw error;
        }
    }

    /** A prepared statement, prepared once per distinct SQL string and reused thereafter. */
    #stmt(sql: string): StatementSync
    {
        let statement = this.#statements.get(sql);
        if (statement === undefined)
        {
            statement = this.#db.prepare(sql);
            this.#statements.set(sql, statement);
        }
        return statement;
    }

    /**
     * Runs one unit of database work in its turn - or straight away when it is made inside a
     * transaction of this store, which already holds the turn.
     */
    async #run<T>(label: string, work: () => T, writes = false): Promise<T>
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
            return work();
        }
        if (this.#strict && this.#open > 0)
        {
            throw new Error(`${ ESCAPED } ('${ label }')`);
        }
        return this.#turns.run(label, async () => work());
    }

    /**
     * Runs `work` inside ONE transaction. Without this every insert commits on its own, so a
     * batch of a thousand blocks pays a thousand commits - the difference between a backfill that
     * runs at the speed of the RPC and one that runs at the speed of the disk.
     *
     * A call made inside `work` - a nested `transaction()` included - JOINS this transaction:
     * sqlite does not nest, and the batch is meant to commit or vanish as one. Nothing inside
     * `work` may wait on the network, run two store calls at once, or leave one running after it
     * returns: the transaction holds the store's only turn until it settles, and a call that
     * outlives it is refused rather than committed on its own.
     */
    public transaction<T>(work: () => Promise<T>): Promise<T>
    {
        return this.#atomically('transaction', 'BEGIN IMMEDIATE', false, work);
    }

    /**
     * Runs read-only `work` against ONE consistent state of the index.
     *
     * For the reads that are several statements but one answer - the charts summary is about ten -
     * and must not straddle an ingest commit: a payload cached for minutes would otherwise serve
     * the half of a batch one statement saw and the other did not. A write inside it is refused.
     */
    public snapshot<T>(work: () => Promise<T>): Promise<T>
    {
        return this.#atomically('snapshot', 'BEGIN', true, work);
    }

    async #atomically<T>(label: string, begin: string, readOnly: boolean, work: () => Promise<T>): Promise<T>
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
        return this.#turns.run(label, async () =>
        {
            this.#db.exec(begin);
            const frame: Frame = { live: true, readOnly };
            this.#open += 1;
            try
            {
                // Dead the moment `work` settles - before COMMIT, so nothing it left running can
                // slip a statement in after the outcome is decided.
                const result = await this.#frames.run(frame, () => work().finally(() =>
                {
                    frame.live = false;
                }));
                this.#db.exec('COMMIT');
                return result;
            }
            catch (error)
            {
                frame.live = false;
                this.#db.exec('ROLLBACK');
                throw error;
            }
            finally
            {
                this.#open -= 1;
            }
        });
    }

    /**
     * Every table here is derived from the chain, so a schema change drops and replays rather
     * than migrating. `CREATE TABLE IF NOT EXISTS` will not add a column to an existing file,
     * which is exactly how a stale index starts serving rows that are missing one.
     */
    #migrate(): void
    {
        if (this.#getMeta('schema') === SCHEMA_VERSION)
        {
            return;
        }
        this.#db.exec(
            'DROP TABLE IF EXISTS blocks;'
            + 'DROP TABLE IF EXISTS transactions;'
            + 'DROP TABLE IF EXISTS token_transfers;'
            + 'DROP TABLE IF EXISTS tokens;'
            + 'DROP TABLE IF EXISTS meta;');
        this.#db.exec(DDL);
        this.#setMeta('schema', SCHEMA_VERSION);
    }

    /** Closes the index. A second close is a no-op; any call after the first is refused. */
    public async close(): Promise<void>
    {
        if (this.#closed)
        {
            return;
        }
        this.#closed = true;
        // In its turn, so a transaction still committing finishes before the handle goes.
        await this.#turns.run('close', async () =>
        {
            this.#db.close();
        });
    }

    #getMeta(key: string): string | null
    {
        const row = this.#stmt('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined;
        return row?.value ?? null;
    }

    #setMeta(key: string, value: string): void
    {
        this.#stmt('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value')
            .run(key, value);
    }

    public getMeta(key: string): Promise<string | null>
    {
        return this.#run('getMeta', () => this.#getMeta(key));
    }

    public setMeta(key: string, value: string): Promise<void>
    {
        return this.#run('setMeta', () => this.#setMeta(key, value), true);
    }

    /** The highest block indexed, or startBlock-1 when the index is empty. */
    public cursor(fallback: number): Promise<number>
    {
        return this.#run('cursor', () =>
        {
            const value = this.#getMeta('cursor');
            return value === null ? fallback - 1 : Number(value);
        });
    }

    public setCursor(block: number): Promise<void>
    {
        return this.#run('setCursor', () => this.#setMeta('cursor', String(block)), true);
    }

    /**
     * The stale-index guard: if the chain behind the RPC is not the one this index was built
     * from (a restarted local node), everything derived is wrong. Wipe and start over - in one
     * transaction, so the wipe and the new genesis land together or not at all.
     */
    public ensureChain(genesisHash: string): Promise<boolean>
    {
        return this.transaction(async () => this.#run('ensureChain', () =>
        {
            const known = this.#getMeta('genesis');
            if (known === genesisHash)
            {
                return false;
            }
            if (known !== null)
            {
                this.#db.exec('DELETE FROM blocks; DELETE FROM transactions; DELETE FROM token_transfers; DELETE FROM tokens;');
                this.#stmt('DELETE FROM meta WHERE key = ?').run('cursor');
            }
            this.#setMeta('genesis', genesisHash);
            return known !== null;
        }, true));
    }

    // ----------------------------------------------------------------------------------
    // Ingest
    // ----------------------------------------------------------------------------------

    public blockHash(number: number): Promise<string | null>
    {
        return this.#run('blockHash', () =>
        {
            const at = height(number);
            if (at === null)
            {
                return null;
            }
            const row = this.#stmt('SELECT hash FROM blocks WHERE number = ?').get(at) as { hash: string } | undefined;
            return row?.hash ?? null;
        });
    }

    /** Drops everything at or above `number` - the rollback half of reorg handling. Atomic. */
    public rollbackFrom(number: number): Promise<void>
    {
        return this.transaction(async () => this.#run('rollbackFrom', () =>
        {
            this.#stmt('DELETE FROM token_transfers WHERE block_number >= ?').run(number);
            this.#stmt('DELETE FROM transactions WHERE block_number >= ?').run(number);
            this.#stmt('DELETE FROM blocks WHERE number >= ?').run(number);
        }, true));
    }

    /**
     * Writes a batch of blocks with their transactions and transfers, atomically.
     *
     * Rows are de-duplicated before they are written - one row per key, as a row-at-a-time upsert
     * would have left them - and in key order, so two writers can never take row locks in
     * opposite orders.
     */
    public insertBlocks(entries: readonly BlockEntry[]): Promise<void>
    {
        const blocks = lastByKey(entries.map((entry) => entry.block), (row) => row.number)
            .sort((left, right) => left.number - right.number);
        const transactions = firstByKey(entries.flatMap((entry) => entry.transactions), (row) => row.hash)
            .sort((left, right) => left.block_number - right.block_number || left.tx_index - right.tx_index);
        const transfers = firstByKey(entries.flatMap((entry) => entry.transfers), (row) => `${ row.tx_hash }:${ row.log_index }`)
            .sort((left, right) => left.block_number - right.block_number || left.log_index - right.log_index);

        return this.transaction(async () => this.#run('insertBlocks', () =>
        {
            const block = this.#stmt(`
                INSERT INTO blocks (number, hash, parent_hash, timestamp, miner, gas_used, gas_limit, base_fee, size, tx_count)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT (number) DO UPDATE SET hash = excluded.hash, parent_hash = excluded.parent_hash`);
            for (const row of blocks)
            {
                block.run(row.number, row.hash, row.parent_hash, row.timestamp, row.miner, row.gas_used,
                    row.gas_limit, row.base_fee, row.size, row.tx_count);
            }

            const tx = this.#stmt(`
                INSERT INTO transactions (hash, block_number, tx_index, from_addr, to_addr, value, nonce,
                    input_size, gas_used, effective_gas_price, status, contract_address, timestamp)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT (hash) DO NOTHING`);
            for (const row of transactions)
            {
                tx.run(row.hash, row.block_number, row.tx_index, row.from_addr, row.to_addr, row.value,
                    row.nonce, row.input_size, row.gas_used, row.effective_gas_price, row.status,
                    row.contract_address, row.timestamp);
            }

            const transfer = this.#stmt(`
                INSERT INTO token_transfers (tx_hash, log_index, block_number, token, from_addr, to_addr, value, token_id, kind, timestamp)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT (tx_hash, log_index) DO NOTHING`);
            for (const row of transfers)
            {
                transfer.run(row.tx_hash, row.log_index, row.block_number, row.token, row.from_addr,
                    row.to_addr, row.value, row.token_id, row.kind, row.timestamp);
            }
        }, true));
    }

    /** One block - see {@link insertBlocks}. */
    public insertBlock(row: BlockRow, transactions: TransactionRow[], transfers: TransferRow[]): Promise<void>
    {
        return this.insertBlocks([{ block: row, transactions, transfers }]);
    }

    /** Describes tokens, replacing any earlier description of the same address. */
    public upsertTokens(rows: readonly TokenRow[]): Promise<void>
    {
        const unique = lastByKey(rows, (row) => row.address)
            .sort((left, right) => (left.address < right.address ? -1 : left.address > right.address ? 1 : 0));
        return this.#run('upsertTokens', () =>
        {
            const statement = this.#stmt(`
                INSERT INTO tokens (address, name, symbol, decimals, kind) VALUES (?, ?, ?, ?, ?)
                ON CONFLICT (address) DO UPDATE SET name = excluded.name, symbol = excluded.symbol,
                    decimals = excluded.decimals, kind = excluded.kind`);
            for (const row of unique)
            {
                statement.run(row.address, row.name, row.symbol, row.decimals, row.kind);
            }
        }, true);
    }

    public upsertToken(row: TokenRow): Promise<void>
    {
        return this.upsertTokens([row]);
    }

    /** Whether this token has already been described. */
    public knownToken(address: string): Promise<boolean>
    {
        return this.#run('knownToken', () =>
        {
            const account = bindable(normalize(address));
            return account !== null && this.#stmt('SELECT 1 FROM tokens WHERE address = ?').get(account) !== undefined;
        });
    }

    /**
     * Which of these tokens have never been described - one lookup for a whole batch.
     *
     * Ingest asks this once per batch rather than once per transfer, so there is no in-memory
     * cache in front of it: on a busy token a cache saved thousands of identical queries, and a
     * set lookup saves the same thousands without a copy of the table that can disagree with it.
     */
    public unknownTokens(addresses: Iterable<string>): Promise<Set<string>>
    {
        const wanted = [...new Set([...addresses].map(normalize))];
        return this.#run('unknownTokens', () =>
        {
            const statement = this.#stmt('SELECT 1 FROM tokens WHERE address = ?');
            return new Set(wanted.filter((account) => bindable(account) === null || statement.get(account) === undefined));
        });
    }

    // ----------------------------------------------------------------------------------
    // Reads
    // ----------------------------------------------------------------------------------

    /** The newest block's height, 0 for an empty index - one seek, where `stats()` counts tables. */
    public head(): Promise<number>
    {
        return this.#run('head', () =>
            (this.#stmt('SELECT COALESCE(MAX(number), 0) AS head FROM blocks').get() as { head: number }).head);
    }

    /**
     * What the index holds, counted, and how far it reaches: the height and instant of its newest
     * block and the instant of its oldest. The two instants bound what the index has SEEN - a day
     * between them with nothing in it is a day the chain was silent; a day outside them is one
     * the index never looked at.
     */
    public stats(): Promise<IndexStats>
    {
        return this.#run('stats', () => this.#stmt(`
            SELECT (SELECT COUNT(*) FROM blocks) AS blocks,
                   (SELECT COUNT(*) FROM transactions) AS transactions,
                   (SELECT COUNT(*) FROM token_transfers) AS transfers,
                   (SELECT COALESCE(MAX(number), 0) FROM blocks) AS head,
                   (SELECT COALESCE(MAX(timestamp), 0) FROM blocks) AS headTime,
                   (SELECT COALESCE(MIN(timestamp), 0) FROM blocks) AS firstTime`)
            .get() as unknown as IndexStats);
    }

    /** Block times over the most recent window, for the average the summary reports. */
    public recentBlocks(limit: number): Promise<BlockRow[]>
    {
        return this.#run('recentBlocks', () =>
            this.#stmt('SELECT * FROM blocks ORDER BY number DESC LIMIT ?').all(limit) as unknown as BlockRow[]);
    }

    /**
     * One page of blocks, newest first, optionally only the ones that carried a transaction.
     *
     * `tx_count` is read off the row rather than counted through the transactions table: it was
     * written down as the block was indexed, so the narrowing costs a scan of one small column
     * instead of a join per row.
     */
    public blocksPage(limit: number, offset: number, content: BlockFilter = 'all'): Promise<Page<BlockRow>>
    {
        return this.#run('blocksPage', () =>
        {
            const where = content === 'filled' ? 'WHERE tx_count > 0' : '';
            const total = (this.#stmt(`SELECT COUNT(*) AS n FROM blocks ${ where }`).get() as { n: number }).n;
            const rows = this.#stmt(`SELECT * FROM blocks ${ where } ORDER BY number DESC LIMIT ? OFFSET ?`)
                .all(limit, offset) as unknown as BlockRow[];
            return { rows, total };
        });
    }

    public blockByNumber(number: number): Promise<BlockRow | null>
    {
        return this.#run('blockByNumber', () =>
        {
            const at = height(number);
            return at === null
                ? null
                : (this.#stmt('SELECT * FROM blocks WHERE number = ?').get(at) as BlockRow | undefined) ?? null;
        });
    }

    public blockByHash(hash: string): Promise<BlockRow | null>
    {
        return this.#run('blockByHash', () =>
        {
            const key = bindable(hash.toLowerCase());
            return key === null
                ? null
                : (this.#stmt('SELECT * FROM blocks WHERE hash = ?').get(key) as BlockRow | undefined) ?? null;
        });
    }

    /** The hash of each of these heights the index holds - one lookup for a whole page of rows. */
    public blockHashes(numbers: Iterable<number>): Promise<Map<number, string>>
    {
        const wanted = [...new Set(numbers)].filter((number) => height(number) !== null);
        return this.#run('blockHashes', () =>
        {
            const statement = this.#stmt('SELECT hash FROM blocks WHERE number = ?');
            const found = new Map<number, string>();
            for (const number of wanted)
            {
                const row = statement.get(number) as { hash: string } | undefined;
                if (row !== undefined)
                {
                    found.set(number, row.hash);
                }
            }
            return found;
        });
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
    public transactionsPage(limit: number, offset: number, status: TxStatusFilter = 'all'): Promise<Page<TransactionRow>>
    {
        return this.#run('transactionsPage', () =>
        {
            // Bound rather than interpolated. `status` is already a closed union off a validated
            // enum, so nothing hostile can reach here - but a clause assembled by concatenation is
            // the shape that stops being safe the day somebody widens the type.
            const where = status === 'all' ? '' : 'WHERE status = ?';
            const bound = status === 'all' ? [] : [status === 'success' ? 1 : 0];
            const total = (this.#stmt(`SELECT COUNT(*) AS n FROM transactions ${ where }`).get(...bound) as { n: number }).n;
            const rows = this.#stmt(`
                SELECT * FROM transactions ${ where }
                ORDER BY block_number DESC, tx_index DESC LIMIT ? OFFSET ?`)
                .all(...bound, limit, offset) as unknown as TransactionRow[];
            return { rows, total };
        });
    }

    /**
     * One page of a block's transactions, in the order the block executed them. A full block can
     * carry hundreds, and shipping all of them turns a detail page into a download.
     */
    public transactionsOfBlock(number: number, limit: number, offset: number): Promise<Page<TransactionRow>>
    {
        return this.#run('transactionsOfBlock', () =>
        {
            const at = height(number);
            if (at === null)
            {
                return { rows: [], total: 0 };
            }
            const total = (this.#stmt('SELECT COUNT(*) AS n FROM transactions WHERE block_number = ?')
                .get(at) as { n: number }).n;
            const rows = this.#stmt('SELECT * FROM transactions WHERE block_number = ? ORDER BY tx_index ASC LIMIT ? OFFSET ?')
                .all(at, limit, offset) as unknown as TransactionRow[];
            return { rows, total };
        });
    }

    public transactionByHash(hash: string): Promise<TransactionRow | null>
    {
        return this.#run('transactionByHash', () =>
        {
            const key = bindable(hash.toLowerCase());
            return key === null
                ? null
                : (this.#stmt('SELECT * FROM transactions WHERE hash = ?').get(key) as TransactionRow | undefined) ?? null;
        });
    }

    /** Each of these transactions the index holds, keyed by lower-cased hash - one lookup per page. */
    public transactionsByHash(hashes: Iterable<string>): Promise<Map<string, TransactionRow>>
    {
        const wanted = [...new Set([...hashes].map((hash) => hash.toLowerCase()))].filter((hash) => bindable(hash) !== null);
        return this.#run('transactionsByHash', () =>
        {
            const statement = this.#stmt('SELECT * FROM transactions WHERE hash = ?');
            const found = new Map<string, TransactionRow>();
            for (const hash of wanted)
            {
                const row = statement.get(hash) as TransactionRow | undefined;
                if (row !== undefined)
                {
                    found.set(hash, row);
                }
            }
            return found;
        });
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
    public transactionsOfAddress(
        address: string,
        limit: number,
        offset: number,
        direction: AddressDirection = 'all'
    ): Promise<Page<TransactionRow>>
    {
        return this.#run('transactionsOfAddress', () =>
        {
            const account = bindable(normalize(address));
            if (account === null)
            {
                return { rows: [], total: 0 };
            }
            const where = direction === 'in' ? 'to_addr = ?' : direction === 'out' ? 'from_addr = ?' : 'from_addr = ? OR to_addr = ?';
            const bound = direction === 'all' ? [account, account] : [account];
            const total = (this.#stmt(`SELECT COUNT(*) AS n FROM transactions WHERE ${ where }`)
                .get(...bound) as { n: number }).n;
            const rows = this.#stmt(`
                SELECT * FROM transactions WHERE ${ where }
                ORDER BY block_number DESC, tx_index DESC LIMIT ? OFFSET ?`)
                .all(...bound, limit, offset) as unknown as TransactionRow[];
            return { rows, total };
        });
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
    public transfersOfAddress(address: string, limit: number, offset: number): Promise<Page<TransferRow>>
    {
        return this.#run('transfersOfAddress', () =>
        {
            const account = bindable(normalize(address));
            if (account === null)
            {
                return { rows: [], total: 0 };
            }
            const total = (this.#stmt('SELECT COUNT(*) AS n FROM token_transfers WHERE from_addr = ? OR to_addr = ? OR token = ?')
                .get(account, account, account) as { n: number }).n;
            const rows = this.#stmt(`
                SELECT * FROM token_transfers WHERE from_addr = ? OR to_addr = ? OR token = ?
                ORDER BY block_number DESC, log_index DESC LIMIT ? OFFSET ?`)
                .all(account, account, account, limit, offset) as unknown as TransferRow[];
            return { rows, total };
        });
    }

    /**
     * The Etherscan-shaped address query: a block RANGE, a sort direction and offset paging.
     *
     * Separate from {@link transactionsOfAddress} because that one answers the UI's question -
     * newest first, fixed page size - and this one answers a wallet's: "everything this address
     * did between two heights, oldest first, so I can resume from where I stopped."
     */
    public addressTransactionsInRange(
        address: string,
        fromBlock: number,
        toBlock: number,
        limit: number,
        offset: number,
        ascending: boolean
    ): Promise<TransactionRow[]>
    {
        return this.#run('addressTransactionsInRange', () =>
        {
            const account = bindable(normalize(address));
            if (account === null)
            {
                return [];
            }
            // The direction is interpolated, not bound: sqlite takes no parameter in ORDER BY, and
            // the value is a boolean from the caller, never a string off the query string.
            const direction = ascending ? 'ASC' : 'DESC';
            return this.#stmt(`
                SELECT * FROM transactions
                WHERE (from_addr = ? OR to_addr = ?) AND block_number >= ? AND block_number <= ?
                ORDER BY block_number ${ direction }, tx_index ${ direction } LIMIT ? OFFSET ?`)
                .all(account, account, fromBlock, toBlock, limit, offset) as unknown as TransactionRow[];
        });
    }

    /** The same range query over token transfers, optionally narrowed to one token contract. */
    public addressTransfersInRange(
        address: string,
        fromBlock: number,
        toBlock: number,
        limit: number,
        offset: number,
        ascending: boolean,
        contract: string | null
    ): Promise<TransferRow[]>
    {
        return this.#run('addressTransfersInRange', () =>
        {
            const account = bindable(normalize(address));
            const token = contract === null ? null : bindable(normalize(contract));
            if (account === null || (contract !== null && token === null))
            {
                return [];
            }
            const direction = ascending ? 'ASC' : 'DESC';
            const narrowed = token === null ? '' : 'AND token = ?';
            const bindings: Array<string | number> = [account, account, fromBlock, toBlock];
            if (token !== null)
            {
                bindings.push(token);
            }
            return this.#stmt(`
                SELECT * FROM token_transfers
                WHERE (from_addr = ? OR to_addr = ?) AND block_number >= ? AND block_number <= ? ${ narrowed }
                ORDER BY block_number ${ direction }, log_index ${ direction } LIMIT ? OFFSET ?`)
                .all(...bindings, limit, offset) as unknown as TransferRow[];
        });
    }

    /**
     * The transaction that DEPLOYED this contract - who put it there, and when.
     *
     * The chain does not answer this either: a receipt names the contract it created, but nothing
     * maps a contract back to its receipt. It is here for the same reason address history is -
     * the row was written down as the chain was read.
     */
    public contractCreation(address: string): Promise<TransactionRow | null>
    {
        return this.#run('contractCreation', () =>
        {
            const account = bindable(normalize(address));
            return account === null
                ? null
                : (this.#stmt('SELECT * FROM transactions WHERE contract_address = ? LIMIT 1')
                    .get(account) as TransactionRow | undefined) ?? null;
        });
    }

    /**
     * One page of the token transfers a transaction emitted, in LOG order.
     *
     * Ascending, unlike every other list here: within one transaction the log index is the order
     * the contract emitted them in, and a distributor's receipt read backwards is a different
     * story from the one that happened.
     */
    public transfersOfTransaction(hash: string, limit: number, offset: number): Promise<Page<TransferRow>>
    {
        return this.#run('transfersOfTransaction', () =>
        {
            const key = bindable(hash.toLowerCase());
            if (key === null)
            {
                return { rows: [], total: 0 };
            }
            const total = (this.#stmt('SELECT COUNT(*) AS n FROM token_transfers WHERE tx_hash = ?')
                .get(key) as { n: number }).n;
            const rows = this.#stmt('SELECT * FROM token_transfers WHERE tx_hash = ? ORDER BY log_index ASC LIMIT ? OFFSET ?')
                .all(key, limit, offset) as unknown as TransferRow[];
            return { rows, total };
        });
    }

    /** Native value in and out of an address, in wei - the flow ledger's totals. */
    public flowOfAddress(address: string): Promise<Flow>
    {
        return this.#run('flowOfAddress', () =>
        {
            const account = bindable(normalize(address));
            if (account === null)
            {
                return { in: '0', out: '0', fees: '0' };
            }
            const rows = this.#stmt(
                'SELECT to_addr, value, gas_used, effective_gas_price, from_addr FROM transactions WHERE (from_addr = ? OR to_addr = ?) AND status = 1')
                .all(account, account) as unknown as Array<Pick<TransactionRow, 'to_addr' | 'value' | 'gas_used' | 'effective_gas_price' | 'from_addr'>>;

            let inbound = 0n;
            let outbound = 0n;
            let fees = 0n;
            for (const row of rows)
            {
                const value = BigInt(row.value);
                if (row.to_addr === account)
                {
                    inbound += value;
                }
                if (row.from_addr === account)
                {
                    outbound += value;
                    fees += BigInt(row.gas_used) * BigInt(row.effective_gas_price);
                }
            }
            return { in: inbound.toString(), out: outbound.toString(), fees: fees.toString() };
        });
    }

    /**
     * Every address the index has seen, deduplicated - the candidate set for the rich list.
     *
     * JSON-RPC has no "who holds the most" call, so a top-accounts list ranks the addresses that
     * have appeared on-chain and reads each balance live against the node.
     */
    public distinctAddresses(): Promise<string[]>
    {
        return this.#run('distinctAddresses', () =>
        {
            const rows = this.#stmt(`
                SELECT DISTINCT addr FROM (
                    SELECT from_addr AS addr FROM transactions
                    UNION ALL SELECT to_addr AS addr FROM transactions
                    UNION ALL SELECT miner AS addr FROM blocks
                    UNION ALL SELECT from_addr AS addr FROM token_transfers
                    UNION ALL SELECT to_addr AS addr FROM token_transfers
                    UNION ALL SELECT token AS addr FROM token_transfers
                ) WHERE addr IS NOT NULL AND addr != ?`)
                .all(ZERO_ADDRESS) as unknown as Array<{ addr: string }>;
            return rows.map((row) => row.addr);
        });
    }

    // ----------------------------------------------------------------------------------
    // Aggregates - what the charts are drawn from
    // ----------------------------------------------------------------------------------

    /**
     * Fees over the transactions in a window, summed with BigInt into whatever bucket the caller
     * keys on.
     *
     * NOT `SUM(gas_used * effective_gas_price)`. Both columns are TEXT holding decimal wei, and
     * one transaction is already a product around 1e13 - a day of them overflows sqlite int64 and
     * quietly becomes a REAL, which is how an explorer starts reporting fees that are almost
     * right. The rows are read and reduced exactly instead. That costs a scan of two narrow
     * columns across the window, which is why the route calling it caches its answer.
     */
    #feesBy(from: number, to: number, bucket: (timestamp: number) => number): Map<number, { fees: bigint; count: number }>
    {
        const rows = this.#stmt(
            'SELECT timestamp, gas_used, effective_gas_price FROM transactions WHERE timestamp >= ? AND timestamp < ?')
            .all(from, to) as unknown as Array<Pick<TransactionRow, 'timestamp' | 'gas_used' | 'effective_gas_price'>>;

        const totals = new Map<number, { fees: bigint; count: number }>();
        for (const row of rows)
        {
            const key = bucket(row.timestamp);
            const seen = totals.get(key) ?? { fees: 0n, count: 0 };
            seen.fees += BigInt(row.gas_used) * BigInt(row.effective_gas_price);
            seen.count += 1;
            totals.set(key, seen);
        }
        return totals;
    }

    /**
     * How many addresses were seen for the FIRST time inside the window, bucketed.
     *
     * The inner query is deliberately NOT filtered by the window: "first time" is a fact about
     * all of history, and an address that has been on this chain for a year would be counted as
     * new the moment it appeared inside a thirty-day slice.
     */
    #firstSeen(from: number, to: number, bucket: (timestamp: number) => number): Map<number, number>
    {
        const rows = this.#stmt(`
            SELECT first FROM (
                SELECT addr, MIN(ts) AS first FROM (
                    SELECT from_addr AS addr, timestamp AS ts FROM transactions
                    UNION ALL
                    SELECT to_addr AS addr, timestamp AS ts FROM transactions WHERE to_addr IS NOT NULL
                ) GROUP BY addr
            ) WHERE first >= ? AND first < ?`)
            .all(from, to) as unknown as Array<{ first: number }>;

        const counts = new Map<number, number>();
        for (const row of rows)
        {
            const key = bucket(row.first);
            counts.set(key, (counts.get(key) ?? 0) + 1);
        }
        return counts;
    }

    /**
     * Every day between `from` and `to` that the index has something for, with the figures the
     * charts draw.
     *
     * A day the chain was silent gets NO row. Filling it with zeros here would make a day the
     * indexer has not reached indistinguishable from a day nothing happened, and only the caller
     * knows which of those it is looking at.
     */
    public statsDaily(from: number, to: number): Promise<DailyStats[]>
    {
        return this.#run('statsDaily', () =>
        {
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
            // same number without a window function or a second pass.
            const blocks = this.#stmt(`
                SELECT ${ DAY_BUCKET } AS day, COUNT(*) AS blocks, AVG(size) AS size,
                       SUM(CAST(gas_used AS INTEGER)) AS gasUsed, SUM(CAST(gas_limit AS INTEGER)) AS gasLimit,
                       MIN(timestamp) AS first, MAX(timestamp) AS last
                FROM blocks WHERE timestamp >= ? AND timestamp < ? GROUP BY day ORDER BY day ASC`)
                .all(from, to) as unknown as Array<{
                    day: number; blocks: number; size: number; gasUsed: number; gasLimit: number; first: number; last: number;
                }>;
            for (const row of blocks)
            {
                const entry = at(row.day);
                entry.blocks = row.blocks;
                entry.blockSize = row.size;
                entry.gasUsed = row.gasUsed;
                entry.gasLimit = row.gasLimit;
                entry.blockTime = row.blocks > 1 ? (row.last - row.first) / (row.blocks - 1) : 0;
            }

            // The gas price is a MEAN, truncated to the wei on the way out - a statistic about a
            // day, never a figure anybody is owed.
            // The mean price comes back as TEXT, not as an integer. node:sqlite hands an INTEGER
            // column to JS as a number and THROWS above 2^53 - which is 0.009 native in wei, a gas
            // price a congested chain reaches - so a column that can hold wei must cross as text.
            const transactions = this.#stmt(`
                SELECT ${ DAY_BUCKET } AS day, COUNT(*) AS transactions, COUNT(contract_address) AS contracts,
                       CAST(CAST(AVG(CAST(effective_gas_price AS INTEGER)) AS INTEGER) AS TEXT) AS gasPrice
                FROM transactions WHERE timestamp >= ? AND timestamp < ? GROUP BY day ORDER BY day ASC`)
                .all(from, to) as unknown as Array<{
                    day: number; transactions: number; contracts: number; gasPrice: string | null;
                }>;
            for (const row of transactions)
            {
                const entry = at(row.day);
                entry.transactions = row.transactions;
                entry.contracts = row.contracts;
                entry.gasPrice = row.gasPrice ?? '0';
            }

            const transfers = this.#stmt(`
                SELECT ${ DAY_BUCKET } AS day, COUNT(*) AS transfers
                FROM token_transfers WHERE timestamp >= ? AND timestamp < ? GROUP BY day ORDER BY day ASC`)
                .all(from, to) as unknown as Array<{ day: number; transfers: number }>;
            for (const row of transfers)
            {
                at(row.day).transfers = row.transfers;
            }

            // UNION and not UNION ALL: an address that both sent and received on the same day was
            // active once, and one that sent to itself was active once too.
            const active = this.#stmt(`
                SELECT day, COUNT(*) AS active FROM (
                    SELECT DISTINCT ${ DAY_BUCKET } AS day, from_addr AS addr FROM transactions WHERE timestamp >= ? AND timestamp < ?
                    UNION
                    SELECT DISTINCT ${ DAY_BUCKET } AS day, to_addr AS addr FROM transactions WHERE timestamp >= ? AND timestamp < ? AND to_addr IS NOT NULL
                ) GROUP BY day ORDER BY day ASC`)
                .all(from, to, from, to) as unknown as Array<{ day: number; active: number }>;
            for (const row of active)
            {
                at(row.day).activeAddresses = row.active;
            }

            const bucket = (timestamp: number): number => Math.floor(timestamp / DAY_SECONDS);
            for (const [day, count] of this.#firstSeen(from, to, bucket))
            {
                at(day).newAddresses = count;
            }
            for (const [day, totals] of this.#feesBy(from, to, bucket))
            {
                at(day).fees = totals.fees.toString();
            }

            return [...days.values()].sort((left, right) => left.day - right.day);
        });
    }

    /** The same figures over one arbitrary window - what a headline tile compares against. */
    public statsWindow(from: number, to: number): Promise<WindowStats>
    {
        return this.#run('statsWindow', () =>
        {
            const blocks = this.#stmt(`
                SELECT COUNT(*) AS blocks, SUM(CAST(gas_used AS INTEGER)) AS gasUsed,
                       SUM(CAST(gas_limit AS INTEGER)) AS gasLimit, MIN(timestamp) AS first, MAX(timestamp) AS last
                FROM blocks WHERE timestamp >= ? AND timestamp < ?`)
                .get(from, to) as { blocks: number; gasUsed: number | null; gasLimit: number | null; first: number | null; last: number | null };

            const transactions = this.#stmt(`
                SELECT COUNT(*) AS transactions, COUNT(contract_address) AS contracts
                FROM transactions WHERE timestamp >= ? AND timestamp < ?`)
                .get(from, to) as { transactions: number; contracts: number };

            const transfers = (this.#stmt('SELECT COUNT(*) AS n FROM token_transfers WHERE timestamp >= ? AND timestamp < ?')
                .get(from, to) as { n: number }).n;

            const active = (this.#stmt(`
                SELECT COUNT(*) AS n FROM (
                    SELECT DISTINCT from_addr AS addr FROM transactions WHERE timestamp >= ? AND timestamp < ?
                    UNION
                    SELECT DISTINCT to_addr AS addr FROM transactions WHERE timestamp >= ? AND timestamp < ? AND to_addr IS NOT NULL
                )`).get(from, to, from, to) as { n: number }).n;

            // One bucket for the whole window.
            const fees = this.#feesBy(from, to, () => 0).get(0) ?? { fees: 0n, count: 0 };
            const fresh = this.#firstSeen(from, to, () => 0).get(0) ?? 0;

            return {
                blocks: blocks.blocks,
                transactions: transactions.transactions,
                transfers,
                contracts: transactions.contracts,
                activeAddresses: active,
                newAddresses: fresh,
                gasUsed: blocks.gasUsed ?? 0,
                gasLimit: blocks.gasLimit ?? 0,
                blockTime: blocks.blocks > 1 ? ((blocks.last ?? 0) - (blocks.first ?? 0)) / (blocks.blocks - 1) : 0,
                fees: fees.fees.toString(),
                // Integer division in BigInt: a mean fee is still wei, and a wei that came back
                // through a double is the thing this whole file is written to avoid.
                averageFee: fees.count === 0 ? '0' : (fees.fees / BigInt(fees.count)).toString()
            };
        });
    }

    /** Everything the index holds, counted - the cumulative half of the overview. */
    public totals(): Promise<TotalStats>
    {
        return this.#run('totals', () =>
        {
            const row = this.#stmt(`
                SELECT (SELECT COUNT(*) FROM blocks) AS blocks,
                       (SELECT COUNT(*) FROM transactions) AS transactions,
                       (SELECT COUNT(*) FROM token_transfers) AS transfers,
                       (SELECT COUNT(*) FROM tokens) AS tokens,
                       (SELECT COUNT(*) FROM transactions WHERE contract_address IS NOT NULL) AS contracts`)
                .get() as Omit<TotalStats, 'addresses'>;

            // Counted the same way the rich list gathers its candidates, so the two agree.
            const addresses = (this.#stmt(`
                SELECT COUNT(*) AS n FROM (
                    SELECT DISTINCT addr FROM (
                        SELECT from_addr AS addr FROM transactions
                        UNION ALL SELECT to_addr AS addr FROM transactions
                        UNION ALL SELECT miner AS addr FROM blocks
                        UNION ALL SELECT from_addr AS addr FROM token_transfers
                        UNION ALL SELECT to_addr AS addr FROM token_transfers
                        UNION ALL SELECT token AS addr FROM token_transfers
                    ) WHERE addr IS NOT NULL AND addr != ?
                )`).get(ZERO_ADDRESS) as { n: number }).n;

            return { ...row, addresses };
        });
    }

    public token(address: string): Promise<TokenRow | null>
    {
        return this.#run('token', () =>
        {
            const account = bindable(normalize(address));
            return account === null
                ? null
                : (this.#stmt('SELECT * FROM tokens WHERE address = ?').get(account) as TokenRow | undefined) ?? null;
        });
    }

    /** Each of these tokens the index has described, keyed by lower-cased address - one lookup per page. */
    public tokensOf(addresses: Iterable<string>): Promise<Map<string, TokenRow>>
    {
        const wanted = [...new Set([...addresses].map(normalize))].filter((account) => bindable(account) !== null);
        return this.#run('tokensOf', () =>
        {
            const statement = this.#stmt('SELECT * FROM tokens WHERE address = ?');
            const found = new Map<string, TokenRow>();
            for (const account of wanted)
            {
                const row = statement.get(account) as TokenRow | undefined;
                if (row !== undefined)
                {
                    found.set(account, row);
                }
            }
            return found;
        });
    }

    public tokens(): Promise<TokenRow[]>
    {
        return this.#run('tokens', () => this.#stmt('SELECT * FROM tokens ORDER BY symbol ASC').all() as unknown as TokenRow[]);
    }
}
