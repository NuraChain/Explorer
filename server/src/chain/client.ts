import { createPublicClient, defineChain, http, type Chain, type PublicClient } from 'viem';
import { loadConfig, num, str } from '@azerothjs/http';

// The chain this explorer indexes, described ONCE from the environment. Nothing downstream
// names a network: the store, the indexer and the API all read this, so pointing the explorer
// at a different chain is an .env edit and a re-index, never a code change.

export interface ChainEnv
{
    rpcUrl: string;
    chainId: number;
    name: string;
    symbol: string;
    decimals: number;

    /** First block the backfill reads. 0 means genesis; set it forward on a long chain. */
    startBlock: number;

    /** How often the follower asks for a new head. Set below the chain's block time. */
    pollMs: number;

    /** Blocks fetched per batched RPC round. */
    batchSize: number;

    /** Where the sqlite index lives; ':memory:' in tests. */
    dbPath: string;
}

/** Reads the chain configuration from the environment, with local-anvil defaults. */
export function loadChainEnv(): ChainEnv
{
    const config = loadConfig({
        rpcUrl: str('RPC_URL', { default: 'http://127.0.0.1:8545' }),
        chainId: num('CHAIN_ID', { default: 31337 }),
        name: str('CHAIN_NAME', { default: 'Local EVM' }),
        symbol: str('CURRENCY_SYMBOL', { default: 'ETH' }),
        decimals: num('CURRENCY_DECIMALS', { default: 18 }),
        startBlock: num('START_BLOCK', { default: 0 }),
        pollMs: num('POLL_MS', { default: 2000 }),
        batchSize: num('BATCH_SIZE', { default: 40 }),
        dbPath: str('DB_PATH', { default: '.data/index.db' })
    });
    return config;
}

/** The viem chain description for {@link ChainEnv}. */
export function describeChain(env: ChainEnv): Chain
{
    return defineChain({
        id: env.chainId,
        name: env.name,
        nativeCurrency: { name: env.symbol, symbol: env.symbol, decimals: env.decimals },
        rpcUrls: { default: { http: [env.rpcUrl] } }
    });
}

/**
 * What the indexer needs from a node. Narrow on purpose: the tests substitute a plain object
 * for it, so nothing in the sync path can reach past this and open a socket.
 */
export interface ChainGateway
{
    env: ChainEnv;

    /** The current head height. */
    head(): Promise<number>;

    /** Full blocks WITH their transactions, and the receipts for each, in one batched round. */
    range(from: number, to: number): Promise<BlockWithReceipts[]>;

    /** The hash of the genesis block - the identity of the chain behind the RPC. */
    genesisHash(): Promise<string>;

    /** An address's current native balance, in wei. */
    balance(address: string): Promise<bigint>;

    /** Whether an address holds code (a contract) rather than being an EOA. */
    isContract(address: string): Promise<boolean>;
}

/** One indexed block: the header, its transactions, and the receipt for each. */
export interface BlockWithReceipts
{
    number: number;
    hash: string;
    parentHash: string;
    timestamp: number;
    miner: string;
    gasUsed: bigint;
    gasLimit: bigint;
    baseFeePerGas: bigint | null;
    size: number;
    transactions: IndexedTransaction[];
}

export interface IndexedTransaction
{
    hash: string;
    index: number;
    from: string;
    to: string | null;
    value: bigint;
    nonce: number;
    inputSize: number;
    gasUsed: bigint;
    effectiveGasPrice: bigint;

    /** 1 for success, 0 for a reverted transaction. */
    status: number;
    contractAddress: string | null;
    logs: IndexedLog[];
}

export interface IndexedLog
{
    index: number;
    address: string;
    topics: readonly string[];
    data: string;
}

/** The receipt fields this indexer reads, shared by both node paths. */
interface ReceiptLike
{
    transactionHash: string;
    gasUsed: bigint;
    effectiveGasPrice: bigint;
    status: 'success' | 'reverted';
    contractAddress: string | null;
    logs: ReadonlyArray<{ logIndex: number | bigint; address: string; topics: readonly string[]; data: string }>;
}

/** The live implementation: one viem client, batching enabled. */
export class ChainReader implements ChainGateway
{
    public readonly env: ChainEnv;

    readonly #client: PublicClient;

    constructor(env: ChainEnv)
    {
        this.env = env;
        this.#client = createPublicClient({
            chain: describeChain(env),
            // The node accepts JSON-RPC batches, so a range of blocks costs a handful of HTTP
            // round trips rather than one per call. `wait` lets calls issued in the same tick
            // coalesce; the cap stays under typical provider batch limits.
            transport: http(env.rpcUrl, { batch: { batchSize: 20, wait: 8 } })
        }) as PublicClient;
    }

    public async head(): Promise<number>
    {
        return Number(await this.#client.getBlockNumber());
    }

    public async genesisHash(): Promise<string>
    {
        const block = await this.#client.getBlock({ blockNumber: 0n, includeTransactions: false });
        return block.hash;
    }

    public async balance(address: string): Promise<bigint>
    {
        return this.#client.getBalance({ address: address as `0x${ string }` });
    }

    public async isContract(address: string): Promise<boolean>
    {
        const code = await this.#client.getCode({ address: address as `0x${ string }` });
        return code !== undefined && code !== '0x';
    }

    /**
     * Whether the node serves `eth_getBlockReceipts`. Probed once on first use: NuraChain has
     * it, hardhat's dev node does not, and an explorer that only runs against one of those is
     * not portable. Undefined until answered.
     */
    #blockReceipts: boolean | undefined = undefined;

    /** Receipts for one block, by whichever method the node actually supports. */
    async #receiptsOf(number: number, hashes: readonly string[]): Promise<ReceiptLike[]>
    {
        if (this.#blockReceipts !== false)
        {
            try
            {
                const receipts = await this.#client.getBlockReceipts({ blockNumber: BigInt(number) });
                this.#blockReceipts = true;
                return receipts as unknown as ReceiptLike[];
            }
            catch (error)
            {
                if (this.#blockReceipts === true)
                {
                    throw error;
                }
                // First call, and the node refused it - fall through to the per-transaction
                // path for the rest of this process rather than paying the failure per block.
                this.#blockReceipts = false;
            }
        }
        return Promise.all(hashes.map(hash =>
            this.#client.getTransactionReceipt({ hash: hash as `0x${ string }` }))) as unknown as Promise<ReceiptLike[]>;
    }

    public async range(from: number, to: number): Promise<BlockWithReceipts[]>
    {
        const numbers: number[] = [];
        for (let n = from; n <= to; n++)
        {
            numbers.push(n);
        }

        // Blocks and receipts are requested for the WHOLE range at once and coalesced by the
        // transport's batching, so a range costs a handful of round trips rather than one per
        // call. Where the node offers `eth_getBlockReceipts` that is one call per block instead
        // of one per transaction - the difference between a fast backfill and an overnight one.
        const blocks = await Promise.all(numbers.map(n =>
            this.#client.getBlock({ blockNumber: BigInt(n), includeTransactions: true })));
        const receiptSets = await Promise.all(blocks.map(block =>
            this.#receiptsOf(Number(block.number), block.transactions.map(transaction => transaction.hash))));

        return blocks.map((block, at) =>
        {
            const receipts = new Map(receiptSets[at]!.map(receipt => [receipt.transactionHash, receipt]));
            return {
                number: Number(block.number),
                hash: block.hash,
                parentHash: block.parentHash,
                timestamp: Number(block.timestamp),
                miner: block.miner,
                gasUsed: block.gasUsed,
                gasLimit: block.gasLimit,
                baseFeePerGas: block.baseFeePerGas ?? null,
                size: Number(block.size),
                transactions: block.transactions.map((transaction, index) =>
                {
                    const receipt = receipts.get(transaction.hash);
                    return {
                        hash: transaction.hash,
                        index,
                        from: transaction.from,
                        to: transaction.to,
                        value: transaction.value,
                        nonce: transaction.nonce,
                        inputSize: (transaction.input.length - 2) / 2,
                        gasUsed: receipt?.gasUsed ?? 0n,
                        effectiveGasPrice: receipt?.effectiveGasPrice ?? 0n,
                        // A receipt the node did not return leaves the transaction UNKNOWN
                        // rather than silently "succeeded" - a failed transfer that reads as a
                        // successful one is the worst thing this explorer could say.
                        status: receipt === undefined ? -1 : (receipt.status === 'success' ? 1 : 0),
                        contractAddress: receipt?.contractAddress ?? null,
                        logs: (receipt?.logs ?? []).map(log => ({
                            index: Number(log.logIndex),
                            address: log.address,
                            topics: log.topics as readonly string[],
                            data: log.data
                        }))
                    };
                })
            };
        });
    }
}
