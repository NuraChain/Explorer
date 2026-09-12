// The one route table: the client router, the SSR entry, and the kit's server half all read it,
// so there is no second manifest. A page is one row; `render` is how it ships.

import type { PageRoute } from '@azerothjs/kit';

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

// Every page that reads live chain state is unprerenderable: a static home would ship the block
// height that was true at BUILD time. Those SSR instead, which is also what makes a shared link to
// a transaction arrive as real markup rather than an empty shell. The docs page reads none, and is
// the one row below that says so.
export const routes: PageRoute[] = [
    { path: '/', component: Home, render: 'server' },
    { path: '/accounts', component: AccountsPage, render: 'server' },
    { path: '/charts', component: ChartsPage, render: 'server' },
    { path: '/blocks', component: BlocksPage, render: 'server' },
    { path: '/block/:number', component: BlockPage, render: 'server' },
    { path: '/governance', component: GovernancePage, render: 'server' },
    // One module, one numbering: a proposal id is the chain's own, so the path carries nothing else.
    { path: '/governance/:id', component: ProposalPage, render: 'server' },
    // Governance's neighbour: the same module's-own-state read, and a page that is live for the
    // same reason - a validator set moves every block, and a prerendered one would be a snapshot.
    { path: '/staking', component: StakingPage, render: 'server' },
    { path: '/txs', component: TransactionsPage, render: 'server' },
    { path: '/tx/:hash', component: TransactionPage, render: 'server' },
    { path: '/address/:address', component: AddressPage, render: 'server' },
    // The exception the paragraph above describes: this page reads no chain state at all, so it
    // is written once at BUILD time and served as a file. That is also what makes it the page a
    // reader can still reach when the node behind every other one is unreachable.
    { path: '/docs', component: DocsPage, render: 'static' }
];
