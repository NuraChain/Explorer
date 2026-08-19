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

// --- Contracts ------------------------------------------------------------------------------
// What a deployed contract can be asked about with standard JSON-RPC and nothing else. Names come
// from a table of published signatures (see chain/signatures.ts), so a field left EMPTY means
// "not known", never "not there" - the difference matters to someone about to call one of these.

export const MUTABILITY = ['view', 'pure', 'nonpayable', 'payable', 'unknown'] as const;

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

// --- Verified source ------------------------------------------------------------------------
// Published source, recompiled by this server and compared against the code on the chain. The
// distinction the rest of the contract schemas make - "not known" versus "not there" - stops
// applying to a contract that has one of these: the ABI came from the source that produced the
// deployed bytes, so a name here is the author's name for it and not a table's guess.

/**
 * How exactly the recompiled bytecode lined up with the chain.
 *
 * `full` - identical, metadata trailer included. `partial` - identical everywhere the EVM
 * executes, differing only in the trailer, which is a hash of comments, file paths and settings.
 * A partial match proves the CODE; it cannot prove that a comment in the published source
 * describes the deployed one. The page says which it has, rather than showing one badge for both.
 */
export const MATCH_KINDS = ['full', 'partial'] as const;

export const verifiedSummary = object({
    /** The contract in the sources whose bytecode matched. */
    name: string(),
    /** The long version, `0.8.24+commit.e11b9ed9` - a bare release does not pin solc's output. */
    compiler: string(),
    match: enumOf(MATCH_KINDS),
    at: string(),
    /**
     * True when the source belongs to the IMPLEMENTATION behind a proxy rather than to this
     * address. The functions listed come from there too, so the two facts have to travel together.
     */
    viaImplementation: boolean()
});
export type VerifiedSummary = Infer<typeof verifiedSummary>;

export const contractSource = object({
    /** False for every address nobody has published source for - the ordinary case. */
    verified: boolean(),
    /** Which address the source belongs to: this one, or the implementation behind it. */
    address: string(),
    summary: verifiedSummary.nullable(),
    optimizer: boolean(),
    runs: number({ int: true, min: 0 }),
    /** '' when the submission left this to the compiler's default. */
    evmVersion: string(),
    license: string(),
    files: array(object({ path: string(), content: string() })),
    /** The ABI as the compiler emitted it, for anyone who wants to script against the contract. */
    abi: string()
});
export type ContractSource = Infer<typeof contractSource>;

/** One solc build the verification form can offer. */
export const compilerOption = object({
    version: string(),
    longVersion: string(),
    /** True when the build is already on this server's disk, so choosing it downloads nothing. */
    local: boolean()
});
export type CompilerOption = Infer<typeof compilerOption>;

export const compilerList = object({
    versions: array(compilerOption),
    /**
     * True when the binaries host could not be reached. Not an error: a deployment with no
     * outbound access verifies against whatever the operator put in SOLC_DIR, and the form has to
     * say so rather than show an empty list that looks broken.
     */
    offline: boolean()
});
export type CompilerList = Infer<typeof compilerList>;

export const SUBMISSION_KINDS = ['single', 'json'] as const;

/**
 * A verification submission. Nothing in it is believed.
 *
 * Every field is a claim - which compiler, which settings, which contract - and the server checks
 * all of them at once by running that compiler over that source and comparing the result against
 * the bytes already on the chain. That is why this endpoint needs no credential: a submission
 * that does not reproduce the deployed code is refused, and one that does cannot be wrong.
 */
export const verifyInput = object({
    /** `single` wraps one file; `json` is a solc standard-json document, taken as it is. */
    kind: enumOf(SUBMISSION_KINDS),
    compiler: string(),
    /** Which contract to expect. '' tries every contract the sources declare. */
    name: string(),
    /** The name to compile the single file under; it appears in the metadata hash. */
    fileName: string(),
    source: string(),
    optimizer: boolean(),
    runs: number({ int: true, min: 0, max: 100_000_000 }),
    evmVersion: string(),
    license: string()
});
export type VerifyInput = Infer<typeof verifyInput>;

export const verifyResult = object({
    ok: boolean(),
    /** 'none' whenever `ok` is false - there is no third outcome to report. */
    match: enumOf(['full', 'partial', 'none'] as const),
    name: string(),
    message: string(),
    /** The compiler's own fatal diagnostics, verbatim. Empty when the source compiled. */
    errors: array(string())
});
export type VerifyResult = Infer<typeof verifyResult>;

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
    }).nullable(),

    /**
     * Set when source has been published for this contract AND recompiled to the deployed bytes.
     *
     * Null is the ordinary case and the one the page is designed around: without this, every name
     * below comes from a table of published signatures, and an unnamed selector is four bytes.
     * With it, the names are the ones the author wrote.
     */
    verified: verifiedSummary.nullable()
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

export const pageQuery = object({
    page: number({ int: true, min: 1, coerce: true }).optional(),
    limit: number({ int: true, min: 1, max: 100, coerce: true }).optional()
});

export const searchQuery = object({ q: string() });
