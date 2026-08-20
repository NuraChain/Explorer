// @vitest-environment happy-dom
//
// The wallet store: the only security-carrying code on this side of the app. It decides what gets
// handed to an injected provider, and a mistake there is a transaction somebody signs. Nothing in
// it holds a key, and the last test in this file pins that it stays that way.
//
// Its OWN file on purpose. The store is a module-level singleton that reads `window.ethereum`
// once at construction, so every case needs a fresh module registry AND a provider installed
// before the import - state that cannot be shared with the other stores without the two
// interleaving. A separate file gets a separate environment, which is the cheap way to be sure.
//
// The provider is a fake implementing the EIP-1193 methods the store uses. That is not excessive
// mocking - `window.ethereum` is somebody else's browser extension, and the alternative is a test
// that only runs on a machine with a wallet installed.
import { describe, it, expect, afterEach, vi } from 'vitest';

interface Call
{
    method: string;
    params?: unknown[];
}

/** An injected wallet the test drives: it records what was asked and answers what it is told. */
function fakeWallet(answers: Record<string, unknown | (() => unknown)> = {}): {
    calls: Call[];
    emit(event: string, payload: unknown): void;
    install(): void;
}
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

    return {
        calls,
        emit: (event, payload) =>
        {
            for (const handler of listeners.get(event) ?? [])
            {
                handler(payload);
            }
        },
        install: () =>
        {
            (globalThis as { ethereum?: unknown }).ethereum = provider;
        }
    };
}

/**
 * A FRESH wallet store, built against whatever provider is installed right now.
 *
 * Every case calls this, and it clears the registry itself rather than trusting a hook to have
 * run - shuffled ordering made hook-dependent setup race, and a security test that passes because
 * of the order it ran in is not a test.
 *
 * The store's load-time read is `await Promise.all([...])` with a `.catch()` on each arm, so it
 * settles several microtask turns after construction. Waiting for the provider to have been ASKED
 * is the deterministic signal; where there is no provider there is nothing async to wait for.
 */
async function freshWallet(provider?: { calls: Call[] }): Promise<import('../src/stores/wallet.store.ts').WalletApi>
{
    vi.resetModules();
    const module = await import('../src/stores/wallet.store.ts');
    const wallet = module.useWallet();

    if (provider !== undefined)
    {
        // BOTH arms of the load-time `Promise.all`, not just one. Waiting on a single call left
        // the other still in flight, and its `setAccount('')` could land AFTER a connect() the
        // test had already performed - wiping the account the assertion was about.
        await vi.waitFor(() =>
        {
            const asked = new Set(provider.calls.map((call) => call.method));
            expect(asked.has('eth_accounts') && asked.has('eth_chainId')).toBe(true);
        });
    }
    // Drain what is left: the `.catch()` on each arm, the `Promise.all` join, and the setters
    // behind it are all microtasks queued after the requests resolve.
    for (let turn = 0; turn < 4; turn++)
    {
        await Promise.resolve();
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
    return wallet;
}

const ACCOUNT = '0xAbCdEf0123456789AbCdEf0123456789AbCdEf01';
const TO = '0x1111111111111111111111111111111111111111';

afterEach(() =>
{
    delete (globalThis as { ethereum?: unknown }).ethereum;
    vi.resetModules();
});

describe('the wallet store', () =>
{
    it('reports no wallet when nothing is injected, without throwing', async () =>
    {
        const wallet = await freshWallet();
        expect(wallet.available()).toBe(false);
        expect(wallet.account()).toBe('');
        expect(wallet.chainId()).toBe(0);
    });

    it('does NOT prompt on load - it asks what is already approved', async () =>
    {
        // `eth_requestAccounts` on load is a permission dialog nobody asked for. This is the
        // difference between a returning reader staying connected and a first-time one being
        // interrupted before they have read anything.
        const provider = fakeWallet({ eth_accounts: [], eth_chainId: '0x3fc' });
        provider.install();
        await freshWallet(provider);

        expect(provider.calls.map((call) => call.method)).toContain('eth_accounts');
        expect(provider.calls.map((call) => call.method)).not.toContain('eth_requestAccounts');
    });

    it('picks up an already-approved account, lower-cased', async () =>
    {
        const provider = fakeWallet({ eth_accounts: [ACCOUNT], eth_chainId: '0x3fc' });
        provider.install();
        const wallet = await freshWallet(provider);

        expect(wallet.available()).toBe(true);
        // Lower-cased so it compares against the index, which stores addresses that way.
        expect(wallet.account()).toBe(ACCOUNT.toLowerCase());
        expect(wallet.chainId()).toBe(1020);
    });

    it('reads a hex chain id, and answers 0 when the wallet does not say', async () =>
    {
        const provider = fakeWallet({ eth_accounts: [], eth_chainId: 'not-a-number' });
        provider.install();
        const wallet = await freshWallet(provider);
        expect(wallet.chainId()).toBe(0);
    });

    it('survives a provider that rejects every read', async () =>
    {
        const provider = fakeWallet({});
        provider.install();
        const wallet = await freshWallet(provider);
        expect(wallet.available()).toBe(true);
        expect(wallet.account()).toBe('');
        expect(wallet.chainId()).toBe(0);
    });

    it('connects on request and records the account and chain', async () =>
    {
        const provider = fakeWallet({
            eth_accounts: [],
            eth_chainId: '0x3fc',
            eth_requestAccounts: [ACCOUNT]
        });
        provider.install();
        const wallet = await freshWallet(provider);

        await wallet.connect();
        expect(wallet.account()).toBe(ACCOUNT.toLowerCase());
        expect(wallet.chainId()).toBe(1020);
    });

    it('leaves the account empty when the person refuses, rather than throwing', async () =>
    {
        const provider = fakeWallet({
            eth_accounts: [],
            eth_chainId: '0x1',
            eth_requestAccounts: () =>
            {
                throw Object.assign(new Error('User rejected'), { code: 4001 });
            }
        });
        provider.install();
        const wallet = await freshWallet(provider);

        await expect(wallet.connect()).resolves.toBeUndefined();
        expect(wallet.account()).toBe('');
    });

    it('forgets the account locally on disconnect, without claiming to revoke anything', async () =>
    {
        // A dapp cannot revoke its own permission; the wallet owns that. Pretending otherwise
        // would leave a reader thinking they had disconnected when they had not.
        const provider = fakeWallet({ eth_accounts: [ACCOUNT], eth_chainId: '0x1' });
        provider.install();
        const wallet = await freshWallet(provider);
        expect(wallet.account()).not.toBe('');

        wallet.disconnect();
        expect(wallet.account()).toBe('');
        expect(provider.calls.map((call) => call.method)).not.toContain('wallet_revokePermissions');
    });

    it('follows an account switched in another tab', async () =>
    {
        // The alternative is a Write button aimed at an account that is no longer there.
        const provider = fakeWallet({ eth_accounts: [ACCOUNT], eth_chainId: '0x1' });
        provider.install();
        const wallet = await freshWallet(provider);

        provider.emit('accountsChanged', [TO]);
        expect(wallet.account()).toBe(TO.toLowerCase());

        provider.emit('accountsChanged', []);
        expect(wallet.account()).toBe('');
    });

    it('follows a chain switched in another tab', async () =>
    {
        const provider = fakeWallet({ eth_accounts: [ACCOUNT], eth_chainId: '0x1' });
        provider.install();
        const wallet = await freshWallet(provider);

        provider.emit('chainChanged', '0x3fc');
        expect(wallet.chainId()).toBe(1020);
    });

    it('asks the wallet to switch chains with a hex chain id', async () =>
    {
        const provider = fakeWallet({
            eth_accounts: [ACCOUNT],
            eth_chainId: '0x1',
            wallet_switchEthereumChain: null
        });
        provider.install();
        const wallet = await freshWallet(provider);

        expect(await wallet.switchTo(1020)).toBe(true);
        const request = provider.calls.find((call) => call.method === 'wallet_switchEthereumChain');
        expect(request?.params).toEqual([{ chainId: '0x3fc' }]);
        expect(wallet.chainId()).toBe(1020);
    });

    it('answers false when the wallet refuses or does not have the chain', async () =>
    {
        const provider = fakeWallet({
            eth_accounts: [ACCOUNT],
            eth_chainId: '0x1',
            wallet_switchEthereumChain: () =>
            {
                throw Object.assign(new Error('Unrecognized chain'), { code: 4902 });
            }
        });
        provider.install();
        const wallet = await freshWallet(provider);

        expect(await wallet.switchTo(1020)).toBe(false);
        // The recorded chain must NOT move on a refusal, or the page claims to be somewhere it
        // is not and offers a Write button for the wrong network.
        expect(wallet.chainId()).toBe(1);
    });

    it('answers false rather than throwing when there is no wallet at all', async () =>
    {
        const wallet = await freshWallet();
        expect(await wallet.switchTo(1)).toBe(false);
    });

    it('sends a transaction from the connected account and answers its hash', async () =>
    {
        const provider = fakeWallet({
            eth_accounts: [ACCOUNT],
            eth_chainId: '0x3fc',
            eth_sendTransaction: '0xhash'
        });
        provider.install();
        const wallet = await freshWallet(provider);

        const hash = await wallet.send({ to: TO, data: '0xdeadbeef', value: '' });
        expect(hash).toBe('0xhash');

        const sent = provider.calls.find((call) => call.method === 'eth_sendTransaction');
        expect(sent?.params?.[0]).toMatchObject({ from: ACCOUNT.toLowerCase(), to: TO, data: '0xdeadbeef' });
    });

    it('omits `value` entirely for a call that sends nothing', async () =>
    {
        // A value field on a non-payable call is an invitation to send currency the contract will
        // refuse, reverting and charging for the privilege.
        const provider = fakeWallet({
            eth_accounts: [ACCOUNT],
            eth_chainId: '0x1',
            eth_sendTransaction: '0xhash'
        });
        provider.install();
        const wallet = await freshWallet(provider);

        for (const value of ['', '0'])
        {
            provider.calls.length = 0;
            await wallet.send({ to: TO, data: '0x', value });
            const sent = provider.calls.find((call) => call.method === 'eth_sendTransaction');
            expect(Object.keys(sent?.params?.[0] as object)).not.toContain('value');
        }
    });

    it('hands wei to the wallet as a HEX quantity, exactly', async () =>
    {
        const provider = fakeWallet({
            eth_accounts: [ACCOUNT],
            eth_chainId: '0x1',
            eth_sendTransaction: '0xhash'
        });
        provider.install();
        const wallet = await freshWallet(provider);

        await wallet.send({ to: TO, data: '0x', value: (10n ** 18n).toString() });
        const sent = provider.calls.find((call) => call.method === 'eth_sendTransaction');
        expect((sent?.params?.[0] as { value: string }).value).toBe(`0x${ (10n ** 18n).toString(16) }`);
    });

    it('carries a value no double could hold, without rounding it', async () =>
    {
        const provider = fakeWallet({
            eth_accounts: [ACCOUNT],
            eth_chainId: '0x1',
            eth_sendTransaction: '0xhash'
        });
        provider.install();
        const wallet = await freshWallet(provider);

        const huge = (2n ** 200n + 12345n).toString();
        await wallet.send({ to: TO, data: '0x', value: huge });
        const sent = provider.calls.find((call) => call.method === 'eth_sendTransaction');
        expect(BigInt((sent?.params?.[0] as { value: string }).value)).toBe(BigInt(huge));
    });

    it('refuses to send with no wallet and with no connected account', async () =>
    {
        const none = await freshWallet();
        await expect(none.send({ to: TO, data: '0x', value: '' })).rejects.toThrow('no wallet');

        const provider = fakeWallet({ eth_accounts: [], eth_chainId: '0x1', eth_sendTransaction: '0xhash' });
        provider.install();
        const disconnected = await freshWallet();
        await expect(disconnected.send({ to: TO, data: '0x', value: '' })).rejects.toThrow('not connected');
        // Nothing reached the provider.
        expect(provider.calls.map((call) => call.method)).not.toContain('eth_sendTransaction');
    });

    it('never asks the wallet for a key or a signature it could store', async () =>
    {
        // The explorer holds no key and never sees one. Anything in this list would mean it does.
        const provider = fakeWallet({
            eth_accounts: [ACCOUNT],
            eth_chainId: '0x1',
            eth_requestAccounts: [ACCOUNT],
            eth_sendTransaction: '0xhash',
            wallet_switchEthereumChain: null
        });
        provider.install();
        const wallet = await freshWallet(provider);

        await wallet.connect().catch(() => undefined);
        await wallet.switchTo(1);
        await wallet.send({ to: TO, data: '0x', value: '1' });

        const asked = new Set(provider.calls.map((call) => call.method));
        for (const forbidden of ['eth_sign', 'personal_sign', 'eth_signTypedData_v4', 'eth_signTransaction',
            'eth_sendRawTransaction', 'eth_private_key', 'wallet_getPermissions'])
        {
            expect(asked, `asked for ${ forbidden }`).not.toContain(forbidden);
        }
    });
});
