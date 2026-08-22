import { createStore, createSignal, type Getter } from 'azerothjs';

import type { ChainInfo } from '../api.ts';
import { brandFor, usableIcon, WALLET_BRANDS } from '../lib/wallets.ts';

// The reader's wallet, as far as this explorer is concerned: which one they chose, which account
// is connected, and which chain it is pointed at.
//
// Discovery is EIP-6963, not `window.ethereum`. The injected global carries no identity - two
// extensions overwrite each other on it and several set `isMetaMask` without being MetaMask - so
// a page that reads it cannot say WHICH wallet answered. This deployment offers three wallets by
// name and no others, and naming them is only possible from an announcement. See ../lib/wallets.ts
// for the roster and for what it costs.
//
// Every call into a provider is in this file. That is the point of it: this is the only code on
// this side of the app that hands anything to somebody else's extension, and a mistake here is a
// transaction someone signs. Components ask for an OUTCOME - connect, switch, add this network,
// send this call - and never hold a provider of their own.
//
// What this deliberately cannot do: sign. `send` hands a transaction to the wallet and the wallet
// asks its owner; nothing in this file has a key, and the explorer's own node connection is never
// part of the path. An explorer that could move someone's money would be a different program.

/** The slice of EIP-1193 this needs. Injected wallets are ambient, so the type is declared here. */
interface InjectedProvider
{
    request(args: { method: string; params?: unknown[] }): Promise<unknown>;
    on?(event: string, handler: (payload: never) => void): void;
    removeListener?(event: string, handler: (payload: never) => void): void;
}

/** One announcement, as EIP-6963 shapes it. */
interface Eip6963Detail
{
    info: { uuid: string; name: string; icon: string; rdns: string };
    provider: InjectedProvider;
}

/** A roster wallet that is actually installed. The provider itself never leaves this file. */
export interface WalletOption
{
    rdns: string;
    label: string;

    /** The vector the wallet announced, or null - in which case the picker draws its own glyph. */
    icon: string | null;
}

/** One transaction, as the wallet takes it. `value` is wei as a decimal string, '' for none. */
export interface WalletRequest
{
    to: string;
    data: string;
    value: string;
}

/**
 * What came of asking a wallet to add a network.
 *
 * Four outcomes and not a boolean, because they are four different things to say to a reader:
 * a dismissal is not a failure, and a wallet that already holds this chain id under another
 * ticker is a situation the reader can go and fix.
 */
export type AddChainOutcome = 'added' | 'dismissed' | 'mismatch' | 'refused';

export interface WalletApi
{
    /** The roster wallets installed right now, in roster order. Empty during SSR. */
    options: Getter<WalletOption[]>;

    /** At least one wallet this explorer offers is installed. False during SSR. */
    available: Getter<boolean>;

    /** The connected account, or '' when nothing is connected. */
    account: Getter<string>;

    /** The chain the wallet is on, or 0 while unknown. */
    chainId: Getter<number>;

    /** The rdns of the connected wallet, or '' - what the UI ticks in the picker. */
    connectedTo: Getter<string>;

    /** Asks one wallet to connect. Throws nothing - a refusal simply leaves `account` empty. */
    connect(rdns: string): Promise<void>;

    /** Forgets the account HERE. A dapp cannot revoke its own permission; the wallet owns that. */
    disconnect(): void;

    /** Asks the connected wallet to switch networks. False when it refuses or lacks the chain. */
    switchTo(chainId: number): Promise<boolean>;

    /** Asks one wallet to store this network. Needs no connection - only a chosen wallet. */
    addChain(rdns: string, chain: ChainInfo): Promise<AddChainOutcome>;

    /** Sends a transaction, answering with its hash. Rejects if the wallet or its owner says no. */
    send(request: WalletRequest): Promise<string>;
}

/** Which wallet was used last, so a returning reader is not asked to choose again. */
const SESSION_KEY = 'nura.wallet';

function remembered(): string
{
    try
    {
        return localStorage.getItem(SESSION_KEY) ?? '';
    }
    catch
    {
        return '';
    }
}

function remember(rdns: string): void
{
    try
    {
        if (rdns === '')
        {
            localStorage.removeItem(SESSION_KEY);
        }
        else
        {
            localStorage.setItem(SESSION_KEY, rdns);
        }
    }
    catch
    {
        // The choice still holds for this page's life.
    }
}

/** A wallet's chain id arrives as a hex quantity; 0 means "it did not say". */
function toChainId(value: unknown): number
{
    const parsed = typeof value === 'string' ? Number.parseInt(value, 16) : Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

function firstAccount(value: unknown): string
{
    return Array.isArray(value) && typeof value[0] === 'string' ? value[0].toLowerCase() : '';
}

/** A rejected request carries a code; 4001 is "the person said no", which is not an error. */
function codeOf(error: unknown): number | null
{
    return typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'number'
        ? error.code
        : null;
}

export const useWallet = createStore((): WalletApi =>
{
    const [options, setOptions] = createSignal<WalletOption[]>([]);
    const [account, setAccount] = createSignal('');
    const [chainId, setChainId] = createSignal(0);
    const [connectedTo, setConnectedTo] = createSignal('');

    /** Every announced ROSTER wallet, by rdns. */
    const found = new Map<string, { provider: InjectedProvider; icon: string | null }>();

    /** The provider the page is bound to, with the listeners bound to it. */
    let active: InjectedProvider | null = null;
    let bound: Array<[event: string, handler: (payload: never) => void]> = [];

    const unbind = (): void =>
    {
        for (const [event, handler] of bound)
        {
            active?.removeListener?.(event, handler);
        }
        bound = [];
        active = null;
    };

    /**
     * Points the page at one wallet, moving the event listeners with it.
     *
     * Rebinding rather than listening to every announced provider at once: with two installed,
     * both would report their own account changes, and whichever fired last would win. The page
     * follows the wallet the reader chose and no other.
     */
    const bind = (provider: InjectedProvider): void =>
    {
        unbind();
        active = provider;
        // A wallet switched in another tab, or an account revoked from inside the extension, has
        // to reach the page: the alternative is a Write button aimed at an account that is no
        // longer there.
        bound = [
            ['accountsChanged', ((accounts: never): void => setAccount(firstAccount(accounts))) as (payload: never) => void],
            ['chainChanged', ((chain: never): void => setChainId(toChainId(chain))) as (payload: never) => void]
        ];
        for (const [event, handler] of bound)
        {
            provider.on?.(event, handler);
        }
    };

    /**
     * Takes up a wallet, by whichever question is appropriate.
     *
     * `eth_accounts` answers only for an origin already approved, so it restores a returning
     * reader without a prompt; `eth_requestAccounts` is the prompt, and is only ever reached from
     * `connect`, which a reader had to click to get to.
     */
    const adopt = async (rdns: string, method: 'eth_accounts' | 'eth_requestAccounts'): Promise<void> =>
    {
        const entry = found.get(rdns);
        if (entry === undefined)
        {
            return;
        }
        const accounts = await entry.provider.request({ method }).catch(() => []);
        const next = firstAccount(accounts);
        if (next === '')
        {
            return;
        }
        bind(entry.provider);
        setAccount(next);
        setChainId(toChainId(await entry.provider.request({ method: 'eth_chainId' }).catch(() => '0x0')));
        setConnectedTo(rdns);
        remember(rdns);
    };

    // Browser only: there is no wallet during SSR, and asking would make the render environment
    // decide what the page says about a reader's accounts.
    if (typeof window !== 'undefined')
    {
        const restoring = remembered();

        window.addEventListener('eip6963:announceProvider', (event: Event) =>
        {
            const detail = (event as CustomEvent<Eip6963Detail>).detail;
            const brand = brandFor(detail?.info?.rdns ?? '');
            // The gate, in one place. An announcement from a wallet this deployment does not
            // offer is dropped here and nowhere else, so widening the roster is one entry in
            // ../lib/wallets.ts and no change at all in this file.
            if (brand === undefined || found.has(brand.rdns))
            {
                return;
            }
            found.set(brand.rdns, { provider: detail.provider, icon: usableIcon(detail.info.icon) });
            // Roster order and not announcement order: which extension answers first is a race,
            // and a list whose rows move between two visits is a list nobody can aim at.
            setOptions(WALLET_BRANDS
                .filter((entry) => found.has(entry.rdns))
                .map((entry) => ({ rdns: entry.rdns, label: entry.label, icon: found.get(entry.rdns)?.icon ?? null })));

            if (brand.rdns === restoring && account() === '')
            {
                void adopt(brand.rdns, 'eth_accounts');
            }
        });

        // Wallets announce unprompted at load AND on request. The request is what catches the
        // ones that finished injecting before this listener existed - without it, whether a
        // wallet is found depends on which script the browser ran first.
        window.dispatchEvent(new Event('eip6963:requestProvider'));
    }

    return {
        options,
        available: () => options().length > 0,
        account,
        chainId,
        connectedTo,

        connect: async (rdns) => adopt(rdns, 'eth_requestAccounts'),

        disconnect: () =>
        {
            unbind();
            setAccount('');
            setChainId(0);
            setConnectedTo('');
            remember('');
        },

        switchTo: async (target) =>
        {
            if (active === null)
            {
                return false;
            }
            try
            {
                await active.request({
                    method: 'wallet_switchEthereumChain',
                    params: [{ chainId: `0x${ target.toString(16) }` }]
                });
                setChainId(target);
                return true;
            }
            catch
            {
                // 4902 is "I do not have this chain", 4001 is "the person said no". Neither is
                // this call's to solve: adding the chain is what `addChain` is for.
                return false;
            }
        },

        addChain: async (rdns, chain) =>
        {
            const entry = found.get(rdns);
            if (entry === undefined)
            {
                return 'refused';
            }
            try
            {
                await entry.provider.request({
                    method: 'wallet_addEthereumChain',
                    params: [{
                        // Wallets take the id as a HEX quantity, not a decimal number.
                        chainId: `0x${ chain.chainId.toString(16) }`,
                        // The CONFIGURED name, never the localized one. This is the identity the
                        // wallet stores and shows for the rest of its life, and a Persian reader
                        // who adds the chain must still end up with the same network everyone
                        // else has.
                        chainName: chain.name,
                        nativeCurrency: {
                            name: chain.symbol,
                            symbol: chain.symbol,
                            decimals: chain.decimals
                        },
                        rpcUrls: [chain.rpcUrl],
                        // This explorer, offered as the chain's explorer: a wallet that knows it
                        // can link straight from a transaction someone just signed to the page
                        // for it. The deployment's PUBLIC url wins over the current origin - the
                        // wallet stores this permanently, and a localhost or preview host saved
                        // there is a dead link the reader can never fix from inside the wallet.
                        blockExplorerUrls: [chain.explorerUrl === '' ? window.location.origin : chain.explorerUrl]
                    }]
                });
                return 'added';
            }
            catch (error)
            {
                const code = codeOf(error);
                if (code === 4001)
                {
                    return 'dismissed';
                }
                // -32602 here is almost always one thing: the wallet already holds this chain id
                // under a different ticker and refuses to re-add it. That is a fixable situation
                // the reader can act on, so it must not read as the generic "your wallet said no".
                return code === -32602 ? 'mismatch' : 'refused';
            }
        },

        send: async (request) =>
        {
            if (active === null)
            {
                throw new Error('no wallet');
            }
            const from = account();
            if (from === '')
            {
                throw new Error('not connected');
            }
            const hash = await active.request({
                method: 'eth_sendTransaction',
                params: [{
                    from,
                    to: request.to,
                    data: request.data,
                    // Wallets take wei as a hex quantity. Omitted entirely when nothing is being
                    // sent, so a non-payable call carries no value field at all.
                    ...(request.value === '' || request.value === '0'
                        ? {}
                        : { value: `0x${ BigInt(request.value).toString(16) }` })
                }]
            });
            return String(hash);
        }
    };
});
