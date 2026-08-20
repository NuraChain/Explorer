// @vitest-environment node
//
// chain/values.ts is the encoding boundary: text a reader typed into a field, out as the calldata
// a WALLET WILL SIGN. Nothing downstream re-checks it, so every refusal this file makes is the
// last chance to catch a value that would otherwise become a transaction against the wrong
// account, the wrong amount, or the wrong bytes.
//
// That is why the tests below lean on refusals and on round-trips rather than on happy paths: a
// value that encodes is only correct if decoding it gives back what was typed.
import { describe, it, expect } from 'vitest';
import { decodeAbiParameters, encodeAbiParameters } from 'viem';

import { ArgumentError, coerce, decodeReturn, encodeCall, parseType, splitTypes, stringify } from '../src/chain/values.ts';
import type { KnownFunction } from '../src/chain/signatures.ts';

const ALICE = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

/** A signature table entry, built for one test. */
function fn(inputs: string[], outputs: string[] = []): KnownFunction
{
    return {
        selector: '0xaabbccdd',
        signature: `f(${ inputs.join(',') })`,
        name: 'f',
        inputs,
        outputs,
        mutability: 'nonpayable'
    };
}

/**
 * A decoded value in the same shape `coerce` produces, so the two can be compared.
 *
 * viem hands back an EIP-55 CHECKSUMMED address and decodes any integer narrow enough to fit a
 * double as a `number`. Neither is a disagreement about the value - `0xAbC…` and `0xabc…` are the
 * same address, and 0 is 0 - so normalising here keeps the round-trip assertions about the VALUE
 * rather than about viem's return types. Keyed on the declared type: a `string` argument must not
 * be case-folded, because for a string the case IS the value.
 */
function canonical(type: string, value: unknown): unknown
{
    if (type.endsWith('[]'))
    {
        return (value as unknown[]).map((entry) => canonical(type.slice(0, -2), entry));
    }
    if (type.startsWith('('))
    {
        const fields = splitTypes(type.slice(1, type.lastIndexOf(')')));
        return (value as unknown[]).map((entry, at) => canonical(fields[at] ?? '', entry));
    }
    if (type === 'address')
    {
        return String(value).toLowerCase();
    }
    if (type.startsWith('uint') || type.startsWith('int'))
    {
        return BigInt(value as bigint);
    }
    return value;
}

/** The arguments of an encoded call, decoded back with viem as an independent witness. */
function decodeArgs(types: string[], calldata: string): readonly unknown[]
{
    const decoded = decodeAbiParameters(types.map((type) => parseType(type)), `0x${ calldata.slice(10) }`);
    return decoded.map((value, at) => canonical(types[at]!, value));
}

/** Asserts that `work` refuses, and that it refuses as an ArgumentError naming a position. */
function refuses(work: () => unknown, at?: number): ArgumentError
{
    let caught: unknown;
    try
    {
        work();
    }
    catch (error)
    {
        caught = error;
    }
    // Not `toThrow`: the TYPE is the contract. inspect.ts turns an ArgumentError into a 400 that
    // names the field and rethrows anything else as a 500, so the wrong class here is a wrong
    // status code for the reader.
    expect(caught).toBeInstanceOf(ArgumentError);
    if (at !== undefined)
    {
        expect((caught as ArgumentError).at).toBe(at);
    }
    return caught as ArgumentError;
}

describe('coerce - address', () =>
{
    it('takes a 20-byte address in either case', () =>
    {
        expect(coerce('address', ALICE)).toBe(ALICE);
        expect(coerce('address', ALICE.toUpperCase().replace('0X', '0x'))).toBe(ALICE.toUpperCase().replace('0X', '0x'));
    });

    it('trims surrounding whitespace, which a paste carries', () =>
    {
        expect(coerce('address', `  ${ ALICE }\n`)).toBe(ALICE);
    });

    it.each([
        ['too short', '0x123'],
        ['too long', `${ ALICE }aa`],
        ['no 0x prefix', ALICE.slice(2)],
        ['not hex', '0xzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz'],
        ['empty', ''],
        ['the word null', 'null'],
        ['a bare zero', '0x0']
    ])('refuses an address that is %s', (_label, value) =>
    {
        // `0x0` is the one that matters most: padded to twenty bytes it is a real address that
        // belongs to nobody, and accepting it sends value nowhere recoverable.
        refuses(() => coerce('address', value));
    });
});

describe('coerce - bool', () =>
{
    it.each([['true', true], ['TRUE', true], ['1', true], ['false', false], ['False', false], ['0', false]])(
        'reads %s as %s', (text, expected) =>
        {
            expect(coerce('bool', text)).toBe(expected);
        });

    it.each(['yes', 'no', '2', '', 'null', '-1'])('refuses %s rather than guessing', (value) =>
    {
        refuses(() => coerce('bool', value));
    });
});

describe('coerce - integers', () =>
{
    it('reads decimal and hex alike', () =>
    {
        expect(coerce('uint256', '1000')).toBe(1000n);
        expect(coerce('uint256', '0x10')).toBe(16n);
        expect(coerce('int256', '-42')).toBe(-42n);
    });

    it('carries a full uint256 without losing a digit', () =>
    {
        const max = (1n << 256n) - 1n;
        expect(coerce('uint256', max.toString())).toBe(max);
    });

    it('holds the exact boundary of every width', () =>
    {
        for (const width of [8, 16, 32, 64, 128, 256])
        {
            const top = (1n << BigInt(width)) - 1n;
            expect(coerce(`uint${ width }`, top.toString())).toBe(top);
            expect(coerce(`uint${ width }`, '0')).toBe(0n);

            const signedTop = (1n << BigInt(width - 1)) - 1n;
            const signedBottom = -(1n << BigInt(width - 1));
            expect(coerce(`int${ width }`, signedTop.toString())).toBe(signedTop);
            expect(coerce(`int${ width }`, signedBottom.toString())).toBe(signedBottom);
        }
    });

    it('refuses one past the top of an unsigned width', () =>
    {
        for (const width of [8, 16, 32, 64, 128, 256])
        {
            refuses(() => coerce(`uint${ width }`, (1n << BigInt(width)).toString()));
        }
    });

    it('refuses one past either end of a signed width', () =>
    {
        for (const width of [8, 16, 32, 64, 128, 256])
        {
            const limit = 1n << BigInt(width - 1);
            refuses(() => coerce(`int${ width }`, limit.toString()));
            refuses(() => coerce(`int${ width }`, (-limit - 1n).toString()));
        }
    });

    it('treats bare uint and int as their 256-bit selves', () =>
    {
        expect(coerce('uint', ((1n << 256n) - 1n).toString())).toBe((1n << 256n) - 1n);
        refuses(() => coerce('uint', (1n << 256n).toString()));
        refuses(() => coerce('int', (1n << 255n).toString()));
    });

    it('refuses a negative value for an unsigned type', () =>
    {
        const error = refuses(() => coerce('uint256', '-1'));
        expect(error.message).toContain('zero or more');
    });

    it.each(['', 'twelve', '1.5', '1e18', '0x', '0x-5', '--5', ' '])('refuses %s as a whole number', (value) =>
    {
        refuses(() => coerce('uint256', value));
    });
});

describe('coerce - bytes', () =>
{
    it('takes dynamic bytes of any whole-byte length, including none', () =>
    {
        expect(coerce('bytes', '0x')).toBe('0x');
        expect(coerce('bytes', '0xdeadbeef')).toBe('0xdeadbeef');
    });

    it('takes a fixed width only at exactly that width', () =>
    {
        expect(coerce('bytes4', '0xdeadbeef')).toBe('0xdeadbeef');
        refuses(() => coerce('bytes4', '0xdead'));
        refuses(() => coerce('bytes4', '0xdeadbeefaa'));
        expect(coerce('bytes32', `0x${ 'ab'.repeat(32) }`)).toBe(`0x${ 'ab'.repeat(32) }`);
    });

    it('refuses an ODD number of hex digits rather than padding it into a different value', () =>
    {
        // Regression. The encoder right-pads, so `0xabc` used to encode as `0xabc0` - calldata
        // that does not say what the reader typed, signed by a wallet that has no way to know.
        const error = refuses(() => coerce('bytes', '0xabc'));
        expect(error.message).toContain('pairs');
        refuses(() => coerce('bytes', '0xdeadbee'));
    });

    it.each(['deadbeef', '0xzz', 'null', ''])('refuses %s as hex', (value) =>
    {
        refuses(() => coerce('bytes', value));
    });
});

describe('coerce - string', () =>
{
    it('does NOT trim, because a string argument\'s spaces are data', () =>
    {
        expect(coerce('string', '  hello  ')).toBe('  hello  ');
        expect(coerce('string', '')).toBe('');
    });

    it('carries text no ASCII assumption survives', () =>
    {
        expect(coerce('string', 'سلام 🌙   \\')).toBe('سلام 🌙   \\');
    });
});

describe('coerce - arrays', () =>
{
    it('reads a list with or without brackets, and with pasted quotes', () =>
    {
        expect(coerce('uint256[]', '1,2,3')).toEqual([1n, 2n, 3n]);
        expect(coerce('uint256[]', '[1, 2, 3]')).toEqual([1n, 2n, 3n]);
        expect(coerce('address[]', `["${ ALICE }"]`)).toEqual([ALICE]);
    });

    it('reads an empty list as empty rather than as one empty entry', () =>
    {
        expect(coerce('uint256[]', '')).toEqual([]);
        expect(coerce('uint256[]', '[]')).toEqual([]);
        expect(coerce('uint256[]', '   ')).toEqual([]);
    });

    it('refuses the whole list when one entry does not fit, keeping the position', () =>
    {
        refuses(() => coerce('address[]', `${ ALICE },0x123`, 3), 3);
        refuses(() => coerce('uint8[]', '1,2,999'));
    });

    it('nests', () =>
    {
        expect(coerce('uint256[][]', '1,2')).toEqual([[1n], [2n]]);
    });
});

describe('coerce - unsupported types', () =>
{
    it('says so by name instead of encoding something else', () =>
    {
        const error = refuses(() => coerce('function', 'anything'));
        expect(error.message).toContain('function');
    });
});

describe('splitTypes', () =>
{
    it('splits at the TOP level only, so a tuple stays one type', () =>
    {
        expect(splitTypes('address,uint256')).toEqual(['address', 'uint256']);
        expect(splitTypes('(address,bool,bytes)[]')).toEqual(['(address,bool,bytes)[]']);
        expect(splitTypes('address,(uint256,bool),bytes')).toEqual(['address', '(uint256,bool)', 'bytes']);
        expect(splitTypes('((a,b),(c,d))')).toEqual(['((a,b),(c,d))']);
    });

    it('reads an empty list as no types, not one nameless one', () =>
    {
        expect(splitTypes('')).toEqual([]);
    });

    it('does not lose characters on an unbalanced string', () =>
    {
        // Left whole so the encoder refuses it by name; inventing a shape here would be worse.
        expect(splitTypes('(address,uint256')).toEqual(['(address,uint256']);
    });
});

describe('parseType', () =>
{
    it('leaves a plain type alone', () =>
    {
        expect(parseType('address')).toEqual({ type: 'address' });
        expect(parseType('  uint256 ')).toEqual({ type: 'uint256' });
    });

    it('reads a tuple back into components', () =>
    {
        expect(parseType('(address,uint256)')).toEqual({
            type: 'tuple',
            components: [{ type: 'address' }, { type: 'uint256' }]
        });
    });

    it('keeps the array suffix OUTSIDE the parentheses, where a signature puts it', () =>
    {
        expect(parseType('(address,bool)[]')).toMatchObject({ type: 'tuple[]' });
        expect(parseType('(address,bool)[2][]')).toMatchObject({ type: 'tuple[2][]' });
    });

    it('nests tuples', () =>
    {
        expect(parseType('((address,bool),uint256)')).toEqual({
            type: 'tuple',
            components: [
                { type: 'tuple', components: [{ type: 'address' }, { type: 'bool' }] },
                { type: 'uint256' }
            ]
        });
    });

    it('hands an unbalanced type back unchanged rather than inventing a shape', () =>
    {
        expect(parseType('(address,uint256')).toEqual({ type: '(address,uint256' });
    });
});

describe('stringify', () =>
{
    it('prints a bigint whole - the whole reason values cross as text', () =>
    {
        const huge = (1n << 256n) - 1n;
        expect(stringify(huge)).toBe(huge.toString());
        expect(Number(stringify(huge))).not.toBe(huge);
    });

    it('prints booleans, lists and tuples as their parts', () =>
    {
        expect(stringify(true)).toBe('true');
        expect(stringify(false)).toBe('false');
        expect(stringify([1n, 2n])).toBe('1, 2');
        expect(stringify({ a: 1n, b: false })).toBe('1, false');
        expect(stringify([1n, [2n, 3n]])).toBe('1, 2, 3');
    });

    it('does not print an object as [object Object]', () =>
    {
        expect(stringify({ a: ALICE })).not.toContain('object Object');
    });
});

describe('encodeCall', () =>
{
    it('puts the selector first and the arguments behind it', () =>
    {
        const data = encodeCall(fn(['address', 'uint256']), [ALICE, '1000']);
        expect(data.slice(0, 10)).toBe('0xaabbccdd');
        expect(decodeArgs(['address', 'uint256'], data)).toEqual([ALICE, 1000n]);
    });

    it('encodes a call with no arguments as the bare selector', () =>
    {
        expect(encodeCall(fn([]), [])).toBe('0xaabbccdd');
    });

    it('refuses the wrong number of arguments before touching any of them', () =>
    {
        refuses(() => encodeCall(fn(['address']), []));
        refuses(() => encodeCall(fn(['address']), [ALICE, ALICE]));
    });

    it('refuses an out-of-range integer as an ArgumentError, not as an encoder fault', () =>
    {
        // Regression. `coerce` used to let 999 through and viem threw IntegerOutOfRangeError,
        // which inspect.ts rethrows - so a mistyped field answered 500 instead of a 400 naming
        // the argument.
        const error = refuses(() => encodeCall(fn(['uint8']), ['999']), 0);
        expect(error.message).toContain('uint8');
    });

    it('names the POSITION of the argument it refused', () =>
    {
        expect(refuses(() => encodeCall(fn(['address', 'address']), [ALICE, '0x1'])).at).toBe(1);
        expect(refuses(() => encodeCall(fn(['uint8', 'uint8']), ['1', '256'])).at).toBe(1);
    });

    it('encodes a struct argument from positional JSON', () =>
    {
        const data = encodeCall(fn(['(address,uint256)']), [`["${ ALICE }", "7"]`]);
        expect(decodeArgs(['(address,uint256)'], data)).toEqual([[ALICE, 7n]]);
    });

    it('encodes an array of structs as ONE argument', () =>
    {
        const data = encodeCall(fn(['(address,bool)[]']), [`[["${ ALICE }", "true"], ["${ ALICE }", "false"]]`]);
        expect(decodeArgs(['(address,bool)[]'], data)).toEqual([[[ALICE, true], [ALICE, false]]]);
    });

    it('refuses a struct with the wrong number of fields', () =>
    {
        refuses(() => encodeCall(fn(['(address,uint256)']), [`["${ ALICE }"]`]));
        refuses(() => encodeCall(fn(['(address,uint256)']), [`["${ ALICE }", "1", "2"]`]));
    });

    it('refuses a struct argument that is not JSON at all', () =>
    {
        refuses(() => encodeCall(fn(['(address,uint256)']), ['not json']));
        refuses(() => encodeCall(fn(['(address,uint256)']), ['']));
    });

    it('checks a leaf INSIDE a struct the same way as one outside it', () =>
    {
        refuses(() => encodeCall(fn(['(address,uint256)']), ['["0x123", "1"]']));
    });
});

describe('decodeReturn', () =>
{
    it('reads one entry per declared output', () =>
    {
        const data = encodeAbiParameters([{ type: 'uint256' }, { type: 'bool' }], [42n, true]);
        expect(decodeReturn(['uint256', 'bool'], data)).toEqual([
            { type: 'uint256', value: '42' },
            { type: 'bool', value: 'true' }
        ]);
    });

    it('answers nothing for a function that returns nothing, and for empty data', () =>
    {
        expect(decodeReturn([], '0xdeadbeef')).toEqual([]);
        expect(decodeReturn(['uint256'], '0x')).toEqual([]);
        expect(decodeReturn(['uint256'], '')).toEqual([]);
    });

    it('throws rather than inventing a value when the data does not fit the outputs', () =>
    {
        // A truncated word is a node that answered something else. Guessing here would print a
        // number that was never returned.
        expect(() => decodeReturn(['uint256'], '0x1234')).toThrow();
    });

    it('keeps a full uint256 exact', () =>
    {
        const max = (1n << 256n) - 1n;
        const data = encodeAbiParameters([{ type: 'uint256' }], [max]);
        expect(decodeReturn(['uint256'], data)[0]!.value).toBe(max.toString());
    });
});

// ------------------------------------------------------------------------------------------
// Property tests. Deterministic by construction: a seeded generator, so a failure reproduces
// exactly rather than "sometimes on CI".
// ------------------------------------------------------------------------------------------

/** xorshift32 - small, fast, and identical on every machine and every run. */
function seeded(seed: number): () => number
{
    let state = seed >>> 0 || 1;
    return () =>
    {
        state ^= state << 13;
        state >>>= 0;
        state ^= state >>> 17;
        state ^= state << 5;
        state >>>= 0;
        return state / 0x1_0000_0000;
    };
}

describe('property: what encodes must decode back to what was typed', () =>
{
    it('round-trips uint256 across the whole range', () =>
    {
        const random = seeded(0x51ed);
        for (let round = 0; round < 300; round++)
        {
            // Biased towards the ends: the interesting values are near 0 and near 2^256.
            const bits = 1 + Math.floor(random() * 256);
            const value = BigInt(Math.floor(random() * 0x1_0000_0000)) * ((1n << BigInt(bits)) / 0x1_0000_0000n || 1n);
            const clamped = value % (1n << 256n);
            const data = encodeCall(fn(['uint256']), [clamped.toString()]);
            expect(decodeArgs(['uint256'], data)).toEqual([clamped]);
        }
    });

    it('round-trips signed integers, including the asymmetric bottom end', () =>
    {
        const random = seeded(0xc0ffee);
        for (let round = 0; round < 200; round++)
        {
            const width = [8, 16, 32, 64, 128, 256][Math.floor(random() * 6)]!;
            const limit = 1n << BigInt(width - 1);
            const pick = [(-limit).toString(), (limit - 1n).toString(), '0', '-1', '1'][Math.floor(random() * 5)]!;
            const data = encodeCall(fn([`int${ width }`]), [pick]);
            expect(decodeArgs([`int${ width }`], data)).toEqual([BigInt(pick)]);
        }
    });

    it('round-trips arbitrary byte strings of every even length', () =>
    {
        const random = seeded(0xb17e5);
        for (let length = 0; length <= 64; length++)
        {
            let hex = '';
            for (let at = 0; at < length; at++)
            {
                hex += Math.floor(random() * 256).toString(16).padStart(2, '0');
            }
            const value = `0x${ hex }`;
            const data = encodeCall(fn(['bytes']), [value]);
            expect(decodeArgs(['bytes'], data)).toEqual([value]);
        }
    });

    it('round-trips strings, including scripts and control characters', () =>
    {
        const alphabet = ['a', 'Z', '0', ' ', '\n', '\t', 'س', '中', '🌙', '"', '\\', ' ', ','];
        const random = seeded(0x5712);
        for (let round = 0; round < 200; round++)
        {
            let text = '';
            const length = Math.floor(random() * 40);
            for (let at = 0; at < length; at++)
            {
                text += alphabet[Math.floor(random() * alphabet.length)];
            }
            const data = encodeCall(fn(['string']), [text]);
            expect(decodeArgs(['string'], data)).toEqual([text]);
        }
    });

    it('never throws anything but an ArgumentError, whatever text arrives', () =>
    {
        // The fuzz that matters for this file: coerce is fed a reader's typing. Anything it
        // rejects must be an ArgumentError, because that is the only class that becomes a 400
        // instead of a 500 - an unhandled class here is an error page for a typo.
        const types = ['address', 'bool', 'uint256', 'uint8', 'int128', 'bytes', 'bytes4', 'bytes32', 'string', 'uint256[]', 'address[]'];
        const fragments = ['0x', '-', '.', 'e', '0', 'f', 'z', ' ', ',', '[', ']', '"', 'ff', '9', ' ', 'Infinity', 'NaN', 'null', '0x' + 'f'.repeat(80)];
        const random = seeded(0xfa77);

        for (let round = 0; round < 4000; round++)
        {
            const type = types[Math.floor(random() * types.length)]!;
            let text = '';
            const parts = Math.floor(random() * 5);
            for (let at = 0; at < parts; at++)
            {
                text += fragments[Math.floor(random() * fragments.length)];
            }
            try
            {
                coerce(type, text);
            }
            catch (error)
            {
                expect(error, `type ${ type }, text ${ JSON.stringify(text) }`).toBeInstanceOf(ArgumentError);
            }
        }
    });

    it('never produces calldata that decodes to something else', () =>
    {
        // The invariant the whole file exists for. Whatever survives coercion must encode to
        // bytes that mean exactly it.
        const types = ['address', 'bool', 'uint256', 'uint8', 'int64', 'bytes', 'bytes4', 'string'];
        const samples: Record<string, string[]> = {
            address: [ALICE, `0x${ '1'.repeat(40) }`],
            bool: ['true', 'false', '1', '0'],
            uint256: ['0', '1', ((1n << 256n) - 1n).toString(), '0xff'],
            uint8: ['0', '255', '128'],
            int64: ['0', '-1', (-(1n << 63n)).toString(), ((1n << 63n) - 1n).toString()],
            bytes: ['0x', '0xdeadbeef', `0x${ 'ab'.repeat(100) }`],
            bytes4: ['0xdeadbeef', '0x00000000'],
            string: ['', 'hello', 'سلام', '🌙']
        };
        const random = seeded(0x1c0de);

        for (let round = 0; round < 500; round++)
        {
            const type = types[Math.floor(random() * types.length)]!;
            const pool = samples[type]!;
            const text = pool[Math.floor(random() * pool.length)]!;
            const data = encodeCall(fn([type]), [text]);
            const [back] = decodeArgs([type], data);
            expect(stringify(back), `${ type } <- ${ text }`).toBe(stringify(coerce(type, text)));
        }
    });
});
