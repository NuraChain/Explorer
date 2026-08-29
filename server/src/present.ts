import { proposalTitle } from './chain/governance.ts';
import { FUNCTION_BY_SELECTOR } from './chain/signatures.ts';
import type { BlockRow, GovernorRow, ProposalRow, TokenRow, TransactionRow, TransferRow, VoteRow } from './chain/store.ts';
import type {
    Block,
    Governor,
    GovernorClock,
    Proposal,
    ProposalAction,
    ProposalState,
    Transaction,
    Transfer,
    Vote
} from './schemas.ts';

// Row -> wire. The index stores what the chain said; these functions decide what a reader is
// told. Amounts stay decimal strings the whole way across (see schemas.ts).

/** Seconds since the epoch -> ISO. One place, so no surface invents its own time format. */
export function iso(seconds: number): string
{
    return new Date(seconds * 1000).toISOString();
}

export function presentBlock(row: BlockRow): Block
{
    return {
        number: row.number,
        hash: row.hash,
        parentHash: row.parent_hash,
        at: iso(row.timestamp),
        miner: row.miner,
        gasUsed: row.gas_used,
        gasLimit: row.gas_limit,
        baseFee: row.base_fee,
        size: row.size,
        txCount: row.tx_count
    };
}

export function presentTransaction(row: TransactionRow): Transaction
{
    return {
        hash: row.hash,
        blockNumber: row.block_number,
        index: row.tx_index,
        from: row.from_addr,
        to: row.to_addr,
        value: row.value,
        nonce: row.nonce,
        inputSize: row.input_size,
        gasUsed: row.gas_used,
        gasPrice: row.effective_gas_price,
        // Multiplied here so nothing downstream has to do uint256 arithmetic to answer the
        // most-asked question about a transaction: what did it cost.
        fee: (BigInt(row.gas_used) * BigInt(row.effective_gas_price)).toString(),
        // A receipt the node never returned is UNKNOWN, not "success" - see client.ts.
        status: row.status === 1 ? 'success' : row.status === 0 ? 'reverted' : 'unknown',
        contractAddress: row.contract_address,
        at: iso(row.timestamp)
    };
}

export function presentTransfer(row: TransferRow, token: TokenRow | null): Transfer
{
    return {
        txHash: row.tx_hash,
        logIndex: row.log_index,
        blockNumber: row.block_number,
        token: row.token,
        // An unnamed contract keeps its address as its identity rather than an invented label.
        tokenName: token?.name ?? '',
        tokenSymbol: token?.symbol ?? '',
        tokenDecimals: token?.decimals ?? 0,
        from: row.from_addr,
        to: row.to_addr,
        value: row.value,
        tokenId: row.token_id,
        kind: row.kind === 'erc721' ? 'erc721' : row.kind === 'erc1155' ? 'erc1155' : 'erc20',
        at: iso(row.timestamp)
    };
}

/** A stored clock as the two the wire declares; anything else is a height, which is the default. */
export function clockOf(governor: GovernorRow | null): GovernorClock
{
    return governor?.clock === 'timestamp' ? 'timestamp' : 'blocknumber';
}

/**
 * Where a proposal stands, from indexed facts alone.
 *
 * The marks come first because they are decisions somebody made: a canceled proposal is canceled
 * whatever its deadline says, and an executed one is over. Only when none of them applies does
 * the clock decide - and after the deadline, the tally does, counted the way
 * `GovernorCountingSimple` counts it: for + abstain must reach the quorum, and for must beat
 * against. A governor that counts otherwise is read from the governor itself on the detail page.
 */
export function proposalStatus(row: ProposalRow, now: bigint): ProposalState
{
    if (row.canceled_block !== null)
    {
        return 'canceled';
    }
    if (row.executed_block !== null)
    {
        return 'executed';
    }
    if (row.queued_block !== null)
    {
        return 'queued';
    }
    if (now < BigInt(row.vote_start))
    {
        return 'pending';
    }
    if (now <= BigInt(row.vote_end))
    {
        return 'active';
    }
    if (row.quorum === null)
    {
        return 'closed';
    }
    const reached = BigInt(row.for_votes) + BigInt(row.abstain_votes) >= BigInt(row.quorum);
    return reached && BigInt(row.for_votes) > BigInt(row.against_votes) ? 'succeeded' : 'defeated';
}

/** The three groups a list of proposals is narrowed by. See PROPOSAL_FILTER in schemas.ts. */
export function proposalGroup(state: ProposalState): 'open' | 'passed' | 'failed'
{
    if (state === 'pending' || state === 'active')
    {
        return 'open';
    }
    return state === 'succeeded' || state === 'queued' || state === 'executed' ? 'passed' : 'failed';
}

export function presentGovernor(row: GovernorRow, proposals: number): Governor
{
    return {
        address: row.address,
        name: row.name,
        token: row.token,
        countingMode: row.counting_mode,
        clock: clockOf(row),
        firstBlock: row.first_block,
        proposals
    };
}

export function presentProposal(row: ProposalRow, governor: GovernorRow | null, now: bigint): Proposal
{
    return {
        governor: row.governor,
        governorName: governor?.name ?? '',
        id: row.proposal_id,
        proposer: row.proposer,
        title: proposalTitle(row.description),
        status: proposalStatus(row, now),
        voteStart: row.vote_start,
        voteEnd: row.vote_end,
        clock: clockOf(governor),
        forVotes: row.for_votes,
        againstVotes: row.against_votes,
        abstainVotes: row.abstain_votes,
        quorum: row.quorum,
        voters: row.voters,
        at: iso(row.timestamp),
        txHash: row.created_tx
    };
}

export function presentVote(row: VoteRow): Vote
{
    return {
        voter: row.voter,
        support: row.support,
        weight: row.weight,
        reason: row.reason,
        at: iso(row.timestamp),
        txHash: row.tx_hash
    };
}

/**
 * The calls a proposal makes, as the creation event listed them.
 *
 * The three arrays are index-aligned by the standard, but they arrive from a log rather than from
 * a type, so a short one is read as empty rather than trusted: a target with somebody else's
 * calldata beside it is the worst thing this page could print.
 */
export function presentActions(row: ProposalRow): ProposalAction[]
{
    const list = (json: string): string[] =>
    {
        try
        {
            const parsed: unknown = JSON.parse(json);
            return Array.isArray(parsed) ? parsed.map((entry) => String(entry)) : [];
        }
        catch
        {
            return [];
        }
    };

    const targets = list(row.targets);
    const values = list(row.call_values);
    const calldatas = list(row.calldatas);

    return targets.map((target, at) =>
    {
        const calldata = calldatas[at] ?? '0x';
        return {
            target,
            value: values[at] ?? '0',
            calldata,
            // Four bytes is a selector; anything shorter is a plain transfer with no call in it.
            signature: calldata.length >= 10
                ? FUNCTION_BY_SELECTOR.get(calldata.slice(0, 10).toLowerCase())?.signature ?? null
                : null
        };
    });
}

/** Mean seconds between consecutive blocks in a newest-first run; 0 with fewer than two. */
export function meanBlockTime(rows: readonly BlockRow[]): number
{
    if (rows.length < 2)
    {
        return 0;
    }
    const newest = rows[0]!.timestamp;
    const oldest = rows[rows.length - 1]!.timestamp;
    const span = newest - oldest;
    return span <= 0 ? 0 : span / (rows.length - 1);
}

/** How many pages `total` rows make at `limit` each - never zero, so a pager always has one. */
export function pageCount(total: number, limit: number): number
{
    return Math.max(1, Math.ceil(total / limit));
}

const HASH = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const DIGITS = /^\d+$/;

/**
 * What a search term LOOKS like, before the index is consulted. Shape alone separates the three
 * cases: 32 bytes is a block or transaction hash, 20 bytes is an address, digits are a height.
 */
export function classify(term: string): 'hash' | 'address' | 'height' | 'unknown'
{
    const value = term.trim();
    if (HASH.test(value))
    {
        return 'hash';
    }
    if (ADDRESS.test(value))
    {
        return 'address';
    }
    if (DIGITS.test(value))
    {
        return 'height';
    }
    return 'unknown';
}
