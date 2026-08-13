// The API and the index it reads, against a STUBBED chain - deterministic, no network, and the
// only way to exercise the paths a live node will not reproduce on demand (a reorg, a receipt the
// node never returned, an address with more rows than one page).
import { describe, it, expect } from 'vitest';

import { buildApp } from '../src/app.ts';
import { syncOnce } from '../src/chain/indexer.ts';
import { IndexStore } from '../src/chain/store.ts';
import { classify, meanBlockTime, pageCount, presentTransaction } from '../src/present.ts';
import type { BlockWithReceipts, ChainEnv, ChainGateway } from '../src/chain/client.ts';
import type { Account, BlockPage, SearchResult, Summary, TransactionPage } from '../src/schemas.ts';

const ENV: ChainEnv = {
    rpcUrl: 'stub', chainId: 1020, name: 'NuraChain', symbol: 'NURA', decimals: 18, siteUrl: '', explorerUrl: '',
    startBlock: 0, pollMs: 1000, batchSize: 10, concurrency: 4, rpcBatchSize: 10, dbPath: ':memory:'
};

const ALICE = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const BOB = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

/** One block carrying `count` transfers of 1 NURA from Alice to Bob. */
function block(number: number, parentHash: string, hash: string, count = 1): BlockWithReceipts
{
    return {
        number, hash, parentHash,
        timestamp: 1_700_000_000 + number * 3,
        miner: '0xcccccccccccccccccccccccccccccccccccccccc',
        gasUsed: 21_000n * BigInt(count), gasLimit: 30_000_000n, baseFeePerGas: 1_000_000_000n,
        size: 500,
        transactions: Array.from({ length: count }, (_row, index) => ({
            hash: `0x${ String(number).padStart(4, '0') }${ String(index).padStart(60, '0') }`,
            index, from: ALICE, to: BOB, value: 10n ** 18n, nonce: index, inputSize: 0,
            gasUsed: 21_000n, effectiveGasPrice: 1_000_000_000n, status: 1,
            contractAddress: null, logs: []
        }))
    };
}

/** A chain the test drives directly: `chain.blocks` IS the canonical chain. */
function stubChain(blocks: BlockWithReceipts[]): ChainGateway
{
    return {
        env: ENV,
        head: async () => blocks[blocks.length - 1]?.number ?? 0,
        range: async (from, to) => blocks.filter(entry => entry.number >= from && entry.number <= to),
        genesisHash: async () => blocks[0]?.hash ?? '0xgenesis',
        blockHashAt: async number => blocks.find(entry => entry.number === number)?.hash ?? null,
        tokenMetadata: async () => null,
        balance: async () => 5n * 10n ** 18n,
        isContract: async () => false
    };
}

const silent = { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined } as never;

async function indexed(blocks: BlockWithReceipts[]): Promise<{ store: IndexStore; chain: ChainGateway }>
{
    const store = new IndexStore(':memory:');
    const chain = stubChain(blocks);
    store.ensureChain(await chain.genesisHash());
    await syncOnce(store, chain, silent);
    return { store, chain };
}

const CHAIN = [
    block(0, '0x00', '0xb0'),
    block(1, '0xb0', '0xb1', 2),
    block(2, '0xb1', '0xb2')
];

describe('pure presentation rules', () =>
{
    it('classifies a search term by SHAPE alone', () =>
    {
        expect(classify(`0x${ 'a'.repeat(64) }`)).toBe('hash');
        expect(classify(ALICE)).toBe('address');
        expect(classify('42')).toBe('height');
        expect(classify('hello')).toBe('unknown');
    });

    it('a receipt the node never returned is UNKNOWN, never "success"', () =>
    {
        // Reporting a transaction whose outcome we do not know as successful is the worst
        // thing this explorer could say about someone's money.
        const row = {
            hash: '0xa', block_number: 1, tx_index: 0, from_addr: ALICE, to_addr: BOB,
            value: '0', nonce: 0, input_size: 0, gas_used: '0', effective_gas_price: '0',
            status: -1, contract_address: null, timestamp: 1_700_000_000
        };
        expect(presentTransaction(row).status).toBe('unknown');
        expect(presentTransaction({ ...row, status: 0 }).status).toBe('reverted');
        expect(presentTransaction({ ...row, status: 1 }).status).toBe('success');
    });

    it('computes the fee so nothing downstream multiplies uint256s', () =>
    {
        const fee = presentTransaction({
            hash: '0xa', block_number: 1, tx_index: 0, from_addr: ALICE, to_addr: BOB,
            value: '0', nonce: 0, input_size: 0, gas_used: '21000',
            effective_gas_price: '1000000000', status: 1, contract_address: null, timestamp: 0
        }).fee;
        expect(fee).toBe('21000000000000');
    });

    it('a pager always has at least one page', () =>
    {
        expect(pageCount(0, 25)).toBe(1);
        expect(pageCount(26, 25)).toBe(2);
    });

    it('mean block time needs two blocks to mean anything', () =>
    {
        expect(meanBlockTime([])).toBe(0);
        expect(meanBlockTime([{ timestamp: 30 } as never])).toBe(0);
        expect(meanBlockTime([{ timestamp: 30 }, { timestamp: 20 }, { timestamp: 10 }] as never)).toBe(10);
    });
});

describe('the index', () =>
{
    it('records every block and transaction the chain reported', async () =>
    {
        const { store } = await indexed(CHAIN);
        const stats = store.stats();
        expect(stats.blocks).toBe(3);
        expect(stats.transactions).toBe(4);
        expect(stats.head).toBe(2);
    });

    it('answers "every transaction touching this address" - the query JSON-RPC cannot', async () =>
    {
        const { store } = await indexed(CHAIN);
        // Alice sent all four; Bob received all four. Both must see the same four rows.
        expect(store.transactionsOfAddress(ALICE, 10, 0).total).toBe(4);
        expect(store.transactionsOfAddress(BOB, 10, 0).total).toBe(4);
        // Checksummed input must not miss rows stored lower-cased.
        expect(store.transactionsOfAddress(ALICE.toUpperCase(), 10, 0).total).toBe(4);
    });

    it('pages without losing or repeating a row', async () =>
    {
        const { store } = await indexed(CHAIN);
        const first = store.transactionsOfAddress(ALICE, 3, 0);
        const second = store.transactionsOfAddress(ALICE, 3, 3);
        expect(first.rows).toHaveLength(3);
        expect(second.rows).toHaveLength(1);
        const seen = new Set([...first.rows, ...second.rows].map(row => row.hash));
        expect(seen.size).toBe(4);
    });

    it('sums native flow in each direction', async () =>
    {
        const { store } = await indexed(CHAIN);
        const flow = store.flowOfAddress(ALICE);
        expect(flow.out).toBe((4n * 10n ** 18n).toString());
        expect(flow.in).toBe('0');
        expect(store.flowOfAddress(BOB).in).toBe((4n * 10n ** 18n).toString());
    });

    it('pages a block\'s transactions instead of shipping every one', async () =>
    {
        // A full block can carry hundreds of transactions, and returning all of them turns a
        // detail page into a download. The total stays the block's real count on every page.
        const { store } = await indexed(CHAIN);
        // Whichever block the fixture loaded most heavily - the assertion is about paging, not
        // about which block happens to be busy.
        const busiest = [0, 1, 2]
            .map((number) => ({ number, total: store.transactionsOfBlock(number, 100, 0).total }))
            .sort((a, b) => b.total - a.total)[0]!;
        const all = store.transactionsOfBlock(busiest.number, 100, 0);
        expect(all.total).toBeGreaterThan(1);

        // One row per page: every page reports the SAME total, and the rows do not repeat.
        const pages = Array.from({ length: all.total }, (_row, index) => store.transactionsOfBlock(busiest.number, 1, index));
        for (const slice of pages)
        {
            expect(slice.rows).toHaveLength(1);
            expect(slice.total).toBe(all.total);
        }
        expect(new Set(pages.map((slice) => slice.rows[0]!.hash)).size).toBe(all.total);

        // Past the end is empty, not an error.
        expect(store.transactionsOfBlock(busiest.number, 10, all.total).rows).toHaveLength(0);
    });

    it('rolls back a reorg instead of serving transactions that were un-mined', async () =>
    {
        const { store } = await indexed(CHAIN);
        const orphaned = store.transactionsOfBlock(2, 100, 0).rows[0]!.hash;
        expect(store.stats().transactions).toBe(4);

        // The chain re-writes block 2: a different hash, and transactions that share NO hash
        // with the ones it replaced. Reusing a hash would let ON CONFLICT DO NOTHING hide a
        // missing rollback, so the fork's transactions are deliberately distinct.
        const fork = block(2, '0xb1', '0xb2-fork', 3);
        fork.transactions = fork.transactions.map((entry, index) => ({
            ...entry, hash: `0xfork${ String(index).padStart(60, '0') }`
        }));
        await syncOnce(store, stubChain([CHAIN[0]!, CHAIN[1]!, fork]), silent);

        expect(store.blockHash(2)).toBe('0xb2-fork');
        // The orphaned transaction is GONE - not merged alongside the replacements.
        expect(store.transactionByHash(orphaned)).toBeNull();
        expect(store.transactionsOfBlock(2, 100, 0).rows).toHaveLength(3);
        expect(store.stats().transactions).toBe(6);
        expect(store.stats().blocks).toBe(3);
    });

    it('wipes the index when the chain behind the RPC is a different one', async () =>
    {
        const { store } = await indexed(CHAIN);
        expect(store.ensureChain('0xb0')).toBe(false);
        expect(store.ensureChain('0xsomeotherchain')).toBe(true);
        expect(store.stats().blocks).toBe(0);
    });
});

describe('the API over the index', () =>
{
    async function api(): Promise<(path: string) => Promise<Response>>
    {
        const { store, chain } = await indexed(CHAIN);
        const app = buildApp({ dev: false, store, chain });
        return (path) => app.handle(new Request(`http://local${ path }`));
    }

    it('reports BOTH heads, so a backfill in progress is visible', async () =>
    {
        const get = await api();
        const summary = (await (await get('/api/stats')).json()) as Summary;
        expect(summary.head).toBe(2);
        expect(summary.chainHead).toBe(2);
        expect(summary.chain.symbol).toBe('NURA');
    });

    it('resolves a search by consulting the index, not by guessing', async () =>
    {
        const get = await api();
        const at = async (q: string): Promise<SearchResult> =>
            (await (await get(`/api/search?q=${ encodeURIComponent(q) }`)).json()) as SearchResult;

        expect(await at(ALICE)).toEqual({ kind: 'address', path: `/address/${ ALICE }` });
        expect(await at('1')).toEqual({ kind: 'block', path: '/block/1' });
        // A 32-byte hash is a transaction OR a block; only a lookup can say which.
        expect((await at('0xb1')).kind).toBe('none');
        expect(await at('nonsense')).toEqual({ kind: 'none', path: null });
    });

    it('serves an address with a LIVE balance and indexed history', async () =>
    {
        const get = await api();
        const account = (await (await get(`/api/address/${ ALICE }`)).json()) as Account;
        // The balance comes from the node - a stale balance is a wrong answer.
        expect(account.balance).toBe((5n * 10n ** 18n).toString());
        expect(account.txCount).toBe(4);
        expect(account.flow.out).toBe((4n * 10n ** 18n).toString());
    });

    it('pages blocks and transactions in a countable envelope', async () =>
    {
        const get = await api();
        const blocks = (await (await get('/api/blocks?limit=2')).json()) as BlockPage;
        expect(blocks.rows).toHaveLength(2);
        expect(blocks.total).toBe(3);
        expect(blocks.pages).toBe(2);
        // Newest first: an explorer's list starts at the head.
        expect(blocks.rows[0]!.number).toBe(2);

        const txs = (await (await get('/api/txs?limit=10')).json()) as TransactionPage;
        expect(txs.total).toBe(4);
    });

    it('404s an unknown block rather than inventing one', async () =>
    {
        const get = await api();
        expect((await get('/api/blocks/999')).status).toBe(404);
        expect((await get(`/api/txs/0x${ 'f'.repeat(64) }`)).status).toBe(404);
    });
});
