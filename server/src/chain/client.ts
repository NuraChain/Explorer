import { createPublicClient, defineChain, erc20Abi, http, type Chain, type PublicClient } from 'viem';
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

    /** Blocks fetched per batched RPC round, and written to the index in one transaction. */
    batchSize: number;

    /** How many block reads may be in flight at once. The node's patience, not ours, sets this. */
    concurrency: number;

    /** How many JSON-RPC calls ride in one HTTP request. Providers cap this; 100 is common. */
    rpcBatchSize: number;

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
        batchSize: num('BATCH_SIZE', { default: 1000 }),
        // Measured against a remote endpoint, not guessed: a window of 1000 block reads coalesced
        // into HTTP batches of 100 ran ~3x a window of 64 into batches of 50, because the cost out
        // there is the ROUND TRIP, and a small window leaves the link idle waiting for it. Batches
        // larger than 100 lose again - providers cap the batch and the retry costs the trip twice.
        concurrency: num('RPC_CONCURRENCY', { default: 1000 }),
        rpcBatchSize: num('RPC_BATCH_SIZE', { default: 100 }),
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

    /**
     * One block's hash, header only. The reorg check runs every poll and asks nothing else, so it
     * must not drag the block's transactions and receipts across the wire to compare 32 bytes.
     */
    blockHashAt(number: number): Promise<string | null>;

    /** A token contract's name/symbol/decimals, or null when it answers none of them. */
    tokenMetadata(address: string): Promise<{ name: string; symbol: string; decimals: number } | null>;

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
            transport: http(env.rpcUrl, {
                batch: { batchSize: env.rpcBatchSize, wait: 8 },
                // A backfill that dies on one flaky response has to be restarted by hand; a
                // retried one just runs slightly longer.
                retryCount: 3,
                retryDelay: 200,
                timeout: 30_000
            })
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

    public async blockHashAt(number: number): Promise<string | null>
    {
        // Deliberately NOT caught. A node that fails to answer must not read as "this block is
        // gone": the caller is the reorg check, and its answer to a missing block is to roll the
        // index back. A dropped connection would then delete history that is perfectly fine.
        const block = await this.#client.getBlock({ blockNumber: BigInt(number), includeTransactions: false });
        return block.hash;
    }

    public async tokenMetadata(address: string): Promise<{ name: string; symbol: string; decimals: number } | null>
    {
        // On the SHARED client, so the three calls join the batch the surrounding backfill is
        // already filling instead of opening a connection of their own per token.
        const contract = { address: address as `0x${ string }`, abi: erc20Abi } as const;
        const [name, symbol, decimals] = await Promise.all([
            this.#client.readContract({ ...contract, functionName: 'name' }).catch(() => null),
            this.#client.readContract({ ...contract, functionName: 'symbol' }).catch(() => null),
            this.#client.readContract({ ...contract, functionName: 'decimals' }).catch(() => null)
        ]);
        if (name === null && symbol === null && decimals === null)
        {
            return null;
        }
        return { name: String(name ?? ''), symbol: String(symbol ?? ''), decimals: Number(decimals ?? 0) };
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

    /** Settles the `eth_getBlockReceipts` question once, on a block we have to read anyway. */
    async #probeBlockReceipts(number: number): Promise<void>
    {
        if (this.#blockReceipts !== undefined)
        {
            return;
        }
        try
        {
            await this.#client.getBlockReceipts({ blockNumber: BigInt(number) });
            this.#blockReceipts = true;
        }
        catch
        {
            // The node refused it - take the per-transaction path for the rest of this process
            // rather than paying the failure once per block.
            this.#blockReceipts = false;
        }
    }

    /** Receipts for one block, by whichever method the node actually supports. */
    async #receiptsOf(number: number, hashes: readonly string[]): Promise<ReceiptLike[]>
    {
        if (this.#blockReceipts === true)
        {
            return await this.#client.getBlockReceipts({ blockNumber: BigInt(number) }) as unknown as ReceiptLike[];
        }
        return Promise.all(hashes.map(hash =>
            this.#client.getTransactionReceipt({ hash: hash as `0x${ string }` }))) as unknown as Promise<ReceiptLike[]>;
    }

    /** One block plus its receipts, in a single wave where the node supports block receipts. */
    async #blockWithReceipts(number: number): Promise<BlockWithReceipts>
    {
        // With `eth_getBlockReceipts` the receipts are addressed by HEIGHT, so they do not have to
        // wait on the block to learn the transaction hashes: both calls go out together and the
        // block costs one round trip instead of two. That halving is per block, across the whole
        // backfill.
        const [block, receiptList] = this.#blockReceipts === true
            ? await Promise.all([
                this.#client.getBlock({ blockNumber: BigInt(number), includeTransactions: true }),
                this.#receiptsOf(number, [])
            ])
            : await (async () =>
            {
                const one = await this.#client.getBlock({ blockNumber: BigInt(number), includeTransactions: true });
                return [one, await this.#receiptsOf(number, one.transactions.map(transaction => transaction.hash))] as const;
            })();

        const receipts = new Map(receiptList.map(receipt => [receipt.transactionHash, receipt]));
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
    }

    public async range(from: number, to: number): Promise<BlockWithReceipts[]>
    {
        const numbers: number[] = [];
        for (let n = from; n <= to; n++)
        {
            numbers.push(n);
        }
        await this.#probeBlockReceipts(from);

        // Bounded, not "all at once". A batch of thousands of blocks issued in one tick puts
        // thousands of calls in the transport's queue: a public endpoint answers that with rate
        // limits and timeouts, which read as a slow index. A steady window of in-flight reads
        // keeps every HTTP batch full without ever asking for more than the node will give.
        return mapWithLimit(numbers, this.env.concurrency, n => this.#blockWithReceipts(n));
    }
}

/** `Promise.all` with a ceiling on how many run at once; results keep the input's order. */
async function mapWithLimit<T, R>(items: readonly T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]>
{
    const results = new Array<R>(items.length);
    let next = 0;
    const worker = async (): Promise<void> =>
    {
        while (next < items.length)
        {
            const at = next++;
            results[at] = await work(items[at]!);
        }
    };
    await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
    return results;
}
