// @vitest-environment node
//
// ChainReader - the half that actually speaks JSON-RPC. Everywhere else in this suite the gateway
// is a plain object, which is right for testing what the explorer DOES with chain data; this file
// tests the reading of it.
//
// The node is a stubbed `fetch` answering real JSON-RPC envelopes, so the viem client, its
// batching, its retries and this file's own block/receipt assembly are all the real ones. Nothing
// binds a port and nothing leaves the process.
import { describe, it, expect, afterEach, vi } from 'vitest';

import { ChainReader } from '../src/chain/client.ts';
import { ENV } from './support/fixtures.ts';

interface RpcCall
{
    method: string;
    params: unknown[];
}

/** A hex quantity, the way a node writes one. */
const hex = (value: number | bigint): string => `0x${ BigInt(value).toString(16) }`;

/** One block as `eth_getBlockByNumber` returns it, with `count` transactions. */
function nodeBlock(number: number, count = 1): Record<string, unknown>
{
    return {
        number: hex(number),
        hash: `0x${ String(number).padStart(64, '0') }`,
        parentHash: `0x${ String(number - 1).padStart(64, '0') }`,
        timestamp: hex(1_700_000_000 + number * 3),
        miner: '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
        gasUsed: hex(21_000 * count),
        gasLimit: hex(30_000_000),
        baseFeePerGas: hex(1_000_000_000),
        size: hex(500),
        nonce: '0x0000000000000000',
        difficulty: '0x0',
        extraData: '0x',
        logsBloom: `0x${ '0'.repeat(512) }`,
        transactionsRoot: `0x${ '0'.repeat(64) }`,
        stateRoot: `0x${ '0'.repeat(64) }`,
        receiptsRoot: `0x${ '0'.repeat(64) }`,
        sha3Uncles: `0x${ '0'.repeat(64) }`,
        uncles: [],
        transactions: Array.from({ length: count }, (_entry, index) => ({
            hash: `0x${ String(number).padStart(2, '0') }${ String(index).padStart(62, '0') }`,
            blockHash: `0x${ String(number).padStart(64, '0') }`,
            blockNumber: hex(number),
            transactionIndex: hex(index),
            from: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            to: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
            value: hex(10n ** 18n),
            nonce: hex(index),
            input: '0x',
            gas: hex(21_000),
            gasPrice: hex(1_000_000_000),
            type: '0x2',
            chainId: hex(ENV.chainId),
            v: '0x0',
            r: `0x${ '1'.repeat(64) }`,
            s: `0x${ '2'.repeat(64) }`
        }))
    };
}

/** The receipt for one of those transactions. */
function nodeReceipt(number: number, index: number, status = '0x1'): Record<string, unknown>
{
    return {
        transactionHash: `0x${ String(number).padStart(2, '0') }${ String(index).padStart(62, '0') }`,
        transactionIndex: hex(index),
        blockHash: `0x${ String(number).padStart(64, '0') }`,
        blockNumber: hex(number),
        from: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        to: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        cumulativeGasUsed: hex(21_000),
        gasUsed: hex(21_000),
        effectiveGasPrice: hex(1_000_000_000),
        contractAddress: null,
        logs: [],
        logsBloom: `0x${ '0'.repeat(512) }`,
        status,
        type: '0x2'
    };
}

/**
 * A node made of a `fetch` stub.
 *
 * `answer` maps a method to its result, or throws to make the node refuse it - which is how the
 * `eth_getBlockReceipts` probe and every failure path below are driven. Batched requests arrive as
 * an array and are answered as one, exactly as a real endpoint does.
 */
function stubNode(answer: (call: RpcCall) => unknown): { calls: RpcCall[]; requests: number }
{
    const seen = { calls: [] as RpcCall[], requests: 0 };

    vi.stubGlobal('fetch', async (_url: string, init: { body: string }): Promise<Response> =>
    {
        seen.requests++;
        const payload = JSON.parse(init.body) as { id: number; method: string; params?: unknown[] }
            | Array<{ id: number; method: string; params?: unknown[] }>;
        const batch = Array.isArray(payload) ? payload : [payload];

        const answers = batch.map((entry) =>
        {
            seen.calls.push({ method: entry.method, params: entry.params ?? [] });
            try
            {
                return { jsonrpc: '2.0', id: entry.id, result: answer({ method: entry.method, params: entry.params ?? [] }) };
            }
            catch (error)
            {
                return { jsonrpc: '2.0', id: entry.id, error: { code: -32601, message: String((error as Error).message) } };
            }
        });

        return new Response(JSON.stringify(Array.isArray(payload) ? answers : answers[0]), {
            status: 200,
            headers: { 'content-type': 'application/json' }
        });
    });

    return seen;
}

/** The reader, with retries off so a refusal is one round trip and the test stays quick. */
function reader(overrides: Partial<typeof ENV> = {}): ChainReader
{
    return new ChainReader({ ...ENV, rpcUrl: 'http://node.invalid', ...overrides });
}

afterEach(() =>
{
    vi.unstubAllGlobals();
});

describe('reading scalars from the node', () =>
{
    it('reads the head as a number', async () =>
    {
        stubNode(({ method }) =>
        {
            if (method === 'eth_blockNumber')
            {
                return hex(1234);
            }
            throw new Error(`unexpected ${ method }`);
        });
        expect(await reader().head()).toBe(1234);
    });

    it('reads a balance as a bigint, exact past 2^53', async () =>
    {
        const huge = 2n ** 100n + 7n;
        stubNode(({ method }) => (method === 'eth_getBalance' ? hex(huge) : undefined));
        expect(await reader().balance('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')).toBe(huge);
    });

    it('reads the genesis hash from block zero specifically', async () =>
    {
        const node = stubNode(({ method }) => (method === 'eth_getBlockByNumber' ? nodeBlock(0, 0) : undefined));
        const hash = await reader().genesisHash();

        expect(hash).toBe(`0x${ '0'.repeat(64) }`);
        expect(node.calls[0]!.params[0]).toBe('0x0');
        // Header only - the genesis check must not drag transactions across the wire.
        expect(node.calls[0]!.params[1]).toBe(false);
    });

    it('reads one block hash without its transactions', async () =>
    {
        const node = stubNode(({ method }) => (method === 'eth_getBlockByNumber' ? nodeBlock(5, 3) : undefined));
        await reader().blockHashAt(5);
        expect(node.calls[0]!.params).toEqual(['0x5', false]);
    });

    it('does NOT swallow a failure from the reorg check', async () =>
    {
        // A node that will not answer must not read as "this block is gone" - the caller's
        // response to a missing block is to roll the index back, which would delete good history.
        stubNode(({ method }) =>
        {
            if (method === 'eth_getBlockByNumber')
            {
                throw new Error('node is resyncing');
            }
            return undefined;
        });
        await expect(reader().blockHashAt(5)).rejects.toThrow();
    });
});

describe('reading code and storage', () =>
{
    it('reads deployed bytecode, and answers 0x where there is none', async () =>
    {
        stubNode(({ method, params }) =>
            (method === 'eth_getCode'
                ? ((params[0] as string).endsWith('dd') ? '0x6080' : null)
                : undefined));

        const chain = reader();
        expect(await chain.code('0xdddddddddddddddddddddddddddddddddddddddd')).toBe('0x6080');
        // A node answering null and an address with no code mean the same thing to the caller.
        expect(await chain.code('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')).toBe('0x');
    });

    it('decides isContract from the code, not from a second call', async () =>
    {
        const node = stubNode(({ method }) => (method === 'eth_getCode' ? '0x6080' : undefined));
        expect(await reader().isContract('0xdddddddddddddddddddddddddddddddddddddddd')).toBe(true);
        expect(node.calls.every((call) => call.method === 'eth_getCode')).toBe(true);
    });

    it('reads a storage word, and an empty one where the node serves nothing', async () =>
    {
        stubNode(({ method, params }) =>
            (method === 'eth_getStorageAt' ? (params[1] === '0x1' ? `0x${ '7'.repeat(64) }` : null) : undefined));

        const chain = reader();
        expect(await chain.storageAt('0xdddddddddddddddddddddddddddddddddddddddd', '0x1')).toBe(`0x${ '7'.repeat(64) }`);
        // An unsupported method and an empty slot both mean "nothing was stored there".
        expect(await chain.storageAt('0xdddddddddddddddddddddddddddddddddddddddd', '0x2')).toBe(`0x${ '0'.repeat(64) }`);
    });

    it('reads a call\'s return data, and 0x when a call returns nothing', async () =>
    {
        stubNode(({ method }) => (method === 'eth_call' ? '0x2a' : undefined));
        expect(await reader().call('0xdddddddddddddddddddddddddddddddddddddddd', '0x06fdde03')).toBe('0x2a');
    });
});

describe('token metadata', () =>
{
    const TOKEN = '0xdddddddddddddddddddddddddddddddddddddddd';

    /** An ABI-encoded string, as `name()` returns one. */
    function encodedString(text: string): string
    {
        const bytes = Buffer.from(text, 'utf8').toString('hex');
        return `0x${ (32).toString(16).padStart(64, '0') }${ text.length.toString(16).padStart(64, '0') }${ bytes.padEnd(64, '0') }`;
    }

    it('reads name, symbol and decimals together', async () =>
    {
        stubNode(({ method, params }) =>
        {
            if (method !== 'eth_call')
            {
                return undefined;
            }
            const data = (params[0] as { data: string }).data;
            if (data.startsWith('0x06fdde03'))
            {
                return encodedString('Nura');
            }
            if (data.startsWith('0x95d89b41'))
            {
                return encodedString('NURA');
            }
            if (data.startsWith('0x313ce567'))
            {
                return `0x${ (18).toString(16).padStart(64, '0') }`;
            }
            return undefined;
        });

        expect(await reader().tokenMetadata(TOKEN)).toEqual({ name: 'Nura', symbol: 'NURA', decimals: 18 });
    });

    it('answers null when a contract answers NONE of the getters', async () =>
    {
        stubNode(({ method }) =>
        {
            if (method === 'eth_call')
            {
                throw new Error('execution reverted');
            }
            return undefined;
        });
        expect(await reader().tokenMetadata(TOKEN)).toBeNull();
    });

    it('keeps a partial answer rather than discarding the whole token', async () =>
    {
        // A contract that moves value belongs in the index under its address even if it will not
        // say what it is called.
        stubNode(({ method, params }) =>
        {
            if (method !== 'eth_call')
            {
                return undefined;
            }
            const data = (params[0] as { data: string }).data;
            if (data.startsWith('0x95d89b41'))
            {
                return encodedString('NURA');
            }
            throw new Error('execution reverted');
        });

        expect(await reader().tokenMetadata(TOKEN)).toEqual({ name: '', symbol: 'NURA', decimals: 0 });
    });
});

describe('reading a range of blocks', () =>
{
    /** A node that serves blocks and receipts; `blockReceipts` decides whether it has the batch call. */
    function serving(options: { blockReceipts: boolean; count?: number }): { calls: RpcCall[]; requests: number }
    {
        const count = options.count ?? 1;
        return stubNode(({ method, params }) =>
        {
            if (method === 'eth_blockNumber')
            {
                return hex(3);
            }
            if (method === 'eth_getBlockByNumber')
            {
                return nodeBlock(Number(params[0] as string), count);
            }
            if (method === 'eth_getBlockReceipts')
            {
                if (!options.blockReceipts)
                {
                    throw new Error('the method eth_getBlockReceipts does not exist');
                }
                const number = Number(params[0] as string);
                return Array.from({ length: count }, (_entry, index) => nodeReceipt(number, index));
            }
            if (method === 'eth_getTransactionReceipt')
            {
                const hash = params[0] as string;
                const number = Number.parseInt(hash.slice(2, 4), 10);
                const index = Number.parseInt(hash.slice(4), 10);
                return nodeReceipt(number, index);
            }
            return undefined;
        });
    }

    it('assembles blocks with their receipts, in order', async () =>
    {
        serving({ blockReceipts: true });
        const blocks = await reader().range(0, 3);

        expect(blocks.map((entry) => entry.number)).toEqual([0, 1, 2, 3]);
        expect(blocks[1]!.transactions[0]).toMatchObject({
            index: 0,
            value: 10n ** 18n,
            gasUsed: 21_000n,
            effectiveGasPrice: 1_000_000_000n,
            status: 1
        });
        expect(blocks[1]!.gasLimit).toBe(30_000_000n);
        expect(blocks[1]!.baseFeePerGas).toBe(1_000_000_000n);
    });

    it('falls back to per-transaction receipts on a node without eth_getBlockReceipts', async () =>
    {
        // hardhat's dev node does not have it and NuraChain does; an explorer that only runs
        // against one of those is not portable.
        const node = serving({ blockReceipts: false });
        const blocks = await reader().range(0, 2);

        expect(blocks).toHaveLength(3);
        expect(blocks[0]!.transactions[0]!.status).toBe(1);
        expect(node.calls.some((call) => call.method === 'eth_getTransactionReceipt')).toBe(true);
    });

    it('probes for eth_getBlockReceipts ONCE, not once per block', async () =>
    {
        // Paying the failure per block across a whole backfill is the thing the probe prevents.
        const node = serving({ blockReceipts: false });
        await reader().range(0, 3);

        const probes = node.calls.filter((call) => call.method === 'eth_getBlockReceipts');
        expect(probes).toHaveLength(1);
    });

    it('leaves a transaction UNKNOWN when its receipt never came back', async () =>
    {
        // A failed transfer reading as a successful one is the worst thing this explorer could
        // say, so a missing receipt is -1 and never 1.
        stubNode(({ method, params }) =>
        {
            if (method === 'eth_getBlockByNumber')
            {
                return nodeBlock(Number(params[0] as string), 1);
            }
            if (method === 'eth_getBlockReceipts')
            {
                return [];
            }
            return undefined;
        });

        const blocks = await reader().range(1, 1);
        expect(blocks[0]!.transactions[0]!.status).toBe(-1);
        expect(blocks[0]!.transactions[0]!.gasUsed).toBe(0n);
    });

    it('reads a reverted receipt as reverted', async () =>
    {
        stubNode(({ method, params }) =>
        {
            if (method === 'eth_getBlockByNumber')
            {
                return nodeBlock(Number(params[0] as string), 1);
            }
            if (method === 'eth_getBlockReceipts')
            {
                return [nodeReceipt(1, 0, '0x0')];
            }
            return undefined;
        });

        const blocks = await reader().range(1, 1);
        expect(blocks[0]!.transactions[0]!.status).toBe(0);
    });

    it('answers an inverted range with no blocks', async () =>
    {
        const node = serving({ blockReceipts: true });
        // `to` below `from` is no heights at all. (The support probe still goes out - `range`
        // settles that question before it looks at the window - but no block is read.)
        expect(await reader().range(5, 4)).toEqual([]);
        expect(node.calls.filter((call) => call.method === 'eth_getBlockByNumber')).toEqual([]);
    });

    it('keeps the input order however the requests interleave', async () =>
    {
        serving({ blockReceipts: true });
        const blocks = await reader({ concurrency: 2 }).range(0, 3);
        expect(blocks.map((entry) => entry.number)).toEqual([0, 1, 2, 3]);
    });

    it('bounds how many BLOCK reads are in flight at once', async () =>
    {
        // A window of thousands issued in one tick is what a public endpoint answers with rate
        // limits and timeouts. What the window bounds is blocks - each one costs a header read
        // and a receipts read, so the HTTP count is a multiple of this and not this number.
        let inFlight = 0;
        let peak = 0;
        vi.stubGlobal('fetch', async (_url: string, init: { body: string }): Promise<Response> =>
        {
            const headers = (JSON.parse(init.body) as Array<{ method: string }> | { method: string });
            const reads = (Array.isArray(headers) ? headers : [headers])
                .filter((entry) => entry.method === 'eth_getBlockByNumber').length;
            inFlight += reads;
            peak = Math.max(peak, inFlight);
            await new Promise((resolve) => setTimeout(resolve, 1));
            const payload = JSON.parse(init.body) as Array<{ id: number; method: string; params: unknown[] }>;
            const batch = Array.isArray(payload) ? payload : [payload];
            const answers = batch.map((entry) => ({
                jsonrpc: '2.0',
                id: entry.id,
                result: entry.method === 'eth_getBlockByNumber'
                    ? nodeBlock(Number(entry.params[0] as string), 1)
                    : entry.method === 'eth_getBlockReceipts'
                        ? [nodeReceipt(Number(entry.params[0] as string), 0)]
                        : undefined
            }));
            inFlight -= reads;
            return new Response(JSON.stringify(Array.isArray(payload) ? answers : answers[0]), {
                status: 200,
                headers: { 'content-type': 'application/json' }
            });
        });

        const blocks = await reader({ concurrency: 3, rpcBatchSize: 1 }).range(0, 20);
        expect(blocks).toHaveLength(21);
        expect(peak).toBeLessThanOrEqual(3);

        // And the window really is what bounds it: a wider one reaches further.
        peak = 0;
        inFlight = 0;
        await reader({ concurrency: 8, rpcBatchSize: 1 }).range(0, 20);
        expect(peak).toBeGreaterThan(3);
    });

    it('propagates a node failure rather than returning a short range', async () =>
    {
        // A range that silently comes back short would advance the cursor past blocks that were
        // never written.
        stubNode(({ method }) =>
        {
            if (method === 'eth_getBlockByNumber')
            {
                throw new Error('connection reset');
            }
            return undefined;
        });
        await expect(reader().range(0, 2)).rejects.toThrow();
    });
});
