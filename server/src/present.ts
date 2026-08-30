import type { CosmosDeposit, CosmosProposal, CosmosVote } from './chain/cosmos.ts';
import type { BlockRow, TokenRow, TransactionRow, TransferRow } from './chain/store.ts';
import type { Block, GovDeposit, Proposal, ProposalStatus, Transaction, Transfer, Vote, VoteOption } from './schemas.ts';

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

/**
 * The module's own names for a proposal's state.
 *
 * Written down rather than derived from the string: `PROPOSAL_STATUS_FAILED` means a proposal that
 * PASSED and then failed to execute, and an explorer that guessed from the word alone would file
 * it beside the ones that were rejected.
 */
const STATUS_BY_NAME: Record<string, ProposalStatus> = {
    PROPOSAL_STATUS_UNSPECIFIED: 'unspecified',
    PROPOSAL_STATUS_DEPOSIT_PERIOD: 'deposit',
    PROPOSAL_STATUS_VOTING_PERIOD: 'voting',
    PROPOSAL_STATUS_PASSED: 'passed',
    PROPOSAL_STATUS_REJECTED: 'rejected',
    PROPOSAL_STATUS_FAILED: 'failed'
};

/** The same for a ballot. Some builds answer the enum's NUMBER, so both spellings are read. */
const OPTION_BY_NAME: Record<string, VoteOption> = {
    VOTE_OPTION_UNSPECIFIED: 'unspecified',
    VOTE_OPTION_YES: 'yes',
    VOTE_OPTION_ABSTAIN: 'abstain',
    VOTE_OPTION_NO: 'no',
    VOTE_OPTION_NO_WITH_VETO: 'noWithVeto',
    '0': 'unspecified',
    '1': 'yes',
    '2': 'abstain',
    '3': 'no',
    '4': 'noWithVeto'
};

/**
 * One of the module's timestamps as the ISO this wire uses.
 *
 * The module writes RFC3339 with nanoseconds; `Date` keeps milliseconds, which is every digit a
 * page can show. An unparseable or missing time becomes the epoch rather than `Invalid Date`,
 * because a field that renders as an error is worse than one that renders as nothing.
 */
function when(value: string): string
{
    const at = Date.parse(value);
    return new Date(Number.isNaN(at) ? 0 : at).toISOString();
}

export function presentProposal(row: CosmosProposal): Proposal
{
    return {
        id: row.id,
        title: row.title,
        summary: row.summary,
        status: STATUS_BY_NAME[row.status] ?? 'unspecified',
        proposer: row.proposer,
        proposerHex: row.proposerHex,
        messages: row.messages,
        metadata: row.metadata,
        submitTime: when(row.submitTime),
        depositEndTime: when(row.depositEndTime),
        votingStartTime: when(row.votingStartTime),
        votingEndTime: when(row.votingEndTime),
        totalDeposit: row.totalDeposit,
        tally: row.tally
    };
}

/**
 * The ballots, one row per OPTION.
 *
 * A Cosmos vote may split its weight across several options, and flattening it here is what lets
 * the page show what was actually cast rather than a first choice standing in for the rest. A
 * plain vote has one option at full weight and comes through unchanged.
 */
export function presentVotes(rows: readonly CosmosVote[]): Vote[]
{
    return rows.flatMap((row) => row.options.map((entry) => ({
        voter: row.voter,
        voterHex: row.voterHex,
        option: OPTION_BY_NAME[entry.option] ?? 'unspecified',
        weight: entry.weight,
        metadata: row.metadata
    })));
}

export function presentDeposits(rows: readonly CosmosDeposit[]): GovDeposit[]
{
    return rows.map((row) => ({ depositor: row.depositor, depositorHex: row.depositorHex, amount: row.amount }));
}

/** The three groups a list of proposals is narrowed by. See PROPOSAL_FILTER in schemas.ts. */
export function proposalGroup(status: ProposalStatus): 'open' | 'passed' | 'failed'
{
    if (status === 'deposit' || status === 'voting')
    {
        return 'open';
    }
    return status === 'passed' ? 'passed' : 'failed';
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
