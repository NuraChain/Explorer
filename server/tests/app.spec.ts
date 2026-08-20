// The API and the index it reads, against a STUBBED chain - deterministic, no network, and the
// only way to exercise the paths a live node will not reproduce on demand (a reorg, a receipt the
// node never returned, an address with more rows than one page).
import { describe, it, expect } from 'vitest';
import { toFunctionSelector } from 'viem';

import { buildApp } from '../src/app.ts';
import { analyze, describeFunctions, detectStandards } from '../src/chain/contract.ts';
import { encodeCall } from '../src/chain/values.ts';
import { syncOnce } from '../src/chain/indexer.ts';
import { IndexStore, TRANSFER_TOPIC } from '../src/chain/store.ts';
import { classify, meanBlockTime, pageCount, presentTransaction } from '../src/present.ts';
import type { BlockWithReceipts, ChainEnv, ChainGateway } from '../src/chain/client.ts';
import type {
    Account,
    BlockPage,
    ContractCalldata,
    ContractCallResult,
    ContractDetail,
    SearchResult,
    Summary,
    TopAccounts,
    TransactionDetail,
    TransactionPage,
    TransferPage
} from '../src/schemas.ts';

const ENV: ChainEnv = {
    rpcUrl: 'stub', chainId: 1020, name: 'NuraChain', symbol: 'NURA', decimals: 18, siteUrl: '', explorerUrl: '',
    startBlock: 0, pollMs: 1000, batchSize: 10, concurrency: 4, rpcBatchSize: 10, dbPath: ':memory:'
};

const ALICE = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const BOB = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
/** An ERC-20 contract: it EMITS transfers, and is never a party to one. */
const TOKEN = '0xdddddddddddddddddddddddddddddddddddddddd';

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

/** An address as an indexed log topic: left-padded to 32 bytes, the way the EVM writes it. */
function topic(address: string): string
{
    return `0x${ address.slice(2).padStart(64, '0') }`;
}

/** The same block, with its transaction emitting one ERC-20 `Transfer` of 1 token to Bob. */
function tokenBlock(number: number, parentHash: string, hash: string): BlockWithReceipts
{
    const carrier = block(number, parentHash, hash);
    carrier.transactions[0]!.logs = [{
        index: 0,
        address: TOKEN,
        topics: [TRANSFER_TOPIC, topic(ALICE), topic(BOB)],
        data: `0x${ (10n ** 18n).toString(16).padStart(64, '0') }`
    }];
    return carrier;
}

/** What a stubbed chain answers beyond its blocks: deployed code, and what a call returns. */
interface ChainStub
{
    code?: Record<string, string>;
    balance?: (address: string) => Promise<bigint>;
    call?: (address: string, data: string) => Promise<string>;
}

/** A chain the test drives directly: `chain.blocks` IS the canonical chain. */
function stubChain(blocks: BlockWithReceipts[], stub: ChainStub = {}): ChainGateway
{
    const codeAt = (address: string): string => stub.code?.[address.toLowerCase()] ?? '0x';
    return {
        env: ENV,
        head: async () => blocks[blocks.length - 1]?.number ?? 0,
        range: async (from, to) => blocks.filter(entry => entry.number >= from && entry.number <= to),
        genesisHash: async () => blocks[0]?.hash ?? '0xgenesis',
        blockHashAt: async number => blocks.find(entry => entry.number === number)?.hash ?? null,
        tokenMetadata: async () => null,
        balance: stub.balance ?? (async () => 5n * 10n ** 18n),
        isContract: async address => codeAt(address) !== '0x',
        code: async address => codeAt(address),
        storageAt: async () => `0x${ '0'.repeat(64) }`,
        // Silence by default: a getter that answers is stubbed only where that IS the subject.
        call: stub.call ?? (async () => '0x')
    };
}

const silent = { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined } as never;

async function indexed(blocks: BlockWithReceipts[], stub: ChainStub = {}): Promise<{ store: IndexStore; chain: ChainGateway }>
{
    const store = new IndexStore(':memory:');
    const chain = stubChain(blocks, stub);
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

    it('finds a token\'s transfers on the TOKEN\'s own page, where no from/to pair can', async () =>
    {
        // A token contract is named in `token`, never as a counterparty, so a query keyed on the
        // two parties alone showed a token's page nothing at all - the bug this covers.
        const { store } = await indexed([...CHAIN, tokenBlock(3, '0xb2', '0xb3')]);

        expect(store.transfersOfAddress(ALICE, 10, 0).total).toBe(1);
        expect(store.transfersOfAddress(BOB, 10, 0).total).toBe(1);

        const emitted = store.transfersOfAddress(TOKEN, 10, 0);
        expect(emitted.total).toBe(1);
        expect(emitted.rows[0]!.token).toBe(TOKEN);
        expect(emitted.rows[0]!.value).toBe((10n ** 18n).toString());
        // Checksummed input must not miss rows stored lower-cased, on this column too.
        expect(store.transfersOfAddress(TOKEN.toUpperCase(), 10, 0).total).toBe(1);
        // An address that is none of the three still sees nothing.
        expect(store.transfersOfAddress('0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', 10, 0).total).toBe(0);
    });

    it('counts a transfer once, even when the token is also a party to it', async () =>
    {
        // A token holding its own token matches two arms of the OR; the row must not double.
        const selfSend = tokenBlock(3, '0xb2', '0xb3');
        selfSend.transactions[0]!.logs = [{
            index: 0, address: TOKEN, topics: [TRANSFER_TOPIC, topic(ALICE), topic(TOKEN)], data: '0x01'
        }];
        const { store } = await indexed([...CHAIN, selfSend]);
        expect(store.transfersOfAddress(TOKEN, 10, 0).total).toBe(1);
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

    it('ranks accounts by live native balance, highest first', async () =>
    {
        const { store, chain } = await indexed(CHAIN, {
            balance: async (address) => address === ALICE ? 10n * 10n ** 18n : 2n * 10n ** 18n
        });
        const app = buildApp({ dev: false, store, chain });
        const response = await app.handle(new Request('http://local/api/accounts/top?limit=10'));
        const body = (await response.json()) as TopAccounts;

        expect(response.status).toBe(200);
        expect(body.rows[0]).toEqual({ address: ALICE, balance: (10n * 10n ** 18n).toString(), rank: 1 });
        // Every later row balances no higher than the one above it.
        for (let at = 1; at < body.rows.length; at++)
        {
            expect(BigInt(body.rows[at - 1]!.balance) >= BigInt(body.rows[at]!.balance)).toBe(true);
        }
    });

    it('pages the rich list in the same countable envelope as every other list', async () =>
    {
        const { store, chain } = await indexed(CHAIN, { balance: async () => 2n * 10n ** 18n });
        const app = buildApp({ dev: false, store, chain });
        const at = async (query: string): Promise<TopAccounts> =>
            (await (await app.handle(new Request(`http://local/api/accounts/top?${ query }`))).json()) as TopAccounts;

        const whole = await at('limit=50');
        expect(whole.total).toBeGreaterThan(1);
        expect(whole.page).toBe(1);

        const first = await at('limit=1&page=1');
        const second = await at('limit=1&page=2');
        expect(first.rows).toHaveLength(1);
        expect(second.rows).toHaveLength(1);
        expect(first.rows[0]!.address).not.toBe(second.rows[0]!.address);
        expect(first.pages).toBe(whole.total);
    });

    it('ranks over the WHOLE list, so a row keeps its place on page two', async () =>
    {
        // A rank counted from the row's position on screen restarts at 1 on every page, which
        // would tell a reader the 26th richest address is the richest.
        const { store, chain } = await indexed(CHAIN, {
            balance: async (address) => address === ALICE ? 10n * 10n ** 18n : 2n * 10n ** 18n
        });
        const app = buildApp({ dev: false, store, chain });
        const second = (await (await app.handle(new Request('http://local/api/accounts/top?limit=1&page=2'))).json()) as TopAccounts;
        expect(second.rows[0]!.rank).toBe(2);
    });

    it('narrows the rich list to the addresses containing a term, keeping their real ranks', async () =>
    {
        const { store, chain } = await indexed(CHAIN, {
            balance: async (address) => address === ALICE ? 10n * 10n ** 18n : 2n * 10n ** 18n
        });
        const app = buildApp({ dev: false, store, chain });
        const at = async (query: string): Promise<TopAccounts> =>
            (await (await app.handle(new Request(`http://local/api/accounts/top?${ query }`))).json()) as TopAccounts;

        const found = await at(`limit=50&q=${ BOB.slice(2, 12) }`);
        expect(found.rows.map((row) => row.address)).toEqual([BOB]);
        expect(found.total).toBe(1);
        // Bob is not the richest here, and searching for him must not say he is.
        expect(found.rows[0]!.rank).toBeGreaterThan(1);

        // A checksummed paste has to find its own row - the index stores addresses lower-cased.
        const shouted = await at(`limit=50&q=${ BOB.toUpperCase().replace('0X', '0x') }`);
        expect(shouted.rows.map((row) => row.address)).toEqual([BOB]);

        const nothing = await at('limit=50&q=zzzz');
        expect(nothing.rows).toEqual([]);
        expect(nothing.total).toBe(0);
        // Still one page, so the pager has something coherent to draw over an empty list.
        expect(nothing.pages).toBe(1);
    });

    it('serves a token contract its OWN transfers rather than an empty ledger', async () =>
    {
        const { store, chain } = await indexed([...CHAIN, tokenBlock(3, '0xb2', '0xb3')]);
        const app = buildApp({ dev: false, store, chain });
        const at = (path: string): Promise<Response> => app.handle(new Request(`http://local${ path }`));

        // The tab's counter and the tab's contents have to agree - one of them reading 0 while
        // the other lists rows is how a page reads as broken.
        const account = (await (await at(`/api/address/${ TOKEN }`)).json()) as Account;
        expect(account.transferCount).toBe(1);

        const page = (await (await at(`/api/address/${ TOKEN }/transfers`)).json()) as TransferPage;
        expect(page.total).toBe(1);
        expect(page.rows).toHaveLength(1);
        expect(page.rows[0]!.token).toBe(TOKEN);
        // Neither end is the page's own address: this row has no direction, and the UI prints the
        // pair instead of a sign.
        expect(page.rows[0]!.from).toBe(ALICE);
        expect(page.rows[0]!.to).toBe(BOB);
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

    it('narrows the transaction list to one outcome, and pages what is left', async () =>
    {
        const mixed = block(3, '0xb2', '0xb3', 2);
        mixed.transactions[1]!.status = 0;
        const { store, chain } = await indexed([...CHAIN, mixed]);
        const app = buildApp({ dev: false, store, chain });
        const at = (path: string): Promise<Response> => app.handle(new Request(`http://local${ path }`));
        const list = async (query: string): Promise<TransactionPage> =>
            (await (await at(`/api/txs?${ query }`)).json()) as TransactionPage;

        const all = await list('limit=50');
        const reverted = await list('limit=50&status=reverted');
        const succeeded = await list('limit=50&status=success');

        expect(reverted.total).toBe(1);
        expect(reverted.rows.every((row) => row.status === 'reverted')).toBe(true);
        expect(succeeded.total).toBe(all.total - 1);
        expect(succeeded.rows.every((row) => row.status === 'success')).toBe(true);

        // The envelope counts the NARROWED set: a pager fed the table's total draws pages that
        // are empty the moment a filter is on.
        const paged = await list('limit=1&status=success');
        expect(paged.rows).toHaveLength(1);
        expect(paged.pages).toBe(succeeded.total);
    });

    it('narrows an address ledger to one direction', async () =>
    {
        // Every transaction in CHAIN goes Alice -> Bob, so the two narrowings partition it
        // cleanly: everything for one of them, nothing for the other.
        const get = await api();
        const list = async (address: string, query: string): Promise<TransactionPage> =>
            (await (await get(`/api/address/${ address }/txs?${ query }`)).json()) as TransactionPage;

        const sent = await list(ALICE, 'direction=out');
        const received = await list(ALICE, 'direction=in');
        expect(sent.total).toBe(4);
        expect(received.total).toBe(0);
        expect(sent.rows.every((row) => row.from === ALICE)).toBe(true);

        const arrived = await list(BOB, 'direction=in');
        expect(arrived.total).toBe(4);
        expect(arrived.rows.every((row) => row.to === BOB)).toBe(true);

        // And the envelope counts the narrowed set, so the pager agrees with the list.
        const paged = await list(ALICE, 'direction=out&limit=2');
        expect(paged.rows).toHaveLength(2);
        expect(paged.pages).toBe(2);
    });

    it('narrows the block list to the blocks that carried something', async () =>
    {
        // CHAIN's block 0 and 2 hold one transaction each and block 1 holds two, so nothing is
        // filtered out here - what is under test is that the envelope agrees with itself.
        const empty = block(3, '0xb2', '0xb3', 0);
        const { store, chain } = await indexed([...CHAIN, empty]);
        const app = buildApp({ dev: false, store, chain });
        const at = (path: string): Promise<Response> => app.handle(new Request(`http://local${ path }`));

        const all = (await (await at('/api/blocks?limit=50')).json()) as BlockPage;
        const filled = (await (await at('/api/blocks?limit=50&content=filled')).json()) as BlockPage;

        expect(all.total).toBe(4);
        expect(filled.total).toBe(3);
        expect(filled.rows.every((row) => row.txCount > 0)).toBe(true);
        expect(filled.rows.map((row) => row.number)).not.toContain(3);
    });

    it('refuses a narrowing it does not know rather than quietly ignoring it', async () =>
    {
        // Silently serving the whole list back is the worst answer: the control says "reverted"
        // and the page shows everything, so the reader trusts a list that was never filtered.
        const get = await api();
        expect((await get('/api/txs?status=maybe')).status).toBe(422);
        expect((await get('/api/blocks?content=some')).status).toBe(422);
        expect((await get(`/api/address/${ ALICE }/txs?direction=sideways`)).status).toBe(422);
    });

    it('pages the transfers a single transaction emitted, in log order', async () =>
    {
        // One call to a distributor emits a Transfer log per recipient, so a receipt can carry
        // hundreds. Shipping all of them turns a detail page into a download.
        const carrier = block(3, '0xb2', '0xb3', 1);
        carrier.transactions[0]!.logs = [0, 1, 2].map((index) => ({
            index,
            address: TOKEN,
            topics: [TRANSFER_TOPIC, topic(ALICE), topic(BOB)],
            data: `0x${ (10n ** 18n).toString(16).padStart(64, '0') }`
        }));
        const { store, chain } = await indexed([...CHAIN, carrier]);
        const app = buildApp({ dev: false, store, chain });
        const hash = carrier.transactions[0]!.hash;
        const at = async (query: string): Promise<TransactionDetail> =>
            (await (await app.handle(new Request(`http://local/api/txs/${ hash }?${ query }`))).json()) as TransactionDetail;

        const whole = await at('limit=25');
        expect(whole.total).toBe(3);
        expect(whole.transfers).toHaveLength(3);
        expect(whole.pages).toBe(1);

        const first = await at('limit=2&page=1');
        expect(first.transfers.map((row) => row.logIndex)).toEqual([0, 1]);
        expect(first.pages).toBe(2);

        const second = await at('limit=2&page=2');
        expect(second.transfers.map((row) => row.logIndex)).toEqual([2]);
        expect(second.total).toBe(3);
    });

    it('serves a transaction that emitted nothing as an empty page, not a missing envelope', async () =>
    {
        // The UI draws its pager from `pages`, so a transaction with no transfers still has to
        // answer with a coherent one rather than leaving the field off.
        const get = await api();
        const hash = CHAIN[0]!.transactions[0]!.hash;
        const detail = (await (await get(`/api/txs/${ hash }`)).json()) as TransactionDetail;
        expect(detail.transfers).toEqual([]);
        expect(detail.total).toBe(0);
        expect(detail).toMatchObject({ page: 1, pages: 1 });
    });

    it('404s an unknown block rather than inventing one', async () =>
    {
        const get = await api();
        expect((await get('/api/blocks/999')).status).toBe(404);
        expect((await get(`/api/txs/0x${ 'f'.repeat(64) }`)).status).toBe(404);
    });
});

describe('reading a contract off its bytecode', () =>
{
    const ERC20 = [
        'totalSupply()',
        'balanceOf(address)',
        'transfer(address,uint256)',
        'transferFrom(address,address,uint256)',
        'approve(address,uint256)',
        'allowance(address,address)'
    ];

    /** The dispatcher solc writes: DUP1, PUSH4 <selector>, EQ, PUSH2 <destination>, JUMPI. */
    function dispatcher(signatures: readonly string[]): string
    {
        return signatures
            .map((signature, index) => `8063${ toFunctionSelector(signature).slice(2) }1461${ String(index).padStart(4, '0') }57`)
            .join('');
    }

    /** The CBOR trailer solc appends: a map of ipfs hash and compiler version, then its length. */
    function metadata(multihash: string, version: readonly [number, number, number]): string
    {
        const blob = 'a2'
            + '64' + Buffer.from('ipfs').toString('hex') + '5822' + multihash
            + '64' + Buffer.from('solc').toString('hex') + '43' + version.map(part => part.toString(16).padStart(2, '0')).join('');
        return blob + (blob.length / 2).toString(16).padStart(4, '0');
    }

    const MULTIHASH = `1220${ 'ab'.repeat(32) }`;
    const TOKEN_CODE = `0x${ dispatcher(ERC20) }${ metadata(MULTIHASH, [0, 8, 24]) }`;

    it('recovers the entry points from the dispatcher', () =>
    {
        const found = new Set(analyze(TOKEN_CODE).selectors);
        for (const signature of ERC20)
        {
            expect(found.has(toFunctionSelector(signature))).toBe(true);
        }
        expect(found.size).toBe(ERC20.length);
    });

    it('ignores a four-byte constant that is not compared against the calldata', () =>
    {
        // PUSH4 followed by ADD is arithmetic on a constant, not a dispatcher entry. Without the
        // comparison filter every mask and timestamp in a contract reads as a function.
        const noise = `0x${ dispatcher(['transfer(address,uint256)']) }63deadbeef01`;
        expect(analyze(noise).selectors).toEqual([toFunctionSelector('transfer(address,uint256)')]);
    });

    it('does not read the metadata trailer as code', () =>
    {
        // The trailer is data. Walked as opcodes it yields pushes that were never instructions,
        // and a selector invented there would be printed as a function the contract does not have.
        const bare = `0x${ dispatcher(['transfer(address,uint256)']) }`;
        const stamped = `${ bare }${ metadata(MULTIHASH, [0, 8, 24]) }`;
        expect(analyze(stamped).selectors).toEqual(analyze(bare).selectors);
    });

    it('reads the compiler and source pointer solc stamped in', () =>
    {
        const facts = analyze(TOKEN_CODE);
        expect(facts.compiler).toBe('0.8.24');
        // Base58 of a 0x12 0x20 multihash always lands on the familiar Qm prefix.
        expect(facts.metadataUri.startsWith('ipfs://Qm')).toBe(true);
    });

    it('names the selectors it knows and leaves the rest as four bytes', () =>
    {
        const unknown = '0x12345678';
        const described = describeFunctions([unknown, toFunctionSelector('transfer(address,uint256)')]);
        expect(described[0]!.signature).toBe('transfer(address,uint256)');
        expect(described[0]!.mutability).toBe('nonpayable');
        // Named first, and the unnamed one is still listed - its count is the honest measure of
        // what this page does not know.
        expect(described[1]!.selector).toBe(unknown);
        expect(described[1]!.signature).toBe('');
    });

    it('claims a standard only when every one of its functions is present', () =>
    {
        const full = ERC20.map(toFunctionSelector);
        expect(detectStandards(full)).toContain('ERC-20');
        expect(detectStandards(full.slice(1))).not.toContain('ERC-20');
    });

    it('follows an EIP-1167 clone to what it delegates to', () =>
    {
        const target = '0x1111111111111111111111111111111111111111';
        const clone = `0x363d3d373d3d3d363d73${ target.slice(2) }5af43d82803e903d91602b57fd5bf3`;
        expect(analyze(clone).minimalProxy).toBe(target);
        expect(analyze(TOKEN_CODE).minimalProxy).toBeNull();
    });

    it('serves the contract with its functions and the deployment behind it', async () =>
    {
        const deployed = '0xdddddddddddddddddddddddddddddddddddddddd';
        const creation = block(0, '0x00', '0xc0');
        creation.transactions[0] = {
            ...creation.transactions[0]!, to: null, value: 0n, inputSize: 120, contractAddress: deployed
        };

        const { store, chain } = await indexed([creation], { code: { [deployed]: TOKEN_CODE } });
        const app = buildApp({ dev: false, store, chain });
        const detail = (await (await app.handle(new Request(`http://local/api/address/${ deployed }/contract`))).json()) as ContractDetail;

        expect(detail.isContract).toBe(true);
        expect(detail.compiler).toBe('0.8.24');
        expect(detail.standards).toContain('ERC-20');
        expect(detail.functions.map(entry => entry.name)).toContain('transfer');
        // The half no node can answer: which transaction put this code here, and who sent it.
        expect(detail.creation?.deployer).toBe(ALICE);
        expect(detail.creation?.blockNumber).toBe(0);
    });

    it('answers for an address that holds no code instead of failing', async () =>
    {
        const { store, chain } = await indexed(CHAIN);
        const app = buildApp({ dev: false, store, chain });
        const detail = (await (await app.handle(new Request(`http://local/api/address/${ BOB }/contract`))).json()) as ContractDetail;

        expect(detail.isContract).toBe(false);
        expect(detail.functions).toEqual([]);
        expect(detail.creation).toBeNull();
    });
});

describe('calling a contract', () =>
{
    const CONTRACT = '0xdddddddddddddddddddddddddddddddddddddddd';

    /** A uint256 as the EVM returns one: one 32-byte word. */
    const word = (value: bigint): string => `0x${ value.toString(16).padStart(64, '0') }`;

    async function post(path: string, body: unknown, stub: ChainStub = {}): Promise<Response>
    {
        const { store, chain } = await indexed(CHAIN, stub);
        const app = buildApp({ dev: false, store, chain });
        return app.handle(new Request(`http://local${ path }`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body)
        }));
    }

    it('encodes an argument as the type its signature declares', async () =>
    {
        const response = await post(`/api/address/${ CONTRACT }/calldata`, {
            selector: toFunctionSelector('transfer(address,uint256)'),
            args: [BOB, '1000000000000000000']
        });
        const { data } = (await response.json()) as ContractCalldata;

        // Selector, then the address right-padded into a word, then the amount in the next.
        expect(data.slice(0, 10)).toBe(toFunctionSelector('transfer(address,uint256)'));
        expect(data.slice(10, 74)).toBe(BOB.slice(2).padStart(64, '0'));
        expect(BigInt(`0x${ data.slice(74) }`)).toBe(10n ** 18n);
    });

    it('refuses an argument that does not fit its type, naming which one', async () =>
    {
        // A silently-coerced address becomes a transaction someone signs against the wrong
        // account, so this has to be a refusal rather than a best effort.
        const response = await post(`/api/address/${ CONTRACT }/calldata`, {
            selector: toFunctionSelector('transfer(address,uint256)'),
            args: ['0x123', '1']
        });
        expect(response.status).toBe(400);
        expect(JSON.stringify(await response.json())).toContain('Argument 1');
    });

    it('accepts a dynamic bytes argument of any length', async () =>
    {
        // `'bytes'.slice(5)` is '' and `Number('')` is 0, so a plain dynamic `bytes` read as
        // `bytes0` and every non-empty value was refused for not being exactly zero bytes.
        const response = await post(`/api/address/${ CONTRACT }/calldata`, {
            selector: toFunctionSelector('safeTransferFrom(address,address,uint256,bytes)'),
            args: [ALICE, BOB, '7', '0xdeadbeef']
        });
        expect(response.status).toBe(200);
        expect(((await response.json()) as ContractCalldata).data).toContain('deadbeef');
    });

    it('refuses a selector no published signature describes', async () =>
    {
        const response = await post(`/api/address/${ CONTRACT }/calldata`, { selector: '0x12345678', args: [] });
        expect(response.status).toBe(400);
    });

    it('refuses to execute a state-changing function as a read', async () =>
    {
        // The read endpoint reaches the node. Anything that can CHANGE what the node holds
        // belongs to a wallet, which asks its owner first and pays for the answer.
        const response = await post(`/api/address/${ CONTRACT }/call`, {
            selector: toFunctionSelector('transfer(address,uint256)'),
            args: [BOB, '1']
        });
        expect(response.status).toBe(400);
    });

    it('reads a getter through the node and decodes what came back', async () =>
    {
        const response = await post(
            `/api/address/${ CONTRACT }/call`,
            { selector: toFunctionSelector('balanceOf(address)'), args: [ALICE] },
            { call: async () => word(42n) });
        const result = (await response.json()) as ContractCallResult;

        expect(result.error).toBe('');
        expect(result.values).toEqual([{ type: 'uint256', value: '42' }]);
    });

    it('reports a revert as an answer rather than as a failure', async () =>
    {
        // `ownerOf` on an unminted id is SUPPOSED to fail, and the reason is the useful part.
        // A 500 here would read as "the explorer broke" for a contract behaving correctly.
        const response = await post(
            `/api/address/${ CONTRACT }/call`,
            { selector: toFunctionSelector('ownerOf(uint256)'), args: ['7'] },
            { call: async () =>
            {
                throw Object.assign(new Error('reverted'), { shortMessage: 'execution reverted: nonexistent token' });
            } });
        const result = (await response.json()) as ContractCallResult;

        expect(response.status).toBe(200);
        expect(result.values).toEqual([]);
        expect(result.error).toContain('nonexistent token');
    });
});

describe('naming the contracts a chain is actually made of', () =>
{
    // A liquidity pair and a Multicall3 read as a wall of hex against a table that stops at
    // ERC-20 - and on a chain with a DEX on it they are the busiest contracts there are. These
    // are the signatures that turn those pages from unreadable into readable, so a future edit
    // that drops one should fail here rather than quietly go back to printing four bytes.
    const PAIR = [
        'getReserves()',
        'token0()',
        'token1()',
        'swap(uint256,uint256,address,bytes)',
        'mint(address)',
        'burn(address)',
        'skim(address)',
        'sync()',
        'kLast()',
        'price0CumulativeLast()'
    ];

    const ROUTER = [
        'WETH()',
        'addLiquidityETH(address,uint256,uint256,uint256,address,uint256)',
        'swapExactTokensForTokens(uint256,uint256,address[],address,uint256)',
        'swapExactETHForTokens(uint256,address[],address,uint256)',
        'getAmountsOut(uint256,address[])'
    ];

    const MULTICALL = [
        'aggregate3((address,bool,bytes)[])',
        'tryAggregate(bool,(address,bytes)[])',
        'getEthBalance(address)',
        'getBlockNumber()',
        'getCurrentBlockTimestamp()'
    ];

    const V3 = [
        'createPool(address,address,uint24)',
        'exactInputSingle((address,address,uint24,address,uint256,uint256,uint256,uint160))',
        'mint((address,address,uint24,int24,int24,uint256,uint256,uint256,uint256,address,uint256))',
        'collect((uint256,address,uint128,uint128))',
        'quoteExactInputSingle((address,address,uint256,uint24,uint160))',
        'positions(uint256)',
        'getPopulatedTicksInWord(address,int16)'
    ];

    it('names every entry point of a Uniswap V2 pair', () =>
    {
        const described = describeFunctions(PAIR.map(toFunctionSelector));
        expect(described.filter(entry => entry.signature === '')).toEqual([]);
        // `mint(address)` on a pair is not the ERC-20 `mint(address,uint256)`, and the difference
        // is what somebody about to call it needs to see.
        expect(described.find(entry => entry.signature === 'mint(address)')?.outputs).toEqual(['uint256']);
    });

    it('names a router, and marks the entries that take the currency as payable', () =>
    {
        const described = describeFunctions(ROUTER.map(toFunctionSelector));
        expect(described.filter(entry => entry.signature === '')).toEqual([]);
        // A router entry marked nonpayable would offer no field for the value being swapped.
        const swap = described.find(entry => entry.name === 'swapExactETHForTokens');
        expect(swap?.mutability).toBe('payable');
    });

    it('names Multicall3, and treats its array of structs as ONE argument', () =>
    {
        const described = describeFunctions(MULTICALL.map(toFunctionSelector));
        expect(described.filter(entry => entry.signature === '')).toEqual([]);

        // One argument, not three. Splitting the signature on every comma would draw this as
        // three fields and then refuse the call for having the wrong number of them.
        const batch = described.find(entry => entry.name === 'aggregate3')!;
        expect(batch.inputs).toEqual(['(address,bool,bytes)[]']);

        // And it encodes: the struct's shape is read back out of the type string, so the table
        // can call the same things a verified ABI can - it just has no names for the fields.
        const data = encodeCall(batch, [JSON.stringify([[ALICE, true, '0x1234']])]);
        expect(data.slice(0, 10)).toBe(toFunctionSelector('aggregate3((address,bool,bytes)[])'));
        expect(data).toContain(ALICE.slice(2));
    });

    it('names every entry point of the Uniswap V3 periphery', () =>
    {
        const described = describeFunctions(V3.map(toFunctionSelector));
        expect(described.filter(entry => entry.signature === '')).toEqual([]);

        // A struct argument is ONE tuple parameter, not one field per member - otherwise the page
        // draws eleven fields and then refuses the call for the wrong number of them.
        const mint = described.find(entry => entry.name === 'mint')!;
        expect(mint.inputs).toEqual(['(address,address,uint24,int24,int24,uint256,uint256,uint256,uint256,address,uint256)']);

        // The quoter is not a view: it routes a real (zero-amount) swap, so the ABI cannot promise
        // it changes nothing.
        const quote = described.find(entry => entry.name === 'quoteExactInputSingle')!;
        expect(quote.mutability).toBe('nonpayable');
    });

    it('claims a pair only when the dispatcher answers every one of its calls', () =>
    {
        const full = PAIR.map(toFunctionSelector);
        expect(detectStandards(full)).toContain('Uniswap V2 pair');
        expect(detectStandards(full.slice(1))).not.toContain('Uniswap V2 pair');
        expect(detectStandards(MULTICALL.map(toFunctionSelector))).toContain('Multicall3');
    });
});

describe('naming a Solidity library', () =>
{
    // The real NFTDescriptor deployed by every Uniswap V3 fork. One selector on 24KB of code,
    // and for a long time this explorer printed it as four bytes.
    const NFT_DESCRIPTOR = '0xc49917d7';

    it('hashes a library signature from the struct NAME, not its tuple', () =>
    {
        // The two forms of the same function. Only the qualified one is what the compiler put in
        // the bytecode, because a library's ABI keeps the parameter's declared type.
        expect(toFunctionSelector('constructTokenURI(NFTDescriptor.ConstructTokenURIParams)')).toBe(NFT_DESCRIPTOR);
        expect(toFunctionSelector(
            'constructTokenURI((uint256,address,address,string,string,uint8,uint8,bool,int24,int24,int24,int24,uint24,address))'
        )).not.toBe(NFT_DESCRIPTOR);
    });

    it('names the descriptor and refuses to offer it as a call', () =>
    {
        const [described] = describeFunctions([NFT_DESCRIPTOR]);
        expect(described!.name).toBe('constructTokenURI');
        expect(described!.signature).toBe('constructTokenURI(NFTDescriptor.ConstructTokenURIParams)');
        // Not view and not pure: a library runs at the address that delegatecalls it, so a Read
        // form here would encode a call that cannot work.
        expect(described!.mutability).toBe('library');
        expect(described!.outputs).toEqual(['string']);
    });
});

describe('naming a Uniswap V3 pool', () =>
{
    // A V3 deployment has one factory and thousands of POOLS, so this is the contract a reader
    // most often lands on from a swap - and every one of these was printed as four raw bytes.
    const POOL = [
        'slot0()', 'liquidity()', 'fee()', 'tickSpacing()', 'maxLiquidityPerTick()',
        'feeGrowthGlobal0X128()', 'feeGrowthGlobal1X128()', 'protocolFees()',
        'ticks(int24)', 'tickBitmap(int16)', 'positions(bytes32)', 'observations(uint256)',
        'observe(uint32[])', 'snapshotCumulativesInside(int24,int24)', 'initialize(uint160)',
        'mint(address,int24,int24,uint128,bytes)', 'burn(int24,int24,uint128)',
        'collect(address,int24,int24,uint128,uint128)', 'swap(address,bool,int256,uint160,bytes)',
        'flash(address,uint256,uint256,bytes)', 'increaseObservationCardinalityNext(uint16)',
        'setFeeProtocol(uint8,uint8)', 'collectProtocol(address,uint128,uint128)'
    ];

    it('names every function of the pool interface', () =>
    {
        const described = describeFunctions(POOL.map(toFunctionSelector));
        expect(described.filter(entry => entry.signature === '')).toEqual([]);

        // The one that carries the price. Seven return values, and without them a call to it
        // could be offered but never decoded.
        const slot0 = described.find(entry => entry.name === 'slot0')!;
        expect(slot0.mutability).toBe('view');
        expect(slot0.outputs).toEqual(['uint160', 'int24', 'uint16', 'uint16', 'uint16', 'uint8', 'bool']);

        // `swap` takes a callback: the pool calls back for payment, so it is a write even though
        // a reader might expect the quoter's shape here.
        expect(described.find(entry => entry.name === 'swap')!.mutability).toBe('nonpayable');
    });

    it('claims the pool only when the dispatcher answers the whole fingerprint', () =>
    {
        const selectors = POOL.map(toFunctionSelector);
        expect(detectStandards(selectors)).toContain('Uniswap V3 pool');
        // Drop `slot0` and it is no longer a pool: a badge is a claim about what the code does.
        expect(detectStandards(selectors.slice(1))).not.toContain('Uniswap V3 pool');
    });
});
