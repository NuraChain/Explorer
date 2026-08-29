import type { Logger } from '@azerothjs/logger';

import type { BlockWithReceipts, ChainGateway, IndexedLog } from './client.ts';
import { decodeGovernance, readClock, type GovernanceEvent } from './governance.ts';
import { FUNCTION_BY_SELECTOR, selectorOf } from './signatures.ts';
import {
    normalize,
    TRANSFER_SINGLE_TOPIC,
    TRANSFER_TOPIC,
    type BlockRow,
    type GovernorRow,
    type IndexStore,
    type TokenRow,
    type TransactionRow,
    type TransferRow
} from './store.ts';
import { decodeReturn, encodeCall } from './values.ts';

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

    let from = Math.max(store.cursor(chain.env.startBlock) + 1, chain.env.startBlock);
    if (from > head)
    {
        return;
    }

    const lastOf = (start: number): number => Math.min(start + chain.env.batchSize - 1, head);
    const backlog = head - from + 1;
    const startedAt = Date.now();
    let indexed = 0;

    // The NEXT range is asked for before the current one is written, so the node is answering
    // while the disk is writing instead of the two taking turns. On a remote RPC the fetch
    // dominates, and this is most of the difference between the two.
    let pending: Promise<BlockWithReceipts[]> | null = chain.range(from, lastOf(from));

    try
    {
        while (from <= head)
        {
            const to = lastOf(from);
            const blocks = await pending!;
            const ahead = to + 1;
            pending = ahead <= head ? chain.range(ahead, lastOf(ahead)) : null;

            // Decode first, describe unknown tokens second, write last. Nothing awaits inside the
            // transaction: a write transaction held open across a network call blocks every
            // reader on this database for as long as the node takes to answer.
            const prepared = blocks.map(block => prepare(block));
            const unknown = new Set(prepared.flatMap(entry => [...entry.tokens]).filter(token => !store.knownToken(token)));
            const described = await describeTokens(chain, unknown, log);

            // Governance asks the node two questions, so both are asked out here, beside the
            // token descriptions and outside the write: who this governor is, the first time one
            // is seen, and what quorum a new proposal was created under. The second cannot be
            // asked later - quorum is a function of a timepoint, and a pruned node forgets.
            const governors = await describeGovernors(chain, newGovernors(store, prepared), log);
            const quorums = await readQuorums(chain, prepared);

            store.transaction(() =>
            {
                for (const token of described)
                {
                    store.upsertToken(token);
                }
                for (const row of governors)
                {
                    store.upsertGovernor(row);
                }
                for (const entry of prepared)
                {
                    store.insertBlock(entry.block, entry.transactions, entry.transfers);
                    writeGovernance(store, entry, quorums);
                }
                store.setCursor(to);
            });

            indexed += blocks.length;
            report(log, { from, to, head, indexed, backlog, startedAt, prepared });
            from = to + 1;
        }
    }
    finally
    {
        // A batch that failed mid-flight leaves the prefetch in the air; nobody will await it.
        void pending?.catch(() => undefined);
    }
}

/** One progress line per batch, with the rate and what is left - a silent backfill looks hung. */
function report(log: Logger, at: {
    from: number; to: number; head: number; indexed: number; backlog: number; startedAt: number;
    prepared: PreparedBlock[];
}): void
{
    const seconds = Math.max(0.001, (Date.now() - at.startedAt) / 1000);
    const rate = at.indexed / seconds;
    const left = at.backlog - at.indexed;
    log.info('indexed', {
        from: at.from,
        to: at.to,
        head: at.head,
        txs: at.prepared.reduce((sum, entry) => sum + entry.transactions.length, 0),
        blocksPerSecond: Math.round(rate),
        remaining: left,
        etaSeconds: rate > 0 ? Math.round(left / rate) : null
    });
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
        const live = await chain.blockHashAt(height);
        if (live !== null && live === stored)
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

/** One governance event, with the transaction and log position that place it in the chain. */
interface PreparedGovernance
{
    event: GovernanceEvent;
    txHash: string;
    logIndex: number;
}

/** One block turned into rows, ready to write. Pure: no database, no network. */
interface PreparedBlock
{
    block: BlockRow;
    transactions: TransactionRow[];
    transfers: TransferRow[];
    tokens: Set<string>;
    governance: PreparedGovernance[];
}

/** Decodes one block - its header, transactions and token transfers - into the rows it becomes. */
function prepare(block: BlockWithReceipts): PreparedBlock
{
    const transfers: TransferRow[] = [];
    const tokens = new Set<string>();
    const governance: PreparedGovernance[] = [];

    for (const transaction of block.transactions)
    {
        for (const entry of transaction.logs)
        {
            const decoded = decodeTransfer(entry, transaction.hash, block);
            if (decoded !== null)
            {
                transfers.push(decoded);
                tokens.add(decoded.token);
                continue;
            }
            const governed = decodeGovernance(entry);
            if (governed !== null)
            {
                governance.push({ event: governed, txHash: transaction.hash.toLowerCase(), logIndex: entry.index });
            }
        }
    }

    return {
        block: {
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
        transactions: block.transactions.map(transaction => ({
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
        transfers,
        tokens,
        governance
    };
}

/** The governors in this batch that the index has never described. Address -> where it was met. */
function newGovernors(store: IndexStore, prepared: readonly PreparedBlock[]): Map<string, number>
{
    const found = new Map<string, number>();
    for (const entry of prepared)
    {
        for (const { event } of entry.governance)
        {
            if (!found.has(event.governor) && !store.knownGovernor(event.governor))
            {
                found.set(event.governor, entry.block.number);
            }
        }
    }
    return found;
}

/**
 * Who each new governor is: its name, the token it counts, how it counts, and which clock its
 * deadlines are on.
 *
 * Every one of them is optional. `IGovernor` requires none of these getters, and a governor that
 * answers none is still a governor - it emitted the event that says so - so a contract that
 * refuses every question is recorded under its address with the answers left empty.
 */
async function describeGovernors(chain: ChainGateway, found: ReadonlyMap<string, number>, log: Logger): Promise<GovernorRow[]>
{
    if (found.size === 0)
    {
        return [];
    }
    return Promise.all([...found].map(async ([address, firstBlock]): Promise<GovernorRow> =>
    {
        const [name, token, counting, clock] = await Promise.all([
            getter(chain, address, 'name()', 'string'),
            getter(chain, address, 'token()', 'address'),
            getter(chain, address, 'COUNTING_MODE()', 'string'),
            getter(chain, address, 'CLOCK_MODE()', 'string')
        ]);
        log.info('governor found', { address, name: name ?? '', block: firstBlock });
        return {
            address,
            name: name ?? '',
            token: token === null ? null : normalize(token),
            counting_mode: counting ?? '',
            clock: readClock(clock ?? ''),
            first_block: firstBlock
        };
    }));
}

/**
 * The quorum each new proposal was created under, keyed `governor:id`.
 *
 * Read at index time and stored, because `quorum(timepoint)` is a historical question: it reads
 * the votes token's supply at the snapshot, and a node that has pruned that state answers
 * nothing. Asked once, while the block is current, the figure is kept for good.
 */
async function readQuorums(chain: ChainGateway, prepared: readonly PreparedBlock[]): Promise<Map<string, string | null>>
{
    const created = prepared.flatMap(entry => entry.governance)
        .map(entry => entry.event)
        .filter(event => event.kind === 'created');

    const answers = await Promise.all(created.map(async (event) =>
    {
        const entry = FUNCTION_BY_SELECTOR.get(selectorOf('quorum(uint256)'));
        if (entry === undefined)
        {
            return [`${ event.governor }:${ event.proposalId }`, null] as const;
        }
        try
        {
            const data = await chain.call(event.governor, encodeCall(entry, [event.voteStart]));
            const [value] = decodeReturn(['uint256'], data);
            return [`${ event.governor }:${ event.proposalId }`, value?.value ?? null] as const;
        }
        catch
        {
            return [`${ event.governor }:${ event.proposalId }`, null] as const;
        }
    }));
    return new Map(answers);
}

/** One no-argument getter, decoded, or null when the contract does not answer it. */
async function getter(chain: ChainGateway, address: string, signature: string, output: string): Promise<string | null>
{
    try
    {
        const data = await chain.call(address, selectorOf(signature));
        const [value] = decodeReturn([output], data);
        return value?.value ?? null;
    }
    catch
    {
        return null;
    }
}

/**
 * One block's governance, written.
 *
 * A mark - queued, executed, canceled - updates the proposal it names and inserts nothing: a
 * proposal created below START_BLOCK has no row here, and writing one from its execution would
 * print a proposal with no proposer, no description and no votes.
 */
function writeGovernance(store: IndexStore, entry: PreparedBlock, quorums: ReadonlyMap<string, string | null>): void
{
    const touched = new Set<string>();

    for (const { event, txHash, logIndex } of entry.governance)
    {
        const key = `${ event.governor }:${ event.proposalId }`;
        if (event.kind === 'created')
        {
            store.insertProposal({
                governor: event.governor,
                proposal_id: event.proposalId,
                proposer: event.proposer,
                description: event.description,
                targets: JSON.stringify(event.targets),
                call_values: JSON.stringify(event.values),
                signatures: JSON.stringify(event.signatures),
                calldatas: JSON.stringify(event.calldatas),
                vote_start: event.voteStart,
                vote_end: event.voteEnd,
                quorum: quorums.get(key) ?? null,
                created_block: entry.block.number,
                created_tx: txHash,
                timestamp: entry.block.timestamp,
                canceled_block: null,
                canceled_tx: null,
                queued_block: null,
                queued_tx: null,
                queued_eta: null,
                executed_block: null,
                executed_tx: null,
                for_votes: '0',
                against_votes: '0',
                abstain_votes: '0',
                voters: 0
            });
            continue;
        }

        if (event.kind === 'vote')
        {
            store.insertVote({
                tx_hash: txHash,
                log_index: logIndex,
                governor: event.governor,
                proposal_id: event.proposalId,
                voter: event.voter,
                support: event.support,
                weight: event.weight,
                reason: event.reason,
                block_number: entry.block.number,
                timestamp: entry.block.timestamp
            });
            touched.add(key);
            continue;
        }

        store.markProposal({
            governor: event.governor,
            proposal_id: event.proposalId,
            kind: event.kind,
            block: entry.block.number,
            tx_hash: txHash,
            eta: event.eta
        });
    }

    for (const key of touched)
    {
        const at = key.indexOf(':');
        store.retally(key.slice(0, at), key.slice(at + 1));
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
 * Reads name/symbol/decimals for every token the batch met for the first time - all of them at
 * once, on the gateway's batching client, so a block full of new tokens costs one round of calls
 * rather than one round per token. A contract that does not answer is still recorded: it moved
 * value, so it belongs in the index under its address.
 */
async function describeTokens(chain: ChainGateway, addresses: ReadonlySet<string>, log: Logger): Promise<TokenRow[]>
{
    if (addresses.size === 0)
    {
        return [];
    }
    return Promise.all([...addresses].map(async (address): Promise<TokenRow> =>
    {
        try
        {
            const meta = await chain.tokenMetadata(address);
            return meta === null
                ? { address, name: '', symbol: '', decimals: 0, kind: 'erc20' }
                : { address, name: meta.name, symbol: meta.symbol, decimals: meta.decimals, kind: 'erc20' };
        }
        catch (error)
        {
            log.warn('token metadata unavailable', { address, error: String(error) });
            return { address, name: '', symbol: '', decimals: 0, kind: 'erc20' };
        }
    }));
}
