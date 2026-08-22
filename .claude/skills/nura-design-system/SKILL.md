---
name: nura-design-system
description: The Nura Explorer design system - tokens, utilities, component inventory and the reuse rules. Load this BEFORE writing any UI in this repository: before creating a component, adding a colour, choosing a size, or reaching for an arbitrary Tailwind value. Triggers on component work, styling, layout, spacing, colour, typography, and any ".azeroth" file.
---

# Nura Explorer design system

This repository already has a complete, opinionated design system. Your job is to **use it**, not to
propose another one. Every colour, radius, font and motion value is declared once and consumed
through Tailwind's `@theme` mapping — components never invent values.

**This system outranks generic design advice.** If the `frontend-design` skill suggests a
distinctive palette or a new type pairing, that applies to greenfield work elsewhere — not here.
Here the visual language is settled and consistency is the product requirement.

## Before you create anything

```
Existing component  →  Reuse
                    →  Extend via props if it nearly fits
                    →  Create new ONLY if no existing component can carry it
```

Run this check first, every time:

```sh
ls application/src/components/ui application/src/components/chain application/src/components/layout
grep -rn "the-thing-you-are-about-to-build" application/src/components
```

A second button, a second badge, or a second panel wrapper is a defect, not a feature.

## Tokens — `application/src/styles/tokens.css`

Declared as CSS custom properties and mapped into Tailwind with `@theme inline`. Tailwind v4,
**CSS-first config — there is no `tailwind.config.js` and you must not create one.**

| Token | Tailwind | Role |
| --- | --- | --- |
| `--void` | `bg-void` | page ground |
| `--field` | `bg-field` | panel/card surface |
| `--raised` | `bg-raised` | the surface above a panel — hovers, badges, selected rows |
| `--line` | `border-line` | every border |
| `--text` | `text-text` | primary text |
| `--muted` | `text-muted` | secondary text |
| `--faint` | `text-faint` | tertiary/disabled |
| `--nur` | `text-nur` | the accent (warm amber, "nur" = light) |
| `--beam` | `text-beam` | links to chain data |
| `--inflow` | `text-inflow` | **functional**: value arriving |
| `--outflow` | `text-outflow` | **functional**: value leaving |

`inflow`/`outflow` answer the only question this product exists to answer. **Never spend them on
decoration.** Two themes are complete scales, not tints: `:root` / `[data-theme='dark']` and
`[data-theme='light']`.

Fonts: `--font-display` (Archivo → `Vazirmatn Latin` → `Vazirmatn Variable` …),
`--font-persian`, `--font-mono` (JetBrains Mono). `Vazirmatn Latin` is the same face re-declared in
`styles.css` with rebalanced ascent/descent so Latin sits on the optical centre — do not remove it.

## Utilities — `application/src/styles/base.css`

| Utility | Use for |
| --- | --- |
| `panel` | the standard card/panel: `bg-field`, `border-line`, `rounded-xl` |
| `data` | chain data — mono, tabular figures, **forced LTR + isolated** |
| `amount` | a chain amount — `data` plus permission to wrap between characters |
| `hash` | a hash/address that may wrap, never off the page |
| `hash-field` | the same value inside an input (inherits direction, still isolated) |
| `animate-fade`, `animate-slide-in` | the two entrances; both `motion-safe:` at call sites |
| `icon-flip` | opt-in mirroring for directional glyphs only |

**Any hash, address, amount or gas figure must wear `data` / `amount` / `hash`.** A hash rendered
in an RTL context without the isolate reorders visually while reading identically to a screen
reader — the worst kind of wrong.

## Variant recipes — `application/src/components/ui/variants.ts`

Colour and size live here as data so a tone is named once:

- `TONE_CLASS`: `success` | `danger` | `neutral` | `accent`
- `BUTTON_VARIANT`: `primary` | `outline` | `ghost`
- `BUTTON_SIZE`: `sm` | `md`

A component must not hand-write a colour. If you need a new tone, add it here.

## Component inventory

**ui/** — `badge`, `button`, `card`, `empty-state`, `input`, `pagination`, `skeleton`, `toasts`,
`tooltip`
**chain/** — `add-chain-button`, `cadence-strip`, `contract-call`, `contract-panel`, `flow-ledger`,
`hash-link`, `price-ticker`, `series-chart`, `wallet-connect`, `wallet-picker`
**layout/** — `brand-mark`, `language-switch`, `nav-drawer`, `search-bar`, `site-footer`,
`theme-switch`

`HashLink` is the only correct way to render an address or hash — it handles truncation, the
tooltip, copy, and the direction isolate.

## Established conventions

- **Mobile-first, essentially one breakpoint.** `sm:` carries ~45 usages, `lg:` 3. Do not
  introduce `md:`/`xl:` layers without a real need.
- **Sizes are explicit** — `text-[14px]`, `h-8`, `h-9`, `h-10`. Arbitrary *sizes* are the house
  style here; arbitrary *colours* are not. Use the token.
- **Every interactive control states its cursor**: `cursor-pointer` when it acts,
  `cursor-default` when it is already the selected item. See `.claude/skills/` sibling rules.
- **Overlay close buttons** are the outlined "muted box":
  `border border-line text-muted … hover:border-nur hover:text-text`.
- **Comments state a constraint the code cannot show.** Match that register; do not narrate.

## Framework reality

This is **AzerothJS 2.0.0-beta.2**, not React. Components are `.azeroth` single-file components
with `state` / `derived` / `effect` and `<Show>` / `<For>` control flow. There is no JSX runtime,
no hooks, no `useMemo`/`useCallback`/`memo`. Do not import React patterns or React libraries.
