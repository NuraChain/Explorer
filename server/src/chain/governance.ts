import { decodeAbiParameters, toEventSelector } from 'viem';

import type { IndexedLog } from './client.ts';

// Governance, read the only way an explorer can read it: from the logs a Governor writes.
//
// Nothing here is configured. A contract that emits `ProposalCreated` IS a governor - the event
// is the announcement, and the address that logged it is the only authority on which contract
// made it. So a chain that deploys a Governor gets a governance section the moment that
// deployment is indexed, and a chain that has none never shows an empty one.
//
// Nothing in this file touches a node or a database: bytes in, described events out. That is what
// makes every shape below testable against a log somebody actually wrote.

/**
 * OpenZeppelin Governor's events, by the topic the dispatcher pushes before it logs.
 *
 * Computed from the signature rather than written down, for the reason the selector table gives:
 * a hand-copied 32-byte hash is a typo that mislabels an event forever.
 */
export const PROPOSAL_CREATED_TOPIC = toEventSelector(
    'ProposalCreated(uint256,address,address[],uint256[],string[],bytes[],uint256,uint256,string)');
export const PROPOSAL_QUEUED_TOPIC = toEventSelector('ProposalQueued(uint256,uint256)');
export const PROPOSAL_EXECUTED_TOPIC = toEventSelector('ProposalExecuted(uint256)');
export const PROPOSAL_CANCELED_TOPIC = toEventSelector('ProposalCanceled(uint256)');
export const VOTE_CAST_TOPIC = toEventSelector('VoteCast(address,uint256,uint8,uint256,string)');
export const VOTE_CAST_WITH_PARAMS_TOPIC = toEventSelector(
    'VoteCastWithParams(address,uint256,uint8,uint256,string,bytes)');

/** Every topic that says "this address is a governor". */
export const GOVERNOR_TOPICS: ReadonlySet<string> = new Set([
    PROPOSAL_CREATED_TOPIC,
    PROPOSAL_QUEUED_TOPIC,
    PROPOSAL_EXECUTED_TOPIC,
    PROPOSAL_CANCELED_TOPIC,
    VOTE_CAST_TOPIC,
    VOTE_CAST_WITH_PARAMS_TOPIC
]);

/**
 * How a governor counts time.
 *
 * ERC-6372 lets a governor run on block numbers or on timestamps, and `voteStart` means one or
 * the other with nothing in the number to say which. Every comparison against a deadline in this
 * codebase reads this first - a timestamp compared against a height is off by years.
 */
export type GovernorClock = 'blocknumber' | 'timestamp';

/** A proposal, as its own creation announced it. */
export interface ProposalCreatedEvent
{
    kind: 'created';
    governor: string;
    proposalId: string;
    proposer: string;

    /** The calls the proposal will make if it passes - one per entry, index-aligned. */
    targets: string[];
    values: string[];
    signatures: string[];
    calldatas: string[];

    /** Timepoints on the governor's own clock, NOT necessarily block numbers. */
    voteStart: string;
    voteEnd: string;
    description: string;
}

/** One ballot. `support` is Against/For/Abstain as 0/1/2 - the ordering `GovernorCountingSimple` fixed. */
export interface VoteCastEvent
{
    kind: 'vote';
    governor: string;
    proposalId: string;
    voter: string;
    support: number;
    weight: string;
    reason: string;

    /** Only `VoteCastWithParams` carries these; '0x' from the plain event. */
    params: string;
}

/** A proposal reaching a state that is not a vote: queued for a timelock, executed, or withdrawn. */
export interface ProposalMarkEvent
{
    kind: 'queued' | 'executed' | 'canceled';
    governor: string;
    proposalId: string;

    /** When a timelock will let the queued call through. Null for every other mark. */
    eta: string | null;
}

export type GovernanceEvent = ProposalCreatedEvent | VoteCastEvent | ProposalMarkEvent;

const CREATED_INPUTS = [
    { type: 'uint256' }, { type: 'address' }, { type: 'address[]' }, { type: 'uint256[]' },
    { type: 'string[]' }, { type: 'bytes[]' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'string' }
] as const;

const VOTE_INPUTS = [{ type: 'uint256' }, { type: 'uint8' }, { type: 'uint256' }, { type: 'string' }] as const;
const VOTE_WITH_PARAMS_INPUTS = [...VOTE_INPUTS, { type: 'bytes' }] as const;
const QUEUED_INPUTS = [{ type: 'uint256' }, { type: 'uint256' }] as const;
const ID_ONLY_INPUTS = [{ type: 'uint256' }] as const;

function address(value: unknown): string
{
    return String(value).toLowerCase();
}

/** An indexed address topic, unpadded: the EVM writes twenty bytes into a thirty-two byte word. */
function topicToAddress(topic: string): string
{
    return `0x${ topic.slice(-40) }`.toLowerCase();
}

/**
 * One log as the governance event it is, or null when it is not one.
 *
 * Null covers two different things on purpose. Most logs are simply another event, and a contract
 * that is not a governor can also carry a topic that collides with one of these - a `VoteCast` of
 * somebody else's design, with somebody else's arguments behind it. Both end here rather than in
 * a half-decoded row: an explorer that guesses at bytes it cannot read prints a proposal nobody
 * made.
 */
export function decodeGovernance(log: IndexedLog): GovernanceEvent | null
{
    const topic = log.topics[0];
    if (topic === undefined || !GOVERNOR_TOPICS.has(topic))
    {
        return null;
    }
    const governor = address(log.address);
    const data = log.data as `0x${ string }`;

    try
    {
        if (topic === PROPOSAL_CREATED_TOPIC)
        {
            const [id, proposer, targets, values, signatures, calldatas, voteStart, voteEnd, description] =
                decodeAbiParameters(CREATED_INPUTS, data);
            return {
                kind: 'created',
                governor,
                proposalId: id.toString(),
                proposer: address(proposer),
                targets: targets.map(address),
                values: values.map((value) => value.toString()),
                signatures: [...signatures],
                calldatas: calldatas.map((entry) => String(entry)),
                voteStart: voteStart.toString(),
                voteEnd: voteEnd.toString(),
                description
            };
        }

        if (topic === VOTE_CAST_TOPIC || topic === VOTE_CAST_WITH_PARAMS_TOPIC)
        {
            // The voter is the one indexed argument, so it is in the topics and NOT in the data.
            const voter = log.topics[1];
            if (voter === undefined)
            {
                return null;
            }
            const withParams = topic === VOTE_CAST_WITH_PARAMS_TOPIC;
            const decoded = withParams
                ? decodeAbiParameters(VOTE_WITH_PARAMS_INPUTS, data)
                : decodeAbiParameters(VOTE_INPUTS, data);
            return {
                kind: 'vote',
                governor,
                proposalId: decoded[0].toString(),
                voter: topicToAddress(voter),
                support: Number(decoded[1]),
                weight: decoded[2].toString(),
                reason: decoded[3],
                params: withParams ? String(decoded[4]) : '0x'
            };
        }

        if (topic === PROPOSAL_QUEUED_TOPIC)
        {
            const [id, eta] = decodeAbiParameters(QUEUED_INPUTS, data);
            return { kind: 'queued', governor, proposalId: id.toString(), eta: eta.toString() };
        }

        const [id] = decodeAbiParameters(ID_ONLY_INPUTS, data);
        return {
            kind: topic === PROPOSAL_EXECUTED_TOPIC ? 'executed' : 'canceled',
            governor,
            proposalId: id.toString(),
            eta: null
        };
    }
    catch
    {
        return null;
    }
}

/**
 * The line a proposal is known by.
 *
 * A description is markdown by convention and a heading by habit, so the title is its first
 * non-empty line with the leading hashes taken off. Nothing else is parsed: the body is shown as
 * what it is on the detail page, and inventing structure the proposer did not write would put
 * words in their proposal.
 */
export function proposalTitle(description: string): string
{
    const line = description.split('\n').map((entry) => entry.trim()).find((entry) => entry !== '') ?? '';
    return line.replace(/^#+\s*/, '').slice(0, 200);
}

/**
 * `state(uint256)` answers a number; these are the names `IGovernor` gives them, in its order.
 *
 * Written down here rather than derived, because the ORDER is the standard: 0 is Pending and 7 is
 * Executed, and an explorer that shifted them by one would report a defeated proposal as passed.
 */
export const PROPOSAL_STATE_BY_CODE = [
    'pending', 'active', 'canceled', 'defeated', 'succeeded', 'queued', 'expired', 'executed'
] as const;

/** `CLOCK_MODE()` as the clock it names. Anything unrecognised is a block height - the default. */
export function readClock(mode: string): GovernorClock
{
    return mode.includes('timestamp') ? 'timestamp' : 'blocknumber';
}
