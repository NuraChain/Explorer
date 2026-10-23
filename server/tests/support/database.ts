// The one place a test gets an index from.
//
// Every store a test opens - and every follower it starts over one - is registered here and torn
// down after the test by `setup.ts`, followers first so none is left polling a closed store. A
// suite of several hundred stores that each test forgot to close is not a leak sqlite notices, but
// it is one a database with real connections does.
import type { IndexerHandle } from '../../src/chain/indexer.ts';
import { IndexStore } from '../../src/chain/store.ts';

const stores: IndexStore[] = [];
const followers: IndexerHandle[] = [];

export interface TestStoreOptions
{
    /**
     * Strict by default: a query that escapes the transaction it was written in fails on the spot
     * instead of waiting for it. Off only where a test runs two callers at once on purpose.
     */
    strict?: boolean;

    /** How long a call may wait for its turn before it fails naming the holder. 2 s unless a test is about that wait. */
    lockTimeoutMs?: number;
}

/** An empty index for one test, closed for it afterwards. */
export async function openTestStore(options: TestStoreOptions = {}): Promise<IndexStore>
{
    const store = await IndexStore.open({
        path: ':memory:',
        strict: options.strict ?? true,
        lockTimeoutMs: options.lockTimeoutMs ?? 2_000
    });
    stores.push(store);
    return store;
}

/** Registers a running follower, so the teardown stops it before closing the store under it. */
export function follow(handle: IndexerHandle): IndexerHandle
{
    followers.push(handle);
    return handle;
}

/** Stops every follower and closes every store the current test opened. */
export async function releaseTestStores(): Promise<void>
{
    await Promise.all(followers.splice(0).map((handle) => handle.stop()));
    await Promise.all(stores.splice(0).map((store) => store.close()));
}
