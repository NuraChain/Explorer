// The wallets this explorer talks to, and deliberately no others.
//
// Discovery is EIP-6963 rather than `window.ethereum`, and that is not a modernisation - it is
// what makes a roster possible at all. The injected global carries no identity: two extensions
// installed side by side overwrite each other on it, and `isMetaMask` is set by half a dozen
// wallets that are not MetaMask. An announcement carries an `rdns`, so a wallet can be named.
//
// The roster is a GATE here, unlike the advisory lists most sites keep: a wallet that is not on
// it is not offered and cannot connect, because that is what this deployment asked for. The cost
// is real and worth writing down - someone whose only wallet is Rabby or OKX cannot use the write
// side of this explorer, and EIP-6963 exists precisely to end lists like this one. Widening it is
// one entry below.

/** The three, by the identity each announces itself under. */
export const METAMASK_RDNS = 'io.metamask';
export const TRUST_RDNS = 'com.trustwallet.app';

/**
 * Nura Wallet's identity, as the wallet itself announces it. NOT its Tauri bundle identifier,
 * which is `io.nurawallet` in `src-tauri/tauri.conf.json`: the two differ, and it is the
 * announcement that has to match or the roster below never sees the wallet at all.
 *
 * Nura Wallet is a Tauri application for Windows and Android, and it reaches a page by two
 * different routes. Inside its own in-app browser it injects an EIP-1193 provider and announces
 * it exactly as an extension does. Everywhere else - Chrome, Safari, the Android browser - it
 * cannot inject into a page it does not own, and the page announces the wallet on its behalf over
 * the `nurawallet://` deep link instead; see lib/nura-deeplink.ts. Both routes arrive at the
 * store as one ordinary announcement under this rdns, and nothing above here can tell them apart.
 */
export const NURA_RDNS = 'net.nurachain.wallet';

export interface WalletBrand
{
    /** EIP-6963 rdns - the identity a wallet announces itself under. */
    rdns: string;

    /**
     * What the picker prints. Taken from here and NOT from the announcement: the name is the one
     * thing in an announcement that a page renders as text, and it is written by the extension.
     */
    label: string;

    /** Where to get it, for a reader who does not have it. */
    install: string;
}

/** The roster, in the order the picker shows it. */
export const WALLET_BRANDS: WalletBrand[] = [
    {
        rdns: METAMASK_RDNS,
        label: 'MetaMask',
        install: 'https://metamask.io/download/'
    },
    {
        rdns: NURA_RDNS,
        label: 'Nura Wallet',
        install: 'https://github.com/NuraChain/Wallet/releases'
    },
    {
        rdns: TRUST_RDNS,
        label: 'Trust Wallet',
        install: 'https://trustwallet.com/browser-extension'
    }
];

export function brandFor(rdns: string): WalletBrand | undefined
{
    return WALLET_BRANDS.find((brand) => brand.rdns === rdns);
}

/**
 * Whether an announced icon is safe to put in an `<img src>`.
 *
 * EIP-6963 requires a data URI, and an extension is free to announce anything at all. An image
 * data URI cannot run script where an `http(s)` one would be a request to a third party made from
 * this page - so anything that is not one draws the neutral glyph instead.
 */
export function usableIcon(icon: string | undefined): string | null
{
    return typeof icon === 'string' && icon.startsWith('data:image/') ? icon : null;
}
