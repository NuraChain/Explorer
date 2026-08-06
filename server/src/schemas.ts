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
