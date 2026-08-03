// The one route table: the client router, the SSR entry, and the kit's server half all read it,
// so there is no second manifest. A page is one row; `render` is how it ships.
import type { PageRoute } from '@azerothjs/kit';

import AddressPage from './pages/address.azeroth';
import BlockPage from './pages/block.azeroth';
import BlocksPage from './pages/blocks.azeroth';
import Home from './pages/home.azeroth';
import TransactionPage from './pages/tx.azeroth';
import TransactionsPage from './pages/txs.azeroth';

// Every page reads live chain state, so none is prerenderable: a static home would ship the block
// height that was true at BUILD time. They SSR instead, which is also what makes a shared link to
// a transaction arrive as real markup rather than an empty shell.
export const routes: PageRoute[] = [
    { path: '/', component: Home, render: 'server' },
    { path: '/blocks', component: BlocksPage, render: 'server' },
    { path: '/block/:number', component: BlockPage, render: 'server' },
    { path: '/txs', component: TransactionsPage, render: 'server' },
    { path: '/tx/:hash', component: TransactionPage, render: 'server' },
    { path: '/address/:address', component: AddressPage, render: 'server' }
];
