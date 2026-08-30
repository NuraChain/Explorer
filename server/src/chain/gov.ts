import { encodeAbiParameters } from 'viem';

import type { ChainGateway } from './client.ts';
import { selectorOf } from './signatures.ts';

// The gov precompile: the one place where this chain's governance meets the EVM.
//
// Reading governance does not need it - the module's own REST api answers that, and better (see
// cosmos.ts). WRITING does: a vote is a Cosmos message, and the precompile is what lets a wallet
// that only speaks Ethereum send one. So this file is now two things and no more - the address
// those transactions go to, and the question of whether the chain has mounted it at all.
//
// It is a chain setting (`active_static_precompiles` on the EVM module), so it can be turned on
// without redeploying anything here: the page asks on every load and offers the controls when the
// answer changes.

/** Where cosmos/evm mounts the gov precompile. */
export const GOV_PRECOMPILE = '0x0000000000000000000000000000000000000805';

/**
 * Whether this chain exposes governance to the EVM.
 *
 * An address with nothing mounted at it is an EMPTY ACCOUNT: calling one SUCCEEDS and answers no
 * data rather than reverting. So an empty answer here is not an error to report, it is the chain
 * saying it has not enabled this - and the page offers a vote only when it has.
 */
export async function precompileEnabled(chain: ChainGateway): Promise<boolean>
{
    try
    {
        const answer = await chain.call(GOV_PRECOMPILE, selectorOf('getParams()'));
        return answer !== '0x' && answer !== '';
    }
    catch
    {
        return false;
    }
}

/**
 * The calldata for a vote, ready for a wallet to sign.
 *
 * Encoded here rather than through the general calldata route because the arguments are typed -
 * an option is a number the module fixed, not a string somebody typed into a field.
 */
export function voteCalldata(voter: string, proposalId: string, option: number, metadata: string): string
{
    const args = encodeAbiParameters(
        [{ type: 'address' }, { type: 'uint64' }, { type: 'uint8' }, { type: 'string' }],
        [voter as `0x${ string }`, BigInt(proposalId), option, metadata]
    );
    return `${ selectorOf('vote(address,uint64,uint8,string)') }${ args.slice(2) }`;
}
