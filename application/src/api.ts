// The one file that crosses into the server half - and it crosses with TYPES only. The value
// import below is client-safe schemas; `typeof api` is erased at build, so no handler, store,
// or server dependency can reach the browser bundle. The client's runtime half is the MANIFEST:
// method + path per route, projected from the SAME declaration the server registered, embedded
// in every served page by the kit and read back synchronously. '/api' is one origin's mount, in
// development as in production.

import { createClient, readManifest, type Manifest } from '@azerothjs/http/api/shared';

import type { Api } from '../../server/src/app.ts';

export type {
    Account,
    AddressDirection,
    Block,
    BlockFilter,
    Coin,
    GovCalls,
    GovDeposit,
    GovernanceOverview,
    GovMessage,
    GovNode,
    GovParams,
    Proposal,
    ProposalDetail,
    ProposalFilter,
    ProposalPage,
    ProposalStatus,
    Tally,
    Vote,
    VoteOption,
    ChartPoint,
    ChartSeries,
    ChartSeriesKey,
    ChartsSummary,
    ChartUnit,
    BlockDetail,
    BlockPage,
    ChainInfo,
    ContractDetail,
    ContractFunction,
    SearchResult,
    StatFigure,
    BondStatus,
    Delegation,
    DelegatorStake,
    Reward,
    StakingCalls,
    StakingOverview,
    StakingParams,
    StakingPool,
    UnbondingEntry,
    Validator,
    ValidatorFilter,
    ValidatorPage,
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
 * The manifest, read from the document the server sent.
 *
 * `mountPages` embeds it as an inert JSON script tag, so `readManifest()` is a synchronous read
 * of markup that is already on the page. That is what replaced a top-level `await fetch()` - a
 * network round trip in the entry module graph, which every first paint waited on.
 *
 * The fetch is the fallback for a page that carries no splice, and an unreachable one degrades
 * to `{}` rather than throwing: a failed boot request costs one page its data instead of taking
 * the whole module graph down and painting nothing at all.
 *
 * The SSR pass gets an empty manifest and needs none. The server's manifest comes from the
 * registration itself, hung on the request, and a loader's call dispatches in process through
 * that; this module-level value is the browser's.
 */
const manifest: Manifest = typeof document === 'undefined'
    ? {}
    : readManifest() ?? await fetch('/api/_manifest')
        .then((response) => response.json() as Promise<Manifest>)
        .catch(() => ({}));

export const client = createClient<Api>(manifest, { baseUrl: '/api' });
