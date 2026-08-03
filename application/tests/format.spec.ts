// @vitest-environment node
//
// lib/format.ts is the highest-risk code in the explorer: every number a reader sees passes
// through it, and the inputs are uint256 values that do not survive a double. An explorer that
// misreports a balance has failed at its only job, so the arithmetic is pinned here.
import { describe, it, expect } from 'vitest';

import { formatAmount, formatBytes, formatCount, formatGwei, formatValue, gasShare, shortHash, timeAgo } from '../src/lib/format.ts';

describe('formatAmount - wei to a readable decimal', () =>
{
    it('renders whole units with thousands separators', () =>
    {
        expect(formatAmount('1000000000000000000')).toBe('1');
        expect(formatAmount('12500000000000000000')).toBe('12.5');
        expect(formatAmount('9977374153208515942450')).toBe('9,977.3741');
    });

    it('survives a full uint256 without losing precision', () =>
    {
        // 2^256-1 wei. Through a double this rounds to 1.157920892373162e+59 and the integer
        // part comes back wrong; the bigint path keeps every digit.
        const max = (2n ** 256n - 1n).toString();
        expect(formatAmount(max)).toBe('115,792,089,237,316,195,423,570,985,008,687,907,853,269,984,665,640,564,039,457.584');
    });

    it('keeps four SIGNIFICANT digits below one unit, so dust is never "0"', () =>
    {
        // A real transfer that reads as zero is a lie, however small it is.
        expect(formatAmount('1000000000000')).toBe('0.000001');
        expect(formatAmount('12340000000000')).toBe('0.00001234');
        expect(formatAmount('1')).toBe('0.000000000000000001');
    });

    it('renders exact zero as zero', () =>
    {
        expect(formatAmount('0')).toBe('0');
    });

    it('honours a token\'s own decimals', () =>
    {
        expect(formatAmount('1500000', 6)).toBe('1.5');
        expect(formatAmount('42', 0)).toBe('42');
    });

    it('carries a negative sign through', () =>
    {
        expect(formatAmount('-2500000000000000000')).toBe('-2.5');
    });
});

describe('formatValue / formatGwei', () =>
{
    it('appends the chain\'s symbol', () =>
    {
        expect(formatValue('1000000000000000000', 'ETH')).toBe('1 ETH');
        expect(formatValue('500000000', 'NURA', 8)).toBe('5 NURA');
    });

    it('reads gas prices in gwei, the unit people compare', () =>
    {
        expect(formatGwei('1000000000')).toBe('1 gwei');
        expect(formatGwei('230923178')).toBe('0.2309 gwei');
    });
});

describe('gasShare - a ratio of two uint256s', () =>
{
    it('scales through bigint, so enormous operands still give a usable fraction', () =>
    {
        expect(gasShare('50000', '100000')).toBeCloseTo(0.5, 6);
        expect(gasShare('21000', '100000000')).toBeCloseTo(0.00021, 6);
        const huge = (10n ** 30n).toString();
        expect(gasShare(huge, (10n ** 31n).toString())).toBeCloseTo(0.1, 6);
    });

    it('a zero limit is 0, not a division by zero', () =>
    {
        expect(gasShare('100', '0')).toBe(0);
    });
});

describe('shortHash', () =>
{
    it('keeps both ends so a value stays recognisable', () =>
    {
        expect(shortHash('0x568a83abde34d2c2409e17449d274fc3c15af77052252b1bd49a409e7fcd2389'))
            .toBe('0x568a83ab…7fcd2389');
    });

    it('leaves a value short enough to show alone', () =>
    {
        expect(shortHash('0x1234')).toBe('0x1234');
    });
});

describe('timeAgo', () =>
{
    const now = Date.parse('2026-08-03T12:00:00.000Z');
    const ago = (seconds: number): string => timeAgo(new Date(now - seconds * 1000).toISOString(), now);

    it('names the unit and pluralises it', () =>
    {
        expect(ago(1)).toBe('just now');
        expect(ago(30)).toBe('30 seconds ago');
        expect(ago(60)).toBe('1 minute ago');
        expect(ago(120)).toBe('2 minutes ago');
        expect(ago(3600)).toBe('1 hour ago');
        expect(ago(86_400)).toBe('1 day ago');
    });

    it('never reports the future as elapsed', () =>
    {
        // A block timestamp a second ahead of the reader's clock is routine; "-1 seconds ago"
        // is not something an explorer should ever print.
        expect(timeAgo(new Date(now + 5000).toISOString(), now)).toBe('just now');
    });
});

describe('formatCount / formatBytes', () =>
{
    it('separates thousands and scales bytes', () =>
    {
        expect(formatCount(1234567)).toBe('1,234,567');
        expect(formatBytes(512)).toBe('512 B');
        expect(formatBytes(2048)).toBe('2.0 KB');
    });
});
