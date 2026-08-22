// The price feed, against a COUNTING stub - because what matters here is not only what the feed
// answers but how often it went to another company's server to find out, and what it says once
// that server stops answering. Nothing in this file opens a socket.
import { describe, it, expect, afterEach, vi } from 'vitest';

import { buildApp } from '../src/app.ts';
import { noPrice, priceOf, SwapPriceFeed, type PriceEnv } from '../src/price.ts';
import type { NativePrice } from '../src/schemas.ts';

import { CHAIN, indexed } from './support/fixtures.ts';

const ENV: PriceEnv = { apiUrl: 'https://swap.example.test', ttlMs: 30_000, staleMs: 600_000, timeoutMs: 1000 };

/** The exchange's registry, in the shape it actually serves - a wrapped native and two anchors. */
const TOKENS = [
    { address: '0xd4', symbol: 'BNB', name: 'Bridge BNB', decimals: 18, priceUsd: 689.99, anchored: true },
    { address: '0x4e', symbol: 'USDT', name: 'Bridge USDT', decimals: 18, priceUsd: 1, anchored: true },
    { address: '0xf0', symbol: 'WNURA', name: 'Wrapped NURA', decimals: 18, priceUsd: 0.00027577, anchored: false }
];

const NURA_USD = 0.00027577;

/** An exchange that counts what it is asked, and can be told to fail or to change its answer. */
function exchange(rows: unknown = TOKENS)
{
    const state = { calls: 0, rows, status: 200, reachable: true };
    const impl = (async (): Promise<Response> =>
    {
        state.calls++;
        if (!state.reachable)
        {
            throw new Error('getaddrinfo ENOTFOUND');
        }
        return new Response(JSON.stringify(state.rows), { status: state.status });
    }) as typeof globalThis.fetch;
    return { impl, state };
}

// Restored here rather than inside each test: a test that throws mid-way would otherwise leave
// the clock frozen for whichever spec `test:shuffle` happens to run next.
afterEach(() =>
{
    vi.useRealTimers();
});

describe('priceOf - finding one coin in an exchange\'s registry', () =>
{
    it('takes the WRAPPED native, which is the only form a pool can hold', () =>
    {
        expect(priceOf(TOKENS, 'NURA')).toBe(NURA_USD);
    });

    it('prefers the bare symbol where a chain lists one', () =>
    {
        const both = [...TOKENS, { symbol: 'NURA', priceUsd: 0.1 }];
        expect(priceOf(both, 'NURA')).toBe(0.1);
    });

    it('matches without regard to case, because a registry is not a style guide', () =>
    {
        expect(priceOf([{ symbol: 'wnura', priceUsd: 2 }], 'nura')).toBe(2);
    });

    it('answers null for a coin this exchange has never heard of', () =>
    {
        // The reason a fork of this explorer can point at another chain and quote nothing, rather
        // than printing NURA's price beside somebody else's coin.
        expect(priceOf(TOKENS, 'ETH')).toBeNull();
        expect(priceOf(TOKENS, '')).toBeNull();
    });

    it('rejects a zero, a negative and a non-number - none of them is a price', () =>
    {
        // The exchange writes 0 for a token no pool prices. Printing "$0.00" for that would claim
        // a measurement, and the measurement it claims is that the coin is worthless.
        expect(priceOf([{ symbol: 'WNURA', priceUsd: 0 }], 'NURA')).toBeNull();
        expect(priceOf([{ symbol: 'WNURA', priceUsd: -1 }], 'NURA')).toBeNull();
        expect(priceOf([{ symbol: 'WNURA', priceUsd: Number.NaN }], 'NURA')).toBeNull();
        expect(priceOf([{ symbol: 'WNURA', priceUsd: '2' }], 'NURA')).toBeNull();
    });

    it('survives an upstream that answers with something other than a list', () =>
    {
        expect(priceOf({ error: 'nope' }, 'NURA')).toBeNull();
        expect(priceOf(null, 'NURA')).toBeNull();
        expect(priceOf([null, { symbol: 'WNURA', priceUsd: 2 }], 'NURA')).toBe(2);
    });
});

describe('SwapPriceFeed - one reading, however many people are watching', () =>
{
    it('reads the coin and names where the figure came from', async () =>
    {
        const upstream = exchange();
        const feed = new SwapPriceFeed(ENV, 'NURA', { fetch: upstream.impl });

        const quote = await feed.read();
        expect(quote.usd).toBe(NURA_USD);
        expect(quote.symbol).toBe('NURA');
        expect(quote.source).toBe('swap.example.test');
        expect(quote.at).not.toBeNull();
    });

    it('holds the reading for the whole TTL, then goes back for another', async () =>
    {
        vi.useFakeTimers();
        const upstream = exchange();
        const feed = new SwapPriceFeed(ENV, 'NURA', { fetch: upstream.impl });

        await feed.read();
        expect(upstream.state.calls).toBe(1);

        vi.advanceTimersByTime(ENV.ttlMs - 1);
        await feed.read();
        expect(upstream.state.calls).toBe(1);

        vi.advanceTimersByTime(1);
        await feed.read();
        expect(upstream.state.calls).toBe(2);
    });

    it('collapses concurrent misses into ONE request', async () =>
    {
        // The answers would have been identical - it is the same call at the same instant - so
        // this trades no freshness at all. It is what keeps a burst of visitors on a cold cache
        // from becoming a burst of traffic at the exchange.
        const upstream = exchange();
        const feed = new SwapPriceFeed(ENV, 'NURA', { fetch: upstream.impl });

        const quotes = await Promise.all([feed.read(), feed.read(), feed.read(), feed.read()]);
        expect(upstream.state.calls).toBe(1);
        expect(quotes.map((quote) => quote.usd)).toEqual([NURA_USD, NURA_USD, NURA_USD, NURA_USD]);
    });

    it('keeps serving the last reading when the exchange goes quiet - then stops', async () =>
    {
        vi.useFakeTimers();
        const upstream = exchange();
        const feed = new SwapPriceFeed(ENV, 'NURA', { fetch: upstream.impl });
        await feed.read();

        upstream.state.reachable = false;
        vi.advanceTimersByTime(ENV.ttlMs);
        // A price a few minutes old is still worth printing.
        expect((await feed.read()).usd).toBe(NURA_USD);

        vi.advanceTimersByTime(ENV.staleMs);
        // One from yesterday is a lie with a timestamp on it.
        expect((await feed.read()).usd).toBeNull();
    });

    it('drops the held reading when a HEALTHY exchange stops quoting the coin', async () =>
    {
        vi.useFakeTimers();
        const upstream = exchange();
        const feed = new SwapPriceFeed(ENV, 'NURA', { fetch: upstream.impl });
        await feed.read();

        upstream.state.rows = TOKENS.filter((token) => token.symbol !== 'WNURA');
        vi.advanceTimersByTime(ENV.ttlMs);
        // A delisting is an ANSWER. Falling back to the held reading here would print the last
        // price the coin ever had for as long as the process ran.
        expect((await feed.read()).usd).toBeNull();
    });

    it('reports a refusal to its caller and still answers, rather than throwing at the route', async () =>
    {
        const upstream = exchange();
        upstream.state.status = 503;
        const seen: unknown[] = [];
        const feed = new SwapPriceFeed(ENV, 'NURA', { fetch: upstream.impl, onError: (error) => seen.push(error) });

        const quote = await feed.read();
        expect(quote.usd).toBeNull();
        expect(seen).toHaveLength(1);
        expect(String(seen[0])).toContain('503');
    });

    it('asks nothing at all when no exchange is configured', async () =>
    {
        const upstream = exchange();
        const feed = new SwapPriceFeed({ ...ENV, apiUrl: '' }, 'NURA', { fetch: upstream.impl });

        expect(await feed.read()).toEqual({ symbol: 'NURA', usd: null, at: null, source: '' });
        expect(upstream.state.calls).toBe(0);
    });

    it('names an unparseable endpoint by what was configured, so a price is never unattributed', async () =>
    {
        const upstream = exchange();
        const feed = new SwapPriceFeed({ ...ENV, apiUrl: 'not-a-url' }, 'NURA', { fetch: upstream.impl });
        expect((await feed.read()).source).toBe('not-a-url');
    });
});

describe('the price route', () =>
{
    async function get(price?: { read: () => Promise<NativePrice> }): Promise<NativePrice>
    {
        const { store, chain } = await indexed(CHAIN);
        const app = buildApp({ dev: false, store, chain, price });
        const response = await app.handle(new Request('http://local/api/stats/price'));
        expect(response.status).toBe(200);
        return (await response.json()) as NativePrice;
    }

    it('serves what the feed says', async () =>
    {
        const quote: NativePrice = { symbol: 'NURA', usd: NURA_USD, at: '2026-08-22T00:00:00.000Z', source: 'swap.example.test' };
        expect(await get({ read: async () => quote })).toEqual(quote);
    });

    it('answers with a null price for a deployment that has no exchange behind it', async () =>
    {
        // Null and not an error, and not a zero: the route stays on the happy path so the home
        // page renders in full and simply has one fewer thing in its hero.
        const quote = await get();
        expect(quote.usd).toBeNull();
        expect(quote.at).toBeNull();
        expect(quote.symbol).toBe('NURA');
    });

    it('takes the symbol from the chain it is indexing', async () =>
    {
        expect((await noPrice('NURA').read()).symbol).toBe('NURA');
    });
});
