import { withoutMetadata } from '../chain/contract.ts';

// The comparison that IS the verification.
//
// Nothing else in this feature establishes anything. A submitter can claim any compiler, any
// settings, any contract name and any ABI - and none of it is believed, because the only thing
// checked is whether running that compiler over that source reproduces the bytes already on the
// chain. When it does, the source is the source: there is no second way to get those bytes.
//
// Which is also why the endpoint needs no password. The chain is the credential.
//
// Two things legitimately differ between what a compiler emits and what a chain holds, and both
// are accounted for below rather than waved away:
//
//   - IMMUTABLES are written into the code by the constructor, at deploy time. solc emits zeros
//     where they go and tells us exactly which byte ranges they occupy, so those ranges are
//     excluded from the comparison. Anything else in them would be a different contract.
//   - The METADATA TRAILER is a hash of the source's own metadata: file paths, comments, the
//     compiler's settings. Two builds of identical CODE differ there if a comment moved. That is
//     the difference between the two answers this file gives.

/** How completely the compiler's output lined up with the chain. */
export type MatchKind = 'full' | 'partial';

/** A byte range solc says holds an immutable value. Offsets are into the DEPLOYED bytecode. */
export interface ImmutableRange
{
    start: number;
    length: number;
}

/** solc's `evm.deployedBytecode.immutableReferences`: one list of ranges per AST id. */
export type ImmutableReferences = Record<string, ImmutableRange[]>;

/** Lowercase hex with no `0x`, which is the only form anything here compares. */
function body(code: string): string
{
    const value = code.trim().toLowerCase();
    return value.startsWith('0x') ? value.slice(2) : value;
}

/**
 * The library placeholders still standing in a compiled object.
 *
 * solc leaves `__$<hash>$__` (0.5 and up) or `__LibraryName___...` (older) where a library address
 * belongs, and the linker fills them in at deploy time. An object that still carries them was
 * never linked, so it CANNOT equal deployed code - and blanking those twenty bytes to make it
 * match would mean not checking the one part a reader most wants checked. They are reported
 * instead, so the submission can be resent with `settings.libraries` filled in.
 */
export function unlinkedLibraries(object: string): string[]
{
    const found = new Set<string>();
    for (const match of body(object).matchAll(/__\$([0-9a-f]{34})\$__/g))
    {
        found.add(match[1]!);
    }
    // The pre-0.5 form: two underscores, the library name, then underscores out to 40 characters.
    for (const match of body(object).matchAll(/__([^_]{1,36})_+/g))
    {
        if (!match[1]!.startsWith('$'))
        {
            found.add(match[1]!);
        }
    }
    return [...found];
}

/** Replaces every immutable range with the same filler in both strings, so they cannot differ. */
function maskImmutables(code: string, references: ImmutableReferences): string
{
    const ranges = Object.values(references).flat();
    if (ranges.length === 0)
    {
        return code;
    }

    const characters = [...code];
    for (const range of ranges)
    {
        // Offsets are in BYTES and this is hex, so every position doubles. A range that runs past
        // the end is ignored rather than trusted: it would mean the compiler and the chain
        // disagree about the length, and that disagreement is caught by the length check anyway.
        const from = range.start * 2;
        const to = from + range.length * 2;
        for (let at = from; at < to && at < characters.length; at++)
        {
            characters[at] = '0';
        }
    }
    return characters.join('');
}

/**
 * Whether compiled output reproduces deployed code, and how exactly.
 *
 * `full` - byte for byte, metadata trailer included. The source is the source, down to its
 * comments and the paths its files were compiled under.
 *
 * `partial` - identical everywhere except the metadata trailer. The CODE is the deployed code;
 * something that does not affect execution differs - a comment, a file path, the order of imports.
 * Worth showing, and worth labelling as what it is, because a partial match cannot rule out that
 * a comment in the published source describes something the deployed one does not do.
 *
 * `null` - not this contract.
 */
export function compareDeployed(onchain: string, compiled: string, references: ImmutableReferences = {}): MatchKind | null
{
    const chainCode = body(onchain);
    const output = body(compiled);

    if (chainCode === '' || output === '' || chainCode.length !== output.length)
    {
        return null;
    }

    const masked = maskImmutables(output, references);
    const maskedChain = maskImmutables(chainCode, references);
    if (masked === maskedChain)
    {
        return 'full';
    }

    // Same code, different trailer. Both are cut at their OWN trailer rather than at a shared
    // offset: the two CBOR blobs can differ in length, which is itself a difference that does not
    // reach execution.
    const trimmedChain = body(withoutMetadata(maskedChain));
    const trimmedOutput = body(withoutMetadata(masked));
    if (trimmedChain !== '' && trimmedChain === trimmedOutput)
    {
        return 'partial';
    }

    return null;
}
