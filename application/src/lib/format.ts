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

/**
 * The one direction that goes the other way: a typed decimal into the smallest unit.
 *
 * For the field where someone says how much native currency to send with a call - so it is the
 * one place in the UI where a person's typing becomes an amount that leaves their wallet. It is
 * string arithmetic end to end: `Number('0.1') * 1e18` is 100000000000000000**0****16**, and
 * nobody notices until the transfer is short.
 *
 * Returns null rather than guessing at anything that is not a plain decimal - a rejected field is
 * a question the reader can answer, an accepted wrong one is money gone.
 */
export function parseAmount(text: string, decimals = 18): string | null
{
    const value = text.trim();
    if (!/^\d+(\.\d*)?$/.test(value))
    {
        return null;
    }
    const [whole = '0', fraction = ''] = value.split('.');
    if (fraction.length > decimals)
    {
        // Truncating here would silently send a different amount than the one on the screen.
        return null;
    }
    return `${ BigInt(whole) }${ fraction.padEnd(decimals, '0') }`.replace(/^0+(?=\d)/, '');
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

/**
 * Whole numbers with thousands separators, in the reader's digits.
 *
 * This is for PROSE numbers - a count of blocks, a page number. Chain amounts go through
 * formatAmount and stay in Latin digits: they sit inside `.data`, which is forced to LTR, and a
 * balance a reader cannot paste back into another tool is not doing its job.
 */
export function formatCount(value: number, tag = 'en-US'): string
{
    return value.toLocaleString(tag);
}

export type ElapsedUnit = 'justNow' | 'second' | 'minute' | 'hour' | 'day';

const UNITS: ReadonlyArray<[limit: number, seconds: number, unit: ElapsedUnit]> = [
    [60, 1, 'second'],
    [3600, 60, 'minute'],
    [86_400, 3600, 'hour'],
    [2_592_000, 86_400, 'day']
];

/**
 * How long ago, as a unit and a count. The WORDING lives in the message catalog - blocks arrive
 * every few seconds, so this is the most-read string in the explorer and it has to read naturally
 * in each language rather than being assembled from an English template.
 */
export function elapsed(iso: string, now = Date.now()): { unit: ElapsedUnit; count: number }
{
    const seconds = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 1000));
    if (seconds < 5)
    {
        return { unit: 'justNow', count: 0 };
    }
    for (const [limit, size, unit] of UNITS)
    {
        if (seconds < limit)
        {
            return { unit, count: Math.floor(seconds / size) };
        }
    }
    return { unit: 'day', count: Math.floor(seconds / 86_400) };
}

/** An absolute timestamp, for detail pages where the exact moment matters. */
export function formatDateTime(iso: string, tag = 'en-US'): string
{
    return new Date(iso).toLocaleString(tag, {
        year: 'numeric', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
}

/** Bytes scaled to the unit they should be shown in; the unit's name is in the catalog. */
export function scaleBytes(bytes: number): { unit: 'bytes' | 'kilobytes'; count: number }
{
    return bytes < 1024
        ? { unit: 'bytes', count: bytes }
        : { unit: 'kilobytes', count: bytes / 1024 };
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
