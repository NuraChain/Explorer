import { EntitySchema } from 'typeorm';

import type { BlockRow, TokenRow, TransactionRow, TransferRow } from './rows.ts';

// The index's tables, described to TypeORM.
//
// As EntitySchema objects rather than decorated classes: the server runs as `node src/main.ts`
// under Node's own type stripping, which refuses a decorator outright and never reads tsconfig, so
// there is no `emitDecoratorMetadata` to lean on either. The property names ARE the column names,
// so a row comes back in exactly the shape `rows.ts` declares and every presenter reads it as before.
//
// The tables themselves are made by the migration in ./migrations, which can say what TypeORM
// cannot - a DESC key, an INCLUDE list, a partial index. Every index it makes is named here with
// `synchronize: false`, so the schema TypeORM sees and the one the migration built cannot disagree
// without a test noticing (see store.spec.ts).

/** One key/value pair of the index's own bookkeeping: the genesis it was built from, the cursor. */
interface MetaRow
{
    key: string;
    value: string;
}

export const Meta = new EntitySchema<MetaRow>({
    name: 'Meta',
    tableName: 'meta',
    columns: {
        key: { type: 'text', primary: true },
        value: { type: 'text' }
    }
});

export const Block = new EntitySchema<BlockRow>({
    name: 'Block',
    tableName: 'blocks',
    columns: {
        number: { type: 'bigint', primary: true },
        hash: { type: 'text' },
        parent_hash: { type: 'text' },
        timestamp: { type: 'bigint' },
        miner: { type: 'text' },
        gas_used: { type: 'numeric' },
        gas_limit: { type: 'numeric' },
        base_fee: { type: 'numeric', nullable: true },
        size: { type: 'integer' },
        tx_count: { type: 'integer' }
    },
    indices: [
        { name: 'idx_blocks_daily', synchronize: false },
        { name: 'idx_blocks_miner', synchronize: false }
    ]
});

export const Transaction = new EntitySchema<TransactionRow>({
    name: 'Transaction',
    tableName: 'transactions',
    columns: {
        hash: { type: 'text', primary: true },
        block_number: { type: 'bigint' },
        tx_index: { type: 'integer' },
        from_addr: { type: 'text' },
        to_addr: { type: 'text', nullable: true },
        value: { type: 'numeric' },
        nonce: { type: 'bigint' },
        input_size: { type: 'integer' },
        gas_used: { type: 'numeric' },
        effective_gas_price: { type: 'numeric' },
        status: { type: 'integer' },
        contract_address: { type: 'text', nullable: true },
        timestamp: { type: 'bigint' }
    },
    indices: [
        { name: 'idx_tx_block', synchronize: false },
        { name: 'idx_tx_from', synchronize: false },
        { name: 'idx_tx_to', synchronize: false },
        { name: 'idx_tx_contract', synchronize: false }
    ]
});

export const Transfer = new EntitySchema<TransferRow>({
    name: 'Transfer',
    tableName: 'token_transfers',
    columns: {
        tx_hash: { type: 'text', primary: true },
        log_index: { type: 'integer', primary: true },
        block_number: { type: 'bigint' },
        token: { type: 'text' },
        from_addr: { type: 'text' },
        to_addr: { type: 'text' },
        value: { type: 'numeric' },
        token_id: { type: 'numeric', nullable: true },
        kind: { type: 'text' },
        timestamp: { type: 'bigint' }
    },
    indices: [
        { name: 'idx_transfer_from', synchronize: false },
        { name: 'idx_transfer_to', synchronize: false },
        { name: 'idx_transfer_token', synchronize: false }
    ]
});

export const Token = new EntitySchema<TokenRow>({
    name: 'Token',
    tableName: 'tokens',
    columns: {
        address: { type: 'text', primary: true },
        name: { type: 'text' },
        symbol: { type: 'text' },
        decimals: { type: 'bigint' },
        kind: { type: 'text' }
    }
});

/** Every table the index holds - explicit, never a glob, which TypeORM would resolve against the cwd. */
export const ENTITIES = [Meta, Block, Transaction, Transfer, Token];
