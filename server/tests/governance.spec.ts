// Governance against a stubbed gov PRECOMPILE.
//
// The fixtures below are this chain's own three proposals, as `evmd q gov proposals` prints them,
// encoded the way the precompile hands them to `eth_call`. Encoding them here rather than handing
// the server a plain object is the point: the thing worth testing is that thirteen fields of a
// nested tuple are read back in the module's order, and an explorer that shifted `status` by one
// would report a rejected proposal as a passed one.
import { describe, it, expect } from 'vitest';
import { encodeAbiParameters, toFunctionSelector } from 'viem';

import { buildApp } from '../src/app.ts';
import { GOV_PRECOMPILE, PROPOSAL_STATUS_BY_CODE, VOTE_OPTION_BY_CODE } from '../src/chain/gov.ts';
import { IndexStore } from '../src/chain/store.ts';
import type { ChainEnv, ChainGateway } from '../src/chain/client.ts';
import type { GovernanceOverview, ProposalDetail, ProposalPage } from '../src/schemas.ts';

const ENV: ChainEnv = {
    rpcUrl: 'stub', chainId: 1020, name: 'NuraChain', symbol: 'NURA', decimals: 18, siteUrl: '', explorerUrl: '',
    startBlock: 0, pollMs: 1000, batchSize: 10, concurrency: 4, rpcBatchSize: 10, dbPath: ':memory:'
};

// Typed as viem's own hex string, because these are encoded and not merely printed.
const PROPOSER: `0x${ string }` = '0x4ac0d9300422b408ba2abf47995c87cf32763712';
const VOTER: `0x${ string }` = '0x8140e993f48005a7d9b0c1e2f3a4b5c6d7e966b9';
const NURA = 10n ** 18n;

const COIN = { type: 'tuple', components: [{ type: 'string' }, { type: 'uint256' }] } as const;
const COINS = { type: 'tuple[]', components: COIN.components } as const;
const TALLY = {
    type: 'tuple',
    components: [{ type: 'string' }, { type: 'string' }, { type: 'string' }, { type: 'string' }]
} as const;
const PROPOSAL = {
    type: 'tuple',
    components: [
        { type: 'uint64' }, { type: 'string[]' }, { type: 'uint32' }, TALLY, { type: 'uint64' },
        { type: 'uint64' }, COINS, { type: 'uint64' }, { type: 'uint64' }, { type: 'string' },
        { type: 'string' }, { type: 'string' }, { type: 'address' }
    ]
} as const;
const PROPOSALS = { type: 'tuple[]', components: PROPOSAL.components } as const;
const PAGE_RESPONSE = { type: 'tuple', components: [{ type: 'bytes' }, { type: 'uint64' }] } as const;
const WEIGHTED_VOTES = {
    type: 'tuple[]',
    components: [
        { type: 'uint64' }, { type: 'address' },
        { type: 'tuple[]', components: [{ type: 'uint8' }, { type: 'string' }] }, { type: 'string' }
    ]
} as const;
const PARAMS = {
    type: 'tuple',
    components: [
        { type: 'int64' }, COINS, { type: 'int64' }, { type: 'string' }, { type: 'string' },
        { type: 'string' }, { type: 'string' }, { type: 'string' }, { type: 'string' },
        { type: 'int64' }, { type: 'string' }, COINS, { type: 'bool' }, { type: 'bool' },
        { type: 'bool' }, { type: 'string' }
    ]
} as const;

const SELECTOR = {
    params: toFunctionSelector('getParams()'),
    proposals: toFunctionSelector('getProposals(uint32,address,address,(bytes,uint64,uint64,bool,bool))'),
    proposal: toFunctionSelector('getProposal(uint64)'),
    tally: toFunctionSelector('getTallyResult(uint64)'),
    votes: toFunctionSelector('getVotes(uint64,(bytes,uint64,uint64,bool,bool))')
};

/** Seconds since the epoch, from the timestamps the module prints. */
const at = (iso: string): bigint => BigInt(Math.floor(Date.parse(iso) / 1000));

/** One ProposalData tuple, in the module's own field order. */
type Row = readonly [bigint, readonly string[], number, readonly [string, string, string, string],
    bigint, bigint, ReadonlyArray<readonly [string, bigint]>, bigint, bigint, string, string, string, `0x${ string }`];

const FEE_MARKET = '/cosmos.evm.feemarket.v1.MsgUpdateParams';
const DEPOSIT: ReadonlyArray<readonly [string, bigint]> = [['anura', 100_000n * NURA]];

/** The three proposals this chain has, exactly as `evmd q gov proposals` reports them. */
const PROPOSALS_FIXTURE: Row[] = [
    [1n, [FEE_MARKET], 3, [(1_000_000n * NURA).toString(), '0', '0', '0'],
        at('2026-08-24T00:34:18Z'), at('2026-08-26T00:34:18Z'), DEPOSIT,
        at('2026-08-24T00:34:18Z'), at('2026-08-26T00:34:18Z'),
        'ipfs://CID', 'Increase EVM Base Fee to 47619 Gwei',
        'Increase the EVM base fee from 1 Gwei to 47,619 Gwei.', PROPOSER],
    [2n, [FEE_MARKET], 3, [(1_000_000n * NURA).toString(), '0', '0', '0'],
        at('2026-08-26T07:18:33Z'), at('2026-08-28T07:18:33Z'), DEPOSIT,
        at('2026-08-26T07:33:01Z'), at('2026-08-28T07:33:01Z'),
        'ipfs://CID', 'Set EVM Base Fee to 47619 Gwei',
        'Set the Nura Chain EVM base fee to 47,619 Gwei while keeping EIP-1559 enabled.', PROPOSER],
    // Still open, so the module leaves its FINAL tally at zero - the running count is a separate
    // question, and the detail route is the one that asks it.
    [3n, [FEE_MARKET], 2, ['0', '0', '0', '0'],
        at('2026-08-28T19:42:31Z'), at('2026-08-30T19:42:31Z'), DEPOSIT,
        at('2026-08-28T19:42:31Z'), at('2026-08-30T19:42:31Z'),
        'ipfs://', 'Increase EVM Base Fee to 45,000 Gwei',
        'Increase the Nura Chain EVM base fee from 1 Gwei to 45,000 Gwei.', PROPOSER]
];

interface GovStub
{
    /** False puts the precompile back where it is on a chain that has not enabled it. */
    enabled?: boolean;
    /** What `getTallyResult` answers - the running count while a vote is open. */
    live?: readonly [string, string, string, string];
    votes?: ReadonlyArray<readonly [bigint, `0x${ string }`, ReadonlyArray<readonly [number, string]>, string]>;
}

/**
 * A chain whose only answer is the gov precompile's.
 *
 * An address with nothing mounted at it answers `0x` WITHOUT reverting, which is exactly how a
 * chain that has not enabled the precompile behaves - so `enabled: false` returns empty data
 * rather than throwing.
 */
function stubChain(stub: GovStub = {}): ChainGateway
{
    const enabled = stub.enabled !== false;
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
        call: async (address, data) =>
        {
            if (address.toLowerCase() !== GOV_PRECOMPILE || !enabled)
            {
                return '0x';
            }
            const selector = data.slice(0, 10);
            if (selector === SELECTOR.params)
            {
                return encodeAbiParameters([PARAMS], [[
                    172_800n, [['anura', 100_000n * NURA]], 172_800n,
                    '0.334000000000000000', '0.500000000000000000', '0.334000000000000000',
                    '0.100000000000000000', '0.500000000000000000', '', 86_400n,
                    '0.667000000000000000', [['anura', 200_000n * NURA]], false, false, false,
                    '0.010000000000000000'
                ]]);
            }
            if (selector === SELECTOR.proposals)
            {
                return encodeAbiParameters([PROPOSALS, PAGE_RESPONSE], [PROPOSALS_FIXTURE, ['0x', BigInt(PROPOSALS_FIXTURE.length)]]);
            }
            if (selector === SELECTOR.proposal)
            {
                const id = BigInt(`0x${ data.slice(10) }`);
                const found = PROPOSALS_FIXTURE.find((row) => row[0] === id);
                if (found === undefined)
                {
                    throw new Error('execution reverted: proposal not found');
                }
                return encodeAbiParameters([PROPOSAL], [found]);
            }
            if (selector === SELECTOR.tally)
            {
                return encodeAbiParameters([TALLY], [stub.live ?? ['0', '0', '0', '0']]);
            }
            if (selector === SELECTOR.votes)
            {
                const votes = stub.votes ?? [];
                return encodeAbiParameters([WEIGHTED_VOTES, PAGE_RESPONSE], [votes, ['0x', BigInt(votes.length)]]);
            }
            throw new Error('execution reverted');
        }
    };
}

function api(stub: GovStub = {}): (path: string) => Promise<Response>
{
    const app = buildApp({ dev: false, store: new IndexStore(':memory:'), chain: stubChain(stub) });
    return (path) => app.handle(new Request(`http://local${ path }`));
}

describe('the module\'s own numbering', () =>
{
    it('names the states in x/gov\'s order', () =>
    {
        // 1 is the deposit period and 5 is a proposal that passed and then failed to execute.
        expect(PROPOSAL_STATUS_BY_CODE).toEqual(['unspecified', 'deposit', 'voting', 'passed', 'rejected', 'failed']);
        expect(PROPOSAL_STATUS_BY_CODE[3]).toBe('passed');
        expect(PROPOSAL_STATUS_BY_CODE[4]).toBe('rejected');
    });

    it('names the vote options in the module\'s order', () =>
    {
        expect(VOTE_OPTION_BY_CODE).toEqual(['unspecified', 'yes', 'abstain', 'no', 'noWithVeto']);
    });

    it('sends every governance transaction to the precompile\'s fixed address', () =>
    {
        expect(GOV_PRECOMPILE).toBe('0x0000000000000000000000000000000000000805');
    });
});

describe('a chain that does not expose governance to the EVM', () =>
{
    it('says so, rather than showing a chain nobody proposes anything on', async () =>
    {
        const get = api({ enabled: false });
        const overview = (await (await get('/api/governance')).json()) as GovernanceOverview;

        expect(overview.enabled).toBe(false);
        expect(overview.params).toBeNull();
        expect(overview.total).toBe(0);
        expect(overview.precompile).toBe(GOV_PRECOMPILE);
    });

    it('lists nothing and 404s a proposal', async () =>
    {
        const get = api({ enabled: false });
        expect(((await (await get('/api/governance/proposals')).json()) as ProposalPage).total).toBe(0);
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

    it('reads the module\'s parameters, and the denom a deposit is made in', async () =>
    {
        const get = api();
        const overview = (await (await get('/api/governance')).json()) as GovernanceOverview;

        expect(overview.params).toMatchObject({
            quorum: '0.334000000000000000',
            threshold: '0.500000000000000000',
            vetoThreshold: '0.334000000000000000',
            votingPeriod: 172_800
        });
        expect(overview.params?.minDeposit).toEqual([{ denom: 'anura', amount: (100_000n * NURA).toString() }]);
        expect(overview.denom).toBe('anura');
    });
});

describe('the proposal list', () =>
{
    it('reads thirteen fields back in the module\'s order', async () =>
    {
        const get = api();
        const page = (await (await get('/api/governance/proposals')).json()) as ProposalPage;

        expect(page.total).toBe(3);
        expect(page.rows[0]).toEqual({
            id: '1',
            title: 'Increase EVM Base Fee to 47619 Gwei',
            summary: 'Increase the EVM base fee from 1 Gwei to 47,619 Gwei.',
            status: 'passed',
            proposer: PROPOSER,
            messages: ['/cosmos.evm.feemarket.v1.MsgUpdateParams'],
            metadata: 'ipfs://CID',
            submitTime: '2026-08-24T00:34:18.000Z',
            depositEndTime: '2026-08-26T00:34:18.000Z',
            votingStartTime: '2026-08-24T00:34:18.000Z',
            votingEndTime: '2026-08-26T00:34:18.000Z',
            totalDeposit: [{ denom: 'anura', amount: (100_000n * NURA).toString() }],
            tally: { yes: (1_000_000n * NURA).toString(), abstain: '0', no: '0', noWithVeto: '0' }
        });
    });

    it('narrows to what is still running, what carried, and what did not', async () =>
    {
        const get = api();
        const at_ = async (query: string): Promise<ProposalPage> =>
            (await (await get(`/api/governance/proposals?${ query }`)).json()) as ProposalPage;

        expect((await at_('status=open')).total).toBe(1);
        expect((await at_('status=open')).rows[0]!.status).toBe('voting');
        expect((await at_('status=passed')).total).toBe(2);
        expect((await at_('status=failed')).total).toBe(0);
    });

    it('pages in the same countable envelope as every other list', async () =>
    {
        const get = api();
        const page = (await (await get('/api/governance/proposals?limit=2')).json()) as ProposalPage;

        expect(page.rows).toHaveLength(2);
        expect(page.pages).toBe(2);
        expect(page.page).toBe(1);
    });

    it('keeps a deposit whole - a uint256 does not survive a double', async () =>
    {
        const get = api();
        const page = (await (await get('/api/governance/proposals')).json()) as ProposalPage;

        expect(page.rows[0]!.totalDeposit[0]!.amount).toBe('100000000000000000000000');
        expect(page.rows[0]!.tally.yes).toBe('1000000000000000000000000');
    });
});

describe('one proposal', () =>
{
    it('prefers the RUNNING tally over the final one while a vote is open', async () =>
    {
        // Proposal 3 is in its voting period, so the module leaves its own final tally at zero.
        // A page that printed that would report a live vote as one nobody had touched.
        const live = [(7n * NURA).toString(), (2n * NURA).toString(), (1n * NURA).toString(), '0'] as const;
        const get = api({ live });
        const detail = (await (await get('/api/governance/proposals/3')).json()) as ProposalDetail;

        expect(detail.proposal.status).toBe('voting');
        expect(detail.proposal.tally).toEqual({
            yes: (7n * NURA).toString(), abstain: (2n * NURA).toString(), no: (1n * NURA).toString(), noWithVeto: '0'
        });
    });

    it('carries the precompile and the selectors its controls encode against', async () =>
    {
        const get = api();
        const detail = (await (await get('/api/governance/proposals/1')).json()) as ProposalDetail;

        expect(detail.precompile).toBe(GOV_PRECOMPILE);
        expect(detail.calls.vote).toBe(toFunctionSelector('vote(address,uint64,uint8,string)'));
        expect(detail.calls.submitProposal).toBe(toFunctionSelector('submitProposal(address,bytes,(string,uint256)[])'));
        expect(detail.calls.deposit).toBe(toFunctionSelector('deposit(address,uint64,(string,uint256)[])'));
        expect(detail.params.quorum).toBe('0.334000000000000000');
    });

    it('flattens a weighted vote into the options it actually split across', async () =>
    {
        const get = api({
            votes: [
                [3n, VOTER, [[1, '0.600000000000000000'], [3, '0.400000000000000000']], 'split'],
                [3n, PROPOSER, [[1, '1.000000000000000000']], '']
            ]
        });
        const detail = (await (await get('/api/governance/proposals/3')).json()) as ProposalDetail;

        expect(detail.votes).toEqual([
            { voter: VOTER, option: 'yes', weight: '0.600000000000000000', metadata: 'split' },
            { voter: VOTER, option: 'no', weight: '0.400000000000000000', metadata: 'split' },
            { voter: PROPOSER, option: 'yes', weight: '1.000000000000000000', metadata: '' }
        ]);
        expect(detail.total).toBe(2);
    });

    it('404s an id the module does not hold, and one that is not an id at all', async () =>
    {
        const get = api();
        expect((await get('/api/governance/proposals/999')).status).toBe(404);
        expect((await get('/api/governance/proposals/../evil')).status).toBe(404);
    });

    it('exposes the governance routes on the manifest the client reads', async () =>
    {
        const get = api();
        const manifest = (await (await get('/api/_manifest')).json()) as Record<string, unknown>;
        expect(JSON.stringify(manifest)).toContain('/governance/proposals');
    });
});
