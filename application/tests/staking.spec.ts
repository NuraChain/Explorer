// The arithmetic behind a stake. A validator's weight is a uint256 over a uint256 and a
// commission is eighteen places of fixed point, so everything below stays in BigInt until the
// last division - the same rule format.ts follows for amounts, and for the same reason.
import { describe, it, expect } from 'vitest';

import {
    amountOf,
    commission,
    commissionMax,
    isActive,
    totalDelegated,
    totalUnbonding,
    validatorIcon,
    validatorState,
    validatorTone,
    votingPower
} from '../src/lib/staking.ts';
import { scaleDuration } from '../src/lib/format.ts';
import { BOND_STATUSES, type Validator } from '../../server/src/schemas.ts';

const NURA = (whole: bigint): string => (whole * 10n ** 18n).toString();

function validator(over: Partial<Validator> = {}): Validator
{
    return {
        operatorAddress: 'nuravaloper1ftqdjvqyy26q3w32harejhy8eue8vdcjsengjg',
        accountHex: '0x4ac0d9300422b408ba2abf47995c87cf32763712',
        moniker: 'alpha',
        identity: '',
        website: '',
        details: '',
        jailed: false,
        status: 'bonded',
        tokens: NURA(1_000n),
        delegatorShares: NURA(1_000n),
        commissionRate: '0.050000000000000000',
        commissionMaxRate: '0.200000000000000000',
        commissionMaxChangeRate: '0.010000000000000000',
        minSelfDelegation: '1',
        unbondingTime: '',
        ...over
    };
}

describe('what a validator IS', () =>
{
    it('reads a jailed validator as jailed, whatever its bond status says', () =>
    {
        // The module leaves a jailed validator BONDED while it sits out. Reading the status alone
        // would draw the one row a delegator needs to act on as the healthiest on the page.
        const jailed = validator({ jailed: true, status: 'bonded' });

        expect(validatorState(jailed)).toBe('staking.state.jailed');
        expect(validatorTone(jailed)).toBe('danger');
        expect(validatorIcon(jailed)).toBe('alert');
        expect(isActive(jailed)).toBe(false);
    });

    it('counts only a bonded, unjailed validator as active', () =>
    {
        expect(isActive(validator({ status: 'bonded' }))).toBe(true);
        expect(isActive(validator({ status: 'unbonding' }))).toBe(false);
        expect(isActive(validator({ status: 'unbonded' }))).toBe(false);
    });

    it('has a tone, an icon and a label for every status the module has', () =>
    {
        // The dictionary key is built from the status, so a status with no entry is a blank label
        // rather than an error - which is exactly what this catches.
        for (const status of BOND_STATUSES)
        {
            const row = validator({ status });
            expect(validatorTone(row)).toBeTruthy();
            expect(validatorIcon(row)).toBeTruthy();
            expect(validatorState(row)).toBe(`staking.state.${ status }`);
        }
    });
});

describe('voting power', () =>
{
    it('is the validator\'s stake over everything bonded', () =>
    {
        expect(votingPower(validator({ tokens: NURA(250n) }), NURA(1_000n))).toBe(25);
        expect(votingPower(validator({ tokens: NURA(1_000n) }), NURA(1_000n))).toBe(100);
        expect(votingPower(validator({ tokens: '0' }), NURA(1_000n))).toBe(0);
    });

    it('stays exact where a double would round two validators onto one number', () =>
    {
        // Two stakes that differ by a single base unit out of a 27-digit total. As doubles both
        // divisions are the same number; in BigInt the ordering survives, which is the whole
        // point of doing it this way.
        const bonded = (10n ** 27n).toString();
        const low = votingPower(validator({ tokens: (10n ** 26n).toString() }), bonded)!;
        const high = votingPower(validator({ tokens: (10n ** 26n + 10n ** 25n).toString() }), bonded)!;

        expect(low).toBe(10);
        expect(high).toBe(11);
    });

    it('is null rather than zero where the pool was not reported', () =>
    {
        // Nothing to measure against is not the same fact as a weight of nothing, and the page
        // prints neither a bar nor a percentage rather than one drawn against a missing number.
        expect(votingPower(validator(), null)).toBeNull();
        expect(votingPower(validator(), '0')).toBeNull();
    });
});

describe('commission', () =>
{
    it('reads the module\'s eighteen-place fixed point as a percentage', () =>
    {
        expect(commission(validator({ commissionRate: '0.050000000000000000' }))).toBe(5);
        expect(commission(validator({ commissionRate: '0.100000000000000000' }))).toBe(10);
        expect(commission(validator({ commissionRate: '1.000000000000000000' }))).toBe(100);
        expect(commission(validator({ commissionRate: '0.000000000000000000' }))).toBe(0);
    });

    it('reads the ceiling the same way, and never through a float', () =>
    {
        expect(commissionMax(validator({ commissionMaxRate: '0.200000000000000000' }))).toBe(20);
        // 0.1 + 0.2 territory: a rate a double cannot hold exactly still comes back as itself.
        expect(commissionMax(validator({ commissionMaxRate: '0.030000000000000000' }))).toBe(3);
    });
});

describe('one reader\'s totals', () =>
{
    it('sums delegations in base units', () =>
    {
        const rows = [
            { validatorAddress: 'a', shares: '0', balance: { denom: 'anura', amount: NURA(1_000n) } },
            { validatorAddress: 'b', shares: '0', balance: { denom: 'anura', amount: NURA(250n) } }
        ];
        expect(totalDelegated(rows)).toBe(NURA(1_250n));
        expect(totalDelegated([])).toBe('0');
    });

    it('sums amounts no double could hold', () =>
    {
        // Two balances a base unit apart at the top of the uint256 range. Through Number these
        // add to the same thing; a balance an explorer misreports is its one unforgivable bug.
        const big = 10n ** 30n;
        const rows = [
            { validatorAddress: 'a', shares: '0', balance: { denom: 'anura', amount: big.toString() } },
            { validatorAddress: 'b', shares: '0', balance: { denom: 'anura', amount: '1' } }
        ];
        expect(totalDelegated(rows)).toBe((big + 1n).toString());
    });

    it('sums what is on its way back out', () =>
    {
        expect(totalUnbonding([{ balance: NURA(50n) }, { balance: NURA(25n) }])).toBe(NURA(75n));
        expect(totalUnbonding([])).toBe('0');
    });

    it('reads one denom out of a coin list, and treats an absent coin as zero', () =>
    {
        const coins = [{ denom: 'anura', amount: NURA(3n) }, { denom: 'uatom', amount: '77' }];

        expect(amountOf(coins, 'anura')).toBe(NURA(3n));
        expect(amountOf(coins, 'uatom')).toBe('77');
        // Not holding a denom IS holding none of it, so this must be summable rather than null.
        expect(amountOf(coins, 'unknown')).toBe('0');
        expect(amountOf([], 'anura')).toBe('0');
    });
});

describe('the unbonding period', () =>
{
    // It is read through the shared `scaleDuration` rather than a days-only helper of its own: a
    // chain sets this to three weeks and a devnet sets it to five minutes, and `Math.floor(s/86400)`
    // stated every one of the short ones as `0 days`.
    it('is stated in the unit the chain configured it in', () =>
    {
        // 21 days is the Cosmos default, and three weeks is what 21 days is.
        expect(scaleDuration(1_814_400)).toEqual({ unit: 'week', count: 3 });
        expect(scaleDuration(86_400)).toEqual({ unit: 'day', count: 1 });
        expect(scaleDuration(300)).toEqual({ unit: 'minute', count: 5 });
    });

    it('never states the lock as shorter than it is', () =>
    {
        // The one lie that matters here: a reader deciding to unstake is agreeing to this wait.
        expect(scaleDuration(86_399)).toEqual({ unit: 'hour', count: 24 });
        expect(scaleDuration(1)).toEqual({ unit: 'second', count: 1 });
    });
});
