import type { BlockRow, TokenRow, TransactionRow, TransferRow } from './chain/store.ts';
import type { Block, Transaction, Transfer } from './schemas.ts';

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
