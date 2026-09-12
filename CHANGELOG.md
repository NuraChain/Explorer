# Changelog

## 1.5.1

### Features

- **Nav:** Staking takes the fifth header link and Governance moves to the footer. Staking is the
  page a reader returns to — a delegation is watched — where a proposal is read once and voted on,
  and the header row has never had width for a sixth link. The footer's Explore column is two
  columns now, each link with its own mark, which is what made room for Governance without leaving
  that column taller than the two beside it
- **Locale:** a configured period is stated in the unit that fits it — minutes, hours, days, weeks
  or months — rather than always in days. Both places that print one were dividing by 86400: a
  governance voting period and a staking unbonding period on a devnet are minutes, and every one of
  them read as `0.0 days`. The unit is the largest that divides the span exactly, so a chain set to
  two weeks is read back as two weeks rather than as fourteen days, and the Cosmos default
  unbonding time of 21 days now says three weeks. Where a span divides evenly nowhere the decimal
  rounds up and never down, because one of these is a lock a reader agrees to and a wait printed as
  shorter than it is, is the one error here that costs them something. The unbonding sentences no
  longer carry the word "days" themselves, in any of the ten languages

## 1.5.0

### Features

- **Staking:** show who secures the chain, and let a reader stake with them, at `/staking`. The
  validator set is `x/staking`, so like governance it is read from the node's REST api and never
  indexed — a set is tens of rows against millions of transactions, and a copy could only be one
  that goes wrong. Delegating, redelegating, unbonding and claiming are ordinary EVM transactions
  to the staking and distribution precompiles at `0x…0800` and `0x…0801`, signed by the reader's
  own wallet, and the two capabilities are reported apart exactly as governance reports them:
  whether the module answered at all, and whether those precompiles are mounted, because a chain
  that has one without the other is the normal case. A connected wallet also gets its own position
  — what is delegated, what is unbonding and on which date, and what is owed — read under the
  bech32 spelling of its address, since that is the only name the module knows an account by. The
  link sits in the footer beside the docs, because the header row has no width left for a sixth
  section
- **Contracts:** resolve every function and event the chain's own contracts expose — 298 signatures
  to 507, and 43 events to 127. The table is the only way a selector ever becomes a name, and it
  drifts in silence: a contract gains a function and the page that should decode its calls simply
  goes quiet. The bridge tokens, the faucet, the airdrop, the collateralised NFT vault, the four
  Goman prediction contracts, the profile registry with its lens and verifier, and the Uniswap V3
  callbacks are all named now, as are the staking and distribution precompiles the section above
  calls

### Fixes

- **Contracts:** decode a prediction market's category as the `uint32` id it is rather than a
  string. Six market tuples and both `createMarket` signatures still matched by selector while
  describing the wrong shape, which is the drift that says nothing — a missing entry leaves a
  selector unnamed and visibly so, but one whose types have moved prints values that are wrong.
  `multicall` is payable for the same reason it is in the periphery it came from: a batch
  forwarding value could not be encoded at all while the table declared it nonpayable. Two entries
  that hash to one selector now throw where the table is built, instead of letting the second
  quietly replace the first

## 1.4.2

### Chores

- **Build:** drop the Dockerfile and the root `start` script. Nothing here was built or deployed
  through a container — the service is installed by `scripts/service-install.sh` and run by
  systemd — so an image definition nobody built could only drift out of agreement with the way the
  app is actually started. `npm start --workspace server` is the one remaining way to run the built
  app, and the root alias that hid which workspace it meant is gone with it
- Bump the npm dependencies group — vitest and `@vitest/coverage-v8` to 5, oxlint, oxfmt, lucide,
  happy-dom, viem and `@types/node`

## 1.4.1

### Features

- **Contracts:** name the Goman prediction factory, so its address page reads as a contract instead
  of thirty-four raw selectors. A factory is the contract a whole market tree hangs off — every
  market on this chain is an EIP-1167 clone it stamped — so leaving it unnamed left every market
  unreadable too. Its two creates take the same `MarketParams` and differ only in which template
  they clone, which is why the parimutuel one is called `createMarket2`, and only `createMarket` is
  payable, because the value sent with it seeds the CPMM pool. The names are the ones the chain's
  own prediction client publishes, and each selector is hashed from its signature here like every
  other entry in the table — a name that does not hash to its selector never reaches the page

## 1.4.0

### Features

- **Docs:** answer the questions readers arrive with, at `/docs`, in all ten languages. Every other
  page here is chain state, so a visitor who lands on a shared transaction has nowhere to read what
  this explorer is, what it counts, or why their own transaction is not in it yet — nine anchored
  sections, a glossary and fourteen questions now say so. It is the one route that reads nothing,
  which is what lets it prerender at build time and what leaves it readable when the node behind
  every other page is unreachable

### Fixes

- **Charts:** draw the days the chain was silent at zero, so a range is the window it names. A day
  with no blocks was left out of the series entirely, and on a chain whose blocks begin in August
  the "30 days" and "90 days" charts were the same 24 points. Days outside the index's reach are
  still left out — a stale index is told apart from a quiet chain as before

### Chores

- **Api:** leave CORS to nginx. The Etherscan-compatible surface no longer sends an allow-origin of
  its own: behind a proxy that already sends one, a second copy is not redundant but fatal, since
  two values is what a browser refuses outright. Cross-Origin-Resource-Policy stays, because it is
  not CORS and no allow-origin in front of it overrides the app-wide `same-origin` default
- Bump the npm dependencies group — lucide, happy-dom, vite, viem and `@types/node`

## 1.3.2

### Features

- **Wallet:** reach Nura Wallet over the `nurawallet://` deep link, so it connects from an ordinary
  browser and not only from the wallet's own. The page announces an EIP-6963 provider whose requests
  travel to the wallet and settle from the fragment it appends when it reopens the callback. It
  announces nothing off an https origin — the wallet checks the callback's protocol before anything
  else, and a request from elsewhere leaves and never comes back

### Fixes

- **Wallet:** gate the roster entry on the identifier the wallet announces, `net.nurachain.wallet`,
  not on its Tauri bundle id. The store dropped every announcement it made, including the provider
  it injects into its own in-app browser — that alone is why the entry had never connected

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
