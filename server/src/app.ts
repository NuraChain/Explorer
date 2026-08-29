import { App, json, NotFoundError, type RequestObserver } from '@azerothjs/http';
import { feature, manifestOf, register } from '@azerothjs/http/api';
import { mountPages, type KitOptions } from '@azerothjs/kit';

import type { ChainGateway } from './chain/client.ts';
import {
    countVotes,
    GOV_PRECOMPILE,
    readParams,
    readProposal,
    readProposals,
    readTally,
    readVotes,
    type GovParams,
    type GovProposal
} from './chain/gov.ts';
import { selectorOf } from './chain/signatures.ts';
import { normalize, type DailyStats, type IndexStore } from './chain/store.ts';
import { createEtherscanApi } from './etherscan.ts';
import { calldataFor, inspectContract, readContract } from './inspect.ts';
import {
    classify,
    iso,
    meanBlockTime,
    pageCount,
    presentBlock,
    presentProposal,
    presentTransaction,
    presentTransfer,
    presentVotes,
    proposalGroup
} from './present.ts';
import { noPrice, type PriceSource } from './price.ts';
import {
    account,
    accountListQuery,
    addressListQuery,
    blockDetail,
    blockListQuery,
    blockPage,
    chartsQuery,
    chartsSummary,
    contractCalldata,
    contractCallInput,
    contractCallResult,
    contractDetail,
    governanceOverview,
    nativePrice,
    pageQuery,
    proposalDetail,
    proposalListQuery,
    proposalPage,
    searchQuery,
    searchResult,
    summary,
    transactionDetail,
    transactionListQuery,
    transactionPage,
    topAccounts,
    transferPage,
    type ChartSeries,
    type ChartsSummary,
    type StatFigure,
    type TopAccount,
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

    /**
     * Where a USD price for the native coin comes from. Optional because it is the one dependency
     * that is not this chain: a deployment with no exchange behind it quotes nothing, and every
     * page still renders.
     */
    price?: PriceSource;
}

const DEFAULT_LIMIT = 25;

/** How long a governance answer is held. Proposals move on the scale of days, not of requests. */
const GOVERNANCE_TTL_MS = 5_000;

/**
 * The five transactions the governance page can offer, hashed once at import.
 *
 * They are sent to the gov PRECOMPILE, not to a contract anybody deployed - see chain/gov.ts.
 * Encoded by this server from its own signature table and signed by the reader's wallet, which is
 * the same split every write in this explorer makes.
 */
const GOV_CALLS = {
    vote: selectorOf('vote(address,uint64,uint8,string)'),
    voteWeighted: selectorOf('voteWeighted(address,uint64,(uint8,string)[],string)'),
    submitProposal: selectorOf('submitProposal(address,bytes,(string,uint256)[])'),
    deposit: selectorOf('deposit(address,uint64,(string,uint256)[])'),
    cancelProposal: selectorOf('cancelProposal(address,uint64)')
};

/** How far the charts look back when nobody says. A month reads as a trend; a week reads as noise. */
const DEFAULT_CHART_DAYS = 30;

/** Seconds in a day, and the window every headline figure is measured over. */
const DAY_SECONDS = 86_400;

/**
 * A headline figure and how it moved, as a RATIO of the earlier window.
 *
 * Null rather than zero when there is nothing to compare against. A chain three hours old has no
 * previous day, and printing +0% there claims a measurement nobody took.
 */
function figure(value: bigint | number | string, before?: bigint | number | string): StatFigure
{
    const now = BigInt(typeof value === 'number' ? Math.round(value) : value);
    if (before === undefined)
    {
        return { value: now.toString(), change: null };
    }
    const past = BigInt(typeof before === 'number' ? Math.round(before) : before);
    return {
        value: now.toString(),
        // Through Number only AFTER the division has been reduced to a ratio: the inputs can be
        // wei, and the answer is a percentage that never needed more than a few digits.
        change: past === 0n ? null : Number(now - past) / Number(past)
    };
}

export function createApi(deps: ApiDeps): ReturnType<typeof build>
{
    return build(deps);
}

// No return type on purpose: the route literal IS the type, and naming it would erase the
// per-route inference every `client.blocks.list` call downstream depends on.
// oxlint-disable-next-line typescript/explicit-function-return-type
function build({ store, chain, price }: ApiDeps)
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

    let governanceCache: { at: number; params: GovParams | null; proposals: GovProposal[] } | null = null;

    const paging = (query: { page?: number; limit?: number }): { limit: number; offset: number; page: number } =>
    {
        const limit = query.limit ?? DEFAULT_LIMIT;
        const page = query.page ?? 1;
        return { limit, offset: (page - 1) * limit, page };
    };

    /**
     * The module's parameters and its proposals, held for a few seconds.
     *
     * Governance is the one section of this explorer that is NOT read from the index: a chain has
     * tens of proposals where it has millions of transactions, and every figure on the page is a
     * live answer from the module. The cache exists so that a reader loading the list does not
     * ask the node the same four questions per row.
     *
     * `params` is null exactly when the gov precompile is not enabled on this chain - it is the
     * cheapest question to ask, and the answer decides whether the section exists at all.
     */
    const readGovernance = async (): Promise<{ params: GovParams | null; proposals: GovProposal[] }> =>
    {
        const now = Date.now();
        if (governanceCache !== null && now - governanceCache.at < GOVERNANCE_TTL_MS)
        {
            return governanceCache;
        }
        const params = await readParams(chain);
        // Newest first, and all of them: a chain that has passed a thousand proposals is still one
        // page of json, and paging here would cost a call per page of a list that is filtered by a
        // state the module does not index on.
        const proposals = params === null ? [] : await readProposals(chain, 200, 0) ?? [];
        governanceCache = { at: now, params, proposals };
        return governanceCache;
    };

    // Resolved once rather than per request: `noPrice` is what a deployment with no exchange
    // configured answers with, and it must be the same object every time so the route below has
    // no branch in it.
    const quotes = price ?? noPrice(chain.env.symbol);

    // The rich list. Balances are live, and reading the node for every address on every request
    // would turn one page view into a balance storm, so the ranked list is cached for a few
    // seconds. The cache keeps every NON-zero balance; the route slices to the requested limit.
    let rankedAccounts: { at: number; rows: TopAccount[] } | null = null;
    const RANKED_TTL_MS = 10_000;

    // The charts, per window length. Short enough that a reader refreshing sees the day move, long
    // enough that a page with thirteen series on it is one scan of the index rather than thirteen.
    const chartsCache = new Map<number, { at: number; payload: ChartsSummary }>();
    const CHARTS_TTL_MS = 30_000;

    /** A day index back into the instant it started, which is what a chart point is labelled by. */
    const dayStart = (day: number): string => new Date(day * DAY_SECONDS * 1000).toISOString();

    /** One series, projected out of the daily rows. Percent crosses as basis points of 1. */
    const seriesOf = (rows: DailyStats[], key: ChartSeries['key'], unit: ChartSeries['unit'],
        read: (row: DailyStats) => bigint | number | string): ChartSeries => ({
        key,
        unit,
        points: rows.map((row) =>
        {
            const value = read(row);
            return {
                at: dayStart(row.day),
                // Rounded, never truncated to an integer type: a mean block time of 2.98 seconds
                // is the reading, and floor()ing it to 2 would flatten the one series whose whole
                // point is that it moves by fractions.
                value: typeof value === 'number' ? String(Math.round(value * 1000) / 1000) : value.toString()
            };
        })
    });

    /** The whole payload for one window length, computed from the index. */
    const summarize = (days: number, nowSeconds: number): ChartsSummary =>
    {
        const total = store.totals();
        const dayWindow = store.statsWindow(nowSeconds - DAY_SECONDS, nowSeconds);
        const before = store.statsWindow(nowSeconds - 2 * DAY_SECONDS, nowSeconds - DAY_SECONDS);
        const rows = store.statsDaily(nowSeconds - days * DAY_SECONDS, nowSeconds);

        const share = (whole: number, added: number): StatFigure =>
            ({ value: String(whole), change: whole === 0 ? null : added / whole });

        return {
            days,
            // A total's movement is what the last day ADDED to it, which is the reading a total
            // wants: "and this much of it arrived yesterday".
            total: {
                blocks: share(total.blocks, dayWindow.blocks),
                transactions: share(total.transactions, dayWindow.transactions),
                transfers: share(total.transfers, dayWindow.transfers),
                addresses: share(total.addresses, dayWindow.newAddresses),
                tokens: { value: String(total.tokens), change: null },
                contracts: share(total.contracts, dayWindow.contracts)
            },
            day: {
                blocks: figure(dayWindow.blocks, before.blocks),
                transactions: figure(dayWindow.transactions, before.transactions),
                transfers: figure(dayWindow.transfers, before.transfers),
                activeAddresses: figure(dayWindow.activeAddresses, before.activeAddresses),
                newAddresses: figure(dayWindow.newAddresses, before.newAddresses),
                contracts: figure(dayWindow.contracts, before.contracts),
                fees: figure(dayWindow.fees, before.fees),
                averageFee: figure(dayWindow.averageFee, before.averageFee),
                gasUsed: figure(dayWindow.gasUsed, before.gasUsed),
                // Basis points of one, so a share crosses as an integer like everything else and
                // the client divides once. 37.5% is 3750.
                utilization: figure(
                    dayWindow.gasLimit === 0 ? 0 : (dayWindow.gasUsed / dayWindow.gasLimit) * 10_000,
                    before.gasLimit === 0 ? undefined : (before.gasUsed / before.gasLimit) * 10_000),
                // Milliseconds, for the same reason: seconds would round a 2.98s cadence to 3.
                blockTime: figure(dayWindow.blockTime * 1000, before.blocks > 1 ? before.blockTime * 1000 : undefined)
            },
            series: [
                seriesOf(rows, 'transactions', 'count', (row) => row.transactions),
                seriesOf(rows, 'blocks', 'count', (row) => row.blocks),
                seriesOf(rows, 'activeAddresses', 'count', (row) => row.activeAddresses),
                seriesOf(rows, 'newAddresses', 'count', (row) => row.newAddresses),
                seriesOf(rows, 'blockTime', 'seconds', (row) => row.blockTime),
                seriesOf(rows, 'blockSize', 'bytes', (row) => row.blockSize),
                seriesOf(rows, 'gasPrice', 'gwei', (row) => row.gasPrice),
                seriesOf(rows, 'gasUsed', 'gas', (row) => row.gasUsed),
                seriesOf(rows, 'utilization', 'percent', (row) => (row.gasLimit === 0 ? 0 : (row.gasUsed / row.gasLimit) * 100)),
                seriesOf(rows, 'fees', 'native', (row) => row.fees),
                seriesOf(rows, 'averageFee', 'native', (row) =>
                    (row.transactions === 0 ? '0' : (BigInt(row.fees) / BigInt(row.transactions)).toString())),
                seriesOf(rows, 'transfers', 'count', (row) => row.transfers),
                seriesOf(rows, 'contracts', 'count', (row) => row.contracts)
            ]
        };
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
                        siteUrl: chain.env.siteUrl,
                        explorerUrl: chain.env.explorerUrl
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

            /**
             * What one coin is worth, in dollars.
             *
             * Proxied rather than fetched from the browser: the figure comes from another origin,
             * and a page that reads it directly is one CORS header away from showing nothing, once
             * per visitor per tick. Here it is one request every half minute no matter how many
             * people are watching - and the wire shape stays this server's to declare, like every
             * other field on it.
             */
            price: routes.get('/price', { output: nativePrice }, () => quotes.read()),

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
            }),

            /**
             * Everything the charts page draws, in one answer.
             *
             * One route rather than one per series: the page shows all of them at once, and
             * thirteen requests that each re-scan the same window is thirteen times the work for
             * the same screen. The whole payload is cached for a few seconds - a daily series
             * does not move between two visitors, and the fee sum behind it is the most expensive
             * read this server does.
             */
            charts: routes.get('/charts', { query: chartsQuery, output: chartsSummary }, ({ query }) =>
            {
                const days = query.days ?? DEFAULT_CHART_DAYS;
                const now = Date.now();
                const cached = chartsCache.get(days);
                if (cached !== undefined && now - cached.at < CHARTS_TTL_MS)
                {
                    return cached.payload;
                }
                const payload = summarize(days, Math.floor(now / 1000));
                chartsCache.set(days, { at: now, payload });
                return payload;
            })
        })),

        blocks: feature('/blocks', (routes) => ({
            list: routes.get('/', { query: blockListQuery, output: blockPage }, ({ query }) =>
            {
                const { limit, offset, page } = paging(query);
                const { rows, total } = store.blocksPage(limit, offset, query.content ?? 'all');
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
            list: routes.get('/', { query: transactionListQuery, output: transactionPage }, ({ query }) =>
            {
                const { limit, offset, page } = paging(query);
                const { rows, total } = store.transactionsPage(limit, offset, query.status ?? 'all');
                return { rows: rows.map(presentTransaction), total, page, pages: pageCount(total, limit) };
            }),

            one: routes.get('/:hash', { query: pageQuery, output: transactionDetail }, ({ params, query }) =>
            {
                const found = store.transactionByHash(params.hash);
                if (found === null)
                {
                    throw new NotFoundError('No such transaction in the index.');
                }
                const { limit, offset, page } = paging(query);
                const { rows, total } = store.transfersOfTransaction(found.hash, limit, offset);
                return {
                    transaction: presentTransaction(found),
                    transfers: withTokens(rows),
                    total,
                    page,
                    pages: pageCount(total, limit)
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

            transactions: routes.get('/:address/txs', { query: addressListQuery, output: transactionPage }, ({ params, query }) =>
            {
                const { limit, offset, page } = paging(query);
                const { rows, total } = store.transactionsOfAddress(params.address, limit, offset, query.direction ?? 'all');
                return { rows: rows.map(presentTransaction), total, page, pages: pageCount(total, limit) };
            }),

            transfers: routes.get('/:address/transfers', { query: pageQuery, output: transferPage }, ({ params, query }) =>
            {
                const { limit, offset, page } = paging(query);
                const { rows, total } = store.transfersOfAddress(params.address, limit, offset);
                return { rows: withTokens(rows), total, page, pages: pageCount(total, limit) };
            }),

            // The one read that is mostly NOT from the index: a contract's code, what its getters
            // answer right now, and what it delegates to are all live facts, and a cached copy of
            // any of them would describe a contract that no longer exists in that form. Only the
            // deployment - who put it there - comes from the index, because the chain cannot say.
            contract: routes.get('/:address/contract', { output: contractDetail }, async ({ params }) =>
                inspectContract({ store, chain }, params.address)),

            // A read, executed against the node. POST rather than GET because the arguments are a
            // structured body, and rather than QUERY because this has to survive whatever reverse
            // proxy a deployment puts in front of it - a method a WAF has never heard of comes
            // back 405, and a button that works only on localhost is worse than a purist verb.
            //
            // Not a general RPC passthrough: only `view`/`pure` functions of the signature table
            // can be named (see inspect.ts), so the callable surface is a fixed list of published
            // getters. Writes never come through here at all.
            call: routes.post('/:address/call', { input: contractCallInput, output: contractCallResult }, async ({ params, input }) =>
                readContract({ store, chain }, params.address, input.selector, input.args)),

            // Encoding only - no node, no signing, no sending. The browser hands the bytes to a
            // wallet, and the wallet's owner decides whether they become a transaction.
            calldata: routes.post('/:address/calldata', { input: contractCallInput, output: contractCalldata }, ({ input }) =>
                ({ data: calldataFor(input.selector, input.args) }))
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
        })),

        accounts: feature('/accounts', (routes) => ({
            top: routes.get('/top', { query: accountListQuery, output: topAccounts }, async ({ query }) =>
            {
                const { limit, offset, page } = paging(query);
                const now = Date.now();
                if (rankedAccounts === null || now - rankedAccounts.at >= RANKED_TTL_MS)
                {
                    const addresses = store.distinctAddresses();
                    const rows = await Promise.all(addresses.map(async (address) => ({
                        address,
                        balance: await chain.balance(address).then((value) => value.toString()).catch(() => '0')
                    })));
                    rows.sort((left, right) =>
                    {
                        const a = BigInt(left.balance);
                        const b = BigInt(right.balance);
                        return a > b ? -1 : a < b ? 1 : 0;
                    });
                    // Ranked HERE, once, over the whole list - see `rank` in schemas.ts. Doing it
                    // after the search would hand the first match the first place.
                    rankedAccounts = {
                        at: now,
                        rows: rows.filter((row) => row.balance !== '0')
                            .map((row, index) => ({ ...row, rank: index + 1 }))
                    };
                }
                // Lower-cased on the way in: the index stores addresses lower-cased, and a
                // checksummed address pasted into the field must not miss its own row.
                const term = (query.q ?? '').trim().toLowerCase();
                const matched = term === ''
                    ? rankedAccounts.rows
                    : rankedAccounts.rows.filter((row) => row.address.includes(term));
                return {
                    rows: matched.slice(offset, offset + limit),
                    total: matched.length,
                    page,
                    pages: pageCount(matched.length, limit)
                };
            })
        })),

        // Governance: this chain's own `x/gov` module, reached over the EVM through the gov
        // precompile. Read live - see `readGovernance` above and chain/gov.ts.
        governance: feature('/governance', (routes) => ({
            overview: routes.get('/', { output: governanceOverview }, async () =>
            {
                const { params, proposals } = await readGovernance();
                const groups = proposals.map((row) => proposalGroup(presentProposal(row).status));
                return {
                    enabled: params !== null,
                    precompile: GOV_PRECOMPILE,
                    calls: GOV_CALLS,
                    params,
                    // The denom a deposit is made in IS the chain's governance token; the page
                    // formats every figure on it with the chain's own decimals.
                    denom: params?.minDeposit[0]?.denom ?? '',
                    total: proposals.length,
                    open: groups.filter((group) => group === 'open').length,
                    passed: groups.filter((group) => group === 'passed').length,
                    failed: groups.filter((group) => group === 'failed').length
                };
            }),

            /** A page of proposals, newest first, narrowed to a group of states. */
            list: routes.get('/proposals', { query: proposalListQuery, output: proposalPage }, async ({ query }) =>
            {
                const { limit, offset, page } = paging(query);
                const { proposals } = await readGovernance();
                const wanted = query.status ?? 'all';
                const rows = proposals
                    .map(presentProposal)
                    .filter((row) => wanted === 'all' || proposalGroup(row.status) === wanted);

                return {
                    rows: rows.slice(offset, offset + limit),
                    total: rows.length,
                    page,
                    pages: pageCount(rows.length, limit)
                };
            }),

            /**
             * One proposal, with a page of the ballots cast on it.
             *
             * The tally comes from `getTallyResult` rather than from the proposal itself: while a
             * vote is open the module leaves the proposal's own final tally at zero, and a page
             * that printed that would report every live vote as untouched.
             */
            one: routes.get('/proposals/:id', { query: pageQuery, output: proposalDetail }, async ({ params: route, query }) =>
            {
                if (!/^\d+$/.test(route.id))
                {
                    throw new NotFoundError('No such proposal');
                }
                const { params } = await readGovernance();
                if (params === null)
                {
                    throw new NotFoundError('This chain does not expose governance to the EVM');
                }
                const row = await readProposal(chain, route.id);
                if (row === null)
                {
                    throw new NotFoundError('No such proposal');
                }

                const { limit, offset, page } = paging(query);
                const [live, votes, total] = await Promise.all([
                    readTally(chain, route.id),
                    readVotes(chain, route.id, limit, offset),
                    countVotes(chain, route.id)
                ]);
                const presented = presentProposal(row);

                return {
                    proposal: live === null ? presented : { ...presented, tally: live },
                    params,
                    precompile: GOV_PRECOMPILE,
                    calls: GOV_CALLS,
                    votes: presentVotes(votes ?? []),
                    total,
                    page,
                    pages: pageCount(total, limit)
                };
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
