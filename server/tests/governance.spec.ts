// Governance against a stubbed NODE.
//
// The fixtures are this chain's own three proposals, in the shape `/cosmos/gov/v1/proposals`
// returns them - the same json `evmd q gov proposals` prints. They go through `fetch`, because
// that is the boundary: everything below tests what the explorer does with what the node says,
// including the parts that are easy to get quietly wrong (a status name filed under the wrong
// outcome, a nanosecond timestamp, a weighted vote, an address in the chain's own spelling).
import { describe, it, expect, afterEach, vi } from 'vitest';

import { buildApp } from '../src/app.ts';
import { bech32ToHex } from '../src/chain/bech32.ts';
import { GOV_PRECOMPILE } from '../src/chain/gov.ts';
import { IndexStore } from '../src/chain/store.ts';
import type { ChainEnv, ChainGateway } from '../src/chain/client.ts';
import type { CosmosEnv } from '../src/chain/cosmos.ts';
import type { GovernanceOverview, ProposalDetail, ProposalPage } from '../src/schemas.ts';

const ENV: ChainEnv = {
    rpcUrl: 'stub', chainId: 1020, name: 'NuraChain', symbol: 'NURA', decimals: 18, siteUrl: '', explorerUrl: '',
    startBlock: 0, pollMs: 1000, batchSize: 10, concurrency: 4, rpcBatchSize: 10, dbPath: ':memory:'
};

const COSMOS: CosmosEnv = { restUrl: 'http://node.test:1317', rpcUrl: 'http://node.test:26657', timeoutMs: 1000 };

/** The proposer of all three, in the chain's own spelling and in the EVM's. */
const PROPOSER = 'nura1ftqdjvqyy26q3w32harejhy8eue8vdcjfp6r77';
const PROPOSER_HEX = '0x4ac0d9300422b408ba2abf47995c87cf32763712';
const VOTER = 'nura10d07y265gmmuvt4z0w9aw880jnsr700j98snzy';

const NURA = (whole: bigint): string => (whole * 10n ** 18n).toString();
const DEPOSIT = [{ denom: 'anura', amount: NURA(100_000n) }];
const FEE_MARKET = '/cosmos.evm.feemarket.v1.MsgUpdateParams';

const message = (baseFee: string): Record<string, unknown> => ({
    '@type': FEE_MARKET,
    authority: VOTER,
    params: { base_fee: baseFee, elasticity_multiplier: 2, base_fee_change_denominator: 8 }
});

const PROPOSALS = [
    {
        id: '3', messages: [message('45000000000000000000000000000000')],
        status: 'PROPOSAL_STATUS_VOTING_PERIOD',
        final_tally_result: { yes_count: '0', abstain_count: '0', no_count: '0', no_with_veto_count: '0' },
        submit_time: '2026-08-28T19:42:31.441216284Z', deposit_end_time: '2026-08-30T19:42:31.441216284Z',
        total_deposit: DEPOSIT, voting_start_time: '2026-08-28T19:42:31.441216284Z',
        voting_end_time: '2026-08-30T19:42:31.441216284Z', metadata: 'ipfs://',
        title: 'Increase EVM Base Fee to 45,000 Gwei',
        summary: 'Increase the Nura Chain EVM base fee from 1 Gwei to 45,000 Gwei.', proposer: PROPOSER
    },
    {
        id: '2', messages: [message('47619000000000000000000000000000')],
        status: 'PROPOSAL_STATUS_PASSED',
        final_tally_result: { yes_count: NURA(1_000_000n), abstain_count: '0', no_count: '0', no_with_veto_count: '0' },
        submit_time: '2026-08-26T07:18:33.843665051Z', deposit_end_time: '2026-08-28T07:18:33.843665051Z',
        total_deposit: DEPOSIT, voting_start_time: '2026-08-26T07:33:01.556147410Z',
        voting_end_time: '2026-08-28T07:33:01.556147410Z', metadata: 'ipfs://CID',
        title: 'Set EVM Base Fee to 47619 Gwei', summary: 'Set the base fee to 47,619 Gwei.', proposer: PROPOSER
    },
    {
        id: '1', messages: [message('47619000000000')],
        status: 'PROPOSAL_STATUS_PASSED',
        final_tally_result: { yes_count: NURA(1_000_000n), abstain_count: '0', no_count: '0', no_with_veto_count: '0' },
        submit_time: '2026-08-24T00:34:18.065105580Z', deposit_end_time: '2026-08-26T00:34:18.065105580Z',
        total_deposit: DEPOSIT, voting_start_time: '2026-08-24T00:34:18.065105580Z',
        voting_end_time: '2026-08-26T00:34:18.065105580Z', metadata: 'ipfs://CID',
        title: 'Increase EVM Base Fee to 47619 Gwei', summary: 'Increase the base fee to 47,619 Gwei.', proposer: PROPOSER
    }
];

interface NodeStub
{
    /** False is a node that is not there at all: every call fails, as a refused connection does. */
    up?: boolean;
    /** What `/tally` answers - the running count while a vote is open. */
    tally?: Record<string, string>;
    votes?: unknown[];
    deposits?: unknown[];
    /** True mounts the gov precompile, which is what lets the page offer a vote. */
    writable?: boolean;
    /** The REST api off, with CometBFT still answering: params null, so the section is off. */
    restDown?: boolean;
}

/** The node's two apis, answering over `fetch` exactly as they do in production. */
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
        if (url.includes('/cosmos/gov/v1/params/'))
        {
            return json({
                params: {
                    quorum: '0.334000000000000000', threshold: '0.500000000000000000',
                    veto_threshold: '0.334000000000000000', voting_period: '172800s',
                    max_deposit_period: '172800s', min_deposit: [{ denom: 'anura', amount: NURA(100_000n) }]
                }
            });
        }
        if (url.includes('/tally'))
        {
            return json({ tally: stub.tally ?? { yes_count: '0', abstain_count: '0', no_count: '0', no_with_veto_count: '0' } });
        }
        if (url.includes('/votes'))
        {
            const votes = stub.votes ?? [];
            return json({ votes, pagination: { total: String(votes.length) } });
        }
        if (url.includes('/deposits'))
        {
            const deposits = stub.deposits ?? [];
            return json({ deposits, pagination: { total: String(deposits.length) } });
        }
        if (url.includes('/cosmos/staking/v1beta1/pool'))
        {
            return json({ pool: { bonded_tokens: NURA(2_000_000n), not_bonded_tokens: '0' } });
        }
        const one = /\/cosmos\/gov\/v1\/proposals\/(\d+)$/.exec(url.split('?')[0] ?? '');
        if (one !== null)
        {
            const found = PROPOSALS.find((row) => row.id === one[1]);
            return found === undefined ? new Response('not found', { status: 404 }) : json({ proposal: found });
        }
        if (url.includes('/cosmos/gov/v1/proposals'))
        {
            return json({ proposals: PROPOSALS, pagination: { total: String(PROPOSALS.length) } });
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
            (address.toLowerCase() === GOV_PRECOMPILE && writable ? `0x${ '0'.repeat(64) }` : '0x')
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
});

describe('an account in both of the chain\'s spellings', () =>
{
    it('decodes a bech32 account to the twenty bytes the EVM knows', () =>
    {
        // Verified against the chain: this proposer is the account that signs most of its
        // transactions, and the explorer's address page is keyed on the hex.
        expect(bech32ToHex(PROPOSER)).toBe(PROPOSER_HEX);
        expect(bech32ToHex(VOTER)).toBe('0x7b5fe22b5446f7c62ea27b8bd71cef94e03f3df2');
    });

    it('refuses an address whose checksum does not hold', () =>
    {
        // One character changed. Decoding it anyway would link a proposal to somebody else.
        expect(bech32ToHex('nura1ftqdjvqyy26q3w32harejhy8eue8vdcjfp6r78')).toBeNull();
        expect(bech32ToHex('nura1ftqdjvqyy26q3w32harejhy8eue8vdcjfp6r7b')).toBeNull();
    });

    it('refuses what is not an address', () =>
    {
        expect(bech32ToHex('')).toBeNull();
        expect(bech32ToHex('nura1')).toBeNull();
        expect(bech32ToHex('0x4ac0d9300422b408ba2abf47995c87cf32763712')).toBeNull();
        // Mixed case is not valid bech32 - the checksum is defined over one case or the other.
        expect(bech32ToHex('Nura1ftqdjvqyy26q3w32harejhy8eue8vdcjfp6r77')).toBeNull();
    });
});

describe('a node that is not answering', () =>
{
    it('says governance is unreachable rather than showing an empty chain', async () =>
    {
        const get = api({ up: false });
        const overview = (await (await get('/api/governance')).json()) as GovernanceOverview;

        expect(overview.enabled).toBe(false);
        expect(overview.params).toBeNull();
        expect(overview.node).toBeNull();
        expect(overview.total).toBe(0);
    });

    it('says the same when only the REST api is off', async () =>
    {
        const get = api({ restDown: true });
        const overview = (await (await get('/api/governance')).json()) as GovernanceOverview;

        expect(overview.enabled).toBe(false);
        // CometBFT still answers, so the node itself is reported even then.
        expect(overview.node?.height).toBe(459_832);
        expect((await get('/api/governance/proposals/1')).status).toBe(404);
    });
});

describe('the governance overview', () =>
{
    it('counts the proposals by what became of them', async () =>
    {
        const get = api();
        const overview = (await (await get('/api/governance')).json()) as GovernanceOverview;

        expect(overview.enabled).toBe(true);
        expect(overview.total).toBe(3);
        expect(overview.passed).toBe(2);
        expect(overview.open).toBe(1);
        expect(overview.failed).toBe(0);
    });

    it('reads the module\'s parameters, turning its durations into seconds', async () =>
    {
        const get = api();
        const overview = (await (await get('/api/governance')).json()) as GovernanceOverview;

        expect(overview.params).toEqual({
            quorum: '0.334000000000000000',
            threshold: '0.500000000000000000',
            vetoThreshold: '0.334000000000000000',
            votingPeriod: 172_800,
            maxDepositPeriod: 172_800,
            minDeposit: [{ denom: 'anura', amount: NURA(100_000n) }]
        });
        expect(overview.denom).toBe('anura');
    });

    it('carries the staked supply a quorum is measured against, and the node it read from', async () =>
    {
        const get = api();
        const overview = (await (await get('/api/governance')).json()) as GovernanceOverview;

        expect(overview.bondedTokens).toBe(NURA(2_000_000n));
        expect(overview.node).toEqual({ chainId: 'nura_1020-1', height: 459_832, catchingUp: false });
    });

    it('reports reading and WRITING as the two separate facts they are', async () =>
    {
        // Reading needs the node's api; casting a vote needs the gov precompile, which is a chain
        // setting. A reader can follow a proposal either way and is told plainly when they cannot
        // act on it.
        const readOnly = (await (await api()('/api/governance')).json()) as GovernanceOverview;
        expect(readOnly.enabled).toBe(true);
        expect(readOnly.writable).toBe(false);

        const both = (await (await api({ writable: true })('/api/governance')).json()) as GovernanceOverview;
        expect(both.enabled).toBe(true);
        expect(both.writable).toBe(true);
        expect(both.precompile).toBe(GOV_PRECOMPILE);
    });
});

describe('the proposal list', () =>
{
    it('reads a proposal field for field, in both spellings of its proposer', async () =>
    {
        const get = api();
        const page = (await (await get('/api/governance/proposals')).json()) as ProposalPage;

        expect(page.total).toBe(3);
        expect(page.rows[0]).toMatchObject({
            id: '3',
            title: 'Increase EVM Base Fee to 45,000 Gwei',
            status: 'voting',
            proposer: PROPOSER,
            proposerHex: PROPOSER_HEX,
            metadata: 'ipfs://',
            totalDeposit: [{ denom: 'anura', amount: NURA(100_000n) }]
        });
    });

    it('keeps the whole message, not only which module it addresses', async () =>
    {
        const get = api();
        const page = (await (await get('/api/governance/proposals')).json()) as ProposalPage;
        const [message] = page.rows[0]!.messages;

        expect(message?.type).toBe(FEE_MARKET);
        // What it DOES is the fields inside it - a type url alone says which module changes and
        // nothing about how.
        expect(message?.body).toContain('45000000000000000000000000000000');
    });

    it('normalises the module\'s nanosecond timestamps', async () =>
    {
        const get = api();
        const page = (await (await get('/api/governance/proposals')).json()) as ProposalPage;

        expect(page.rows[0]!.submitTime).toBe('2026-08-28T19:42:31.441Z');
        expect(page.rows[0]!.votingEndTime).toBe('2026-08-30T19:42:31.441Z');
    });

    it('files each state under the outcome it belongs to', async () =>
    {
        const get = api();
        const at = async (query: string): Promise<ProposalPage> =>
            (await (await get(`/api/governance/proposals?${ query }`)).json()) as ProposalPage;

        expect((await at('status=open')).total).toBe(1);
        expect((await at('status=passed')).total).toBe(2);
        expect((await at('status=failed')).total).toBe(0);
        expect((await at('limit=2')).pages).toBe(2);
    });

    it('carries the RUNNING tally on the rows still being voted on', async () =>
    {
        // The module leaves a proposal's own tally at zero until its vote closes, so the one row
        // a reader scans for the shape of would be drawn empty. The open rows are counted live.
        const get = api({
            tally: {
                yes_count: NURA(620_000n), abstain_count: NURA(90_000n),
                no_count: NURA(240_000n), no_with_veto_count: NURA(50_000n)
            }
        });
        const page = (await (await get('/api/governance/proposals')).json()) as ProposalPage;

        const voting = page.rows.find((row) => row.status === 'voting');
        expect(voting?.tally.yes).toBe(NURA(620_000n));

        // A closed one keeps what the module wrote when it closed, not a count taken now.
        const passed = page.rows.find((row) => row.status === 'passed');
        expect(passed?.tally.yes).toBe(NURA(1_000_000n));
    });
});

describe('one proposal', () =>
{
    it('prefers the RUNNING tally over the final one while a vote is open', async () =>
    {
        const get = api({
            tally: {
                yes_count: NURA(620_000n), abstain_count: NURA(90_000n),
                no_count: NURA(240_000n), no_with_veto_count: NURA(50_000n)
            }
        });
        const detail = (await (await get('/api/governance/proposals/3')).json()) as ProposalDetail;

        expect(detail.proposal.status).toBe('voting');
        expect(detail.proposal.tally.yes).toBe(NURA(620_000n));
        expect(detail.proposal.tally.noWithVeto).toBe(NURA(50_000n));
        expect(detail.bondedTokens).toBe(NURA(2_000_000n));
    });

    it('flattens a weighted vote into the options it split across', async () =>
    {
        const get = api({
            votes: [
                { proposal_id: '3', voter: VOTER, metadata: 'split', options: [
                    { option: 'VOTE_OPTION_YES', weight: '0.600000000000000000' },
                    { option: 'VOTE_OPTION_NO', weight: '0.400000000000000000' }
                ] },
                { proposal_id: '3', voter: PROPOSER, metadata: '', options: [
                    { option: 'VOTE_OPTION_ABSTAIN', weight: '1.000000000000000000' }
                ] }
            ]
        });
        const detail = (await (await get('/api/governance/proposals/3')).json()) as ProposalDetail;

        expect(detail.votes).toEqual([
            { voter: VOTER, voterHex: '0x7b5fe22b5446f7c62ea27b8bd71cef94e03f3df2', option: 'yes', weight: '0.600000000000000000', metadata: 'split' },
            { voter: VOTER, voterHex: '0x7b5fe22b5446f7c62ea27b8bd71cef94e03f3df2', option: 'no', weight: '0.400000000000000000', metadata: 'split' },
            { voter: PROPOSER, voterHex: PROPOSER_HEX, option: 'abstain', weight: '1.000000000000000000', metadata: '' }
        ]);
        expect(detail.total).toBe(2);
    });

    it('reads an option answered as the enum\'s number as well as by name', async () =>
    {
        const get = api({
            votes: [{ proposal_id: '3', voter: VOTER, metadata: '', options: [{ option: '4', weight: '1.000000000000000000' }] }]
        });
        const detail = (await (await get('/api/governance/proposals/3')).json()) as ProposalDetail;

        expect(detail.votes[0]!.option).toBe('noWithVeto');
    });

    it('shows who has put a deposit behind it', async () =>
    {
        const get = api({
            deposits: [{ proposal_id: '3', depositor: PROPOSER, amount: [{ denom: 'anura', amount: NURA(100_000n) }] }]
        });
        const detail = (await (await get('/api/governance/proposals/3')).json()) as ProposalDetail;

        expect(detail.deposits).toEqual([{
            depositor: PROPOSER,
            depositorHex: PROPOSER_HEX,
            amount: [{ denom: 'anura', amount: NURA(100_000n) }]
        }]);
    });

    it('404s an id the module does not hold, and one that is not an id at all', async () =>
    {
        const get = api();
        expect((await get('/api/governance/proposals/999')).status).toBe(404);
        expect((await get('/api/governance/proposals/abc')).status).toBe(404);
    });

    it('exposes the governance routes on the manifest the client reads', async () =>
    {
        const get = api();
        const manifest = (await (await get('/api/_manifest')).json()) as Record<string, unknown>;
        expect(JSON.stringify(manifest)).toContain('/governance/proposals');
    });
});
