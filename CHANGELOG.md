# Changelog

## 1.3.1

### Fixes

- **Transaction:** stack the detail list into a card below `sm:`. The `min-w-52` floor that used
  to wrap those rows only tripped on a phone narrow enough — a wider one kept the row and split
  the hash across two lines

## 1.3.0

### Features

- **Governance:** follow this chain's own `x/gov` module — proposals, tallies, ballots and deposits,
  read live from the node's Cosmos REST api with CometBFT for the height it was read at. Nothing is
  copied into sqlite: a chain has tens of proposals where it has millions of transactions
- **Governance:** vote, deposit and submit a proposal from the page, signed by the reader's wallet
  through the gov precompile. Reading and writing are reported separately — a chain that answers
  the REST api without exposing the precompile is the normal case, and the page then follows a
  proposal without offering an action nothing can send
- **Governance:** decode the bech32 spelling of a proposer, voter or depositor to the twenty bytes
  the EVM knows, so each still links to its account page
- **Charts:** add the charts and statistics page, a single-series area chart, and the daily series
  the index is aggregated into
- **Price:** show what the coin is worth, read from the exchange that trades it
- **Wallet:** pick from the three wallets this explorer offers, discovered through EIP-6963
- **Accounts:** page and search the rich list
- **Transactions:** filter the list by status; **Blocks:** filter to blocks with transactions
- **Address:** filter the ledger by direction; **Transaction:** page the token transfers it emitted
- **UI:** add a filter group primitive
- **Advertising:** add the two sponsor slots the shell can carry
- **i18n:** the governance module's vocabulary in all ten languages

### Fixes

- **Mobile:** draw list rows as cards below `sm:` on blocks, transactions and accounts, and keep
  hash values inside their panel on a phone
- **Address:** key the page on the address the index stores, and gap the token id from outside its
  ltr island — `data` forces its own direction, so a logical margin on it cannot follow the line
- **Governance:** count the open rows live in the list. The module leaves a proposal's own tally at
  zero until its vote closes, so the row a reader scans first was drawn empty
- **Rows:** keep a counterparty pair inside the column that holds it
- **Home:** print the block time in the reader's own digits; **Charts:** the same for a counted
  figure, and lift the peak off the plot
- **Block:** say a transaction outcome in words, not in colour alone
- **Shell:** theme the browser chrome with the palette's own void
- **Service:** enable the unit the installer actually wrote

### Style

- **Transactions:** move the age under the addresses, last in the row
- Let a long proposal title break inside the word — a proposal about the EVM carries a bare address,
  which no soft wrap can place

### Chores

- Replace ESLint with oxlint, and install oxfmt. `.azeroth` files are no longer linted: oxlint
  cannot parse the single-file component format
- Sweep the audit's dead code and drift

### Documentation

- Describe the governance read path, and cut the README back to a short one

## 1.2.0

### Features

- **Cache:** serve repeated node reads from memory, with a span per kind of read and single-flight
  so concurrent callers share one request. The indexer keeps the raw reader — a stale answer there
  would be a missed reorg
- **Signatures:** name the Uniswap V3 pool interface (`slot0`, `ticks`, `swap`, `observe` and the
  rest), and claim the pool as an interface once the dispatcher answers the whole fingerprint
- **Signatures:** name the public functions of a Solidity library. A library's selector is hashed
  from the struct's qualified name, not its expanded tuple, which is why `NFTDescriptor` read as
  four raw bytes
- **Language:** open the language picker as a centred dialog, with a tick on the current language

### Fixes

- **Fonts:** centre Latin text by rebalancing Vazirmatn's metrics. Archivo was never shipped, so
  the English UI is set in a Persian face whose descent pushed every glyph ~2px high
- **Values:** range-check integers and refuse odd-length hex. `0xabc` encoded as `0xabc0` — a
  different value than typed, in calldata a wallet signs
- **Etherscan:** refuse a page number that is integral only as a double, instead of passing an
  unsafe integer to sqlite and answering 500
- **Schemas:** bound the page number, closing the same overflow on the typed API

### Style

- Outline the close button on every overlay, and space the language dialog's header
- Drop `cursor-pointer` from an already-selected item — the pointer promised a click that does
  nothing
- Centre the amount and time column of a list row; left-align the contract detail values, which
  in a mirrored layout had sat on two different edges
- Give the Latin UI a looser line height

### Tests

- Add server suites for the sqlite index, the sync loop, the JSON-RPC client, both HTTP surfaces
  and configuration, with property and fuzz coverage over ABI coercion and bytecode analysis
- Add application suites for the ten dictionaries, the stores, the wallet and the components
- Add test scripts, coverage and split CI jobs, including a shuffled run as an isolation gate

### Documentation

- Document the test suite in the README, and add `CLAUDE.md` with the frontend workflow
- Share the project's Claude skills and agents (design system, RTL/bidi, visual QA)

## 1.1.9

### Features

- **Accounts:** add a top-accounts leaderboard at `/accounts` with live balances and a new nav link
- **Contract:** name Uniswap V3 functions and the V2 fee-fork calls (`swapFee`, `setSwapFee`, `MAX_SWAP_FEE`)
- **Footer:** show the deployed version (`Version 1.1.8`) under the brand mark
- **Social:** add Instagram to the footer social links (instagram.com/nura.chain)

### Fixes

- **Contract:** remove the "source code is not published" notice from the contract panel
- **Footer:** space the bottom items (note, built-with, version) with `justify-between`
- **Footer:** put the Version label at the end of the brand column

### Style

- Bump all font sizes by one step (`11px` → `12px`, up through `17px` → `18px`) and all icon sizes by one (`12` → `13`, up through `16` → `17`)
- Bump the Persian/Arabic base font-size from `1rem` to `1.0625rem`
- Lay out footer social links in a 2-column grid

## 1.1.8

### Features

- **Verify:** recompile published source against the deployed bytecode
- **Contract:** name the pair, router and multicall calls a chain runs on

### Fixes

- **Contract:** accept a dynamic `bytes` argument of any length
- **Search:** give the field's clear button a pointer cursor
- **Search:** start the compact field's text where its icon does
