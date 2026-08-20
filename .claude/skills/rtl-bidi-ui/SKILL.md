---
name: rtl-bidi-ui
description: RTL/LTR and bidirectional text rules for this explorer - Persian/Arabic beside English, hashes and amounts inside mirrored layouts, logical properties, and the accessibility rules that go with them. Load before writing or reviewing any layout, alignment, icon direction, or text that mixes scripts. Triggers on RTL, LTR, dir, Persian, Arabic, bidi, alignment, margin/padding sides, and locale work.
---

# RTL / LTR and bidirectional text

This UI ships in **ten languages**, two of them right-to-left (`fa`, `ar`). The locale store sets
`lang` and `dir` on `<html>`, and every layout has to work in both directions. **A layout that
looks right in LTR is not evidence that it works in RTL.** Check both, always.

## The rule

**Logical properties, not physical ones.** The codebase is already consistent about this: `ms-`
appears 11 times, `text-end` 7, `text-start` 2 — and `ml-`, `mr-`, `pl-`, `pr-`, `left-`, `right-`
appear **zero** times.

| Use | Not |
| --- | --- |
| `ms-2` / `me-2` | `ml-2` / `mr-2` |
| `ps-3` / `pe-3` | `pl-3` / `pr-3` |
| `start-0` / `end-0` | `left-0` / `right-0` |
| `text-start` / `text-end` | `text-left` / `text-right` |
| `border-s` / `border-e` | `border-l` / `border-r` |

### The one documented exception

`contract-panel.component.azeroth` uses `text-left` deliberately, with the reasoning written above
the `<dl>`: every value in that list is chain data already pinned LTR inside its own box, and
`text-start` would send those boxes to the far edge in a mirrored layout while the `data`-classed
row stayed put — one column, two edges. **If you add a physical property, it needs a comment like
that one or it is a bug.**

## Chain data inside a mirrored layout

This is the failure mode that matters most in this product. A hash or address rendered in an RTL
paragraph **reorders visually while reading identically to a screen reader** — it looks like a
different hash.

- Wear `data` / `amount` / `hash` on the element carrying the value. They set
  `direction: ltr` (except `hash-field`) plus `unicode-bidi: isolate`.
- Put the utility on the **span**, not the block, when the block's own alignment matters —
  `amount` on a `<dd>` also pins where the line starts, which pushed labels and figures to
  opposite edges in mirrored card layouts.
- Signs stay **inside** the isolate: a bare `+`/`−` is bidi-neutral and jumps to the far side of
  its own digits in a mirrored line.
- Numbers a *reader* counts (page numbers, counts, byte sizes) go through `locale.n()` and appear
  in their own digits. Numbers that are *chain values* stay Latin — see `lib/format.ts`.

## Direction-aware icons and motion

- Mirror a glyph only when it means "back"/"forward": add `icon-flip`. A wallet or magnifier
  mirrored is just broken.
- `[dir='rtl'] .animate-slide-in` swaps to the mirrored keyframes — a sheet that enters from
  `end-0` must not fly in from across the screen.
- `ms-auto` is how you park something at the row's far end in both directions.

## Typography per script

`base.css` scopes leading to the **language**, not the direction:

- `html:lang(fa)`, `html:lang(ar)` → `--font-persian`, `1.0625rem`, `line-height: 1.85`
- `html:lang(hi)` → `line-height: 1.75`
- default Latin → `line-height: 1.6`

Persian descenders carry dots; at Latin leading consecutive lines collide. Do not flatten these.

## Accessibility that travels with direction

- Each option/row that names a language carries its own `lang` attribute, so a screen reader does
  not read "فارسی" with an English voice.
- Focus order follows DOM order, which is direction-independent — do not reorder with CSS.
- Arrow-key handlers must flip with direction: in RTL the physical Right key means *previous*.
  `language-switch.component.azeroth` shows the pattern (`horizontal = dir() === 'rtl' ? -1 : 1`).
- State must not be colour-only. The selected language carries a tick as well as `text-nur`.

## How to verify

Never assert RTL correctness from reading code. Switch the app to Persian and look:

```js
// through the Playwright MCP, against the running app
document.documentElement.dir   // 'rtl'
document.documentElement.lang  // 'fa'
```

Then compare the same viewport in `en` and `fa`. Watch for: labels and values drifting to opposite
edges, hashes reordering, chevrons pointing the wrong way, sheets entering from the wrong side, and
text overflowing because Persian is taller at the same size.
