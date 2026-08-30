import type { ProposalStatus, Tally, VoteOption } from '../api.ts';
import type { Tone } from '../components/ui/variants.ts';
import type { IconName } from '../icons/registry.ts';

// How a proposal READS, and the arithmetic behind a tally.
//
// The chain's governance is its own `x/gov` module: five states, four ways to vote, and every
// figure a decimal string of the staking denom's base units. The arithmetic lives here for the
// reason format.ts exists - voting power is a uint256, and a share worked out through a double
// would round somebody's stake away.

/**
 * The state's badge tone.
 *
 * `voting` takes the accent because it is the one state waiting for the reader. The colour is
 * never the only signal: every badge carries its own label and an icon beside it.
 */
export const PROPOSAL_TONE: Record<ProposalStatus, Tone> = {
    unspecified: 'neutral',
    deposit: 'neutral',
    voting: 'accent',
    passed: 'success',
    rejected: 'danger',
    failed: 'danger'
};

export const PROPOSAL_ICON: Record<ProposalStatus, IconName> = {
    unspecified: 'help',
    deposit: 'activity',
    voting: 'vote',
    passed: 'success',
    rejected: 'alert',
    failed: 'alert'
};

/**
 * The four ways a vote can be cast, in the order the module numbers them.
 *
 * A const tuple and not `readonly VoteOption[]`: each option is looked up as
 * `governance.option.<name>`, and a widened element type turns four known keys into one template
 * the dictionary cannot be checked against.
 */
export const VOTE_OPTIONS = ['yes', 'abstain', 'no', 'noWithVeto'] as const;

/** The number the module wants for each option - what `vote()` takes as its third argument. */
export const VOTE_CODE: Record<VoteOption, number> = {
    unspecified: 0,
    yes: 1,
    abstain: 2,
    no: 3,
    noWithVeto: 4
};

/** Every vote cast on a proposal, in the staking denom's base units. */
export function totalCast(tally: Tally): bigint
{
    return BigInt(tally.yes) + BigInt(tally.abstain) + BigInt(tally.no) + BigInt(tally.noWithVeto);
}

/**
 * One part as a percentage of a whole, to two decimal places.
 *
 * Multiplied BEFORE the division and in BigInt, so the ratio stays exact until the last step: a
 * tally can be twenty-seven digits long, and `Number(part) / Number(whole)` on two of those has
 * already lost the difference between 49.9% and a majority.
 */
export function share(part: bigint, whole: bigint): number
{
    return whole === 0n ? 0 : Number((part * 10_000n) / whole) / 100;
}

/**
 * The module's eighteen-place fixed point as a percentage: '0.334000000000000000' is 33.4.
 *
 * Read as a STRING and cut, never parsed as a float: the module's own arithmetic is exact, and a
 * threshold shown as 50.000000000000004% would be this explorer's rounding, not the chain's.
 */
export function ratio(value: string): number
{
    const [whole = '0', fraction = ''] = value.split('.');
    const scaled = `${ whole }${ fraction.padEnd(18, '0').slice(0, 18) }`;
    return share(BigInt(scaled), 10n ** 18n);
}

/**
 * What passing turns on, once a vote has closed.
 *
 * `x/gov` decides in three steps: enough of the staked supply has to turn out (quorum), a veto
 * share sinks the proposal outright, and otherwise YES must beat NO. Abstain counts towards
 * turnout and towards neither side - which is why the majority below excludes it, and why a
 * proposal can be ahead on the bar and still fail.
 *
 * Turnout is NOT computable here: quorum is measured against the whole bonded supply, which the
 * gov module does not report. The page shows what it can prove and says what it cannot.
 */
export function majority(tally: Tally): number
{
    const decided = BigInt(tally.yes) + BigInt(tally.no) + BigInt(tally.noWithVeto);
    return share(BigInt(tally.yes), decided);
}

/** The veto share, measured against everything cast - abstentions included, as the module does. */
export function vetoShare(tally: Tally): number
{
    return share(BigInt(tally.noWithVeto), totalCast(tally));
}

/**
 * How much of the staked supply turned out, as a percentage.
 *
 * The first thing that decides a Cosmos proposal: a vote that nobody attends fails however the
 * ballots that were cast are divided. Null where the node did not report the staked supply - and
 * then the page says so rather than drawing a bar against a number nobody gave it.
 */
export function turnout(tally: Tally, bondedTokens: string | null): number | null
{
    if (bondedTokens === null)
    {
        return null;
    }
    const bonded = BigInt(bondedTokens);
    return bonded === 0n ? null : share(totalCast(tally), bonded);
}

/** Whether this state still has something a reader can do about it. */
export function isActionable(status: ProposalStatus): boolean
{
    return status === 'voting' || status === 'deposit';
}
