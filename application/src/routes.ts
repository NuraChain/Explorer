// The one route table: the client router, the SSR entry, and the kit's server half all read it,
// so there is no second manifest. A page is one row; `render` is how it ships.

import type { PageRoute } from '@azerothjs/kit';

import AccountsPage from './pages/accounts.page.azeroth';
import AddressPage from './pages/address.page.azeroth';
import BlockPage from './pages/block.page.azeroth';
import BlocksPage from './pages/blocks.page.azeroth';
import ChartsPage from './pages/charts.page.azeroth';
import GovernancePage from './pages/governance.page.azeroth';
import Home from './pages/home.page.azeroth';
import ProposalPage from './pages/proposal.page.azeroth';
import TransactionPage from './pages/tx.page.azeroth';
import TransactionsPage from './pages/txs.page.azeroth';

// Every page reads live chain state, so none is prerenderable: a static home would ship the block
// height that was true at BUILD time. They SSR instead, which is also what makes a shared link to
// a transaction arrive as real markup rather than an empty shell.
export const routes: PageRoute[] = [
    { path: '/', component: Home, render: 'server' },
    { path: '/accounts', component: AccountsPage, render: 'server' },
    { path: '/charts', component: ChartsPage, render: 'server' },
    { path: '/blocks', component: BlocksPage, render: 'server' },
    { path: '/block/:number', component: BlockPage, render: 'server' },
    { path: '/governance', component: GovernancePage, render: 'server' },
    // The governor is in the path, not only the id: nothing says a chain has one governor, and a
    // proposal id is unique to the contract that hashed it.
    { path: '/governance/:governor/:id', component: ProposalPage, render: 'server' },
    { path: '/txs', component: TransactionsPage, render: 'server' },
    { path: '/tx/:hash', component: TransactionPage, render: 'server' },
    { path: '/address/:address', component: AddressPage, render: 'server' }
];
