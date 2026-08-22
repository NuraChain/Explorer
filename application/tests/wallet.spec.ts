// @vitest-environment happy-dom
//
// The wallet store: the only security-carrying code on this side of the app. It decides what gets
// handed to an injected provider, and a mistake there is a transaction somebody signs. Nothing in
// it holds a key, and the last test in this file pins that it stays that way.
//
// Its OWN file on purpose. The store is a module-level singleton that starts EIP-6963 discovery
// once at construction, so every case needs a fresh module registry AND its wallets listening
// before the import - state that cannot be shared with the other stores without the two
// interleaving. A separate file gets a separate environment, which is the cheap way to be sure.
//
// The wallets are fakes implementing the EIP-1193 methods the store uses, announced the way a
// real extension announces itself. That is not excessive mocking - an injected wallet is somebody
// else's browser extension, and the alternative is a test that only runs on a machine with three
// of them installed.
import { describe, it, expect, afterEach, vi } from 'vitest';

import { METAMASK_RDNS, NURA_RDNS, TRUST_RDNS, brandFor, usableIcon, WALLET_BRANDS } from '../src/lib/wallets.ts';
import type { ChainInfo } from '../src/api.ts';

interface Call
{
    method: string;
    params?: unknown[];
}

const RABBY_RDNS = 'io.rabby';

const ACCOUNT = '0xAbCdEf0123456789AbCdEf0123456789AbCdEf01';
const OTHER = '0x2222222222222222222222222222222222222222';
const TO = '0x1111111111111111111111111111111111111111';

const CHAIN: ChainInfo = {
    chainId: 1020,
    name: 'Nura Chain',
    symbol: 'NURA',
    decimals: 18,
    rpcUrl: 'https://rpc.nurachain.net',
    siteUrl: 'https://nurachain.net',
    explorerUrl: 'https://explorer.nurachain.net'
};

/** Every `eip6963:requestProvider` listener installed by a test, so none outlives it. */
const installed: Array<() => void> = [];

interface Fake
{
    rdns: string;
    calls: Call[];
    emit(event: string, payload: unknown): void;
    announce(): void;
}

/** A wallet the test drives: it records what was asked and answers what it is told. */
function fakeWallet(rdns: string, answers: Record<string, unknown | (() => unknown)> = {}, icon = 'data:image/svg+xml;base64,PHN2Zy8+'): Fake
{
    const calls: Call[] = [];
    const listeners = new Map<string, Array<(payload: unknown) => void>>();

    const provider = {
        request: async (args: Call): Promise<unknown> =>
        {
            calls.push(args);
            const answer = answers[args.method];
            if (answer === undefined)
            {
                throw new Error(`unsupported method ${ args.method }`);
            }
            return typeof answer === 'function' ? (answer as () => unknown)() : answer;
        },
        on: (event: string, handler: (payload: unknown) => void): void =>
        {
            const existing = listeners.get(event) ?? [];
            existing.push(handler);
            listeners.set(event, existing);
        },
        removeListener: (event: string, handler: (payload: unknown) => void): void =>
        {
            listeners.set(event, (listeners.get(event) ?? []).filter((entry) => entry !== handler));
        }
    };

    const detail = { info: { uuid: `uuid-${ rdns }`, name: rdns, icon, rdns }, provider };
    const announce = (): void =>
    {
        window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail }));
    };

    // A real extension announces on its own AND when a page asks. The store asks at construction,
    // which is what this listener answers.
    window.addEventListener('eip6963:requestProvider', announce);
    installed.push(() => window.removeEventListener('eip6963:requestProvider', announce));

    return {
        rdns,
        calls,
        announce,
        emit: (event, payload) =>
        {
            for (const handler of listeners.get(event) ?? [])
            {
                handler(payload);
            }
        }
    };
}

/**
 * A FRESH wallet store, discovered against whatever wallets are announcing right now.
 *
 * Every case calls this, and it clears the registry itself rather than trusting a hook to have
 * run - shuffled ordering made hook-dependent setup race, and a security test that passes because
 * of the order it ran in is not a test.
 *
 * The announcement itself is synchronous inside the store's own `requestProvider` dispatch, so
 * `options()` is populated by the time the constructor returns. A silent session restore behind
 * one is not: it is two provider reads and the setters behind them, all microtasks.
 */
async function freshWallet(): Promise<import('../src/stores/wallet.store.ts').WalletApi>
{
    vi.resetModules();
    const module = await import('../src/stores/wallet.store.ts');
    const wallet = module.useWallet();

    for (let turn = 0; turn < 6; turn++)
    {
        await Promise.resolve();
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
    return wallet;
}

afterEach(() =>
{
    for (const uninstall of installed.splice(0))
    {
        uninstall();
    }
    localStorage.clear();
    vi.resetModules();
});

describe('the roster', () =>
{
    it('is the three this deployment offers, and nothing else', () =>
    {
        expect(WALLET_BRANDS.map((brand) => brand.rdns)).toEqual([METAMASK_RDNS, NURA_RDNS, TRUST_RDNS]);
        expect(brandFor(RABBY_RDNS)).toBeUndefined();
    });

    it('points every entry at somewhere the wallet can actually be got', () =>
    {
        for (const brand of WALLET_BRANDS)
        {
            expect(brand.install).toMatch(/^https:\/\//u);
            expect(brand.label).not.toBe('');
        }
    });

    it('takes only an image data URI as an announced icon', () =>
    {
        // An extension writes this field. A data image cannot run script; an http(s) one would be
        // a request to a third party made from this page, on every render of the dialog.
        expect(usableIcon('data:image/svg+xml;base64,PHN2Zy8+')).toBe('data:image/svg+xml;base64,PHN2Zy8+');
        expect(usableIcon('https://evil.example/pixel.png')).toBeNull();
        expect(usableIcon('javascript:alert(1)')).toBeNull();
        expect(usableIcon(undefined)).toBeNull();
    });
});

describe('discovery', () =>
{
    it('finds nothing, and says so, when no wallet announces', async () =>
    {
        const wallet = await freshWallet();
        expect(wallet.options()).toEqual([]);
        expect(wallet.available()).toBe(false);
        expect(wallet.account()).toBe('');
        expect(wallet.chainId()).toBe(0);
    });

    it('admits a rostered wallet and IGNORES one that is not', async () =>
    {
        // The gate. Someone whose only wallet is Rabby cannot connect here, by design - see
        // src/lib/wallets.ts for what that costs.
        fakeWallet(METAMASK_RDNS, { eth_accounts: [], eth_chainId: '0x3fc' });
        fakeWallet(RABBY_RDNS, { eth_accounts: [ACCOUNT], eth_chainId: '0x3fc' });

        const wallet = await freshWallet();
        expect(wallet.options().map((option) => option.rdns)).toEqual([METAMASK_RDNS]);
        expect(wallet.available()).toBe(true);
    });

    it('lists in ROSTER order, whatever order the extensions answered in', async () =>
    {
        // Which extension announces first is a race between two browser extensions. A dialog
        // whose rows move between two visits is a dialog nobody can aim at.
        fakeWallet(TRUST_RDNS, { eth_accounts: [], eth_chainId: '0x1' });
        fakeWallet(METAMASK_RDNS, { eth_accounts: [], eth_chainId: '0x1' });

        const wallet = await freshWallet();
        expect(wallet.options().map((option) => option.rdns)).toEqual([METAMASK_RDNS, TRUST_RDNS]);
    });

    it('takes the first announcement per wallet and ignores repeats', async () =>
    {
        const metamask = fakeWallet(METAMASK_RDNS, { eth_accounts: [], eth_chainId: '0x1' });
        const wallet = await freshWallet();

        metamask.announce();
        metamask.announce();
        expect(wallet.options()).toHaveLength(1);
    });

    it('drops an icon that is not an image data URI, rather than rendering it', async () =>
    {
        fakeWallet(METAMASK_RDNS, { eth_accounts: [], eth_chainId: '0x1' }, 'https://evil.example/pixel.png');
        const wallet = await freshWallet();
        expect(wallet.options()[0]?.icon).toBeNull();
    });

    it('does NOT prompt on load - it asks only what is already approved', async () =>
    {
        // A permission dialog nobody asked for is what makes people close a page. And with no
        // remembered wallet there is nothing to ask at all.
        const metamask = fakeWallet(METAMASK_RDNS, { eth_accounts: [ACCOUNT], eth_chainId: '0x3fc' });
        await freshWallet();

        expect(metamask.calls.map((call) => call.method)).not.toContain('eth_requestAccounts');
        expect(metamask.calls).toHaveLength(0);
    });

    it('restores the wallet used last, silently', async () =>
    {
        localStorage.setItem('nura.wallet', TRUST_RDNS);
        const trust = fakeWallet(TRUST_RDNS, { eth_accounts: [ACCOUNT], eth_chainId: '0x3fc' });
        fakeWallet(METAMASK_RDNS, { eth_accounts: [OTHER], eth_chainId: '0x1' });

        const wallet = await freshWallet();
        expect(wallet.account()).toBe(ACCOUNT.toLowerCase());
        expect(wallet.connectedTo()).toBe(TRUST_RDNS);
        // `eth_accounts` answers only for an origin already approved, so this never prompts.
        expect(trust.calls.map((call) => call.method)).toContain('eth_accounts');
        expect(trust.calls.map((call) => call.method)).not.toContain('eth_requestAccounts');
    });

    it('does not restore a remembered wallet that is no longer installed', async () =>
    {
        localStorage.setItem('nura.wallet', TRUST_RDNS);
        fakeWallet(METAMASK_RDNS, { eth_accounts: [OTHER], eth_chainId: '0x1' });

        const wallet = await freshWallet();
        expect(wallet.account()).toBe('');
        expect(wallet.connectedTo()).toBe('');
    });
});

describe('connecting', () =>
{
    it('prompts the wallet that was chosen, and only that one', async () =>
    {
        const metamask = fakeWallet(METAMASK_RDNS, { eth_accounts: [], eth_chainId: '0x1', eth_requestAccounts: [ACCOUNT] });
        const trust = fakeWallet(TRUST_RDNS, { eth_accounts: [], eth_chainId: '0x1', eth_requestAccounts: [OTHER] });

        const wallet = await freshWallet();
        await wallet.connect(METAMASK_RDNS);

        expect(wallet.account()).toBe(ACCOUNT.toLowerCase());
        expect(wallet.connectedTo()).toBe(METAMASK_RDNS);
        expect(metamask.calls.map((call) => call.method)).toContain('eth_requestAccounts');
        // Never PROMPTED, which is the claim - not "never spoken to". A page has one store for
        // its whole life; this file has one window and a new store per case, so a store left over
        // from an earlier case still hears this announcement and may ask it the silent question.
        expect(trust.calls.map((call) => call.method)).not.toContain('eth_requestAccounts');
    });

    it('records the chain the chosen wallet is on, lower-casing the account', async () =>
    {
        fakeWallet(METAMASK_RDNS, { eth_accounts: [], eth_chainId: '0x3fc', eth_requestAccounts: [ACCOUNT] });
        const wallet = await freshWallet();
        await wallet.connect(METAMASK_RDNS);

        // Lower-cased so it compares against the index, which stores addresses that way.
        expect(wallet.account()).toBe(ACCOUNT.toLowerCase());
        expect(wallet.chainId()).toBe(1020);
    });

    it('leaves the account empty when the person refuses, rather than throwing', async () =>
    {
        fakeWallet(METAMASK_RDNS, {
            eth_accounts: [],
            eth_chainId: '0x1',
            eth_requestAccounts: () =>
            {
                throw Object.assign(new Error('User rejected'), { code: 4001 });
            }
        });
        const wallet = await freshWallet();

        await expect(wallet.connect(METAMASK_RDNS)).resolves.toBeUndefined();
        expect(wallet.account()).toBe('');
        expect(wallet.connectedTo()).toBe('');
    });

    it('does nothing at all when asked for a wallet that is not installed', async () =>
    {
        const wallet = await freshWallet();
        await expect(wallet.connect(NURA_RDNS)).resolves.toBeUndefined();
        expect(wallet.account()).toBe('');
    });

    it('follows the connected wallet, and NOT the other one, when accounts change', async () =>
    {
        // With two installed, listening to both would let whichever fired last decide what the
        // page thinks the reader's account is.
        const metamask = fakeWallet(METAMASK_RDNS, { eth_accounts: [], eth_chainId: '0x1', eth_requestAccounts: [ACCOUNT] });
        const trust = fakeWallet(TRUST_RDNS, { eth_accounts: [], eth_chainId: '0x1', eth_requestAccounts: [OTHER] });

        const wallet = await freshWallet();
        await wallet.connect(METAMASK_RDNS);

        trust.emit('accountsChanged', [OTHER]);
        expect(wallet.account()).toBe(ACCOUNT.toLowerCase());

        metamask.emit('accountsChanged', [TO]);
        expect(wallet.account()).toBe(TO.toLowerCase());

        metamask.emit('chainChanged', '0x3fc');
        expect(wallet.chainId()).toBe(1020);
    });

    it('moves its listeners when the reader switches wallets', async () =>
    {
        const metamask = fakeWallet(METAMASK_RDNS, { eth_accounts: [], eth_chainId: '0x1', eth_requestAccounts: [ACCOUNT] });
        const trust = fakeWallet(TRUST_RDNS, { eth_accounts: [], eth_chainId: '0x1', eth_requestAccounts: [OTHER] });

        const wallet = await freshWallet();
        await wallet.connect(METAMASK_RDNS);
        await wallet.connect(TRUST_RDNS);
        expect(wallet.account()).toBe(OTHER.toLowerCase());

        // The wallet left behind must no longer be able to move the page's account.
        metamask.emit('accountsChanged', [TO]);
        expect(wallet.account()).toBe(OTHER.toLowerCase());

        trust.emit('accountsChanged', [TO]);
        expect(wallet.account()).toBe(TO.toLowerCase());
    });

    it('forgets the account locally on disconnect, without claiming to revoke anything', async () =>
    {
        // A dapp cannot revoke its own permission; the wallet owns that. Pretending otherwise
        // would leave a reader thinking they had disconnected when they had not.
        const metamask = fakeWallet(METAMASK_RDNS, { eth_accounts: [], eth_chainId: '0x1', eth_requestAccounts: [ACCOUNT] });
        const wallet = await freshWallet();
        await wallet.connect(METAMASK_RDNS);
        expect(localStorage.getItem('nura.wallet')).toBe(METAMASK_RDNS);

        wallet.disconnect();
        expect(wallet.account()).toBe('');
        expect(wallet.connectedTo()).toBe('');
        // Forgotten, so the next load does not silently reconnect what someone just left.
        expect(localStorage.getItem('nura.wallet')).toBeNull();
        expect(metamask.calls.map((call) => call.method)).not.toContain('wallet_revokePermissions');
    });
});

describe('switching networks', () =>
{
    it('asks the connected wallet with a hex chain id', async () =>
    {
        const metamask = fakeWallet(METAMASK_RDNS, {
            eth_accounts: [], eth_chainId: '0x1', eth_requestAccounts: [ACCOUNT], wallet_switchEthereumChain: null
        });
        const wallet = await freshWallet();
        await wallet.connect(METAMASK_RDNS);

        expect(await wallet.switchTo(1020)).toBe(true);
        expect(metamask.calls.find((call) => call.method === 'wallet_switchEthereumChain')?.params).toEqual([{ chainId: '0x3fc' }]);
        expect(wallet.chainId()).toBe(1020);
    });

    it('answers false when the wallet refuses or does not have the chain', async () =>
    {
        fakeWallet(METAMASK_RDNS, {
            eth_accounts: [], eth_chainId: '0x1', eth_requestAccounts: [ACCOUNT],
            wallet_switchEthereumChain: () =>
            {
                throw Object.assign(new Error('Unrecognized chain'), { code: 4902 });
            }
        });
        const wallet = await freshWallet();
        await wallet.connect(METAMASK_RDNS);

        expect(await wallet.switchTo(1020)).toBe(false);
        // The recorded chain must NOT move on a refusal, or the page claims to be somewhere it
        // is not and offers a Write button for the wrong network.
        expect(wallet.chainId()).toBe(1);
    });

    it('answers false rather than throwing when nothing is connected', async () =>
    {
        const wallet = await freshWallet();
        expect(await wallet.switchTo(1)).toBe(false);
    });
});

describe('adding the network', () =>
{
    it('hands the wallet the chain exactly as configured', async () =>
    {
        const metamask = fakeWallet(METAMASK_RDNS, { eth_accounts: [], eth_chainId: '0x1', wallet_addEthereumChain: null });
        const wallet = await freshWallet();

        expect(await wallet.addChain(METAMASK_RDNS, CHAIN)).toBe('added');
        expect(metamask.calls.find((call) => call.method === 'wallet_addEthereumChain')?.params).toEqual([{
            // A hex QUANTITY, which is what wallets take - never the decimal number.
            chainId: '0x3fc',
            // The configured name, never a localized one: this is the identity the wallet keeps.
            chainName: 'Nura Chain',
            nativeCurrency: { name: 'NURA', symbol: 'NURA', decimals: 18 },
            rpcUrls: ['https://rpc.nurachain.net'],
            blockExplorerUrls: ['https://explorer.nurachain.net']
        }]);
    });

    it('needs a chosen wallet but NOT a connected one', async () =>
    {
        // Storing a network is not an account operation. Making someone connect first would ask
        // for their address to do something that never needed it.
        const metamask = fakeWallet(METAMASK_RDNS, { eth_accounts: [], eth_chainId: '0x1', wallet_addEthereumChain: null });
        const wallet = await freshWallet();

        expect(wallet.account()).toBe('');
        expect(await wallet.addChain(METAMASK_RDNS, CHAIN)).toBe('added');
        expect(metamask.calls.map((call) => call.method)).not.toContain('eth_requestAccounts');
    });

    it('falls back to this origin only where the deployment named no explorer', async () =>
    {
        // A wallet stores this permanently, so a preview host saved there is a dead link the
        // reader can never fix from inside the wallet - the public URL wins wherever there is one.
        const metamask = fakeWallet(METAMASK_RDNS, { eth_accounts: [], eth_chainId: '0x1', wallet_addEthereumChain: null });
        const wallet = await freshWallet();

        await wallet.addChain(METAMASK_RDNS, { ...CHAIN, explorerUrl: '' });
        const sent = metamask.calls.find((call) => call.method === 'wallet_addEthereumChain');
        expect((sent?.params?.[0] as { blockExplorerUrls: string[] }).blockExplorerUrls).toEqual([window.location.origin]);
    });

    it('tells a dismissal apart from a refusal, and both from a ticker clash', async () =>
    {
        const outcomes: Array<[unknown, string]> = [
            [Object.assign(new Error('User rejected'), { code: 4001 }), 'dismissed'],
            [Object.assign(new Error('Bad params'), { code: -32602 }), 'mismatch'],
            [new Error('something else'), 'refused']
        ];

        for (const [thrown, expected] of outcomes)
        {
            const rdns = METAMASK_RDNS;
            fakeWallet(rdns, {
                eth_accounts: [], eth_chainId: '0x1',
                wallet_addEthereumChain: () =>
                {
                    throw thrown;
                }
            });
            const wallet = await freshWallet();
            expect(await wallet.addChain(rdns, CHAIN)).toBe(expected);

            for (const uninstall of installed.splice(0))
            {
                uninstall();
            }
        }
    });

    it('refuses for a wallet that is not installed, without inventing a provider', async () =>
    {
        const wallet = await freshWallet();
        expect(await wallet.addChain(NURA_RDNS, CHAIN)).toBe('refused');
    });
});

describe('sending', () =>
{
    /** A connected store over one wallet that will accept a transaction. */
    async function connected(answers: Record<string, unknown | (() => unknown)> = {}): Promise<{
        wallet: import('../src/stores/wallet.store.ts').WalletApi;
        metamask: Fake;
    }>
    {
        const metamask = fakeWallet(METAMASK_RDNS, {
            eth_accounts: [], eth_chainId: '0x3fc', eth_requestAccounts: [ACCOUNT], eth_sendTransaction: '0xhash', ...answers
        });
        const wallet = await freshWallet();
        await wallet.connect(METAMASK_RDNS);
        return { wallet, metamask };
    }

    it('sends from the connected account and answers its hash', async () =>
    {
        const { wallet, metamask } = await connected();
        expect(await wallet.send({ to: TO, data: '0xdeadbeef', value: '' })).toBe('0xhash');
        expect(metamask.calls.find((call) => call.method === 'eth_sendTransaction')?.params?.[0])
            .toMatchObject({ from: ACCOUNT.toLowerCase(), to: TO, data: '0xdeadbeef' });
    });

    it('omits `value` entirely for a call that sends nothing', async () =>
    {
        // A value field on a non-payable call is an invitation to send currency the contract will
        // refuse, reverting and charging for the privilege.
        const { wallet, metamask } = await connected();
        for (const value of ['', '0'])
        {
            metamask.calls.length = 0;
            await wallet.send({ to: TO, data: '0x', value });
            const sent = metamask.calls.find((call) => call.method === 'eth_sendTransaction');
            expect(Object.keys(sent?.params?.[0] as object)).not.toContain('value');
        }
    });

    it('hands wei to the wallet as a HEX quantity, exactly', async () =>
    {
        const { wallet, metamask } = await connected();
        await wallet.send({ to: TO, data: '0x', value: (10n ** 18n).toString() });
        const sent = metamask.calls.find((call) => call.method === 'eth_sendTransaction');
        expect((sent?.params?.[0] as { value: string }).value).toBe(`0x${ (10n ** 18n).toString(16) }`);
    });

    it('carries a value no double could hold, without rounding it', async () =>
    {
        const { wallet, metamask } = await connected();
        const huge = (2n ** 200n + 12345n).toString();
        await wallet.send({ to: TO, data: '0x', value: huge });
        const sent = metamask.calls.find((call) => call.method === 'eth_sendTransaction');
        expect(BigInt((sent?.params?.[0] as { value: string }).value)).toBe(BigInt(huge));
    });

    it('refuses to send with no wallet, and with no connected account', async () =>
    {
        const none = await freshWallet();
        await expect(none.send({ to: TO, data: '0x', value: '' })).rejects.toThrow('no wallet');

        const metamask = fakeWallet(METAMASK_RDNS, { eth_accounts: [], eth_chainId: '0x1', eth_sendTransaction: '0xhash' });
        const discovered = await freshWallet();
        // Discovered but never connected: there is a provider and no account, and the store must
        // not reach for one.
        await expect(discovered.send({ to: TO, data: '0x', value: '' })).rejects.toThrow('no wallet');
        expect(metamask.calls.map((call) => call.method)).not.toContain('eth_sendTransaction');
    });

    it('never asks a wallet for a key or a signature it could store', async () =>
    {
        // The explorer holds no key and never sees one. Anything in this list would mean it does.
        const { wallet, metamask } = await connected({ wallet_switchEthereumChain: null, wallet_addEthereumChain: null });

        await wallet.switchTo(1);
        await wallet.send({ to: TO, data: '0x', value: '1' });
        await wallet.addChain(METAMASK_RDNS, CHAIN);

        const asked = new Set(metamask.calls.map((call) => call.method));
        for (const forbidden of ['eth_sign', 'personal_sign', 'eth_signTypedData_v4', 'eth_signTransaction',
            'eth_sendRawTransaction', 'eth_private_key', 'wallet_getPermissions'])
        {
            expect(asked, `asked for ${ forbidden }`).not.toContain(forbidden);
        }
    });
});
