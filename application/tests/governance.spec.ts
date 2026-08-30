// The arithmetic behind a tally. Voting power is a uint256 and the module's shares are eighteen
// places of fixed point, so everything below is worked out in BigInt and only divided down to a
// percentage at the end - the same rule format.ts follows for amounts, and for the same reason.
import { describe, it, expect } from 'vitest';

import {
    isActionable,
    majority,
    PROPOSAL_ICON,
    PROPOSAL_TONE,
    ratio,
    share,
    totalCast,
    turnout,
    vetoShare,
    VOTE_CODE,
    VOTE_OPTIONS
} from '../src/lib/governance.ts';
import { PROPOSAL_STATUSES } from '../../server/src/schemas.ts';

const POWER = 10n ** 18n;

const tally = (yes: bigint, abstain: bigint, no: bigint, veto: bigint): {
    yes: string; abstain: string; no: string; noWithVeto: string;
} => ({ yes: yes.toString(), abstain: abstain.toString(), no: no.toString(), noWithVeto: veto.toString() });

describe('share', () =>
{
    it('is a percentage to two places', () =>
    {
        expect(share(1n, 4n)).toBe(25);
        expect(share(1n, 3n)).toBe(33.33);
    });

    it('answers zero rather than dividing by nothing', () =>
    {
        expect(share(0n, 0n)).toBe(0);
        expect(share(5n, 0n)).toBe(0);
    });

    it('stays exact where a double has already run out of digits', () =>
    {
        expect(share(10n ** 30n, 3n * 10n ** 30n)).toBe(33.33);
        expect(share(2n ** 200n, 2n ** 201n)).toBe(50);
    });
});

describe('ratio', () =>
{
    it('reads the module\'s eighteen-place fixed point as a percentage', () =>
    {
        expect(ratio('0.334000000000000000')).toBe(33.4);
        expect(ratio('0.500000000000000000')).toBe(50);
        expect(ratio('1.000000000000000000')).toBe(100);
    });

    it('cuts the string rather than parsing a float', () =>
    {
        // A weight of one, written the way the module writes it, is exactly 100% - not 99.99…
        expect(ratio('1.000000000000000001')).toBe(100);
        expect(ratio('0')).toBe(0);
        expect(ratio('0.1')).toBe(10);
    });
});

describe('a tally', () =>
{
    it('counts every option towards what was cast', () =>
    {
        expect(totalCast(tally(4n * POWER, 3n * POWER, 2n * POWER, POWER))).toBe(10n * POWER);
    });

    it('leaves abstentions OUT of the majority, as the module does', () =>
    {
        // 6 yes, 3 no, 1 veto: nine votes decided it, and six of them said yes.
        const votes = tally(6n * POWER, 90n * POWER, 3n * POWER, POWER);
        expect(majority(votes)).toBe(60);
        // Turnout is another question entirely - the ninety abstentions count towards quorum.
        expect(totalCast(votes)).toBe(100n * POWER);
    });

    it('measures a veto against everything cast, abstentions included', () =>
    {
        expect(vetoShare(tally(5n * POWER, 3n * POWER, POWER, POWER))).toBe(10);
    });

    it('holds a majority that no double could tell apart', () =>
    {
        const half = 10n ** 27n;
        expect(majority(tally(half + 1n, 0n, half, 0n))).toBe(50);
        expect(majority(tally(2n * half, 0n, half, 0n))).toBe(66.66);
    });
});

describe('turnout', () =>
{
    it('measures everything cast against the staked supply, abstentions included', () =>
    {
        // Abstaining IS attending: a Cosmos quorum counts it, which is the whole point of the
        // option existing separately from not voting at all.
        expect(turnout(tally(10n * POWER, 10n * POWER, 5n * POWER, 5n * POWER), (100n * POWER).toString())).toBe(30);
    });

    it('has no answer where the node did not report the staked supply', () =>
    {
        // Null, not zero. A quorum of nothing would read as a vote nobody attended, and that is a
        // claim about the chain rather than about what this node was able to say.
        expect(turnout(tally(POWER, 0n, 0n, 0n), null)).toBe(null);
        expect(turnout(tally(POWER, 0n, 0n, 0n), '0')).toBe(null);
    });

    it('holds a supply no double could count', () =>
    {
        const bonded = 3n * 10n ** 30n;
        expect(turnout(tally(10n ** 30n, 0n, 0n, 0n), bonded.toString())).toBe(33.33);
    });
});

describe('the vocabulary the module fixed', () =>
{
    it('numbers the vote options the way `vote()` takes them', () =>
    {
        // The precompile's third argument IS this number: yes is 1, and an explorer that sent 0
        // would cast an unspecified vote in somebody's name.
        expect(VOTE_CODE.yes).toBe(1);
        expect(VOTE_CODE.abstain).toBe(2);
        expect(VOTE_CODE.no).toBe(3);
        expect(VOTE_CODE.noWithVeto).toBe(4);
    });

    it('offers the four a reader can actually cast', () =>
    {
        expect(VOTE_OPTIONS).toEqual(['yes', 'abstain', 'no', 'noWithVeto']);
    });

    it('dresses every state the wire can carry', () =>
    {
        // A state with no tone renders an unstyled badge; one with no icon renders a question
        // mark. Both are silent failures, so the maps are checked against the source.
        for (const status of PROPOSAL_STATUSES)
        {
            expect(PROPOSAL_TONE[status], `tone for ${ status }`).toBeDefined();
            expect(PROPOSAL_ICON[status], `icon for ${ status }`).toBeDefined();
        }
    });

    it('offers an action only while a proposal can still take one', () =>
    {
        expect(PROPOSAL_STATUSES.filter(isActionable)).toEqual(['deposit', 'voting']);
    });
});
