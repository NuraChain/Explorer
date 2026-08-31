// @vitest-environment happy-dom
//
// The deep-link transport: the page's half of `nurawallet://`, and the only route to Nura Wallet
// from a browser it does not own. This is provider code, so the wallet store's rule applies to it
// - a mistake here is a transaction somebody signs - and none of it can be tried by hand without
// the application installed and the explorer served over https.
//
// `window.location` is REPLACED rather than driven. Assigning a custom scheme to the real one is
// a navigation, and the url handed to the operating system is exactly what these cases need to
// read back. Its OWN file, like the wallet store's, because the module installs once per registry.
import { describe, it, expect, afterEach, vi } from 'vitest';

import { NURA_RDNS } from '../src/lib/wallets.ts';

const SITE = 'https://explorer.nurachain.net';
const ACCOUNT = '0xabcdef0123456789abcdef0123456789abcdef01';

interface Announced
{
    info: { uuid: string; name: string; icon: string; rdns: string };
    provider: {
        request(args: { method: string; params?: unknown[] }): Promise<unknown>;
        on(event: string, handler: (payload: unknown) => void): void;
        removeListener(event: string, handler: (payload: unknown) => void): void;
    };
}

interface SentRequest
{
    id: string;
    method: string;
    params: unknown[];
    callback: string;
}

/** The stand-in for `window.location`: everything the module reads, and an `href` it can write. */
function stubLocation(protocol: string, hash = ''): { href: string }
{
    const location = {
        protocol,
        origin: `${ protocol }//explorer.nurachain.net`,
        pathname: '/tx/0xfeed',
        search: '',
        hash,
        href: `${ protocol }//explorer.nurachain.net/tx/0xfeed${ hash }`
    };
    Object.defineProperty(window, 'location', { value: location, configurable: true, writable: true });
    return location;
}

/**
 * Installs the transport and hands back what it announced, or null when it announced nothing.
 *
 * The announcement is synchronous inside `installNuraDeepLink`, so a listener wrapped around the
 * call catches it without waiting - the same shape the wallet store's own discovery relies on.
 */
async function install(): Promise<Announced | null>
{
    vi.resetModules();

    let announced: Announced | null = null;
    const listen = (event: Event): void =>
    {
        announced = (event as CustomEvent<Announced>).detail;
    };

    window.addEventListener('eip6963:announceProvider', listen);
    const module = await import('../src/lib/nura-deeplink.ts');
    module.installNuraDeepLink();
    window.removeEventListener('eip6963:announceProvider', listen);

    return announced;
}

function fromBase64Url(value: string): string
{
    const padded = value.replaceAll('-', '+').replaceAll('_', '/');
    return new TextDecoder().decode(Uint8Array.from(atob(padded), (char) => char.codePointAt(0) ?? 0));
}

function toBase64Url(value: string): string
{
    let raw = '';
    for (const byte of new TextEncoder().encode(value))
    {
        raw += String.fromCodePoint(byte);
    }
    return btoa(raw).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

/** The request the wallet would have received, read back out of the deep link. */
function sent(href: string): SentRequest
{
    expect(href.startsWith('nurawallet://dapp?request=')).toBe(true);
    const packed = new URL(href).searchParams.get('request') ?? '';
    return JSON.parse(fromBase64Url(packed)) as SentRequest;
}

/**
 * The wallet's answer, arriving the way it really does: written by the tab the wallet reopened,
 * and picked up here through `storage`. That is the fallback path - a browser with
 * BroadcastChannel takes the other one - and it is the one a test can drive deterministically.
 */
function answer(id: string, body: { result?: unknown; error?: { code: number; message: string } }): void
{
    window.dispatchEvent(new StorageEvent('storage', {
        key: `nura.deeplink.reply/${ id }`,
        newValue: JSON.stringify({ id, ...body })
    }));
}

afterEach(() =>
{
    localStorage.clear();
    Reflect.deleteProperty(window, '__nuraWallet');
    vi.resetModules();
});

describe('where the transport can work at all', () =>
{
    it('says nothing over http, because the wallet refuses a callback that is not https', async () =>
    {
        stubLocation('http:');
        expect(await install()).toBeNull();
    });

    it('says nothing inside the wallet\'s own browser, where a real provider is already injected', async () =>
    {
        stubLocation('https:');
        Object.defineProperty(window, '__nuraWallet', { value: {}, configurable: true });
        expect(await install()).toBeNull();
    });

    it('announces once and only once', async () =>
    {
        stubLocation('https:');
        expect(await install()).not.toBeNull();

        const seen: unknown[] = [];
        const listen = (event: Event): void => void seen.push((event as CustomEvent).detail);
        window.addEventListener('eip6963:announceProvider', listen);
        const module = await import('../src/lib/nura-deeplink.ts');
        module.installNuraDeepLink();
        window.removeEventListener('eip6963:announceProvider', listen);

        expect(seen).toEqual([]);
    });
});

describe('the announcement', () =>
{
    it('carries the rdns the wallet itself uses, so the roster gate lets it through', async () =>
    {
        stubLocation('https:');
        const announced = await install();

        expect(announced?.info.rdns).toBe(NURA_RDNS);
        expect(announced?.info.name).toBe('Nura Wallet');
    });

    it('brings no artwork, leaving the picker to draw its own glyph', async () =>
    {
        stubLocation('https:');
        expect((await install())?.info.icon).toBe('');
    });

    it('answers on request as well as unprompted', async () =>
    {
        stubLocation('https:');
        const announced = await install();

        const seen: Announced[] = [];
        const listen = (event: Event): void => void seen.push((event as CustomEvent<Announced>).detail);
        window.addEventListener('eip6963:announceProvider', listen);
        window.dispatchEvent(new Event('eip6963:requestProvider'));
        window.removeEventListener('eip6963:announceProvider', listen);

        // Every install in this file leaves its listener on the one window these cases share, so
        // what is being pinned is that THIS one answered - by the uuid it announced itself under.
        expect(seen.map((entry) => entry.info.uuid)).toContain(announced?.info.uuid);
        expect(seen.every((entry) => entry.info.rdns === NURA_RDNS)).toBe(true);
    });
});

describe('the questions answered without opening the application', () =>
{
    it('reads accounts, chain and network id locally', async () =>
    {
        const location = stubLocation('https:');
        const announced = await install();
        const before = location.href;

        expect(await announced?.provider.request({ method: 'eth_accounts' })).toEqual([]);
        expect(await announced?.provider.request({ method: 'eth_chainId' })).toBe('0x0');
        expect(await announced?.provider.request({ method: 'net_version' })).toBe('0');

        // Nothing left for the operating system: a page that opened a wallet to read a chain id
        // would open it on every visit.
        expect(location.href).toBe(before);
    });

    it('starts with the network UNKNOWN rather than assuming the chain this explorer indexes', async () =>
    {
        stubLocation('https:');
        const announced = await install();

        // 0 is what the wallet store reads out of this, which leaves its control in the "switch
        // network" state - a question the reader answers and the wallet confirms. Answering 0x3fc
        // here would show "ready" over a Write button aimed at whatever chain the wallet is on.
        expect(await announced?.provider.request({ method: 'eth_chainId' })).toBe('0x0');
    });
});

describe('a round trip', () =>
{
    it('hands the wallet the method, its params and a callback carrying no more than the page', async () =>
    {
        const location = stubLocation('https:');
        const announced = await install();

        const pending = announced!.provider.request({ method: 'eth_requestAccounts' });
        const request = sent(location.href);

        expect(request.method).toBe('eth_requestAccounts');
        expect(request.params).toEqual([]);
        expect(request.callback).toBe(`${ SITE }/tx/0xfeed`);
        expect(request.id).not.toBe('');

        answer(request.id, { result: [ACCOUNT] });
        expect(await pending).toEqual([ACCOUNT]);
    });

    it('settles the tab that asked from the reply the returning tab relays', async () =>
    {
        const location = stubLocation('https:');
        const announced = await install();

        const seen: unknown[] = [];
        announced!.provider.on('accountsChanged', (payload) => void seen.push(payload));

        const pending = announced!.provider.request({ method: 'eth_requestAccounts' });
        answer(sent(location.href).id, { result: [ACCOUNT] });

        expect(await pending).toEqual([ACCOUNT]);
        expect(seen).toEqual([[ACCOUNT]]);

        // And from now on without a round trip, which is what spares a returning reader one.
        expect(await announced?.provider.request({ method: 'eth_accounts' })).toEqual([ACCOUNT]);
    });

    it('rejects with the code the wallet sent, so a refusal stays a refusal', async () =>
    {
        const location = stubLocation('https:');
        const announced = await install();

        const pending = announced!.provider.request({ method: 'personal_sign', params: ['0x00', ACCOUNT] });
        const request = sent(location.href);

        expect(request.params).toEqual(['0x00', ACCOUNT]);

        answer(request.id, { error: { code: 4001, message: 'Rejected' } });
        await expect(pending).rejects.toMatchObject({ code: 4001 });
    });

    it('ignores a reply for a request it is not holding', async () =>
    {
        stubLocation('https:');
        await install();

        expect(() => answer('never-asked', { result: [ACCOUNT] })).not.toThrow();
    });
});

describe('the network, once the wallet has confirmed one', () =>
{
    it('is taken from a switch the wallet actually answered', async () =>
    {
        const location = stubLocation('https:');
        const announced = await install();

        const seen: unknown[] = [];
        announced!.provider.on('chainChanged', (payload) => void seen.push(payload));

        const pending = announced!.provider.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: '0x3fc' }]
        });
        // The wallet answers a switch it made with null, and one it did not with an error.
        answer(sent(location.href).id, { result: null });
        await pending;

        expect(await announced?.provider.request({ method: 'eth_chainId' })).toBe('0x3fc');
        expect(await announced?.provider.request({ method: 'net_version' })).toBe('1020');
        expect(seen).toEqual(['0x3fc']);
    });

    it('is not taken from one the wallet refused', async () =>
    {
        const location = stubLocation('https:');
        const announced = await install();

        const pending = announced!.provider.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: '0x3fc' }]
        });
        answer(sent(location.href).id, { error: { code: 4902, message: 'Unknown chain' } });
        await expect(pending).rejects.toMatchObject({ code: 4902 });

        expect(await announced?.provider.request({ method: 'eth_chainId' })).toBe('0x0');
    });

    it('survives the reload the deep link puts the reader through', async () =>
    {
        const location = stubLocation('https:');
        const first = await install();

        const pending = first!.provider.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: '0x3fc' }]
        });
        answer(sent(location.href).id, { result: null });
        await pending;

        stubLocation('https:');
        const second = await install();

        expect(await second?.provider.request({ method: 'eth_chainId' })).toBe('0x3fc');
    });
});

describe('the returning tab', () =>
{
    it('takes the wallet\'s answer out of the address bar', async () =>
    {
        const packed = toBase64Url(JSON.stringify({ id: 'abc', result: [ACCOUNT] }));
        stubLocation('https:', `#nura=${ packed }`);

        const tidy = vi.spyOn(history, 'replaceState');
        await install();

        // The reader is left looking at the page rather than at a fragment holding somebody's
        // account, and a reload cannot replay the reply.
        expect(tidy).toHaveBeenCalledWith(null, '', '/tx/0xfeed');
        tidy.mockRestore();
    });

    it('is not confused by a fragment that is not one of ours', async () =>
    {
        stubLocation('https:', '#section-two');
        expect(await install()).not.toBeNull();
    });
});
