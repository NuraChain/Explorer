import type { DataSourceOptions, MigrationInterface, QueryRunner } from 'typeorm';

import { tablesIn } from '../tables.ts';

// The index's first schema, written as the PostgreSQL it is rather than generated: TypeORM cannot
// declare a DESC key, an INCLUDE list or a partial index, and those are the indexes this explorer
// exists for.
//
// Every row is DERIVED from the chain. A later change to these tables is a migration all the same,
// but it may simply truncate and reset the cursor - the indexer replays from START_BLOCK - where a
// table of anything else would have to carry its rows across.

/** The schema the runner's DataSource writes into: `public` unless its options name another. */
function schemaOf(runner: QueryRunner): string
{
    const options: DataSourceOptions = runner.dataSource.options;
    return options.type === 'postgres' && options.schema !== undefined ? options.schema : 'public';
}

export class InitialIndex1792713600000 implements MigrationInterface
{
    public readonly name = 'InitialIndex1792713600000';

    public async up(runner: QueryRunner): Promise<void>
    {
        const t = tablesIn(schemaOf(runner));
        // Wei and every uint256 are NUMERIC with no declared precision: exact at any size, and a
        // Transfer log's data is whatever its contract emitted - a cap would turn one odd token
        // into an ingest that fails the same batch forever. Heights and timestamps are BIGINT,
        // because a 4-byte timestamp ends in 2038.
        await runner.query(`
            CREATE TABLE ${ t.meta } (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );

            CREATE TABLE ${ t.blocks } (
                number BIGINT PRIMARY KEY,
                hash TEXT NOT NULL,
                parent_hash TEXT NOT NULL,
                timestamp BIGINT NOT NULL,
                miner TEXT NOT NULL,
                gas_used NUMERIC NOT NULL,
                gas_limit NUMERIC NOT NULL,
                base_fee NUMERIC,
                size INTEGER NOT NULL,
                tx_count INTEGER NOT NULL
            );
            -- The charts aggregation, which is the only query here whose cost grows with the whole
            -- chain. COVERING, and that is the entire point: a windowed rollup reads size and gas out
            -- of every block in the window - at three-second blocks a thirty-day window is ~864,000
            -- of them - and with the three columns carried in the index it never visits the table.
            -- It also serves every other timestamp seek on blocks.
            CREATE INDEX idx_blocks_daily ON ${ t.blocks } (timestamp) INCLUDE (size, gas_used, gas_limit);
            -- The distinct-address count unions every address column in the index, and miner is one
            -- per block: unindexed, it read a million rows to learn that a chain has two validators.
            CREATE INDEX idx_blocks_miner ON ${ t.blocks } (miner);

            CREATE TABLE ${ t.transactions } (
                hash TEXT PRIMARY KEY,
                block_number BIGINT NOT NULL,
                tx_index INTEGER NOT NULL,
                from_addr TEXT NOT NULL,
                to_addr TEXT,
                value NUMERIC NOT NULL,
                nonce BIGINT NOT NULL,
                input_size INTEGER NOT NULL,
                gas_used NUMERIC NOT NULL,
                effective_gas_price NUMERIC NOT NULL,
                status INTEGER NOT NULL,
                contract_address TEXT,
                timestamp BIGINT NOT NULL
            );
            CREATE INDEX idx_tx_block ON ${ t.transactions } (block_number, tx_index);
            -- The pair this whole index exists for: Ethereum JSON-RPC cannot answer "every transaction
            -- touching this address", and these two make it a seek.
            CREATE INDEX idx_tx_from ON ${ t.transactions } (from_addr, block_number DESC);
            CREATE INDEX idx_tx_to ON ${ t.transactions } (to_addr, block_number DESC);
            -- Partial: only a deployment fills contract_address, so the index carries one row per
            -- contract on the chain rather than one per transaction, and "who deployed this" stays a
            -- single seek.
            CREATE INDEX idx_tx_contract ON ${ t.transactions } (contract_address) WHERE contract_address IS NOT NULL;

            CREATE TABLE ${ t.transfers } (
                tx_hash TEXT NOT NULL,
                log_index INTEGER NOT NULL,
                block_number BIGINT NOT NULL,
                token TEXT NOT NULL,
                from_addr TEXT NOT NULL,
                to_addr TEXT NOT NULL,
                value NUMERIC NOT NULL,
                token_id NUMERIC,
                kind TEXT NOT NULL,
                timestamp BIGINT NOT NULL,
                PRIMARY KEY (tx_hash, log_index)
            );
            CREATE INDEX idx_transfer_from ON ${ t.transfers } (from_addr, block_number DESC);
            CREATE INDEX idx_transfer_to ON ${ t.transfers } (to_addr, block_number DESC);
            CREATE INDEX idx_transfer_token ON ${ t.transfers } (token, block_number DESC);

            CREATE TABLE ${ t.tokens } (
                address TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                symbol TEXT NOT NULL,
                decimals BIGINT NOT NULL,
                kind TEXT NOT NULL
            );`);
    }

    public async down(runner: QueryRunner): Promise<void>
    {
        const t = tablesIn(schemaOf(runner));
        await runner.query(`DROP TABLE ${ t.tokens }, ${ t.transfers }, ${ t.transactions }, ${ t.blocks }, ${ t.meta }`);
    }
}
