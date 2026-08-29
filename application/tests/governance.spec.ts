// The arithmetic behind a tally. A vote weight is a uint256, so every share below is worked out
// in BigInt and only divided down to a percentage at the very end - the same rule format.ts
// follows for amounts, and for the same reason: a double cannot hold what a governor counts.
import { describe, it, expect } from 'vitest';

import {
    isActionable,
    PROPOSAL_ICON,
    PROPOSAL_TONE,
    quorumShare,
    share,
    SUPPORT,
    supportOf,
    totalCast
} from '../src/lib/governance.ts';
import { PROPOSAL_STATES } from '../../server/src/schemas.ts';

const ONE = 10n ** 18n;

describe('share', () =>
{
    it('is a percentage to two places', () =>
    {
        expect(share(1n, 4n)).toBe(25);
        expect(share(1n, 3n)).toBe(33.33);
        expect(share(2n, 3n)).toBe(66.66);
    });

    it('answers zero rather than dividing by nothing', () =>
    {
        expect(share(0n, 0n)).toBe(0);
        expect(share(5n, 0n)).toBe(0);
    });

    it('stays exact where a double has already run out of digits', () =>
    {
        // Thirty digits and two hundred bits: the ratio is worked out before anything becomes a
        // Number, so these are the same answers the small cases give.
        expect(share(10n ** 30n, 3n * 10n ** 30n)).toBe(33.33);
        expect(share(2n ** 200n, 2n ** 201n)).toBe(50);
    });

    it('is a reading and not a verdict - two places is all it claims', () =>
    {
        // One wei over half of a 27-digit whole is still 50.00% on screen, and that is correct:
        // the DECISION belongs to the governor's own counting, which compares whole uint256s
        // (see proposalStatus on the server). A percentage is what a reader is shown.
        const half = 10n ** 27n;
        expect(share(half + 1n, 2n * half)).toBe(50);
        expect(share(51n, 100n)).toBe(51);
    });
});

describe('totalCast', () =>
{
    it('adds the three sides without going through a double', () =>
    {
        const tally = {
            forVotes: (2n ** 200n).toString(),
            againstVotes: '1',
            abstainVotes: '2'
        };
        expect(totalCast(tally)).toBe(2n ** 200n + 3n);
    });
});

describe('quorumShare', () =>
{
    const tally = (over: Partial<{ forVotes: string; abstainVotes: string; quorum: string | null }> = {}) =>
        ({ forVotes: (3n * ONE).toString(), abstainVotes: ONE.toString(), quorum: (8n * ONE).toString(), ...over });

    it('counts for AND abstain towards the quorum, the way GovernorCountingSimple does', () =>
    {
        // 3 for + 1 abstain against a quorum of 8 is half way there - the against side is not
        // part of this reading at all.
        expect(quorumShare(tally())).toBe(50);
    });

    it('can pass 100, because a quorum is a floor and not a ceiling', () =>
    {
        expect(quorumShare(tally({ quorum: (2n * ONE).toString() }))).toBe(200);
    });

    it('is null when the governor would not say what the quorum was', () =>
    {
        // A progress bar against an unknown target is a picture of nothing.
        expect(quorumShare(tally({ quorum: null }))).toBeNull();
    });

    it('treats a quorum of zero as reached rather than dividing by it', () =>
    {
        expect(quorumShare(tally({ quorum: '0' }))).toBe(100);
    });
});

describe('the ballot vocabulary', () =>
{
    it('names support in the order the standard numbered it', () =>
    {
        expect(SUPPORT).toEqual(['against', 'for', 'abstain']);
        expect(supportOf(0)).toBe('against');
        expect(supportOf(1)).toBe('for');
        expect(supportOf(2)).toBe('abstain');
    });

    it('answers null for a governor that counts some other way', () =>
    {
        // Fractional voting uses 255. It is a real ballot and it is not one of these three.
        expect(supportOf(255)).toBeNull();
        expect(supportOf(7)).toBeNull();
    });
});

describe('the state vocabulary', () =>
{
    it('dresses every state the wire can carry', () =>
    {
        // A state with no tone renders an unstyled badge; one with no icon renders the fallback
        // question mark. Both are silent failures, so the maps are checked against the source.
        for (const state of PROPOSAL_STATES)
        {
            expect(PROPOSAL_TONE[state], `tone for ${ state }`).toBeDefined();
            expect(PROPOSAL_ICON[state], `icon for ${ state }`).toBeDefined();
        }
    });

    it('offers an action only where the chain has one left to take', () =>
    {
        expect(PROPOSAL_STATES.filter(isActionable)).toEqual(['active', 'succeeded', 'queued']);
    });
});
