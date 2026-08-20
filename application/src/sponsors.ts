// The advertising this deployment has sold, and what runs in it.
//
// EMPTY by default. An explorer ships with no advertising; a deployment that wants some fills this
// table. A placement with no entry renders nothing at all - not an empty box, not a house promo -
// so an unsold slot costs the page no height and no request.
//
// Self-served on purpose. This app makes no third-party request of any kind: even the Persian face
// is served from its own origin. A network's tag would change that for every visitor on every
// page, and buy a privacy surface and a CSP exception along with it. A creative under `public/`
// and a link is the same advertisement, without any of that.

/** Where a creative runs. Both slots live in the shell, so no page knows either one exists. */
export type Placement = 'leaderboard' | 'closing';

/**
 * One advertisement at the two widths the slot is drawn at.
 *
 * A pair rather than a single image because the slot is about 976px wide on a desktop and about
 * 358px on a phone. A 970x90 sent to a phone is scaled down to a third of the height reserved for
 * it, and reads as a slot nobody bought.
 */
export interface Creative
{
    /** For the desktop and tablet slot: 970x90 or 728x90. */
    wide: string;

    /** For a phone, below the `sm` breakpoint: 320x100. Without one, `wide` is letterboxed. */
    narrow?: string;
}

export interface Sponsor
{
    placement: Placement;

    /** Paths under `public/`, served from this app's own origin. */
    creative: Creative;

    /**
     * The same pair for the LIGHT theme.
     *
     * Optional, and only needed when one set of artwork cannot serve both grounds - the two
     * themes here are complete scales rather than tints of each other, so a creative built for
     * near-black often does not survive the move to white. Artwork on a transparent ground
     * usually reads on either, and needs nothing here.
     */
    creativeLight?: Creative;

    href: string;

    /**
     * What a screen reader is told.
     *
     * The advertiser's own words, which is why this is NOT in the message catalog: translating
     * somebody's product name would misname it, the same way translating a token symbol would.
     * Name the advertiser and the offer - never "banner" or "advertisement", which the slot's own
     * label already says out loud.
     */
    alt: string;
}

/**
 * The sold slots. Add an entry to sell one; remove it to stop.
 *
 * @example
 * export const SPONSORS: Sponsor[] = [
 *     {
 *         placement: 'leaderboard',
 *         creative: { wide: '/sponsors/acme-970x90.png', narrow: '/sponsors/acme-320x100.png' },
 *         href: 'https://acme.example',
 *         alt: 'Acme Wallet - hold NURA on your phone'
 *     }
 * ];
 */
export const SPONSORS: Sponsor[] = [];

/**
 * What runs in a placement, or nothing.
 *
 * The FIRST match, deliberately, and never a random one: this renders on the server and again in
 * the browser, and a slot that chose differently each time would hydrate onto a different
 * advertisement than the one the page was rendered with.
 */
export function sponsorFor(placement: Placement): Sponsor | undefined
{
    return SPONSORS.find((sponsor) => sponsor.placement === placement);
}
