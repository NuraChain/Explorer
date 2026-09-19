// What each page needs, fetched where the page is rendered.
//
// These run on the SERVER for a direct load - where the typed client dispatches through this
// app's own api in process, carrying no socket - and in the browser for a client-side
// navigation. The result rides the loader handoff into the served document, so a hydrating page
// draws its content without asking for it again, and a crawler or a reader with no JavaScript
// gets the block, the transaction or the account rather than a loading skeleton.
//
// Nothing in here reads the `request`. That is deliberate and it is load-bearing: a render that
// consults the visitor is a function of identity, and the kit answers it `private, no-store` -
// which would silently take the cached pages in `routes.ts` off the cache they were put on. The
// reader's language is not needed here either, because the api answers chain facts and the page
// localizes them.
//
// The route table ships to the browser, so everything reachable from here stays browser-safe.
import { notFound } from 'azerothjs';

import {
    ApiError,
    client,
    type Account,
    type BlockDetail,
    type BlockPage,
    type ProposalDetail,
    type Summary,
    type TransactionDetail,
    type TransactionPage
} from '../api.ts';

/**
 * The chain description every page is drawn against: the symbol and decimals every amount is
 * formatted with, and the two heads whose gap says how far the index is behind.
 *
 * Eight pages used to declare a resource of their own for this one payload, which meant eight
 * requests for it and none of them in the served markup.
 */
export interface ChainData
{
    stats: Summary;
}

/** The chain description alone, for a page whose own list is paged in the browser. */
export async function loadChain(): Promise<ChainData>
{
    return { stats: await client.stats.summary() };
}

/**
 * A 404 from the api is a 404 from the page.
 *
 * `notFound()` is answered as a real 404 - where an ordinary throw would be a 500 - and the
 * client keeps it as this level's own error, which the page renders as its empty state. An
 * unindexed hash used to be answered 200 with the shell's generic title, so every mistyped link
 * became a duplicate of the home page in the index.
 */
async function found<T>(read: Promise<T>): Promise<T>
{
    try
    {
        return await read;
    }
    catch (error)
    {
        if (error instanceof ApiError && error.status === 404)
        {
            throw notFound();
        }

        throw error;
    }
}

export interface HomeData extends ChainData
{
    cadence: BlockPage;
    blocks: BlockPage;
    txs: TransactionPage;
}

/** The front door: the chain's figures, its recent cadence, and the head of both lists. */
export async function loadHome(): Promise<HomeData>
{
    const [stats, cadence, blocks, txs] = await Promise.all([
        client.stats.summary(),
        client.stats.cadence(),
        client.blocks.list({ query: { limit: 8 } }),
        client.txs.list({ query: { limit: 8 } })
    ]);

    return { stats, cadence, blocks, txs };
}

export interface BlockData extends ChainData
{
    block: BlockDetail;
}

/** One block and the first page of its transactions. Paging past the first is the page's own. */
export async function loadBlock(number: string): Promise<BlockData>
{
    const [stats, block] = await Promise.all([
        client.stats.summary(),
        found(client.blocks.one({ params: { number }, query: { page: 1, limit: 25 } }))
    ]);

    return { stats, block };
}

export interface TransactionData extends ChainData
{
    detail: TransactionDetail;
}

/** One transaction - the page a shared link lands on more often than any other. */
export async function loadTransaction(hash: string): Promise<TransactionData>
{
    const [stats, detail] = await Promise.all([
        client.stats.summary(),
        found(client.txs.one({ params: { hash }, query: { page: 1, limit: 25 } }))
    ]);

    return { stats, detail };
}

export interface AddressData extends ChainData
{
    account: Account;
}

/**
 * One account's identity and balance. The ledger, the transfers and the contract panel stay in
 * the browser: each is paged, filtered or opened on demand, and none of the three is what a
 * shared link is for.
 */
export async function loadAddress(address: string): Promise<AddressData>
{
    const [stats, account] = await Promise.all([
        client.stats.summary(),
        found(client.address.summary({ params: { address } }))
    ]);

    return { stats, account };
}

export interface ProposalData extends ChainData
{
    detail: ProposalDetail;
}

/**
 * One governance proposal, read from the node's own module.
 *
 * A proposal id nobody has used is a 404 like any other missing subject; a chain whose governance
 * api is unreachable answers 404 too, which is the honest reading - there is no proposal here to
 * show, and the overview page says why.
 */
export async function loadProposal(id: string): Promise<ProposalData>
{
    const [stats, detail] = await Promise.all([
        client.stats.summary(),
        found(client.governance.one({ params: { id }, query: { page: 1, limit: 25 } }))
    ]);

    return { stats, detail };
}
