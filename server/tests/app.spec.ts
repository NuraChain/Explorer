// The API and the index it reads, against a STUBBED chain - deterministic, no network, and the
// only way to exercise the paths a live node will not reproduce on demand (a reorg, a receipt the
// node never returned, an address with more rows than one page).
import { describe, it, expect } from 'vitest';
import { toFunctionSelector } from 'viem';

import { buildApp } from '../src/app.ts';
import { analyze, describeFunctions, detectStandards } from '../src/chain/contract.ts';
import { encodeCall } from '../src/chain/values.ts';
import { functionsOfAbi } from '../src/verify/abi.ts';
import { compareDeployed, unlinkedLibraries } from '../src/verify/match.ts';
import { syncOnce } from '../src/chain/indexer.ts';
import { IndexStore, TRANSFER_TOPIC } from '../src/chain/store.ts';
import { classify, meanBlockTime, pageCount, presentTransaction } from '../src/present.ts';
import { CompilerSupply } from '../src/verify/compilers.ts';
import { SourceStore } from '../src/verify/store.ts';
import { Verifier, type CompileFn } from '../src/verify/verify.ts';
import type { BlockWithReceipts, ChainEnv, ChainGateway } from '../src/chain/client.ts';
import type {
    Account,
    BlockPage,
    CompilerList,
    ContractCalldata,
    ContractCallResult,
    ContractDetail,
    ContractSource,
    SearchResult,
    Summary,
    TransactionPage,
    TransferPage,
    VerifyResult
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
        balance: async () => 5n * 10n ** 18n,
        isContract: async address => codeAt(address) !== '0x',
        code: async address => codeAt(address),
        storageAt: async () => `0x${ '0'.repeat(64) }`,
        // Silence by default: a getter that answers is stubbed only where that IS the subject.
        call: stub.call ?? (async () => '0x')
    };
}

const silent = { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined } as never;

/**
 * The verification half, wired to nothing.
 *
 * Most of this file is about the chain and the index, and neither knows that source verification
 * exists - but the app is built from one set of dependencies, so these three have to be there.
 * The supply is pointed at a fetch that always refuses, which is what an air-gapped deployment
 * looks like and what a test must look like: no build is ever downloaded here.
 */
function verifying(
    chain: ChainGateway,
    compile: CompileFn = async () => '{"contracts":{}}',
    supply: CompilerSupply = offlineSupply()
): { sources: SourceStore; supply: CompilerSupply; verifier: Verifier }
{
    const sources = new SourceStore(':memory:');
    return { sources, supply, verifier: new Verifier({ chain, sources, supply, compile }) };
}

/** A supply with nothing on disk and nothing reachable - an air-gapped host, and every test. */
function offlineSupply(): CompilerSupply
{
    return new CompilerSupply({ directory: NO_BUILDS, fetchImpl: async () => new Response('', { status: 503 }) });
}

/** A supply that lists one release and can never download it - enough to name a build. */
function listingSupply(): CompilerSupply
{
    const list = JSON.stringify({
        builds: [{ path: 'solc-0.8.24.js', version: '0.8.24', longVersion: '0.8.24+commit.e11b9ed9', sha256: '0x00' }],
        releases: { '0.8.24': 'solc-0.8.24.js' }
    });
    return new CompilerSupply({
        directory: NO_BUILDS,
        fetchImpl: async (target) => String(target).endsWith('list.json')
            ? new Response(list, { status: 200 })
            : new Response('', { status: 503 })
    });
}

/** A directory that does not exist, so no test ever picks up a compiler somebody left lying about. */
const NO_BUILDS = './.data/tests-have-no-compilers';

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
        const app = buildApp({ dev: false, store, chain, ...verifying(chain) });
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

    it('serves a token contract its OWN transfers rather than an empty ledger', async () =>
    {
        const { store, chain } = await indexed([...CHAIN, tokenBlock(3, '0xb2', '0xb3')]);
        const app = buildApp({ dev: false, store, chain, ...verifying(chain) });
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
        const app = buildApp({ dev: false, store, chain, ...verifying(chain) });
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
        const app = buildApp({ dev: false, store, chain, ...verifying(chain) });
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
        const app = buildApp({ dev: false, store, chain, ...verifying(chain) });
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

describe('recompiling submitted source against the chain', () =>
{
    const DEPLOYED = '0xdddddddddddddddddddddddddddddddddddddddd';

    /** A short runtime body, and the CBOR trailer solc appends after it. */
    const CODE_BODY = '6080604052348015600e575f80fd5b50';
    const TRAILER = `a2646970667358221220${ 'ab'.repeat(32) }64736f6c634300081800330035`;
    const OTHER_TRAILER = `a2646970667358221220${ 'cd'.repeat(32) }64736f6c634300081800330035`;

    /** The ABI of a function no published standard claims - the whole point of verifying. */
    const ABI = [{
        type: 'function',
        name: 'mintTo',
        inputs: [{ name: 'to', type: 'address' }],
        outputs: [],
        stateMutability: 'nonpayable'
    }];

    const MINT_TO = toFunctionSelector('mintTo(address)');

    /** solc's standard output, with one contract whose deployed bytecode is `object`. */
    function compiled(object: string, name = 'Token'): string
    {
        return JSON.stringify({
            contracts: { 'Token.sol': { [name]: { abi: ABI, evm: { deployedBytecode: { object } } } } }
        });
    }

    const SUBMISSION = {
        kind: 'single',
        compiler: '0.8.24',
        name: 'Token',
        fileName: 'Token.sol',
        source: '// SPDX-License-Identifier: MIT\ncontract Token { }',
        optimizer: true,
        runs: 200,
        evmVersion: '',
        license: 'MIT'
    };

    /** An app whose compiler answers with `output`, over an index that holds this deployment. */
    async function verifiable(output: string, onchain: string): Promise<ReturnType<typeof buildApp>>
    {
        const creation = block(0, '0x00', '0xc0');
        creation.transactions[0] = {
            ...creation.transactions[0]!, to: null, value: 0n, inputSize: 120, contractAddress: DEPLOYED
        };
        const { store, chain } = await indexed([creation], { code: { [DEPLOYED]: onchain } });
        return buildApp({
            dev: false,
            store,
            chain,
            ...verifying(chain, async () => output, listingSupply())
        });
    }

    function submit(app: ReturnType<typeof buildApp>, body: unknown = SUBMISSION, address = DEPLOYED): Promise<Response>
    {
        return app.handle(new Request(`http://local/api/address/${ address }/verify`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body)
        }));
    }

    it('compares the RUNTIME code, so nothing has to supply constructor arguments', () =>
    {
        const code = `0x${ CODE_BODY }${ TRAILER }`;
        expect(compareDeployed(code, code)).toBe('full');
    });

    it('calls it a partial match when only the metadata trailer differs', () =>
    {
        // Same instructions, different hash of the source's own description - a moved comment, a
        // different file path. The code is the deployed code; the source is not proven identical.
        expect(compareDeployed(`0x${ CODE_BODY }${ TRAILER }`, `0x${ CODE_BODY }${ OTHER_TRAILER }`)).toBe('partial');
    });

    it('ignores the bytes an immutable occupies, which the constructor writes', () =>
    {
        // solc emits zeros where an immutable goes and says exactly where; the chain holds the
        // value the constructor put there. Comparing those bytes would fail every such contract.
        const onchain = `0x${ CODE_BODY.slice(0, 8) }deadbeef${ CODE_BODY.slice(16) }${ TRAILER }`;
        const output = `${ CODE_BODY.slice(0, 8) }00000000${ CODE_BODY.slice(16) }${ TRAILER }`;

        expect(compareDeployed(onchain, output)).toBeNull();
        expect(compareDeployed(onchain, output, { '7': [{ start: 4, length: 4 }] })).toBe('full');
    });

    it('refuses code that is simply a different contract', () =>
    {
        expect(compareDeployed(`0x${ CODE_BODY }${ TRAILER }`, `60006000${ CODE_BODY }${ TRAILER }`)).toBeNull();
    });

    it('spots a library placeholder the linker never filled in', () =>
    {
        // Blanking those twenty bytes would make it match, and would mean not checking the part a
        // reader most wants checked - so they are reported and the submission is refused.
        expect(unlinkedLibraries(`6080__$${ 'a'.repeat(34) }$__6040`)).toHaveLength(1);
        expect(unlinkedLibraries(`0x${ CODE_BODY }`)).toEqual([]);
    });

    it('names a selector no standard claims, from the ABI the source produced', () =>
    {
        const functions = functionsOfAbi(JSON.stringify(ABI));

        expect(functions.get(MINT_TO)?.signature).toBe('mintTo(address)');
        // Not a guess about state: an ABI entry with no `stateMutability` is a write, and a wrong
        // `view` would put a transaction behind a Query button.
        expect(functions.get(MINT_TO)?.mutability).toBe('nonpayable');
    });

    it('encodes a struct argument from the components the ABI carries', () =>
    {
        const functions = functionsOfAbi(JSON.stringify([{
            type: 'function',
            name: 'pay',
            stateMutability: 'nonpayable',
            outputs: [],
            inputs: [{
                name: 'order',
                type: 'tuple',
                components: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }]
            }]
        }]));
        const entry = functions.get(toFunctionSelector('pay((address,uint256))'))!;

        // Printed the way a signature writes it; encoded from the components, because the printed
        // form alone cannot be turned back into a tuple.
        expect(entry.inputs).toEqual(['(address,uint256)']);
        const data = encodeCall(entry, [JSON.stringify([BOB, '5'])]);
        expect(data.slice(10, 74)).toBe(BOB.slice(2).padStart(64, '0'));
        expect(BigInt(`0x${ data.slice(74) }`)).toBe(5n);
    });

    it('accepts source that reproduces the deployed bytecode, and names its functions after', async () =>
    {
        const code = `0x${ CODE_BODY }${ TRAILER }`;
        const app = await verifiable(compiled(code), code);

        const result = (await (await submit(app)).json()) as VerifyResult;
        expect(result.ok).toBe(true);
        expect(result.match).toBe('full');
        expect(result.name).toBe('Token');

        // The half that matters to a reader: the page now knows what this contract's own
        // functions are called, which no table of published signatures could have told it.
        const detail = (await (await app.handle(new Request(`http://local/api/address/${ DEPLOYED }/contract`))).json()) as ContractDetail;
        expect(detail.verified?.name).toBe('Token');
        expect(detail.verified?.match).toBe('full');
        expect(detail.functions.map(entry => entry.name)).toContain('mintTo');
    });

    it('refuses source whose bytecode is not the one at the address', async () =>
    {
        const app = await verifiable(compiled(`0x6001${ CODE_BODY }${ TRAILER }`), `0x${ CODE_BODY }${ TRAILER }`);

        const result = (await (await submit(app)).json()) as VerifyResult;
        expect(result.ok).toBe(false);
        expect(result.match).toBe('none');

        // Nothing was stored, so the page still says no source has been published.
        const detail = (await (await app.handle(new Request(`http://local/api/address/${ DEPLOYED }/contract`))).json()) as ContractDetail;
        expect(detail.verified).toBeNull();
    });

    it('reports what the compiler said when the source does not compile', async () =>
    {
        const app = await verifiable(
            JSON.stringify({ errors: [{ severity: 'error', formattedMessage: 'ParserError: expected ;' }] }),
            `0x${ CODE_BODY }${ TRAILER }`);

        const result = (await (await submit(app)).json()) as VerifyResult;
        expect(result.ok).toBe(false);
        expect(result.errors[0]).toContain('ParserError');
    });

    it('refuses an address that holds no code', async () =>
    {
        const app = await verifiable(compiled(`0x${ CODE_BODY }${ TRAILER }`), `0x${ CODE_BODY }${ TRAILER }`);
        expect((await submit(app, SUBMISSION, BOB)).status).toBe(400);
    });

    it('will not encode a call it cannot name, and will once the source names it', async () =>
    {
        const code = `0x${ CODE_BODY }${ TRAILER }`;
        const app = await verifiable(compiled(code), code);

        const calldata = (): Promise<Response> => app.handle(new Request(`http://local/api/address/${ DEPLOYED }/calldata`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ selector: MINT_TO, args: [BOB] })
        }));

        // No published standard claims this selector, so before verification there is no way to
        // know what arguments it takes - and a guess would become calldata somebody signs.
        expect((await calldata()).status).toBe(400);

        await submit(app);

        const encoded = (await (await calldata()).json()) as ContractCalldata;
        expect(encoded.data.slice(0, 10)).toBe(MINT_TO);
        expect(encoded.data.slice(10)).toBe(BOB.slice(2).padStart(64, '0'));
    });

    it('serves the source it stored, and says plainly when there is none', async () =>
    {
        const code = `0x${ CODE_BODY }${ TRAILER }`;
        const app = await verifiable(compiled(code), code);
        const source = (): Promise<Response> => app.handle(new Request(`http://local/api/address/${ DEPLOYED }/source`));

        expect(((await (await source()).json()) as ContractSource).verified).toBe(false);

        await submit(app);

        const published = (await (await source()).json()) as ContractSource;
        expect(published.verified).toBe(true);
        expect(published.license).toBe('MIT');
        expect(published.optimizer).toBe(true);
        expect(published.files[0]?.path).toBe('Token.sol');
        expect(published.files[0]?.content).toContain('contract Token');
    });

    it('offers no compiler it cannot produce, and says the host was unreachable', async () =>
    {
        // An air-gapped deployment with an empty SOLC_DIR. `offline` is not an error - it is what
        // the form has to say instead of showing an empty list that reads as broken.
        const { store, chain } = await indexed(CHAIN);
        const app = buildApp({ dev: false, store, chain, ...verifying(chain) });

        const list = (await (await app.handle(new Request('http://local/api/compilers'))).json()) as CompilerList;
        expect(list.versions).toEqual([]);
        expect(list.offline).toBe(true);
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

    it('claims a pair only when the dispatcher answers every one of its calls', () =>
    {
        const full = PAIR.map(toFunctionSelector);
        expect(detectStandards(full)).toContain('Uniswap V2 pair');
        expect(detectStandards(full.slice(1))).not.toContain('Uniswap V2 pair');
        expect(detectStandards(MULTICALL.map(toFunctionSelector))).toContain('Multicall3');
    });
});
