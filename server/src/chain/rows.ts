// What the index stores, and the few pure helpers that go with it.
//
// Kept apart from `store.ts` and free of every import on purpose. The row shapes and `normalize`
// are needed far from the database - the presenters, the Etherscan shim, the contract inspector,
// and through `app.ts` the application's own test suite - and none of those should load the
// database driver just to read a type or lower-case an address.

/** The ERC-20 / ERC-721 `Transfer(address,address,uint256)` topic. */
export const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

/** `TransferSingle(address,address,address,uint256,uint256)` - ERC-1155. */
export const TRANSFER_SINGLE_TOPIC = '0xc3d58168c5ae7397731d063d5bbf3d657854427343f4c083240f7aacaa2d0f62';

/** The zero address: mints and burns name it, but nothing can be spent from it. */
export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

/** Seconds in a UTC day - the bucket every series here is grouped into. */
export const DAY_SECONDS = 86_400;

export interface BlockRow
{
    number: number;
    hash: string;
    parent_hash: string;
    timestamp: number;
    miner: string;
    gas_used: string;
    gas_limit: string;
    base_fee: string | null;
    size: number;
    tx_count: number;
}

export interface TransactionRow
{
    hash: string;
    block_number: number;
    tx_index: number;
    from_addr: string;
    to_addr: string | null;
    value: string;
    nonce: number;
    input_size: number;
    gas_used: string;
    effective_gas_price: string;
    status: number;
    contract_address: string | null;
    timestamp: number;
}

export interface TransferRow
{
    tx_hash: string;
    log_index: number;
    block_number: number;
    token: string;
    from_addr: string;
    to_addr: string;
    value: string;
    token_id: string | null;
    kind: string;
    timestamp: number;
}

export interface TokenRow
{
    address: string;
    name: string;
    symbol: string;
    decimals: number;
    kind: string;
}

/** One block turned into the rows it becomes - the unit `IndexStore.insertBlocks` writes. */
export interface BlockEntry
{
    block: BlockRow;
    transactions: TransactionRow[];
    transfers: TransferRow[];
}

/** A page of rows and the size of the whole set they were cut from. */
export interface Page<T>
{
    rows: T[];
    total: number;
}

/**
 * One day of the chain, as the charts read it.
 *
 * Gas is a COUNT of gas units, not an amount of currency, so it crosses as a number: a whole day
 * of a 30M-limit chain is about 4e12, which a double holds exactly with three orders of magnitude
 * to spare. `fees` and `gasPrice` are wei and do not, so they cross as decimal strings.
 */
export interface DailyStats
{
    /** Unix day index (timestamp / 86400), so the caller can turn it back into a date. */
    day: number;
    blocks: number;
    transactions: number;
    transfers: number;
    contracts: number;
    activeAddresses: number;
    newAddresses: number;
    gasUsed: number;
    gasLimit: number;
    /** Mean bytes per block. */
    blockSize: number;
    /** Mean seconds between this day's blocks; 0 when the day held only one. */
    blockTime: number;
    /** Mean effective gas price, in wei, truncated to the wei. */
    gasPrice: string;
    /** Total fees paid that day, in wei. */
    fees: string;
}

/**
 * A day with nothing in it - the row a silent day would have had.
 *
 * Written once: statsDaily grows its rows from this, and the charts route fills the days it knows
 * the index reached with it, so the two cannot disagree about what "nothing" looks like.
 */
export function silentDay(day: number): DailyStats
{
    return {
        day, blocks: 0, transactions: 0, transfers: 0, contracts: 0,
        activeAddresses: 0, newAddresses: 0, gasUsed: 0, gasLimit: 0,
        blockSize: 0, blockTime: 0, gasPrice: '0', fees: '0'
    };
}

/** What the index holds and how far it reaches. See `IndexStore.stats`. */
export interface IndexStats
{
    blocks: number;
    transactions: number;
    transfers: number;
    /** The newest block's height and timestamp; 0 and 0 for an empty index. */
    head: number;
    headTime: number;
    /** The oldest block's timestamp; 0 for an empty index. */
    firstTime: number;
}

/** The same figures over one arbitrary window - what a headline tile compares against. */
export interface WindowStats
{
    blocks: number;
    transactions: number;
    transfers: number;
    contracts: number;
    activeAddresses: number;
    newAddresses: number;
    gasUsed: number;
    gasLimit: number;
    blockTime: number;
    /** Total fees over the window, in wei. */
    fees: string;
    /** Fees divided by transactions, in wei. '0' when the window held none. */
    averageFee: string;
}

/** Everything the index holds, counted. The cumulative half of the overview. */
export interface TotalStats
{
    blocks: number;
    transactions: number;
    transfers: number;
    addresses: number;
    tokens: number;
    contracts: number;
}

/** Native value in and out of an address, in wei - the flow ledger's totals. */
export interface Flow
{
    in: string;
    out: string;
    fees: string;
}

/** Addresses are stored and compared lower-cased; checksummed input must never miss a row. */
export function normalize(address: string): string
{
    return address.toLowerCase();
}
