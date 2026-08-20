// The one file that crosses into the server half - and it crosses with TYPES only. The value
// import below is client-safe schemas; `typeof api` is erased at build, so no handler, store,
// or server dependency can reach the browser bundle. The client's runtime half is the served
// manifest: method + path per route, projected from the SAME declaration the server registered,
// fetched once at boot. '/api' matches the dev proxy and the production mount.

import { createClient, type Manifest } from '@azerothjs/http/api/shared';

import type { Api } from '../../server/src/app.ts';

export type {
    Account,
    Block,
    BlockFilter,
    BlockDetail,
    BlockPage,
    ChainInfo,
    ContractDetail,
    ContractFunction,
    SearchResult,
    Summary,
    Transaction,
    TransactionDetail,
    TransactionPage,
    TopAccount,
    TopAccounts,
    Transfer,
    TransferPage,
    TxStatusFilter
} from '../../server/src/schemas.ts';

/**
 * The manifest, or an empty one.
 *
 * This is a TOP-LEVEL await, so a throw here would take the whole module graph down and paint
 * nothing at all - a blank page for one failed request at boot. An empty manifest instead lets
 * every page render and fail at its own call, where each one already has a designed error state.
 *
 * During SSR there is no document: pages fetch in `mount { }`, which runs only in the browser,
 * so no call ever happens server-side.
 */
async function loadManifest(): Promise<Manifest>
{
    if (typeof document === 'undefined')
    {
        return {};
    }
    try
    {
        const response = await fetch('/api/_manifest');
        return response.ok ? await response.json() as Manifest : {};
    }
    catch
    {
        return {};
    }
}

export const client = createClient<Api>(await loadManifest(), { baseUrl: '/api' });
