// The RPC cache, against a COUNTING stub - the only way to assert the thing that matters, which
// is not what the cache returns but how many times it went to the node to find out.
import { describe, it, expect } from 'vitest';

import { CachedChain, DEFAULT_CACHE, TtlCache, type CacheOptions } from '../src/chain/cache.ts';
import type { BlockWithReceipts, ChainEnv, ChainGateway } from '../src/chain/client.ts';

const ENV: ChainEnv = {
    rpcUrl: 'stub', chainId: 1020, name: 'NuraChain', symbol: 'NURA', decimals: 18, siteUrl: '', explorerUrl: '',
    startBlock: 0, pollMs: 1000, batchSize: 10, concurrency: 4, rpcBatchSize: 10, dbPath: ':memory:'
};

const CONTRACT = '0xcccccccccccccccccccccccccccccccccccccccc';
const WALLET = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

/** A gateway that counts every call it is asked to make, and can be told to fail. */
function counting(overrides: Partial<ChainGateway> = {}): ChainGateway & { calls: Record<string, number> }
{
    const calls: Record<string, number> = {};
    const tick = (name: string): void =>
    {
        calls[name] = (calls[name] ?? 0) + 1;
    };
    /** Counts the call under `name`, then answers `value`. */
    const answers = <T>(name: string, value: T) => async (): Promise<T> =>
    {
        tick(name);
        return value;
    };

    const base: ChainGateway = {
        env: ENV,
        head: answers('head', 100),
        range: answers('range', [] as BlockWithReceipts[]),
        genesisHash: answers('genesisHash', '0xgenesis'),
        blockHashAt: answers('blockHashAt', '0xhash' as string | null),
        tokenMetadata: answers('tokenMetadata', null),
        balance: answers('balance', 7n),
        isContract: answers('isContract', true),
        storageAt: answers('storageAt', `0x${ '0'.repeat(64) }`),
        call: answers('call', '0x01'),
        code: async (address) =>
        {
            tick('code');
            return address.toLowerCase() === CONTRACT ? '0x6080' : '0x';
        }
    };
    return { ...base, ...overrides, calls };
}

/** The defaults with every span made tiny, so a test can outlive one without sleeping long. */
function brief(overrides: Partial<CacheOptions> = {}): CacheOptions
{
    return { ...DEFAULT_CACHE, headMs: 20, balanceMs: 20, callMs: 20, storageMs: 20, codeAbsentMs: 20, ...overrides };
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe('the TTL cache itself', () =>
{
    it('collapses concurrent misses for one key into a single load', async () =>
    {
        const cache = new TtlCache<number>();
        let loads = 0;
        const load = async (): Promise<number> =>
        {
            loads++;
            await wait(5);
            return 42;
        };

        // Issued in the same tick, so none of them can see another's stored value - only the
        // in-flight map can save the extra calls.
        const answers = await Promise.all(Array.from({ length: 20 }, () => cache.read('k', 1000, load)));
        expect(answers).toEqual(Array.from({ length: 20 }, () => 42));
        expect(loads).toBe(1);
    });

    it('does not remember a failed load', async () =>
    {
        const cache = new TtlCache<number>();
        let attempts = 0;
        const flaky = async (): Promise<number> =>
        {
            attempts++;
            if (attempts === 1)
            {
                throw new Error('the node dropped it');
            }
            return 9;
        };

        await expect(cache.read('k', 1000, flaky)).rejects.toThrow('the node dropped it');
        // The retry must reach the node: a cached rejection would make one dropped connection
        // into a minute of failures for everybody.
        await expect(cache.read('k', 1000, flaky)).resolves.toBe(9);
        expect(attempts).toBe(2);
    });

    it('serves a value until its span runs out, then loads again', async () =>
    {
        const cache = new TtlCache<number>();
        let loads = 0;
        const load = async (): Promise<number> =>
        {
            loads++;
            return loads;
        };

        expect(await cache.read('k', 15, load)).toBe(1);
        expect(await cache.read('k', 15, load)).toBe(1);
        await wait(25);
        expect(await cache.read('k', 15, load)).toBe(2);
    });

    it('never grows past its bound, and drops the least recently used key', async () =>
    {
        const cache = new TtlCache<string>(3);
        const load = (value: string) => async (): Promise<string> => value;

        await cache.read('a', 1000, load('a'));
        await cache.read('b', 1000, load('b'));
        await cache.read('c', 1000, load('c'));
        // Touching 'a' makes 'b' the oldest, so the fourth key evicts 'b' rather than 'a'.
        await cache.read('a', 1000, load('a'));
        await cache.read('d', 1000, load('d'));

        expect(cache.stats().size).toBe(3);
        const before = cache.stats().misses;
        await cache.read('a', 1000, load('a'));
        expect(cache.stats().misses).toBe(before);
        await cache.read('b', 1000, load('b'));
        expect(cache.stats().misses).toBe(before + 1);
    });

    it('does not store a value whose span is zero', async () =>
    {
        const cache = new TtlCache<number>();
        let loads = 0;
        const load = async (): Promise<number> =>
        {
            loads++;
            return 1;
        };
        await cache.read('k', 0, load);
        await cache.read('k', 0, load);
        expect(loads).toBe(2);
    });
});

describe('the cache in front of the node', () =>
{
    it('asks the node once for a head every page on the site wants', async () =>
    {
        const node = counting();
        const chain = new CachedChain(node, brief());

        expect(await chain.head()).toBe(100);
        await Promise.all([chain.head(), chain.head(), chain.head()]);
        expect(node.calls.head).toBe(1);

        await wait(30);
        expect(await chain.head()).toBe(100);
        expect(node.calls.head).toBe(2);
    });

    it('holds deployed bytecode far longer than the absence of it', async () =>
    {
        const node = counting();
        const chain = new CachedChain(node, brief());

        // A contract: the code is there, so it is there for good.
        await chain.code(CONTRACT);
        await wait(30);
        await chain.code(CONTRACT);
        expect(node.calls.code).toBe(1);

        // An ordinary account: '0x' is only news that has not arrived yet, so it expires.
        await chain.code(WALLET);
        expect(node.calls.code).toBe(2);
        await wait(30);
        await chain.code(WALLET);
        expect(node.calls.code).toBe(3);
    });

    it('answers isContract from the code it already read', async () =>
    {
        const node = counting();
        const chain = new CachedChain(node, brief());

        expect(await chain.isContract(CONTRACT)).toBe(true);
        expect(await chain.code(CONTRACT)).toBe('0x6080');
        // One read of the code answers both questions, and the gateway's own isContract - which
        // would be a second round trip - is never reached.
        expect(node.calls.code).toBe(1);
        expect(node.calls.isContract).toBeUndefined();
    });

    it('keys a call by its calldata, not by the contract alone', async () =>
    {
        const node = counting();
        const chain = new CachedChain(node, brief());

        await chain.call(CONTRACT, '0x06fdde03');
        await chain.call(CONTRACT, '0x06fdde03');
        expect(node.calls.call).toBe(1);

        // A different getter on the same contract is a different question.
        await chain.call(CONTRACT, '0x95d89b41');
        expect(node.calls.call).toBe(2);
    });

    it('keys a storage read by its slot, and a balance by its address', async () =>
    {
        const node = counting();
        const chain = new CachedChain(node, brief());

        await chain.storageAt(CONTRACT, '0x01');
        await chain.storageAt(CONTRACT, '0x01');
        await chain.storageAt(CONTRACT, '0x02');
        expect(node.calls.storageAt).toBe(2);

        await Promise.all([chain.balance(WALLET), chain.balance(WALLET), chain.balance(CONTRACT)]);
        expect(node.calls.balance).toBe(2);
    });

    it('reads an address the same way however it was capitalised', async () =>
    {
        const node = counting();
        const chain = new CachedChain(node, brief());

        await chain.balance(WALLET);
        await chain.balance(WALLET.toUpperCase().replace('0X', '0x'));
        expect(node.calls.balance).toBe(1);
    });

    it('NEVER caches the reorg check or the backfill', async () =>
    {
        const node = counting();
        const chain = new CachedChain(node, brief());

        await chain.blockHashAt(7);
        await chain.blockHashAt(7);
        await chain.blockHashAt(7);
        // Three asks, three answers from the node: this call exists to notice that the node
        // changed its mind about a height, and a cache would hide exactly that.
        expect(node.calls.blockHashAt).toBe(3);

        await chain.range(0, 10);
        await chain.range(0, 10);
        expect(node.calls.range).toBe(2);
    });

    it('holds the genesis hash for the life of the process', async () =>
    {
        const node = counting();
        const chain = new CachedChain(node, brief());

        await chain.genesisHash();
        await wait(30);
        await chain.genesisHash();
        expect(node.calls.genesisHash).toBe(1);
    });

    it('caches the answer that a contract is not a token', async () =>
    {
        const node = counting();
        const chain = new CachedChain(node, brief());

        await chain.tokenMetadata(CONTRACT);
        await chain.tokenMetadata(CONTRACT);
        // `null` cost three failed getter calls to learn; it is an answer, and it is held.
        expect(node.calls.tokenMetadata).toBe(1);
    });

    it('goes straight to the node when it is switched off', async () =>
    {
        const node = counting();
        const chain = new CachedChain(node, { ...DEFAULT_CACHE, enabled: false });

        await chain.head();
        await chain.head();
        await chain.balance(WALLET);
        await chain.balance(WALLET);
        await chain.code(CONTRACT);
        await chain.code(CONTRACT);

        expect(node.calls.head).toBe(2);
        expect(node.calls.balance).toBe(2);
        expect(node.calls.code).toBe(2);
    });

    it('lets a single span be disabled without disabling the rest', async () =>
    {
        const node = counting();
        const chain = new CachedChain(node, brief({ balanceMs: 0 }));

        await chain.balance(WALLET);
        await chain.balance(WALLET);
        expect(node.calls.balance).toBe(2);

        await chain.head();
        await chain.head();
        expect(node.calls.head).toBe(1);
    });

    it('retries a balance the node refused rather than serving the failure', async () =>
    {
        let attempts = 0;
        const node = counting({
            balance: async () =>
            {
                attempts++;
                if (attempts === 1)
                {
                    throw new Error('rate limited');
                }
                return 3n;
            }
        });
        const chain = new CachedChain(node, brief());

        await expect(chain.balance(WALLET)).rejects.toThrow('rate limited');
        await expect(chain.balance(WALLET)).resolves.toBe(3n);
    });
});
