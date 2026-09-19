// The head a crawler and a link preview actually read, declared by the page that owns it.
//
// This used to be two functions writing to `document` from an effect, each guarded with
// `typeof document === 'undefined'` - so neither ran during a server render. Every
// `render: 'server'` page therefore left this process carrying the shell's generic title and
// the shell's generic description, and the real ones appeared only once the bundle had run.
// That is the half a crawler never sees.
//
// `useHead` declares them instead. The values are serialized into the served document by the
// kit - which replaces the shell's own title, description and robots by KEY, so a document
// still carries exactly one of each - and on the client the same declaration is applied to the
// live head and rolled back when the page is left. A client-side navigation renames the tab,
// which the old effect did too; what is new is that a direct load does not have to.
//
// Getters, not values: on the client they stay live, so a title derived from a loader updates
// when the data lands and again when the reader switches language. On the server they resolve
// once, during the render, with the loader's data already in hand.
import { useHead } from 'azerothjs';
import type { HeadMeta } from 'azerothjs';

import type { Locale } from '../stores/locale.store.ts';
import { LOCALES, useLocale } from '../stores/locale.store.ts';

/**
 * BCP 47 territory subtags for `og:locale`, which insists on `language_TERRITORY` and ignores a
 * bare language. Facebook's parser is the strict one; the rest follow it. The territories match
 * `LOCALE_TAG`, so the card and the page's own number formatting name the same place.
 */
const TERRITORY: Record<Locale, string> = {
    en: 'en_US', fa: 'fa_IR', ar: 'ar_EG', es: 'es_ES', pt: 'pt_BR',
    hi: 'hi_IN', zh: 'zh_CN', ru: 'ru_RU', fr: 'fr_FR', tr: 'tr_TR'
};

/**
 * The picture a shared link renders as.
 *
 * The square app icon, and a `summary` card rather than `summary_large_image` to match it.
 * A large card is 1.91:1 and pillarboxes or crops anything else, and declaring one with no
 * wide image renders a grey box - which looks more broken than a plain card with a small
 * icon beside the text. A deployment that wants the large card commits a 1200x630 image and
 * changes these four lines together.
 */
const SOCIAL_IMAGE = { path: '/icon-512.png', width: 512, height: 512, card: 'summary' } as const;

/** Meta descriptions are truncated by every engine around here; the catalogue keeps them short. */
const DESCRIPTION_LIMIT = 200;

/** What one page declares about itself. */
export interface PageHead
{
    /**
     * Always a real title: a getter that can answer `''` writes an EMPTY `<title>`, which is
     * worse than the shell's. The brand name is appended here, not by the caller.
     */
    title: () => string;

    description: () => string;

    /** The canonical PATH (`/tx/0x...`), without an origin and without a query. */
    path: () => string;

    /** Only a page that wants something other than the site default states one. */
    robots?: string;

    /**
     * This explorer's own public origin, when the deployment named one (`EXPLORER_URL`).
     *
     * It arrives on the wire in `stats.chain.explorerUrl` and is empty by default, which is the
     * honest state for a deployment that has not been told its own address: the canonical is
     * emitted RELATIVE, which every engine resolves against the document, and the absolute-only
     * Open Graph url is omitted rather than guessed. It is not read from the request, because a
     * page that consults the visitor is one the kit refuses to cache - and three of these pages
     * are cached on purpose.
     */
    origin?: () => string;

    /** Structured data for this page, omitted entirely while there is nothing real to describe. */
    jsonLd?: () => Record<string, unknown>[];
}

/**
 * Declares one page's head: title, description, canonical, Open Graph, Twitter and JSON-LD.
 *
 * Open Graph and the Twitter card are BOTH emitted and they disagree about naming on purpose:
 * `og:` uses `property`, `twitter:` uses `name`, and a parser looking for one ignores the other.
 * Getting that backwards is the most common way a link preview silently renders blank.
 */
export function pageHead(head: PageHead): void
{
    const locale = useLocale();

    const origin = (): string => (head.origin?.() ?? '').replace(/\/+$/, '');
    const canonical = (): string => `${ origin() }${ head.path() }`;
    const absolute = (path: string): string | null => (origin() === '' ? null : `${ origin() }${ path }`);

    const title = (): string =>
    {
        const name = head.title().trim();
        const brand = locale.t('brand.name');

        return name === '' || name === brand ? brand : `${ name } · ${ brand }`;
    };

    const description = (): string =>
    {
        const text = head.description().trim();

        return text.length <= DESCRIPTION_LIMIT ? text : `${ text.slice(0, DESCRIPTION_LIMIT).trimEnd() }…`;
    };

    const meta: HeadMeta[] = [
        { name: 'description', content: description },
        /*
         * Stated, not omitted. A crawler reads an absent directive as `index, follow` already, so
         * this is not about the crawler - it is about an auditor reading the served markup being
         * able to tell "deliberately indexable" from "nobody thought about it". The kit replaces
         * the shell's line by key, so a document still carries exactly one.
         */
        { name: 'robots', content: head.robots ?? 'index, follow' },

        { property: 'og:type', content: 'website' },
        { property: 'og:title', content: title },
        { property: 'og:description', content: description },
        { property: 'og:site_name', content: () => locale.t('brand.name') },
        { property: 'og:locale', content: () => TERRITORY[locale.locale()] },

        { name: 'twitter:card', content: SOCIAL_IMAGE.card },
        { name: 'twitter:title', content: title },
        { name: 'twitter:description', content: description }
    ];

    /*
     * `og:locale:alternate` is honest here in a way `hreflang` would not be. It says "this same
     * document can also be read in these languages", which is exactly true - the language is
     * negotiated per request and the url does not change. `hreflang` says "the same content lives
     * at THIS other url", and under `routing: 'negotiate'` there is no other url to name.
     */
    for (const tag of LOCALES)
    {
        if (tag !== locale.locale())
        {
            meta.push({ property: 'og:locale:alternate', content: TERRITORY[tag] });
        }
    }

    /*
     * The absolute-only tags, emitted only where the deployment named its own origin. Open Graph
     * requires an absolute url and a relative one is simply dropped by every parser, so a guess
     * built from the request would be a wrong address in a shared card rather than a missing one.
     */
    const card = absolute(SOCIAL_IMAGE.path);

    if (card !== null)
    {
        meta.push(
            { property: 'og:url', content: canonical },
            { property: 'og:image', content: card },
            { property: 'og:image:alt', content: () => locale.t('brand.name') },
            // Laid out from these numbers BEFORE the image downloads, by Facebook, LinkedIn and
            // Slack: without them the first render of a shared link is a collapsed box.
            { property: 'og:image:width', content: String(SOCIAL_IMAGE.width) },
            { property: 'og:image:height', content: String(SOCIAL_IMAGE.height) },
            { name: 'twitter:image', content: card },
            // Twitter reads its own alt and ignores og:image:alt, so the same string is said twice.
            { name: 'twitter:image:alt', content: () => locale.t('brand.name') });
    }

    useHead({
        title,
        meta,
        links: [{ rel: 'canonical', href: canonical }],
        jsonLd: head.jsonLd ?? ((): Record<string, unknown>[] => [])
    });
}

/**
 * The publisher every schema points at, and the thing a search engine is being told about: this
 * explorer, for this chain.
 */
export const explorerSchema = (chain: string, origin: string): Record<string, unknown> => ({
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: `${ chain } explorer`,
    inLanguage: LOCALES,
    ...(origin === '' ? {} : { url: origin })
});

/**
 * Home > section > this record.
 *
 * Positions are 1-based; a 0 quietly invalidates the whole list. Emitted only where the origin
 * is known, because a breadcrumb naming a relative url is not a claim anything can follow.
 */
export function breadcrumbs(origin: string, trail: Array<{ name: string; path: string }>): Record<string, unknown>[]
{
    if (origin === '')
    {
        return [];
    }

    return [{
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: trail.map((step, index) => ({
            '@type': 'ListItem',
            position: index + 1,
            name: step.name,
            item: `${ origin }${ step.path }`
        }))
    }];
}
