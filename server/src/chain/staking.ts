import { encodeAbiParameters } from 'viem';

import { hexToBech32 } from './bech32.ts';
import type { ChainGateway } from './client.ts';
import { account, getJson, type CosmosCoin, type CosmosEnv } from './cosmos.ts';
import { selectorOf } from './signatures.ts';

// Staking: who secures this chain, and what a reader has at stake with them.
//
// The same split governance makes, for the same reason. `x/staking` and `x/distribution` are
// Cosmos modules that never touch the EVM, so nothing here is indexed and nothing is decoded from
// a log - it is READ from the node's REST api beside the explorer (see cosmos.ts, whose http
// helper this file shares). WRITING is the other half and goes through two precompiles, which is
// what lets a wallet that only speaks Ethereum send a `MsgDelegate`.
//
// A validator set is tens of rows where transactions are millions, so none of it is copied into
// sqlite: a copy would only be one that can be wrong, and the whole set is one request.

/** Where cosmos/evm mounts the staking precompile. */
export const STAKING_PRECOMPILE = '0x0000000000000000000000000000000000000800';

/** And the distribution one, which is where rewards are claimed from. */
export const DISTRIBUTION_PRECOMPILE = '0x0000000000000000000000000000000000000801';

/** The module's own status strings, kept as the module writes them. */
export type BondStatus = 'bonded' | 'unbonding' | 'unbonded' | 'unspecified';

export interface StakingValidator
{
    /** The operator address, `nuravaloper1…` - what every staking message names a validator by. */
    operatorAddress: string;
    /** The same twenty bytes as an ACCOUNT, so a validator still links to the page the EVM knows. */
    accountHex: string | null;
    moniker: string;
    identity: string;
    website: string;
    details: string;
    jailed: boolean;
    status: BondStatus;
    /** Base units of the bond denom, as a decimal string. */
    tokens: string;
    delegatorShares: string;
    /** Eighteen-place fixed point, like every other share on this wire: '0.050000000000000000'. */
    commissionRate: string;
    commissionMaxRate: string;
    commissionMaxChangeRate: string;
    minSelfDelegation: string;
    /** Set only while the validator is unbonding; '' otherwise. */
    unbondingTime: string;
}

export interface StakingPool
{
    bondedTokens: string;
    notBondedTokens: string;
}

export interface StakingParams
{
    /** Seconds a withdrawal is locked for before it pays out. */
    unbondingTime: number;
    maxValidators: number;
    maxEntries: number;
    /** The denom staking is counted in - the chain's own. */
    bondDenom: string;
}

export interface Delegation
{
    validatorAddress: string;
    /** The delegator's shares of that validator, which is NOT the same number as the balance. */
    shares: string;
    /** What those shares are currently worth, in base units. */
    balance: CosmosCoin;
}

export interface UnbondingEntry
{
    validatorAddress: string;
    creationHeight: string;
    completionTime: string;
    balance: string;
}

export interface Reward
{
    validatorAddress: string;
    amount: CosmosCoin[];
}

/** One reader's whole position: what they staked, what is on its way out, and what is owed. */
export interface DelegatorStake
{
    /** The account as the chain spells it - what the REST api was keyed on to get all of this. */
    address: string;
    delegations: Delegation[];
    unbonding: UnbondingEntry[];
    rewards: Reward[];
    totalRewards: CosmosCoin[];
}

/** `'1814400s'` -> 1814400. The module states durations as seconds with the unit stuck on. */
function seconds(duration: unknown): number
{
    const value = Number(String(duration ?? '').replace(/s$/, ''));
    return Number.isFinite(value) ? value : 0;
}

const STATUS: Record<string, BondStatus> = {
    BOND_STATUS_BONDED: 'bonded',
    BOND_STATUS_UNBONDING: 'unbonding',
    BOND_STATUS_UNBONDED: 'unbonded'
};

/**
 * A reward amount as base units.
 *
 * Rewards are `DecCoin`, not `Coin`: the module accrues them as eighteen-place decimals and a
 * balance really does come back as '1234.567800000000000000'. Everything else on this wire is a
 * whole number of base units, and `BigInt('1234.5678')` throws - so the fraction is CUT here,
 * which is also what the module does when it actually pays out. Rounding up would promise a
 * reader a base unit the chain will not send them.
 */
function decCoins(rows: unknown): CosmosCoin[]
{
    return Array.isArray(rows)
        ? rows.map((row) =>
        {
            const coin = row as { denom?: unknown; amount?: unknown };
            const amount = String(coin.amount ?? '0');
            const cut = amount.indexOf('.');
            return { denom: String(coin.denom ?? ''), amount: cut === -1 ? amount : amount.slice(0, cut) };
        })
        : [];
}

function validatorOf(raw: unknown): StakingValidator
{
    const row = raw as Record<string, unknown>;
    const description = (row.description ?? {}) as Record<string, unknown>;
    const commission = (row.commission ?? {}) as Record<string, unknown>;
    const rates = (commission.commission_rates ?? {}) as Record<string, unknown>;
    const operator = String(row.operator_address ?? '');

    return {
        operatorAddress: operator,
        // A `…valoper1…` address holds the same twenty bytes as the operator's own account, so
        // the EVM page for it is one decode away. Null where it did not decode, and then the
        // moniker is shown without a link rather than with a wrong one.
        accountHex: account(operator).hex,
        moniker: String(description.moniker ?? ''),
        identity: String(description.identity ?? ''),
        website: String(description.website ?? ''),
        details: String(description.details ?? ''),
        jailed: row.jailed === true,
        status: STATUS[String(row.status ?? '')] ?? 'unspecified',
        tokens: String(row.tokens ?? '0'),
        delegatorShares: String(row.delegator_shares ?? '0'),
        commissionRate: String(rates.rate ?? '0'),
        commissionMaxRate: String(rates.max_rate ?? '0'),
        commissionMaxChangeRate: String(rates.max_change_rate ?? '0'),
        minSelfDelegation: String(row.min_self_delegation ?? '0'),
        unbondingTime: String(row.unbonding_time ?? '')
    };
}

/**
 * The whole validator set, in one request.
 *
 * Every status, not only the bonded ones: a reader with a delegation to a validator that has
 * since been jailed still needs to find it, and a set filtered to `bonded` would drop the row
 * their stake is actually in. The module pages, so the limit is raised past any real set's size
 * rather than paged through - a chain with more than five hundred validators does not exist, and
 * asking for one page is one round trip where paging would be several.
 */
export async function readValidators(env: CosmosEnv): Promise<StakingValidator[] | null>
{
    const body = await getJson<{ validators?: unknown[] }>(
        env.restUrl, '/cosmos/staking/v1beta1/validators?pagination.limit=500', env.timeoutMs);

    return body === null || !Array.isArray(body.validators) ? null : body.validators.map(validatorOf);
}

export async function readPool(env: CosmosEnv): Promise<StakingPool | null>
{
    const body = await getJson<{ pool?: Record<string, unknown> }>(
        env.restUrl, '/cosmos/staking/v1beta1/pool', env.timeoutMs);

    if (body?.pool === undefined)
    {
        return null;
    }
    return {
        bondedTokens: String(body.pool.bonded_tokens ?? '0'),
        notBondedTokens: String(body.pool.not_bonded_tokens ?? '0')
    };
}

export async function readStakingParams(env: CosmosEnv): Promise<StakingParams | null>
{
    const body = await getJson<{ params?: Record<string, unknown> }>(
        env.restUrl, '/cosmos/staking/v1beta1/params', env.timeoutMs);

    if (body?.params === undefined)
    {
        return null;
    }
    return {
        unbondingTime: seconds(body.params.unbonding_time),
        maxValidators: Number(body.params.max_validators ?? 0),
        maxEntries: Number(body.params.max_entries ?? 0),
        bondDenom: String(body.params.bond_denom ?? '')
    };
}

/**
 * The chain's bech32 account prefix - `nura`.
 *
 * Asked for rather than configured, because getting it wrong is silent: `0x4ac0…` encodes to a
 * perfectly valid address under ANY prefix, and one built with the wrong one would query an
 * account that exists on some other chain and answer "you have staked nothing".
 *
 * The auth module states it directly. Where that endpoint is absent - it is newer than some
 * chains - a validator's operator address carries the same prefix with `valoper` on the end, so
 * the set that has already been read answers the question too.
 */
export async function readBech32Prefix(env: CosmosEnv, validators: readonly StakingValidator[]): Promise<string>
{
    const body = await getJson<{ bech32Prefix?: unknown; bech32_prefix?: unknown }>(
        env.restUrl, '/cosmos/auth/v1beta1/bech32', env.timeoutMs);

    const stated = String(body?.bech32Prefix ?? body?.bech32_prefix ?? '');
    if (stated !== '')
    {
        return stated;
    }

    const operator = validators.find((row) => row.operatorAddress !== '')?.operatorAddress ?? '';
    const split = operator.lastIndexOf('1');
    const prefix = split < 1 ? '' : operator.slice(0, split);
    return prefix.endsWith('valoper') ? prefix.slice(0, -'valoper'.length) : '';
}

/**
 * One account's whole staking position, by its EVM address.
 *
 * The three reads are one question a reader asks - what have I staked, what is unbonding, what am
 * I owed - and they are three endpoints, so they go out together rather than in series.
 *
 * Null where the account could not be spelled in bech32 at all: without the prefix there is no
 * key to ask the REST api under, and answering "nothing staked" would be a claim rather than the
 * absence of one.
 */
export async function readDelegatorStake(env: CosmosEnv, addressHex: string, prefix: string): Promise<DelegatorStake | null>
{
    const address = hexToBech32(addressHex, prefix);
    if (address === null)
    {
        return null;
    }

    const [delegated, unbonding, rewards] = await Promise.all([
        getJson<{ delegation_responses?: unknown[] }>(
            env.restUrl, `/cosmos/staking/v1beta1/delegations/${ address }?pagination.limit=500`, env.timeoutMs),
        getJson<{ unbonding_responses?: unknown[] }>(
            env.restUrl, `/cosmos/staking/v1beta1/delegators/${ address }/unbonding_delegations?pagination.limit=500`, env.timeoutMs),
        getJson<{ rewards?: unknown[]; total?: unknown[] }>(
            env.restUrl, `/cosmos/distribution/v1beta1/delegators/${ address }/rewards`, env.timeoutMs)
    ]);

    return {
        address,
        delegations: (delegated?.delegation_responses ?? []).map((raw) =>
        {
            const row = raw as Record<string, unknown>;
            const inner = (row.delegation ?? {}) as Record<string, unknown>;
            const balance = (row.balance ?? {}) as Record<string, unknown>;
            return {
                validatorAddress: String(inner.validator_address ?? ''),
                shares: String(inner.shares ?? '0'),
                balance: { denom: String(balance.denom ?? ''), amount: String(balance.amount ?? '0') }
            };
        }),
        // One row per ENTRY, not per validator: each withdrawal unbonds on its own clock, and a
        // reader waiting on two of them from the same validator has two dates to watch.
        unbonding: (unbonding?.unbonding_responses ?? []).flatMap((raw) =>
        {
            const row = raw as Record<string, unknown>;
            const validatorAddress = String(row.validator_address ?? '');
            return (Array.isArray(row.entries) ? row.entries : []).map((entry) =>
            {
                const item = entry as Record<string, unknown>;
                return {
                    validatorAddress,
                    creationHeight: String(item.creation_height ?? '0'),
                    completionTime: String(item.completion_time ?? ''),
                    balance: String(item.balance ?? '0')
                };
            });
        }),
        rewards: (rewards?.rewards ?? []).map((raw) =>
        {
            const row = raw as Record<string, unknown>;
            return { validatorAddress: String(row.validator_address ?? ''), amount: decCoins(row.reward) };
        }),
        totalRewards: decCoins(rewards?.total)
    };
}

/**
 * Whether this chain exposes staking to the EVM.
 *
 * The same question, and the same answer shape, as the gov precompile's (see gov.ts): an address
 * with nothing mounted at it is an EMPTY ACCOUNT, so calling one SUCCEEDS and answers no data
 * rather than reverting. An empty answer is the chain saying it has not enabled this.
 *
 * Probed with a real query - one bonded validator - because the staking precompile has no
 * parameter getter to ask for nothing with. The answer is thrown away; only whether there WAS
 * one is the point.
 */
export async function stakingWritable(chain: ChainGateway): Promise<boolean>
{
    try
    {
        const args = encodeAbiParameters(
            [
                { type: 'string' },
                { type: 'tuple', components: [
                    { type: 'bytes' }, { type: 'uint64' }, { type: 'uint64' }, { type: 'bool' }, { type: 'bool' }
                ] }
            ],
            ['BOND_STATUS_BONDED', ['0x', 0n, 1n, false, false]]
        );
        const selector = selectorOf('validators(string,(bytes,uint64,uint64,bool,bool))');
        const answer = await chain.call(STAKING_PRECOMPILE, `${ selector }${ args.slice(2) }`);
        return answer !== '0x' && answer !== '';
    }
    catch
    {
        return false;
    }
}
