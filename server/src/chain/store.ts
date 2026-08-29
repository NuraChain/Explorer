import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import type { AddressDirection, BlockFilter, TxStatusFilter } from '../schemas.ts';

// The index. Everything here is DERIVED from the chain, so a schema change is a rebuild, not a
// migration: bump SCHEMA_VERSION and the tables drop and replay from START_BLOCK.
//
// The whole point of this file is the pair of indexes on `transactions(from_addr)` and
// `transactions(to_addr)`. Ethereum JSON-RPC cannot answer "every transaction touching this
// address" - that is the question an explorer exists to answer, and it is answerable only
// because these rows were written down as the chain was read.

/** Bumped whenever a column changes; the index rebuilds itself from the chain. */
const SCHEMA_VERSION = '2';

/** The ERC-20 / ERC-721 `Transfer(address,address,uint256)` topic. */
export const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

/** `TransferSingle(address,address,address,uint256,uint256)` - ERC-1155. */
export const TRANSFER_SINGLE_TOPIC = '0xc3d58168c5ae7397731d063d5bbf3d657854427343f4c083240f7aacaa2d0f62';

/** The zero address: mints and burns name it, but nothing can be spent from it. */
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

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
-- Governance. Nothing here is configured: a governor is an address that emitted a governor's
-- event, and it is written down the first time one is seen.
CREATE TABLE IF NOT EXISTS governors (
    address TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    token TEXT,
    counting_mode TEXT NOT NULL,
    -- 'blocknumber' or 'timestamp': what vote_start and vote_end are measured in. See ERC-6372.
    clock TEXT NOT NULL,
    first_block INTEGER NOT NULL
);
-- The one table in this file that is not append-only. A proposal is created once and then
-- MARKED - queued, executed, withdrawn - by transactions that arrive later, so the row carries
-- the marks and a reorg has to take them off again (see rollbackFrom).
CREATE TABLE IF NOT EXISTS proposals (
    governor TEXT NOT NULL,
    proposal_id TEXT NOT NULL,
    proposer TEXT NOT NULL,
    description TEXT NOT NULL,
    -- The calls the proposal makes if it passes, as JSON arrays, index-aligned. JSON and not
    -- four tables: they are read as one list, always together, and never queried across.
    targets TEXT NOT NULL,
    call_values TEXT NOT NULL,
    signatures TEXT NOT NULL,
    calldatas TEXT NOT NULL,
    vote_start TEXT NOT NULL,
    vote_end TEXT NOT NULL,
    -- What the governor answered for quorum(vote_start) when the proposal was first seen. Null
    -- when it refused: quorum can be a function of a timepoint the node no longer has state for.
    quorum TEXT,
    created_block INTEGER NOT NULL,
    created_tx TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    canceled_block INTEGER,
    canceled_tx TEXT,
    queued_block INTEGER,
    queued_tx TEXT,
    queued_eta TEXT,
    executed_block INTEGER,
    executed_tx TEXT,
    -- Summed from the votes below rather than read from the governor: the tally is derived, and
    -- rederiving it after every write is what keeps it true across a reorg.
    for_votes TEXT NOT NULL DEFAULT '0',
    against_votes TEXT NOT NULL DEFAULT '0',
    abstain_votes TEXT NOT NULL DEFAULT '0',
    voters INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (governor, proposal_id)
);
CREATE INDEX IF NOT EXISTS idx_proposals_created ON proposals (created_block DESC);
CREATE TABLE IF NOT EXISTS votes (
    tx_hash TEXT NOT NULL,
    log_index INTEGER NOT NULL,
    governor TEXT NOT NULL,
    proposal_id TEXT NOT NULL,
    voter TEXT NOT NULL,
    -- 0 against, 1 for, 2 abstain - the order GovernorCountingSimple fixed. A governor that
    -- counts some other way emits its own numbers here, and they are stored as they came.
    support INTEGER NOT NULL,
    weight TEXT NOT NULL,
    reason TEXT NOT NULL,
    block_number INTEGER NOT NULL,
    timestamp INTEGER NOT NULL,
    PRIMARY KEY (tx_hash, log_index)
);
CREATE INDEX IF NOT EXISTS idx_votes_proposal ON votes (governor, proposal_id, block_number DESC);
CREATE INDEX IF NOT EXISTS idx_votes_voter ON votes (voter, block_number DESC);
`;

export interface BlockRow
{
    number: number;
    hash: string;
    parent_hash: string;
    timestamp: number;
    miner: string;
    gas_used: string;
    gas_limit: string;
    base_fee: string | null;
    size: number;
    tx_count: number;
}

export interface TransactionRow
{
    hash: string;
    block_number: number;
    tx_index: number;
    from_addr: string;
    to_addr: string | null;
    value: string;
    nonce: number;
    input_size: number;
    gas_used: string;
    effective_gas_price: string;
    status: number;
    contract_address: string | null;
    timestamp: number;
}

export interface TransferRow
{
    tx_hash: string;
    log_index: number;
    block_number: number;
    token: string;
    from_addr: string;
    to_addr: string;
    value: string;
    token_id: string | null;
    kind: string;
    timestamp: number;
}

export interface TokenRow
{
    address: string;
    name: string;
    symbol: string;
    decimals: number;
    kind: string;
}

export interface GovernorRow
{
    address: string;
    /** `name()`, or '' from a governor that does not answer it. */
    name: string;
    /** The votes token the governor counts, or null where `token()` said nothing. */
    token: string | null;
    counting_mode: string;
    clock: string;
    first_block: number;
}

export interface ProposalRow
{
    governor: string;
    /** A uint256 as a decimal string: proposal ids are hashes of the proposal, not counters. */
    proposal_id: string;
    proposer: string;
    description: string;
    targets: string;
    call_values: string;
    signatures: string;
    calldatas: string;
    vote_start: string;
    vote_end: string;
    quorum: string | null;
    created_block: number;
    created_tx: string;
    timestamp: number;
    canceled_block: number | null;
    canceled_tx: string | null;
    queued_block: number | null;
    queued_tx: string | null;
    queued_eta: string | null;
    executed_block: number | null;
    executed_tx: string | null;
    for_votes: string;
    against_votes: string;
    abstain_votes: string;
    voters: number;
}

export interface VoteRow
{
    tx_hash: string;
    log_index: number;
    governor: string;
    proposal_id: string;
    voter: string;
    support: number;
    weight: string;
    reason: string;
    block_number: number;
    timestamp: number;
}

/** A proposal reaching a state a later transaction put it in. */
export interface ProposalMark
{
    governor: string;
    proposal_id: string;
    kind: 'queued' | 'executed' | 'canceled';
    block: number;
    tx_hash: string;
    /** Only a queue carries one. */
    eta: string | null;
}

/** Seconds in a UTC day - the bucket every series here is grouped into. */
const DAY_SECONDS = 86_400;

/**
 * `timestamp / 86400` as sqlite must see it, INTERPOLATED and never bound.
 *
 * A bound JS number arrives as a REAL, and integer / REAL is real division - so every row landed
 * in a bucket of its own and a day of chain came back as three hundred fractional "days". The
 * constant is this file's own, so interpolating it is safe in the way a query string never is.
 */
const DAY_BUCKET = `timestamp / ${ DAY_SECONDS }`;

/**
 * One day of the chain, as the charts read it.
 *
 * Gas is a COUNT of gas units, not an amount of currency, so it crosses as a number: a whole day
 * of a 30M-limit chain is about 4e12, which a double holds exactly with three orders of magnitude
 * to spare. `fees` and `gasPrice` are wei and do not - see the note on #feesBy.
 */
export interface DailyStats
{
    /** Unix day index (timestamp / 86400), so the caller can turn it back into a date. */
    day: number;
    blocks: number;
    transactions: number;
    transfers: number;
    contracts: number;
    activeAddresses: number;
    newAddresses: number;
    gasUsed: number;
    gasLimit: number;
    /** Mean bytes per block. */
    blockSize: number;
    /** Mean seconds between this day's blocks; 0 when the day held only one. */
    blockTime: number;
    /** Mean effective gas price, in wei, rounded to the wei. */
    gasPrice: string;
    /** Total fees paid that day, in wei. */
    fees: string;
}

/** The same figures over one arbitrary window - what a headline tile compares against. */
export interface WindowStats
{
    blocks: number;
    transactions: number;
    transfers: number;
    contracts: number;
    activeAddresses: number;
    newAddresses: number;
    gasUsed: number;
    gasLimit: number;
    blockTime: number;
    /** Total fees over the window, in wei. */
    fees: string;
    /** Fees divided by transactions, in wei. '0' when the window held none. */
    averageFee: string;
}

/** Everything the index holds, counted. The cumulative half of the overview. */
export interface TotalStats
{
    blocks: number;
    transactions: number;
    transfers: number;
    addresses: number;
    tokens: number;
    contracts: number;
}

/** Addresses are stored and compared lower-cased; checksummed input must never miss a row. */
export function normalize(address: string): string
{
    return address.toLowerCase();
}

export class IndexStore
{
    readonly #db: DatabaseSync;

    /**
     * Prepared statements, keyed by their SQL. Ingest runs the same handful of INSERTs once per
     * block; re-preparing them each time re-parses and re-plans the statement, which during a
     * backfill costs more than the writes themselves.
     */
    readonly #statements = new Map<string, StatementSync>();

    /** Addresses already in `tokens`, so ingest does not query per transfer to ask. */
    readonly #knownTokens = new Set<string>();

    /** The same, for governors: one governor emits an event per vote, and each one would ask. */
    readonly #knownGovernors = new Set<string>();

    #inTransaction = false;

    constructor(path: string)
    {
        // sqlite creates the FILE but not the directory holding it, so a configured
        // `.data/index.db` fails to open on a fresh clone until someone makes the folder.
        // ':memory:' has no directory at all.
        if (path !== ':memory:')
        {
            const parent = dirname(resolve(path));
            if (!existsSync(parent))
            {
                mkdirSync(parent, { recursive: true });
            }
        }
        this.#db = new DatabaseSync(path);
        // Every row here is derived from the chain, so durability of the LAST few commits buys
        // nothing: a power cut costs a few blocks that the indexer re-reads from its cursor on the
        // next boot. `synchronous = NORMAL` under WAL drops the fsync per commit, which is the
        // single largest cost of a backfill; the rest give the page cache room to work.
        this.#db.exec(`
            PRAGMA journal_mode = WAL;
            PRAGMA synchronous = NORMAL;
            PRAGMA temp_store = MEMORY;
            PRAGMA cache_size = -65536;
            PRAGMA busy_timeout = 5000;`);
        this.#db.exec(DDL);
        this.#migrate();
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
     * Runs `work` inside ONE transaction. Without this every insert commits on its own, so a
     * batch of a thousand blocks pays a thousand commits - the difference between a backfill that
     * runs at the speed of the RPC and one that runs at the speed of the disk. Nested calls join
     * the outer transaction rather than opening a second one, which sqlite does not allow.
     */
    public transaction<T>(work: () => T): T
    {
        if (this.#inTransaction)
        {
            return work();
        }
        this.#db.exec('BEGIN IMMEDIATE');
        this.#inTransaction = true;
        try
        {
            const result = work();
            this.#db.exec('COMMIT');
            return result;
        }
        catch (error)
        {
            this.#db.exec('ROLLBACK');
            throw error;
        }
        finally
        {
            this.#inTransaction = false;
        }
    }

    /**
     * Every table here is derived from the chain, so a schema change drops and replays rather
     * than migrating. `CREATE TABLE IF NOT EXISTS` will not add a column to an existing file,
     * which is exactly how a stale index starts serving rows that are missing one.
     */
    #migrate(): void
    {
        if (this.getMeta('schema') === SCHEMA_VERSION)
        {
            return;
        }
        this.#db.exec(
            'DROP TABLE IF EXISTS blocks;'
            + 'DROP TABLE IF EXISTS transactions;'
            + 'DROP TABLE IF EXISTS token_transfers;'
            + 'DROP TABLE IF EXISTS tokens;'
            + 'DROP TABLE IF EXISTS governors;'
            + 'DROP TABLE IF EXISTS proposals;'
            + 'DROP TABLE IF EXISTS votes;'
            + 'DROP TABLE IF EXISTS meta;');
        this.#db.exec(DDL);
        this.setMeta('schema', SCHEMA_VERSION);
    }

    public close(): void
    {
        this.#db.close();
    }

    public getMeta(key: string): string | null
    {
        const row = this.#stmt('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined;
        return row?.value ?? null;
    }

    public setMeta(key: string, value: string): void
    {
        this.#stmt('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value')
            .run(key, value);
    }

    /** The highest block indexed, or startBlock-1 when the index is empty. */
    public cursor(fallback: number): number
    {
        const value = this.getMeta('cursor');
        return value === null ? fallback - 1 : Number(value);
    }

    public setCursor(block: number): void
    {
        this.setMeta('cursor', String(block));
    }

    /**
     * The stale-index guard: if the chain behind the RPC is not the one this index was built
     * from (a restarted local node), everything derived is wrong. Wipe and start over.
     */
    public ensureChain(genesisHash: string): boolean
    {
        const known = this.getMeta('genesis');
        if (known === genesisHash)
        {
            return false;
        }
        if (known !== null)
        {
            this.#db.exec('DELETE FROM blocks; DELETE FROM transactions; DELETE FROM token_transfers; DELETE FROM tokens;'
                + 'DELETE FROM governors; DELETE FROM proposals; DELETE FROM votes;');
            this.#stmt('DELETE FROM meta WHERE key = ?').run('cursor');
            this.#knownTokens.clear();
            this.#knownGovernors.clear();
        }
        this.setMeta('genesis', genesisHash);
        return known !== null;
    }

    // ----------------------------------------------------------------------------------
    // Ingest
    // ----------------------------------------------------------------------------------

    public blockHash(number: number): string | null
    {
        const row = this.#stmt('SELECT hash FROM blocks WHERE number = ?').get(number) as { hash: string } | undefined;
        return row?.hash ?? null;
    }

    /** Drops everything at or above `number` - the rollback half of reorg handling. */
    public rollbackFrom(number: number): void
    {
        this.#stmt('DELETE FROM token_transfers WHERE block_number >= ?').run(number);
        this.#stmt('DELETE FROM transactions WHERE block_number >= ?').run(number);

        // Governance before blocks, and the tally last. A vote that is being rolled back was
        // counted into a proposal that is NOT - the proposal is older than the fork - so the
        // proposals it touched have to be summed again once its rows are gone.
        const touched = this.#stmt('SELECT DISTINCT governor, proposal_id FROM votes WHERE block_number >= ?')
            .all(number) as unknown as Array<{ governor: string; proposal_id: string }>;
        this.#stmt('DELETE FROM votes WHERE block_number >= ?').run(number);
        this.#stmt('UPDATE proposals SET canceled_block = NULL, canceled_tx = NULL WHERE canceled_block >= ?').run(number);
        this.#stmt('UPDATE proposals SET queued_block = NULL, queued_tx = NULL, queued_eta = NULL WHERE queued_block >= ?').run(number);
        this.#stmt('UPDATE proposals SET executed_block = NULL, executed_tx = NULL WHERE executed_block >= ?').run(number);
        this.#stmt('DELETE FROM proposals WHERE created_block >= ?').run(number);
        this.#stmt('DELETE FROM governors WHERE first_block >= ?').run(number);
        // Cleared rather than pruned: the set is a cache of what the table holds, and the table
        // just lost rows this process cannot name without asking it again.
        this.#knownGovernors.clear();
        for (const row of touched)
        {
            this.retally(row.governor, row.proposal_id);
        }

        this.#stmt('DELETE FROM blocks WHERE number >= ?').run(number);
    }

    public insertBlock(row: BlockRow, transactions: TransactionRow[], transfers: TransferRow[]): void
    {
        this.#stmt(`
            INSERT INTO blocks (number, hash, parent_hash, timestamp, miner, gas_used, gas_limit, base_fee, size, tx_count)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (number) DO UPDATE SET hash = excluded.hash, parent_hash = excluded.parent_hash`)
            .run(row.number, row.hash, row.parent_hash, row.timestamp, row.miner, row.gas_used,
                row.gas_limit, row.base_fee, row.size, row.tx_count);

        const tx = this.#stmt(`
            INSERT INTO transactions (hash, block_number, tx_index, from_addr, to_addr, value, nonce,
                input_size, gas_used, effective_gas_price, status, contract_address, timestamp)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (hash) DO NOTHING`);
        for (const row_ of transactions)
        {
            tx.run(row_.hash, row_.block_number, row_.tx_index, row_.from_addr, row_.to_addr, row_.value,
                row_.nonce, row_.input_size, row_.gas_used, row_.effective_gas_price, row_.status,
                row_.contract_address, row_.timestamp);
        }

        const transfer = this.#stmt(`
            INSERT INTO token_transfers (tx_hash, log_index, block_number, token, from_addr, to_addr, value, token_id, kind, timestamp)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (tx_hash, log_index) DO NOTHING`);
        for (const row_ of transfers)
        {
            transfer.run(row_.tx_hash, row_.log_index, row_.block_number, row_.token, row_.from_addr,
                row_.to_addr, row_.value, row_.token_id, row_.kind, row_.timestamp);
        }
    }

    public upsertToken(row: TokenRow): void
    {
        this.#stmt(`
            INSERT INTO tokens (address, name, symbol, decimals, kind) VALUES (?, ?, ?, ?, ?)
            ON CONFLICT (address) DO UPDATE SET name = excluded.name, symbol = excluded.symbol,
                decimals = excluded.decimals, kind = excluded.kind`)
            .run(row.address, row.name, row.symbol, row.decimals, row.kind);
        this.#knownTokens.add(normalize(row.address));
    }

    /**
     * Whether this token has already been described. Answered from memory after the first miss:
     * ingest asks once per transfer, and on a busy token that is thousands of identical queries.
     */
    public knownToken(address: string): boolean
    {
        const account = normalize(address);
        if (this.#knownTokens.has(account))
        {
            return true;
        }
        if (this.#stmt('SELECT 1 FROM tokens WHERE address = ?').get(account) === undefined)
        {
            return false;
        }
        this.#knownTokens.add(account);
        return true;
    }

    // ----------------------------------------------------------------------------------
    // Reads
    // ----------------------------------------------------------------------------------

    public stats(): { blocks: number; transactions: number; transfers: number; head: number; headTime: number }
    {
        const row = this.#stmt(`
            SELECT (SELECT COUNT(*) FROM blocks) AS blocks,
                   (SELECT COUNT(*) FROM transactions) AS transactions,
                   (SELECT COUNT(*) FROM token_transfers) AS transfers,
                   (SELECT COALESCE(MAX(number), 0) FROM blocks) AS head,
                   (SELECT COALESCE(MAX(timestamp), 0) FROM blocks) AS headTime`)
            .get() as { blocks: number; transactions: number; transfers: number; head: number; headTime: number };
        return row;
    }

    /** Block times over the most recent window, for the average the summary reports. */
    public recentBlocks(limit: number): BlockRow[]
    {
        return this.#stmt('SELECT * FROM blocks ORDER BY number DESC LIMIT ?').all(limit) as unknown as BlockRow[];
    }

    /**
     * One page of blocks, newest first, optionally only the ones that carried a transaction.
     *
     * `tx_count` is read off the row rather than counted through the transactions table: it was
     * written down as the block was indexed, so the narrowing costs a scan of one small column
     * instead of a join per row.
     */
    public blocksPage(limit: number, offset: number, content: BlockFilter = 'all'): { rows: BlockRow[]; total: number }
    {
        const where = content === 'filled' ? 'WHERE tx_count > 0' : '';
        const total = (this.#stmt(`SELECT COUNT(*) AS n FROM blocks ${ where }`).get() as { n: number }).n;
        const rows = this.#stmt(`SELECT * FROM blocks ${ where } ORDER BY number DESC LIMIT ? OFFSET ?`)
            .all(limit, offset) as unknown as BlockRow[];
        return { rows, total };
    }

    public blockByNumber(number: number): BlockRow | null
    {
        return (this.#stmt('SELECT * FROM blocks WHERE number = ?').get(number) as BlockRow | undefined) ?? null;
    }

    public blockByHash(hash: string): BlockRow | null
    {
        return (this.#stmt('SELECT * FROM blocks WHERE hash = ?').get(hash.toLowerCase()) as BlockRow | undefined) ?? null;
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
     */
    public transactionsPage(limit: number, offset: number, status: TxStatusFilter = 'all'): { rows: TransactionRow[]; total: number }
    {
        // Bound rather than interpolated. `status` is already a closed union off a validated enum,
        // so nothing hostile can reach here - but a clause assembled by concatenation is the shape
        // that stops being safe the day somebody widens the type, and there is nothing to gain.
        const where = status === 'all' ? '' : 'WHERE status = ?';
        const bound = status === 'all' ? [] : [status === 'success' ? 1 : 0];
        const total = (this.#stmt(`SELECT COUNT(*) AS n FROM transactions ${ where }`).get(...bound) as { n: number }).n;
        const rows = this.#stmt(`
            SELECT * FROM transactions ${ where }
            ORDER BY block_number DESC, tx_index DESC LIMIT ? OFFSET ?`)
            .all(...bound, limit, offset) as unknown as TransactionRow[];
        return { rows, total };
    }

    /**
     * One page of a block's transactions, in the order the block executed them. A full block can
     * carry hundreds, and shipping all of them turns a detail page into a download.
     */
    public transactionsOfBlock(number: number, limit: number, offset: number): { rows: TransactionRow[]; total: number }
    {
        const total = (this.#stmt('SELECT COUNT(*) AS n FROM transactions WHERE block_number = ?')
            .get(number) as { n: number }).n;
        const rows = this.#stmt('SELECT * FROM transactions WHERE block_number = ? ORDER BY tx_index ASC LIMIT ? OFFSET ?')
            .all(number, limit, offset) as unknown as TransactionRow[];
        return { rows, total };
    }

    public transactionByHash(hash: string): TransactionRow | null
    {
        return (this.#stmt('SELECT * FROM transactions WHERE hash = ?').get(hash.toLowerCase()) as TransactionRow | undefined) ?? null;
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
    ): { rows: TransactionRow[]; total: number }
    {
        const account = normalize(address);
        const where = direction === 'in' ? 'to_addr = ?' : direction === 'out' ? 'from_addr = ?' : 'from_addr = ? OR to_addr = ?';
        const bound = direction === 'all' ? [account, account] : [account];
        const total = (this.#stmt(`SELECT COUNT(*) AS n FROM transactions WHERE ${ where }`)
            .get(...bound) as { n: number }).n;
        const rows = this.#stmt(`
            SELECT * FROM transactions WHERE ${ where }
            ORDER BY block_number DESC, tx_index DESC LIMIT ? OFFSET ?`)
            .all(...bound, limit, offset) as unknown as TransactionRow[];
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
    public transfersOfAddress(address: string, limit: number, offset: number): { rows: TransferRow[]; total: number }
    {
        const account = normalize(address);
        const total = (this.#stmt('SELECT COUNT(*) AS n FROM token_transfers WHERE from_addr = ? OR to_addr = ? OR token = ?')
            .get(account, account, account) as { n: number }).n;
        const rows = this.#stmt(`
            SELECT * FROM token_transfers WHERE from_addr = ? OR to_addr = ? OR token = ?
            ORDER BY block_number DESC, log_index DESC LIMIT ? OFFSET ?`)
            .all(account, account, account, limit, offset) as unknown as TransferRow[];
        return { rows, total };
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
    ): TransactionRow[]
    {
        const account = normalize(address);
        // The direction is interpolated, not bound: sqlite takes no parameter in ORDER BY, and the
        // value is a boolean from the caller, never a string off the query string.
        const direction = ascending ? 'ASC' : 'DESC';
        return this.#stmt(`
            SELECT * FROM transactions
            WHERE (from_addr = ? OR to_addr = ?) AND block_number >= ? AND block_number <= ?
            ORDER BY block_number ${ direction }, tx_index ${ direction } LIMIT ? OFFSET ?`)
            .all(account, account, fromBlock, toBlock, limit, offset) as unknown as TransactionRow[];
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
    ): TransferRow[]
    {
        const account = normalize(address);
        const direction = ascending ? 'ASC' : 'DESC';
        const narrowed = contract === null ? '' : 'AND token = ?';
        const bindings: Array<string | number> = [account, account, fromBlock, toBlock];
        if (contract !== null)
        {
            bindings.push(normalize(contract));
        }
        return this.#stmt(`
            SELECT * FROM token_transfers
            WHERE (from_addr = ? OR to_addr = ?) AND block_number >= ? AND block_number <= ? ${ narrowed }
            ORDER BY block_number ${ direction }, log_index ${ direction } LIMIT ? OFFSET ?`)
            .all(...bindings, limit, offset) as unknown as TransferRow[];
    }

    /**
     * The transaction that DEPLOYED this contract - who put it there, and when.
     *
     * The chain does not answer this either: a receipt names the contract it created, but nothing
     * maps a contract back to its receipt. It is here for the same reason address history is -
     * the row was written down as the chain was read.
     */
    public contractCreation(address: string): TransactionRow | null
    {
        return (this.#stmt('SELECT * FROM transactions WHERE contract_address = ? LIMIT 1')
            .get(normalize(address)) as TransactionRow | undefined) ?? null;
    }

    /**
     * One page of the token transfers a transaction emitted, in LOG order.
     *
     * Ascending, unlike every other list here: within one transaction the log index is the order
     * the contract emitted them in, and a distributor's receipt read backwards is a different
     * story from the one that happened.
     */
    public transfersOfTransaction(hash: string, limit: number, offset: number): { rows: TransferRow[]; total: number }
    {
        const key = hash.toLowerCase();
        const total = (this.#stmt('SELECT COUNT(*) AS n FROM token_transfers WHERE tx_hash = ?')
            .get(key) as { n: number }).n;
        const rows = this.#stmt('SELECT * FROM token_transfers WHERE tx_hash = ? ORDER BY log_index ASC LIMIT ? OFFSET ?')
            .all(key, limit, offset) as unknown as TransferRow[];
        return { rows, total };
    }

    /** Native value in and out of an address, in wei - the flow ledger's totals. */
    public flowOfAddress(address: string): { in: string; out: string; fees: string }
    {
        const account = normalize(address);
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
    }

    /**
     * Every address the index has seen, deduplicated - the candidate set for the rich list.
     *
     * JSON-RPC has no "who holds the most" call, so a top-accounts list ranks the addresses that
     * have appeared on-chain and reads each balance live against the node.
     */
    public distinctAddresses(): string[]
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
    public statsDaily(from: number, to: number): DailyStats[]
    {
        const days = new Map<number, DailyStats>();
        const at = (day: number): DailyStats =>
        {
            let row = days.get(day);
            if (row === undefined)
            {
                row = {
                    day, blocks: 0, transactions: 0, transfers: 0, contracts: 0,
                    activeAddresses: 0, newAddresses: 0, gasUsed: 0, gasLimit: 0,
                    blockSize: 0, blockTime: 0, gasPrice: '0', fees: '0'
                };
                days.set(day, row);
            }
            return row;
        };

        // The mean interval is (last - first) / (blocks - 1) rather than an average of per-block
        // differences: inside one day those differences telescope, so this is the same number
        // without a window function or a second pass.
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

        // The gas price is a MEAN, rounded to the wei on the way out - a statistic about a day,
        // never a figure anybody is owed.
        // The mean price comes back as TEXT, not as an integer. node:sqlite hands an INTEGER column
        // to JS as a number and THROWS above 2^53 - which is 0.009 native in wei, a gas price a
        // congested chain reaches - so a column that can hold wei must cross as text.
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
    }

    /** The same figures over one arbitrary window - what a headline tile compares against. */
    public statsWindow(from: number, to: number): WindowStats
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
    }

    /** Everything the index holds, counted - the cumulative half of the overview. */
    public totals(): TotalStats
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
    }

    public token(address: string): TokenRow | null
    {
        return (this.#stmt('SELECT * FROM tokens WHERE address = ?').get(normalize(address)) as TokenRow | undefined) ?? null;
    }

    public tokens(): TokenRow[]
    {
        return this.#stmt('SELECT * FROM tokens ORDER BY symbol ASC').all() as unknown as TokenRow[];
    }

    // ----------------------------------------------------------------------------------
    // Governance
    // ----------------------------------------------------------------------------------

    /** Whether this governor has been described already. Answered from memory after the first miss. */
    public knownGovernor(address: string): boolean
    {
        const account = normalize(address);
        if (this.#knownGovernors.has(account))
        {
            return true;
        }
        if (this.#stmt('SELECT 1 FROM governors WHERE address = ?').get(account) === undefined)
        {
            return false;
        }
        this.#knownGovernors.add(account);
        return true;
    }

    public upsertGovernor(row: GovernorRow): void
    {
        this.#stmt(`
            INSERT INTO governors (address, name, token, counting_mode, clock, first_block)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT (address) DO UPDATE SET name = excluded.name, token = excluded.token,
                counting_mode = excluded.counting_mode, clock = excluded.clock`)
            .run(row.address, row.name, row.token, row.counting_mode, row.clock, row.first_block);
        this.#knownGovernors.add(normalize(row.address));
    }

    /** A proposal, written once. A replay of the same block must not overwrite its later marks. */
    public insertProposal(row: ProposalRow): void
    {
        this.#stmt(`
            INSERT INTO proposals (governor, proposal_id, proposer, description, targets, call_values,
                signatures, calldatas, vote_start, vote_end, quorum, created_block, created_tx, timestamp)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (governor, proposal_id) DO NOTHING`)
            .run(row.governor, row.proposal_id, row.proposer, row.description, row.targets, row.call_values,
                row.signatures, row.calldatas, row.vote_start, row.vote_end, row.quorum, row.created_block,
                row.created_tx, row.timestamp);
    }

    /**
     * A later state, written onto the proposal it belongs to.
     *
     * Nothing is inserted when the proposal is not there: an execution whose creation is below
     * START_BLOCK has no row to mark, and inventing a proposal from its execution would print one
     * with no proposer, no description and no votes.
     */
    public markProposal(mark: ProposalMark): void
    {
        const column = mark.kind;
        const eta = mark.kind === 'queued' ? ', queued_eta = ?' : '';
        const parameters: Array<string | number | null> = [mark.block, mark.tx_hash];
        if (mark.kind === 'queued')
        {
            parameters.push(mark.eta);
        }
        this.#stmt(`
            UPDATE proposals SET ${ column }_block = ?, ${ column }_tx = ?${ eta }
            WHERE governor = ? AND proposal_id = ?`)
            .run(...parameters, mark.governor, mark.proposal_id);
    }

    public insertVote(row: VoteRow): void
    {
        this.#stmt(`
            INSERT INTO votes (tx_hash, log_index, governor, proposal_id, voter, support, weight, reason, block_number, timestamp)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (tx_hash, log_index) DO NOTHING`)
            .run(row.tx_hash, row.log_index, row.governor, row.proposal_id, row.voter, row.support,
                row.weight, row.reason, row.block_number, row.timestamp);
    }

    /**
     * One proposal's tally, summed again from its votes.
     *
     * In JS and not in SQL: a vote's weight is a uint256, and `SUM` over a TEXT column is a
     * double - which is exactly the rounding this whole file exists to avoid. A proposal's votes
     * are counted in tens, so the scan costs nothing and the answer is exact.
     */
    public retally(governor: string, proposalId: string): void
    {
        const rows = this.#stmt('SELECT voter, support, weight FROM votes WHERE governor = ? AND proposal_id = ?')
            .all(normalize(governor), proposalId) as unknown as Array<{ voter: string; support: number; weight: string }>;

        const total = [0n, 0n, 0n];
        const voters = new Set<string>();
        for (const row of rows)
        {
            voters.add(row.voter);
            const at = row.support;
            if (at === 0 || at === 1 || at === 2)
            {
                total[at] += BigInt(row.weight);
            }
        }

        this.#stmt(`
            UPDATE proposals SET against_votes = ?, for_votes = ?, abstain_votes = ?, voters = ?
            WHERE governor = ? AND proposal_id = ?`)
            .run(total[0]!.toString(), total[1]!.toString(), total[2]!.toString(), voters.size,
                normalize(governor), proposalId);
    }

    public governors(): GovernorRow[]
    {
        return this.#stmt('SELECT * FROM governors ORDER BY first_block ASC').all() as unknown as GovernorRow[];
    }

    public governor(address: string): GovernorRow | null
    {
        return (this.#stmt('SELECT * FROM governors WHERE address = ?')
            .get(normalize(address)) as GovernorRow | undefined) ?? null;
    }

    /**
     * Every proposal, newest first - the whole list, not a page of it.
     *
     * The one list in this file that is NOT paged in sqlite, because the thing a reader narrows
     * it by is the one column it does not have: a proposal's state is decided by the governor's
     * clock against the head, and by a tally against a quorum. Both are derived. Governance is
     * also the lowest-volume thing on a chain - hundreds of rows where transactions are millions
     * - so the whole table is cheaper to hand up than a second, wrong, stored status column.
     */
    public proposals(governor?: string): ProposalRow[]
    {
        return governor === undefined
            ? this.#stmt('SELECT * FROM proposals ORDER BY created_block DESC, proposal_id DESC').all() as unknown as ProposalRow[]
            : this.#stmt('SELECT * FROM proposals WHERE governor = ? ORDER BY created_block DESC, proposal_id DESC')
                .all(normalize(governor)) as unknown as ProposalRow[];
    }

    public proposal(governor: string, proposalId: string): ProposalRow | null
    {
        return (this.#stmt('SELECT * FROM proposals WHERE governor = ? AND proposal_id = ?')
            .get(normalize(governor), proposalId) as ProposalRow | undefined) ?? null;
    }

    public votesOfProposal(governor: string, proposalId: string, limit: number, offset: number): { rows: VoteRow[]; total: number }
    {
        const key = normalize(governor);
        const total = (this.#stmt('SELECT COUNT(*) AS n FROM votes WHERE governor = ? AND proposal_id = ?')
            .get(key, proposalId) as { n: number }).n;
        const rows = this.#stmt(`
            SELECT * FROM votes WHERE governor = ? AND proposal_id = ?
            ORDER BY block_number DESC, log_index DESC LIMIT ? OFFSET ?`)
            .all(key, proposalId, limit, offset) as unknown as VoteRow[];
        return { rows, total };
    }

    /** Every vote an address has cast, newest first - the governance half of an address page. */
    public votesOfAddress(address: string, limit: number, offset: number): { rows: VoteRow[]; total: number }
    {
        const account = normalize(address);
        const total = (this.#stmt('SELECT COUNT(*) AS n FROM votes WHERE voter = ?').get(account) as { n: number }).n;
        const rows = this.#stmt('SELECT * FROM votes WHERE voter = ? ORDER BY block_number DESC, log_index DESC LIMIT ? OFFSET ?')
            .all(account, limit, offset) as unknown as VoteRow[];
        return { rows, total };
    }
}
