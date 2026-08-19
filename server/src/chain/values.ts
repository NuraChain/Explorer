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

/**
 * A struct argument, from the JSON a reader typed into the field.
 *
 * Only reachable for a VERIFIED contract: a struct is `tuple` in the ABI with its fields hanging
 * off `components`, and the built-in table of published signatures holds strings, which cannot
 * carry components. So this path exists exactly where the ABI does.
 *
 * Positional JSON - `["0xabc...", "5"]` - because the field names in an ABI are optional and a
 * contract compiled without them would have no keys to match against. Every leaf still goes
 * through {@link coerce}, so a wrong address inside a struct is refused the same way as one
 * outside it.
 */
function coerceTuple(parameter: AbiParameter, value: unknown, at: number): unknown
{
    const components = 'components' in parameter && Array.isArray(parameter.components) ? parameter.components : [];
    const suffix = parameter.type.slice('tuple'.length);

    if (suffix !== '')
    {
        if (!Array.isArray(value))
        {
            throw new ArgumentError(at, 'expected a JSON list');
        }
        // The LAST bracket is the outermost dimension: `tuple[2][]` is a list of `tuple[2]`.
        const element = { ...parameter, type: `tuple${ suffix.replace(/\[[^\]]*\]$/, '') }` } as AbiParameter;
        return value.map((entry) => coerceTuple(element, entry, at));
    }

    if (!Array.isArray(value) || value.length !== components.length)
    {
        throw new ArgumentError(at, `expected a JSON list of ${ components.length } values`);
    }
    return components.map((component, index) =>
    {
        const field = value[index];
        return component.type.startsWith('tuple')
            ? coerceTuple(component, field, at)
            : coerce(component.type, typeof field === 'string' ? field : JSON.stringify(field), at);
    });
}

/** One field's text as the value its ABI parameter means - structs included. */
function coerceParameter(parameter: AbiParameter, text: string, at: number): unknown
{
    if (!parameter.type.startsWith('tuple'))
    {
        return coerce(parameter.type, text, at);
    }
    try
    {
        return coerceTuple(parameter, JSON.parse(text.trim() === '' ? 'null' : text) as unknown, at);
    }
    catch (error)
    {
        throw error instanceof ArgumentError ? error : new ArgumentError(at, 'expected JSON');
    }
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

/**
 * A comma-separated type list, split at the TOP level only.
 *
 * A tuple carries its own commas - `(address,bool,bytes)[]` is one type, not three - so a plain
 * `split(',')` turns one argument into three, which the page draws as three fields and the
 * encoder then refuses for having the wrong number of arguments.
 */
export function splitTypes(list: string): string[]
{
    if (list === '')
    {
        return [];
    }

    const out: string[] = [];
    let depth = 0;
    let start = 0;
    for (let at = 0; at < list.length; at++)
    {
        const character = list[at];
        if (character === '(')
        {
            depth++;
        }
        else if (character === ')')
        {
            depth--;
        }
        else if (character === ',' && depth === 0)
        {
            out.push(list.slice(start, at));
            start = at + 1;
        }
    }
    out.push(list.slice(start));
    return out;
}

/**
 * A type as WRITTEN in a signature, back into the parameter viem encodes from.
 *
 * `(address,bool,bytes)[]` is how a signature spells a list of structs, and it is the only spelling
 * a table of published signatures can hold - there is nowhere in a string to put a component list.
 * Reading it back is what lets the table describe the same shapes a verified ABI can, instead of
 * naming a function it then cannot call.
 */
export function parseType(type: string): AbiParameter
{
    const trimmed = type.trim();
    if (!trimmed.startsWith('('))
    {
        return { type: trimmed };
    }

    let depth = 0;
    let close = -1;
    for (let at = 0; at < trimmed.length; at++)
    {
        if (trimmed[at] === '(')
        {
            depth++;
        }
        else if (trimmed[at] === ')')
        {
            depth--;
            if (depth === 0)
            {
                close = at;
                break;
            }
        }
    }
    if (close === -1)
    {
        // Unbalanced. Left as it is, so the encoder refuses it by name rather than this function
        // inventing a shape nobody wrote.
        return { type: trimmed };
    }

    // The array suffix rides OUTSIDE the parentheses: `(address,uint256)[2][]` is a list of pairs.
    return {
        type: `tuple${ trimmed.slice(close + 1) }`,
        components: splitTypes(trimmed.slice(1, close)).map(parseType)
    };
}

function parameters(types: readonly string[]): AbiParameter[]
{
    return types.map(parseType);
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
    // The ABI's own parameters where a verified contract supplied them, the printed types
    // otherwise. They agree on everything except structs, which only the first form can express.
    const declared = entry.inputParams ?? parameters(entry.inputs);
    const values = declared.map((parameter, at) => coerceParameter(parameter, args[at] ?? '', at));
    const encoded = declared.length === 0
        ? '0x'
        : encodeAbiParameters(declared, values);
    return `${ entry.selector }${ encoded.slice(2) }`;
}

/**
 * Return data as one entry per declared output; empty when the function returns nothing.
 *
 * `outputs` labels the rows and `declared` decodes them. They are the same thing for every
 * published signature, and differ only where a verified ABI returns a struct: `(address,uint256)`
 * is what a reader should see, and it is not something viem can decode - the components are.
 */
export function decodeReturn(
    outputs: readonly string[],
    data: string,
    declared?: readonly AbiParameter[]
): Array<{ type: string; value: string }>
{
    if (outputs.length === 0 || data === '0x' || data === '')
    {
        return [];
    }
    const decoded = decodeAbiParameters(declared ?? parameters(outputs), data as `0x${ string }`);
    return outputs.map((type, at) => ({ type, value: stringify(decoded[at]) }));
}
