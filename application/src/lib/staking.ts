import type { BondStatus, Coin, Delegation, Validator } from '../api.ts';
import type { Tone } from '../components/ui/variants.ts';
import type { IconName } from '../icons/registry.ts';

// `share` and `ratio` are not re-implemented here.
//
// They are the same two pieces of arithmetic a tally needs - one part of a whole, and the
// module's eighteen-place fixed point as a percentage - and both are already written, tested and
// exact in governance.ts. A validator's weight in the set is a uint256 over a uint256 exactly as
// a vote's share is, and a second copy of that division is a second place for it to be wrong.
import { ratio, share } from './governance.ts';

// How a validator READS, and the arithmetic behind a stake.
//
// Every figure here is a uint256 in base units, so it stays a string until the last step and the
// division happens in BigInt - the reason format.ts exists. A voting power worked out through a
// double rounds two validators onto the same number long before they really are equal.

/**
 * The state's badge tone.
 *
 * `bonded` takes success because it is the one state that is actually earning; jailed is drawn as
 * a danger regardless of the bond status underneath it, which is why {@link validatorTone} takes
 * the whole row rather than the status alone. The colour is never the only signal - every badge
 * carries its own label and an icon beside it.
 */
const STATUS_TONE: Record<BondStatus, Tone> = {
    unspecified: 'neutral',
    unbonded: 'neutral',
    unbonding: 'accent',
    bonded: 'success'
};

const STATUS_ICON: Record<BondStatus, IconName> = {
    unspecified: 'help',
    unbonded: 'help',
    unbonding: 'activity',
    bonded: 'success'
};

/**
 * A jailed validator is drawn as jailed whatever its bond status says.
 *
 * The module leaves a jailed validator bonded - it keeps its delegations while it sits out - so a
 * badge that read the status alone would show the one row a delegator needs to act on as the
 * healthiest thing on the page.
 */
export function validatorTone(row: Validator): Tone
{
    return row.jailed ? 'danger' : STATUS_TONE[row.status];
}

export function validatorIcon(row: Validator): IconName
{
    return row.jailed ? 'alert' : STATUS_ICON[row.status];
}

/**
 * The locale key for what a row IS, jail included.
 *
 * The return type is the five literal keys rather than `string`: `locale.t` takes a key of the
 * dictionary, so a widened return would only be caught as a type error at the call site - and a
 * key that does not exist is a blank label on the page, which is exactly what that check is for.
 */
export function validatorState(row: Validator): 'staking.state.jailed' | `staking.state.${ BondStatus }`
{
    return row.jailed ? 'staking.state.jailed' : `staking.state.${ row.status }`;
}

/** Whether this validator is actually producing blocks, and so actually earning its delegators. */
export function isActive(row: Validator): boolean
{
    return row.status === 'bonded' && !row.jailed;
}

/**
 * A validator's weight in the set, as a percentage of everything bonded.
 *
 * Null where the node did not report the pool - and then the page prints nothing rather than a
 * bar drawn against a number nobody gave it.
 */
export function votingPower(row: Validator, bondedTokens: string | null): number | null
{
    if (bondedTokens === null)
    {
        return null;
    }
    const bonded = BigInt(bondedTokens);
    return bonded === 0n ? null : share(BigInt(row.tokens), bonded);
}

/** The commission a validator takes, as a percentage. */
export function commission(row: Validator): number
{
    return ratio(row.commissionRate);
}

/**
 * The ceiling a validator may ever raise its commission to, as a percentage.
 *
 * Through `ratio` like the rate itself: `Number('0.200000000000000000')` is a double parse of
 * eighteen-place fixed point, and the one number on this page a delegator is trusting not to
 * move is not the place to start rounding.
 */
export function commissionMax(row: Validator): number
{
    return ratio(row.commissionMaxRate);
}

/** How much of one denom a coin list holds. Zero when it holds none - an absent coin IS zero. */
export function amountOf(coins: readonly Coin[], denom: string): string
{
    return coins.find((entry) => entry.denom === denom)?.amount ?? '0';
}

/** Everything the reader has delegated, across every validator, in base units. */
export function totalDelegated(rows: readonly Delegation[]): string
{
    return rows.reduce((sum, row) => sum + BigInt(row.balance.amount), 0n).toString();
}

/** Everything on its way back out, in base units. */
export function totalUnbonding(rows: readonly { balance: string }[]): string
{
    return rows.reduce((sum, row) => sum + BigInt(row.balance), 0n).toString();
}

/**
 * Seconds as whole days, rounded down.
 *
 * The unbonding period is the single most important number on the page - it is how long a
 * reader's stake is locked and unearning after they ask for it back - and it is stated in days
 * because that is the unit the decision is actually made in.
 */
export function days(seconds: number): number
{
    return Math.floor(seconds / 86_400);
}
