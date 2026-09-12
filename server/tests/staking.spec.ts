// Staking against a stubbed NODE.
//
// The fixtures are in the shape `/cosmos/staking/v1beta1/validators` returns them - the same json
// `evmd q staking validators` prints. They go through `fetch`, because that is the boundary:
// everything below tests what the explorer does with what the node says, including the three
// things that are easy to get quietly wrong. A jailed validator is still bonded and must not be
// counted in the active set; a reward is a DecCoin and arrives with a fraction on it; and the
// module is keyed on the BECH32 spelling of an account the browser only knows as hex.
import { describe, it, expect, afterEach, vi } from 'vitest';

import { buildApp } from '../src/app.ts';
import { bech32ToHex, hexToBech32 } from '../src/chain/bech32.ts';
import { STAKING_PRECOMPILE } from '../src/chain/staking.ts';
import { IndexStore } from '../src/chain/store.ts';
import type { ChainEnv, ChainGateway } from '../src/chain/client.ts';
import type { CosmosEnv } from '../src/chain/cosmos.ts';
import type { DelegatorStake, StakingOverview, ValidatorPage } from '../src/schemas.ts';

const ENV: ChainEnv = {
    rpcUrl: 'stub', chainId: 1020, name: 'NuraChain', symbol: 'NURA', decimals: 18, siteUrl: '', explorerUrl: '',
    startBlock: 0, pollMs: 1000, batchSize: 10, concurrency: 4, rpcBatchSize: 10, dbPath: ':memory:'
};

const COSMOS: CosmosEnv = { restUrl: 'http://node.test:1317', rpcUrl: 'http://node.test:26657', timeoutMs: 1000 };

/** One account, in both of the chain's spellings. */
const DELEGATOR = 'nura1ftqdjvqyy26q3w32harejhy8eue8vdcjfp6r77';
const DELEGATOR_HEX = '0x4ac0d9300422b408ba2abf47995c87cf32763712';

const NURA = (whole: bigint): string => (whole * 10n ** 18n).toString();

const ALPHA = 'nuravaloper1ftqdjvqyy26q3w32harejhy8eue8vdcjsengjg';
const BETA = 'nuravaloper10d07y265gmmuvt4z0w9aw880jnsr700julecwj';
const GAMMA = 'nuravaloper1qqgjyv6y24n80zye42aueh0wluqpzg3nar70tu';

const validator = (
    operator: string,
    moniker: string,
    tokens: string,
    status: string,
    jailed = false,
    rate = '0.050000000000000000'
): Record<string, unknown> => ({
    operator_address: operator,
    consensus_pubkey: { '@type': '/cosmos.crypto.ed25519.PubKey', key: 'stub' },
    jailed,
    status,
    tokens,
    delegator_shares: `${ tokens }.000000000000000000`,
    description: { moniker, identity: '', website: `https://${ moniker }.test`, security_contact: '', details: 'A validator.' },
    unbonding_height: '0',
    unbonding_time: '1970-01-01T00:00:00Z',
    commission: {
        commission_rates: { rate, max_rate: '0.200000000000000000', max_change_rate: '0.010000000000000000' },
        update_time: '2026-08-01T00:00:00Z'
    },
    min_self_delegation: '1'
});

// Deliberately NOT in stake order in the fixture: the route is what has to sort them.
const VALIDATORS = [
    validator(BETA, 'beta', NURA(600_000n), 'BOND_STATUS_BONDED'),
    validator(ALPHA, 'alpha', NURA(1_400_000n), 'BOND_STATUS_BONDED'),
    // Bonded AND jailed - the row this whole distinction exists for.
    validator(GAMMA, 'gamma', NURA(50_000n), 'BOND_STATUS_BONDED', true, '0.100000000000000000')
];

interface NodeStub
{
    /** False is a node that is not there at all: every call fails, as a refused connection does. */
    up?: boolean;
    /** The REST api off, with CometBFT still answering: params null, so the section is off. */
    restDown?: boolean;
    /** True mounts the staking precompile, which is what lets the page offer a delegation. */
    writable?: boolean;
    /** False drops `/cosmos/auth/v1beta1/bech32`, so the prefix must come from a valoper address. */
    authPrefix?: boolean;
    delegations?: unknown[];
    unbonding?: unknown[];
    rewards?: { rewards?: unknown[]; total?: unknown[] };
}

/** Every url the node was asked for, so a test can assert WHAT was asked as well as the answer. */
let asked: string[] = [];

function stubNode(stub: NodeStub = {}): void
{
    const json = (body: unknown): Response =>
        new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

    vi.stubGlobal('fetch', async (input: string | URL | Request): Promise<Response> =>
    {
        if (stub.up === false)
        {
            throw new Error('connect ECONNREFUSED');
        }
        const url = String(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
        asked.push(url);

        if (url.includes(':26657/status'))
        {
            return json({
                result: {
                    node_info: { network: 'nura_1020-1' },
                    sync_info: { latest_block_height: '459832', catching_up: false }
                }
            });
        }
        if (stub.restDown === true)
        {
            return new Response('not found', { status: 501 });
        }
        if (url.includes('/cosmos/auth/v1beta1/bech32'))
        {
            return stub.authPrefix === false
                ? new Response('not implemented', { status: 501 })
                : json({ bech32Prefix: 'nura' });
        }
        if (url.includes('/cosmos/staking/v1beta1/params'))
        {
            return json({
                params: {
                    unbonding_time: '1814400s', max_validators: 100, max_entries: 7,
                    historical_entries: 10000, bond_denom: 'anura'
                }
            });
        }
        if (url.includes('/cosmos/staking/v1beta1/pool'))
        {
            return json({ pool: { bonded_tokens: NURA(2_000_000n), not_bonded_tokens: NURA(100_000n) } });
        }
        if (url.includes('/cosmos/staking/v1beta1/validators'))
        {
            return json({ validators: VALIDATORS, pagination: { total: String(VALIDATORS.length) } });
        }
        if (url.includes('/unbonding_delegations'))
        {
            return json({ unbonding_responses: stub.unbonding ?? [] });
        }
        if (url.includes('/cosmos/staking/v1beta1/delegations/'))
        {
            return json({ delegation_responses: stub.delegations ?? [] });
        }
        if (url.includes('/cosmos/distribution/v1beta1/delegators/'))
        {
            return json(stub.rewards ?? { rewards: [], total: [] });
        }
        return new Response('not found', { status: 404 });
    });
}

/** The EVM side: only the precompile probe reaches it. */
function stubChain(writable = false): ChainGateway
{
    return {
        env: ENV,
        head: async () => 100,
        range: async () => [],
        genesisHash: async () => '0xgenesis',
        blockHashAt: async () => null,
        tokenMetadata: async () => null,
        balance: async () => 0n,
        isContract: async () => false,
        code: async () => '0x',
        storageAt: async () => `0x${ '0'.repeat(64) }`,
        // An address with no precompile mounted answers empty WITHOUT reverting.
        call: async (address) =>
            (address.toLowerCase() === STAKING_PRECOMPILE && writable ? `0x${ '0'.repeat(64) }` : '0x')
    };
}

function api(stub: NodeStub = {}): (path: string) => Promise<Response>
{
    stubNode(stub);
    const app = buildApp({
        dev: false,
        store: new IndexStore(':memory:'),
        chain: stubChain(stub.writable === true),
        cosmos: COSMOS
    });
    return (path) => app.handle(new Request(`http://local${ path }`));
}

afterEach(() =>
{
    vi.unstubAllGlobals();
    asked = [];
});

describe('bech32, in the direction staking needs', () =>
{
    it('encodes twenty bytes back to the address they came from', () =>
    {
        // The inverse of the decode governance.spec.ts pins, against the same two real addresses:
        // a round trip through both halves is what says the checksum and the bit packing agree.
        expect(hexToBech32(DELEGATOR_HEX, 'nura')).toBe(DELEGATOR);
        expect(hexToBech32('0x7b5fe22b5446f7c62ea27b8bd71cef94e03f3df2', 'nura'))
            .toBe('nura10d07y265gmmuvt4z0w9aw880jnsr700j98snzy');
        expect(bech32ToHex(hexToBech32(DELEGATOR_HEX, 'nura')!)).toBe(DELEGATOR_HEX);
    });

    it('encodes the same bytes differently under a different chain\'s prefix', () =>
    {
        // The reason the prefix is never guessed: both of these are valid, and only one of them
        // names an account on this chain.
        expect(hexToBech32(DELEGATOR_HEX, 'cosmos')).not.toBe(DELEGATOR);
        expect(bech32ToHex(hexToBech32(DELEGATOR_HEX, 'cosmos')!)).toBe(DELEGATOR_HEX);
    });

    it('refuses anything that is not twenty bytes, and refuses an empty prefix', () =>
    {
        expect(hexToBech32('0x1234', 'nura')).toBeNull();
        expect(hexToBech32(`0x${ 'ab'.repeat(21) }`, 'nura')).toBeNull();
        expect(hexToBech32('0xzz40d9300422b408ba2abf47995c87cf32763712', 'nura')).toBeNull();
        expect(hexToBech32(DELEGATOR_HEX, '')).toBeNull();
    });
});

describe('the staking overview', () =>
{
    it('reports the module, the pool and the set', async () =>
    {
        const overview = await (await api()('/api/staking')).json() as StakingOverview;

        expect(overview.enabled).toBe(true);
        expect(overview.params).toMatchObject({ unbondingTime: 1_814_400, maxValidators: 100, bondDenom: 'anura' });
        expect(overview.pool).toEqual({ bondedTokens: NURA(2_000_000n), notBondedTokens: NURA(100_000n) });
        expect(overview.node).toMatchObject({ chainId: 'nura_1020-1', height: 459_832, catchingUp: false });
        expect(overview.prefix).toBe('nura');
    });

    it('leaves a jailed validator out of the active count but not out of the set', async () =>
    {
        const overview = await (await api()('/api/staking')).json() as StakingOverview;

        // Three validators, all three bonded; one of them jailed and so not securing anything.
        expect(overview.total).toBe(3);
        expect(overview.active).toBe(2);
    });

    it('says a chain can be read without being staked on', async () =>
    {
        const readable = await (await api()('/api/staking')).json() as StakingOverview;
        expect(readable.enabled).toBe(true);
        expect(readable.writable).toBe(false);

        const both = await (await api({ writable: true })('/api/staking')).json() as StakingOverview;
        expect(both.enabled).toBe(true);
        expect(both.writable).toBe(true);
    });

    it('sends the two precompile addresses and the six selectors', async () =>
    {
        const overview = await (await api()('/api/staking')).json() as StakingOverview;

        // Two modules, two addresses - a claim sent to the staking one would go nowhere.
        expect(overview.stakingPrecompile).toBe('0x0000000000000000000000000000000000000800');
        expect(overview.distributionPrecompile).toBe('0x0000000000000000000000000000000000000801');
        // Hashed from the table rather than written down; pinned so a change to either is loud.
        expect(overview.calls.delegate).toBe('0x53266bbb');
        expect(overview.calls.undelegate).toBe('0x3edab33c');
        expect(overview.calls.withdrawRewards).toBe('0xb46a8d61');
        expect(Object.values(overview.calls).every((selector) => /^0x[0-9a-f]{8}$/.test(selector))).toBe(true);
    });

    it('is off, rather than empty, when the module\'s api does not answer', async () =>
    {
        const down = await (await api({ restDown: true })('/api/staking')).json() as StakingOverview;
        expect(down.enabled).toBe(false);
        expect(down.params).toBeNull();
        // Nothing was established about the chain's own spelling, so nothing is claimed about it.
        expect(down.prefix).toBe('');

        const gone = await (await api({ up: false })('/api/staking')).json() as StakingOverview;
        expect(gone.enabled).toBe(false);
        expect(gone.total).toBe(0);
    });

    it('falls back to a validator\'s own address for the chain prefix', async () =>
    {
        // `nuravaloper1…` carries the account prefix with `valoper` stuck on the end, so a chain
        // whose auth module is too old to state it has still said it.
        const overview = await (await api({ authPrefix: false })('/api/staking')).json() as StakingOverview;
        expect(overview.prefix).toBe('nura');
    });
});

describe('the validator list', () =>
{
    it('is ordered by stake, heaviest first', async () =>
    {
        const page = await (await api()('/api/staking/validators?status=all')).json() as ValidatorPage;

        expect(page.rows.map((row) => row.moniker)).toEqual(['alpha', 'beta', 'gamma']);
        expect(page.total).toBe(3);
    });

    it('narrows to the validators actually producing blocks', async () =>
    {
        const active = await (await api()('/api/staking/validators?status=active')).json() as ValidatorPage;
        expect(active.rows.map((row) => row.moniker)).toEqual(['alpha', 'beta']);

        const inactive = await (await api()('/api/staking/validators?status=inactive')).json() as ValidatorPage;
        expect(inactive.rows.map((row) => row.moniker)).toEqual(['gamma']);
        expect(inactive.rows[0]?.jailed).toBe(true);
        // Jailed, and STILL bonded - which is exactly why the filter cannot read the status alone.
        expect(inactive.rows[0]?.status).toBe('bonded');
    });

    it('carries the operator address in both spellings', async () =>
    {
        const page = await (await api()('/api/staking/validators?status=all')).json() as ValidatorPage;
        const alpha = page.rows.find((row) => row.moniker === 'alpha')!;

        expect(alpha.operatorAddress).toBe(ALPHA);
        // The same twenty bytes as the operator's own account, which is what makes the row a link.
        expect(alpha.accountHex).toBe(DELEGATOR_HEX);
    });

    it('keeps commission as the module\'s own fixed point', async () =>
    {
        const page = await (await api()('/api/staking/validators?status=all')).json() as ValidatorPage;
        const gamma = page.rows.find((row) => row.moniker === 'gamma')!;

        // A string, not a number: eighteen places do not survive a double, and a commission is
        // the one figure on the page a delegator is trusting.
        expect(gamma.commissionRate).toBe('0.100000000000000000');
        expect(gamma.commissionMaxRate).toBe('0.200000000000000000');
    });

    it('pages', async () =>
    {
        const page = await (await api()('/api/staking/validators?status=all&limit=2&page=2')).json() as ValidatorPage;

        expect(page.rows.map((row) => row.moniker)).toEqual(['gamma']);
        expect(page).toMatchObject({ total: 3, page: 2, pages: 2 });
    });
});

describe('one delegator\'s position', () =>
{
    const POSITION: NodeStub = {
        delegations: [
            {
                delegation: { delegator_address: DELEGATOR, validator_address: ALPHA, shares: '1000.000000000000000000' },
                balance: { denom: 'anura', amount: NURA(1_000n) }
            }
        ],
        unbonding: [
            {
                delegator_address: DELEGATOR,
                validator_address: BETA,
                entries: [
                    { creation_height: '440000', completion_time: '2026-09-20T10:00:00Z', initial_balance: NURA(50n), balance: NURA(50n) },
                    { creation_height: '441000', completion_time: '2026-09-21T10:00:00Z', initial_balance: NURA(25n), balance: NURA(25n) }
                ]
            }
        ],
        rewards: {
            rewards: [{ validator_address: ALPHA, reward: [{ denom: 'anura', amount: '1234.567800000000000000' }] }],
            total: [{ denom: 'anura', amount: '1234.567800000000000000' }]
        }
    };

    it('asks the module under the account\'s bech32 spelling', async () =>
    {
        await api(POSITION)(`/api/staking/delegations?address=${ DELEGATOR_HEX }`);

        // The browser only ever has the hex; the module is keyed on the other one. If this
        // conversion were wrong the answer would be a real account's - somebody else's.
        expect(asked.some((url) => url.includes(`/cosmos/staking/v1beta1/delegations/${ DELEGATOR }`))).toBe(true);
        expect(asked.some((url) => url.includes(`/cosmos/distribution/v1beta1/delegators/${ DELEGATOR }/rewards`))).toBe(true);
    });

    it('reports what is staked, and says so in the chain\'s own spelling', async () =>
    {
        const stake = await (await api(POSITION)(`/api/staking/delegations?address=${ DELEGATOR_HEX }`)).json() as DelegatorStake;

        expect(stake.address).toBe(DELEGATOR);
        expect(stake.delegations).toEqual([
            { validatorAddress: ALPHA, shares: '1000.000000000000000000', balance: { denom: 'anura', amount: NURA(1_000n) } }
        ]);
    });

    it('truncates a reward rather than carrying its fraction', async () =>
    {
        const stake = await (await api(POSITION)(`/api/staking/delegations?address=${ DELEGATOR_HEX }`)).json() as DelegatorStake;

        // Rewards accrue as DecCoin. Everything else on this wire is a whole number of base
        // units, and the module itself truncates when it pays - so '1234.5678' is 1234 here, and
        // never a BigInt that throws or a rounding the chain will not honour.
        expect(stake.totalRewards).toEqual([{ denom: 'anura', amount: '1234' }]);
        expect(stake.rewards[0]?.amount).toEqual([{ denom: 'anura', amount: '1234' }]);
        expect(() => BigInt(stake.totalRewards[0]!.amount)).not.toThrow();
    });

    it('gives one row per unbonding ENTRY, not per validator', async () =>
    {
        const stake = await (await api(POSITION)(`/api/staking/delegations?address=${ DELEGATOR_HEX }`)).json() as DelegatorStake;

        // Two withdrawals from the same validator are two clocks, and the creation height is the
        // only thing that tells them apart - it is also what cancelling one takes.
        expect(stake.unbonding).toHaveLength(2);
        expect(stake.unbonding.map((row) => row.creationHeight)).toEqual(['440000', '441000']);
        expect(stake.unbonding.every((row) => row.validatorAddress === BETA)).toBe(true);
    });

    it('answers an account that has staked nothing without inventing a position', async () =>
    {
        const stake = await (await api()(`/api/staking/delegations?address=${ DELEGATOR_HEX }`)).json() as DelegatorStake;

        expect(stake).toMatchObject({ address: DELEGATOR, delegations: [], unbonding: [], rewards: [], totalRewards: [] });
    });

    it('refuses what is not an address, and says so when the module is unreachable', async () =>
    {
        expect((await api()('/api/staking/delegations?address=nura1nope')).status).toBe(404);
        expect((await api()('/api/staking/delegations?address=0x1234')).status).toBe(404);
        expect((await api({ restDown: true })(`/api/staking/delegations?address=${ DELEGATOR_HEX }`)).status).toBe(404);
    });
});
