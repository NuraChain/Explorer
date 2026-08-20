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

export const TX_STATUS = ['success', 'reverted', 'unknown'] as const;

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
    balance: string()
});
export type TopAccount = Infer<typeof topAccount>;

/** The rich list, sorted highest balance first. */
export const topAccounts = object({
    rows: array(topAccount)
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

export const transactionDetail = object({ transaction, transfers: array(transfer) });
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
export const pageQuery = object({
    page: number({ int: true, min: 1, max: 1_000_000_000_000, coerce: true }).optional(),
    limit: number({ int: true, min: 1, max: 100, coerce: true }).optional()
});

export const searchQuery = object({ q: string() });
