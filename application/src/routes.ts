// The one route table: the client router, the SSR entry, and the kit's server half all read it,
// so there is no second manifest. A page is one row; `render` is how it ships.

import type { PageRoute } from '@azerothjs/kit';

import { loadAddress, loadBlock, loadChain, loadHome, loadProposal, loadTransaction } from './lib/loaders.ts';

import AccountsPage from './pages/accounts.page.azeroth';
import AddressPage from './pages/address.page.azeroth';
import BlockPage from './pages/block.page.azeroth';
import BlocksPage from './pages/blocks.page.azeroth';
import ChartsPage from './pages/charts.page.azeroth';
import DocsPage from './pages/docs.page.azeroth';
import GovernancePage from './pages/governance.page.azeroth';
import Home from './pages/home.page.azeroth';
import ProposalPage from './pages/proposal.page.azeroth';
import StakingPage from './pages/staking.page.azeroth';
import TransactionPage from './pages/tx.page.azeroth';
import TransactionsPage from './pages/txs.page.azeroth';

/*
 * Every page that reads live chain state is unprerenderable: a static home would ship the block
 * height that was true at BUILD time. Those SSR instead, which is also what makes a shared link
 * to a transaction arrive as real markup rather than an empty shell. The docs page reads none,
 * and is the one row below that says so.
 *
 * Every row that shows fetched content declares a LOADER, and that is what makes the sentence
 * above true rather than aspirational. A page used to fetch inside its own resources, which run
 * on mount and never on a server, so a server-rendered route served a correct shell around a
 * loading skeleton: a crawler indexed the skeleton, a reader with no JavaScript saw nothing, and
 * a hydrating browser asked for everything again. A loader runs BEFORE the render and reaches
 * this app's own api in process; the result rides the handoff into the page, and the browser
 * seeds its resources from it rather than repeating the request.
 *
 * The paged lists stay in the browser. A loader keys on the url, and these pages page and filter
 * through local state - so the loader carries the chain description they are all drawn against
 * and the first screen of the pages that have one, and the list a reader walks through stays a
 * resource.
 */
export const routes: PageRoute[] = [
    { path: '/', component: Home, render: 'server', loader: () => loadHome() },
    { path: '/accounts', component: AccountsPage, render: 'server', loader: () => loadChain() },
    { path: '/charts', component: ChartsPage, render: 'server', loader: () => loadChain() },
    // No loader: this page names no amount, so it needs no chain description, and its list is
    // paged in the browser like every other list here.
    { path: '/blocks', component: BlocksPage, render: 'server' },
    { path: '/block/:number', component: BlockPage, render: 'server', loader: ({ params }) => loadBlock(params.number ?? '') },
    { path: '/governance', component: GovernancePage, render: 'server', loader: () => loadChain() },
    // One module, one numbering: a proposal id is the chain's own, so the path carries nothing else.
    { path: '/governance/:id', component: ProposalPage, render: 'server', loader: ({ params }) => loadProposal(params.id ?? '') },
    // Governance's neighbour: the same module's-own-state read, and a page that is live for the
    // same reason - a validator set moves every block, and a prerendered one would be a snapshot.
    { path: '/staking', component: StakingPage, render: 'server', loader: () => loadChain() },
    { path: '/txs', component: TransactionsPage, render: 'server', loader: () => loadChain() },
    { path: '/tx/:hash', component: TransactionPage, render: 'server', loader: ({ params }) => loadTransaction(params.hash ?? '') },
    { path: '/address/:address', component: AddressPage, render: 'server', loader: ({ params }) => loadAddress(params.address ?? '') },
    // The exception the paragraph above describes: this page reads no chain state at all, so it
    // is written once at BUILD time and served as a file. That is also what makes it the page a
    // reader can still reach when the node behind every other one is unreachable.
    { path: '/docs', component: DocsPage, render: 'static' }
];
