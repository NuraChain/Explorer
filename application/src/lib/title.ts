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
