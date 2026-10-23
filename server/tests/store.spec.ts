// @vitest-environment node
//
// The index itself, against a real database rather than a mock of one. Every test gets a fresh
// index from the harness (tests/support/database.ts), closed after it, so the cases are isolated by
// construction and nothing survives into the next one - there is no cleanup step to forget.
//
// The behaviours worth pinning here are the ones a reader would never see failing directly: rows
// written twice by a retry, a rollback that leaves half a block behind, an ordering that quietly
// depends on insertion order, and the address queries this whole file exists to make possible.
import { describe, it, expect } from 'vitest';
import { DataSource } from 'typeorm';

import { dataSourceOptions } from '../src/chain/data-source.ts';
import { normalize, type BlockRow, type TransactionRow, type TransferRow } from '../src/chain/rows.ts';
import type { IndexStore } from '../src/chain/store.ts';
import { inspect, openTestStore, reopen, schemaOf, testDatabase } from './support/database.ts';
import { ALICE, BOB, CAROL, MINER, TOKEN, ZERO } from './support/fixtures.ts';

function store(): Promise<IndexStore>
{
    return openTestStore();
}

/** One block and its rows, written as a batch of one - the way every case here fills an index. */
function write(index: IndexStore, block: BlockRow, transactions: TransactionRow[], transfers: TransferRow[]): Promise<void>
{
    return index.insertBlocks([{ block, transactions, transfers }]);
}

function blockRow(number: number, overrides: Partial<BlockRow> = {}): BlockRow
{
    return {
        number,
        hash: `0xb${ number }`,
        parent_hash: `0xb${ number - 1 }`,
        timestamp: 1_700_000_000 + number * 3,
        miner: MINER,
        gas_used: '21000',
        gas_limit: '30000000',
        base_fee: '1000000000',
        size: 500,
        tx_count: 1,
        ...overrides
    };
}

function txRow(hash: string, number: number, overrides: Partial<TransactionRow> = {}): TransactionRow
{
    return {
        hash,
        block_number: number,
        tx_index: 0,
        from_addr: ALICE,
        to_addr: BOB,
        value: '1000000000000000000',
        nonce: 0,
        input_size: 0,
        gas_used: '21000',
        effective_gas_price: '1000000000',
        status: 1,
        contract_address: null,
        timestamp: 1_700_000_000 + number * 3,
        ...overrides
    };
}

function transferRow(txHash: string, logIndex: number, number: number, overrides: Partial<TransferRow> = {}): TransferRow
{
    return {
        tx_hash: txHash,
        log_index: logIndex,
        block_number: number,
        token: TOKEN,
        from_addr: ALICE,
        to_addr: BOB,
        value: '1000000000000000000',
        token_id: null,
        kind: 'erc20',
        timestamp: 1_700_000_000 + number * 3,
        ...overrides
    };
}

/** A promise the test resolves by hand, for holding a transaction open across a check. */
function gate(): { opened: Promise<void>; open: () => void }
{
    let open = (): void => undefined;
    const opened = new Promise<void>((resolve) =>
    {
        open = resolve;
    });
    return { opened, open };
}

describe('normalize', () =>
{
    it('lower-cases, so a checksummed address never misses a row', () =>
    {
        expect(normalize(ALICE.toUpperCase().replace('0X', '0x'))).toBe(ALICE);
        expect(normalize(ALICE)).toBe(ALICE);
    });
});

describe('meta and the cursor', () =>
{
    it('reads back what it wrote, and null for a key it has never seen', async () =>
    {
        const index = await store();
        expect(await index.getMeta('nothing')).toBeNull();
        await index.setMeta('key', 'value');
        expect(await index.getMeta('key')).toBe('value');
    });

    it('overwrites rather than duplicating a key', async () =>
    {
        const index = await store();
        await index.setMeta('key', 'first');
        await index.setMeta('key', 'second');
        expect(await index.getMeta('key')).toBe('second');
    });

    it('reports startBlock-1 while the index is empty, so the first sync starts AT startBlock', async () =>
    {
        const index = await store();
        expect(await index.cursor(0)).toBe(-1);
        expect(await index.cursor(500)).toBe(499);
        await index.setCursor(7);
        expect(await index.cursor(0)).toBe(7);
    });

    it('stores an empty string as an empty string, not as absent', async () =>
    {
        const index = await store();
        await index.setMeta('key', '');
        expect(await index.getMeta('key')).toBe('');
    });
});

describe('ensureChain - the stale-index guard', () =>
{
    it('accepts a first genesis without wiping anything', async () =>
    {
        const index = await store();
        expect(await index.ensureChain('0xgenesis')).toBe(false);
        expect(await index.getMeta('genesis')).toBe('0xgenesis');
    });

    it('is idempotent for the same chain', async () =>
    {
        const index = await store();
        await index.ensureChain('0xgenesis');
        await write(index, blockRow(0), [txRow('0xt0', 0)], []);
        await index.setCursor(0);

        expect(await index.ensureChain('0xgenesis')).toBe(false);
        expect((await index.stats()).blocks).toBe(1);
        expect(await index.cursor(0)).toBe(0);
    });

    it('wipes every table and the cursor when the chain is a different one', async () =>
    {
        const index = await store();
        await index.ensureChain('0xgenesis');
        await write(index, blockRow(0), [txRow('0xt0', 0)], [transferRow('0xt0', 0, 0)]);
        await index.upsertTokens([{ address: TOKEN, name: 'Token', symbol: 'TKN', decimals: 18, kind: 'erc20' }]);
        await index.setCursor(0);

        expect(await index.ensureChain('0xdifferent')).toBe(true);

        const stats = await index.stats();
        expect(stats.blocks).toBe(0);
        expect(stats.transactions).toBe(0);
        expect(stats.transfers).toBe(0);
        expect((await index.totals()).tokens).toBe(0);
        // The cursor is dropped too, or the next sync resumes past history it no longer has.
        expect(await index.cursor(0)).toBe(-1);
        expect(await index.getMeta('genesis')).toBe('0xdifferent');
    });

    it('forgets every token along with the table', async () =>
    {
        // A token the index still claimed to know after a wipe would never be described again:
        // the indexer asks which tokens are unknown, and a row-less "known" answer skips it.
        const index = await store();
        await index.ensureChain('0xgenesis');
        await index.upsertTokens([{ address: TOKEN, name: 'Token', symbol: 'TKN', decimals: 18, kind: 'erc20' }]);
        expect(await index.unknownTokens([TOKEN])).toEqual(new Set());

        await index.ensureChain('0xdifferent');
        expect(await index.unknownTokens([TOKEN])).toEqual(new Set([TOKEN]));
    });
});

describe('insertBlocks', () =>
{
    it('writes a block with its transactions and transfers', async () =>
    {
        const index = await store();
        await write(index, blockRow(1), [txRow('0xt1', 1)], [transferRow('0xt1', 0, 1)]);

        expect(await index.blockByNumber(1)).toMatchObject({ number: 1, hash: '0xb1' });
        expect(await index.transactionByHash('0xt1')).toMatchObject({ hash: '0xt1', block_number: 1 });
        expect((await index.transfersOfTransaction('0xt1', 10, 0)).rows).toHaveLength(1);
    });

    it('is idempotent: replaying the same block does not duplicate a row', async () =>
    {
        // The indexer re-reads from its cursor after a crash, so blocks arrive twice as a matter
        // of course. A duplicated transaction would double every total on the page.
        const index = await store();
        for (let attempt = 0; attempt < 3; attempt++)
        {
            await write(index, blockRow(1), [txRow('0xt1', 1)], [transferRow('0xt1', 0, 1)]);
        }
        const stats = await index.stats();
        expect(stats.blocks).toBe(1);
        expect(stats.transactions).toBe(1);
        expect(stats.transfers).toBe(1);
    });

    it('updates a block\'s hash in place when the same height is re-indexed', async () =>
    {
        const index = await store();
        await write(index, blockRow(1, { hash: '0xold' }), [], []);
        await write(index, blockRow(1, { hash: '0xnew', parent_hash: '0xnewparent' }), [], []);

        const found = await index.blockByNumber(1);
        expect(found?.hash).toBe('0xnew');
        expect(found?.parent_hash).toBe('0xnewparent');
        expect((await index.stats()).blocks).toBe(1);
    });

    it('keeps two transfers of the same transaction apart by log index', async () =>
    {
        const index = await store();
        await write(index, blockRow(1), [txRow('0xt1', 1)], [
            transferRow('0xt1', 0, 1),
            transferRow('0xt1', 1, 1, { to_addr: CAROL })
        ]);
        expect((await index.transfersOfTransaction('0xt1', 10, 0)).rows).toHaveLength(2);
    });

    it('accepts a block with no transactions at all', async () =>
    {
        const index = await store();
        await write(index, blockRow(1, { tx_count: 0 }), [], []);
        expect((await index.blockByNumber(1))?.tx_count).toBe(0);
        expect((await index.stats()).transactions).toBe(0);
    });

    it('keeps a null to_addr - a contract deployment has no recipient', async () =>
    {
        const index = await store();
        await write(index, blockRow(1), [txRow('0xt1', 1, { to_addr: null, contract_address: CAROL })], []);
        const row = await index.transactionByHash('0xt1');
        expect(row?.to_addr).toBeNull();
        expect(row?.contract_address).toBe(CAROL);
    });

    it('keeps a null base fee - a pre-1559 chain has none', async () =>
    {
        const index = await store();
        await write(index, blockRow(1, { base_fee: null }), [], []);
        expect((await index.blockByNumber(1))?.base_fee).toBeNull();
    });

    it('stores a full uint256 value without losing a digit', async () =>
    {
        const max = ((1n << 256n) - 1n).toString();
        const index = await store();
        await write(index, blockRow(1), [txRow('0xt1', 1, { value: max })], []);
        expect((await index.transactionByHash('0xt1'))?.value).toBe(max);
    });
});

describe('transactions and rollback', () =>
{
    it('commits everything inside one transaction', async () =>
    {
        const index = await store();
        await index.transaction(async () =>
        {
            await write(index, blockRow(1), [txRow('0xt1', 1)], []);
            await write(index, blockRow(2), [txRow('0xt2', 2)], []);
        });
        expect((await index.stats()).blocks).toBe(2);
    });

    it('rolls the WHOLE batch back when the work throws', async () =>
    {
        const index = await store();
        await write(index, blockRow(0), [], []);

        await expect(index.transaction(async () =>
        {
            await write(index, blockRow(1), [txRow('0xt1', 1)], []);
            await index.setCursor(1);
            throw new Error('the node dropped the next batch');
        })).rejects.toThrow('the node dropped');

        // Block 1 and the cursor move together or not at all: a cursor past a block that was
        // never written makes the indexer skip it forever.
        expect(await index.blockByNumber(1)).toBeNull();
        expect(await index.cursor(0)).toBe(-1);
        expect((await index.stats()).blocks).toBe(1);
    });

    it('leaves the store usable after a rollback', async () =>
    {
        const index = await store();
        await expect(index.transaction(async () =>
        {
            throw new Error('boom');
        })).rejects.toThrow();
        await write(index, blockRow(1), [], []);
        expect((await index.stats()).blocks).toBe(1);
    });

    it('joins an outer transaction rather than opening a second one', async () =>
    {
        // A nested BEGIN either fails outright or opens a second, independent transaction that
        // commits on its own - and the batch is meant to commit or vanish as ONE.
        const index = await store();
        const result = await index.transaction(async () =>
            index.transaction(async () =>
            {
                await write(index, blockRow(1), [], []);
                return 'inner';
            }));
        expect(result).toBe('inner');
        expect((await index.stats()).blocks).toBe(1);
    });

    it('rolls a nested batch back with its outer one', async () =>
    {
        const index = await store();
        await expect(index.transaction(async () =>
        {
            await index.transaction(async () => write(index, blockRow(1), [], []));
            throw new Error('outer failed');
        })).rejects.toThrow();
        expect((await index.stats()).blocks).toBe(0);
    });

    it('returns the work\'s own value', async () =>
    {
        const index = await store();
        expect(await index.transaction(async () => 42)).toBe(42);
    });
});

describe('the transaction contract', () =>
{
    it('refuses a call that outlives its transaction, so nothing lands after the outcome', async () =>
    {
        // A timer started inside the work carries the transaction's frame with it. Once the work
        // has settled, a call made under that frame would otherwise run on its own - here, moving
        // the cursor past a batch that was rolled back, which the indexer would never re-read.
        const index = await store();
        let late: Promise<void> = Promise.resolve();
        await expect(index.transaction(async () =>
        {
            late = new Promise<void>((resolve, reject) =>
            {
                setTimeout(() =>
                {
                    index.setCursor(5).then(resolve, reject);
                }, 10);
            });
            throw new Error('the batch failed');
        })).rejects.toThrow('the batch failed');

        await expect(late).rejects.toThrow(/outlived/);
        expect(await index.cursor(0)).toBe(-1);
    });

    it('refuses, on a strict store, a query made outside the transaction it has open', async () =>
    {
        // A caller that is alone can only reach the store outside its own transaction by mistake.
        // Refused, the mistake names itself; queued, it would wait on the very transaction it is
        // part of.
        const index = await store();
        const begun = gate();
        const held = gate();
        const open = index.transaction(async () =>
        {
            begun.open();
            await held.opened;
        });
        await begun.opened;

        await expect(index.stats()).rejects.toThrow(/outside the transaction/);
        held.open();
        await open;
    });

    it('sees, inside a transaction, every write made earlier in it', async () =>
    {
        const index = await store();
        await index.transaction(async () =>
        {
            await write(index, blockRow(1), [txRow('0xt1', 1)], [transferRow('0xt1', 0, 1)]);
            await index.upsertTokens([{ address: TOKEN, name: 'Token', symbol: 'TKN', decimals: 18, kind: 'erc20' }]);
            await index.setCursor(1);

            expect((await index.blockByNumber(1))?.hash).toBe('0xb1');
            expect(await index.blockHash(1)).toBe('0xb1');
            expect(await index.head()).toBe(1);
            expect((await index.stats()).transactions).toBe(1);
            expect((await index.transactionByHash('0xt1'))?.block_number).toBe(1);
            expect((await index.transfersOfTransaction('0xt1', 10, 0)).total).toBe(1);
            expect(await index.token(TOKEN)).not.toBeNull();
            expect(await index.cursor(0)).toBe(1);
        });
    });

    it('refuses a write inside a read-only snapshot, and hands back the snapshot\'s answer', async () =>
    {
        const index = await store();
        await write(index, blockRow(1), [], []);

        expect(await index.snapshot(async () => (await index.stats()).blocks)).toBe(1);
        await expect(index.snapshot(async () => index.setCursor(9))).rejects.toThrow(/read-only/);
        // Joining a transaction from inside one is a write all the same.
        await expect(index.snapshot(async () => index.transaction(async () => 1))).rejects.toThrow(/read-only/);
        expect(await index.cursor(0)).toBe(-1);
    });

    it('closes once, and refuses every call after it', async () =>
    {
        const index = await store();
        await index.close();
        await index.close();
        await expect(index.stats()).rejects.toThrow(/closed/);
        await expect(index.transaction(async () => 1)).rejects.toThrow(/closed/);
    });

    it('answers a height no row can carry as a miss rather than handing it to the database', async () =>
    {
        const index = await store();
        await write(index, blockRow(1), [txRow('0xt1', 1)], []);
        for (const height of [1.5, Number.NaN, -1, 2 ** 60])
        {
            expect(await index.blockByNumber(height), String(height)).toBeNull();
            expect(await index.blockHash(height), String(height)).toBeNull();
            expect(await index.transactionsOfBlock(height, 25, 0), String(height)).toEqual({ rows: [], total: 0 });
        }
    });

    it('answers text with a NUL byte in it as a miss', async () =>
    {
        // No hash, address or name in the index contains one, and a database may refuse to bind it.
        const nul = '\u0000';
        const index = await store();
        await write(index, blockRow(1), [txRow('0xt1', 1)], [transferRow('0xt1', 0, 1)]);

        expect(await index.transactionByHash(nul)).toBeNull();
        expect(await index.blockByHash(nul)).toBeNull();
        expect(await index.token(nul)).toBeNull();
        expect(await index.contractCreation(nul)).toBeNull();
        expect(await index.transactionsOfAddress(nul, 10, 0)).toEqual({ rows: [], total: 0 });
        expect(await index.transfersOfAddress(nul, 10, 0)).toEqual({ rows: [], total: 0 });
        expect(await index.transfersOfTransaction(nul, 10, 0)).toEqual({ rows: [], total: 0 });
        expect(await index.flowOfAddress(nul)).toEqual({ in: '0', out: '0', fees: '0' });
        expect(await index.addressTransactionsInRange(nul, 0, 99, 10, 0, true)).toEqual([]);
        expect(await index.addressTransfersInRange(ALICE, 0, 99, 10, 0, true, nul)).toEqual([]);
    });

    it('reads a page\'s worth of heights, transactions and tokens as sets', async () =>
    {
        const index = await store();
        await write(index, blockRow(1), [txRow('0xt1', 1)], []);
        await write(index, blockRow(2), [txRow('0xt2', 2)], []);
        await index.upsertTokens([{ address: TOKEN, name: 'Token', symbol: 'TKN', decimals: 18, kind: 'erc20' }]);

        expect(await index.head()).toBe(2);
        expect(await index.blockHashes([2, 1, 2, 99])).toEqual(new Map([[2, '0xb2'], [1, '0xb1']]));

        const parents = await index.transactionsByHash(['0xT1', '0xt2', '0xnope']);
        expect([...parents.keys()].sort()).toEqual(['0xt1', '0xt2']);
        expect(parents.get('0xt1')?.block_number).toBe(1);

        const tokens = await index.tokensOf([TOKEN.toUpperCase().replace('0X', '0x'), CAROL]);
        expect([...tokens.keys()]).toEqual([TOKEN]);

        // Case-insensitive and de-duplicated, as the indexer hands it every token of a batch.
        expect(await index.unknownTokens([TOKEN, CAROL, CAROL.toUpperCase().replace('0X', '0x')])).toEqual(new Set([CAROL]));
        expect(await index.unknownTokens([])).toEqual(new Set());
    });

    it('reports a zero head for an empty index', async () =>
    {
        expect(await (await store()).head()).toBe(0);
    });

    it('writes a batch as ONE unit: a bad block leaves the good one before it absent too', async () =>
    {
        const index = await store();
        await expect(index.insertBlocks([
            { block: blockRow(1), transactions: [txRow('0xt1', 1)], transfers: [] },
            // A NOT NULL column without a value - the kind of row a decoding bug would hand over.
            { block: blockRow(2, { hash: null as unknown as string }), transactions: [], transfers: [] }
        ])).rejects.toThrow();

        expect(await index.blockByNumber(1)).toBeNull();
        expect(await index.transactionByHash('0xt1')).toBeNull();
    });

    it('keeps one row per key within a batch, as a row-at-a-time write would have', async () =>
    {
        // The same height twice keeps the LAST description of it (an upsert); the same transaction
        // twice keeps the FIRST (a write that ignores a row it already has).
        const index = await store();
        await index.insertBlocks([
            { block: blockRow(1, { hash: '0xfirst' }), transactions: [txRow('0xt1', 1, { value: '1' })], transfers: [] },
            { block: blockRow(1, { hash: '0xsecond' }), transactions: [txRow('0xt1', 1, { value: '2' })], transfers: [] }
        ]);

        expect((await index.blockByNumber(1))?.hash).toBe('0xsecond');
        expect((await index.transactionByHash('0xt1'))?.value).toBe('1');
        expect(await index.stats()).toMatchObject({ blocks: 1, transactions: 1 });
    });
});

describe('rollbackFrom - the reorg half', () =>
{
    it('drops blocks, transactions and transfers at or above the height', async () =>
    {
        const index = await store();
        for (const number of [1, 2, 3])
        {
            await write(index, blockRow(number), [txRow(`0xt${ number }`, number)], [transferRow(`0xt${ number }`, 0, number)]);
        }

        await index.rollbackFrom(2);

        expect(await index.stats()).toMatchObject({ blocks: 1, transactions: 1, transfers: 1 });
        expect(await index.blockByNumber(1)).not.toBeNull();
        expect(await index.blockByNumber(2)).toBeNull();
        expect(await index.transactionByHash('0xt3')).toBeNull();
    });

    it('is inclusive of the height it is given', async () =>
    {
        const index = await store();
        await write(index, blockRow(5), [], []);
        await index.rollbackFrom(5);
        expect(await index.blockByNumber(5)).toBeNull();
    });

    it('does nothing when nothing is that high', async () =>
    {
        const index = await store();
        await write(index, blockRow(1), [], []);
        await index.rollbackFrom(99);
        expect((await index.stats()).blocks).toBe(1);
    });

    it('leaves tokens alone - a token contract survives a reorg of its transfers', async () =>
    {
        const index = await store();
        await index.upsertTokens([{ address: TOKEN, name: 'Token', symbol: 'TKN', decimals: 18, kind: 'erc20' }]);
        await write(index, blockRow(1), [txRow('0xt1', 1)], [transferRow('0xt1', 0, 1)]);
        await index.rollbackFrom(1);
        expect(await index.token(TOKEN)).not.toBeNull();
    });
});

describe('tokens', () =>
{
    it('upserts by address, replacing the description rather than duplicating it', async () =>
    {
        const index = await store();
        await index.upsertTokens([{ address: TOKEN, name: 'Old', symbol: 'OLD', decimals: 6, kind: 'erc20' }]);
        await index.upsertTokens([{ address: TOKEN, name: 'New', symbol: 'NEW', decimals: 18, kind: 'erc721' }]);

        expect((await index.totals()).tokens).toBe(1);
        expect(await index.token(TOKEN)).toMatchObject({ name: 'New', symbol: 'NEW', decimals: 18, kind: 'erc721' });
    });

    it('keeps the last description of an address one batch names twice', async () =>
    {
        // One multi-row upsert may not touch a row twice, so the batch is narrowed to one row per
        // address first - the one a row-at-a-time write would have left.
        const index = await store();
        await index.upsertTokens([
            { address: TOKEN, name: 'Old', symbol: 'OLD', decimals: 6, kind: 'erc20' },
            { address: TOKEN, name: 'New', symbol: 'NEW', decimals: 18, kind: 'erc721' }
        ]);

        expect((await index.totals()).tokens).toBe(1);
        expect(await index.token(TOKEN)).toMatchObject({ name: 'New', symbol: 'NEW' });
    });

    it('finds a token whatever case it is asked for', async () =>
    {
        const index = await store();
        await index.upsertTokens([{ address: TOKEN, name: 'T', symbol: 'T', decimals: 18, kind: 'erc20' }]);
        expect(await index.token(TOKEN.toUpperCase().replace('0X', '0x'))).not.toBeNull();
    });

    it('answers null for a contract it has never described', async () =>
    {
        expect(await (await store()).token(CAROL)).toBeNull();
    });

    it('keeps an unnamed token, because it still moved value', async () =>
    {
        const index = await store();
        await index.upsertTokens([{ address: TOKEN, name: '', symbol: '', decimals: 0, kind: 'erc20' }]);
        expect(await index.token(TOKEN)).toMatchObject({ name: '', symbol: '', decimals: 0 });
    });

    it('knows a token once it is described, whatever case it is asked in, and honestly before', async () =>
    {
        const index = await store();
        expect(await index.unknownTokens([TOKEN])).toEqual(new Set([TOKEN]));
        await index.upsertTokens([{ address: TOKEN, name: 'T', symbol: 'T', decimals: 18, kind: 'erc20' }]);
        expect(await index.unknownTokens([TOKEN, TOKEN.toUpperCase().replace('0X', '0x')])).toEqual(new Set());
    });
});

describe('reads: ordering, paging and filtering', () =>
{
    /** Three blocks, two transactions each, written out of order on purpose. */
    async function filled(): Promise<IndexStore>
    {
        const index = await store();
        for (const number of [2, 0, 1])
        {
            await write(
                index,
                blockRow(number, { tx_count: 2 }),
                [
                    txRow(`0x${ number }a`, number, { tx_index: 0 }),
                    txRow(`0x${ number }b`, number, { tx_index: 1, from_addr: BOB, to_addr: CAROL })
                ],
                []);
        }
        return index;
    }

    it('orders blocks newest first regardless of insertion order', async () =>
    {
        expect((await (await filled()).blocksPage(10, 0)).rows.map((row) => row.number)).toEqual([2, 1, 0]);
    });

    it('orders transactions newest block first, then by index descending', async () =>
    {
        const rows = (await (await filled()).transactionsPage(10, 0)).rows;
        expect(rows.map((row) => `${ row.block_number }.${ row.tx_index }`))
            .toEqual(['2.1', '2.0', '1.1', '1.0', '0.1', '0.0']);
    });

    it('orders a block\'s own transactions in EXECUTION order, ascending', async () =>
    {
        // The other way round to the global list, and deliberately: within a block the index is
        // the order the chain ran them in.
        const rows = (await (await filled()).transactionsOfBlock(1, 10, 0)).rows;
        expect(rows.map((row) => row.tx_index)).toEqual([0, 1]);
    });

    it('reports the total independently of the page', async () =>
    {
        const index = await filled();
        const page = await index.transactionsPage(2, 0);
        expect(page.rows).toHaveLength(2);
        expect(page.total).toBe(6);
    });

    it('pages without losing or repeating a row', async () =>
    {
        const index = await filled();
        const seen: string[] = [];
        for (let offset = 0; offset < 6; offset += 2)
        {
            seen.push(...(await index.transactionsPage(2, offset)).rows.map((row) => row.hash));
        }
        expect(new Set(seen).size).toBe(6);
    });

    it('answers an offset past the end with no rows and an honest total', async () =>
    {
        const page = await (await filled()).transactionsPage(10, 500);
        expect(page.rows).toEqual([]);
        expect(page.total).toBe(6);
    });

    it('answers a zero limit with no rows rather than every row', async () =>
    {
        expect((await (await filled()).blocksPage(0, 0)).rows).toEqual([]);
    });

    /** One block holding each outcome the index can record, including the one it cannot decide. */
    async function mixed(): Promise<IndexStore>
    {
        const index = await store();
        await write(
            index,
            blockRow(1, { tx_count: 4 }),
            [
                txRow('0xok1', 1, { tx_index: 0, status: 1 }),
                txRow('0xbad', 1, { tx_index: 1, status: 0 }),
                txRow('0xok2', 1, { tx_index: 2, status: 1 }),
                txRow('0xhuh', 1, { tx_index: 3, status: -1 })
            ],
            []);
        return index;
    }

    it('returns every transaction when the filter is off', async () =>
    {
        expect((await (await mixed()).transactionsPage(10, 0, 'all')).total).toBe(4);
    });

    it('defaults to no filter, so an old caller keeps the answer it had', async () =>
    {
        expect((await (await mixed()).transactionsPage(10, 0)).total).toBe(4);
    });

    it('narrows to the successful transactions', async () =>
    {
        const page = await (await mixed()).transactionsPage(10, 0, 'success');
        expect(page.rows.map((row) => row.hash)).toEqual(['0xok2', '0xok1']);
        expect(page.total).toBe(2);
    });

    it('narrows to the reverted transactions', async () =>
    {
        const page = await (await mixed()).transactionsPage(10, 0, 'reverted');
        expect(page.rows.map((row) => row.hash)).toEqual(['0xbad']);
        expect(page.total).toBe(1);
    });

    it('leaves an undecided transaction out of BOTH narrowings', async () =>
    {
        // status -1 is "the node returned no receipt", not "the chain said no". Handing it to a
        // reader who asked for reverted transactions would report a failure that never happened.
        const index = await mixed();
        const seen = [
            ...(await index.transactionsPage(10, 0, 'success')).rows,
            ...(await index.transactionsPage(10, 0, 'reverted')).rows
        ].map((row) => row.hash);
        expect(seen).not.toContain('0xhuh');
        expect((await index.transactionsPage(10, 0, 'all')).rows.map((row) => row.hash)).toContain('0xhuh');
    });

    it('counts the narrowed set, not the table, so the pager draws the right number of pages', async () =>
    {
        // A total taken from the whole table would page a filtered list into pages that are empty.
        const page = await (await mixed()).transactionsPage(1, 0, 'success');
        expect(page.rows).toHaveLength(1);
        expect(page.total).toBe(2);
    });

    it('keeps ordering and paging under a filter', async () =>
    {
        const index = await mixed();
        expect((await index.transactionsPage(1, 1, 'success')).rows.map((row) => row.hash)).toEqual(['0xok1']);
    });

    /** A chain where most blocks carried nothing - what a quiet chain's block list looks like. */
    async function quiet(): Promise<IndexStore>
    {
        const index = await store();
        for (const number of [0, 1, 2, 3])
        {
            const carries = number === 1 || number === 3;
            await write(
                index,
                blockRow(number, { tx_count: carries ? 1 : 0 }),
                carries ? [txRow(`0x${ number }a`, number)] : [],
                []);
        }
        return index;
    }

    it('narrows the block list to the blocks that carried something', async () =>
    {
        const page = await (await quiet()).blocksPage(10, 0, 'filled');
        expect(page.rows.map((row) => row.number)).toEqual([3, 1]);
        expect(page.total).toBe(2);
    });

    it('defaults to every block, so an old caller keeps the answer it had', async () =>
    {
        expect((await (await quiet()).blocksPage(10, 0)).rows.map((row) => row.number)).toEqual([3, 2, 1, 0]);
        expect((await (await quiet()).blocksPage(10, 0, 'all')).total).toBe(4);
    });

    it('counts and pages the narrowed set of blocks', async () =>
    {
        const index = await quiet();
        const first = await index.blocksPage(1, 0, 'filled');
        expect(first.rows.map((row) => row.number)).toEqual([3]);
        expect(first.total).toBe(2);
        expect((await index.blocksPage(1, 1, 'filled')).rows.map((row) => row.number)).toEqual([1]);
    });

    it('finds a block by hash, case-insensitively, and null for an unknown one', async () =>
    {
        const index = await filled();
        expect((await index.blockByHash('0xb1'))?.number).toBe(1);
        expect((await index.blockByHash('0xB1'))?.number).toBe(1);
        expect(await index.blockByHash('0xnope')).toBeNull();
    });

    it('finds a transaction by hash, case-insensitively, and null for an unknown one', async () =>
    {
        const index = await filled();
        expect((await index.transactionByHash('0x1A'))?.block_number).toBe(1);
        expect(await index.transactionByHash('0xdeadbeef')).toBeNull();
    });

    it('reports the head and the head time from the highest block', async () =>
    {
        const stats = await (await filled()).stats();
        expect(stats.head).toBe(2);
        expect(stats.headTime).toBe(1_700_000_000 + 2 * 3);
    });

    it('reports a zero head for an empty index rather than null', async () =>
    {
        const stats = await (await store()).stats();
        expect(stats).toMatchObject({ blocks: 0, transactions: 0, transfers: 0, head: 0, headTime: 0 });
    });

    it('reads recent blocks newest first, capped at the window', async () =>
    {
        const index = await filled();
        expect((await index.recentBlocks(2)).map((row) => row.number)).toEqual([2, 1]);
        expect(await index.recentBlocks(100)).toHaveLength(3);
    });
});

describe('the address queries this index exists for', () =>
{
    async function withHistory(): Promise<IndexStore>
    {
        const index = await store();
        await write(index, blockRow(1), [
            txRow('0xt1', 1, { from_addr: ALICE, to_addr: BOB }),
            txRow('0xt2', 1, { tx_index: 1, from_addr: BOB, to_addr: ALICE, value: '5' })
        ], []);
        await write(index, blockRow(2), [
            txRow('0xt3', 2, { from_addr: CAROL, to_addr: CAROL })
        ], []);
        return index;
    }

    it('finds every transaction touching an address, in either direction', async () =>
    {
        const page = await (await withHistory()).transactionsOfAddress(ALICE, 10, 0);
        expect(page.total).toBe(2);
        expect(page.rows.map((row) => row.hash).sort()).toEqual(['0xt1', '0xt2']);
    });

    it('counts a self-send once, not twice', async () =>
    {
        // `from = ? OR to = ?` is one row either way; a UNION would have doubled it.
        const page = await (await withHistory()).transactionsOfAddress(CAROL, 10, 0);
        expect(page.total).toBe(1);
        expect(page.rows).toHaveLength(1);
    });

    it('matches an address whatever case it is asked for', async () =>
    {
        const page = await (await withHistory()).transactionsOfAddress(ALICE.toUpperCase().replace('0X', '0x'), 10, 0);
        expect(page.total).toBe(2);
    });

    it('answers an address it has never seen with an empty page, not an error', async () =>
    {
        const page = await (await withHistory()).transactionsOfAddress(ZERO, 10, 0);
        expect(page).toEqual({ rows: [], total: 0 });
    });

    it('narrows an address history to what ARRIVED', async () =>
    {
        const page = await (await withHistory()).transactionsOfAddress(ALICE, 10, 0, 'in');
        expect(page.rows.map((row) => row.hash)).toEqual(['0xt2']);
        expect(page.total).toBe(1);
    });

    it('narrows an address history to what LEFT', async () =>
    {
        const page = await (await withHistory()).transactionsOfAddress(ALICE, 10, 0, 'out');
        expect(page.rows.map((row) => row.hash)).toEqual(['0xt1']);
        expect(page.total).toBe(1);
    });

    it('defaults to both directions, so an old caller keeps the answer it had', async () =>
    {
        expect((await (await withHistory()).transactionsOfAddress(ALICE, 10, 0)).total).toBe(2);
        expect((await (await withHistory()).transactionsOfAddress(ALICE, 10, 0, 'all')).total).toBe(2);
    });

    it('shows a self-send under BOTH narrowings, because it really was both', async () =>
    {
        const index = await withHistory();
        expect((await index.transactionsOfAddress(CAROL, 10, 0, 'in')).total).toBe(1);
        expect((await index.transactionsOfAddress(CAROL, 10, 0, 'out')).total).toBe(1);
        // Still once with no narrowing - the OR must not double it.
        expect((await index.transactionsOfAddress(CAROL, 10, 0, 'all')).total).toBe(1);
    });

    it('matches a narrowed address whatever case it is asked for', async () =>
    {
        const shouted = ALICE.toUpperCase().replace('0X', '0x');
        expect((await (await withHistory()).transactionsOfAddress(shouted, 10, 0, 'out')).total).toBe(1);
    });

    it('pages the transfers one transaction emitted, in log order, oldest log first', async () =>
    {
        // Ascending, unlike every other list here: within one transaction the log index IS the
        // order the contract emitted them in. An airdrop read backwards is a different story.
        const index = await store();
        await write(index, blockRow(1), [txRow('0xt1', 1)], [
            transferRow('0xt1', 0, 1),
            transferRow('0xt1', 1, 1, { to_addr: CAROL }),
            transferRow('0xt1', 2, 1, { to_addr: MINER })
        ]);

        const first = await index.transfersOfTransaction('0xt1', 2, 0);
        expect(first.rows.map((row) => row.log_index)).toEqual([0, 1]);
        // The total is every log the transaction emitted, so the pager knows how far it runs.
        expect(first.total).toBe(3);

        const second = await index.transfersOfTransaction('0xt1', 2, 2);
        expect(second.rows.map((row) => row.log_index)).toEqual([2]);
        expect(second.total).toBe(3);
    });

    it('answers a transaction that emitted nothing with an empty page, not an error', async () =>
    {
        const index = await store();
        await write(index, blockRow(1), [txRow('0xt1', 1)], []);
        expect(await index.transfersOfTransaction('0xt1', 10, 0)).toEqual({ rows: [], total: 0 });
    });

    it('finds a token\'s transfers on the TOKEN\'s own page', async () =>
    {
        // A token contract is never a PARTY to its own transfers; keyed on from/to alone its page
        // was empty while the index held every transfer it had ever emitted.
        const index = await store();
        await write(index, blockRow(1), [txRow('0xt1', 1)], [transferRow('0xt1', 0, 1)]);
        expect((await index.transfersOfAddress(TOKEN, 10, 0)).total).toBe(1);
        expect((await index.transfersOfAddress(ALICE, 10, 0)).total).toBe(1);
        expect((await index.transfersOfAddress(BOB, 10, 0)).total).toBe(1);
    });

    it('counts a transfer once even when the token is also a party to it', async () =>
    {
        const index = await store();
        await write(index, blockRow(1), [txRow('0xt1', 1)], [transferRow('0xt1', 0, 1, { from_addr: TOKEN })]);
        expect((await index.transfersOfAddress(TOKEN, 10, 0)).total).toBe(1);
    });

    it('finds the transaction that deployed a contract', async () =>
    {
        const index = await store();
        await write(index, blockRow(1), [txRow('0xt1', 1, { to_addr: null, contract_address: CAROL })], []);
        expect((await index.contractCreation(CAROL))?.hash).toBe('0xt1');
        expect((await index.contractCreation(CAROL.toUpperCase().replace('0X', '0x')))?.hash).toBe('0xt1');
        expect(await index.contractCreation(BOB)).toBeNull();
    });
});

describe('flowOfAddress', () =>
{
    it('sums value in and out, and fees only on what the address SENT', async () =>
    {
        const index = await store();
        await write(index, blockRow(1), [
            txRow('0xin', 1, { from_addr: BOB, to_addr: ALICE, value: '100', gas_used: '21000', effective_gas_price: '1' }),
            txRow('0xout', 1, { tx_index: 1, from_addr: ALICE, to_addr: BOB, value: '30', gas_used: '21000', effective_gas_price: '2' })
        ], []);

        const flow = await index.flowOfAddress(ALICE);
        expect(flow.in).toBe('100');
        expect(flow.out).toBe('30');
        // Only the outgoing transaction's fee - the sender pays.
        expect(flow.fees).toBe(String(21000 * 2));
    });

    it('ignores a reverted transaction, whose value never moved', async () =>
    {
        const index = await store();
        await write(index, blockRow(1), [txRow('0xt1', 1, { value: '999', status: 0 })], []);
        expect(await index.flowOfAddress(ALICE)).toEqual({ in: '0', out: '0', fees: '0' });
    });

    it('counts a self-send on BOTH sides, because the address really did each', async () =>
    {
        const index = await store();
        await write(index, blockRow(1), [txRow('0xt1', 1, { from_addr: ALICE, to_addr: ALICE, value: '7' })], []);
        const flow = await index.flowOfAddress(ALICE);
        expect(flow.in).toBe('7');
        expect(flow.out).toBe('7');
    });

    it('sums through bigint, so a total past 2^53 stays exact', async () =>
    {
        const big = (10n ** 30n).toString();
        const index = await store();
        await write(index, blockRow(1), [
            txRow('0xa', 1, { from_addr: BOB, to_addr: ALICE, value: big }),
            txRow('0xb', 1, { tx_index: 1, from_addr: BOB, to_addr: ALICE, value: big })
        ], []);
        expect((await index.flowOfAddress(ALICE)).in).toBe((10n ** 30n * 2n).toString());
    });

    it('answers zeroes for an address with no history', async () =>
    {
        expect(await (await store()).flowOfAddress(ZERO)).toEqual({ in: '0', out: '0', fees: '0' });
    });
});

describe('distinctAddresses - the rich list candidates', () =>
{
    it('gathers every side of every row, deduplicated', async () =>
    {
        const index = await store();
        await write(index, blockRow(1), [txRow('0xt1', 1)], [transferRow('0xt1', 0, 1, { to_addr: CAROL })]);

        const addresses = await index.distinctAddresses();
        expect(new Set(addresses)).toEqual(new Set([ALICE, BOB, CAROL, MINER, TOKEN]));
        expect(addresses.length).toBe(new Set(addresses).size);
    });

    it('excludes the zero address, which nothing can be spent from', async () =>
    {
        const index = await store();
        await write(index, blockRow(1), [txRow('0xt1', 1, { from_addr: ZERO, to_addr: ALICE })], []);
        expect(await index.distinctAddresses()).not.toContain(ZERO);
    });

    it('drops the null recipient of a deployment rather than listing it', async () =>
    {
        const index = await store();
        await write(index, blockRow(1), [txRow('0xt1', 1, { to_addr: null, contract_address: CAROL })], []);
        expect(await index.distinctAddresses()).not.toContain(null);
    });
});

describe('the Etherscan-shaped range queries', () =>
{
    async function ranged(): Promise<IndexStore>
    {
        const index = await store();
        for (const number of [1, 2, 3])
        {
            await write(
                index,
                blockRow(number),
                [txRow(`0xt${ number }`, number)],
                [transferRow(`0xt${ number }`, 0, number, { kind: number === 3 ? 'erc721' : 'erc20' })]);
        }
        return index;
    }

    it('narrows transactions to an inclusive block range', async () =>
    {
        const rows = await (await ranged()).addressTransactionsInRange(ALICE, 2, 3, 100, 0, true);
        expect(rows.map((row) => row.block_number)).toEqual([2, 3]);
    });

    it('sorts in the direction it is asked for', async () =>
    {
        const index = await ranged();
        expect((await index.addressTransactionsInRange(ALICE, 0, 99, 100, 0, true)).map((row) => row.block_number)).toEqual([1, 2, 3]);
        expect((await index.addressTransactionsInRange(ALICE, 0, 99, 100, 0, false)).map((row) => row.block_number)).toEqual([3, 2, 1]);
    });

    it('applies limit and offset within the range', async () =>
    {
        const rows = await (await ranged()).addressTransactionsInRange(ALICE, 0, 99, 1, 1, true);
        expect(rows.map((row) => row.block_number)).toEqual([2]);
    });

    it('answers an empty range with no rows', async () =>
    {
        expect(await (await ranged()).addressTransactionsInRange(ALICE, 50, 60, 100, 0, true)).toEqual([]);
        // An inverted range is empty, not an error.
        expect(await (await ranged()).addressTransactionsInRange(ALICE, 3, 1, 100, 0, true)).toEqual([]);
    });

    it('narrows transfers to one token contract, and to all of them when told none', async () =>
    {
        const index = await ranged();
        expect(await index.addressTransfersInRange(ALICE, 0, 99, 100, 0, true, null)).toHaveLength(3);
        expect(await index.addressTransfersInRange(ALICE, 0, 99, 100, 0, true, TOKEN)).toHaveLength(3);
        expect(await index.addressTransfersInRange(ALICE, 0, 99, 100, 0, true, CAROL)).toHaveLength(0);
    });

    it('matches the contract filter case-insensitively', async () =>
    {
        const index = await ranged();
        const upper = TOKEN.toUpperCase().replace('0X', '0x');
        expect(await index.addressTransfersInRange(ALICE, 0, 99, 100, 0, true, upper)).toHaveLength(3);
    });

    it('does NOT take the sort direction from caller text', async () =>
    {
        // The direction is interpolated into ORDER BY because SQL takes no parameter for one.
        // It is a boolean at the type level, and this pins that it stays one.
        const index = await ranged();
        const rows = await index.addressTransactionsInRange(ALICE, 0, 99, 100, 0, Boolean('anything'));
        expect(rows).toHaveLength(3);
    });
});

describe('the daily aggregates the charts are drawn from', () =>
{
    /** A day index turned back into the second it starts, so a test can place a row inside it. */
    const DAY = 86_400;
    const MONDAY = 19_700 * DAY;

    /** Two days of chain: three blocks with four transactions on the first, one on the next. */
    async function fortnight(): Promise<IndexStore>
    {
        const index = await store();
        await write(
            index,
            blockRow(1, { timestamp: MONDAY + 10, tx_count: 2, size: 400 }),
            [
                txRow('0xa1', 1, { timestamp: MONDAY + 10 }),
                txRow('0xa2', 1, { tx_index: 1, timestamp: MONDAY + 10, from_addr: BOB, to_addr: CAROL })
            ],
            [transferRow('0xa1', 0, 1, { timestamp: MONDAY + 10 })]);
        await write(
            index,
            blockRow(2, { timestamp: MONDAY + 16, tx_count: 1, size: 600 }),
            [txRow('0xa3', 2, { timestamp: MONDAY + 16, contract_address: TOKEN })],
            []);
        await write(
            index,
            blockRow(3, { timestamp: MONDAY + DAY + 5, tx_count: 1, size: 500 }),
            [txRow('0xb1', 3, { timestamp: MONDAY + DAY + 5, from_addr: MINER, to_addr: ALICE })],
            []);
        return index;
    }

    it('buckets a chain into UTC days', async () =>
    {
        const rows = await (await fortnight()).statsDaily(0, MONDAY + 3 * DAY);
        expect(rows.map((row) => row.day)).toEqual([19_700, 19_701]);
        expect(rows[0]!.blocks).toBe(2);
        expect(rows[0]!.transactions).toBe(3);
        expect(rows[0]!.transfers).toBe(1);
        expect(rows[1]!.blocks).toBe(1);
        expect(rows[1]!.transactions).toBe(1);
    });

    it('returns NO row for a day nothing happened, rather than inventing a zero', async () =>
    {
        // A day the indexer has not reached and a day the chain was silent are different facts,
        // and only the caller knows which one it is looking at.
        const rows = await (await fortnight()).statsDaily(0, MONDAY + 9 * DAY);
        expect(rows).toHaveLength(2);
    });

    it('honours the window at both ends', async () =>
    {
        const rows = await (await fortnight()).statsDaily(MONDAY + DAY, MONDAY + 2 * DAY);
        expect(rows.map((row) => row.day)).toEqual([19_701]);
    });

    it('reads the mean interval between a day\'s blocks', async () =>
    {
        // Two blocks six seconds apart is one interval of six, not an average over two blocks.
        const rows = await (await fortnight()).statsDaily(0, MONDAY + 3 * DAY);
        expect(rows[0]!.blockTime).toBe(6);
        // A day with one block has no interval to report, and 0 says so.
        expect(rows[1]!.blockTime).toBe(0);
    });

    it('averages block size and sums the gas of a day', async () =>
    {
        const rows = await (await fortnight()).statsDaily(0, MONDAY + 3 * DAY);
        expect(rows[0]!.blockSize).toBe(500);
        expect(rows[0]!.gasUsed).toBe(42_000);
        expect(rows[0]!.gasLimit).toBe(60_000_000);
    });

    it('counts an address once a day however many times it moved', async () =>
    {
        // Alice sends twice on Monday and Bob is both a recipient and a sender: three addresses
        // were active, not five.
        const rows = await (await fortnight()).statsDaily(0, MONDAY + 3 * DAY);
        expect(rows[0]!.activeAddresses).toBe(3);
    });

    it('counts an address as new only on the day it FIRST appeared', async () =>
    {
        const rows = await (await fortnight()).statsDaily(0, MONDAY + 3 * DAY);
        // Monday introduces Alice, Bob and Carol.
        expect(rows[0]!.newAddresses).toBe(3);
        // Tuesday introduces only the miner - Alice was already here.
        expect(rows[1]!.newAddresses).toBe(1);
    });

    it('counts the contract deployments of a day', async () =>
    {
        const rows = await (await fortnight()).statsDaily(0, MONDAY + 3 * DAY);
        expect(rows[0]!.contracts).toBe(1);
        expect(rows[1]!.contracts).toBe(0);
    });

    it('sums a day of fees EXACTLY, where a double would not', async () =>
    {
        // 21000 gas at 0.123456789012345678 native is 2.59e21 wei per transaction. A double holds
        // integers exactly only to 9e15, so a SUM() through one returns a number that is merely
        // close - and an explorer that reports fees which are merely close has misreported them.
        const price = '123456789012345678';
        const index = await store();
        await write(index, blockRow(1, { timestamp: MONDAY + 10, tx_count: 2 }), [
            txRow('0xf1', 1, { timestamp: MONDAY + 10, gas_used: '21000', effective_gas_price: price }),
            txRow('0xf2', 1, { tx_index: 1, timestamp: MONDAY + 10, gas_used: '21000', effective_gas_price: price })
        ], []);

        const rows = await index.statsDaily(0, MONDAY + DAY);
        expect(rows[0]!.fees).toBe((21_000n * BigInt(price) * 2n).toString());
        // And the figure really is beyond what a double carries, so the case is not vacuous:
        // pushed through one and back, it returns as a different number.
        expect(BigInt(Number(rows[0]!.fees)).toString()).not.toBe(rows[0]!.fees);
    });

    it('reports the mean gas price of a day, rounded to the wei', async () =>
    {
        const index = await store();
        await write(index, blockRow(1, { timestamp: MONDAY + 10, tx_count: 2 }), [
            txRow('0xg1', 1, { timestamp: MONDAY + 10, effective_gas_price: '1000000000' }),
            txRow('0xg2', 1, { tx_index: 1, timestamp: MONDAY + 10, effective_gas_price: '3000000000' })
        ], []);
        expect((await index.statsDaily(0, MONDAY + DAY))[0]!.gasPrice).toBe('2000000000');
    });

    it('answers an empty index with no days at all', async () =>
    {
        expect(await (await store()).statsDaily(0, MONDAY + DAY)).toEqual([]);
    });
});

describe('the window figures behind the headline tiles', () =>
{
    const DAY = 86_400;
    const MONDAY = 19_700 * DAY;

    async function busy(): Promise<IndexStore>
    {
        const index = await store();
        await write(
            index,
            blockRow(1, { timestamp: MONDAY + 10, tx_count: 2 }),
            [
                txRow('0xa1', 1, { timestamp: MONDAY + 10 }),
                txRow('0xa2', 1, { tx_index: 1, timestamp: MONDAY + 10, contract_address: TOKEN })
            ],
            [transferRow('0xa1', 0, 1, { timestamp: MONDAY + 10 })]);
        await write(
            index,
            blockRow(2, { timestamp: MONDAY + 40, tx_count: 1 }),
            [txRow('0xa3', 2, { timestamp: MONDAY + 40, from_addr: CAROL, to_addr: MINER })],
            []);
        return index;
    }

    it('counts everything inside the window and nothing outside it', async () =>
    {
        const window = await (await busy()).statsWindow(MONDAY, MONDAY + DAY);
        expect(window.blocks).toBe(2);
        expect(window.transactions).toBe(3);
        expect(window.transfers).toBe(1);
        expect(window.contracts).toBe(1);
        expect(window.activeAddresses).toBe(4);
        expect(window.newAddresses).toBe(4);
        // Gas is a count of units, summed across the window's blocks, and crosses as a number.
        expect(window.gasUsed).toBe(42_000);
        expect(window.gasLimit).toBe(60_000_000);
        expect(window.blockTime).toBe(30);

        const empty = await (await busy()).statsWindow(MONDAY + DAY, MONDAY + 2 * DAY);
        expect(empty.blocks).toBe(0);
        expect(empty.transactions).toBe(0);
        expect(empty.gasUsed).toBe(0);
    });

    it('reports the mean fee in wei, by integer division and not by a double', async () =>
    {
        const price = '123456789012345678';
        const index = await store();
        await write(index, blockRow(1, { timestamp: MONDAY + 10, tx_count: 2 }), [
            txRow('0xf1', 1, { timestamp: MONDAY + 10, gas_used: '21000', effective_gas_price: price }),
            txRow('0xf2', 1, { tx_index: 1, timestamp: MONDAY + 10, gas_used: '63000', effective_gas_price: price })
        ], []);

        const window = await index.statsWindow(MONDAY, MONDAY + DAY);
        const total = 21_000n * BigInt(price) + 63_000n * BigInt(price);
        expect(window.fees).toBe(total.toString());
        expect(window.averageFee).toBe((total / 2n).toString());
    });

    it('says zero rather than dividing by no transactions at all', async () =>
    {
        const window = await (await store()).statsWindow(MONDAY, MONDAY + DAY);
        expect(window).toMatchObject({ fees: '0', averageFee: '0', blockTime: 0 });
    });
});

describe('the cumulative totals', () =>
{
    it('counts every table, and every address the chain has shown', async () =>
    {
        const index = await store();
        await write(index, blockRow(1), [txRow('0xt1', 1), txRow('0xt2', 1, { tx_index: 1, contract_address: TOKEN })],
            [transferRow('0xt1', 0, 1)]);
        await index.upsertTokens([{ address: TOKEN, name: 'Token', symbol: 'TKN', decimals: 18, kind: 'erc20' }]);

        const totals = await index.totals();
        expect(totals).toMatchObject({ blocks: 1, transactions: 2, transfers: 1, tokens: 1, contracts: 1 });
        // Alice, Bob, the miner and the token contract - and never the zero address.
        expect(totals.addresses).toBe(4);
    });

    it('answers an empty index with zeros rather than nulls', async () =>
    {
        expect(await (await store()).totals()).toEqual({
            blocks: 0, transactions: 0, transfers: 0, addresses: 0, tokens: 0, contracts: 0
        });
    });
});

describe('the migration', () =>
{
    it('builds the schema once: a store opened over it again migrates nothing and keeps every row', async () =>
    {
        // What a restart is. Were the migration to run twice, its CREATE TABLE would fail the boot;
        // were the tables dropped and rebuilt, the index would forget a backfill on every deploy.
        const index = await store();
        await index.ensureChain('0xgenesis');
        await write(index, blockRow(1), [txRow('0xt1', 1)], []);
        await index.setCursor(1);

        const restarted = await reopen(index);
        expect((await restarted.stats()).blocks).toBe(1);
        expect(await restarted.cursor(0)).toBe(1);
        expect(await restarted.getMeta('genesis')).toBe('0xgenesis');

        const ran = await inspect<{ name: string }>(`SELECT name FROM "${ schemaOf(index) }"."migrations" ORDER BY id`);
        expect(ran.map((row) => row.name)).toEqual(['InitialIndex1792713600000']);
    });

    it('describes to TypeORM exactly the tables the migration built', async () =>
    {
        // The entities are what the insert builder writes through, and the migration is what made
        // the tables. If the two drift - a column renamed in one and not the other, a type that no
        // longer matches - TypeORM's own schema builder sees it, and this is where it says so.
        const index = await store();
        const source = new DataSource(dataSourceOptions({ url: testDatabase(), schema: schemaOf(index), poolSize: 1 }));
        await source.initialize();
        try
        {
            const pending = await source.driver.createSchemaBuilder().log();
            expect(pending.upQueries.map((query) => query.query)).toEqual([]);
        }
        finally
        {
            await source.destroy();
        }
    });
});

describe('concurrent access', () =>
{
    // Several callers against ONE store at once, on purpose - so these open it non-strict: a strict
    // store refuses a caller who arrives while another's transaction is open, rather than queueing.

    it('serialises interleaved writes without losing one', async () =>
    {
        // The indexer's writes interleave with request-time reads through the event loop, and
        // each write is its own transaction: this pins that the rows all arrive.
        const index = await openTestStore({ strict: false });
        await Promise.all(Array.from({ length: 25 }, async (_entry, number) =>
        {
            await Promise.resolve();
            await write(index, blockRow(number), [txRow(`0xt${ number }`, number)], []);
        }));
        expect((await index.stats()).blocks).toBe(25);
        expect((await index.stats()).transactions).toBe(25);
    });

    it('never shows a read half of a write that is landing', async () =>
    {
        // Every block is written with exactly one transaction, in one unit, and every count is one
        // statement - so at no instant can a reader see a block without its transaction. A reader
        // that ever did would see blocks and transactions disagree.
        const index = await openTestStore({ strict: false });
        const writes = Array.from({ length: 20 }, async (_entry, number) =>
        {
            await Promise.resolve();
            await write(index, blockRow(number), [txRow(`0xt${ number }`, number)], []);
        });
        const reads = Array.from({ length: 20 }, async () =>
        {
            await Promise.resolve();
            return index.stats();
        });

        const [, seen] = await Promise.all([Promise.all(writes), Promise.all(reads)]);
        for (const stats of seen)
        {
            expect(stats.transactions).toBe(stats.blocks);
        }
        expect((await index.stats()).blocks).toBe(20);
    });

    it('shows a read beside an open write only what was committed', async () =>
    {
        // The follower's batch and a request's read run on different connections, each in its
        // own transaction. Until the batch commits, a reader must see the index as it was - never
        // the half of a batch that happens to have been written so far.
        const index = await openTestStore({ strict: false });
        await write(index, blockRow(0), [], []);
        const written = gate();
        const held = gate();
        const batch = index.transaction(async () =>
        {
            await write(index, blockRow(1), [txRow('0xt1', 1)], []);
            written.open();
            await held.opened;
        });
        await written.opened;

        expect(await index.stats()).toMatchObject({ blocks: 1, transactions: 0 });
        expect(await index.transactionByHash('0xt1')).toBeNull();

        held.open();
        await batch;
        expect(await index.stats()).toMatchObject({ blocks: 2, transactions: 1 });
    });

    it('keeps a failed batch from leaving half a block behind under interleaving', async () =>
    {
        const index = await openTestStore({ strict: false });
        await write(index, blockRow(0), [], []);

        const attempts = [1, 2, 3].map(async (number) =>
        {
            await Promise.resolve();
            try
            {
                await index.transaction(async () =>
                {
                    await write(index, blockRow(number), [txRow(`0xt${ number }`, number)], []);
                    if (number === 2)
                    {
                        throw new Error('batch 2 failed');
                    }
                });
            }
            catch
            {
                // Expected for one of them.
            }
        });
        await Promise.all(attempts);

        // Whatever the interleaving, the failed batch is gone entirely - block AND transaction -
        // and the two that succeeded are there entirely.
        expect(await index.blockByNumber(2)).toBeNull();
        expect(await index.transactionByHash('0xt2')).toBeNull();
        for (const number of [1, 3])
        {
            expect(await index.blockByNumber(number)).not.toBeNull();
            expect(await index.transactionByHash(`0xt${ number }`)).not.toBeNull();
        }
    });
});
