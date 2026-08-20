# Changelog

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
