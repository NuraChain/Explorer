// @vitest-environment node
//
// The sync loop's STATE TRANSITIONS. The indexer is the one component whose failures are silent:
// a cursor that advances past a block nobody wrote, a reorg that is not noticed, a token that is
// described once and never again - none of them raise anything, they just make the explorer say
// something that is not true.
//
// So the assertions here are mostly about what the index looks like AFTER a transition, and about
// what the indexer asked the node for on the way.
import { describe, it, expect } from 'vitest';

import { startIndexer, syncOnce } from '../src/chain/indexer.ts';
import type { IndexerHandle } from '../src/chain/indexer.ts';
import type { IndexStore } from '../src/chain/store.ts';
import { follow, openTestStore } from './support/database.ts';
import {
    ALICE, BOB, CAROL, MINER, TOKEN, TRANSFER_TOPIC, block, silent, stubChain, tokenBlock, topic, txHash
} from './support/fixtures.ts';
import type { BlockWithReceipts, ChainGateway } from '../src/chain/client.ts';

/** A chain of `length` linked blocks, each hash derived from its height. */
function chainOf(length: number, prefix = 'a'): BlockWithReceipts[]
{
    return Array.from({ length }, (_entry, number) =>
        block(number, number === 0 ? '0x00' : `0x${ prefix }${ number - 1 }`, `0x${ prefix }${ number }`));
}

/** Syncs `chain` into a fresh store and hands both back. */
async function sync(chain: ChainGateway): Promise<IndexStore>
{
    const store = await openTestStore();
    await syncOnce(store, chain, silent);
    return store;
}

describe('a first sync', () =>
{
    it('indexes from the genesis to the head and leaves the cursor at the head', async () =>
    {
        const blocks = chainOf(5);
        const store = await sync(stubChain(blocks));

        expect((await store.stats()).blocks).toBe(5);
        expect(await store.cursor(0)).toBe(4);
    });

    it('does nothing at all against an empty chain', async () =>
    {
        const store = await sync(stubChain([]));
        expect((await store.stats()).blocks).toBe(0);
    });

    it('starts at startBlock, leaving earlier history unindexed on purpose', async () =>
    {
        const blocks = chainOf(6);
        const store = await sync(stubChain(blocks, { env: { startBlock: 3 } }));

        expect(await store.blockByNumber(2)).toBeNull();
        expect(await store.blockByNumber(3)).not.toBeNull();
        expect((await store.stats()).blocks).toBe(3);
    });

    it('crosses batch boundaries without dropping the block on the seam', async () =>
    {
        const blocks = chainOf(25);
        const store = await sync(stubChain(blocks, { env: { batchSize: 4 } }));

        expect((await store.stats()).blocks).toBe(25);
        for (let number = 0; number < 25; number++)
        {
            expect(await store.blockByNumber(number), `block ${ number }`).not.toBeNull();
        }
    });

    it('asks for every height exactly once', async () =>
    {
        const blocks = chainOf(12);
        const asked: Array<[number, number]> = [];
        const chain = stubChain(blocks, {
            env: { batchSize: 5 },
            range: async (from, to) =>
            {
                asked.push([from, to]);
                return blocks.filter((entry) => entry.number >= from && entry.number <= to);
            }
        });
        await sync(chain);

        const covered = asked.flatMap(([from, to]) => Array.from({ length: to - from + 1 }, (_x, at) => from + at));
        expect(covered.sort((a, b) => a - b)).toEqual(Array.from({ length: 12 }, (_x, at) => at));
        expect(new Set(covered).size).toBe(covered.length);
    });
});

describe('a second sync', () =>
{
    it('does nothing when the head has not moved', async () =>
    {
        const blocks = chainOf(4);
        const chain = stubChain(blocks);
        const store = await sync(chain);

        let called = 0;
        const watched = { ...chain, range: async (from: number, to: number) =>
        {
            called++;
            return blocks.filter((entry) => entry.number >= from && entry.number <= to);
        } };

        await syncOnce(store, watched, silent);
        expect(called).toBe(0);
        expect((await store.stats()).blocks).toBe(4);
    });

    it('indexes only what is new when the head moves', async () =>
    {
        const blocks = chainOf(3);
        const store = await sync(stubChain(blocks));

        blocks.push(block(3, '0xa2', '0xa3'), block(4, '0xa3', '0xa4'));
        const asked: number[] = [];
        await syncOnce(store, stubChain(blocks, {
            range: async (from, to) =>
            {
                asked.push(from);
                return blocks.filter((entry) => entry.number >= from && entry.number <= to);
            }
        }), silent);

        expect(asked[0]).toBe(3);
        expect((await store.stats()).blocks).toBe(5);
    });

    it('is idempotent: replaying the whole chain changes no count', async () =>
    {
        const blocks = chainOf(4);
        const store = await sync(stubChain(blocks));
        const before = await store.stats();

        // Rewind the cursor and sync again - what a restart after a crash does.
        await store.setCursor(-1);
        await syncOnce(store, stubChain(blocks), silent);

        expect(await store.stats()).toEqual(before);
    });
});

describe('reorgs', () =>
{
    /** A chain that agrees with `original` up to `forkAt`, then diverges. */
    function forked(original: BlockWithReceipts[], forkAt: number): BlockWithReceipts[]
    {
        const kept = original.slice(0, forkAt).map((entry) => ({ ...entry }));
        const rebuilt = Array.from({ length: original.length - forkAt }, (_entry, at) =>
        {
            const number = forkAt + at;
            const parent = number === 0 ? '0x00' : (number === forkAt ? `0xa${ number - 1 }` : `0xz${ number - 1 }`);
            return block(number, parent, `0xz${ number }`);
        });
        return [...kept, ...rebuilt];
    }

    it('rolls back to the fork point and replaces the orphaned blocks', async () =>
    {
        const original = chainOf(6);
        const store = await sync(stubChain(original));
        expect((await store.blockByNumber(4))?.hash).toBe('0xa4');

        await syncOnce(store, stubChain(forked(original, 4)), silent);

        // Blocks 0..3 survive; 4 and 5 are the new ones.
        expect((await store.blockByNumber(3))?.hash).toBe('0xa3');
        expect((await store.blockByNumber(4))?.hash).toBe('0xz4');
        expect((await store.blockByNumber(5))?.hash).toBe('0xz5');
        expect((await store.stats()).blocks).toBe(6);
    });

    it('drops the transactions of an orphaned block instead of serving them', async () =>
    {
        // The whole point: an explorer that keeps un-mined transactions reports money as moved
        // when it never was.
        const original = chainOf(4);
        const store = await sync(stubChain(original));
        const orphan = txHash(3, 0);
        expect(await store.transactionByHash(orphan)).not.toBeNull();

        const replacement = forked(original, 3);
        // The replacement block 3 carries a different transaction.
        replacement[3]!.transactions[0]!.hash = '0xreplacement';
        await syncOnce(store, stubChain(replacement), silent);

        expect(await store.transactionByHash(orphan)).toBeNull();
        expect(await store.transactionByHash('0xreplacement')).not.toBeNull();
    });

    it('notices a one-block reorg at the very tip', async () =>
    {
        const original = chainOf(3);
        const store = await sync(stubChain(original));
        await syncOnce(store, stubChain(forked(original, 2)), silent);
        expect((await store.blockByNumber(2))?.hash).toBe('0xz2');
    });

    it('leaves an unchanged chain completely alone', async () =>
    {
        const original = chainOf(5);
        const store = await sync(stubChain(original));
        const before = await store.stats();
        await syncOnce(store, stubChain(original), silent);
        expect(await store.stats()).toEqual(before);
    });

    it('wipes back to startBlock when the divergence is deeper than the window', async () =>
    {
        // Deeper than we are willing to reconcile is not a reorg - it is a different chain, and
        // the safe read is to rebuild rather than to stitch two histories together.
        const original = chainOf(80);
        const store = await sync(stubChain(original));
        expect((await store.stats()).blocks).toBe(80);

        // Every height answers with a hash the index has never seen.
        const unrecognisable = stubChain(original, { blockHashAt: async () => '0xffff' });
        await syncOnce(store, unrecognisable, silent);

        // Rolled back to startBlock, then re-indexed from there in the same pass.
        expect(await store.blockByNumber(0)).not.toBeNull();
    });

    it('does NOT roll back when the node merely fails to answer', async () =>
    {
        // A dropped connection must not read as "this block is gone": rolling back on a null
        // would delete history that is perfectly fine.
        const original = chainOf(5);
        const store = await sync(stubChain(original));
        const before = await store.stats();

        await syncOnce(store, stubChain(original, { blockHashAt: async () => null }), silent);

        expect(await store.stats()).toEqual(before);
        expect((await store.blockByNumber(4))?.hash).toBe('0xa4');
    });
});

describe('decoding what a block contains', () =>
{
    it('records an ERC-20 transfer from a two-topic log', async () =>
    {
        const blocks = [block(0, '0x00', '0xa0'), tokenBlock(1, '0xa0', '0xa1')];
        const store = await sync(stubChain(blocks));

        const rows = (await store.transfersOfAddress(TOKEN, 10, 0)).rows;
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ kind: 'erc20', token: TOKEN, from_addr: ALICE, to_addr: BOB });
        expect(rows[0]!.token_id).toBeNull();
        expect(rows[0]!.value).toBe((10n ** 18n).toString());
    });

    it('reads a THREE-topic Transfer as ERC-721, where the arity is the discriminator', async () =>
    {
        const carrier = block(1, '0xa0', '0xa1');
        carrier.transactions[0]!.logs = [{
            index: 0,
            address: TOKEN,
            topics: [TRANSFER_TOPIC, topic(ALICE), topic(BOB), `0x${ (77n).toString(16).padStart(64, '0') }`],
            data: '0x'
        }];
        const store = await sync(stubChain([block(0, '0x00', '0xa0'), carrier]));

        const row = (await store.transfersOfAddress(TOKEN, 10, 0)).rows[0]!;
        expect(row.kind).toBe('erc721');
        expect(row.token_id).toBe('77');
        // One NFT moved, whatever the data said.
        expect(row.value).toBe('1');
    });

    it('ignores a log that is not a transfer at all', async () =>
    {
        const carrier = block(1, '0xa0', '0xa1');
        carrier.transactions[0]!.logs = [{
            index: 0,
            address: TOKEN,
            topics: ['0x' + '9'.repeat(64), topic(ALICE)],
            data: '0x'
        }];
        const store = await sync(stubChain([block(0, '0x00', '0xa0'), carrier]));
        expect((await store.stats()).transfers).toBe(0);
    });

    it('lower-cases every address it writes, so a checksummed log still matches', async () =>
    {
        const upper = ALICE.toUpperCase().replace('0X', '0x');
        // Block 0's sender is somebody else, so the count below is only the checksummed one.
        const blocks = [block(0, '0x00', '0xa0', { from: CAROL, to: BOB }), block(1, '0xa0', '0xa1', { from: upper })];
        const store = await sync(stubChain(blocks));

        expect((await store.transactionsOfAddress(ALICE, 10, 0)).total).toBe(1);
        expect((await store.transactionByHash(txHash(1, 0)))?.from_addr).toBe(ALICE);
    });

    it('keeps a receipt the node never returned as UNKNOWN rather than as success', async () =>
    {
        const blocks = [block(0, '0x00', '0xa0'), block(1, '0xa0', '0xa1', { status: -1 })];
        const store = await sync(stubChain(blocks));
        expect((await store.transactionByHash(txHash(1, 0)))?.status).toBe(-1);
    });

    it('records a contract deployment with its address and no recipient', async () =>
    {
        const blocks = [
            block(0, '0x00', '0xa0'),
            block(1, '0xa0', '0xa1', { to: null, contractAddress: CAROL })
        ];
        const store = await sync(stubChain(blocks));

        expect((await store.contractCreation(CAROL))?.hash).toBe(txHash(1, 0));
        expect((await store.transactionByHash(txHash(1, 0)))?.to_addr).toBeNull();
    });
});

describe('describing tokens', () =>
{
    it('asks the node once per token, not once per transfer', async () =>
    {
        const blocks = [
            block(0, '0x00', '0xa0'),
            tokenBlock(1, '0xa0', '0xa1'),
            tokenBlock(2, '0xa1', '0xa2'),
            tokenBlock(3, '0xa2', '0xa3')
        ];
        const asked: string[] = [];
        const store = await sync(stubChain(blocks, {
            env: { batchSize: 1 },
            tokenMetadata: async (address) =>
            {
                asked.push(address);
                return { name: 'Token', symbol: 'TKN', decimals: 18 };
            }
        }));

        expect(asked).toEqual([TOKEN]);
        expect(await store.token(TOKEN)).toMatchObject({ symbol: 'TKN', decimals: 18 });
    });

    it('still records a contract that answers none of the getters', async () =>
    {
        // It moved value, so it belongs in the index under its address - just without a name.
        const blocks = [block(0, '0x00', '0xa0'), tokenBlock(1, '0xa0', '0xa1')];
        const store = await sync(stubChain(blocks, { tokenMetadata: async () => null }));

        expect(await store.token(TOKEN)).toMatchObject({ name: '', symbol: '', decimals: 0 });
        expect((await store.stats()).transfers).toBe(1);
    });

    it('indexes the transfer even when describing the token THROWS', async () =>
    {
        // The transfer is the fact; the name is a nicety. Losing the row because a getter
        // reverted would lose history over cosmetics.
        const blocks = [block(0, '0x00', '0xa0'), tokenBlock(1, '0xa0', '0xa1')];
        const store = await sync(stubChain(blocks, {
            tokenMetadata: async () =>
            {
                throw new Error('reverted');
            }
        }));

        expect((await store.stats()).transfers).toBe(1);
        expect(await store.token(TOKEN)).not.toBeNull();
    });
});

describe('failure during a sync', () =>
{
    it('leaves the cursor where the last COMPLETE batch ended', async () =>
    {
        // The cursor and the rows move in one transaction, so a batch that dies mid-flight must
        // not advance it - the next pass has to re-read exactly what was lost.
        const blocks = chainOf(10);
        const store = await openTestStore();
        const chain = stubChain(blocks, {
            env: { batchSize: 2 },
            range: async (from, to) =>
            {
                if (from >= 4)
                {
                    throw new Error('the node stopped answering');
                }
                return blocks.filter((entry) => entry.number >= from && entry.number <= to);
            }
        });

        await expect(syncOnce(store, chain, silent)).rejects.toThrow('stopped answering');

        expect(await store.cursor(0)).toBe(3);
        expect(await store.blockByNumber(3)).not.toBeNull();
        expect(await store.blockByNumber(4)).toBeNull();
    });

    it('resumes from the cursor once the node comes back', async () =>
    {
        const blocks = chainOf(10);
        const store = await openTestStore();
        let failing = true;
        const chain = stubChain(blocks, {
            env: { batchSize: 2 },
            range: async (from, to) =>
            {
                if (failing && from >= 4)
                {
                    throw new Error('down');
                }
                return blocks.filter((entry) => entry.number >= from && entry.number <= to);
            }
        });

        await expect(syncOnce(store, chain, silent)).rejects.toThrow();
        failing = false;
        await syncOnce(store, chain, silent);

        expect((await store.stats()).blocks).toBe(10);
        expect(await store.cursor(0)).toBe(9);
    });

    it('does not leave an unhandled rejection behind from the prefetch', async () =>
    {
        // The next range is asked for before the current one is written, so a failure leaves a
        // promise in the air that nobody will await. An unhandled rejection kills the process.
        const blocks = chainOf(10);
        const store = await openTestStore();
        const rejections: unknown[] = [];
        const onRejection = (reason: unknown): void =>
        {
            rejections.push(reason);
        };
        process.on('unhandledRejection', onRejection);

        try
        {
            const chain = stubChain(blocks, {
                env: { batchSize: 2 },
                range: async (from) =>
                {
                    if (from >= 2)
                    {
                        throw new Error('prefetch failed');
                    }
                    return blocks.filter((entry) => entry.number <= 1);
                }
            });
            await expect(syncOnce(store, chain, silent)).rejects.toThrow();
            // Let the microtask queue drain so any stray rejection would have surfaced.
            await new Promise((resolve) => setImmediate(resolve));
        }
        finally
        {
            process.off('unhandledRejection', onRejection);
        }

        expect(rejections).toEqual([]);
    });

    it('propagates a head failure rather than treating the chain as empty', async () =>
    {
        const store = await openTestStore();
        const chain = stubChain(chainOf(3), { head: async () =>
        {
            throw new Error('ECONNREFUSED');
        } });
        await expect(syncOnce(store, chain, silent)).rejects.toThrow('ECONNREFUSED');
        expect((await store.stats()).blocks).toBe(0);
    });
});

describe('the follower loop', () =>
{
    // A test that reads while its follower is still polling opens the store `strict: false`: a
    // strict store refuses a read that arrives while one of the follower's transactions is open.

    /** A follower whose first pass is parked on a range the node took and never answers. */
    async function parked(store: IndexStore): Promise<IndexerHandle>
    {
        let asked = (): void => undefined;
        const waiting = new Promise<void>((resolve) =>
        {
            asked = resolve;
        });
        const chain = stubChain(chainOf(3), {
            env: { pollMs: 5 },
            range: () =>
            {
                asked();
                return new Promise<BlockWithReceipts[]>(() => undefined);
            }
        });
        const handle = follow(startIndexer(store, chain, silent));
        await waiting;
        return handle;
    }

    it('resolves `ready` once it has caught up for the first time', async () =>
    {
        const blocks = chainOf(3);
        const store = await openTestStore({ strict: false });
        const handle = follow(startIndexer(store, stubChain(blocks, { env: { pollMs: 5 } }), silent));

        await handle.ready;
        expect((await store.stats()).blocks).toBe(3);
    });

    it('checks the genesis before indexing, and wipes an index built from another chain', async () =>
    {
        const blocks = chainOf(3);
        const store = await openTestStore({ strict: false });
        // An index left over from a different chain: same heights, different history.
        await store.ensureChain('0xsomeotherchain');
        await store.insertBlocks([{
            block: { number: 0, hash: '0xstale', parent_hash: '0x00', timestamp: 1, miner: MINER,
                gas_used: '0', gas_limit: '0', base_fee: null, size: 0, tx_count: 0 },
            transactions: [],
            transfers: []
        }]);
        await store.setCursor(0);

        const handle = follow(startIndexer(store, stubChain(blocks, { env: { pollMs: 5 } }), silent));
        await handle.ready;

        // Rebuilt from the real chain rather than serving the stale rows.
        expect((await store.blockByNumber(0))?.hash).toBe('0xa0');
        expect((await store.stats()).blocks).toBe(3);
    });

    it('keeps following after a failed pass instead of giving up', async () =>
    {
        const blocks = chainOf(2);
        const store = await openTestStore({ strict: false });
        let attempts = 0;
        const chain = stubChain(blocks, {
            env: { pollMs: 5 },
            head: async () =>
            {
                attempts++;
                if (attempts === 1)
                {
                    throw new Error('node was restarting');
                }
                return blocks[blocks.length - 1]!.number;
            }
        });

        const handle = follow(startIndexer(store, chain, silent));
        await handle.ready;

        expect(attempts).toBeGreaterThan(1);
        expect((await store.stats()).blocks).toBe(2);
    });

    it('starts even when the genesis check itself fails', async () =>
    {
        // A node that is down at boot must not stop the server from serving what is already
        // indexed - the loop retries, it does not exit.
        const blocks = chainOf(2);
        const store = await openTestStore({ strict: false });
        let asked = 0;
        const chain = stubChain(blocks, {
            env: { pollMs: 5 },
            genesisHash: async () =>
            {
                asked++;
                throw new Error('ECONNREFUSED');
            }
        });

        const handle = follow(startIndexer(store, chain, silent));
        await handle.ready;

        expect(asked).toBe(1);
        expect((await store.stats()).blocks).toBe(2);
    });

    it('stops asking the node once it is told to stop', async () =>
    {
        const blocks = chainOf(1);
        const store = await openTestStore();
        let heads = 0;
        const chain = stubChain(blocks, {
            env: { pollMs: 1 },
            head: async () =>
            {
                heads++;
                return 0;
            }
        });

        const handle = follow(startIndexer(store, chain, silent));
        await handle.ready;
        await handle.stop();

        const atStop = heads;
        await new Promise((resolve) => setTimeout(resolve, 25));
        // None at all: stop() resolves once the loop has ended, so no poll is left in flight.
        expect(heads).toBe(atStop);
    });

    it('stops at once while a pass is waiting on the node, and writes nothing', async () =>
    {
        // A node that took the request and never answered. Stopping must not wait on an answer
        // that is not coming, and the pass it cut short must leave nothing behind.
        const store = await openTestStore();
        const handle = await parked(store);

        const started = performance.now();
        await handle.stop();
        expect(performance.now() - started).toBeLessThan(500);

        expect(await store.cursor(0)).toBe(-1);
        expect(await store.stats()).toEqual({ blocks: 0, transactions: 0, transfers: 0, head: 0, headTime: 0, firstTime: 0 });
    });

    it('does not resolve `ready` when its only pass was stopped short', async () =>
    {
        // `ready` says the index has caught up, and a pass that was stopped caught nothing up.
        const store = await openTestStore();
        const handle = await parked(store);
        let resolved = false;
        void handle.ready.then(() =>
        {
            resolved = true;
        }, () => undefined);

        await handle.stop();
        // Let the microtask queue drain so a late resolution would have landed.
        await new Promise((resolve) => setImmediate(resolve));
        expect(resolved).toBe(false);
    });
});

describe('what a chain may hand it', () =>
{
    // Each of these is a value some contract or node can produce, and each is one a typed database
    // refuses unless the index is ready for it. Refused inside a batch, it fails that batch - and
    // the indexer retries the same batch forever, holding the whole chain behind one odd contract.
    // Every one must be indexed, with the cursor moved past it.

    it('keeps a Transfer whose data is wider than any uint256', async () =>
    {
        // The amount is read from the whole data field, and a contract may emit more than one word.
        const carrier = tokenBlock(1, '0xa0', '0xa1');
        carrier.transactions[0]!.logs[0]!.data = `0x${ 'ff'.repeat(64) }`;
        const store = await sync(stubChain([block(0, '0x00', '0xa0'), carrier]));

        expect(await store.cursor(0)).toBe(1);
        const [row] = (await store.transfersOfAddress(TOKEN, 10, 0)).rows;
        expect(row?.value).toBe((2n ** 512n - 1n).toString());
    });

    it('keeps a token whose name and symbol carry NUL bytes, without them', async () =>
    {
        const blocks = [block(0, '0x00', '0xa0'), tokenBlock(1, '0xa0', '0xa1')];
        const store = await sync(stubChain(blocks, {
            tokenMetadata: async () => ({ name: 'Bad\u0000Token', symbol: 'B\u0000D', decimals: 18 })
        }));

        expect(await store.cursor(0)).toBe(1);
        expect(await store.token(TOKEN)).toMatchObject({ name: 'BadToken', symbol: 'BD', decimals: 18 });
    });

    it('keeps a token that claims more decimals than a uint8 can say', async () =>
    {
        const blocks = [block(0, '0x00', '0xa0'), tokenBlock(1, '0xa0', '0xa1')];
        const store = await sync(stubChain(blocks, {
            tokenMetadata: async () => ({ name: 'Odd', symbol: 'ODD', decimals: 2 ** 32 })
        }));

        expect(await store.cursor(0)).toBe(1);
        expect((await store.token(TOKEN))?.decimals).toBe(2 ** 32);
    });
});
