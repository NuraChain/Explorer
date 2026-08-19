import { flag, loadConfig, num } from '@azerothjs/http';

import type { BlockWithReceipts, ChainEnv, ChainGateway } from './client.ts';

// A read-through cache in front of the node, for the calls the API repeats.
//
// The index answers history; the NODE answers the live facts - a balance, a contract's code, what
// its getters return right now. Those are the reads that repeat: every visitor to the home page
// asks for the same head, every visitor to a popular token asks for the same bytecode, and the
// rich list asks for a thousand balances every time it is rebuilt. None of that changes between
// two requests a hundred milliseconds apart, so paying a round trip for each is paying for the
// same answer twice.
//
// Two mechanisms, and the second one matters more than the first:
//
//   - A TTL per KIND of read, because the reads do not age alike. Deployed bytecode is immutable;
//     a balance is stale the moment a block lands. One global TTL would have to be short enough
//     for the balance, which throws away the bytecode's whole benefit.
//   - SINGLE FLIGHT: concurrent callers asking for the same key share one in-flight request. This
//     is not a staleness trade at all - the answers would have been identical, because they are
//     the same call at the same instant - so it is always safe, and it is what keeps a burst of
//     traffic from turning into a burst of RPC.
//
// What is deliberately NOT cached: `range`, `blockHashAt` and the head the INDEXER polls. Those
// belong to the sync path, where a stale answer is not a slightly old number but a missed reorg -
// the check exists precisely to notice that the node changed its mind. See main.ts: the indexer
// keeps the raw reader and only the API reads through this.

/** One cached answer and the moment it stops being served. */
interface Entry<T>
{
    value: T;
    until: number;
}

/** How long a value stays fresh: a fixed span, or one chosen from the value itself. */
export type Ttl<T> = number | ((value: T) => number);

/**
 * A bounded TTL cache that collapses concurrent misses into one load.
 *
 * Bounded because the keys are attacker-chosen: an address is 20 bytes of anything, so a scan of
 * random addresses would grow an unbounded map until the process died. Eviction is LRU by way of
 * Map insertion order - a hit re-inserts, so the oldest key in iteration order is genuinely the
 * least recently used one.
 */
export class TtlCache<T>
{
    readonly #entries = new Map<string, Entry<T>>();

    /** In-flight loads, so N callers for one key make one call. Never holds a settled promise. */
    readonly #inflight = new Map<string, Promise<T>>();

    readonly #max: number;

    #hits = 0;
    #misses = 0;

    constructor(max = 4096)
    {
        this.#max = Math.max(1, max);
    }

    /** Hits and misses since boot, for the health endpoint and for tests. */
    public stats(): { size: number; hits: number; misses: number }
    {
        return { size: this.#entries.size, hits: this.#hits, misses: this.#misses };
    }

    public clear(): void
    {
        this.#entries.clear();
        this.#inflight.clear();
    }

    /** The cached value for `key`, loading and storing it when there is none that is still fresh. */
    public async read(key: string, ttl: Ttl<T>, load: () => Promise<T>): Promise<T>
    {
        const now = Date.now();
        const held = this.#entries.get(key);
        if (held !== undefined && held.until > now)
        {
            // Re-inserted so it moves to the young end of the eviction order.
            this.#entries.delete(key);
            this.#entries.set(key, held);
            this.#hits++;
            return held.value;
        }

        const running = this.#inflight.get(key);
        if (running !== undefined)
        {
            // Joining a call already on the wire, NOT serving a stale value: same key, same
            // instant, same answer.
            this.#hits++;
            return running;
        }

        this.#misses++;
        const pending = load().then((value) =>
        {
            const span = typeof ttl === 'function' ? ttl(value) : ttl;
            if (span > 0)
            {
                this.#store(key, value, span);
            }
            return value;
        });

        // A rejected load is never stored and never remembered: the next caller retries rather
        // than inheriting somebody else's dropped connection. `finally` runs on both paths, so
        // the key cannot leak into the in-flight map forever.
        this.#inflight.set(key, pending);
        try
        {
            return await pending;
        }
        finally
        {
            this.#inflight.delete(key);
        }
    }

    #store(key: string, value: T, ttlMs: number): void
    {
        this.#entries.delete(key);
        this.#entries.set(key, { value, until: Date.now() + ttlMs });
        while (this.#entries.size > this.#max)
        {
            const oldest = this.#entries.keys().next();
            if (oldest.done === true)
            {
                break;
            }
            this.#entries.delete(oldest.value);
        }
    }
}

/**
 * How long each kind of read stays fresh, in milliseconds. Zero disables caching for that kind.
 *
 * The spans are not guesses about the network; they are statements about what the VALUE is:
 * bytecode at an address cannot change, a balance changes with every block that touches it.
 */
export interface CacheOptions
{
    enabled: boolean;

    /** Entries per cache, across all four. */
    maxEntries: number;

    /** The node's head height. Below one block time, so a reader still watches the chain move. */
    headMs: number;

    /** A native balance. The freshest thing here, because a wrong balance is a wrong answer. */
    balanceMs: number;

    /** An `eth_call` return. A getter's answer is live state, so this stays short. */
    callMs: number;

    /** One storage word - the proxy pointers. Live state, and upgrades are rare but real. */
    storageMs: number;

    /**
     * Deployed bytecode. Effectively immutable: since EIP-6780 selfdestruct only clears code in
     * the same transaction that created it, so code seen at an address is code that stays.
     */
    codeMs: number;

    /**
     * The ABSENCE of code, held far shorter than its presence. An account with no code today can
     * be a contract tomorrow - caching '0x' for ten minutes would report a freshly deployed
     * contract as an ordinary account for ten minutes.
     */
    codeAbsentMs: number;

    /** A token's name/symbol/decimals. Set in the constructor and never written again. */
    tokenMs: number;
}

export const DEFAULT_CACHE: CacheOptions = {
    enabled: true,
    maxEntries: 4096,
    headMs: 1_000,
    balanceMs: 2_000,
    callMs: 2_000,
    storageMs: 2_000,
    codeMs: 600_000,
    codeAbsentMs: 5_000,
    tokenMs: 600_000
};

/** Reads the cache spans from the environment. Every one has a default; none has to be set. */
export function loadCacheOptions(): CacheOptions
{
    return loadConfig({
        enabled: flag('RPC_CACHE', { default: DEFAULT_CACHE.enabled }),
        maxEntries: num('RPC_CACHE_MAX', { default: DEFAULT_CACHE.maxEntries }),
        headMs: num('RPC_CACHE_HEAD_MS', { default: DEFAULT_CACHE.headMs }),
        balanceMs: num('RPC_CACHE_BALANCE_MS', { default: DEFAULT_CACHE.balanceMs }),
        callMs: num('RPC_CACHE_CALL_MS', { default: DEFAULT_CACHE.callMs }),
        storageMs: num('RPC_CACHE_STORAGE_MS', { default: DEFAULT_CACHE.storageMs }),
        codeMs: num('RPC_CACHE_CODE_MS', { default: DEFAULT_CACHE.codeMs }),
        codeAbsentMs: num('RPC_CACHE_CODE_ABSENT_MS', { default: DEFAULT_CACHE.codeAbsentMs }),
        tokenMs: num('RPC_CACHE_TOKEN_MS', { default: DEFAULT_CACHE.tokenMs })
    });
}

type TokenMeta = { name: string; symbol: string; decimals: number } | null;

/**
 * A {@link ChainGateway} that answers the repeated reads from memory.
 *
 * A decorator rather than a change inside {@link ChainReader}, for two reasons: the sync path can
 * then hold the UNCACHED reader while the API holds this one, and the tests' stub gateway can be
 * wrapped in it to assert the caching itself without a node.
 */
export class CachedChain implements ChainGateway
{
    public readonly env: ChainEnv;

    readonly #inner: ChainGateway;
    readonly #options: CacheOptions;

    readonly #scalars = new TtlCache<string>(4);
    readonly #balances: TtlCache<bigint>;
    readonly #codes: TtlCache<string>;
    readonly #words: TtlCache<string>;
    readonly #calls: TtlCache<string>;
    readonly #tokens: TtlCache<TokenMeta>;

    #head: { value: number; until: number } | null = null;
    #headInflight: Promise<number> | null = null;

    constructor(inner: ChainGateway, options: CacheOptions = DEFAULT_CACHE)
    {
        this.#inner = inner;
        this.#options = options;
        this.env = inner.env;

        const max = options.maxEntries;
        this.#balances = new TtlCache<bigint>(max);
        this.#codes = new TtlCache<string>(max);
        this.#words = new TtlCache<string>(max);
        this.#calls = new TtlCache<string>(max);
        this.#tokens = new TtlCache<TokenMeta>(max);
    }

    /** Per-cache hit counters, so a deployment can see whether the spans are doing anything. */
    public stats(): Record<string, { size: number; hits: number; misses: number }>
    {
        return {
            balances: this.#balances.stats(),
            codes: this.#codes.stats(),
            storage: this.#words.stats(),
            calls: this.#calls.stats(),
            tokens: this.#tokens.stats(),
            scalars: this.#scalars.stats()
        };
    }

    /** Drops everything held. Nothing calls this in the running server - the spans are short
        enough that a reorg outruns none of them - but a test can reset between cases. */
    public clear(): void
    {
        this.#head = null;
        this.#balances.clear();
        this.#codes.clear();
        this.#words.clear();
        this.#calls.clear();
        this.#tokens.clear();
    }

    public async head(): Promise<number>
    {
        if (this.#options.enabled !== true || this.#options.headMs <= 0)
        {
            return this.#inner.head();
        }
        const now = Date.now();
        if (this.#head !== null && this.#head.until > now)
        {
            return this.#head.value;
        }
        if (this.#headInflight !== null)
        {
            return this.#headInflight;
        }
        const pending = this.#inner.head().then((value) =>
        {
            this.#head = { value, until: Date.now() + this.#options.headMs };
            return value;
        });
        this.#headInflight = pending;
        try
        {
            return await pending;
        }
        finally
        {
            this.#headInflight = null;
        }
    }

    /**
     * The chain's identity, read once and held for the life of the process. It is the hash of
     * block zero: if this ever changed, every other answer this server has given was about a
     * different chain, and a cache would be the least of it.
     */
    public async genesisHash(): Promise<string>
    {
        if (this.#options.enabled !== true)
        {
            return this.#inner.genesisHash();
        }
        return this.#scalars.read('genesis', Number.MAX_SAFE_INTEGER, () => this.#inner.genesisHash());
    }

    public async balance(address: string): Promise<bigint>
    {
        if (this.#options.enabled !== true || this.#options.balanceMs <= 0)
        {
            return this.#inner.balance(address);
        }
        return this.#balances.read(address.toLowerCase(), this.#options.balanceMs, () => this.#inner.balance(address));
    }

    public async code(address: string): Promise<string>
    {
        if (this.#options.enabled !== true)
        {
            return this.#inner.code(address);
        }
        // The span is chosen from the ANSWER, not from the call: code that is there is permanent,
        // code that is not there is only news that has not arrived yet.
        return this.#codes.read(
            address.toLowerCase(),
            (value) => (value === '0x' ? this.#options.codeAbsentMs : this.#options.codeMs),
            () => this.#inner.code(address)
        );
    }

    /** Answered from the SAME cache as `code`, so a contract page does not read the code twice. */
    public async isContract(address: string): Promise<boolean>
    {
        return (await this.code(address)) !== '0x';
    }

    public async storageAt(address: string, slot: string): Promise<string>
    {
        if (this.#options.enabled !== true || this.#options.storageMs <= 0)
        {
            return this.#inner.storageAt(address, slot);
        }
        return this.#words.read(
            `${ address.toLowerCase() }|${ slot.toLowerCase() }`,
            this.#options.storageMs,
            () => this.#inner.storageAt(address, slot)
        );
    }

    public async call(address: string, data: string): Promise<string>
    {
        if (this.#options.enabled !== true || this.#options.callMs <= 0)
        {
            return this.#inner.call(address, data);
        }
        // Keyed by target AND calldata: the arguments are in the data, so two different calls to
        // one contract are two different keys.
        return this.#calls.read(
            `${ address.toLowerCase() }|${ data.toLowerCase() }`,
            this.#options.callMs,
            () => this.#inner.call(address, data)
        );
    }

    public async tokenMetadata(address: string): Promise<TokenMeta>
    {
        if (this.#options.enabled !== true || this.#options.tokenMs <= 0)
        {
            return this.#inner.tokenMetadata(address);
        }
        // `null` is cached too: "this contract answers none of the ERC-20 getters" is an answer,
        // and it is the one that cost three failed calls to learn.
        return this.#tokens.read(address.toLowerCase(), this.#options.tokenMs, () => this.#inner.tokenMetadata(address));
    }

    /**
     * NOT cached, on purpose. This is the reorg check, and its whole job is to notice that the
     * node now reports a different hash at a height it already answered for. A cache here would
     * hide exactly the event it exists to catch.
     */
    public async blockHashAt(number: number): Promise<string | null>
    {
        return this.#inner.blockHashAt(number);
    }

    /** NOT cached: the backfill reads every height exactly once, so there is nothing to reuse. */
    public async range(from: number, to: number): Promise<BlockWithReceipts[]>
    {
        return this.#inner.range(from, to);
    }
}
