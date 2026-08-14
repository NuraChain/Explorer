import { createStore, createSignal, type Getter } from 'azerothjs';

// The reader's wallet, as far as this explorer is concerned: which account is connected, and
// which chain it is pointed at.
//
// EIP-1193 only - `window.ethereum`, the interface every injected wallet implements - so there is
// no wallet SDK here and no connector list to keep current. The same choice add-chain-button
// already made.
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

/** One transaction, as the wallet takes it. `value` is wei as a decimal string, '' for none. */
export interface WalletRequest
{
    to: string;
    data: string;
    value: string;
}

export interface WalletApi
{
    /** A wallet is installed. False during SSR and in a plain browser. */
    available: Getter<boolean>;

    /** The connected account, or '' when nothing is connected. */
    account: Getter<string>;

    /** The chain the wallet is on, or 0 while unknown. */
    chainId: Getter<number>;

    /** Asks the wallet to connect. Throws nothing - a refusal simply leaves `account` empty. */
    connect(): Promise<void>;

    /** Forgets the account HERE. A dapp cannot revoke its own permission; the wallet owns that. */
    disconnect(): void;

    /** Asks the wallet to switch networks. Returns false when it refuses or does not have it. */
    switchTo(chainId: number): Promise<boolean>;

    /** Sends a transaction, answering with its hash. Rejects if the wallet or its owner says no. */
    send(request: WalletRequest): Promise<string>;
}

function provider(): InjectedProvider | undefined
{
    return (globalThis as { ethereum?: InjectedProvider }).ethereum;
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

export const useWallet = createStore((): WalletApi =>
{
    const [account, setAccount] = createSignal('');
    const [chainId, setChainId] = createSignal(0);
    const [available, setAvailable] = createSignal(false);

    const read = async (): Promise<void> =>
    {
        const wallet = provider();
        if (wallet === undefined)
        {
            return;
        }
        setAvailable(true);
        // `eth_accounts` and NOT `eth_requestAccounts`: this runs on load, and a permission
        // prompt nobody asked for is what makes people close a page. It answers with the account
        // only if this origin was already approved, so a returning reader stays connected and a
        // first-time one is never interrupted.
        const [accounts, chain] = await Promise.all([
            wallet.request({ method: 'eth_accounts' }).catch(() => []),
            wallet.request({ method: 'eth_chainId' }).catch(() => '0x0')
        ]);
        setAccount(firstAccount(accounts));
        setChainId(toChainId(chain));
    };

    // Browser only: there is no wallet during SSR, and asking would make the render environment
    // decide what the page says about a reader's accounts.
    if (typeof document !== 'undefined')
    {
        void read();
        const wallet = provider();
        // A wallet switched in another tab, or an account revoked from inside the extension, has
        // to reach the page: the alternative is a Write button aimed at an account that is no
        // longer there.
        wallet?.on?.('accountsChanged', (accounts: never) => setAccount(firstAccount(accounts)));
        wallet?.on?.('chainChanged', (chain: never) => setChainId(toChainId(chain)));
    }

    return {
        available,
        account,
        chainId,

        connect: async () =>
        {
            const wallet = provider();
            if (wallet === undefined)
            {
                return;
            }
            const accounts = await wallet.request({ method: 'eth_requestAccounts' }).catch(() => []);
            setAccount(firstAccount(accounts));
            setChainId(toChainId(await wallet.request({ method: 'eth_chainId' }).catch(() => '0x0')));
        },

        disconnect: () => setAccount(''),

        switchTo: async (target) =>
        {
            const wallet = provider();
            if (wallet === undefined)
            {
                return false;
            }
            try
            {
                await wallet.request({
                    method: 'wallet_switchEthereumChain',
                    params: [{ chainId: `0x${ target.toString(16) }` }]
                });
                setChainId(target);
                return true;
            }
            catch
            {
                // 4902 is "I do not have this chain", 4001 is "the person said no". Neither is
                // this page's to solve: adding the chain is what the header's own button is for.
                return false;
            }
        },

        send: async (request) =>
        {
            const wallet = provider();
            if (wallet === undefined)
            {
                throw new Error('no wallet');
            }
            const from = account();
            if (from === '')
            {
                throw new Error('not connected');
            }
            const hash = await wallet.request({
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
