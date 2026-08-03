import { createEffect } from 'azerothjs';

const SUFFIX = 'NuraExplorer';

/**
 * Names the page in the browser tab and in whatever a shared link renders as. Every page read the
 * same `nura-explorer` before this, which makes a row of open tabs useless and a pasted link say
 * nothing about what it points at.
 *
 * Reactive on purpose: a title built from loaded data (a block height, an address) is empty on the
 * first render and correct a tick later, so it has to follow the resource rather than be set once.
 */
export function useTitle(compose: () => string): void
{
    createEffect(() =>
    {
        if (typeof document === 'undefined')
        {
            return;
        }
        const name = compose().trim();
        document.title = name === '' ? SUFFIX : `${ name } · ${ SUFFIX }`;
    });
}
