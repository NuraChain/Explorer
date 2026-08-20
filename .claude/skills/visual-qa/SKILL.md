---
name: visual-qa
description: The repeatable browser QA loop for this explorer - build, serve, then inspect every significant UI change at three viewports in both text directions through the Playwright MCP, with the checklist of what to look for. Load after any change to a .azeroth component, a page, tokens.css or base.css. Triggers on visual check, screenshot, responsive, viewport, mobile, RTL check, and "does this look right".
---

# Visual QA

**Never stop after writing the markup.** A change to a component is not finished until it has been
looked at, in both directions, at the sizes people actually use.

## The loop

```
Change  →  Build/serve  →  Playwright  →  1440×900 · 1024×768 · 390×844
                                       →  LTR  ·  RTL
                                       →  Inspect  →  Fix  →  Repeat
```

## Serving the app

The app is already served in production mode on **http://localhost:3003** for most of this repo's
history; check before starting another:

```sh
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3003/
```

If nothing answers, either run the dev pair (`npm run dev` → client on **3001**, proxying `/api`
to **3000**) or build and start production (`npm run build && npm start`, honouring `PORT`).
Prefer the already-running instance over starting a competing one.

## Viewports

| Name | Size | Why |
| --- | --- | --- |
| Desktop | 1440 × 900 | the layout above `sm:` |
| Tablet | 1024 × 768 | the `lg:` boundary and the widest single-column case |
| Mobile | 390 × 844 | below `sm:` — where the nav collapses into the drawer |

This UI is mobile-first with essentially one breakpoint (`sm:`), so **390 and 1440 are the two
that find real bugs**; 1024 catches the `lg:` grid cases.

## Both directions, every time

Switch language through the UI (the language dialog) rather than by forcing an attribute, so the
store, the `lang`, the `dir` and the font stack all move together:

```js
// via the Playwright MCP
document.documentElement.dir    // expect 'ltr' for en, 'rtl' for fa
document.documentElement.lang
```

Compare the *same* page and viewport in `en` and `fa` before calling it done.

## Pages worth walking

`/` (home, cadence strip, stat tiles) · `/blocks` · `/txs` (list rows) ·
`/address/<contract>` (tabs, contract panel, transfers) · `/tx/<hash>` · `/accounts`

For an address page use a contract that actually exists on the indexed chain so the contract tab
has content.

## What to look for

**Layout** — alignment of label/value pairs (the classic RTL failure), spacing rhythm, overflow and
clipping, unexpected wrapping, container widths, the row that reflows first as width drops.

**Typography** — font actually loaded (Latin should be the metric-corrected `Vazirmatn Latin`, not
raw Vazirmatn), size, leading per script, hierarchy, mixed Persian/English on one line.

**Components** — buttons, inputs, the search field, dropdown/dialog, cards, tables and list rows,
the nav drawer, tabs, tooltips, pagination.

**States** — default, hover, focus-visible, active, disabled, loading (skeletons), empty
(`EmptyState`), error, and the selected/current item.

**Chain data** — hashes and amounts must not reorder in RTL; truncation must keep both ends;
figures must stay on one line inside their cell.

**Responsive** — long token names and long Persian strings, the 45-usage `sm:` boundary, and what
happens to a wide table on mobile.

## Motion

Both entrances are `motion-safe:` at the call site. Verify a reduced-motion reader still gets the
sheet and the dialog, just without travel:

```js
matchMedia('(prefers-reduced-motion: reduce)').matches
```

Prefer transform/opacity. Avoid animating width/height or anything that forces synchronous layout.

## Accessibility pass

Use the Playwright MCP's accessibility snapshot rather than eyeballing the DOM:

- every control has an accessible name (icon-only buttons need `aria-label`)
- focus is visible and follows DOM order; `:focus-visible` is styled globally in `base.css`
- headings descend without skipping
- the dialog carries `role="dialog"` + `aria-modal`, traps nothing it should not, and returns
  focus to its trigger
- state is never colour-only
- native semantics before ARIA — **do not add ARIA attributes reflexively**

## Recording what you found

Screenshots land in `.playwright-mcp/` which is gitignored. Report findings as
*viewport × direction × page → problem*, fix, then re-run the same cell to prove it.
