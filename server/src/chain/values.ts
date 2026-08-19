import { decodeAbiParameters, encodeAbiParameters, type AbiParameter } from 'viem';

import type { KnownFunction } from './signatures.ts';

// The two directions an argument travels: what someone typed into a field, and what came back
// from the EVM.
//
// Both are TEXT at this boundary, and deliberately so. A uint256 does not survive a double, and
// the browser must never have to hold one as a number to send it - so a field's contents cross as
// the string they are, are turned into the ABI's own value here, and come back as a string again.
//
// Nothing here reaches the chain. It is bytes in, bytes out, which is what makes the whole
// encoding path testable without a node.

/** A rejected argument, named by the position the reader can see. Never a stack trace. */
export class ArgumentError extends Error
{
    public readonly at: number;

    constructor(at: number, message: string)
    {
        super(message);
        this.name = 'ArgumentError';
        this.at = at;
    }
}

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const HEX = /^0x[0-9a-fA-F]*$/;
const INTEGER = /^-?\d+$/;

/**
 * One field's text as the value its type means.
 *
 * Strict on purpose. A wrong address silently accepted here becomes a transaction someone signs,
 * and "0x0" padded into twenty bytes is a real address that belongs to nobody - so every shape
 * is checked, and anything that does not fit is refused by name rather than coerced into
 * something that encodes.
 */
export function coerce(type: string, text: string, at = 0): unknown
{
    const value = text.trim();

    if (type.endsWith('[]'))
    {
        const inner = type.slice(0, -2);
        const body = value.startsWith('[') && value.endsWith(']') ? value.slice(1, -1) : value;
        if (body.trim() === '')
        {
            return [];
        }
        // Comma-separated, with or without the brackets - both are how people write a list, and
        // neither is worth refusing. Quotes are stripped so a pasted JSON array works too.
        return body.split(',').map((entry) => coerce(inner, entry.trim().replace(/^["']|["']$/g, ''), at));
    }

    if (type === 'address')
    {
        if (!ADDRESS.test(value))
        {
            throw new ArgumentError(at, 'expected a 20-byte address');
        }
        return value;
    }

    if (type === 'bool')
    {
        const lowered = value.toLowerCase();
        if (lowered === 'true' || lowered === '1')
        {
            return true;
        }
        if (lowered === 'false' || lowered === '0')
        {
            return false;
        }
        throw new ArgumentError(at, 'expected true or false');
    }

    if (type === 'string')
    {
        // NOT trimmed: a string argument is data, and its spaces are the caller's business.
        return text;
    }

    if (type.startsWith('uint') || type.startsWith('int'))
    {
        if (!INTEGER.test(value) && !HEX.test(value))
        {
            throw new ArgumentError(at, 'expected a whole number');
        }
        try
        {
            const parsed = BigInt(value);
            if (type.startsWith('uint') && parsed < 0n)
            {
                throw new ArgumentError(at, 'expected a number of zero or more');
            }
            return parsed;
        }
        catch (error)
        {
            throw error instanceof ArgumentError ? error : new ArgumentError(at, 'expected a whole number');
        }
    }

    if (type.startsWith('bytes'))
    {
        if (!HEX.test(value))
        {
            throw new ArgumentError(at, 'expected hex, starting 0x');
        }
        // The width, and ONLY when the type names one. `'bytes'.slice(5)` is '', and `Number('')`
        // is 0 - so a plain dynamic `bytes` used to be checked as `bytes0` and every non-empty
        // value was refused for not being exactly zero bytes long.
        const suffix = type.slice(5);
        const width = Number(suffix);
        // A fixed-width bytesN is padded by the encoder, and a value that is too SHORT would be
        // padded into a different value than the one that was typed.
        if (suffix !== '' && Number.isInteger(width) && value.length !== 2 + width * 2)
        {
            throw new ArgumentError(at, `expected exactly ${ width } bytes`);
        }
        return value;
    }

    throw new ArgumentError(at, `this explorer cannot encode a ${ type }`);
}

/** An EVM value as text. Amounts stay whole - see the note at the top of this file. */
export function stringify(value: unknown): string
{
    if (typeof value === 'bigint')
    {
        return value.toString();
    }
    if (typeof value === 'boolean')
    {
        return value ? 'true' : 'false';
    }
    if (Array.isArray(value))
    {
        return value.map(stringify).join(', ');
    }
    if (typeof value === 'object' && value !== null)
    {
        // A tuple. Printed as its parts rather than as [object Object].
        return Object.values(value).map(stringify).join(', ');
    }
    return String(value);
}

function parameters(types: readonly string[]): AbiParameter[]
{
    return types.map((type) => ({ type }));
}

/**
 * The calldata for one call: the four selector bytes, then the arguments packed behind them.
 *
 * This is the whole of what a wallet needs to be handed. The explorer never signs and never
 * sends - it says what the bytes are, and the wallet decides with its owner what to do with them.
 */
export function encodeCall(entry: KnownFunction, args: readonly string[]): string
{
    if (args.length !== entry.inputs.length)
    {
        throw new ArgumentError(args.length, `${ entry.name } takes ${ entry.inputs.length } arguments`);
    }
    const values = entry.inputs.map((type, at) => coerce(type, args[at] ?? '', at));
    const encoded = entry.inputs.length === 0
        ? '0x'
        : encodeAbiParameters(parameters(entry.inputs), values);
    return `${ entry.selector }${ encoded.slice(2) }`;
}

/** Return data as one entry per declared output; empty when the function returns nothing. */
export function decodeReturn(outputs: readonly string[], data: string): Array<{ type: string; value: string }>
{
    if (outputs.length === 0 || data === '0x' || data === '')
    {
        return [];
    }
    const decoded = decodeAbiParameters(parameters(outputs), data as `0x${ string }`);
    return outputs.map((type, at) => ({ type, value: stringify(decoded[at]) }));
}
