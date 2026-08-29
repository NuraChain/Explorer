// Governance, against a stubbed chain: logs this file writes by hand, decoded the way a node's
// would be, and read back through the same API a browser calls.
//
// Every fixture here is an ENCODED log rather than a hand-written row, because the thing worth
// testing is the decoding: a proposal is nine ABI-encoded arguments with nothing indexed, and an
// explorer that reads them a field out of place prints somebody else's proposal.
import { describe, it, expect } from 'vitest';
import { encodeAbiParameters, toEventSelector, toFunctionSelector } from 'viem';

import { buildApp } from '../src/app.ts';
import {
    decodeGovernance,
    proposalTitle,
    readClock,
    PROPOSAL_CANCELED_TOPIC,
    PROPOSAL_CREATED_TOPIC,
    PROPOSAL_EXECUTED_TOPIC,
    PROPOSAL_QUEUED_TOPIC,
    VOTE_CAST_TOPIC
} from '../src/chain/governance.ts';
import { syncOnce } from '../src/chain/indexer.ts';
import { IndexStore } from '../src/chain/store.ts';
import { proposalStatus } from '../src/present.ts';
import type { BlockWithReceipts, ChainEnv, ChainGateway, IndexedLog } from '../src/chain/client.ts';
import type { GovernanceOverview, ProposalDetail, ProposalPage } from '../src/schemas.ts';

const ENV: ChainEnv = {
    rpcUrl: 'stub', chainId: 1020, name: 'NuraChain', symbol: 'NURA', decimals: 18, siteUrl: '', explorerUrl: '',
    startBlock: 0, pollMs: 1000, batchSize: 10, concurrency: 4, rpcBatchSize: 10, dbPath: ':memory:'
};

const GOVERNOR = '0x9999999999999999999999999999999999999999';
const VOTES_TOKEN = '0x7777777777777777777777777777777777777777';
const PROPOSER = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const ALICE = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const BOB = '0xcccccccccccccccccccccccccccccccccccccccc';
const TREASURY = '0xdddddddddddddddddddddddddddddddddddddddd';

/** The id of the proposal every fixture below is about, as a uint256. */
const PROPOSAL = 12_345_678_901_234_567_890n;

const ONE = 10n ** 18n;

function topic(address: string): string
{
    return `0x${ address.slice(2).padStart(64, '0') }`;
}

/** A `ProposalCreated` log: nine arguments, none of them indexed - which is the whole difficulty. */
function created(voteStart: bigint, voteEnd: bigint, description = '# Fund the treasury\nSend it.'): IndexedLog
{
    return {
        index: 0,
        address: GOVERNOR,
        topics: [PROPOSAL_CREATED_TOPIC],
        data: encodeAbiParameters(
            [
                { type: 'uint256' }, { type: 'address' }, { type: 'address[]' }, { type: 'uint256[]' },
                { type: 'string[]' }, { type: 'bytes[]' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'string' }
            ],
            [
                PROPOSAL, PROPOSER, [TREASURY], [ONE], [''],
                // `transfer(address,uint256)` - a selector the explorer's table knows by name.
                ['0xa9059cbb'], voteStart, voteEnd, description
            ])
    };
}

function voteCast(voter: string, support: number, weight: bigint, reason = '', index = 0): IndexedLog
{
    return {
        index,
        address: GOVERNOR,
        topics: [VOTE_CAST_TOPIC, topic(voter)],
        data: encodeAbiParameters(
            [{ type: 'uint256' }, { type: 'uint8' }, { type: 'uint256' }, { type: 'string' }],
            [PROPOSAL, support, weight, reason])
    };
}

function mark(kind: 'queued' | 'executed' | 'canceled', eta = 0n): IndexedLog
{
    return kind === 'queued'
        ? {
            index: 0,
            address: GOVERNOR,
            topics: [PROPOSAL_QUEUED_TOPIC],
            data: encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }], [PROPOSAL, eta])
        }
        : {
            index: 0,
            address: GOVERNOR,
            topics: [kind === 'executed' ? PROPOSAL_EXECUTED_TOPIC : PROPOSAL_CANCELED_TOPIC],
            data: encodeAbiParameters([{ type: 'uint256' }], [PROPOSAL])
        };
}

/** One block whose single transaction emitted `logs`. */
function block(number: number, parentHash: string, hash: string, logs: IndexedLog[] = []): BlockWithReceipts
{
    return {
        number, hash, parentHash,
        timestamp: 1_700_000_000 + number * 3,
        miner: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
        gasUsed: 21_000n, gasLimit: 30_000_000n, baseFeePerGas: 1_000_000_000n, size: 500,
        transactions: [{
            hash: `0x${ String(number).padStart(4, '0') }${ '0'.repeat(60) }`,
            index: 0, from: PROPOSER, to: GOVERNOR, value: 0n, nonce: number, inputSize: 4,
            gasUsed: 21_000n, effectiveGasPrice: 1_000_000_000n, status: 1, contractAddress: null,
            logs
        }]
    };
}

/** uint256 return data, as a node hands it back. */
function word(...values: bigint[]): string
{
    return `0x${ values.map((value) => value.toString(16).padStart(64, '0')).join('') }`;
}

interface GovernorStub
{
    /** What `quorum(uint256)` answers, or null for a governor that refuses the question. */
    quorum?: bigint | null;
    /** What `state(uint256)` answers - the governor's own verdict. */
    state?: number | null;
    /** What `proposalVotes(uint256)` answers: against, for, abstain. */
    tally?: [bigint, bigint, bigint] | null;
    clock?: string;
}

/**
 * A chain that answers the four getters a governor is described by, plus the two the detail page
 * asks. Anything else reverts, which is what a contract that does not implement it would do.
 */
function stubChain(blocks: BlockWithReceipts[], stub: GovernorStub = {}): ChainGateway
{
    const answers = new Map<string, () => string>([
        [toFunctionSelector('name()'), () => encodeAbiParameters([{ type: 'string' }], ['Nura Governor'])],
        [toFunctionSelector('token()'), () => encodeAbiParameters([{ type: 'address' }], [VOTES_TOKEN])],
        [toFunctionSelector('COUNTING_MODE()'), () =>
            encodeAbiParameters([{ type: 'string' }], ['support=bravo&quorum=for,abstain'])],
        [toFunctionSelector('CLOCK_MODE()'), () =>
            encodeAbiParameters([{ type: 'string' }], [stub.clock ?? 'mode=blocknumber&from=default'])],
        [toFunctionSelector('quorum(uint256)'), () =>
        {
            const value = stub.quorum === undefined ? 3n * ONE : stub.quorum;
            if (value === null)
            {
                throw new Error('execution reverted');
            }
            return word(value);
        }],
        [toFunctionSelector('state(uint256)'), () =>
        {
            if (stub.state === null || stub.state === undefined)
            {
                throw new Error('execution reverted');
            }
            return word(BigInt(stub.state));
        }],
        [toFunctionSelector('proposalVotes(uint256)'), () =>
        {
            if (stub.tally === null || stub.tally === undefined)
            {
                throw new Error('execution reverted');
            }
            return word(...stub.tally);
        }]
    ]);

    return {
        env: ENV,
        head: async () => blocks[blocks.length - 1]?.number ?? 0,
        range: async (from, to) => blocks.filter((entry) => entry.number >= from && entry.number <= to),
        genesisHash: async () => blocks[0]?.hash ?? '0xgenesis',
        blockHashAt: async (number) => blocks.find((entry) => entry.number === number)?.hash ?? null,
        tokenMetadata: async () => null,
        balance: async () => 0n,
        isContract: async () => true,
        code: async () => '0x',
        storageAt: async () => `0x${ '0'.repeat(64) }`,
        call: async (_address, data) =>
        {
            const answer = answers.get(data.slice(0, 10));
            if (answer === undefined)
            {
                throw new Error('execution reverted');
            }
            return answer();
        }
    };
}

const silent = { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined } as never;

async function indexed(blocks: BlockWithReceipts[], stub: GovernorStub = {}): Promise<{ store: IndexStore; chain: ChainGateway }>
{
    const store = new IndexStore(':memory:');
    const chain = stubChain(blocks, stub);
    store.ensureChain(await chain.genesisHash());
    await syncOnce(store, chain, silent);
    return { store, chain };
}

/** Created at 1, voting from 2 to 4, two votes for and one against. */
const CHAIN = [
    block(0, '0x00', '0xb0'),
    block(1, '0xb0', '0xb1', [created(2n, 4n)]),
    block(2, '0xb1', '0xb2', [voteCast(ALICE, 1, 2n * ONE, 'Worth it')]),
    block(3, '0xb2', '0xb3', [voteCast(BOB, 0, 1n * ONE), voteCast(PROPOSER, 1, 1n * ONE, '', 1)])
];

describe('decoding a governor\'s logs', () =>
{
    it('reads a proposal out of nine unindexed arguments', () =>
    {
        const event = decodeGovernance(created(10n, 20n));
        expect(event).toEqual({
            kind: 'created',
            governor: GOVERNOR,
            proposalId: PROPOSAL.toString(),
            proposer: PROPOSER,
            targets: [TREASURY],
            values: [ONE.toString()],
            signatures: [''],
            calldatas: ['0xa9059cbb'],
            voteStart: '10',
            voteEnd: '20',
            description: '# Fund the treasury\nSend it.'
        });
    });

    it('takes the voter from the topics, where the EVM put it', () =>
    {
        const event = decodeGovernance(voteCast(ALICE, 1, 5n * ONE, 'yes'));
        expect(event).toMatchObject({ kind: 'vote', voter: ALICE, support: 1, weight: (5n * ONE).toString(), reason: 'yes' });
    });

    it('reads a queue with its eta, and the two marks that carry nothing else', () =>
    {
        expect(decodeGovernance(mark('queued', 1_700_000_500n)))
            .toMatchObject({ kind: 'queued', eta: '1700000500' });
        expect(decodeGovernance(mark('executed'))).toMatchObject({ kind: 'executed', eta: null });
        expect(decodeGovernance(mark('canceled'))).toMatchObject({ kind: 'canceled', eta: null });
    });

    it('refuses a log it cannot read rather than guessing at it', () =>
    {
        // The right topic over somebody else's bytes: a contract is free to emit an event of its
        // own with a colliding signature, and half a proposal is worse than none.
        expect(decodeGovernance({ index: 0, address: GOVERNOR, topics: [PROPOSAL_CREATED_TOPIC], data: '0x1234' })).toBeNull();
        expect(decodeGovernance({ index: 0, address: GOVERNOR, topics: ['0xdead'], data: '0x' })).toBeNull();
        // A vote with no indexed voter is not a VoteCast, whatever its first topic says.
        expect(decodeGovernance({ index: 0, address: GOVERNOR, topics: [VOTE_CAST_TOPIC], data: '0x' })).toBeNull();
    });

    it('takes a proposal\'s title from the first line of its description', () =>
    {
        expect(proposalTitle('# Fund the treasury\nSend it.')).toBe('Fund the treasury');
        expect(proposalTitle('\n\nPlain first line\nmore')).toBe('Plain first line');
        expect(proposalTitle('')).toBe('');
    });

    it('reads the clock the governor declares, and defaults to heights', () =>
    {
        expect(readClock('mode=timestamp')).toBe('timestamp');
        expect(readClock('mode=blocknumber&from=default')).toBe('blocknumber');
        expect(readClock('')).toBe('blocknumber');
    });
});

describe('indexing governance', () =>
{
    it('finds the governor from the event alone - nothing is configured', async () =>
    {
        const { store } = await indexed(CHAIN);
        const governors = store.governors();

        expect(governors).toHaveLength(1);
        expect(governors[0]).toMatchObject({
            address: GOVERNOR,
            name: 'Nura Governor',
            token: VOTES_TOKEN,
            clock: 'blocknumber',
            first_block: 1
        });
    });

    it('writes the proposal with the quorum it was created under', async () =>
    {
        const { store } = await indexed(CHAIN);
        const proposal = store.proposal(GOVERNOR, PROPOSAL.toString());

        expect(proposal).not.toBeNull();
        expect(proposal!.proposer).toBe(PROPOSER);
        expect(proposal!.vote_start).toBe('2');
        expect(proposal!.vote_end).toBe('4');
        // Asked while the block was current, and kept: `quorum(timepoint)` is a historical read.
        expect(proposal!.quorum).toBe((3n * ONE).toString());
        expect(JSON.parse(proposal!.targets)).toEqual([TREASURY]);
    });

    it('sums the tally in whole wei, not through a double', async () =>
    {
        const { store } = await indexed(CHAIN);
        const proposal = store.proposal(GOVERNOR, PROPOSAL.toString())!;

        expect(proposal.for_votes).toBe((3n * ONE).toString());
        expect(proposal.against_votes).toBe(ONE.toString());
        expect(proposal.abstain_votes).toBe('0');
        expect(proposal.voters).toBe(3);
    });

    it('keeps a weight that no double could hold', async () =>
    {
        const huge = (2n ** 200n) + 1n;
        const { store } = await indexed([
            block(0, '0x00', '0xb0'),
            block(1, '0xb0', '0xb1', [created(2n, 4n)]),
            block(2, '0xb1', '0xb2', [voteCast(ALICE, 1, huge)])
        ]);

        expect(store.proposal(GOVERNOR, PROPOSAL.toString())!.for_votes).toBe(huge.toString());
    });

    it('marks a proposal queued and executed by the transactions that did it', async () =>
    {
        const { store } = await indexed([
            ...CHAIN,
            block(4, '0xb3', '0xb4', [mark('queued', 1_700_000_500n)]),
            block(5, '0xb4', '0xb5', [mark('executed')])
        ]);
        const proposal = store.proposal(GOVERNOR, PROPOSAL.toString())!;

        expect(proposal.queued_block).toBe(4);
        expect(proposal.queued_eta).toBe('1700000500');
        expect(proposal.executed_block).toBe(5);
    });

    it('ignores a mark for a proposal it never saw created', async () =>
    {
        // The creation is below START_BLOCK. Writing a proposal from its execution would print
        // one with no proposer, no description and no votes.
        const { store } = await indexed([
            block(0, '0x00', '0xb0'),
            block(1, '0xb0', '0xb1', [mark('executed')])
        ]);

        expect(store.proposals()).toEqual([]);
        expect(store.governors()).toHaveLength(1);
    });

    it('un-counts the votes a reorg took back', async () =>
    {
        const { store, chain } = await indexed(CHAIN);
        expect(store.proposal(GOVERNOR, PROPOSAL.toString())!.for_votes).toBe((3n * ONE).toString());

        // Block 3 is un-mined: its two ballots go, and the tally is summed again from what is
        // left - the proposal itself is older than the fork and stays.
        store.rollbackFrom(3);
        const proposal = store.proposal(GOVERNOR, PROPOSAL.toString())!;

        expect(proposal.for_votes).toBe((2n * ONE).toString());
        expect(proposal.against_votes).toBe('0');
        expect(proposal.voters).toBe(1);
        expect(store.votesOfProposal(GOVERNOR, PROPOSAL.toString(), 10, 0).total).toBe(1);
        expect(chain.env.chainId).toBe(1020);
    });

    it('takes a mark off again when the block that made it is rolled back', async () =>
    {
        const { store } = await indexed([...CHAIN, block(4, '0xb3', '0xb4', [mark('executed')])]);
        expect(store.proposal(GOVERNOR, PROPOSAL.toString())!.executed_block).toBe(4);

        store.rollbackFrom(4);
        expect(store.proposal(GOVERNOR, PROPOSAL.toString())!.executed_block).toBeNull();
    });
});

describe('where a proposal stands', () =>
{
    const row = (over: Partial<Parameters<typeof proposalStatus>[0]> = {}): Parameters<typeof proposalStatus>[0] => ({
        governor: GOVERNOR, proposal_id: '1', proposer: PROPOSER, description: '', targets: '[]',
        call_values: '[]', signatures: '[]', calldatas: '[]', vote_start: '10', vote_end: '20',
        quorum: (3n * ONE).toString(), created_block: 1, created_tx: '0x', timestamp: 0,
        canceled_block: null, canceled_tx: null, queued_block: null, queued_tx: null, queued_eta: null,
        executed_block: null, executed_tx: null, for_votes: '0', against_votes: '0', abstain_votes: '0',
        voters: 0, ...over
    });

    it('reads the clock before the votes', () =>
    {
        expect(proposalStatus(row(), 5n)).toBe('pending');
        expect(proposalStatus(row(), 10n)).toBe('active');
        expect(proposalStatus(row(), 20n)).toBe('active');
    });

    it('needs the quorum reached AND the for side ahead', () =>
    {
        const passed = row({ for_votes: (4n * ONE).toString(), against_votes: ONE.toString() });
        expect(proposalStatus(passed, 21n)).toBe('succeeded');

        // Ahead, but nobody turned up: quorum counts for + abstain.
        const short = row({ for_votes: ONE.toString() });
        expect(proposalStatus(short, 21n)).toBe('defeated');

        // Quorum reached on volume, and lost anyway.
        const beaten = row({ for_votes: ONE.toString(), against_votes: (5n * ONE).toString(), abstain_votes: (3n * ONE).toString() });
        expect(proposalStatus(beaten, 21n)).toBe('defeated');
    });

    it('says CLOSED rather than defeated when the quorum is unknown', () =>
    {
        // A governor whose quorum() refused the snapshot leaves nothing to compare against, and
        // reporting a passed proposal as failed is the worst answer available.
        expect(proposalStatus(row({ quorum: null, for_votes: (9n * ONE).toString() }), 21n)).toBe('closed');
    });

    it('lets a decision somebody made outrank the clock', () =>
    {
        expect(proposalStatus(row({ canceled_block: 3 }), 15n)).toBe('canceled');
        expect(proposalStatus(row({ queued_block: 3 }), 15n)).toBe('queued');
        expect(proposalStatus(row({ queued_block: 3, executed_block: 4 }), 15n)).toBe('executed');
    });
});

describe('the governance API', () =>
{
    async function api(blocks = CHAIN, stub: GovernorStub = {}): Promise<(path: string) => Promise<Response>>
    {
        const { store, chain } = await indexed(blocks, stub);
        const app = buildApp({ dev: false, store, chain });
        return (path) => app.handle(new Request(`http://local${ path }`));
    }

    it('names the governors it found, and counts how the proposals went', async () =>
    {
        const get = await api();
        const overview = (await (await get('/api/governance')).json()) as GovernanceOverview;

        expect(overview.governors).toHaveLength(1);
        expect(overview.governors[0]).toMatchObject({ address: GOVERNOR, name: 'Nura Governor', proposals: 1 });
        expect(overview.total).toBe(1);
        // Head is block 3 and voting runs to 4, so the one proposal is still open.
        expect(overview.open).toBe(1);
    });

    it('answers with nothing at all on a chain that has no governor', async () =>
    {
        const get = await api([block(0, '0x00', '0xb0'), block(1, '0xb0', '0xb1')]);
        const overview = (await (await get('/api/governance')).json()) as GovernanceOverview;

        expect(overview.governors).toEqual([]);
        expect(overview.total).toBe(0);
    });

    it('lists proposals with the tally and the title', async () =>
    {
        const get = await api();
        const page = (await (await get('/api/governance/proposals')).json()) as ProposalPage;

        expect(page.total).toBe(1);
        expect(page.rows[0]).toMatchObject({
            id: PROPOSAL.toString(),
            title: 'Fund the treasury',
            proposer: PROPOSER,
            status: 'active',
            forVotes: (3n * ONE).toString(),
            againstVotes: ONE.toString(),
            voters: 3,
            clock: 'blocknumber'
        });
    });

    it('narrows the list by what a reader actually asks for', async () =>
    {
        const get = await api();
        const at = async (query: string): Promise<ProposalPage> =>
            (await (await get(`/api/governance/proposals?${ query }`)).json()) as ProposalPage;

        expect((await at('status=open')).total).toBe(1);
        expect((await at('status=passed')).total).toBe(0);
        expect((await at(`governor=${ GOVERNOR }`)).total).toBe(1);
        expect((await at('governor=0x0000000000000000000000000000000000000001')).total).toBe(0);
    });

    it('prefers the governor\'s own verdict and tally on the detail page', async () =>
    {
        // 4 is Succeeded. The index would derive `active` here - the deadline has not passed on
        // the indexed head - and the governor is the authority on its own proposal.
        const get = await api(CHAIN, { state: 4, tally: [ONE, 9n * ONE, 0n] });
        const detail = (await (await get(`/api/governance/proposals/${ GOVERNOR }/${ PROPOSAL }`)).json()) as ProposalDetail;

        expect(detail.liveState).toBe('succeeded');
        expect(detail.proposal.forVotes).toBe((9n * ONE).toString());
        expect(detail.proposal.status).toBe('active');
    });

    it('stands on the index when the governor answers neither', async () =>
    {
        const get = await api(CHAIN, { state: null, tally: null });
        const detail = (await (await get(`/api/governance/proposals/${ GOVERNOR }/${ PROPOSAL }`)).json()) as ProposalDetail;

        expect(detail.liveState).toBeNull();
        expect(detail.proposal.forVotes).toBe((3n * ONE).toString());
    });

    it('names the call a proposal would make, where the selector is a known one', async () =>
    {
        const get = await api();
        const detail = (await (await get(`/api/governance/proposals/${ GOVERNOR }/${ PROPOSAL }`)).json()) as ProposalDetail;

        expect(detail.actions).toEqual([{
            target: TREASURY,
            value: ONE.toString(),
            calldata: '0xa9059cbb',
            signature: 'transfer(address,uint256)'
        }]);
        expect(detail.description).toContain('Fund the treasury');
        expect(detail.token).toBe(VOTES_TOKEN);
    });

    it('pages the ballots inside the proposal, newest first', async () =>
    {
        const get = await api();
        const detail = (await (await get(`/api/governance/proposals/${ GOVERNOR }/${ PROPOSAL }?limit=2`)).json()) as ProposalDetail;

        expect(detail.total).toBe(3);
        expect(detail.pages).toBe(2);
        expect(detail.votes).toHaveLength(2);
        expect(detail.votes[0]!.at >= detail.votes[1]!.at).toBe(true);

        const second = (await (await get(`/api/governance/proposals/${ GOVERNOR }/${ PROPOSAL }?limit=2&page=2`)).json()) as ProposalDetail;
        expect(second.votes).toHaveLength(1);
        expect(second.votes[0]).toMatchObject({ voter: ALICE, support: 1, reason: 'Worth it' });
    });

    it('404s a proposal the index does not hold', async () =>
    {
        const get = await api();
        expect((await get(`/api/governance/proposals/${ GOVERNOR }/999`)).status).toBe(404);
    });

    it('measures a timestamp-clock governor against the clock it uses', async () =>
    {
        // Voting from 1_700_000_000 to 1_700_000_100, on a chain whose head is at ...009: on the
        // wall clock the proposal is live, and read as a HEIGHT the same number is years past.
        const blocks = [
            block(0, '0x00', '0xb0'),
            block(1, '0xb0', '0xb1', [created(1_700_000_000n, 1_700_000_100n)]),
            block(2, '0xb1', '0xb2', [voteCast(ALICE, 1, 9n * ONE)])
        ];
        const get = await api(blocks, { clock: 'mode=timestamp' });
        const page = (await (await get('/api/governance/proposals')).json()) as ProposalPage;

        expect(page.rows[0]!.clock).toBe('timestamp');
        expect(page.rows[0]!.status).toBe('active');
    });

    it('exposes the governance routes on the same manifest the client reads', async () =>
    {
        const get = await api();
        const manifest = (await (await get('/api/_manifest')).json()) as Record<string, unknown>;

        expect(JSON.stringify(manifest)).toContain('/governance/proposals');
    });
});

describe('the topics this file trusts', () =>
{
    it('computes each one from its signature, so none can be mistyped', () =>
    {
        expect(PROPOSAL_CREATED_TOPIC).toBe(
            toEventSelector('ProposalCreated(uint256,address,address[],uint256[],string[],bytes[],uint256,uint256,string)'));
        expect(VOTE_CAST_TOPIC).toBe(toEventSelector('VoteCast(address,uint256,uint8,uint256,string)'));
        expect(PROPOSAL_QUEUED_TOPIC).toBe(toEventSelector('ProposalQueued(uint256,uint256)'));
    });
});
