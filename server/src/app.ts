import { App, json, NotFoundError, type RequestObserver } from '@azerothjs/http';
import { feature, manifestOf, register } from '@azerothjs/http/api';
import { mountPages, type KitOptions } from '@azerothjs/kit';

import type { ChainGateway } from './chain/client.ts';
import { normalize, type IndexStore } from './chain/store.ts';
import { createEtherscanApi } from './etherscan.ts';
import { classify, iso, meanBlockTime, pageCount, presentBlock, presentTransaction, presentTransfer } from './present.ts';
import {
    account,
    blockDetail,
    blockPage,
    pageQuery,
    searchQuery,
    searchResult,
    summary,
    transactionDetail,
    transactionPage,
    transferPage,
    type Transfer
} from './schemas.ts';

// The whole API, declared once: routes, schemas and handlers colocated. Every route name is
// written exactly once - it keys this object, the manifest, the browser's `client.blocks.list`,
// and the OpenAPI operation.
//
// Reads come from the INDEX, because Ethereum JSON-RPC cannot answer "every transaction touching
// this address". Balances are the exception and come from the NODE: a stale balance is a wrong
// answer, and it is one cheap call.

export interface ApiDeps
{
    store: IndexStore;
    chain: ChainGateway;
}

const DEFAULT_LIMIT = 25;

export function createApi(deps: ApiDeps): ReturnType<typeof build>
{
    return build(deps);
}

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- the route literal IS the type; naming it would erase per-route inference
function build({ store, chain }: ApiDeps)
{
    /** Attaches the token metadata each transfer row needs, reading each token at most once. */
    const withTokens = (rows: ReturnType<IndexStore['transfersOfAddress']>['rows']): Transfer[] =>
    {
        const cache = new Map<string, ReturnType<IndexStore['token']>>();
        return rows.map((row) =>
        {
            if (!cache.has(row.token))
            {
                cache.set(row.token, store.token(row.token));
            }
            return presentTransfer(row, cache.get(row.token) ?? null);
        });
    };

    const paging = (query: { page?: number; limit?: number }): { limit: number; offset: number; page: number } =>
    {
        const limit = query.limit ?? DEFAULT_LIMIT;
        const page = query.page ?? 1;
        return { limit, offset: (page - 1) * limit, page };
    };

    return {
        stats: feature('/stats', (routes) => ({
            summary: routes.get('/', { output: summary }, async () =>
            {
                const indexed = store.stats();
                // The node's head, not the index's: a reader must be able to see that a
                // backfill is still running rather than believe the chain stopped.
                const chainHead = await chain.head().catch(() => indexed.head);
                const recent = store.recentBlocks(20);
                return {
                    chain: {
                        chainId: chain.env.chainId,
                        name: chain.env.name,
                        symbol: chain.env.symbol,
                        decimals: chain.env.decimals,
                        rpcUrl: chain.env.rpcUrl,
                        siteUrl: chain.env.siteUrl
                    },
                    head: indexed.head,
                    headTime: iso(indexed.headTime),
                    chainHead,
                    indexed: {
                        blocks: indexed.blocks,
                        transactions: indexed.transactions,
                        transfers: indexed.transfers
                    },
                    blockTime: meanBlockTime(recent),
                    gasPrice: recent[0]?.base_fee ?? '0'
                };
            }),

            /** The cadence strip's data: the most recent blocks, oldest-first for drawing. */
            cadence: routes.get('/cadence', { output: blockPage }, () =>
            {
                const rows = store.recentBlocks(60);
                return {
                    rows: rows.map(presentBlock).reverse(),
                    total: rows.length,
                    page: 1,
                    pages: 1
                };
            })
        })),

        blocks: feature('/blocks', (routes) => ({
            list: routes.get('/', { query: pageQuery, output: blockPage }, ({ query }) =>
            {
                const { limit, offset, page } = paging(query);
                const { rows, total } = store.blocksPage(limit, offset);
                return { rows: rows.map(presentBlock), total, page, pages: pageCount(total, limit) };
            }),

            one: routes.get('/:number', { query: pageQuery, output: blockDetail }, ({ params, query }) =>
            {
                const found = store.blockByNumber(Number(params.number));
                if (found === null)
                {
                    throw new NotFoundError(`No block ${ params.number } in the index.`);
                }
                const { limit, offset, page } = paging(query);
                const { rows, total } = store.transactionsOfBlock(found.number, limit, offset);
                return {
                    block: presentBlock(found),
                    transactions: rows.map(presentTransaction),
                    total,
                    page,
                    pages: pageCount(total, limit)
                };
            })
        })),

        txs: feature('/txs', (routes) => ({
            list: routes.get('/', { query: pageQuery, output: transactionPage }, ({ query }) =>
            {
                const { limit, offset, page } = paging(query);
                const { rows, total } = store.transactionsPage(limit, offset);
                return { rows: rows.map(presentTransaction), total, page, pages: pageCount(total, limit) };
            }),

            one: routes.get('/:hash', { output: transactionDetail }, ({ params }) =>
            {
                const found = store.transactionByHash(params.hash);
                if (found === null)
                {
                    throw new NotFoundError('No such transaction in the index.');
                }
                return {
                    transaction: presentTransaction(found),
                    transfers: withTokens(store.transfersOfTransaction(found.hash))
                };
            })
        })),

        address: feature('/address', (routes) => ({
            summary: routes.get('/:address', { output: account }, async ({ params }) =>
            {
                const address = normalize(params.address);
                const [balance, isContract] = await Promise.all([
                    chain.balance(address).then(value => value.toString()).catch(() => '0'),
                    chain.isContract(address).catch(() => false)
                ]);
                const token = store.token(address);
                return {
                    address,
                    balance,
                    isContract,
                    txCount: store.transactionsOfAddress(address, 1, 0).total,
                    transferCount: store.transfersOfAddress(address, 1, 0).total,
                    flow: store.flowOfAddress(address),
                    token: token === null
                        ? null
                        : { name: token.name, symbol: token.symbol, decimals: token.decimals }
                };
            }),

            transactions: routes.get('/:address/txs', { query: pageQuery, output: transactionPage }, ({ params, query }) =>
            {
                const { limit, offset, page } = paging(query);
                const { rows, total } = store.transactionsOfAddress(params.address, limit, offset);
                return { rows: rows.map(presentTransaction), total, page, pages: pageCount(total, limit) };
            }),

            transfers: routes.get('/:address/transfers', { query: pageQuery, output: transferPage }, ({ params, query }) =>
            {
                const { limit, offset, page } = paging(query);
                const { rows, total } = store.transfersOfAddress(params.address, limit, offset);
                return { rows: withTokens(rows), total, page, pages: pageCount(total, limit) };
            })
        })),

        search: feature('/search', (routes) => ({
            resolve: routes.get('/', { query: searchQuery, output: searchResult }, ({ query }) =>
            {
                // Shape narrows the candidates; the index decides. A 32-byte hash is a
                // transaction OR a block, and only a lookup can say which - guessing would
                // send half of all hash searches to a 404.
                const term = query.q.trim();
                const kind = classify(term);

                if (kind === 'address')
                {
                    return { kind: 'address' as const, path: `/address/${ normalize(term) }` };
                }
                if (kind === 'height')
                {
                    const found = store.blockByNumber(Number(term));
                    return found === null
                        ? { kind: 'none' as const, path: null }
                        : { kind: 'block' as const, path: `/block/${ found.number }` };
                }
                if (kind === 'hash')
                {
                    if (store.transactionByHash(term) !== null)
                    {
                        return { kind: 'transaction' as const, path: `/tx/${ term.toLowerCase() }` };
                    }
                    const asBlock = store.blockByHash(term);
                    return asBlock === null
                        ? { kind: 'none' as const, path: null }
                        : { kind: 'block' as const, path: `/block/${ asBlock.number }` };
                }
                return { kind: 'none' as const, path: null };
            })
        }))
    };
}

export type Api = ReturnType<typeof createApi>;

export interface AppOptions extends ApiDeps
{
    dev: boolean;
    observe?: RequestObserver;

    /** The built client + SSR renderer (production); omit in dev - vite serves the client. */
    pages?: KitOptions;
}

export function buildApp(options: AppOptions): App
{
    const app = new App({ dev: options.dev, observe: options.observe });
    const api = createApi(options);

    app.get('/api/healthz', () => json({
        ok: true,
        at: new Date().toISOString(),
        head: options.store.stats().head
    }));

    register(app, api);

    // The typed client's runtime half: method + path per route, projected from the SAME
    // declaration register just installed. The browser fetches it once at boot.
    app.get('/api/_manifest', () => json(manifestOf(api)));

    // The Etherscan-compatible surface, for wallets. It answers on `/api` and `/v2/api` EXACTLY -
    // no subpath - so it cannot shadow `/api/blocks` and friends above, and a client configured
    // with either base url reaches the same dispatcher.
    const etherscan = createEtherscanApi(options);
    const compatible = (context: { url: URL }): Promise<Response> => etherscan(context.url.searchParams);
    app.get('/api', compatible);
    app.get('/v2/api', compatible);

    // Mounted LAST so nothing shadows /api.
    if (options.pages !== undefined)
    {
        mountPages(app, options.pages);
    }

    return app;
}
