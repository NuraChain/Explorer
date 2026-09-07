import { createEffect } from 'azerothjs';

import { useLocale } from '../stores/locale.store.ts';

/**
 * Names the page in the browser tab and in whatever a shared link renders as. Every page read the
 * same `nura-explorer` before this, which makes a row of open tabs useless and a pasted link say
 * nothing about what it points at.
 *
 * Reactive on purpose: a title built from loaded data (a block height, an address) is empty on the
 * first render and correct a tick later, so it has to follow the resource rather than be set once.
 * The suffix is read inside the effect for the same reason - switching language has to rename the
 * tab, not leave the previous language's product name sitting above a translated page.
 */
export function useTitle(compose: () => string): void
{
    const locale = useLocale();

    createEffect(() =>
    {
        if (typeof document === 'undefined')
        {
            return;
        }
        const suffix = locale.t('brand.name');
        const name = compose().trim();
        document.title = name === '' ? suffix : `${ name } · ${ suffix }`;
    });
}
/**
 * The shell's own description tag, created on first use.
 *
 * index.html ships one, so this only builds a tag where the document arrived without it - a test
 * environment, or a shell somebody trimmed. Returning it either way keeps the caller free of the
 * null check.
 */
function descriptionTag(): Element
{
    const existing = document.querySelector('meta[name="description"]');
    if (existing !== null)
    {
        return existing;
    }
    const created = document.createElement('meta');
    created.setAttribute('name', 'description');
    document.head.append(created);
    return created;
}

/**
 * Names the page for a crawler and for whatever unfurls a shared link, by writing the shell's
 * `<meta name="description">` for as long as the page is mounted.
 *
 * It RESTORES the previous value on the way out, which `useTitle` has no reason to do: every page
 * sets a title, so the last one written is always the current page's. A description is set only by
 * the pages with prose worth describing, and one left behind would go on describing the home page
 * as the documentation for the rest of the visit.
 */
export function useDescription(compose: () => string): void
{
    createEffect(() =>
    {
        if (typeof document === 'undefined')
        {
            return;
        }
        const text = compose().trim();
        if (text === '')
        {
            return;
        }
        const tag = descriptionTag();
        const previous = tag.getAttribute('content');
        tag.setAttribute('content', text);
        return () =>
        {
            if (previous !== null)
            {
                tag.setAttribute('content', previous);
            }
        };
    });
}
