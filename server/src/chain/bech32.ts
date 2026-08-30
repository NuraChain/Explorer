// Bech32, only far enough to turn a Cosmos account address into the EVM one beside it.
//
// A chain with an EVM module has ONE account per key with two spellings: `nura1ftq…` is the same
// twenty bytes as `0x4ac0…`, and governance reports the first while every other page of this
// explorer is keyed on the second. Decoding here is what lets a proposer's name on a proposal be
// a link to their account rather than a string a reader has to convert by hand.
//
// The checksum is verified rather than skipped. These strings arrive from the node and should
// always be sound, but an address that decodes to the WRONG twenty bytes would link a proposal to
// somebody else's account, and that is the one mistake this file could make.

const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';

const GENERATORS = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];

function polymod(values: readonly number[]): number
{
    let checksum = 1;
    for (const value of values)
    {
        const top = checksum >> 25;
        checksum = ((checksum & 0x1ffffff) << 5) ^ value;
        for (let bit = 0; bit < 5; bit++)
        {
            if (((top >> bit) & 1) !== 0)
            {
                checksum ^= GENERATORS[bit]!;
            }
        }
    }
    return checksum;
}

function expand(prefix: string): number[]
{
    const high = [...prefix].map((character) => character.charCodeAt(0) >> 5);
    const low = [...prefix].map((character) => character.charCodeAt(0) & 31);
    return [...high, 0, ...low];
}

/** 5-bit groups back into 8-bit bytes. Returns null when the padding is not what bech32 allows. */
function toBytes(words: readonly number[]): number[] | null
{
    let accumulator = 0;
    let bits = 0;
    const bytes: number[] = [];

    for (const word of words)
    {
        if (word < 0 || word >> 5 !== 0)
        {
            return null;
        }
        accumulator = (accumulator << 5) | word;
        bits += 5;
        while (bits >= 8)
        {
            bits -= 8;
            bytes.push((accumulator >> bits) & 0xff);
        }
    }

    // Whatever is left must be padding: fewer than eight bits, and all of them zero.
    if (bits >= 5 || ((accumulator << (8 - bits)) & 0xff) !== 0)
    {
        return null;
    }
    return bytes;
}

/**
 * A bech32 account address as the twenty bytes it holds, hex-encoded and lower-cased.
 *
 * Null for anything that is not a sound bech32 string of twenty bytes: a bad checksum, a bad
 * character, mixed case, or an address of another length (a validator operator address decodes
 * to twenty bytes too, but a consensus key does not).
 */
export function bech32ToHex(address: string): string | null
{
    if (address !== address.toLowerCase() && address !== address.toUpperCase())
    {
        return null;
    }
    const value = address.toLowerCase();
    const split = value.lastIndexOf('1');
    if (split < 1 || split + 7 > value.length || value.length > 90)
    {
        return null;
    }

    const prefix = value.slice(0, split);
    const words: number[] = [];
    for (const character of value.slice(split + 1))
    {
        const index = CHARSET.indexOf(character);
        if (index === -1)
        {
            return null;
        }
        words.push(index);
    }

    if (polymod([...expand(prefix), ...words]) !== 1)
    {
        return null;
    }

    // The last six words are the checksum, not data.
    const bytes = toBytes(words.slice(0, -6));
    if (bytes === null || bytes.length !== 20)
    {
        return null;
    }
    return `0x${ bytes.map((byte) => byte.toString(16).padStart(2, '0')).join('') }`;
}
