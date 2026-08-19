# Changelog

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
