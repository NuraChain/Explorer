import { loadConfig, num, str } from '@azerothjs/http';

import type { NativePrice } from './schemas.ts';

// What the native coin is worth, read from the exchange that trades it.
//
// The node cannot answer this. A price is not a fact about a block - it is a fact about a market,
// and the market for this coin is the AMM at swap.nurachain.net. So this is the one read in the
// server that leaves the chain, and it is treated as such: it is never on the path of a page that
// has chain data to serve, and it fails to `null` rather than to an error.
//
// The exchange quotes the WRAPPED native, because a pool can only hold a token. Wrapping is 1:1
// by construction, so the wrapper's price IS the coin's price - there is no rate between the two
// to lose. `priceOf` therefore accepts either symbol, preferring the bare one if a chain lists it.
//
// The reading is held rather than proxied per request. Every visitor to the home page asks for the
// same figure, and a price that moves with a pool does not move between two visitors a hundred
// milliseconds apart. Concurrent misses share ONE upstream request, for the reason the node cache
// gives at length: the answers would have been identical, so collapsing them trades nothing.

/** One row of the exchange's token registry. Only the fields this reads. */
interface SwapToken
{
    symbol: string;
    priceUsd: number;
}

/**
 * What the API asks for a price. Narrow on purpose: the tests substitute a plain object for it,
 * so no spec can open a socket to the exchange.
 */
export interface PriceSource
{
    read(): Promise<NativePrice>;
}

export interface PriceEnv
{
    /** Origin serving `/api/market/tokens`. Empty switches the feed off - no price is quoted. */
    apiUrl: string;

    /** How long a reading is served before another is fetched. */
    ttlMs: number;

    /**
     * How long the last good reading may still be served once the exchange stops answering.
     *
     * A price a few minutes old is still worth printing; one from yesterday is a lie with a
     * timestamp on it. Past this the answer becomes `null` and the page shows nothing.
     */
    staleMs: number;

    /** How long one upstream request may take before it is abandoned. */
    timeoutMs: number;
}

export function loadPriceEnv(): PriceEnv
{
    return loadConfig({
        apiUrl: str('SWAP_API_URL', { default: 'https://swap.nurachain.net' }),
        ttlMs: num('PRICE_TTL_MS', { default: 30_000 }),
        staleMs: num('PRICE_STALE_MS', { default: 600_000 }),
        timeoutMs: num('PRICE_TIMEOUT_MS', { default: 4000 })
    });
}

/**
 * The USD price of `symbol` in a token registry, or null when the exchange does not quote it.
 *
 * A deployment pointed at another chain reaches this with a symbol the exchange has never heard
 * of, and gets null - which is why the feed can default to a live URL without a fork of this
 * explorer quietly printing NURA's price beside somebody else's coin.
 */
export function priceOf(rows: unknown, symbol: string): number | null
{
    if (symbol === '' || !Array.isArray(rows))
    {
        return null;
    }
    const wanted = symbol.toUpperCase();
    for (const want of [wanted, `W${ wanted }`])
    {
        const row = (rows as SwapToken[]).find((token) => typeof token?.symbol === 'string' && token.symbol.toUpperCase() === want);
        // Zero is rejected along with the non-numbers: the exchange writes 0 for a token no pool
        // prices, and printing "$0.00" claims a measurement that says the coin is worthless.
        if (row !== undefined && typeof row.priceUsd === 'number' && Number.isFinite(row.priceUsd) && row.priceUsd > 0)
        {
            return row.priceUsd;
        }
    }
    return null;
}

export interface PriceFeedOptions
{
    /** Reported when the exchange cannot be reached. The boot logger is what listens. */
    onError?: (error: unknown) => void;

    /** Swapped in tests. Nothing else in the server has a reason to replace it. */
    fetch?: typeof globalThis.fetch;
}

export class SwapPriceFeed implements PriceSource
{
    readonly #env: PriceEnv;
    readonly #symbol: string;
    readonly #source: string;
    readonly #fetch: typeof globalThis.fetch;
    readonly #onError: (error: unknown) => void;

    /** The last reading that carried a price, and when it was taken. */
    #held: { usd: number; at: number } | null = null;

    /** The request in flight, so a burst on a cold cache makes one call and not one per visitor. */
    #inflight: Promise<void> | null = null;

    constructor(env: PriceEnv, symbol: string, options: PriceFeedOptions = {})
    {
        this.#env = env;
        this.#symbol = symbol;
        this.#source = hostOf(env.apiUrl);
        this.#fetch = options.fetch ?? globalThis.fetch;
        this.#onError = options.onError ?? ((): void => undefined);
    }

    public async read(): Promise<NativePrice>
    {
        const held = this.#held;
        if (this.#env.apiUrl !== '' && (held === null || Date.now() - held.at >= this.#env.ttlMs))
        {
            await this.#load();
        }
        return this.#present();
    }

    async #load(): Promise<void>
    {
        this.#inflight ??= this.#refresh()
            .catch((error: unknown) => this.#onError(error))
            .finally(() =>
            {
                this.#inflight = null;
            });
        await this.#inflight;
    }

    async #refresh(): Promise<void>
    {
        const response = await this.#fetch(`${ this.#env.apiUrl }/api/market/tokens`, {
            headers: { accept: 'application/json' },
            signal: AbortSignal.timeout(this.#env.timeoutMs)
        });
        if (!response.ok)
        {
            throw new Error(`price upstream answered ${ response.status }`);
        }
        const usd = priceOf(await response.json(), this.#symbol);
        // A healthy exchange that no longer quotes the coin is an ANSWER, not a failure, so the
        // held reading is dropped rather than served on. Keeping it would print the last price a
        // delisted coin ever had, for as long as the process ran.
        this.#held = usd === null ? null : { usd, at: Date.now() };
    }

    #present(): NativePrice
    {
        const held = this.#held;
        if (held === null || Date.now() - held.at > this.#env.staleMs)
        {
            return { symbol: this.#symbol, usd: null, at: null, source: this.#source };
        }
        return { symbol: this.#symbol, usd: held.usd, at: new Date(held.at).toISOString(), source: this.#source };
    }
}

/** The feed for a deployment with no exchange behind it: nobody is quoting this coin. */
export function noPrice(symbol: string): PriceSource
{
    return { read: async () => ({ symbol, usd: null, at: null, source: '' }) };
}

/**
 * The host a figure came from, for attribution.
 *
 * Falls back to the configured string rather than to nothing, so a quoted price always carries
 * something naming its source - the page prints this beside the figure and has no second answer
 * to fall back on. Empty only when no exchange is configured at all, which is also when there is
 * no price to attribute.
 */
function hostOf(url: string): string
{
    if (url === '')
    {
        return '';
    }
    try
    {
        return new URL(url).host;
    }
    catch
    {
        return url;
    }
}
