import { toEventSelector, toFunctionSelector, type AbiParameter } from 'viem';

import type { KnownEvent, KnownFunction, Mutability } from '../chain/signatures.ts';

// A verified ABI, in the shape the rest of the server already speaks.
//
// Everything downstream - the function list, the encoder, the decoder - is written against
// `KnownFunction`, which until now could only come from the built-in table of published
// signatures. A verified contract answers the same questions with better authority: not "some
// standard calls this selector `transfer`" but "the source that produced these exact bytes
// declares this function, with these argument names and this return type".
//
// So the ABI is translated into that shape rather than given a path of its own. One overlay, at
// one seam: whatever comes out of here outranks the table, and everything past it is unchanged.

/** An ABI as JSON, before anything is believed about it. */
interface AbiEntry
{
    type?: string;
    name?: string;
    inputs?: AbiParameter[];
    outputs?: AbiParameter[];
    stateMutability?: string;

    /** Pre-0.6 ABIs said it this way. Still deployed, still worth reading. */
    constant?: boolean;
    payable?: boolean;
}

/**
 * A parameter as its type is WRITTEN in a signature.
 *
 * A struct is `tuple` in the JSON with its fields hanging off `components`, but it is
 * `(address,uint256)` in the signature the selector is hashed from - and the array suffix rides
 * on the outside, so `tuple[2][]` becomes `(address,uint256)[2][]`.
 */
export function canonicalType(parameter: AbiParameter): string
{
    if (!parameter.type.startsWith('tuple'))
    {
        return parameter.type;
    }
    const components = 'components' in parameter && Array.isArray(parameter.components) ? parameter.components : [];
    return `(${ components.map(canonicalType).join(',') })${ parameter.type.slice('tuple'.length) }`;
}

/** What the ABI says about state, in either of the two ways ABIs have said it. */
function mutabilityOf(entry: AbiEntry): Mutability
{
    const declared = entry.stateMutability;
    if (declared === 'view' || declared === 'pure' || declared === 'payable' || declared === 'nonpayable')
    {
        return declared;
    }
    if (entry.payable === true)
    {
        return 'payable';
    }
    if (entry.constant === true)
    {
        return 'view';
    }
    // An ABI entry with neither is a function that changes state - the default solc has always
    // applied. It is never guessed as `view`: a wrong `view` puts a write behind a Query button.
    return 'nonpayable';
}

/** Parsed ABI JSON, or an empty list when it is not an array of entries. */
function entriesOf(abi: string): AbiEntry[]
{
    try
    {
        const parsed = JSON.parse(abi) as unknown;
        return Array.isArray(parsed) ? parsed as AbiEntry[] : [];
    }
    catch
    {
        return [];
    }
}

/**
 * Selector -> function, for every function the ABI declares.
 *
 * `constructor`, `fallback`, `receive` and `error` entries are skipped: none of them has a
 * selector a dispatcher compares against, so none of them belongs in a list of entry points.
 */
export function functionsOfAbi(abi: string): Map<string, KnownFunction>
{
    const found = new Map<string, KnownFunction>();

    for (const entry of entriesOf(abi))
    {
        if (entry.type !== 'function' || typeof entry.name !== 'string' || entry.name === '')
        {
            continue;
        }

        const inputs = entry.inputs ?? [];
        const outputs = entry.outputs ?? [];
        const signature = `${ entry.name }(${ inputs.map(canonicalType).join(',') })`;

        try
        {
            found.set(toFunctionSelector(signature), {
                selector: toFunctionSelector(signature),
                signature,
                name: entry.name,
                inputs: inputs.map(canonicalType),
                outputs: outputs.map(canonicalType),
                mutability: mutabilityOf(entry),
                // The parameters WITH their components, so a struct argument can actually be
                // encoded. The string forms above are what a reader is shown; these are what the
                // encoder needs, and a tuple cannot be reconstructed from its printed form.
                inputParams: inputs,
                outputParams: outputs
            });
        }
        catch
        {
            // A signature viem cannot hash is an ABI entry naming a type that does not exist.
            // Skipping it loses one row; letting it throw would lose the whole contract.
            continue;
        }
    }

    return found;
}

/** Topic -> event, for every event the ABI declares. */
export function eventsOfAbi(abi: string): Map<string, KnownEvent>
{
    const found = new Map<string, KnownEvent>();

    for (const entry of entriesOf(abi))
    {
        if (entry.type !== 'event' || typeof entry.name !== 'string' || entry.name === '')
        {
            continue;
        }
        const inputs = entry.inputs ?? [];
        const signature = `${ entry.name }(${ inputs.map(canonicalType).join(',') })`;
        try
        {
            found.set(toEventSelector(signature), {
                topic: toEventSelector(signature),
                signature,
                name: entry.name,
                inputs: inputs.map(canonicalType)
            });
        }
        catch
        {
            continue;
        }
    }

    return found;
}
