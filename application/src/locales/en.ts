// The source dictionary. Every string a reader can see is declared here once, and `Dictionary`
// is inferred from it - a locale that omits a key or invents one fails the typecheck rather than
// falling back silently at runtime.
//
// Keys are grouped by where the string appears, because that is how they are searched for when a
// screen is being changed. Placeholders are `{name}`; see `interpolate` in ../lib/i18n.ts.
//
// What is NOT here, deliberately: token symbols, chain names, addresses, hashes and the product
// name. Those are data or identifiers, and translating them would make the explorer disagree with
// the chain it is reading.
export const en = {
    // --- Chrome -------------------------------------------------------------------------------
    'nav.sections': 'Sections',
    'nav.home': 'Home',
    'nav.blocks': 'Blocks',
    'nav.transactions': 'Transactions',
    'nav.overview': 'Overview',
    'nav.menu': 'Menu',
    'nav.open': 'Open navigation',
    'nav.close': 'Close navigation',
    'nav.elsewhere': 'Elsewhere',

    'theme.label': 'Theme',
    'theme.dark': 'Dark',
    'theme.light': 'Light',

    'language.label': 'Language',

    // --- Search -------------------------------------------------------------------------------
    'search.label': 'Search by address, transaction hash, or block number',
    'search.placeholder': 'Address, transaction hash, or block number',
    'search.placeholder.compact': 'Search',
    'search.go': 'Go',
    'search.missing': 'Nothing indexed under that value. Check it, or wait if the block is very recent.',
    'search.failed': 'Search failed - the explorer could not reach its index.',

    // --- Home ---------------------------------------------------------------------------------
    // Split around the accent word: the middle segment is the one drawn in the accent colour, so
    // the sentence is three parts rather than one string with markup baked into it.
    // Four slots, rendered as `lead accent through chain trail`. The trailing slot exists for
    // verb-final languages: English leaves it empty, Persian puts its verb there, and neither has
    // to reorder the markup around the accent span.
    'home.hero.lead': 'Follow the',
    'home.hero.accent': 'light',
    'home.hero.through': 'through',
    'home.hero.fallback': 'the chain',
    'home.hero.trail': '',
    'home.tagline': 'Every block, transaction and transfer, indexed so you can see exactly where value moved.',
    'home.behind': 'Indexing - {count} blocks behind the node.',
    'home.stat.height': 'Height',
    'home.stat.transactions': 'Transactions',
    'home.stat.blockTime': 'Block time',
    'home.stat.baseFee': 'Base fee',
    'home.latestBlocks': 'Latest blocks',
    'home.latestTransactions': 'Latest transactions',
    'home.all': 'All',
    'home.empty.blocks': 'Waiting for the first block',
    'home.empty.transactions': 'No transactions yet',

    // --- Blocks list --------------------------------------------------------------------------
    'blocks.title': 'Blocks',
    'blocks.empty.title': 'No blocks indexed yet',
    'blocks.empty.hint': 'Blocks appear here as the indexer reads them from the chain.',
    'blocks.total': '{count} blocks indexed.',
    'blocks.gasTooltip': '{used} of {limit} gas used',

    // --- Transactions list --------------------------------------------------------------------
    'txs.title': 'Transactions',
    'txs.empty.title': 'No transactions indexed yet',
    'txs.empty.hint': 'Every transaction the chain mines lands here.',
    'txs.total': '{count} transactions indexed.',

    // --- Block detail -------------------------------------------------------------------------
    'block.title': 'Block #{number}',
    'block.missing.title': 'Block not in the index',
    'block.missing.hint': 'It may be newer than the indexer has reached, or beyond the start block.',
    'block.previous': 'Previous block',
    'block.next': 'Next block',
    'block.hash': 'Hash',
    'block.parent': 'Parent',
    'block.validator': 'Validator',
    'block.size': 'Size',
    'block.gasUsed': 'Gas used',
    'block.gasOf': 'of {limit}',
    'block.baseFee': 'Base fee',
    'block.transactions': '{count} transactions',
    'block.empty.title': 'This block is empty',
    'block.empty.hint': 'No transactions were included in it.',

    // --- Transaction detail -------------------------------------------------------------------
    'tx.title': 'Transaction',
    'tx.missing.title': 'Transaction not in the index',
    'tx.missing.hint': 'It may still be pending, or newer than the indexer has reached.',
    'tx.reverted.notice': 'This transaction reverted. No value moved, but the sender still paid the gas below.',
    'tx.hash': 'Hash',
    'tx.block': 'Block',
    'tx.position': 'position {index}',
    'tx.from': 'From',
    'tx.to': 'To',
    'tx.value': 'Value',
    'tx.fee': 'Fee',
    'tx.feeDetail': '{gas} gas at {price}',
    'tx.nonce': 'Nonce',
    'tx.calldata': 'calldata {size}',
    'tx.created': 'created',
    'tx.transfers': 'Token transfers',
    'tx.token': 'token',

    // --- Address ------------------------------------------------------------------------------
    'address.title': 'Address {short}',
    'address.kind.address': 'Address',
    'address.kind.contract': 'Contract',
    'address.kind.token': 'Token',
    'address.activity': 'Activity',
    'address.balance': 'Balance',
    'address.received': 'Received',
    'address.sent': 'Sent',
    'address.fees': 'Fees paid',
    'address.tab.transactions': 'Transactions',
    'address.tab.transfers': 'Token transfers',
    'address.transfers.empty.title': 'No token transfers',
    'address.transfers.empty.hint': 'ERC-20, 721 and 1155 movements for this address appear here.',
    'address.transfers.token': 'Token',

    // --- Flow ledger --------------------------------------------------------------------------
    'flow.title': 'Flow',
    'flow.in': 'in',
    'flow.out': 'out',
    'flow.empty': 'No transactions here yet. When this address sends or receives, the movement appears here.',
    'flow.legend': 'Bars are relative to the largest movement shown. Amounts in {symbol}.',
    'flow.call': 'call',
    'flow.contractCreated': 'contract created',

    // --- Cadence ------------------------------------------------------------------------------
    'cadence.title': 'Cadence',
    'cadence.caption': 'last {count} blocks - height is gas used',
    'cadence.chart': 'Gas used across the last {count} blocks',
    'cadence.bar': 'Block {number}, {count} transactions',
    'cadence.now': 'now',

    // --- Shared chain wording -----------------------------------------------------------------
    'chain.contractCreation': 'contract creation',
    'chain.to': 'to {address}',
    'chain.txCount': '{count} tx',
    'chain.gasShare': '{percent}% gas',
    'chain.notAvailable': 'n/a',
    'chain.status.success': 'success',
    'chain.status.reverted': 'reverted',
    'chain.status.unknown': 'unknown',

    // --- Copy / wallet ------------------------------------------------------------------------
    'copy.action': 'Copy {value}',
    'copy.done': 'Copied to clipboard',
    'copy.blocked': 'Your browser blocked clipboard access',

    'wallet.add': 'Add {chain}',
    'wallet.missing': 'No wallet found - install MetaMask, then try again',
    'wallet.added': '{chain} added to your wallet',
    'wallet.dismissed': 'Request dismissed',
    'wallet.refused': 'Your wallet refused to add the network',

    // --- Pagination ---------------------------------------------------------------------------
    'pagination.label': 'Pagination',
    'pagination.first': 'First page',
    'pagination.newer': 'Newer',
    'pagination.older': 'Older',
    'pagination.last': 'Last page',
    'pagination.page': 'Page {number}',

    // --- Toasts -------------------------------------------------------------------------------
    'toast.dismiss': 'Dismiss',

    // --- Error and not-found ------------------------------------------------------------------
    'error.title': 'This page stopped working',
    'error.hint': 'Something failed while rendering. The chain and the index are unaffected - retrying usually clears it.',
    'error.retry': 'Try again',
    'error.home': 'Back to the overview',

    'notFound.title': 'Not found',
    'notFound.heading': 'Nothing at this address',
    'notFound.hint': 'This page does not exist. If you were following a block, transaction or account, check the value below - or try again shortly, if the indexer has not reached it yet.',

    // --- Footer -------------------------------------------------------------------------------
    'footer.tagline': 'An open block explorer. Every block, transaction and transfer is indexed locally, so you can follow value across the chain.',
    'footer.explore': 'Explore',
    /** The group name only; GitHub, Discord and Telegram are proper nouns and stay as they are. */
    'footer.community': 'Community',
    'footer.note': 'Reads come from a local index of the chain. Balances are read live from the node.',
    'footer.builtWith': 'Built with',

    // --- Time and units -----------------------------------------------------------------------
    'time.justNow': 'just now',
    'time.second': '{count} second ago',
    'time.seconds': '{count} seconds ago',
    'time.minute': '{count} minute ago',
    'time.minutes': '{count} minutes ago',
    'time.hour': '{count} hour ago',
    'time.hours': '{count} hours ago',
    'time.day': '{count} day ago',
    'time.days': '{count} days ago',

    'unit.bytes': '{count} B',
    'unit.kilobytes': '{count} KB',
    'unit.gwei': '{amount} gwei',

    // --- Page titles --------------------------------------------------------------------------
    'title.chainExplorer': '{chain} explorer',
    'title.chainFallback': 'Chain'
};

/** The shape every locale must satisfy. Inferred, so adding a key here makes the others fail. */
export type Dictionary = typeof en;

/** Every key the UI may ask for. */
export type MessageKey = keyof Dictionary;
