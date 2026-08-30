import { loadConfig, num, str } from '@azerothjs/http';

import { bech32ToHex } from './bech32.ts';

// The chain's OWN apis, beside the EVM one.
//
// Nura is a Cosmos chain with an EVM module: blocks and transactions arrive over JSON-RPC and are
// indexed, but governance lives in `x/gov` and never touches the EVM at all. Two endpoints of the
// same node answer for it - the REST api (`1317`) for the module's state, and CometBFT's own rpc
// (`26657`) for what the node itself is doing - and this file is the whole of what the explorer
// knows about them.
//
// It runs on the SERVER for a reason. The node exposes these on localhost beside the explorer, so
// the browser never talks to them: no second origin, no CORS, and nothing about the node's
// addresses in the client bundle. Where they are not reachable, every function here answers null
// and the governance section says so rather than showing a chain nobody proposes anything on.

export interface CosmosEnv
{
    /** The Cosmos REST api ("LCD"). Empty disables the governance section outright. */
    restUrl: string;

    /** CometBFT's rpc - what the node says about its own height and sync. */
    rpcUrl: string;

    /** How long any single call may take. A page must not hang on a node that is not answering. */
    timeoutMs: number;
}

export function loadCosmosEnv(): CosmosEnv
{
    return loadConfig({
        // Localhost by default: the explorer is meant to run beside the node it reads, and a
        // deployment that puts them apart says so in its own .env.
        restUrl: str('COSMOS_REST_URL', { default: 'http://127.0.0.1:1317' }),
        rpcUrl: str('COMETBFT_RPC_URL', { default: 'http://127.0.0.1:26657' }),
        timeoutMs: num('COSMOS_TIMEOUT_MS', { default: 4000 })
    });
}

export interface CosmosCoin
{
    denom: string;
    /** Base units, as a decimal string - a uint256 that must not go through a double. */
    amount: string;
}

export interface CosmosMessage
{
    /** The proto type url, eg `/cosmos.evm.feemarket.v1.MsgUpdateParams`. */
    type: string;
    /** The message itself, as json - what it would DO, in the module's own words. */
    body: string;
}

export interface CosmosProposal
{
    id: string;
    title: string;
    summary: string;
    /** The module's own status string, eg `PROPOSAL_STATUS_VOTING_PERIOD`. */
    status: string;
    messages: CosmosMessage[];
    metadata: string;
    submitTime: string;
    depositEndTime: string;
    votingStartTime: string;
    votingEndTime: string;
    totalDeposit: CosmosCoin[];
    tally: { yes: string; abstain: string; no: string; noWithVeto: string };
    /** The proposer as the chain writes it, and as the EVM sees the same account. */
    proposer: string;
    proposerHex: string | null;
}

export interface CosmosVote
{
    voter: string;
    voterHex: string | null;
    /** One entry per option; a plain vote has exactly one at full weight. */
    options: Array<{ option: string; weight: string }>;
    metadata: string;
}

export interface CosmosDeposit
{
    depositor: string;
    depositorHex: string | null;
    amount: CosmosCoin[];
}

export interface CosmosParams
{
    quorum: string;
    threshold: string;
    vetoThreshold: string;
    /** Seconds. The module states both as durations like '172800s'. */
    votingPeriod: number;
    maxDepositPeriod: number;
    minDeposit: CosmosCoin[];
}

export interface CosmosStatus
{
    chainId: string;
    height: number;
    catchingUp: boolean;
}

/** A page of something, with the module's own total beside it. */
export interface CosmosPage<T>
{
    rows: T[];
    total: number;
}

/**
 * One GET against one of the node's apis.
 *
 * Null on ANY failure - unreachable, timed out, not json, or an error status. Governance is a
 * section that either answers or says it cannot, and there is nothing a reader can do with the
 * difference between a refused connection and a 501.
 */
async function get<T>(base: string, path: string, timeoutMs: number): Promise<T | null>
{
    if (base === '')
    {
        return null;
    }
    try
    {
        const response = await fetch(`${ base.replace(/\/$/, '') }${ path }`, {
            headers: { accept: 'application/json' },
            signal: AbortSignal.timeout(timeoutMs)
        });
        if (!response.ok)
        {
            return null;
        }
        return await response.json() as T;
    }
    catch
    {
        return null;
    }
}

/** `'172800s'` -> 172800. The module states durations as seconds with the unit stuck on. */
function seconds(duration: unknown): number
{
    const value = Number(String(duration ?? '').replace(/s$/, ''));
    return Number.isFinite(value) ? value : 0;
}

function coins(rows: unknown): CosmosCoin[]
{
    return Array.isArray(rows)
        ? rows.map((row) =>
        {
            const coin = row as { denom?: unknown; amount?: unknown };
            return { denom: String(coin.denom ?? ''), amount: String(coin.amount ?? '0') };
        })
        : [];
}

/** Both spellings of one account: what the chain wrote, and the twenty bytes the EVM knows. */
function account(address: unknown): { bech32: string; hex: string | null }
{
    const bech32 = String(address ?? '');
    return { bech32, hex: bech32 === '' ? null : bech32ToHex(bech32) };
}

function proposalOf(raw: unknown): CosmosProposal
{
    const row = raw as Record<string, unknown>;
    const tally = (row.final_tally_result ?? {}) as Record<string, unknown>;
    const proposer = account(row.proposer);

    return {
        id: String(row.id ?? ''),
        title: String(row.title ?? ''),
        summary: String(row.summary ?? ''),
        status: String(row.status ?? 'PROPOSAL_STATUS_UNSPECIFIED'),
        // The whole message is kept, not only its type: what a proposal DOES is the fields inside
        // it, and a page that showed only `/cosmos.evm.feemarket.v1.MsgUpdateParams` would tell a
        // reader which module is being changed and nothing about how.
        messages: Array.isArray(row.messages)
            ? row.messages.map((message) =>
            {
                const body = message as Record<string, unknown>;
                return { type: String(body['@type'] ?? ''), body: JSON.stringify(body, null, 2) };
            })
            : [],
        metadata: String(row.metadata ?? ''),
        submitTime: String(row.submit_time ?? ''),
        depositEndTime: String(row.deposit_end_time ?? ''),
        votingStartTime: String(row.voting_start_time ?? ''),
        votingEndTime: String(row.voting_end_time ?? ''),
        totalDeposit: coins(row.total_deposit),
        tally: {
            yes: String(tally.yes_count ?? '0'),
            abstain: String(tally.abstain_count ?? '0'),
            no: String(tally.no_count ?? '0'),
            noWithVeto: String(tally.no_with_veto_count ?? '0')
        },
        proposer: proposer.bech32,
        proposerHex: proposer.hex
    };
}

/**
 * A page of proposals, newest first.
 *
 * `reverse` rather than sorting here: the module pages over its own store, and asking it for the
 * last page of an ascending list would be a different set of rows every time one is added.
 */
export async function readProposals(env: CosmosEnv, limit: number, offset: number): Promise<CosmosPage<CosmosProposal> | null>
{
    const query = `?pagination.limit=${ limit }&pagination.offset=${ offset }&pagination.reverse=true&pagination.count_total=true`;
    const body = await get<{ proposals?: unknown[]; pagination?: { total?: string } }>(
        env.restUrl, `/cosmos/gov/v1/proposals${ query }`, env.timeoutMs);

    if (body === null || !Array.isArray(body.proposals))
    {
        return null;
    }
    return {
        rows: body.proposals.map(proposalOf),
        total: Number(body.pagination?.total ?? body.proposals.length)
    };
}

export async function readProposal(env: CosmosEnv, id: string): Promise<CosmosProposal | null>
{
    const body = await get<{ proposal?: unknown }>(env.restUrl, `/cosmos/gov/v1/proposals/${ id }`, env.timeoutMs);
    return body?.proposal === undefined ? null : proposalOf(body.proposal);
}

/**
 * The RUNNING tally.
 *
 * A proposal's own `final_tally_result` is filled in only once voting closes; while it is open the
 * module leaves it at zero and answers this endpoint instead. A page that printed the first would
 * report every live vote as one nobody had touched.
 */
export async function readTally(env: CosmosEnv, id: string): Promise<CosmosProposal['tally'] | null>
{
    const body = await get<{ tally?: Record<string, unknown> }>(
        env.restUrl, `/cosmos/gov/v1/proposals/${ id }/tally`, env.timeoutMs);

    if (body?.tally === undefined)
    {
        return null;
    }
    return {
        yes: String(body.tally.yes_count ?? '0'),
        abstain: String(body.tally.abstain_count ?? '0'),
        no: String(body.tally.no_count ?? '0'),
        noWithVeto: String(body.tally.no_with_veto_count ?? '0')
    };
}

export async function readVotes(env: CosmosEnv, id: string, limit: number, offset: number): Promise<CosmosPage<CosmosVote> | null>
{
    const query = `?pagination.limit=${ limit }&pagination.offset=${ offset }&pagination.reverse=true&pagination.count_total=true`;
    const body = await get<{ votes?: unknown[]; pagination?: { total?: string } }>(
        env.restUrl, `/cosmos/gov/v1/proposals/${ id }/votes${ query }`, env.timeoutMs);

    if (body === null || !Array.isArray(body.votes))
    {
        return null;
    }
    return {
        rows: body.votes.map((raw) =>
        {
            const row = raw as Record<string, unknown>;
            const voter = account(row.voter);
            return {
                voter: voter.bech32,
                voterHex: voter.hex,
                options: Array.isArray(row.options)
                    ? row.options.map((entry) =>
                    {
                        const option = entry as { option?: unknown; weight?: unknown };
                        return { option: String(option.option ?? ''), weight: String(option.weight ?? '0') };
                    })
                    : [],
                metadata: String(row.metadata ?? '')
            };
        }),
        total: Number(body.pagination?.total ?? body.votes.length)
    };
}

export async function readDeposits(env: CosmosEnv, id: string, limit: number, offset: number): Promise<CosmosPage<CosmosDeposit> | null>
{
    const query = `?pagination.limit=${ limit }&pagination.offset=${ offset }&pagination.count_total=true`;
    const body = await get<{ deposits?: unknown[]; pagination?: { total?: string } }>(
        env.restUrl, `/cosmos/gov/v1/proposals/${ id }/deposits${ query }`, env.timeoutMs);

    if (body === null || !Array.isArray(body.deposits))
    {
        return null;
    }
    return {
        rows: body.deposits.map((raw) =>
        {
            const row = raw as Record<string, unknown>;
            const depositor = account(row.depositor);
            return { depositor: depositor.bech32, depositorHex: depositor.hex, amount: coins(row.amount) };
        }),
        total: Number(body.pagination?.total ?? body.deposits.length)
    };
}

/**
 * What passing takes.
 *
 * One request rather than three: since SDK 0.47 every gov parameter comes back under `params`
 * whichever of the three types is asked for, and the older split answer is read as a fallback so
 * a chain on the earlier shape still fills the panel.
 */
export async function readParams(env: CosmosEnv): Promise<CosmosParams | null>
{
    const body = await get<Record<string, Record<string, unknown> | undefined>>(
        env.restUrl, '/cosmos/gov/v1/params/tallying', env.timeoutMs);

    if (body === null)
    {
        return null;
    }
    const params = body.params ?? {};
    const tally = body.tally_params ?? {};
    const deposit = body.deposit_params ?? {};
    const voting = body.voting_params ?? {};

    return {
        quorum: String(params.quorum ?? tally.quorum ?? '0'),
        threshold: String(params.threshold ?? tally.threshold ?? '0'),
        vetoThreshold: String(params.veto_threshold ?? tally.veto_threshold ?? '0'),
        votingPeriod: seconds(params.voting_period ?? voting.voting_period),
        maxDepositPeriod: seconds(params.max_deposit_period ?? deposit.max_deposit_period),
        minDeposit: coins(params.min_deposit ?? deposit.min_deposit)
    };
}

/**
 * The staked supply, which is what a quorum is measured against.
 *
 * Without this the page can say how a vote is divided but not whether enough of the chain turned
 * up - and turnout is the first thing that decides a Cosmos proposal.
 */
export async function readBondedTokens(env: CosmosEnv): Promise<string | null>
{
    const body = await get<{ pool?: { bonded_tokens?: unknown } }>(
        env.restUrl, '/cosmos/staking/v1beta1/pool', env.timeoutMs);
    return body?.pool?.bonded_tokens === undefined ? null : String(body.pool.bonded_tokens);
}

/**
 * What the node says about itself, from CometBFT rather than from the REST api.
 *
 * This is the provenance line under the section: a governance page read from a node that is still
 * catching up is showing an old state machine, and a reader deciding how to vote deserves to know
 * which block the answer came from.
 */
export async function readStatus(env: CosmosEnv): Promise<CosmosStatus | null>
{
    const body = await get<{ result?: Record<string, Record<string, unknown>> }>(
        env.rpcUrl, '/status', env.timeoutMs);

    // CometBFT answers `{ jsonrpc, id, result }` over http as well as over json-rpc; some proxies
    // unwrap it, so the payload is read from either shape.
    const wrapped = body as Record<string, unknown> | null;
    const result = (body?.result ?? wrapped) as Record<string, Record<string, unknown>> | null;
    if (result?.node_info === undefined || result.sync_info === undefined)
    {
        return null;
    }
    return {
        chainId: String(result.node_info.network ?? ''),
        height: Number(result.sync_info.latest_block_height ?? 0),
        catchingUp: result.sync_info.catching_up === true
    };
}
