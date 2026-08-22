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
 * Nura Wallet's identity, matching the bundle identifier in its own repository
 * (`src-tauri/tauri.conf.json`).
 *
 * It does not announce anything yet: Nura Wallet is a Tauri application for Windows and Android
 * whose in-app browser injects no EIP-1193 provider, so no page can currently detect it. It is
 * listed all the same - a reader who has it should be told this explorer expects it, and told
 * where to get it if they do not. The moment the app announces itself under this rdns, the entry
 * below starts connecting with no other change here.
 */
export const NURA_RDNS = 'io.nurawallet';

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
