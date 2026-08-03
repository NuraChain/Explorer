// Every number a reader sees is formatted here, once. Chain amounts arrive as decimal strings of
// the smallest unit and are divided with BigInt arithmetic - a uint256 through a double silently
// loses precision, and an explorer that misreports a balance has failed at its only job.

/** Splits a wei-scale integer string into whole and fractional parts at `decimals`. */
function split(amount: string, decimals: number): { whole: bigint; fraction: string; negative: boolean }
{
    const negative = amount.startsWith('-');
    const digits = (negative ? amount.slice(1) : amount).padStart(decimals + 1, '0');
    const cut = digits.length - decimals;
    return {
        whole: BigInt(digits.slice(0, cut)),
        fraction: decimals === 0 ? '' : digits.slice(cut),
        negative
    };
}

/**
 * A chain amount as a readable decimal. Significant digits scale with magnitude: whole coins get
 * four places, dust gets enough to stay distinguishable from zero - "0 ETH" for a real transfer
 * is a lie, however small the transfer.
 */
export function formatAmount(amount: string, decimals = 18, maxFraction = 4): string
{
    const { whole, fraction, negative } = split(amount, decimals);
    const sign = negative ? '-' : '';

    if (whole > 0n || fraction === '')
    {
        const trimmed = fraction.slice(0, maxFraction).replace(/0+$/, '');
        return `${ sign }${ whole.toLocaleString('en-US') }${ trimmed === '' ? '' : `.${ trimmed }` }`;
    }

    // Below one whole unit: keep going until four significant digits have appeared, so 0.00001234
    // survives instead of rounding to nothing.
    const lead = fraction.search(/[1-9]/);
    if (lead === -1)
    {
        return `${ sign }0`;
    }
    const trimmed = fraction.slice(0, lead + 4).replace(/0+$/, '');
    return `${ sign }0.${ trimmed }`;
}

/** An amount with its unit, e.g. `1.25 ETH`. */
export function formatValue(amount: string, symbol: string, decimals = 18): string
{
    return `${ formatAmount(amount, decimals) } ${ symbol }`;
}

/** Gwei, for gas prices - the unit people actually compare them in. */
export function formatGwei(wei: string): string
{
    return `${ formatAmount(wei, 9, 2) } gwei`;
}

/** `0x1234…abcd` - long enough to recognise, short enough to sit in a table. */
export function shortHash(value: string, lead = 10, tail = 8): string
{
    return value.length <= lead + tail ? value : `${ value.slice(0, lead) }…${ value.slice(-tail) }`;
}

/** Whole numbers with thousands separators. */
export function formatCount(value: number): string
{
    return value.toLocaleString('en-US');
}

const UNITS: ReadonlyArray<[limit: number, seconds: number, name: string]> = [
    [60, 1, 'second'],
    [3600, 60, 'minute'],
    [86_400, 3600, 'hour'],
    [2_592_000, 86_400, 'day']
];

/**
 * How long ago, in words. Blocks arrive every few seconds, so "12 seconds ago" is the common
 * case and the one that must read naturally.
 */
export function timeAgo(iso: string, now = Date.now()): string
{
    const elapsed = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 1000));
    if (elapsed < 5)
    {
        return 'just now';
    }
    for (const [limit, seconds, name] of UNITS)
    {
        if (elapsed < limit)
        {
            const count = Math.floor(elapsed / seconds);
            return `${ count } ${ name }${ count === 1 ? '' : 's' } ago`;
        }
    }
    const days = Math.floor(elapsed / 86_400);
    return `${ days } days ago`;
}

/** An absolute timestamp, for detail pages where the exact moment matters. */
export function formatDateTime(iso: string): string
{
    return new Date(iso).toLocaleString('en-US', {
        year: 'numeric', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
}

/** Bytes, for calldata and block sizes. */
export function formatBytes(bytes: number): string
{
    if (bytes < 1024)
    {
        return `${ bytes } B`;
    }
    return `${ (bytes / 1024).toFixed(1) } KB`;
}

/** Gas used as a share of the limit, for the fill bar on a block. */
export function gasShare(used: string, limit: string): number
{
    const cap = BigInt(limit);
    if (cap === 0n)
    {
        return 0;
    }
    // Scaled before the double conversion so the ratio never loses precision even when both
    // operands are enormous. The scale sets the resolution: basis points floored a 0.021% block
    // to 0.02%, so it carries two more digits than any display needs.
    return Number((BigInt(used) * 1_000_000n) / cap) / 1_000_000;
}
