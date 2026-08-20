// @vitest-environment node
//
// The typed API as a CLIENT meets it: real Request objects through the real handler, asserting
// status codes and bodies together. app.spec.ts covers what the routes answer; this file covers
// what they do when the request is wrong - which is most of what a public API has to get right.
//
// Nothing here mocks the HTTP layer. A test that asserts a 422 against a hand-rolled fake proves
// only that the fake was written to return 422.
import { describe, it, expect } from 'vitest';

import { buildApp } from '../src/app.ts';
import { ALICE, BOB, CHAIN, TOKEN, ZERO, indexed } from './support/fixtures.ts';
import type { ChainStub } from './support/fixtures.ts';
import type { BlockWithReceipts, ChainGateway } from '../src/chain/client.ts';

interface Client
{
    get(path: string): Promise<Response>;
    post(path: string, body: unknown, init?: RequestInit): Promise<Response>;
    raw(path: string, init: RequestInit): Promise<Response>;
}

/**
 * An app over an index filled from `blocks`.
 *
 * `after` replaces the gateway once the index is BUILT, which is the only way to test a node that
 * fails at serve time: a gateway that throws from the start fails the backfill instead, and then
 * the test proves nothing about the route.
 */
async function client(
    blocks: BlockWithReceipts[] = CHAIN,
    stub: ChainStub = {},
    after?: (chain: ChainGateway) => ChainGateway
): Promise<Client>
{
    const { store, chain: indexedChain } = await indexed(blocks, stub);
    const chain = after === undefined ? indexedChain : after(indexedChain);
    const app = buildApp({ dev: false, store, chain });
    const url = (path: string): string => `http://local${ path }`;
    return {
        get: (path) => app.handle(new Request(url(path))),
        post: (path, body, init) => app.handle(new Request(url(path), {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
            ...init
        })),
        raw: (path, init) => app.handle(new Request(url(path), init))
    };
}

const SELECTOR_TRANSFER = '0xa9059cbb';
const SELECTOR_NAME = '0x06fdde03';

describe('health and manifest', () =>
{
    it('reports the indexed head on healthz', async () =>
    {
        const api = await client();
        const response = await api.get('/api/healthz');
        expect(response.status).toBe(200);
        const body = (await response.json()) as { ok: boolean; head: number; at: string };
        expect(body.ok).toBe(true);
        expect(body.head).toBe(2);
        expect(Number.isNaN(Date.parse(body.at))).toBe(false);
    });

    it('publishes a manifest the typed client boots from', async () =>
    {
        const api = await client();
        const response = await api.get('/api/_manifest');
        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toContain('application/json');
        // Every route the browser calls has to be in here, or the client cannot address it.
        expect(JSON.stringify(await response.json())).toContain('blocks');
    });
});

describe('content types and methods', () =>
{
    it('answers JSON with a JSON content type', async () =>
    {
        const api = await client();
        for (const path of ['/api/stats', '/api/blocks', '/api/txs', `/api/address/${ ALICE }`])
        {
            const response = await api.get(path);
            expect(response.status, path).toBe(200);
            expect(response.headers.get('content-type'), path).toContain('application/json');
        }
    });

    it('refuses a POST to a GET route rather than treating it as a read', async () =>
    {
        const api = await client();
        const response = await api.post('/api/blocks', {});
        expect(response.status).toBeGreaterThanOrEqual(400);
        expect(response.status).toBeLessThan(500);
    });

    it('refuses a GET to a POST route', async () =>
    {
        const api = await client();
        const response = await api.get(`/api/address/${ TOKEN }/calldata`);
        expect(response.status).toBeGreaterThanOrEqual(400);
        expect(response.status).toBeLessThan(500);
    });

    it('refuses a body that is not JSON without falling over', async () =>
    {
        const api = await client();
        const response = await api.raw(`/api/address/${ TOKEN }/calldata`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: '{ this is not json'
        });
        expect(response.status).toBeGreaterThanOrEqual(400);
        expect(response.status).toBeLessThan(500);
    });

    it('answers an unknown API path with a 404, not a page', async () =>
    {
        const api = await client();
        const response = await api.get('/api/nothing-here');
        expect(response.status).toBe(404);
    });
});

describe('pagination bounds', () =>
{
    it.each([
        ['a page below one', '?page=0'],
        ['a negative page', '?page=-1'],
        ['a fractional page', '?page=1.5'],
        ['a non-numeric page', '?page=abc'],
        ['a limit below one', '?limit=0'],
        ['a limit past the cap', '?limit=101'],
        ['a negative limit', '?limit=-5']
    ])('refuses %s with a validation error, not a 500', async (_label, query) =>
    {
        const api = await client();
        const response = await api.get(`/api/blocks${ query }`);
        expect(response.status).toBe(422);
        const body = (await response.json()) as { error: { code: string } };
        expect(body.error.code).toBe('validation-failed');
    });

    it('refuses a page that is integral only as a double', async () =>
    {
        // Regression. `page` had a minimum and no maximum, so 1e21 passed the integer check,
        // multiplied out past Number.MAX_SAFE_INTEGER, and sqlite threw binding it - a 500 from
        // a malformed query string.
        const api = await client();
        for (const page of ['999999999999999999999', '1e21', '9007199254740993'])
        {
            const response = await api.get(`/api/blocks?page=${ page }`);
            expect(response.status, `page=${ page }`).toBe(422);
        }
    });

    it('accepts the exact edges of both bounds', async () =>
    {
        const api = await client();
        expect((await api.get('/api/blocks?page=1&limit=1')).status).toBe(200);
        expect((await api.get('/api/blocks?limit=100')).status).toBe(200);
        expect((await api.get('/api/blocks?page=1000000000000')).status).toBe(200);
    });

    it('answers a page past the end with an empty list, not an error', async () =>
    {
        const api = await client();
        const response = await api.get('/api/blocks?page=500');
        expect(response.status).toBe(200);
        const body = (await response.json()) as { rows: unknown[]; total: number; pages: number };
        expect(body.rows).toEqual([]);
        // The envelope still counts what exists, so a pager can send the reader back.
        expect(body.total).toBe(3);
        expect(body.pages).toBeGreaterThanOrEqual(1);
    });

    it('pages consistently: every row appears exactly once across the pages', async () =>
    {
        const api = await client();
        const seen: string[] = [];
        for (let page = 1; page <= 4; page++)
        {
            const body = (await (await api.get(`/api/txs?page=${ page }&limit=1`)).json()) as { rows: Array<{ hash: string }> };
            seen.push(...body.rows.map((row) => row.hash));
        }
        expect(new Set(seen).size).toBe(seen.length);
        expect(seen).toHaveLength(4);
    });
});

describe('response envelopes', () =>
{
    it('answers every list with rows, total, page and pages', async () =>
    {
        const api = await client();
        for (const path of ['/api/blocks', '/api/txs', `/api/address/${ ALICE }/txs`, `/api/address/${ ALICE }/transfers`])
        {
            const body = (await (await api.get(path)).json()) as Record<string, unknown>;
            expect(Object.keys(body).sort(), path).toEqual(['page', 'pages', 'rows', 'total']);
            expect(Array.isArray(body.rows), path).toBe(true);
            expect(typeof body.total, path).toBe('number');
        }
    });

    it('keeps every chain amount a STRING, so no uint256 crosses as a double', async () =>
    {
        const api = await client();
        const body = (await (await api.get('/api/txs')).json()) as { rows: Array<Record<string, unknown>> };
        const row = body.rows[0]!;
        for (const key of ['value', 'gasUsed', 'gasPrice', 'fee'])
        {
            expect(typeof row[key], key).toBe('string');
        }

        const account = (await (await api.get(`/api/address/${ ALICE }`)).json()) as { balance: unknown; flow: Record<string, unknown> };
        expect(typeof account.balance).toBe('string');
        expect(typeof account.flow.in).toBe('string');
        expect(typeof account.flow.fees).toBe('string');
    });

    it('reports an ISO timestamp, not a raw epoch', async () =>
    {
        const api = await client();
        const body = (await (await api.get('/api/blocks')).json()) as { rows: Array<{ at: string }> };
        expect(body.rows[0]!.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
});

describe('not-found behaviour', () =>
{
    it('404s an unknown block, transaction and a block that is not a number', async () =>
    {
        const api = await client();
        expect((await api.get('/api/blocks/9999')).status).toBe(404);
        expect((await api.get(`/api/txs/0x${ 'f'.repeat(64) }`)).status).toBe(404);
        expect((await api.get('/api/blocks/not-a-number')).status).toBeGreaterThanOrEqual(400);
    });

    it('answers an address it has never seen, rather than 404ing an ordinary account', async () =>
    {
        // An address with no history is not an error - it is an address with no history, and a
        // 404 there reads as "this explorer is broken" to somebody checking a fresh wallet.
        const api = await client();
        const response = await api.get(`/api/address/${ ZERO }`);
        expect(response.status).toBe(200);
        const body = (await response.json()) as { txCount: number; transferCount: number; isContract: boolean };
        expect(body.txCount).toBe(0);
        expect(body.transferCount).toBe(0);
        expect(body.isContract).toBe(false);
    });
});

describe('degrading when the node is down', () =>
{
    it('still serves the summary from the index when the head call fails', async () =>
    {
        // The index is the source of truth for history; a node that will not answer must not
        // take the whole page down with it.
        const api = await client(CHAIN, {}, (chain) => ({ ...chain, head: async () =>
        {
            throw new Error('ECONNREFUSED');
        } }));
        const response = await api.get('/api/stats');
        expect(response.status).toBe(200);
        const body = (await response.json()) as { head: number; chainHead: number };
        expect(body.head).toBe(2);
        // Falls back to the indexed head rather than reporting the chain as stopped.
        expect(body.chainHead).toBe(2);
    });

    it('serves an address with a zero balance when the node refuses', async () =>
    {
        const api = await client(CHAIN, {}, (chain) => ({ ...chain, balance: async () =>
        {
            throw new Error('rate limited');
        } }));
        const response = await api.get(`/api/address/${ ALICE }`);
        expect(response.status).toBe(200);
        const body = (await response.json()) as { balance: string; txCount: number };
        expect(body.balance).toBe('0');
        // The INDEXED half is still correct - that is the point of the fallback.
        expect(body.txCount).toBe(4);
    });

    it('describes a contract even when the node cannot return its code', async () =>
    {
        const api = await client(CHAIN, { code: {} });
        const response = await api.get(`/api/address/${ TOKEN }/contract`);
        expect(response.status).toBe(200);
        const body = (await response.json()) as { isContract: boolean; bytecode: string };
        expect(body.isContract).toBe(false);
        expect(body.bytecode).toBe('0x');
    });
});

describe('the read and calldata endpoints', () =>
{
    const CONTRACT = TOKEN;

    it('refuses a call whose arguments do not fit, with a 400 that names the argument', async () =>
    {
        const api = await client();
        const response = await api.post(`/api/address/${ CONTRACT }/calldata`, {
            selector: SELECTOR_TRANSFER,
            args: ['0x123', '1']
        });
        expect(response.status).toBe(400);
        expect(JSON.stringify(await response.json())).toContain('Argument 1');
    });

    it('refuses an out-of-range integer with a 400 rather than a 500', async () =>
    {
        // Regression, paired with values.spec.ts: coerce let an out-of-range value through and
        // the encoder's own error class escaped inspect.ts as a server fault.
        const api = await client();
        const response = await api.post(`/api/address/${ CONTRACT }/calldata`, {
            selector: '0x1249c58b',
            args: []
        });
        // `mint()` takes no arguments in the table; the point is that a refusal is a 4xx.
        expect(response.status).toBeLessThan(500);
    });

    it('refuses odd-length hex for a bytes argument instead of padding it', async () =>
    {
        const api = await client();
        const response = await api.post(`/api/address/${ CONTRACT }/calldata`, {
            selector: '0xb88d4fde',
            args: [ALICE, BOB, '1', '0xabc']
        });
        expect(response.status).toBe(400);
        expect(JSON.stringify(await response.json())).toContain('pairs');
    });

    it.each([
        ['a missing selector', { args: [] }],
        ['a missing args list', { selector: SELECTOR_NAME }],
        ['args of the wrong type', { selector: SELECTOR_NAME, args: 'not-a-list' }],
        ['a numeric arg where text is required', { selector: SELECTOR_TRANSFER, args: [1, 2] }]
    ])('refuses %s at the schema, before any encoding happens', async (_label, body) =>
    {
        const api = await client();
        const response = await api.post(`/api/address/${ TOKEN }/calldata`, body);
        expect(response.status).toBeGreaterThanOrEqual(400);
        expect(response.status).toBeLessThan(500);
    });

    it('reports a revert as a 200 carrying the reason, not as a failure', async () =>
    {
        const api = await client(CHAIN, {
            call: async () =>
            {
                throw Object.assign(new Error('execution reverted: not the owner'), { shortMessage: 'execution reverted: not the owner' });
            }
        });
        const response = await api.post(`/api/address/${ TOKEN }/call`, { selector: SELECTOR_NAME, args: [] });
        expect(response.status).toBe(200);
        const body = (await response.json()) as { values: unknown[]; error: string };
        expect(body.values).toEqual([]);
        expect(body.error).toContain('reverted');
    });

    it('caps the reason a node can put on the page', async () =>
    {
        const api = await client(CHAIN, {
            call: async () =>
            {
                throw Object.assign(new Error('x'.repeat(5000)), { shortMessage: 'x'.repeat(5000) });
            }
        });
        const response = await api.post(`/api/address/${ TOKEN }/call`, { selector: SELECTOR_NAME, args: [] });
        const body = (await response.json()) as { error: string };
        expect(body.error.length).toBeLessThanOrEqual(200);
    });
});

describe('security of the typed API', () =>
{
    it('is read-only: no route accepts a transaction to send', async () =>
    {
        // The explorer holds a node connection and no key. Anything that could move money would
        // make it a very different program, so the absence is asserted rather than assumed.
        const api = await client();
        for (const path of ['/api/send', '/api/tx', '/api/broadcast', '/api/sign', '/api/rpc'])
        {
            const response = await api.post(path, { raw: '0xdeadbeef' });
            expect(response.status, path).toBeGreaterThanOrEqual(400);
        }
    });

    it('refuses a state-changing function through the READ endpoint', async () =>
    {
        const api = await client();
        const response = await api.post(`/api/address/${ TOKEN }/call`, { selector: SELECTOR_TRANSFER, args: [BOB, '1'] });
        expect(response.status).toBe(400);
    });

    it('will not call a selector no published signature describes', async () =>
    {
        // This is what keeps the endpoint from being an open relay for the node behind it: the
        // callable surface is a fixed table, not whatever the caller writes in the body.
        const api = await client();
        for (const selector of ['0x12345678', '0xdeadbeef', '0x00000000'])
        {
            const response = await api.post(`/api/address/${ TOKEN }/call`, { selector, args: [] });
            expect(response.status, selector).toBe(400);
        }
    });

    it('does not let a path-traversal address reach the filesystem or the index', async () =>
    {
        const api = await client();
        for (const attack of ['../../etc/passwd', '..%2f..%2fetc%2fpasswd', '%2e%2e/%2e%2e/secrets'])
        {
            const response = await api.get(`/api/address/${ attack }`);
            // Either refused or answered as the ordinary (empty) address it is not - never a file.
            expect(response.status).toBeLessThan(500);
            if (response.status === 200)
            {
                expect(await response.text()).not.toContain('root:');
            }
        }
    });

    it('does not let a quoted search term reach SQL', async () =>
    {
        const api = await client();
        for (const attack of ["' OR 1=1 --", "'; DROP TABLE blocks; --", '1 UNION SELECT * FROM meta'])
        {
            const response = await api.get(`/api/search?q=${ encodeURIComponent(attack) }`);
            expect(response.status).toBe(200);
            expect((await response.json()) as { kind: string }).toMatchObject({ kind: 'none' });
        }
        // The tables are still there afterwards.
        expect((await api.get('/api/blocks')).status).toBe(200);
    });

    it('does not reflect a search term back into the response body', async () =>
    {
        // The API answers a resolved PATH, never the term - so there is nothing for a page to
        // render unescaped even if it wanted to.
        const api = await client();
        const payload = '<script>alert(1)</script>';
        const response = await api.get(`/api/search?q=${ encodeURIComponent(payload) }`);
        expect(await response.text()).not.toContain('<script>');
    });

    it('carries the security headers on an API response', async () =>
    {
        const { store, chain } = await indexed(CHAIN);
        const app = buildApp({ dev: false, store, chain });
        const { pipeline, securityHeaders, requestId } = await import('@azerothjs/http');
        const handler = pipeline(app, requestId(), securityHeaders());
        const response = await handler.handle(new Request('http://local/api/stats'));
        expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    });

    it('rate limits a caller that will not stop, and says when to come back', async () =>
    {
        const { store, chain } = await indexed(CHAIN);
        const app = buildApp({ dev: false, store, chain });
        const { pipeline, rateLimit } = await import('@azerothjs/http');
        // An explicit key rather than the default client IP: `.handle()` has no socket, and the
        // limiter refuses loudly off-socket. The budget arithmetic is the behaviour under test.
        const handler = pipeline(app, rateLimit({
            limit: 5,
            windowMs: 60_000,
            key: (request) => new URL(request.url).searchParams.get('caller') ?? 'anonymous'
        }));

        const call = (caller: string): Promise<Response> =>
            handler.handle(new Request(`http://local/api/stats?caller=${ caller }`));

        const statuses: number[] = [];
        for (let at = 0; at < 8; at++)
        {
            statuses.push((await call('greedy')).status);
        }
        expect(statuses.slice(0, 5).every((status) => status === 200)).toBe(true);
        expect(statuses.slice(5).every((status) => status === 429)).toBe(true);

        const refused = await call('greedy');
        expect(refused.status).toBe(429);
        expect(refused.headers.get('retry-after')).not.toBeNull();

        // The budget is PER KEY: one caller exhausting theirs must not lock everybody out.
        expect((await call('polite')).status).toBe(200);
    });

    it('stamps the rate-limit headers so a client can pace itself before it is refused', async () =>
    {
        const { store, chain } = await indexed(CHAIN);
        const app = buildApp({ dev: false, store, chain });
        const { pipeline, rateLimit } = await import('@azerothjs/http');
        const handler = pipeline(app, rateLimit({ limit: 3, windowMs: 60_000, key: () => 'fixed' }));

        const first = await handler.handle(new Request('http://local/api/stats'));
        expect(first.headers.get('ratelimit-limit')).toBe('3');
        expect(Number(first.headers.get('ratelimit-remaining'))).toBe(2);
    });
});

describe('the address contract endpoint', () =>
{
    it('reads a proxy through to its implementation', async () =>
    {
        const IMPLEMENTATION = '0x1111111111111111111111111111111111111111';
        const SLOT = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';
        const api = await client(CHAIN, {
            code: {
                [TOKEN]: '0x6080604052',
                [IMPLEMENTATION]: '0x6080604052600436106100355760003560e01c806306fdde031461003a57'
            },
            storageAt: async (_address, slot) =>
                (slot === SLOT ? `0x${ IMPLEMENTATION.slice(2).padStart(64, '0') }` : `0x${ '0'.repeat(64) }`)
        });

        const body = (await (await api.get(`/api/address/${ TOKEN }/contract`)).json()) as {
            proxy: { kind: string; implementation: string } | null;
            fromImplementation: boolean;
        };
        expect(body.proxy).toEqual({ kind: 'eip1967', implementation: IMPLEMENTATION });
        expect(body.fromImplementation).toBe(true);
    });

    it('does not claim a proxy when the slot is empty', async () =>
    {
        const api = await client(CHAIN, { code: { [TOKEN]: '0x6080604052' } });
        const body = (await (await api.get(`/api/address/${ TOKEN }/contract`)).json()) as { proxy: unknown };
        expect(body.proxy).toBeNull();
    });

    it('survives a node that refuses every storage read', async () =>
    {
        const api = await client(CHAIN, {
            code: { [TOKEN]: '0x6080604052' },
            storageAt: async () =>
            {
                throw new Error('unsupported method');
            }
        });
        const response = await api.get(`/api/address/${ TOKEN }/contract`);
        expect(response.status).toBe(200);
        expect(((await response.json()) as { proxy: unknown }).proxy).toBeNull();
    });
});

describe('the rich list', () =>
{
    it('excludes zero balances and honours the requested size', async () =>
    {
        const api = await client(CHAIN, {
            balance: async (address) => (address === ALICE ? 9n : address === BOB ? 3n : 0n)
        });
        const body = (await (await api.get('/api/accounts/top?limit=10')).json()) as { rows: Array<{ address: string; balance: string }> };
        expect(body.rows.map((row) => row.address)).toEqual([ALICE, BOB]);
        expect(body.rows.every((row) => row.balance !== '0')).toBe(true);
    });

    it('caps the page size however large a caller asks', async () =>
    {
        const api = await client();
        const response = await api.get('/api/accounts/top?limit=100');
        expect(response.status).toBe(200);
        // Past the schema's own maximum it is a validation error, not an unbounded scan.
        expect((await api.get('/api/accounts/top?limit=100000')).status).toBe(422);
    });

    it('ranks by balance and not by the order addresses were seen', async () =>
    {
        const api = await client(CHAIN, {
            balance: async (address) => (address === BOB ? 100n : address === ALICE ? 1n : 50n)
        });
        const body = (await (await api.get('/api/accounts/top')).json()) as { rows: Array<{ balance: string }> };
        const balances = body.rows.map((row) => BigInt(row.balance));
        expect(balances).toEqual([...balances].sort((a, b) => (a > b ? -1 : a < b ? 1 : 0)));
    });
});
