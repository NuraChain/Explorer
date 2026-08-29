import { decodeAbiParameters, encodeAbiParameters, type AbiParameter } from 'viem';

import type { ChainGateway } from './client.ts';
import { selectorOf } from './signatures.ts';

// Governance, as a Cosmos chain with an EVM keeps it.
//
// This chain's proposals do not live in a contract somebody deployed - they live in the chain's
// own `x/gov` module, and they never touch the EVM. What DOES touch the EVM is the gov PRECOMPILE:
// a fixed address that answers `eth_call` with the module's state and accepts a transaction that
// votes or submits. So the explorer reads governance the same way it reads everything else - one
// JSON-RPC connection - and a wallet signs a vote the same way it signs a transfer.
//
// Nothing here is indexed. There are tens of proposals where there are millions of transactions,
// every one of them is a live answer from the module, and a copy in sqlite would only be a copy
// that can be wrong. The routes cache the answer for a few seconds and that is all.
//
// The precompile is a CHAIN setting (`active_static_precompiles` on the EVM module). Where it is
// off, every call below answers with empty data rather than reverting - see `readParams`, which is
// what the API asks first and what decides whether this section exists at all.

/** The address the cosmos/evm gov precompile is mounted at. */
export const GOV_PRECOMPILE = '0x0000000000000000000000000000000000000805';

/** `Coin`, as the precompile's own Types.sol declares it. */
const COIN = { type: 'tuple', components: [{ type: 'string' }, { type: 'uint256' }] } as const;

/** `PageRequest`: key, offset, limit, countTotal, reverse. */
const PAGE_REQUEST = {
    type: 'tuple',
    components: [{ type: 'bytes' }, { type: 'uint64' }, { type: 'uint64' }, { type: 'bool' }, { type: 'bool' }]
} as const;

/** `PageResponse`: nextKey, total. */
const PAGE_RESPONSE = { type: 'tuple', components: [{ type: 'bytes' }, { type: 'uint64' }] } as const;

/** `TallyResultData`: yes, abstain, no, noWithVeto - all decimal strings of the staking denom. */
const TALLY = {
    type: 'tuple',
    components: [{ type: 'string' }, { type: 'string' }, { type: 'string' }, { type: 'string' }]
} as const;

/** `ProposalData`, field for field and in order. */
const PROPOSAL = {
    type: 'tuple',
    components: [
        { type: 'uint64' },          // id
        { type: 'string[]' },        // messages
        { type: 'uint32' },          // status
        TALLY,                       // finalTallyResult
        { type: 'uint64' },          // submitTime
        { type: 'uint64' },          // depositEndTime
        { type: 'tuple[]', components: COIN.components }, // totalDeposit
        { type: 'uint64' },          // votingStartTime
        { type: 'uint64' },          // votingEndTime
        { type: 'string' },          // metadata
        { type: 'string' },          // title
        { type: 'string' },          // summary
        { type: 'address' }          // proposer
    ]
} as const;

/** `WeightedVote`: proposalId, voter, options[(option, weight)], metadata. */
const WEIGHTED_VOTE = {
    type: 'tuple',
    components: [
        { type: 'uint64' },
        { type: 'address' },
        { type: 'tuple[]', components: [{ type: 'uint8' }, { type: 'string' }] },
        { type: 'string' }
    ]
} as const;

/** `Params` - only the four this explorer reads are named; the rest are decoded and dropped. */
const PARAMS = {
    type: 'tuple',
    components: [
        { type: 'int64' },                                    // votingPeriod
        { type: 'tuple[]', components: COIN.components },     // minDeposit
        { type: 'int64' },                                    // maxDepositPeriod
        { type: 'string' },                                   // quorum
        { type: 'string' },                                   // threshold
        { type: 'string' },                                   // vetoThreshold
        { type: 'string' },                                   // minInitialDepositRatio
        { type: 'string' },                                   // proposalCancelRatio
        { type: 'string' },                                   // proposalCancelDest
        { type: 'int64' },                                    // expeditedVotingPeriod
        { type: 'string' },                                   // expeditedThreshold
        { type: 'tuple[]', components: COIN.components },     // expeditedMinDeposit
        { type: 'bool' },                                     // burnVoteQuorum
        { type: 'bool' },                                     // burnProposalDepositPrevote
        { type: 'bool' },                                     // burnVoteVeto
        { type: 'string' }                                    // minDepositRatio
    ]
} as const;

/**
 * The five states `x/gov` puts a proposal through, by the number the module uses.
 *
 * Written down in the module's own order: 1 is the deposit period and 5 is a proposal that passed
 * and then failed to execute. An explorer that shifted these by one would report a rejected
 * proposal as a passed one.
 */
export const PROPOSAL_STATUS_BY_CODE = [
    'unspecified', 'deposit', 'voting', 'passed', 'rejected', 'failed'
] as const;

/** The four ways a Cosmos vote can be cast, by the number the module uses. */
export const VOTE_OPTION_BY_CODE = ['unspecified', 'yes', 'abstain', 'no', 'noWithVeto'] as const;

export interface GovCoin
{
    denom: string;
    /** Base units, as a decimal string: a deposit is a uint256 like every other amount here. */
    amount: string;
}

export interface GovProposal
{
    id: string;
    /** The type URLs of the messages the proposal would run, eg `/cosmos.evm.feemarket.v1.MsgUpdateParams`. */
    messages: string[];
    status: number;
    tally: { yes: string; abstain: string; no: string; noWithVeto: string };
    submitTime: number;
    depositEndTime: number;
    totalDeposit: GovCoin[];
    votingStartTime: number;
    votingEndTime: number;
    metadata: string;
    title: string;
    summary: string;
    /** The proposer's EVM address: the precompile converts the bech32 account for us. */
    proposer: string;
}

export interface GovVote
{
    proposalId: string;
    voter: string;
    /** One entry per option the voter split their weight across; a plain vote has exactly one. */
    options: Array<{ option: number; weight: string }>;
    metadata: string;
}

export interface GovParams
{
    votingPeriod: number;
    minDeposit: GovCoin[];
    /** Share of the voting power that must turn out, as a decimal string ('0.334000000000000000'). */
    quorum: string;
    threshold: string;
    vetoThreshold: string;
}

function coins(rows: readonly unknown[]): GovCoin[]
{
    return rows.map((row) =>
    {
        const [denom, amount] = row as [string, bigint];
        return { denom, amount: amount.toString() };
    });
}

function proposalOf(row: unknown): GovProposal
{
    const [id, messages, status, tally, submitTime, depositEndTime, totalDeposit,
        votingStartTime, votingEndTime, metadata, title, summary, proposer] =
        row as [bigint, readonly string[], number, [string, string, string, string], bigint, bigint,
            readonly unknown[], bigint, bigint, string, string, string, string];

    return {
        id: id.toString(),
        messages: [...messages],
        status: Number(status),
        tally: { yes: tally[0], abstain: tally[1], no: tally[2], noWithVeto: tally[3] },
        submitTime: Number(submitTime),
        depositEndTime: Number(depositEndTime),
        totalDeposit: coins(totalDeposit),
        votingStartTime: Number(votingStartTime),
        votingEndTime: Number(votingEndTime),
        metadata,
        title,
        summary,
        proposer: proposer.toLowerCase()
    };
}

/** One page request, spelled the way the precompile's `PageRequest` wants it. */
function page(limit: number, offset: number, reverse = true): readonly [`0x${ string }`, bigint, bigint, boolean, boolean]
{
    return ['0x', BigInt(offset), BigInt(limit), true, reverse];
}

/**
 * One call to the precompile, or null when it answers nothing.
 *
 * An address with no precompile mounted is an EMPTY ACCOUNT, and calling one succeeds with no
 * return data rather than reverting - so `null` here means "this chain does not expose governance
 * to the EVM", which is a different fact from a call that failed and is treated as one.
 */
async function call(chain: ChainGateway, data: string, outputs: readonly AbiParameter[]): Promise<readonly unknown[] | null>
{
    try
    {
        const answer = await chain.call(GOV_PRECOMPILE, data);
        if (answer === '0x' || answer === '')
        {
            return null;
        }
        return decodeAbiParameters(outputs, answer as `0x${ string }`);
    }
    catch
    {
        return null;
    }
}

function encode(signature: string, inputs: readonly AbiParameter[], values: readonly unknown[]): string
{
    const args = inputs.length === 0 ? '' : encodeAbiParameters(inputs, values).slice(2);
    return `${ selectorOf(signature) }${ args }`;
}

/**
 * The module's parameters - and the explorer's test for whether governance is reachable at all.
 *
 * Null means the precompile is not enabled on this chain. Every other read returns null too in
 * that case; this is simply the cheapest question to ask first.
 */
export async function readParams(chain: ChainGateway): Promise<GovParams | null>
{
    const answer = await call(chain, encode('getParams()', [], []), [PARAMS]);
    if (answer === null)
    {
        return null;
    }
    const row = answer[0] as [bigint, readonly unknown[], bigint, string, string, string, ...unknown[]];
    return {
        votingPeriod: Number(row[0]),
        minDeposit: coins(row[1]),
        quorum: row[3],
        threshold: row[4],
        vetoThreshold: row[5]
    };
}

/**
 * A page of proposals, newest first.
 *
 * Status 0 asks for every state; the two addresses are the voter and depositor filters the module
 * offers, and the zero address means "no filter" - this explorer lists what the chain is deciding,
 * not one account's part in it.
 */
export async function readProposals(chain: ChainGateway, limit: number, offset: number, status = 0): Promise<GovProposal[] | null>
{
    const data = encode(
        'getProposals(uint32,address,address,(bytes,uint64,uint64,bool,bool))',
        [{ type: 'uint32' }, { type: 'address' }, { type: 'address' }, PAGE_REQUEST],
        [status, `0x${ '0'.repeat(40) }`, `0x${ '0'.repeat(40) }`, page(limit, offset)]
    );
    const answer = await call(chain, data, [{ type: 'tuple[]', components: PROPOSAL.components }, PAGE_RESPONSE]);
    return answer === null ? null : (answer[0] as readonly unknown[]).map(proposalOf);
}

/** How many proposals the module holds, from the page response's total. */
export async function countProposals(chain: ChainGateway): Promise<number>
{
    const data = encode(
        'getProposals(uint32,address,address,(bytes,uint64,uint64,bool,bool))',
        [{ type: 'uint32' }, { type: 'address' }, { type: 'address' }, PAGE_REQUEST],
        [0, `0x${ '0'.repeat(40) }`, `0x${ '0'.repeat(40) }`, page(1, 0)]
    );
    const answer = await call(chain, data, [{ type: 'tuple[]', components: PROPOSAL.components }, PAGE_RESPONSE]);
    if (answer === null)
    {
        return 0;
    }
    const [, total] = answer[1] as [string, bigint];
    return Number(total);
}

export async function readProposal(chain: ChainGateway, id: string): Promise<GovProposal | null>
{
    const data = encode('getProposal(uint64)', [{ type: 'uint64' }], [BigInt(id)]);
    const answer = await call(chain, data, [PROPOSAL]);
    return answer === null ? null : proposalOf(answer[0]);
}

/**
 * The live tally.
 *
 * Separate from the proposal's own `finalTallyResult`, which the module fills in only once voting
 * has closed - while a vote is open that field reads zero, and the running count lives here.
 */
export async function readTally(chain: ChainGateway, id: string): Promise<GovProposal['tally'] | null>
{
    const data = encode('getTallyResult(uint64)', [{ type: 'uint64' }], [BigInt(id)]);
    const answer = await call(chain, data, [TALLY]);
    if (answer === null)
    {
        return null;
    }
    const [yes, abstain, no, noWithVeto] = answer[0] as [string, string, string, string];
    return { yes, abstain, no, noWithVeto };
}

export async function readVotes(chain: ChainGateway, id: string, limit: number, offset: number): Promise<GovVote[] | null>
{
    const data = encode(
        'getVotes(uint64,(bytes,uint64,uint64,bool,bool))',
        [{ type: 'uint64' }, PAGE_REQUEST],
        [BigInt(id), page(limit, offset)]
    );
    const answer = await call(chain, data, [{ type: 'tuple[]', components: WEIGHTED_VOTE.components }, PAGE_RESPONSE]);
    if (answer === null)
    {
        return null;
    }
    return (answer[0] as readonly unknown[]).map((row) =>
    {
        const [proposalId, voter, options, metadata] =
            row as [bigint, string, ReadonlyArray<[number, string]>, string];
        return {
            proposalId: proposalId.toString(),
            voter: voter.toLowerCase(),
            options: options.map(([option, weight]) => ({ option: Number(option), weight })),
            metadata
        };
    });
}

/** How many votes a proposal has, from the page response's total. */
export async function countVotes(chain: ChainGateway, id: string): Promise<number>
{
    const data = encode(
        'getVotes(uint64,(bytes,uint64,uint64,bool,bool))',
        [{ type: 'uint64' }, PAGE_REQUEST],
        [BigInt(id), page(1, 0)]
    );
    const answer = await call(chain, data, [{ type: 'tuple[]', components: WEIGHTED_VOTE.components }, PAGE_RESPONSE]);
    if (answer === null)
    {
        return 0;
    }
    const [, total] = answer[1] as [string, bigint];
    return Number(total);
}
