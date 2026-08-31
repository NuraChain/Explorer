import { NURA_RDNS } from './wallets.ts';

// Nura Wallet, in a browser it does not own.
//
// The other two wallets on the roster are extensions: they inject a provider into every page and
// announce it, and nothing in this file concerns them. Nura Wallet is a Tauri application, so the
// only page it can inject into is the one inside its OWN browser - a reader holding it in Chrome,
// Safari or the Android browser has the wallet installed and no way at all for the page to reach
// it. That is the gap this file closes, and the only reason it exists.
//
// The wallet's answer is an operating-system deep link, and this is the page's half of it - ported
// from the connector the wallet ships (`sdk/nura-connector.js` in its repository) and shaped to
// this codebase. What it announces is an ORDINARY EIP-6963 provider, so the roster gate, the
// picker and every component above them are untouched: to the wallet store this is simply another
// wallet that turned up. See stores/wallet.store.ts.
//
// The wire, as the wallet's own parser defines it (`src/core/deeplink.ts` there):
//
//     nurawallet://dapp?request=<base64url({ id, method, params, callback })>
//
// The wallet runs the request through the same prompts a page in its in-app browser gets, then
// answers by REOPENING the callback url with `#nura=<base64url({ id, result, error })>` on the
// end. That reply lands in a fresh tab, not in the one that asked - so the returning tab relays
// it over a BroadcastChannel (a written-then-removed localStorage key where there is none) and
// wipes the fragment, leaving the reader looking at the page as normal.
//
// Two things this transport cannot do, both of them consequences of having no live channel to the
// app. It cannot hear `accountsChanged` or `chainChanged` while the reader is elsewhere in the
// wallet - only a round trip tells it anything. And it cannot ask what network the wallet is on
// without opening the app to ask, which is why the chain id below starts UNKNOWN rather than
// assuming the chain this explorer indexes.

/** The channel a returning tab relays a reply on, under the name the wallet's own connector uses. */
const CHANNEL = 'nura-wallet-connector';

/** Alongside `nura.wallet` and `nura.locale`. */
const ACCOUNTS_KEY = 'nura.deeplink.accounts';
const CHAIN_KEY = 'nura.deeplink.chain';
const REPLY_PREFIX = 'nura.deeplink.reply/';

/**
 * How long a request waits for the app, and the wallet connector's own number.
 *
 * It is generous because what it is waiting for is a person: unlocking an application and reading
 * an approval sheet, not a network call. Nothing here can tell "the app is not installed" from
 * "they are still reading it", so an unanswered link can only ever time out.
 */
const TIMEOUT = 5 * 60 * 1000;

/** What comes back in the fragment. `result` and `error` are exclusive, as JSON-RPC has them. */
interface DeepLinkReply
{
    id: string;
    result?: unknown;
    error?: { code?: number; message?: string; data?: unknown };
}

/** A rejection carrying the code EIP-1193 callers switch on - 4001 is "the person said no". */
interface RpcError extends Error
{
    code: number;
    data?: unknown;
}

interface Pending
{
    method: string;
    params: unknown[];
    resolve: (value: unknown) => void;
    reject: (reason: RpcError) => void;
    timer: ReturnType<typeof setTimeout>;
}

function rpcError(shape: { code?: number; message?: string; data?: unknown }): RpcError
{
    const error = new Error(shape.message ?? 'Nura Wallet refused the request') as RpcError;
    error.code = shape.code ?? -32603;
    if (shape.data !== undefined)
    {
        error.data = shape.data;
    }
    return error;
}

// base64url and not base64: the payload rides in a url, where '+' and '/' do not survive.

function toBase64Url(value: string): string
{
    const bytes = new TextEncoder().encode(value);
    let raw = '';
    for (const byte of bytes)
    {
        raw += String.fromCodePoint(byte);
    }
    return btoa(raw).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

function fromBase64Url(value: string): string
{
    const padded = value.replaceAll('-', '+').replaceAll('_', '/');
    return new TextDecoder().decode(Uint8Array.from(atob(padded), (char) => char.codePointAt(0) ?? 0));
}

function newId(): string
{
    return `${ Date.now().toString(36) }-${ Math.random().toString(36).slice(2) }`;
}

function read(key: string): string | null
{
    try
    {
        return localStorage.getItem(key);
    }
    catch
    {
        return null;
    }
}

function write(key: string, value: string): void
{
    try
    {
        localStorage.setItem(key, value);
    }
    catch
    {
        // Blocked storage costs a returning reader the remembered grant and nothing else.
    }
}

function drop(key: string): void
{
    try
    {
        localStorage.removeItem(key);
    }
    catch
    {
        // As above.
    }
}

/** The accounts the wallet granted on a previous visit, so a return costs no round trip. */
function rememberedAccounts(): string[]
{
    const raw = read(ACCOUNTS_KEY);
    if (raw === null)
    {
        return [];
    }
    try
    {
        const parsed: unknown = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : [];
    }
    catch
    {
        return [];
    }
}

/** Once per document. A second provider under the same rdns is a race for the same picker row. */
let installed = false;

/**
 * Announces Nura Wallet over the deep link, where that is the only way to reach it.
 *
 * Silent and idempotent: each of the three conditions below is a reason the transport cannot
 * work, and announcing a wallet that cannot answer is worse than not offering it at all.
 */
export function installNuraDeepLink(): void
{
    if (installed || typeof window === 'undefined')
    {
        return;
    }

    // Inside the wallet's own browser the real provider is already there, injected in process and
    // able to push events. This one would only be a slower duplicate of it.
    if ('__nuraWallet' in window)
    {
        return;
    }

    // The wallet REFUSES a callback that is not https - it checks the protocol before it does
    // anything else - so from any other origin a request leaves and can never come back. That
    // includes the dev server, which is http://localhost: Nura Wallet is deliberately absent from
    // the picker there rather than present and inert.
    if (window.location.protocol !== 'https:')
    {
        return;
    }

    installed = true;

    let accounts = rememberedAccounts();

    // UNKNOWN until the wallet says otherwise, which only `wallet_switchEthereumChain` ever does.
    // Answering with the chain this explorer indexes would be a guess, and the one it gets wrong
    // is the dangerous one: the wallet signs on whatever network IT is on, so a page that assumed
    // agreement would show "ready" over a Write button aimed at another chain. Unknown instead
    // leaves the wallet control in its "switch network" state, which is a question the reader can
    // answer and the wallet then confirms.
    let chainId = read(CHAIN_KEY) ?? '0x0';

    const listeners = new Map<string, Array<(payload: unknown) => void>>();
    const pending = new Map<string, Pending>();

    const emit = (event: string, payload: unknown): void =>
    {
        for (const handler of listeners.get(event)?.slice() ?? [])
        {
            try
            {
                handler(payload);
            }
            catch
            {
                // A listener that throws is the store's business, not the transport's.
            }
        }
    };

    /** What an answered request teaches this side, which is the only way it learns anything. */
    const absorb = (method: string, params: unknown[], result: unknown): void =>
    {
        if (method === 'eth_requestAccounts' && Array.isArray(result) && result.length > 0)
        {
            accounts = result.filter((value): value is string => typeof value === 'string');
            write(ACCOUNTS_KEY, JSON.stringify(accounts));
            emit('connect', { chainId });
            emit('accountsChanged', accounts.slice());
            return;
        }

        // The wallet answers a switch it did not make with an error, so a result here means the
        // network is now this one - the single point at which the chain id stops being a guess.
        if (method === 'wallet_switchEthereumChain')
        {
            const target = params[0];
            if (typeof target === 'object' && target !== null && 'chainId' in target && typeof target.chainId === 'string')
            {
                chainId = target.chainId;
                write(CHAIN_KEY, chainId);
                emit('chainChanged', chainId);
            }
        }
    };

    const settle = (reply: DeepLinkReply): void =>
    {
        const entry = pending.get(reply.id);
        if (entry === undefined)
        {
            return;
        }
        pending.delete(reply.id);
        clearTimeout(entry.timer);

        if (reply.error !== undefined)
        {
            entry.reject(rpcError(reply.error));
            return;
        }

        absorb(entry.method, entry.params, reply.result);
        entry.resolve(reply.result);
    };

    const channel = 'BroadcastChannel' in window ? new BroadcastChannel(CHANNEL) : null;

    if (channel !== null)
    {
        channel.onmessage = (event: MessageEvent<DeepLinkReply>): void =>
        {
            if (typeof event.data?.id === 'string')
            {
                settle(event.data);
            }
        };
    }

    window.addEventListener('storage', (event: StorageEvent) =>
    {
        if (event.key === null || !event.key.startsWith(REPLY_PREFIX) || event.newValue === null)
        {
            return;
        }
        try
        {
            settle(JSON.parse(event.newValue) as DeepLinkReply);
        }
        catch
        {
            // Somebody else's key, under a name that looks like one of ours.
        }
    });

    // This tab IS the callback the wallet reopened. The reply belongs to the tab that asked, which
    // is normally another one - so relay it, settle it here too in case the browser reused this
    // tab, and take it out of the address bar so a reload cannot replay it.
    const carried = /[#&]nura=([\w-]+)/u.exec(window.location.hash);

    if (carried !== null)
    {
        try
        {
            const reply = JSON.parse(fromBase64Url(carried[1])) as DeepLinkReply;
            settle(reply);
            channel?.postMessage(reply);
            // Without BroadcastChannel: a key written and immediately removed fires `storage` in
            // every other tab of this origin and leaves nothing stored.
            write(REPLY_PREFIX + reply.id, JSON.stringify(reply));
            drop(REPLY_PREFIX + reply.id);
        }
        catch
        {
            // A fragment that is not one of ours, or one that arrived truncated.
        }

        try
        {
            history.replaceState(null, '', window.location.pathname + window.location.search);
        }
        catch
        {
            // The reply still reached whoever was waiting; only the tidy-up failed.
        }
    }

    const roundtrip = (method: string, params: unknown[]): Promise<unknown> =>
        new Promise<unknown>((resolve, reject) =>
        {
            const id = newId();

            pending.set(id, {
                method,
                params,
                resolve,
                reject,
                timer: setTimeout(() =>
                {
                    pending.delete(id);
                    reject(rpcError({ code: 4001, message: 'Nura Wallet did not answer' }));
                }, TIMEOUT)
            });

            // `origin + pathname`, not `href`: the reply is a FRAGMENT the wallet appends, and a
            // callback carrying this page's own hash would come back with two of them.
            const payload = {
                id,
                method,
                params,
                callback: window.location.origin + window.location.pathname
            };

            // Navigating is what hands the link to the operating system. The tab stays where it
            // is - a custom scheme the browser passes on does not unload the page - so the
            // promise above is still here when the answer comes back through the channel.
            window.location.href = `nurawallet://dapp?request=${ toBase64Url(JSON.stringify(payload)) }`;
        });

    const provider = {
        isNuraWallet: true,

        request: (args: { method: string; params?: unknown[] }): Promise<unknown> =>
        {
            const params = Array.isArray(args.params) ? args.params : [];

            // Three questions answered from here. Every one of them would otherwise open the
            // application to ask, and a page that opens a wallet to read a chain id is a page
            // nobody can use.
            switch (args.method)
            {
                case 'eth_chainId':
                    return Promise.resolve(chainId);

                case 'net_version':
                    return Promise.resolve(String(Number.parseInt(chainId, 16)));

                case 'eth_accounts':
                    return Promise.resolve(accounts.slice());

                default:
                    return roundtrip(args.method, params);
            }
        },

        on: (event: string, handler: (payload: unknown) => void): void =>
        {
            const held = listeners.get(event) ?? [];
            held.push(handler);
            listeners.set(event, held);
        },

        removeListener: (event: string, handler: (payload: unknown) => void): void =>
        {
            listeners.set(event, (listeners.get(event) ?? []).filter((entry) => entry !== handler));
        }
    };

    // One identity for the life of the document: EIP-6963 uses the uuid to tell one announced
    // provider from another, and a fresh one per announcement makes this look like several.
    const uuid = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : newId();

    const announce = (): void =>
    {
        window.dispatchEvent(new CustomEvent('eip6963:announceProvider', {
            detail: Object.freeze({
                info: Object.freeze({
                    uuid,
                    name: 'Nura Wallet',
                    // EIP-6963 wants a data uri here, and this explorer ships no wallet artwork of
                    // its own - see lib/wallets.ts. An empty string fails `usableIcon`, so the
                    // picker draws its neutral glyph rather than a mark this repository invented.
                    icon: '',
                    rdns: NURA_RDNS
                }),
                provider
            })
        }));
    };

    // Both halves of the handshake, exactly as an extension does it: unprompted for a page that
    // is already listening, and on request for one whose listener came later.
    window.addEventListener('eip6963:requestProvider', announce);
    announce();
}
