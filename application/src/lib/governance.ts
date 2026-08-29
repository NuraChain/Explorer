import type { ProposalState } from '../api.ts';
import type { Tone } from '../components/ui/variants.ts';
import type { IconName } from '../icons/registry.ts';

// How a proposal READS: the badge each state wears, and the arithmetic behind a tally.
//
// The arithmetic is here rather than in the components for the reason format.ts exists: a vote
// weight is a uint256, and every share below is worked out in BigInt and only then divided down
// to a percentage. A tally that went through a double would round somebody's voting power.

/**
 * The state's badge tone.
 *
 * `active` and `queued` take the accent because they are the two states that are WAITING for
 * somebody - a vote to cast, an execution to run. The colour is never the only signal: every
 * badge on this page carries its own label and an icon beside it.
 */
export const PROPOSAL_TONE: Record<ProposalState, Tone> = {
    pending: 'neutral',
    active: 'accent',
    canceled: 'neutral',
    defeated: 'danger',
    succeeded: 'success',
    queued: 'accent',
    expired: 'neutral',
    executed: 'success',
    closed: 'neutral'
};

export const PROPOSAL_ICON: Record<ProposalState, IconName> = {
    pending: 'activity',
    active: 'vote',
    canceled: 'x',
    defeated: 'alert',
    succeeded: 'check',
    queued: 'run',
    expired: 'help',
    executed: 'success',
    closed: 'help'
};

/** The three ways a ballot can be cast, in the order `GovernorCountingSimple` numbered them. */
export const SUPPORT = ['against', 'for', 'abstain'] as const;
export type Support = (typeof SUPPORT)[number];

/** A support number as its name, or null for a governor that counts some other way. */
export function supportOf(support: number): Support | null
{
    return SUPPORT[support] ?? null;
}

/** Total voting power cast on a proposal, all three sides together. */
export function totalCast(tally: { forVotes: string; againstVotes: string; abstainVotes: string }): bigint
{
    return BigInt(tally.forVotes) + BigInt(tally.againstVotes) + BigInt(tally.abstainVotes);
}

/**
 * One part as a percentage of a whole, to two decimal places.
 *
 * Multiplied BEFORE the division and in BigInt, so the ratio is exact until the last step: a
 * weight can be twenty-seven digits long, and `Number(part) / Number(whole)` on two of those has
 * already lost the difference between 49.9% and a majority.
 */
export function share(part: bigint, whole: bigint): number
{
    return whole === 0n ? 0 : Number((part * 10_000n) / whole) / 100;
}

/**
 * How far the votes that COUNT towards quorum have got, as a percentage that can exceed 100.
 *
 * For + abstain, which is what `GovernorCountingSimple` counts - abstaining is turning up. Null
 * when the governor would not say what its quorum was, because a progress bar against an unknown
 * target is a picture of nothing.
 */
export function quorumShare(tally: { forVotes: string; abstainVotes: string; quorum: string | null }): number | null
{
    if (tally.quorum === null)
    {
        return null;
    }
    const needed = BigInt(tally.quorum);
    if (needed === 0n)
    {
        // A quorum of zero is reached by definition, and dividing by it is not a percentage.
        return 100;
    }
    return share(BigInt(tally.forVotes) + BigInt(tally.abstainVotes), needed);
}

/** Whether this state still has an action behind it - the panel is shown only for these. */
export function isActionable(state: ProposalState): boolean
{
    return state === 'active' || state === 'succeeded' || state === 'queued';
}
