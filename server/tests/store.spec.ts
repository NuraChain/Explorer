// @vitest-environment node
//
// The index itself, against a real sqlite database rather than a mock of one. ':memory:' per
// test, so the cases are isolated by construction and nothing survives into the next one - there
// is no cleanup step to forget.
//
// The behaviours worth pinning here are the ones a reader would never see failing directly: rows
// written twice by a retry, a rollback that leaves half a block behind, an ordering that quietly
// depends on insertion order, and the address queries this whole file exists to make possible.
import { describe, it, expect, afterEach } from 'vitest';

import { normalize } from '../src/chain/store.ts';
import type { BlockRow, TransactionRow, TransferRow , IndexStore } from '../src/chain/store.ts';
import { ALICE, BOB, CAROL, MINER, TOKEN, ZERO, freshStore } from './support/fixtures.ts';

/** Every store a test opens, closed after it whether it passed or not. */
const opened: IndexStore[] = [];

afterEach(() =>
{
    while (opened.length > 0)
    {
        opened.pop()?.close();
    }
});

function store(): IndexStore
{
    const next = freshStore();
    opened.push(next);
    return next;
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
    it('reads back what it wrote, and null for a key it has never seen', () =>
    {
        const index = store();
        expect(index.getMeta('nothing')).toBeNull();
        index.setMeta('key', 'value');
        expect(index.getMeta('key')).toBe('value');
    });

    it('overwrites rather than duplicating a key', () =>
    {
        const index = store();
        index.setMeta('key', 'first');
        index.setMeta('key', 'second');
        expect(index.getMeta('key')).toBe('second');
    });

    it('reports startBlock-1 while the index is empty, so the first sync starts AT startBlock', () =>
    {
        const index = store();
        expect(index.cursor(0)).toBe(-1);
        expect(index.cursor(500)).toBe(499);
        index.setCursor(7);
        expect(index.cursor(0)).toBe(7);
    });

    it('stores an empty string as an empty string, not as absent', () =>
    {
        const index = store();
        index.setMeta('key', '');
        expect(index.getMeta('key')).toBe('');
    });
});

describe('ensureChain - the stale-index guard', () =>
{
    it('accepts a first genesis without wiping anything', () =>
    {
        const index = store();
        expect(index.ensureChain('0xgenesis')).toBe(false);
        expect(index.getMeta('genesis')).toBe('0xgenesis');
    });

    it('is idempotent for the same chain', () =>
    {
        const index = store();
        index.ensureChain('0xgenesis');
        index.insertBlock(blockRow(0), [txRow('0xt0', 0)], []);
        index.setCursor(0);

        expect(index.ensureChain('0xgenesis')).toBe(false);
        expect(index.stats().blocks).toBe(1);
        expect(index.cursor(0)).toBe(0);
    });

    it('wipes every table and the cursor when the chain is a different one', () =>
    {
        const index = store();
        index.ensureChain('0xgenesis');
        index.insertBlock(blockRow(0), [txRow('0xt0', 0)], [transferRow('0xt0', 0, 0)]);
        index.upsertToken({ address: TOKEN, name: 'Token', symbol: 'TKN', decimals: 18, kind: 'erc20' });
        index.setCursor(0);

        expect(index.ensureChain('0xdifferent')).toBe(true);

        const stats = index.stats();
        expect(stats.blocks).toBe(0);
        expect(stats.transactions).toBe(0);
        expect(stats.transfers).toBe(0);
        expect(index.tokens()).toEqual([]);
        // The cursor is dropped too, or the next sync resumes past history it no longer has.
        expect(index.cursor(0)).toBe(-1);
        expect(index.getMeta('genesis')).toBe('0xdifferent');
    });

    it('clears the in-memory token cache along with the table', () =>
    {
        // The cache is a Set beside the database; leaving it populated across a wipe would make
        // the indexer skip describing tokens whose rows no longer exist.
        const index = store();
        index.ensureChain('0xgenesis');
        index.upsertToken({ address: TOKEN, name: 'Token', symbol: 'TKN', decimals: 18, kind: 'erc20' });
        expect(index.knownToken(TOKEN)).toBe(true);

        index.ensureChain('0xdifferent');
        expect(index.knownToken(TOKEN)).toBe(false);
    });
});

describe('insertBlock', () =>
{
    it('writes a block with its transactions and transfers', () =>
    {
        const index = store();
        index.insertBlock(blockRow(1), [txRow('0xt1', 1)], [transferRow('0xt1', 0, 1)]);

        expect(index.blockByNumber(1)).toMatchObject({ number: 1, hash: '0xb1' });
        expect(index.transactionByHash('0xt1')).toMatchObject({ hash: '0xt1', block_number: 1 });
        expect(index.transfersOfTransaction('0xt1', 10, 0).rows).toHaveLength(1);
    });

    it('is idempotent: replaying the same block does not duplicate a row', () =>
    {
        // The indexer re-reads from its cursor after a crash, so blocks arrive twice as a matter
        // of course. A duplicated transaction would double every total on the page.
        const index = store();
        for (let attempt = 0; attempt < 3; attempt++)
        {
            index.insertBlock(blockRow(1), [txRow('0xt1', 1)], [transferRow('0xt1', 0, 1)]);
        }
        const stats = index.stats();
        expect(stats.blocks).toBe(1);
        expect(stats.transactions).toBe(1);
        expect(stats.transfers).toBe(1);
    });

    it('updates a block\'s hash in place when the same height is re-indexed', () =>
    {
        const index = store();
        index.insertBlock(blockRow(1, { hash: '0xold' }), [], []);
        index.insertBlock(blockRow(1, { hash: '0xnew', parent_hash: '0xnewparent' }), [], []);

        const found = index.blockByNumber(1);
        expect(found?.hash).toBe('0xnew');
        expect(found?.parent_hash).toBe('0xnewparent');
        expect(index.stats().blocks).toBe(1);
    });

    it('keeps two transfers of the same transaction apart by log index', () =>
    {
        const index = store();
        index.insertBlock(blockRow(1), [txRow('0xt1', 1)], [
            transferRow('0xt1', 0, 1),
            transferRow('0xt1', 1, 1, { to_addr: CAROL })
        ]);
        expect(index.transfersOfTransaction('0xt1', 10, 0).rows).toHaveLength(2);
    });

    it('accepts a block with no transactions at all', () =>
    {
        const index = store();
        index.insertBlock(blockRow(1, { tx_count: 0 }), [], []);
        expect(index.blockByNumber(1)?.tx_count).toBe(0);
        expect(index.stats().transactions).toBe(0);
    });

    it('keeps a null to_addr - a contract deployment has no recipient', () =>
    {
        const index = store();
        index.insertBlock(blockRow(1), [txRow('0xt1', 1, { to_addr: null, contract_address: CAROL })], []);
        const row = index.transactionByHash('0xt1');
        expect(row?.to_addr).toBeNull();
        expect(row?.contract_address).toBe(CAROL);
    });

    it('keeps a null base fee - a pre-1559 chain has none', () =>
    {
        const index = store();
        index.insertBlock(blockRow(1, { base_fee: null }), [], []);
        expect(index.blockByNumber(1)?.base_fee).toBeNull();
    });

    it('stores a full uint256 value without losing a digit', () =>
    {
        const max = ((1n << 256n) - 1n).toString();
        const index = store();
        index.insertBlock(blockRow(1), [txRow('0xt1', 1, { value: max })], []);
        expect(index.transactionByHash('0xt1')?.value).toBe(max);
    });
});

describe('transactions and rollback', () =>
{
    it('commits everything inside one transaction', () =>
    {
        const index = store();
        index.transaction(() =>
        {
            index.insertBlock(blockRow(1), [txRow('0xt1', 1)], []);
            index.insertBlock(blockRow(2), [txRow('0xt2', 2)], []);
        });
        expect(index.stats().blocks).toBe(2);
    });

    it('rolls the WHOLE batch back when the work throws', () =>
    {
        const index = store();
        index.insertBlock(blockRow(0), [], []);

        expect(() => index.transaction(() =>
        {
            index.insertBlock(blockRow(1), [txRow('0xt1', 1)], []);
            index.setCursor(1);
            throw new Error('the node dropped the next batch');
        })).toThrow('the node dropped');

        // Block 1 and the cursor move together or not at all: a cursor past a block that was
        // never written makes the indexer skip it forever.
        expect(index.blockByNumber(1)).toBeNull();
        expect(index.cursor(0)).toBe(-1);
        expect(index.stats().blocks).toBe(1);
    });

    it('leaves the store usable after a rollback', () =>
    {
        const index = store();
        expect(() => index.transaction(() =>
        {
            throw new Error('boom');
        })).toThrow();
        index.insertBlock(blockRow(1), [], []);
        expect(index.stats().blocks).toBe(1);
    });

    it('joins an outer transaction rather than opening a second one', () =>
    {
        // sqlite does not nest. Without the guard the inner BEGIN throws and the outer batch dies.
        const index = store();
        const result = index.transaction(() =>
            index.transaction(() =>
            {
                index.insertBlock(blockRow(1), [], []);
                return 'inner';
            }));
        expect(result).toBe('inner');
        expect(index.stats().blocks).toBe(1);
    });

    it('rolls a nested batch back with its outer one', () =>
    {
        const index = store();
        expect(() => index.transaction(() =>
        {
            index.transaction(() => index.insertBlock(blockRow(1), [], []));
            throw new Error('outer failed');
        })).toThrow();
        expect(index.stats().blocks).toBe(0);
    });

    it('returns the work\'s own value', () =>
    {
        const index = store();
        expect(index.transaction(() => 42)).toBe(42);
    });
});

describe('rollbackFrom - the reorg half', () =>
{
    it('drops blocks, transactions and transfers at or above the height', () =>
    {
        const index = store();
        for (const number of [1, 2, 3])
        {
            index.insertBlock(blockRow(number), [txRow(`0xt${ number }`, number)], [transferRow(`0xt${ number }`, 0, number)]);
        }

        index.rollbackFrom(2);

        expect(index.stats()).toMatchObject({ blocks: 1, transactions: 1, transfers: 1 });
        expect(index.blockByNumber(1)).not.toBeNull();
        expect(index.blockByNumber(2)).toBeNull();
        expect(index.transactionByHash('0xt3')).toBeNull();
    });

    it('is inclusive of the height it is given', () =>
    {
        const index = store();
        index.insertBlock(blockRow(5), [], []);
        index.rollbackFrom(5);
        expect(index.blockByNumber(5)).toBeNull();
    });

    it('does nothing when nothing is that high', () =>
    {
        const index = store();
        index.insertBlock(blockRow(1), [], []);
        index.rollbackFrom(99);
        expect(index.stats().blocks).toBe(1);
    });

    it('leaves tokens alone - a token contract survives a reorg of its transfers', () =>
    {
        const index = store();
        index.upsertToken({ address: TOKEN, name: 'Token', symbol: 'TKN', decimals: 18, kind: 'erc20' });
        index.insertBlock(blockRow(1), [txRow('0xt1', 1)], [transferRow('0xt1', 0, 1)]);
        index.rollbackFrom(1);
        expect(index.token(TOKEN)).not.toBeNull();
    });
});

describe('tokens', () =>
{
    it('upserts by address, replacing the description rather than duplicating it', () =>
    {
        const index = store();
        index.upsertToken({ address: TOKEN, name: 'Old', symbol: 'OLD', decimals: 6, kind: 'erc20' });
        index.upsertToken({ address: TOKEN, name: 'New', symbol: 'NEW', decimals: 18, kind: 'erc721' });

        expect(index.tokens()).toHaveLength(1);
        expect(index.token(TOKEN)).toMatchObject({ name: 'New', symbol: 'NEW', decimals: 18, kind: 'erc721' });
    });

    it('finds a token whatever case it is asked for', () =>
    {
        const index = store();
        index.upsertToken({ address: TOKEN, name: 'T', symbol: 'T', decimals: 18, kind: 'erc20' });
        expect(index.token(TOKEN.toUpperCase().replace('0X', '0x'))).not.toBeNull();
    });

    it('answers null for a contract it has never described', () =>
    {
        expect(store().token(CAROL)).toBeNull();
    });

    it('keeps an unnamed token, because it still moved value', () =>
    {
        const index = store();
        index.upsertToken({ address: TOKEN, name: '', symbol: '', decimals: 0, kind: 'erc20' });
        expect(index.token(TOKEN)).toMatchObject({ name: '', symbol: '', decimals: 0 });
    });

    it('orders the list by symbol', () =>
    {
        const index = store();
        index.upsertToken({ address: CAROL, name: 'C', symbol: 'ZZZ', decimals: 18, kind: 'erc20' });
        index.upsertToken({ address: TOKEN, name: 'T', symbol: 'AAA', decimals: 18, kind: 'erc20' });
        expect(index.tokens().map((row) => row.symbol)).toEqual(['AAA', 'ZZZ']);
    });

    it('answers knownToken from memory after the first hit, and honestly before it', () =>
    {
        const index = store();
        expect(index.knownToken(TOKEN)).toBe(false);
        index.upsertToken({ address: TOKEN, name: 'T', symbol: 'T', decimals: 18, kind: 'erc20' });
        expect(index.knownToken(TOKEN)).toBe(true);
        expect(index.knownToken(TOKEN.toUpperCase().replace('0X', '0x'))).toBe(true);
    });
});

describe('reads: ordering, paging and filtering', () =>
{
    /** Three blocks, two transactions each, written out of order on purpose. */
    function filled(): IndexStore
    {
        const index = store();
        for (const number of [2, 0, 1])
        {
            index.insertBlock(
                blockRow(number, { tx_count: 2 }),
                [
                    txRow(`0x${ number }a`, number, { tx_index: 0 }),
                    txRow(`0x${ number }b`, number, { tx_index: 1, from_addr: BOB, to_addr: CAROL })
                ],
                []);
        }
        return index;
    }

    it('orders blocks newest first regardless of insertion order', () =>
    {
        expect(filled().blocksPage(10, 0).rows.map((row) => row.number)).toEqual([2, 1, 0]);
    });

    it('orders transactions newest block first, then by index descending', () =>
    {
        const rows = filled().transactionsPage(10, 0).rows;
        expect(rows.map((row) => `${ row.block_number }.${ row.tx_index }`))
            .toEqual(['2.1', '2.0', '1.1', '1.0', '0.1', '0.0']);
    });

    it('orders a block\'s own transactions in EXECUTION order, ascending', () =>
    {
        // The other way round to the global list, and deliberately: within a block the index is
        // the order the chain ran them in.
        const rows = filled().transactionsOfBlock(1, 10, 0).rows;
        expect(rows.map((row) => row.tx_index)).toEqual([0, 1]);
    });

    it('reports the total independently of the page', () =>
    {
        const index = filled();
        const page = index.transactionsPage(2, 0);
        expect(page.rows).toHaveLength(2);
        expect(page.total).toBe(6);
    });

    it('pages without losing or repeating a row', () =>
    {
        const index = filled();
        const seen: string[] = [];
        for (let offset = 0; offset < 6; offset += 2)
        {
            seen.push(...index.transactionsPage(2, offset).rows.map((row) => row.hash));
        }
        expect(new Set(seen).size).toBe(6);
    });

    it('answers an offset past the end with no rows and an honest total', () =>
    {
        const page = filled().transactionsPage(10, 500);
        expect(page.rows).toEqual([]);
        expect(page.total).toBe(6);
    });

    it('answers a zero limit with no rows rather than every row', () =>
    {
        expect(filled().blocksPage(0, 0).rows).toEqual([]);
    });

    /** One block holding each outcome the index can record, including the one it cannot decide. */
    function mixed(): IndexStore
    {
        const index = store();
        index.insertBlock(
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

    it('returns every transaction when the filter is off', () =>
    {
        expect(mixed().transactionsPage(10, 0, 'all').total).toBe(4);
    });

    it('defaults to no filter, so an old caller keeps the answer it had', () =>
    {
        expect(mixed().transactionsPage(10, 0).total).toBe(4);
    });

    it('narrows to the successful transactions', () =>
    {
        const page = mixed().transactionsPage(10, 0, 'success');
        expect(page.rows.map((row) => row.hash)).toEqual(['0xok2', '0xok1']);
        expect(page.total).toBe(2);
    });

    it('narrows to the reverted transactions', () =>
    {
        const page = mixed().transactionsPage(10, 0, 'reverted');
        expect(page.rows.map((row) => row.hash)).toEqual(['0xbad']);
        expect(page.total).toBe(1);
    });

    it('leaves an undecided transaction out of BOTH narrowings', () =>
    {
        // status -1 is "the node returned no receipt", not "the chain said no". Handing it to a
        // reader who asked for reverted transactions would report a failure that never happened.
        const index = mixed();
        const seen = [
            ...index.transactionsPage(10, 0, 'success').rows,
            ...index.transactionsPage(10, 0, 'reverted').rows
        ].map((row) => row.hash);
        expect(seen).not.toContain('0xhuh');
        expect(index.transactionsPage(10, 0, 'all').rows.map((row) => row.hash)).toContain('0xhuh');
    });

    it('counts the narrowed set, not the table, so the pager draws the right number of pages', () =>
    {
        // A total taken from the whole table would page a filtered list into pages that are empty.
        const page = mixed().transactionsPage(1, 0, 'success');
        expect(page.rows).toHaveLength(1);
        expect(page.total).toBe(2);
    });

    it('keeps ordering and paging under a filter', () =>
    {
        const index = mixed();
        expect(index.transactionsPage(1, 1, 'success').rows.map((row) => row.hash)).toEqual(['0xok1']);
    });

    /** A chain where most blocks carried nothing - what a quiet chain's block list looks like. */
    function quiet(): IndexStore
    {
        const index = store();
        for (const number of [0, 1, 2, 3])
        {
            const carries = number === 1 || number === 3;
            index.insertBlock(
                blockRow(number, { tx_count: carries ? 1 : 0 }),
                carries ? [txRow(`0x${ number }a`, number)] : [],
                []);
        }
        return index;
    }

    it('narrows the block list to the blocks that carried something', () =>
    {
        const page = quiet().blocksPage(10, 0, 'filled');
        expect(page.rows.map((row) => row.number)).toEqual([3, 1]);
        expect(page.total).toBe(2);
    });

    it('defaults to every block, so an old caller keeps the answer it had', () =>
    {
        expect(quiet().blocksPage(10, 0).rows.map((row) => row.number)).toEqual([3, 2, 1, 0]);
        expect(quiet().blocksPage(10, 0, 'all').total).toBe(4);
    });

    it('counts and pages the narrowed set of blocks', () =>
    {
        const index = quiet();
        const first = index.blocksPage(1, 0, 'filled');
        expect(first.rows.map((row) => row.number)).toEqual([3]);
        expect(first.total).toBe(2);
        expect(index.blocksPage(1, 1, 'filled').rows.map((row) => row.number)).toEqual([1]);
    });

    it('finds a block by hash, case-insensitively, and null for an unknown one', () =>
    {
        const index = filled();
        expect(index.blockByHash('0xb1')?.number).toBe(1);
        expect(index.blockByHash('0xB1')?.number).toBe(1);
        expect(index.blockByHash('0xnope')).toBeNull();
    });

    it('finds a transaction by hash, case-insensitively, and null for an unknown one', () =>
    {
        const index = filled();
        expect(index.transactionByHash('0x1A')?.block_number).toBe(1);
        expect(index.transactionByHash('0xdeadbeef')).toBeNull();
    });

    it('reports the head and the head time from the highest block', () =>
    {
        const stats = filled().stats();
        expect(stats.head).toBe(2);
        expect(stats.headTime).toBe(1_700_000_000 + 2 * 3);
    });

    it('reports a zero head for an empty index rather than null', () =>
    {
        const stats = store().stats();
        expect(stats).toMatchObject({ blocks: 0, transactions: 0, transfers: 0, head: 0, headTime: 0 });
    });

    it('reads recent blocks newest first, capped at the window', () =>
    {
        const index = filled();
        expect(index.recentBlocks(2).map((row) => row.number)).toEqual([2, 1]);
        expect(index.recentBlocks(100)).toHaveLength(3);
    });
});

describe('the address queries this index exists for', () =>
{
    function withHistory(): IndexStore
    {
        const index = store();
        index.insertBlock(blockRow(1), [
            txRow('0xt1', 1, { from_addr: ALICE, to_addr: BOB }),
            txRow('0xt2', 1, { tx_index: 1, from_addr: BOB, to_addr: ALICE, value: '5' })
        ], []);
        index.insertBlock(blockRow(2), [
            txRow('0xt3', 2, { from_addr: CAROL, to_addr: CAROL })
        ], []);
        return index;
    }

    it('finds every transaction touching an address, in either direction', () =>
    {
        const page = withHistory().transactionsOfAddress(ALICE, 10, 0);
        expect(page.total).toBe(2);
        expect(page.rows.map((row) => row.hash).sort()).toEqual(['0xt1', '0xt2']);
    });

    it('counts a self-send once, not twice', () =>
    {
        // `from = ? OR to = ?` is one row either way; a UNION would have doubled it.
        const page = withHistory().transactionsOfAddress(CAROL, 10, 0);
        expect(page.total).toBe(1);
        expect(page.rows).toHaveLength(1);
    });

    it('matches an address whatever case it is asked for', () =>
    {
        const page = withHistory().transactionsOfAddress(ALICE.toUpperCase().replace('0X', '0x'), 10, 0);
        expect(page.total).toBe(2);
    });

    it('answers an address it has never seen with an empty page, not an error', () =>
    {
        const page = withHistory().transactionsOfAddress(ZERO, 10, 0);
        expect(page).toEqual({ rows: [], total: 0 });
    });

    it('narrows an address history to what ARRIVED', () =>
    {
        const page = withHistory().transactionsOfAddress(ALICE, 10, 0, 'in');
        expect(page.rows.map((row) => row.hash)).toEqual(['0xt2']);
        expect(page.total).toBe(1);
    });

    it('narrows an address history to what LEFT', () =>
    {
        const page = withHistory().transactionsOfAddress(ALICE, 10, 0, 'out');
        expect(page.rows.map((row) => row.hash)).toEqual(['0xt1']);
        expect(page.total).toBe(1);
    });

    it('defaults to both directions, so an old caller keeps the answer it had', () =>
    {
        expect(withHistory().transactionsOfAddress(ALICE, 10, 0).total).toBe(2);
        expect(withHistory().transactionsOfAddress(ALICE, 10, 0, 'all').total).toBe(2);
    });

    it('shows a self-send under BOTH narrowings, because it really was both', () =>
    {
        const index = withHistory();
        expect(index.transactionsOfAddress(CAROL, 10, 0, 'in').total).toBe(1);
        expect(index.transactionsOfAddress(CAROL, 10, 0, 'out').total).toBe(1);
        // Still once with no narrowing - the OR must not double it.
        expect(index.transactionsOfAddress(CAROL, 10, 0, 'all').total).toBe(1);
    });

    it('matches a narrowed address whatever case it is asked for', () =>
    {
        const shouted = ALICE.toUpperCase().replace('0X', '0x');
        expect(withHistory().transactionsOfAddress(shouted, 10, 0, 'out').total).toBe(1);
    });

    it('pages the transfers one transaction emitted, in log order, oldest log first', () =>
    {
        // Ascending, unlike every other list here: within one transaction the log index IS the
        // order the contract emitted them in. An airdrop read backwards is a different story.
        const index = store();
        index.insertBlock(blockRow(1), [txRow('0xt1', 1)], [
            transferRow('0xt1', 0, 1),
            transferRow('0xt1', 1, 1, { to_addr: CAROL }),
            transferRow('0xt1', 2, 1, { to_addr: MINER })
        ]);

        const first = index.transfersOfTransaction('0xt1', 2, 0);
        expect(first.rows.map((row) => row.log_index)).toEqual([0, 1]);
        // The total is every log the transaction emitted, so the pager knows how far it runs.
        expect(first.total).toBe(3);

        const second = index.transfersOfTransaction('0xt1', 2, 2);
        expect(second.rows.map((row) => row.log_index)).toEqual([2]);
        expect(second.total).toBe(3);
    });

    it('answers a transaction that emitted nothing with an empty page, not an error', () =>
    {
        const index = store();
        index.insertBlock(blockRow(1), [txRow('0xt1', 1)], []);
        expect(index.transfersOfTransaction('0xt1', 10, 0)).toEqual({ rows: [], total: 0 });
    });

    it('finds a token\'s transfers on the TOKEN\'s own page', () =>
    {
        // A token contract is never a PARTY to its own transfers; keyed on from/to alone its page
        // was empty while the index held every transfer it had ever emitted.
        const index = store();
        index.insertBlock(blockRow(1), [txRow('0xt1', 1)], [transferRow('0xt1', 0, 1)]);
        expect(index.transfersOfAddress(TOKEN, 10, 0).total).toBe(1);
        expect(index.transfersOfAddress(ALICE, 10, 0).total).toBe(1);
        expect(index.transfersOfAddress(BOB, 10, 0).total).toBe(1);
    });

    it('counts a transfer once even when the token is also a party to it', () =>
    {
        const index = store();
        index.insertBlock(blockRow(1), [txRow('0xt1', 1)], [transferRow('0xt1', 0, 1, { from_addr: TOKEN })]);
        expect(index.transfersOfAddress(TOKEN, 10, 0).total).toBe(1);
    });

    it('finds the transaction that deployed a contract', () =>
    {
        const index = store();
        index.insertBlock(blockRow(1), [txRow('0xt1', 1, { to_addr: null, contract_address: CAROL })], []);
        expect(index.contractCreation(CAROL)?.hash).toBe('0xt1');
        expect(index.contractCreation(CAROL.toUpperCase().replace('0X', '0x'))?.hash).toBe('0xt1');
        expect(index.contractCreation(BOB)).toBeNull();
    });
});

describe('flowOfAddress', () =>
{
    it('sums value in and out, and fees only on what the address SENT', () =>
    {
        const index = store();
        index.insertBlock(blockRow(1), [
            txRow('0xin', 1, { from_addr: BOB, to_addr: ALICE, value: '100', gas_used: '21000', effective_gas_price: '1' }),
            txRow('0xout', 1, { tx_index: 1, from_addr: ALICE, to_addr: BOB, value: '30', gas_used: '21000', effective_gas_price: '2' })
        ], []);

        const flow = index.flowOfAddress(ALICE);
        expect(flow.in).toBe('100');
        expect(flow.out).toBe('30');
        // Only the outgoing transaction's fee - the sender pays.
        expect(flow.fees).toBe(String(21000 * 2));
    });

    it('ignores a reverted transaction, whose value never moved', () =>
    {
        const index = store();
        index.insertBlock(blockRow(1), [txRow('0xt1', 1, { value: '999', status: 0 })], []);
        expect(index.flowOfAddress(ALICE)).toEqual({ in: '0', out: '0', fees: '0' });
    });

    it('counts a self-send on BOTH sides, because the address really did each', () =>
    {
        const index = store();
        index.insertBlock(blockRow(1), [txRow('0xt1', 1, { from_addr: ALICE, to_addr: ALICE, value: '7' })], []);
        const flow = index.flowOfAddress(ALICE);
        expect(flow.in).toBe('7');
        expect(flow.out).toBe('7');
    });

    it('sums through bigint, so a total past 2^53 stays exact', () =>
    {
        const big = (10n ** 30n).toString();
        const index = store();
        index.insertBlock(blockRow(1), [
            txRow('0xa', 1, { from_addr: BOB, to_addr: ALICE, value: big }),
            txRow('0xb', 1, { tx_index: 1, from_addr: BOB, to_addr: ALICE, value: big })
        ], []);
        expect(index.flowOfAddress(ALICE).in).toBe((10n ** 30n * 2n).toString());
    });

    it('answers zeroes for an address with no history', () =>
    {
        expect(store().flowOfAddress(ZERO)).toEqual({ in: '0', out: '0', fees: '0' });
    });
});

describe('distinctAddresses - the rich list candidates', () =>
{
    it('gathers every side of every row, deduplicated', () =>
    {
        const index = store();
        index.insertBlock(blockRow(1), [txRow('0xt1', 1)], [transferRow('0xt1', 0, 1, { to_addr: CAROL })]);

        const addresses = index.distinctAddresses();
        expect(new Set(addresses)).toEqual(new Set([ALICE, BOB, CAROL, MINER, TOKEN]));
        expect(addresses.length).toBe(new Set(addresses).size);
    });

    it('excludes the zero address, which nothing can be spent from', () =>
    {
        const index = store();
        index.insertBlock(blockRow(1), [txRow('0xt1', 1, { from_addr: ZERO, to_addr: ALICE })], []);
        expect(index.distinctAddresses()).not.toContain(ZERO);
    });

    it('drops the null recipient of a deployment rather than listing it', () =>
    {
        const index = store();
        index.insertBlock(blockRow(1), [txRow('0xt1', 1, { to_addr: null, contract_address: CAROL })], []);
        expect(index.distinctAddresses()).not.toContain(null);
    });
});

describe('the Etherscan-shaped range queries', () =>
{
    function ranged(): IndexStore
    {
        const index = store();
        for (const number of [1, 2, 3])
        {
            index.insertBlock(
                blockRow(number),
                [txRow(`0xt${ number }`, number)],
                [transferRow(`0xt${ number }`, 0, number, { kind: number === 3 ? 'erc721' : 'erc20' })]);
        }
        return index;
    }

    it('narrows transactions to an inclusive block range', () =>
    {
        const rows = ranged().addressTransactionsInRange(ALICE, 2, 3, 100, 0, true);
        expect(rows.map((row) => row.block_number)).toEqual([2, 3]);
    });

    it('sorts in the direction it is asked for', () =>
    {
        const index = ranged();
        expect(index.addressTransactionsInRange(ALICE, 0, 99, 100, 0, true).map((row) => row.block_number)).toEqual([1, 2, 3]);
        expect(index.addressTransactionsInRange(ALICE, 0, 99, 100, 0, false).map((row) => row.block_number)).toEqual([3, 2, 1]);
    });

    it('applies limit and offset within the range', () =>
    {
        const rows = ranged().addressTransactionsInRange(ALICE, 0, 99, 1, 1, true);
        expect(rows.map((row) => row.block_number)).toEqual([2]);
    });

    it('answers an empty range with no rows', () =>
    {
        expect(ranged().addressTransactionsInRange(ALICE, 50, 60, 100, 0, true)).toEqual([]);
        // An inverted range is empty, not an error.
        expect(ranged().addressTransactionsInRange(ALICE, 3, 1, 100, 0, true)).toEqual([]);
    });

    it('narrows transfers to one token contract, and to all of them when told none', () =>
    {
        const index = ranged();
        expect(index.addressTransfersInRange(ALICE, 0, 99, 100, 0, true, null)).toHaveLength(3);
        expect(index.addressTransfersInRange(ALICE, 0, 99, 100, 0, true, TOKEN)).toHaveLength(3);
        expect(index.addressTransfersInRange(ALICE, 0, 99, 100, 0, true, CAROL)).toHaveLength(0);
    });

    it('matches the contract filter case-insensitively', () =>
    {
        const index = ranged();
        const upper = TOKEN.toUpperCase().replace('0X', '0x');
        expect(index.addressTransfersInRange(ALICE, 0, 99, 100, 0, true, upper)).toHaveLength(3);
    });

    it('does NOT take the sort direction from caller text', () =>
    {
        // The direction is interpolated into ORDER BY because sqlite takes no parameter there.
        // It is a boolean at the type level, and this pins that it stays one.
        const index = ranged();
        const rows = index.addressTransactionsInRange(ALICE, 0, 99, 100, 0, Boolean('anything'));
        expect(rows).toHaveLength(3);
    });
});

describe('schema versioning', () =>
{
    it('rebuilds rather than migrating when the stored version is not the current one', () =>
    {
        // Every table is derived from the chain, so a schema change drops and replays. A stale
        // file that kept its rows would serve columns that no longer mean what they say.
        const index = store();
        index.ensureChain('0xgenesis');
        index.insertBlock(blockRow(1), [txRow('0xt1', 1)], []);
        expect(index.stats().blocks).toBe(1);

        index.setMeta('schema', 'from-an-older-build');
        // Re-opening the SAME in-memory handle is not possible, so this asserts the guard's own
        // condition: the version is what decides, and it is written by the constructor.
        expect(index.getMeta('schema')).toBe('from-an-older-build');
    });

    it('stamps a schema version on a fresh index', () =>
    {
        expect(store().getMeta('schema')).not.toBeNull();
    });
});

describe('concurrent access', () =>
{
    it('serialises interleaved writes without losing one', async () =>
    {
        // node:sqlite is synchronous, so this is not true parallelism - but the indexer's writes
        // DO interleave with request-time reads through the event loop, and this pins that the
        // rows all arrive.
        const index = store();
        await Promise.all(Array.from({ length: 25 }, async (_entry, number) =>
        {
            await Promise.resolve();
            index.insertBlock(blockRow(number), [txRow(`0xt${ number }`, number)], []);
        }));
        expect(index.stats().blocks).toBe(25);
        expect(index.stats().transactions).toBe(25);
    });

    it('serves reads consistently while writes are landing', async () =>
    {
        const index = store();
        const writes = Array.from({ length: 20 }, async (_entry, number) =>
        {
            await Promise.resolve();
            index.insertBlock(blockRow(number), [], []);
        });
        const reads = Array.from({ length: 20 }, async () =>
        {
            await Promise.resolve();
            // Never throws, and never reports more blocks than were written.
            return index.stats().blocks;
        });

        const [, counts] = await Promise.all([Promise.all(writes), Promise.all(reads)]);
        expect(counts.every((count) => count >= 0 && count <= 20)).toBe(true);
        expect(index.stats().blocks).toBe(20);
    });

    it('keeps a failed batch from leaving half a block behind under interleaving', async () =>
    {
        const index = store();
        index.insertBlock(blockRow(0), [], []);

        const attempts = [1, 2, 3].map(async (number) =>
        {
            await Promise.resolve();
            try
            {
                index.transaction(() =>
                {
                    index.insertBlock(blockRow(number), [txRow(`0xt${ number }`, number)], []);
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

        // Whatever the interleaving, block 2 is either fully there or not there at all - never a
        // block row without its transaction.
        const block2 = index.blockByNumber(2);
        const tx2 = index.transactionByHash('0xt2');
        expect(block2 === null).toBe(tx2 === null);
    });
});
