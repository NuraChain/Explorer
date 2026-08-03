import { erc20Abi, createPublicClient, http } from 'viem';
import type { Logger } from '@azerothjs/logger';

import { describeChain, type BlockWithReceipts, type ChainGateway, type IndexedLog } from './client.ts';
import { normalize, TRANSFER_SINGLE_TOPIC, TRANSFER_TOPIC, type IndexStore, type TransferRow } from './store.ts';

// The sync loop: catch up from the cursor to the head in batches, then follow. Blocks are the
// unit of work rather than logs, because native value moves leave no log - and native value is
// most of "where the money went".

export interface IndexerHandle
{
    /** Resolves once the index has caught up to the head for the first time. */
    ready: Promise<void>;
    stop(): void;
}

/** How far back a reorg is allowed to rewrite before we treat the chain as unrecognisable. */
const MAX_REORG_DEPTH = 64;

export function startIndexer(store: IndexStore, chain: ChainGateway, log: Logger): IndexerHandle
{
    let running = true;
    let resolveReady = (): void => undefined;
    const ready = new Promise<void>((resolve) =>
    {
        resolveReady = resolve;
    });

    const loop = async (): Promise<void> =>
    {
        try
        {
            if (store.ensureChain(await chain.genesisHash()))
            {
                log.warn('chain changed under the index - wiped and resyncing');
            }
        }
        catch (error)
        {
            log.error('cannot reach the chain', { error: String(error) });
        }

        while (running)
        {
            try
            {
                await syncOnce(store, chain, log);
                resolveReady();
            }
            catch (error)
            {
                log.error('sync failed', { error: String(error) });
            }
            await new Promise((resolve) => setTimeout(resolve, chain.env.pollMs));
        }
    };
    void loop();

    return { ready, stop: () =>
    {
        running = false;
    } };
}

/** One catch-up pass: cursor+1 .. head, in batches, rewinding first if the chain reorganised. */
export async function syncOnce(store: IndexStore, chain: ChainGateway, log: Logger): Promise<void>
{
    const head = await chain.head();
    await rewindIfReorged(store, chain, log);

    let from = store.cursor(chain.env.startBlock) + 1;
    from = Math.max(from, chain.env.startBlock);

    while (from <= head)
    {
        const to = Math.min(from + chain.env.batchSize - 1, head);
        const blocks = await chain.range(from, to);
        for (const block of blocks)
        {
            await ingest(store, chain, block, log);
        }
        store.setCursor(to);
        if (blocks.some(block => block.transactions.length > 0))
        {
            log.info('indexed', { from, to, txs: blocks.reduce((sum, b) => sum + b.transactions.length, 0) });
        }
        from = to + 1;
    }
}

/**
 * Walks back from the cursor while the stored block's parent hash disagrees with the chain, and
 * drops everything from the first divergence. Without this an explorer keeps serving
 * transactions that were un-mined - it would report money as moved when it never was.
 */
async function rewindIfReorged(store: IndexStore, chain: ChainGateway, log: Logger): Promise<void>
{
    const cursor = store.cursor(chain.env.startBlock);
    if (cursor < chain.env.startBlock)
    {
        return;
    }

    for (let depth = 0; depth < MAX_REORG_DEPTH; depth++)
    {
        const height = cursor - depth;
        if (height < chain.env.startBlock)
        {
            return;
        }
        const stored = store.blockHash(height);
        if (stored === null)
        {
            return;
        }
        const [live] = await chain.range(height, height);
        if (live !== undefined && live.hash === stored)
        {
            if (depth > 0)
            {
                log.warn('reorg: rolling back', { from: height + 1, depth });
                store.rollbackFrom(height + 1);
                store.setCursor(height);
            }
            return;
        }
    }

    // Deeper than we are willing to reconcile: the safe read is that this is a different chain.
    log.error('reorg deeper than the reconcile window - wiping the index', { depth: MAX_REORG_DEPTH });
    store.rollbackFrom(chain.env.startBlock);
    store.setCursor(chain.env.startBlock - 1);
}

/** Folds one block - its header, transactions and decoded token transfers - into the store. */
async function ingest(store: IndexStore, chain: ChainGateway, block: BlockWithReceipts, log: Logger): Promise<void>
{
    const transfers: TransferRow[] = [];
    const tokenAddresses = new Set<string>();

    for (const transaction of block.transactions)
    {
        for (const entry of transaction.logs)
        {
            const decoded = decodeTransfer(entry, transaction.hash, block);
            if (decoded !== null)
            {
                transfers.push(decoded);
                tokenAddresses.add(decoded.token);
            }
        }
    }

    store.insertBlock(
        {
            number: block.number,
            hash: block.hash,
            parent_hash: block.parentHash,
            timestamp: block.timestamp,
            miner: normalize(block.miner),
            gas_used: block.gasUsed.toString(),
            gas_limit: block.gasLimit.toString(),
            base_fee: block.baseFeePerGas === null ? null : block.baseFeePerGas.toString(),
            size: block.size,
            tx_count: block.transactions.length
        },
        block.transactions.map(transaction => ({
            hash: transaction.hash.toLowerCase(),
            block_number: block.number,
            tx_index: transaction.index,
            from_addr: normalize(transaction.from),
            to_addr: transaction.to === null ? null : normalize(transaction.to),
            value: transaction.value.toString(),
            nonce: transaction.nonce,
            input_size: transaction.inputSize,
            gas_used: transaction.gasUsed.toString(),
            effective_gas_price: transaction.effectiveGasPrice.toString(),
            status: transaction.status,
            contract_address: transaction.contractAddress === null ? null : normalize(transaction.contractAddress),
            timestamp: block.timestamp
        })),
        transfers);

    for (const token of tokenAddresses)
    {
        if (!store.knownToken(token))
        {
            await describeToken(store, chain, token, log);
        }
    }
}

/** A `Transfer` log turned into a row, or null when the log is something else. */
function decodeTransfer(entry: IndexedLog, txHash: string, block: BlockWithReceipts): TransferRow | null
{
    const topic = entry.topics[0];
    const base = {
        tx_hash: txHash.toLowerCase(),
        log_index: entry.index,
        block_number: block.number,
        token: normalize(entry.address),
        timestamp: block.timestamp
    };

    if (topic === TRANSFER_TOPIC)
    {
        // Three indexed topics means ERC-721 (the id is indexed); two means ERC-20 (the amount
        // rides in data). Same signature, different arity - the arity IS the discriminator.
        if (entry.topics.length === 4)
        {
            return {
                ...base,
                from_addr: topicToAddress(entry.topics[1]!),
                to_addr: topicToAddress(entry.topics[2]!),
                value: '1',
                token_id: BigInt(entry.topics[3]!).toString(),
                kind: 'erc721'
            };
        }
        if (entry.topics.length === 3)
        {
            return {
                ...base,
                from_addr: topicToAddress(entry.topics[1]!),
                to_addr: topicToAddress(entry.topics[2]!),
                value: (entry.data === '0x' ? 0n : BigInt(entry.data)).toString(),
                token_id: null,
                kind: 'erc20'
            };
        }
        return null;
    }

    if (topic === TRANSFER_SINGLE_TOPIC && entry.topics.length === 4)
    {
        // data is (uint256 id, uint256 value), 32 bytes each.
        const body = entry.data.slice(2);
        if (body.length < 128)
        {
            return null;
        }
        return {
            ...base,
            from_addr: topicToAddress(entry.topics[2]!),
            to_addr: topicToAddress(entry.topics[3]!),
            value: BigInt(`0x${ body.slice(64, 128) }`).toString(),
            token_id: BigInt(`0x${ body.slice(0, 64) }`).toString(),
            kind: 'erc1155'
        };
    }

    return null;
}

/** The low 20 bytes of an indexed address topic. */
function topicToAddress(topic: string): string
{
    return `0x${ topic.slice(-40) }`.toLowerCase();
}

/**
 * Reads a token's name/symbol/decimals once, the first time it appears. A contract that does not
 * answer is still recorded - it moved value, so it belongs in the index under its address.
 */
async function describeToken(store: IndexStore, chain: ChainGateway, address: string, log: Logger): Promise<void>
{
    const fallback = { address, name: '', symbol: '', decimals: 0, kind: 'erc20' };
    try
    {
        const client = createPublicClient({ chain: describeChain(chain.env), transport: http(chain.env.rpcUrl) });
        const contract = { address: address as `0x${ string }`, abi: erc20Abi } as const;
        const [name, symbol, decimals] = await Promise.all([
            client.readContract({ ...contract, functionName: 'name' }).catch(() => ''),
            client.readContract({ ...contract, functionName: 'symbol' }).catch(() => ''),
            client.readContract({ ...contract, functionName: 'decimals' }).catch(() => 0)
        ]);
        store.upsertToken({ address, name: String(name), symbol: String(symbol), decimals: Number(decimals), kind: 'erc20' });
    }
    catch (error)
    {
        log.warn('token metadata unavailable', { address, error: String(error) });
        store.upsertToken(fallback);
    }
}
