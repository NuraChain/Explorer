import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

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
CREATE TABLE IF NOT EXISTS address_flow (
    address TEXT PRIMARY KEY,
    in_flow TEXT NOT NULL,
    out_flow TEXT NOT NULL,
    fees TEXT NOT NULL
);
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
            + 'DROP TABLE IF EXISTS address_flow;'
            + 'DROP TABLE IF EXISTS meta;');
        this.#db.exec(DDL);
        this.setMeta('schema', SCHEMA_VERSION);
        // A rebuilt schema starts with no flow ledger, so the marker that says it was already
        // rebuilt from `transactions` must not survive either.
        this.#clearFlowBuilt();
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

    /** Clears the marker that says `address_flow` has been rebuilt from `transactions`. */
    #clearFlowBuilt(): void
    {
        this.#stmt('DELETE FROM meta WHERE key = ?').run('flowBuilt');
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
            this.#db.exec('DELETE FROM blocks; DELETE FROM transactions; DELETE FROM token_transfers; DELETE FROM tokens; DELETE FROM address_flow;');
            this.#stmt('DELETE FROM meta WHERE key = ?').run('cursor');
            this.#clearFlowBuilt();
            this.#knownTokens.clear();
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
        this.#stmt('DELETE FROM blocks WHERE number >= ?').run(number);
        // The dropped transactions may have touched any address, so every aggregate row is now
        // suspect. Clear the ledger and let the next read rebuild it from what remains.
        this.#stmt('DELETE FROM address_flow').run();
        this.#clearFlowBuilt();
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

        // Native flow is maintained incrementally so no address ever forces a scan of its whole
        // history. Only successful transactions move value; reverted ones move nothing, and a
        // receipt the node never returned (status -1) is not success. One Map per block keeps the
        // working set bounded by the addresses this block touched.
        const flow = new Map<string, { in: bigint; out: bigint; fees: bigint }>();
        for (const row_ of transactions)
        {
            if (row_.status !== 1)
            {
                continue;
            }
            const value = BigInt(row_.value);
            const fee = BigInt(row_.gas_used) * BigInt(row_.effective_gas_price);
            if (row_.to_addr !== null)
            {
                const inbound = flow.get(row_.to_addr) ?? { in: 0n, out: 0n, fees: 0n };
                inbound.in += value;
                flow.set(row_.to_addr, inbound);
            }
            const outbound = flow.get(row_.from_addr) ?? { in: 0n, out: 0n, fees: 0n };
            outbound.out += value;
            outbound.fees += fee;
            flow.set(row_.from_addr, outbound);
        }
        this.#applyFlowDeltas(flow);

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

    /**
     * Merges one block's worth of flow deltas into `address_flow`, reading each touched
     * address's current row once and upserting the new total. All arithmetic is BigInt because
     * wei totals exceed sqlite's 64-bit integer range.
     */
    #applyFlowDeltas(deltas: ReadonlyMap<string, { in: bigint; out: bigint; fees: bigint }>): void
    {
        const read = this.#stmt('SELECT in_flow, out_flow, fees FROM address_flow WHERE address = ?');
        const upsert = this.#stmt(`
            INSERT INTO address_flow (address, in_flow, out_flow, fees) VALUES (?, ?, ?, ?)
            ON CONFLICT (address) DO UPDATE SET in_flow = excluded.in_flow,
                out_flow = excluded.out_flow, fees = excluded.fees`);
        for (const [address, delta] of deltas)
        {
            const current = read.get(address) as { in_flow: string; out_flow: string; fees: string } | undefined;
            const inbound = (current === undefined ? 0n : BigInt(current.in_flow)) + delta.in;
            const outbound = (current === undefined ? 0n : BigInt(current.out_flow)) + delta.out;
            const fees = (current === undefined ? 0n : BigInt(current.fees)) + delta.fees;
            upsert.run(address, inbound.toString(), outbound.toString(), fees.toString());
        }
    }

    /**
     * Rebuilds `address_flow` from every successful transaction, in bounded pages. This is NOT
     * a SQL SUM: wei values exceed sqlite's 64-bit integer range and TEXT->REAL would lose
     * precision, so the totals are BigInt-accumulated here. It runs only after a reorg or chain
     * switch clears the marker, never on every address read.
     */
    #rebuildFlow(): void
    {
        this.transaction(() =>
        {
            this.#stmt('DELETE FROM address_flow').run();
            const totals = new Map<string, { in: bigint; out: bigint; fees: bigint }>();
            const pageSize = 20_000;
            const page = this.#stmt(`
                SELECT from_addr, to_addr, value, gas_used, effective_gas_price, status
                FROM transactions WHERE status = 1 ORDER BY rowid LIMIT ? OFFSET ?`);
            let offset = 0;
            while (true)
            {
                const rows = page.all(pageSize, offset) as unknown as Array<Pick<TransactionRow,
                    'from_addr' | 'to_addr' | 'value' | 'gas_used' | 'effective_gas_price' | 'status'>>;
                if (rows.length === 0)
                {
                    break;
                }
                for (const row of rows)
                {
                    const value = BigInt(row.value);
                    if (row.to_addr !== null)
                    {
                        const inbound = totals.get(row.to_addr) ?? { in: 0n, out: 0n, fees: 0n };
                        inbound.in += value;
                        totals.set(row.to_addr, inbound);
                    }
                    const outbound = totals.get(row.from_addr) ?? { in: 0n, out: 0n, fees: 0n };
                    outbound.out += value;
                    outbound.fees += BigInt(row.gas_used) * BigInt(row.effective_gas_price);
                    totals.set(row.from_addr, outbound);
                }
                offset += rows.length;
            }
            this.#applyFlowDeltas(totals);
            this.setMeta('flowBuilt', '1');
        });
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

    public blocksPage(limit: number, offset: number): { rows: BlockRow[]; total: number }
    {
        const total = (this.#stmt('SELECT COUNT(*) AS n FROM blocks').get() as { n: number }).n;
        const rows = this.#stmt('SELECT * FROM blocks ORDER BY number DESC LIMIT ? OFFSET ?')
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

    public transactionsPage(limit: number, offset: number): { rows: TransactionRow[]; total: number }
    {
        const total = (this.#stmt('SELECT COUNT(*) AS n FROM transactions').get() as { n: number }).n;
        const rows = this.#stmt('SELECT * FROM transactions ORDER BY block_number DESC, tx_index DESC LIMIT ? OFFSET ?')
            .all(limit, offset) as unknown as TransactionRow[];
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
     */
    public transactionsOfAddress(address: string, limit: number, offset: number): { rows: TransactionRow[]; total: number }
    {
        const account = normalize(address);
        const total = (this.#stmt('SELECT COUNT(*) AS n FROM transactions WHERE from_addr = ? OR to_addr = ?')
            .get(account, account) as { n: number }).n;
        const rows = this.#stmt(`
            SELECT * FROM transactions WHERE from_addr = ? OR to_addr = ?
            ORDER BY block_number DESC, tx_index DESC LIMIT ? OFFSET ?`)
            .all(account, account, limit, offset) as unknown as TransactionRow[];
        return { rows, total };
    }

    public transfersOfAddress(address: string, limit: number, offset: number): { rows: TransferRow[]; total: number }
    {
        const account = normalize(address);
        const total = (this.#stmt('SELECT COUNT(*) AS n FROM token_transfers WHERE from_addr = ? OR to_addr = ?')
            .get(account, account) as { n: number }).n;
        const rows = this.#stmt(`
            SELECT * FROM token_transfers WHERE from_addr = ? OR to_addr = ?
            ORDER BY block_number DESC, log_index DESC LIMIT ? OFFSET ?`)
            .all(account, account, limit, offset) as unknown as TransferRow[];
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

    public transfersOfTransaction(hash: string): TransferRow[]
    {
        return this.#stmt('SELECT * FROM token_transfers WHERE tx_hash = ? ORDER BY log_index ASC')
            .all(hash.toLowerCase()) as unknown as TransferRow[];
    }

    /**
     * Native value in and out of an address, in wei - the flow ledger's totals.
     *
     * Read from `address_flow` rather than summed over `transactions`: wei values exceed
     * sqlite's 64-bit integer range and TEXT->REAL would lose precision, so the ledger is
     * maintained in BigInt during ingest and rebuilt from scratch after a reorg or chain switch.
     * A missing row is a legitimate zero - the address has no successful transactions.
     */
    public flowOfAddress(address: string): { in: string; out: string; fees: string }
    {
        const account = normalize(address);
        if (this.getMeta('flowBuilt') !== '1')
        {
            this.#rebuildFlow();
        }
        const row = this.#stmt('SELECT in_flow, out_flow, fees FROM address_flow WHERE address = ?')
            .get(account) as { in_flow: string; out_flow: string; fees: string } | undefined;
        return { in: row?.in_flow ?? '0', out: row?.out_flow ?? '0', fees: row?.fees ?? '0' };
    }

    public token(address: string): TokenRow | null
    {
        return (this.#stmt('SELECT * FROM tokens WHERE address = ?').get(normalize(address)) as TokenRow | undefined) ?? null;
    }

    public tokens(): TokenRow[]
    {
        return this.#stmt('SELECT * FROM tokens ORDER BY symbol ASC').all() as unknown as TokenRow[];
    }
}
