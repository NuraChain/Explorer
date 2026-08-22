// CLIENT-SAFE: the application imports this file, so it may import only the schema package.
// One declaration validates the server boundary AND types the browser client.
//
// Every chain amount crosses as a DECIMAL STRING of the smallest unit (wei), never a number: a
// uint256 does not survive a double, and an explorer that rounds someone's balance is worse than
// no explorer at all. Formatting happens once, in the UI.
import { array, boolean, enumOf, number, object, string, type Infer } from '@azerothjs/schema';

export const chainInfo = object({
    chainId: number({ int: true }),
    name: string(),
    symbol: string(),
    decimals: number({ int: true }),
    /** The PUBLIC endpoint a wallet should talk to - what "add this network" hands MetaMask. */
    rpcUrl: string(),
    /** The chain's own website. Empty when the deployment did not name one. */
    siteUrl: string(),
    /** This explorer's public url, for "view on block explorer" in a wallet. Empty = use origin. */
    explorerUrl: string()
});
export type ChainInfo = Infer<typeof chainInfo>;

export const summary = object({
    chain: chainInfo,
    /** Highest block in the INDEX, which trails the node while backfilling. */
    head: number({ int: true, min: 0 }),
    headTime: string(),
    /** Highest block on the NODE. Equal to `head` once caught up. */
    chainHead: number({ int: true, min: 0 }),
    indexed: object({
        blocks: number({ int: true, min: 0 }),
        transactions: number({ int: true, min: 0 }),
        transfers: number({ int: true, min: 0 })
    }),
    /** Mean seconds between recent blocks; 0 until there are two to measure. */
    blockTime: number({ min: 0 }),
    gasPrice: string()
});
export type Summary = Infer<typeof summary>;

/**
 * What the native coin is worth in USD, and where that figure came from.
 *
 * `usd` is a NUMBER and not a wei string, alone among the amounts here. Every other figure on this
 * wire is an exact integer of a smallest unit that a double would round; a price is a measurement
 * with a handful of significant digits and no smallest unit to lose. It crosses as what it is.
 *
 * Null - never zero - when no exchange quotes the coin, or when the one that does cannot be
 * reached. Zero is a price, and it says the coin is worthless.
 */
export const nativePrice = object({
    symbol: string(),
    usd: number().nullable(),
    /** When the reading was taken upstream. Null exactly when `usd` is. */
    at: string().nullable(),
    /** The host the figure came from, so a page can say whose price it is printing. */
    source: string()
});
export type NativePrice = Infer<typeof nativePrice>;

export const block = object({
    number: number({ int: true, min: 0 }),
    hash: string(),
    parentHash: string(),
    at: string(),
    miner: string(),
    gasUsed: string(),
    gasLimit: string(),
    baseFee: string().nullable(),
    size: number({ int: true, min: 0 }),
    txCount: number({ int: true, min: 0 })
});
export type Block = Infer<typeof block>;

/**
 * What a list of blocks can be narrowed to. `filled` is a block that carried at least one
 * transaction.
 *
 * A chain produces blocks whether or not anybody is using it, so on a quiet one the empty blocks
 * ARE the list - twenty-five rows of nothing between the reader and the two that mattered. This
 * is the narrowing that makes the block list readable on such a chain.
 */
export const BLOCK_FILTER = ['all', 'filled'] as const;
export type BlockFilter = (typeof BLOCK_FILTER)[number];

export const TX_STATUS = ['success', 'reverted', 'unknown'] as const;

/**
 * What a list of transactions can be narrowed to.
 *
 * `all` is the ABSENCE of a filter, named. A query string can only ever add a constraint, so
 * without a word for "no constraint" there is no way to take one off again - the reader who
 * clicked "reverted" would be stuck with it for the rest of the page's life.
 *
 * `unknown` is deliberately not offered. It means the node returned no receipt for a transaction,
 * not that the chain decided anything, so it is a state to REPORT and never one to ask for.
 */
export const TX_STATUS_FILTER = ['all', 'success', 'reverted'] as const;
export type TxStatusFilter = (typeof TX_STATUS_FILTER)[number];

export const transaction = object({
    hash: string(),
    blockNumber: number({ int: true, min: 0 }),
    index: number({ int: true, min: 0 }),
    from: string(),
    to: string().nullable(),
    value: string(),
    nonce: number({ int: true, min: 0 }),
    inputSize: number({ int: true, min: 0 }),
    gasUsed: string(),
    gasPrice: string(),
    /** gasUsed * gasPrice, precomputed so no caller multiplies uint256s by hand. */
    fee: string(),
    status: enumOf(TX_STATUS),
    /** Set when this transaction DEPLOYED a contract. */
    contractAddress: string().nullable(),
    at: string()
});
export type Transaction = Infer<typeof transaction>;

export const TRANSFER_KINDS = ['erc20', 'erc721', 'erc1155'] as const;

export const transfer = object({
    txHash: string(),
    logIndex: number({ int: true, min: 0 }),
    blockNumber: number({ int: true, min: 0 }),
    token: string(),
    tokenName: string(),
    tokenSymbol: string(),
    tokenDecimals: number({ int: true, min: 0 }),
    from: string(),
    to: string(),
    value: string(),
    tokenId: string().nullable(),
    kind: enumOf(TRANSFER_KINDS),
    at: string()
});
export type Transfer = Infer<typeof transfer>;

/** A paged envelope. `total` is the count BEFORE paging, so a pager can be drawn. */
export const blockPage = object({
    rows: array(block),
    total: number({ int: true, min: 0 }),
    page: number({ int: true, min: 1 }),
    pages: number({ int: true, min: 1 })
});
export type BlockPage = Infer<typeof blockPage>;

export const transactionPage = object({
    rows: array(transaction),
    total: number({ int: true, min: 0 }),
    page: number({ int: true, min: 1 }),
    pages: number({ int: true, min: 1 })
});
export type TransactionPage = Infer<typeof transactionPage>;

export const transferPage = object({
    rows: array(transfer),
    total: number({ int: true, min: 0 }),
    page: number({ int: true, min: 1 }),
    pages: number({ int: true, min: 1 })
});
export type TransferPage = Infer<typeof transferPage>;

export const account = object({
    address: string(),
    /** Live from the node, not the index - a balance must never be stale. */
    balance: string(),
    isContract: boolean(),
    txCount: number({ int: true, min: 0 }),
    transferCount: number({ int: true, min: 0 }),
    /** Native value that ARRIVED, LEFT, and was burned as fees. The flow ledger's totals. */
    flow: object({ in: string(), out: string(), fees: string() }),
    /** Set when this address is a token the index knows. */
    token: object({ name: string(), symbol: string(), decimals: number({ int: true }) }).nullable()
});
export type Account = Infer<typeof account>;

/** One row of the rich list: an address and its LIVE native balance, in wei. */
export const topAccount = object({
    address: string(),
    balance: string(),
    /**
     * Position in the WHOLE ranking, not in the page or in a search's results.
     *
     * A rank counted from the row's position on screen would restart at 1 on every page and,
     * worse, would tell a reader searching for one address that it is the richest on the chain.
     * The rank is a property of the address, so it is decided where the ranking is.
     */
    rank: number({ int: true, min: 1 })
});
export type TopAccount = Infer<typeof topAccount>;

/** The rich list, sorted highest balance first, in the same countable envelope as every list. */
export const topAccounts = object({
    rows: array(topAccount),
    total: number({ int: true, min: 0 }),
    page: number({ int: true, min: 1 }),
    pages: number({ int: true, min: 1 })
});
export type TopAccounts = Infer<typeof topAccounts>;

// --- Contracts ------------------------------------------------------------------------------
// What a deployed contract can be asked about with standard JSON-RPC and nothing else. Names come
// from a table of published signatures (see chain/signatures.ts), so a field left EMPTY means
// "not known", never "not there" - the difference matters to someone about to call one of these.

// `library` is not a state promise: it marks a function that lives on a Solidity library and is
// reached by delegatecall, so it is named but never offered as a call. See chain/signatures.ts.
export const MUTABILITY = ['view', 'pure', 'nonpayable', 'payable', 'library', 'unknown'] as const;

export const contractFunction = object({
    selector: string(),
    /** '' when no published standard claims this selector - then the selector IS the name. */
    signature: string(),
    name: string(),
    inputs: array(string()),
    /** What it answers with. Empty means it returns nothing - or that nobody has declared it. */
    outputs: array(string()),
    mutability: enumOf(MUTABILITY)
});
export type ContractFunction = Infer<typeof contractFunction>;

export const contractEvent = object({
    topic: string(),
    signature: string(),
    name: string(),
    inputs: array(string())
});
export type ContractEvent = Infer<typeof contractEvent>;

/** The answer a zero-argument getter gave, as text - a uint256 does not survive a double. */
export const contractRead = object({
    name: string(),
    signature: string(),
    type: string(),
    value: string()
});
export type ContractRead = Infer<typeof contractRead>;

export const PROXY_KINDS = ['eip1967', 'beacon', 'eip1822', 'eip1167'] as const;
export type ProxyKind = (typeof PROXY_KINDS)[number];

export const contractDetail = object({
    address: string(),
    isContract: boolean(),
    /** The runtime bytecode at THIS address; '0x' for an account that holds no code. */
    bytecode: string(),
    codeSize: number({ int: true, min: 0 }),
    /** What solc stamped into its metadata trailer. Not verification - see chain/contract.ts. */
    compiler: string(),
    metadataUri: string(),
    standards: array(string()),
    functions: array(contractFunction),
    events: array(contractEvent),
    reads: array(contractRead),
    proxy: object({ kind: enumOf(PROXY_KINDS), implementation: string() }).nullable(),
    /**
     * True when the functions above were read off the IMPLEMENTATION rather than this address. A
     * proxy's own code answers nothing; listing its two forwarding selectors would say the
     * contract does nothing, which is the opposite of true.
     */
    fromImplementation: boolean(),
    /** Who deployed it, and when. Null when the deployment is below `START_BLOCK`. */
    creation: object({
        txHash: string(),
        deployer: string(),
        blockNumber: number({ int: true, min: 0 }),
        at: string()
    }).nullable()
});
export type ContractDetail = Infer<typeof contractDetail>;

/**
 * One call, described by the caller: which function, and the arguments as TYPED TEXT.
 *
 * Text, not numbers: a uint256 argument does not survive a JSON number, and the field it came
 * from held a string anyway. The server turns each one into the ABI's value (chain/values.ts),
 * which is also where a malformed one is refused by name.
 */
export const contractCallInput = object({
    selector: string(),
    args: array(string())
});
export type ContractCallInput = Infer<typeof contractCallInput>;

export const contractCallResult = object({
    values: array(object({ type: string(), value: string() })),
    /** '' when the call returned. Otherwise why it did not - usually the revert reason. */
    error: string()
});
export type ContractCallResult = Infer<typeof contractCallResult>;

/** The calldata for a call the caller intends to SIGN. Encoded here, sent by their wallet. */
export const contractCalldata = object({ data: string() });
export type ContractCalldata = Infer<typeof contractCalldata>;

export const blockDetail = object({ block, transactions: array(transaction), total: number(), page: number(), pages: number() });
export type BlockDetail = Infer<typeof blockDetail>;

/**
 * One transaction, with a PAGE of the token transfers it emitted.
 *
 * Paged for the reason a block's transactions are: one call to a distributor emits a Transfer log
 * per recipient, and an airdrop's receipt carries hundreds of them. Shipping the lot turns a
 * detail page into a download and prints a list nobody can read to the end of.
 */
export const transactionDetail = object({ transaction, transfers: array(transfer), total: number(), page: number(), pages: number() });
export type TransactionDetail = Infer<typeof transactionDetail>;

export const SEARCH_KINDS = ['block', 'transaction', 'address', 'none'] as const;

/** What a search term turned out to be, and where to send the reader. Resolved against the index. */
export const searchResult = object({
    kind: enumOf(SEARCH_KINDS),
    path: string().nullable()
});
export type SearchResult = Infer<typeof searchResult>;

/**
 * Paging, bounded at BOTH ends.
 *
 * `page` needs a maximum for the same reason `limit` does, and it is less obvious: the handler
 * multiplies it out into an offset, and a page of 1e21 - which arrives as an ordinary-looking
 * query string and passes an integer check, because it IS integral as a double - produced an
 * offset past Number.MAX_SAFE_INTEGER. sqlite refuses to bind one of those, so the request died
 * as a 500 instead of the 422 every other malformed page gets.
 *
 * A trillion pages at the largest permitted size is an offset of 1e14: still a safe integer with
 * two orders of magnitude to spare, and far beyond any row count this index will ever hold. The
 * cap refuses the absurd without ever refusing a page somebody could really be on.
 */
const pageShape = {
    page: number({ int: true, min: 1, max: 1_000_000_000_000, coerce: true }).optional(),
    limit: number({ int: true, min: 1, max: 100, coerce: true }).optional()
};

export const pageQuery = object(pageShape);

/** A page of transactions, optionally narrowed to one outcome. Spread, because there is no
    `.extend` on a schema and re-typing the bounds above is how the two drift apart. */
export const transactionListQuery = object({ ...pageShape, status: enumOf(TX_STATUS_FILTER).optional() });

/** A page of blocks, optionally narrowed to the ones that carried something. */
export const blockListQuery = object({ ...pageShape, content: enumOf(BLOCK_FILTER).optional() });

/**
 * Which way a movement went, from the point of view of the address whose page it is.
 *
 * The address page's whole thesis is that direction is the layout, so it is also the narrowing
 * that page offers: "what did this address receive" is a different question from "what did it
 * spend", and reading one out of a ledger holding both is work the reader should not have to do.
 */
export const ADDRESS_DIRECTION = ['all', 'in', 'out'] as const;
export type AddressDirection = (typeof ADDRESS_DIRECTION)[number];

/** A page of one address's transactions, optionally narrowed to one direction. */
export const addressListQuery = object({ ...pageShape, direction: enumOf(ADDRESS_DIRECTION).optional() });

/**
 * A page of the rich list, optionally narrowed to the addresses containing `q`.
 *
 * A substring rather than an exact address: the ranking is the one list in the explorer a reader
 * scans rather than looks something up in, and the global search already answers "take me to
 * this exact address".
 */
export const accountListQuery = object({ ...pageShape, q: string().optional() });

export const searchQuery = object({ q: string() });

// --- Charts and statistics --------------------------------------------------------------------
// Everything below is DERIVED from the index and from nothing else. There is no price feed, no
// mempool subscription, no verification service and no peer crawler behind this explorer, so
// there is deliberately no market cap, no pending-transaction count, no "contracts verified" and
// no node count here. A chart of a number nobody measured is worse than no chart.

/**
 * What a series is counted in. The client formats by this and never by the key, so a new series
 * measured in something already listed needs no formatting code at all.
 *
 * `native` is wei of the chain currency; `gwei` is a wei figure the UI scales; both stay strings.
 */
export const CHART_UNITS = ['count', 'seconds', 'bytes', 'gas', 'gwei', 'percent', 'native'] as const;
export type ChartUnit = (typeof CHART_UNITS)[number];

/** Every series the page can draw, in the order it draws them. */
export const CHART_SERIES = [
    'transactions', 'blocks', 'activeAddresses', 'newAddresses', 'blockTime', 'blockSize',
    'gasPrice', 'gasUsed', 'utilization', 'fees', 'averageFee', 'transfers', 'contracts'
] as const;
export type ChartSeriesKey = (typeof CHART_SERIES)[number];

/**
 * One point of one series.
 *
 * `value` is a decimal STRING for every unit, not only for the two measured in wei. A shape that
 * is a number for eleven series and a string for the other two is the shape somebody eventually
 * formats with the wrong function - and the one they get wrong is the fee.
 */
export const chartPoint = object({ at: string(), value: string() });
export type ChartPoint = Infer<typeof chartPoint>;

export const chartSeries = object({
    key: enumOf(CHART_SERIES),
    unit: enumOf(CHART_UNITS),
    points: array(chartPoint)
});
export type ChartSeries = Infer<typeof chartSeries>;

/**
 * One headline figure: what it reads now, and how it moved.
 *
 * `change` is a RATIO against the window before it (0.058 is +5.8%), and null when there was no
 * window to compare against. Null and zero are different facts: one is "we cannot say", the other
 * is "it did not move", and a tile that prints 0% for both is lying about half of them.
 */
export const statFigure = object({ value: string(), change: number().nullable() });
export type StatFigure = Infer<typeof statFigure>;

export const chartsSummary = object({
    /** How many days of series were asked for and returned. */
    days: number({ int: true, min: 1 }),
    /** Cumulative, as of now. `change` is what the last 24 hours added, as a share of the total. */
    total: object({
        blocks: statFigure,
        transactions: statFigure,
        transfers: statFigure,
        addresses: statFigure,
        tokens: statFigure,
        contracts: statFigure
    }),
    /** The last 24 hours, each against the 24 before them. */
    day: object({
        blocks: statFigure,
        transactions: statFigure,
        transfers: statFigure,
        activeAddresses: statFigure,
        newAddresses: statFigure,
        contracts: statFigure,
        fees: statFigure,
        averageFee: statFigure,
        gasUsed: statFigure,
        utilization: statFigure,
        blockTime: statFigure
    }),
    series: array(chartSeries)
});
export type ChartsSummary = Infer<typeof chartsSummary>;

/**
 * How far back the series run.
 *
 * Capped at ninety days rather than left open: the fee series is summed row by row in BigInt (see
 * IndexStore.#feesBy), so the window is the one thing deciding how much work a request is.
 */
export const chartsQuery = object({
    days: number({ int: true, min: 1, max: 90, coerce: true }).optional()
});
