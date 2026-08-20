// Shared fixtures for the specs added alongside app.spec.ts.
//
// Every one of them builds the same three things - a chain the test controls, an index filled
// from it, and an app over that index - so they live here once rather than being copied per file.
// Nothing in here opens a socket or touches the disk: the store is ':memory:' and the gateway is
// a plain object, which is what lets the whole suite run offline and in any order.
import { syncOnce } from '../../src/chain/indexer.ts';
import { IndexStore } from '../../src/chain/store.ts';
import type { BlockWithReceipts, ChainEnv, ChainGateway } from '../../src/chain/client.ts';

export const ENV: ChainEnv = {
    rpcUrl: 'stub', chainId: 1020, name: 'NuraChain', symbol: 'NURA', decimals: 18, siteUrl: '', explorerUrl: '',
    startBlock: 0, pollMs: 1000, batchSize: 10, concurrency: 4, rpcBatchSize: 10, dbPath: ':memory:'
};

export const ALICE = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
export const BOB = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
export const CAROL = '0xcccccccccccccccccccccccccccccccccccccccc';
export const MINER = '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
/** An ERC-20 contract: it EMITS transfers and is never a party to one. */
export const TOKEN = '0xdddddddddddddddddddddddddddddddddddddddd';
export const ZERO = '0x0000000000000000000000000000000000000000';

export const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

/** A logger that says nothing, so a failing test's output is the assertion and not a backfill. */
export const silent = {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    debug: () => undefined
} as never;

/** An address as an indexed log topic: left-padded to 32 bytes, the way the EVM writes it. */
export function topic(address: string): string
{
    return `0x${ address.slice(2).padStart(64, '0') }`;
}

/** A transaction hash that is unique per (block, index) and looks like one. */
export function txHash(block: number, index: number): string
{
    return `0x${ String(block).padStart(4, '0') }${ String(index).padStart(60, '0') }`;
}

export interface BlockOptions
{
    count?: number;
    from?: string;
    to?: string | null;
    value?: bigint;
    status?: number;
    contractAddress?: string | null;
    timestamp?: number;
}

/** One block carrying `count` transfers of 1 NURA from Alice to Bob unless told otherwise. */
export function block(number: number, parentHash: string, hash: string, options: BlockOptions = {}): BlockWithReceipts
{
    const count = options.count ?? 1;
    return {
        number,
        hash,
        parentHash,
        timestamp: options.timestamp ?? 1_700_000_000 + number * 3,
        miner: MINER,
        gasUsed: 21_000n * BigInt(count),
        gasLimit: 30_000_000n,
        baseFeePerGas: 1_000_000_000n,
        size: 500,
        transactions: Array.from({ length: count }, (_row, index) => ({
            hash: txHash(number, index),
            index,
            from: options.from ?? ALICE,
            to: options.to === undefined ? BOB : options.to,
            value: options.value ?? 10n ** 18n,
            nonce: index,
            inputSize: 0,
            gasUsed: 21_000n,
            effectiveGasPrice: 1_000_000_000n,
            status: options.status ?? 1,
            contractAddress: options.contractAddress ?? null,
            logs: []
        }))
    };
}

/** The same block, with its first transaction carrying an ERC-20 Transfer log. */
export function tokenBlock(number: number, parentHash: string, hash: string, options: BlockOptions = {}): BlockWithReceipts
{
    const carrier = block(number, parentHash, hash, options);
    carrier.transactions[0]!.logs = [{
        index: 0,
        address: TOKEN,
        topics: [TRANSFER_TOPIC, topic(options.from ?? ALICE), topic(options.to ?? BOB)],
        data: `0x${ (10n ** 18n).toString(16).padStart(64, '0') }`
    }];
    return carrier;
}

/** What a stubbed chain answers beyond its blocks. Anything omitted gets a quiet default. */
export interface ChainStub
{
    code?: Record<string, string>;
    balance?: (address: string) => Promise<bigint>;
    call?: (address: string, data: string) => Promise<string>;
    storageAt?: (address: string, slot: string) => Promise<string>;
    tokenMetadata?: (address: string) => Promise<{ name: string; symbol: string; decimals: number } | null>;
    head?: () => Promise<number>;
    blockHashAt?: (number: number) => Promise<string | null>;
    range?: (from: number, to: number) => Promise<BlockWithReceipts[]>;
    genesisHash?: () => Promise<string>;
    env?: Partial<ChainEnv>;
}

/** A chain the test drives directly: `blocks` IS the canonical chain. */
export function stubChain(blocks: BlockWithReceipts[], stub: ChainStub = {}): ChainGateway
{
    const codeAt = (address: string): string => stub.code?.[address.toLowerCase()] ?? '0x';
    return {
        env: { ...ENV, ...stub.env },
        head: stub.head ?? (async () => blocks[blocks.length - 1]?.number ?? 0),
        range: stub.range ?? (async (from, to) => blocks.filter((entry) => entry.number >= from && entry.number <= to)),
        genesisHash: stub.genesisHash ?? (async () => blocks[0]?.hash ?? '0xgenesis'),
        blockHashAt: stub.blockHashAt ?? (async (number) => blocks.find((entry) => entry.number === number)?.hash ?? null),
        tokenMetadata: stub.tokenMetadata ?? (async () => null),
        balance: stub.balance ?? (async () => 5n * 10n ** 18n),
        isContract: async (address) => codeAt(address) !== '0x',
        code: async (address) => codeAt(address),
        storageAt: stub.storageAt ?? (async () => `0x${ '0'.repeat(64) }`),
        call: stub.call ?? (async () => '0x')
    };
}

/** An empty in-memory index. The caller closes it. */
export function freshStore(): IndexStore
{
    return new IndexStore(':memory:');
}

/** An index filled from `blocks`, plus the gateway it was filled from. */
export async function indexed(blocks: BlockWithReceipts[], stub: ChainStub = {}): Promise<{ store: IndexStore; chain: ChainGateway }>
{
    const store = new IndexStore(':memory:');
    const chain = stubChain(blocks, stub);
    store.ensureChain(await chain.genesisHash());
    await syncOnce(store, chain, silent);
    return { store, chain };
}

/** Three blocks: an empty genesis, two transfers in block 1, one in block 2. */
export const CHAIN = [
    block(0, '0x00', '0xb0'),
    block(1, '0xb0', '0xb1', { count: 2 }),
    block(2, '0xb1', '0xb2')
];
