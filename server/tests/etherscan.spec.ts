// @vitest-environment node
//
// The Etherscan-compatible surface. Its callers are WALLETS, and a wallet cannot ask a follow-up
// question - it reads the envelope and believes it. So the distinction this file guards hardest
// is `status: '0'` meaning "nothing found" versus meaning "your request was wrong": a client that
// reads an error as an empty history shows an account as having never transacted.
//
// Everything here goes through the real HTTP handler rather than the module's internals, because
// the routing (`/api` and `/v2/api` EXACTLY, never shadowing `/api/blocks`) is part of the
// contract too.
import { describe, it, expect } from 'vitest';

import { buildApp } from '../src/app.ts';
import { createEtherscanApi } from '../src/etherscan.ts';
import { ALICE, BOB, CHAIN, TOKEN, ZERO, block, indexed, tokenBlock, txHash } from './support/fixtures.ts';
import type { ChainStub } from './support/fixtures.ts';
import type { BlockWithReceipts } from '../src/chain/client.ts';

interface Envelope
{
    status: string;
    message: string;
    result: unknown;
}

/** The dispatcher over an index filled from `blocks`. */
async function surface(blocks: BlockWithReceipts[] = CHAIN, stub: ChainStub = {}): Promise<(query: string) => Promise<Envelope>>
{
    const { store, chain } = await indexed(blocks, stub);
    const api = createEtherscanApi({ store, chain });
    return async (query) => (await api(new URLSearchParams(query))).json() as Promise<Envelope>;
}

/** The same surface, reached the way a wallet reaches it: over HTTP. */
async function served(blocks: BlockWithReceipts[] = CHAIN, stub: ChainStub = {}): Promise<(path: string) => Promise<Response>>
{
    const { store, chain } = await indexed(blocks, stub);
    const app = buildApp({ dev: false, store, chain });
    return (path) => app.handle(new Request(`http://local${ path }`));
}

describe('the envelope', () =>
{
    it('separates "nothing found" from "your request was wrong"', async () =>
    {
        const ask = await surface();

        // Nothing found: status 0, but the message says so and the result is a list.
        const empty = await ask(`module=account&action=txlist&address=${ ZERO }`);
        expect(empty.status).toBe('0');
        expect(empty.message).toBe('No transactions found');
        expect(empty.result).toEqual([]);

        // Wrong request: status 0, message NOTOK, and the result is the REASON, not a list.
        const bad = await ask('module=account&action=txlist&address=nonsense');
        expect(bad.status).toBe('0');
        expect(bad.message).toBe('NOTOK');
        expect(typeof bad.result).toBe('string');
        expect(bad.result).toContain('Invalid address');
    });

    it('answers a hit with status 1 and OK', async () =>
    {
        const ask = await surface();
        const found = await ask(`module=account&action=txlist&address=${ ALICE }`);
        expect(found.status).toBe('1');
        expect(found.message).toBe('OK');
        expect(Array.isArray(found.result)).toBe(true);
    });
});

describe('routing', () =>
{
    it('answers on /api and /v2/api exactly, and never shadows the typed routes', async () =>
    {
        const get = await served();

        for (const base of ['/api', '/v2/api'])
        {
            const response = await get(`${ base }?module=account&action=txlist&address=${ ALICE }`);
            expect(response.status).toBe(200);
            expect(((await response.json()) as Envelope).status).toBe('1');
        }

        // The typed API still wins on its own subpaths - the compatibility shim is not a catch-all.
        const blocks = await get('/api/blocks');
        expect(blocks.status).toBe(200);
        expect(await blocks.json()).toHaveProperty('rows');
    });

    it('carries the cross-origin headers that make it readable from a wallet webview', async () =>
    {
        // securityHeaders() defaults CORP to same-origin app-wide, which discards the response in
        // the browser even with an allow-origin header. These are what override it.
        const get = await served();
        const response = await get(`/api?module=account&action=balance&address=${ ALICE }`);
        expect(response.headers.get('access-control-allow-origin')).toBe('*');
        expect(response.headers.get('cross-origin-resource-policy')).toBe('cross-origin');
    });

    it('refuses an unknown module and an unknown action by name', async () =>
    {
        const ask = await surface();
        expect((await ask('module=proxy&action=eth_call')).result).toContain('unsupported module');
        expect((await ask('module=account&action=nonsense')).result).toContain('unsupported action');
        expect((await ask('')).result).toContain('unsupported module');
        expect((await ask('module=transaction&action=nonsense&txhash=0x' + 'a'.repeat(64))).result).toContain('unsupported action');
    });

    it('reads the module and action case-insensitively, as a wallet may send them', async () =>
    {
        const ask = await surface();
        expect((await ask(`module=ACCOUNT&action=TxList&address=${ ALICE }`)).status).toBe('1');
    });

    it('does NOT expose a write or proxy surface', async () =>
    {
        // Forwarding arbitrary calls would make the explorer an open relay for its own node.
        const ask = await surface();
        for (const action of ['eth_sendRawTransaction', 'eth_call', 'eth_getBalance'])
        {
            expect((await ask(`module=proxy&action=${ action }`)).message).toBe('NOTOK');
        }
    });
});

describe('account: balance', () =>
{
    it('reads the balance live from the node, as a decimal string', async () =>
    {
        const ask = await surface(CHAIN, { balance: async () => 12345n });
        const answer = await ask(`module=account&action=balance&address=${ ALICE }`);
        expect(answer.result).toBe('12345');
    });

    it('carries a balance no double could hold', async () =>
    {
        const huge = (1n << 255n) + 7n;
        const ask = await surface(CHAIN, { balance: async () => huge });
        expect((await ask(`module=account&action=balance&address=${ ALICE }`)).result).toBe(huge.toString());
    });

    it.each([
        ['missing', ''],
        ['too short', '&address=0x123'],
        ['not hex', `&address=0x${ 'z'.repeat(40) }`],
        ['no prefix', `&address=${ ALICE.slice(2) }`]
    ])('refuses an address that is %s', async (_label, suffix) =>
    {
        const ask = await surface();
        const answer = await ask(`module=account&action=balance${ suffix }`);
        expect(answer.message).toBe('NOTOK');
        expect(answer.result).toContain('Invalid address');
    });

    it('accepts a checksummed address and answers for its lower-cased self', async () =>
    {
        const seen: string[] = [];
        const ask = await surface(CHAIN, {
            balance: async (address) =>
            {
                seen.push(address);
                return 1n;
            }
        });
        await ask(`module=account&action=balance&address=${ ALICE.toUpperCase().replace('0X', '0x') }`);
        expect(seen).toEqual([ALICE]);
    });
});

describe('account: balancemulti', () =>
{
    it('answers one entry per address, in the order asked', async () =>
    {
        const ask = await surface(CHAIN, { balance: async (address) => (address === ALICE ? 1n : 2n) });
        const answer = await ask(`module=account&action=balancemulti&address=${ ALICE },${ BOB }`);
        expect(answer.result).toEqual([
            { account: ALICE, balance: '1' },
            { account: BOB, balance: '2' }
        ]);
    });

    it('refuses an empty list and a list past Etherscan\'s cap of twenty', async () =>
    {
        const ask = await surface();
        expect((await ask('module=account&action=balancemulti&address=')).message).toBe('NOTOK');

        const twenty = Array.from({ length: 20 }, () => ALICE).join(',');
        expect((await ask(`module=account&action=balancemulti&address=${ twenty }`)).status).toBe('1');

        const twentyOne = Array.from({ length: 21 }, () => ALICE).join(',');
        expect((await ask(`module=account&action=balancemulti&address=${ twentyOne }`)).message).toBe('NOTOK');
    });

    it('refuses the whole call when ONE address is malformed', async () =>
    {
        // Partial answers are worse than none here: a wallet cannot tell which entry is missing.
        const ask = await surface();
        expect((await ask(`module=account&action=balancemulti&address=${ ALICE },0x123`)).message).toBe('NOTOK');
    });
});

describe('account: txlist', () =>
{
    it('answers the Etherscan field names, spelled exactly as documented', async () =>
    {
        const ask = await surface();
        const rows = (await ask(`module=account&action=txlist&address=${ ALICE }`)).result as Array<Record<string, string>>;
        const row = rows[0]!;

        // The odd names ARE the contract - a client matches on them.
        for (const key of ['blockNumber', 'blockHash', 'timeStamp', 'hash', 'nonce', 'transactionIndex',
            'from', 'to', 'value', 'isError', 'txreceipt_status', 'confirmations'])
        {
            expect(row, `missing ${ key }`).toHaveProperty(key);
        }
        // Every value is a string: a wallet parses them itself.
        for (const value of Object.values(row))
        {
            expect(typeof value).toBe('string');
        }
    });

    it('counts confirmations including the block itself, as Etherscan does', async () =>
    {
        const ask = await surface();
        const rows = (await ask(`module=account&action=txlist&address=${ ALICE }&sort=asc`)).result as Array<Record<string, string>>;
        const head = 2;
        for (const row of rows)
        {
            expect(row.confirmations).toBe(String(head - Number(row.blockNumber) + 1));
        }
    });

    it('sorts ascending by default, because a wallet pages forward from its last height', async () =>
    {
        const ask = await surface();
        const ascending = (await ask(`module=account&action=txlist&address=${ ALICE }`)).result as Array<Record<string, string>>;
        const heights = ascending.map((row) => Number(row.blockNumber));
        expect(heights).toEqual([...heights].sort((a, b) => a - b));

        const descending = (await ask(`module=account&action=txlist&address=${ ALICE }&sort=desc`)).result as Array<Record<string, string>>;
        const reversed = descending.map((row) => Number(row.blockNumber));
        expect(reversed).toEqual([...reversed].sort((a, b) => b - a));
    });

    it('takes the documented default for an unrecognised sort rather than reversing silently', async () =>
    {
        const ask = await surface();
        const rows = (await ask(`module=account&action=txlist&address=${ ALICE }&sort=sideways`)).result as Array<Record<string, string>>;
        const heights = rows.map((row) => Number(row.blockNumber));
        expect(heights).toEqual([...heights].sort((a, b) => a - b));
    });

    it('narrows to a block range', async () =>
    {
        const ask = await surface();
        const rows = (await ask(`module=account&action=txlist&address=${ ALICE }&startblock=1&endblock=1`)).result as Array<Record<string, string>>;
        expect(rows.length).toBeGreaterThan(0);
        expect(new Set(rows.map((row) => row.blockNumber))).toEqual(new Set(['1']));
    });

    it('answers "none found" for a range that holds nothing, not an error', async () =>
    {
        const ask = await surface();
        const answer = await ask(`module=account&action=txlist&address=${ ALICE }&startblock=900&endblock=999`);
        expect(answer.message).toBe('No transactions found');
        expect(answer.result).toEqual([]);
    });

    it('pages without repeating or losing a row', async () =>
    {
        const ask = await surface();
        const page = async (n: number): Promise<string[]> =>
            ((await ask(`module=account&action=txlist&address=${ ALICE }&page=${ n }&offset=1&sort=asc`)).result as Array<Record<string, string>>)
                .map((row) => row.hash!);

        const first = await page(1);
        const second = await page(2);
        expect(first).toHaveLength(1);
        expect(second).toHaveLength(1);
        expect(first[0]).not.toBe(second[0]);
    });

    it.each([
        ['page zero', 'page=0'],
        ['a negative page', 'page=-1'],
        ['a fractional page', 'page=1.5'],
        ['a non-numeric page', 'page=first'],
        ['offset zero', 'offset=0'],
        ['an offset past the cap', 'offset=10001'],
        ['a negative start block', 'startblock=-1'],
        ['a fractional block', 'startblock=1.5'],
        ['a non-numeric block', 'endblock=latest']
    ])('refuses %s', async (_label, parameter) =>
    {
        const ask = await surface();
        const answer = await ask(`module=account&action=txlist&address=${ ALICE }&${ parameter }`);
        expect(answer.message).toBe('NOTOK');
    });

    it('accepts the exact edges of the documented ranges', async () =>
    {
        const ask = await surface();
        expect((await ask(`module=account&action=txlist&address=${ ALICE }&page=1&offset=1`)).status).toBe('1');
        expect((await ask(`module=account&action=txlist&address=${ ALICE }&offset=10000`)).status).toBe('1');
        // Block 0 to block 0 is a single-height window, and Alice transacts in it.
        expect((await ask(`module=account&action=txlist&address=${ ALICE }&startblock=0&endblock=0`)).status).toBe('1');
    });

    it('does not invent a gas limit it never indexed', async () =>
    {
        // Empty rather than fabricated: a wallet reading an invented gas limit mis-estimates.
        const ask = await surface();
        const rows = (await ask(`module=account&action=txlist&address=${ ALICE }`)).result as Array<Record<string, string>>;
        expect(rows[0]!.gas).toBe('');
    });

    it('reports a reverted transaction as an error, and a successful one as not', async () =>
    {
        const chain = [
            block(0, '0x00', '0xb0'),
            block(1, '0xb0', '0xb1', { status: 0 })
        ];
        const ask = await surface(chain);
        const rows = (await ask(`module=account&action=txlist&address=${ ALICE }`)).result as Array<Record<string, string>>;
        const reverted = rows.find((row) => row.blockNumber === '1')!;
        expect(reverted.isError).toBe('1');
        expect(reverted.txreceipt_status).toBe('0');
    });
});

describe('account: token transfers', () =>
{
    const chain = [
        block(0, '0x00', '0xb0'),
        tokenBlock(1, '0xb0', '0xb1')
    ];

    it('answers erc20 transfers with the singular tokenDecimal spelling', async () =>
    {
        const ask = await surface(chain);
        const rows = (await ask(`module=account&action=tokentx&address=${ ALICE }`)).result as Array<Record<string, string>>;
        expect(rows).toHaveLength(1);
        expect(rows[0]).toHaveProperty('tokenDecimal');
        expect(rows[0]).not.toHaveProperty('tokenDecimals');
        expect(rows[0]!.contractAddress).toBe(TOKEN);
    });

    it('does not answer an erc20 request with erc721 rows', async () =>
    {
        // The three standards share one table; the kind filter is what keeps them apart.
        const ask = await surface(chain);
        const nfts = await ask(`module=account&action=tokennfttx&address=${ ALICE }`);
        expect(nfts.message).toBe('No transactions found');

        const multi = await ask(`module=account&action=token1155tx&address=${ ALICE }`);
        expect(multi.message).toBe('No transactions found');
    });

    it('narrows to one token contract', async () =>
    {
        const ask = await surface(chain);
        const mine = await ask(`module=account&action=tokentx&address=${ ALICE }&contractaddress=${ TOKEN }`);
        expect((mine.result as unknown[]).length).toBe(1);

        const other = await ask(`module=account&action=tokentx&address=${ ALICE }&contractaddress=${ BOB }`);
        expect(other.message).toBe('No transactions found');
    });

    it('refuses a malformed contract filter rather than ignoring it', async () =>
    {
        const ask = await surface(chain);
        expect((await ask(`module=account&action=tokentx&address=${ ALICE }&contractaddress=0x123`)).message).toBe('NOTOK');
    });
});

describe('account: internal transactions', () =>
{
    it('says it does not index them instead of answering "none found"', async () =>
    {
        // "None found" would be a lie an accounting tool cannot detect.
        const ask = await surface();
        const answer = await ask(`module=account&action=txlistinternal&address=${ ALICE }`);
        expect(answer.message).toBe('NOTOK');
        expect(answer.result).toContain('not indexed');
    });
});

describe('transaction module', () =>
{
    it('separates "never seen" from "reverted"', async () =>
    {
        const chain = [
            block(0, '0x00', '0xb0'),
            block(1, '0xb0', '0xb1', { status: 0 })
        ];
        const ask = await surface(chain);

        const reverted = await ask(`module=transaction&action=gettxreceiptstatus&txhash=${ txHash(1, 0) }`);
        expect((reverted.result as { status: string }).status).toBe('0');

        const succeeded = await ask(`module=transaction&action=gettxreceiptstatus&txhash=${ txHash(0, 0) }`);
        expect((succeeded.result as { status: string }).status).toBe('1');

        // An unknown hash is NOT a failed transaction.
        const unknown = await ask(`module=transaction&action=gettxreceiptstatus&txhash=0x${ 'f'.repeat(64) }`);
        expect((unknown.result as { status: string }).status).toBe('');
    });

    it('describes a revert in getstatus, and stays quiet otherwise', async () =>
    {
        const chain = [
            block(0, '0x00', '0xb0'),
            block(1, '0xb0', '0xb1', { status: 0 })
        ];
        const ask = await surface(chain);

        const reverted = (await ask(`module=transaction&action=getstatus&txhash=${ txHash(1, 0) }`)).result as Record<string, string>;
        expect(reverted).toEqual({ isError: '1', errDescription: 'Reverted' });

        const fine = (await ask(`module=transaction&action=getstatus&txhash=${ txHash(0, 0) }`)).result as Record<string, string>;
        expect(fine).toEqual({ isError: '0', errDescription: '' });
    });

    it('finds a transaction whatever case the hash arrives in', async () =>
    {
        const ask = await surface();
        const upper = txHash(1, 0).toUpperCase().replace('0X', '0x');
        expect((await ask(`module=transaction&action=gettxreceiptstatus&txhash=${ upper }`)).status).toBe('1');
    });

    it.each([
        ['missing', ''],
        ['too short', '&txhash=0xabc'],
        ['an address, not a hash', `&txhash=${ ALICE }`],
        ['not hex', `&txhash=0x${ 'z'.repeat(64) }`]
    ])('refuses a transaction hash that is %s', async (_label, suffix) =>
    {
        const ask = await surface();
        const answer = await ask(`module=transaction&action=gettxreceiptstatus${ suffix }`);
        expect(answer.message).toBe('NOTOK');
        expect(answer.result).toContain('Invalid transaction hash');
    });
});

describe('stats module', () =>
{
    it('refuses to report a supply it does not track', async () =>
    {
        const ask = await surface();
        const answer = await ask('module=stats&action=ethsupply');
        expect(answer.message).toBe('NOTOK');
        expect(answer.result).toContain('not tracked');
    });
});

describe('security of the compatibility surface', () =>
{
    it('does not let a quoted address reach SQL', async () =>
    {
        // The address regex is the gate; everything past it is a bound parameter. This asserts
        // the gate, because a bind that is never reached is not protection.
        const ask = await surface();
        for (const attack of ["0x' OR 1=1 --", `${ ALICE }' OR '1'='1`, '0x%27', `${ ALICE }; DROP TABLE transactions`])
        {
            const answer = await ask(`module=account&action=txlist&address=${ encodeURIComponent(attack) }`);
            expect(answer.message).toBe('NOTOK');
        }
    });

    it('survives a sort value chosen to be interpolated into ORDER BY', async () =>
    {
        // `sort` IS interpolated - sqlite takes no parameter in ORDER BY - so the only thing
        // standing between it and the query is that it is reduced to a boolean first.
        const ask = await surface();
        const answer = await ask(`module=account&action=txlist&address=${ ALICE }&sort=${ encodeURIComponent('asc; DROP TABLE transactions') }`);
        expect(answer.status).toBe('1');

        // The table is still there.
        expect((await ask(`module=account&action=txlist&address=${ ALICE }`)).status).toBe('1');
    });

    it('refuses an enormous offset rather than trying to serve it', async () =>
    {
        const ask = await surface();
        expect((await ask(`module=account&action=txlist&address=${ ALICE }&offset=1000000000`)).message).toBe('NOTOK');
    });

    it('refuses a page number that is integral only as a double', async () =>
    {
        // Regression. `Number('999999999999999999999')` is 1e21 and `Number.isInteger` says yes,
        // so it passed validation, became a non-safe offset, and sqlite threw "datatype mismatch"
        // binding it - a 500 out of the function whose job is to refuse exactly this.
        const ask = await surface();
        for (const page of ['999999999999999999999', '9007199254740993', '1e21'])
        {
            const answer = await ask(`module=account&action=txlist&address=${ ALICE }&page=${ page }`);
            expect(answer.message, `page=${ page }`).toBe('NOTOK');
        }
        // The same value reached through the product of two individually-safe operands.
        expect((await ask(`module=account&action=txlist&address=${ ALICE }&page=9007199254740&offset=10000`)).message).toBe('NOTOK');
    });

    it('stays a clean refusal over HTTP, never a 500', async () =>
    {
        const get = await served();
        const response = await get(`/api?module=account&action=txlist&address=${ ALICE }&page=999999999999999999999`);
        expect(response.status).toBe(200);
        expect(((await response.json()) as Envelope).message).toBe('NOTOK');
    });

    it('reads no cookie, session or authorization header, which is what makes `*` safe', async () =>
    {
        const get = await served();
        const response = await get(`/api?module=account&action=balance&address=${ ALICE }`);
        // A credentialed CORS response would have to name an origin, never `*`; the wildcard is
        // only correct because every answer here is public chain data.
        expect(response.headers.get('access-control-allow-origin')).toBe('*');
        expect(response.headers.get('access-control-allow-credentials')).toBeNull();
        expect(response.headers.get('set-cookie')).toBeNull();
    });
});
