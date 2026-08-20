# Nura Explorer — working notes for Claude Code

An EVM block explorer. Two npm workspaces: `application/` (the UI) and `server/` (the API and the
sqlite index). Everything below is drawn from the repository as it stands — if a rule here ever
disagrees with the code, the code is right and this file needs fixing.

## Commands

```sh
npm run dev            # both halves: client on 3001, server on 3000
npm run build          # client bundle, SSR bundle, prerender
npm start              # run the built app (NODE_ENV=production, honours PORT)
npx azeroth check      # typecheck + lint, both workspaces — the gate
npm test               # every suite
npm run test:shuffle   # every suite in random order — the isolation gate
npm run test:coverage  # server suite + coverage report
```

`npx azeroth check`, `npm test` and `npm run test:shuffle` must all pass before a change is done.

---

## Frontend architecture

**AzerothJS 2.0.0-beta.2 — not React.** `.azeroth` single-file components compiled by
`@azerothjs/compiler` through Vite 8. Reactivity is signals: `state`, `derived`, `effect`, with
`<Show>` and `<For>` for control flow.

There are **no hooks**. `useMemo`, `useCallback`, `memo`, React libraries and JSX runtimes do not
apply and must not be introduced. Optimise only with a measured reason; the reactive graph already
does fine-grained updates.

```
application/src/
  components/ui/        primitives: badge button card empty-state input pagination skeleton toasts tooltip
  components/chain/     chain-aware: hash-link flow-ledger contract-panel contract-call cadence-strip
                        wallet-connect add-chain-button
  components/layout/    brand-mark search-bar nav-drawer site-footer theme-switch language-switch
  pages/                one component per route
  stores/               locale (10 languages) · theme · toasts · wallet (EIP-1193)
  lib/format.ts         all amount arithmetic — uint256 through bigint, never a double
  styles/tokens.css     every colour, font and motion value
  styles/base.css       element rules and the @utility layer
```

`server/` owns the wire shape. A new chain field starts in `server/src/schemas.ts`; the browser's
client type is inferred from that declaration, so it is decided in exactly one place.

## Design system

Tokens live in `application/src/styles/tokens.css` and reach Tailwind through `@theme`.
**Tailwind v4, CSS-first — there is no `tailwind.config.js` and none should be created.**

Surfaces `void → field → raised`, borders `line`, text `text → muted → faint`, accent `nur`,
links `beam`. `inflow` and `outflow` are **functional**: they answer where value went and are never
spent on decoration. Two complete themes (`[data-theme='dark']` default, `[data-theme='light']`).

Utilities in `base.css`: `panel`, `data`, `amount`, `hash`, `hash-field`, `animate-fade`,
`animate-slide-in`, `icon-flip`.

Variant recipes are data in `application/src/components/ui/variants.ts` (`TONE_CLASS`,
`BUTTON_VARIANT`, `BUTTON_SIZE`). **A component never hand-writes a colour.**

Detail: `.claude/skills/nura-design-system/`.

## Component rules

```
Existing component → reuse → extend via props → create new only if justified
```

Check `components/{ui,chain,layout}` before building. A second button, badge or panel wrapper is a
defect. `HashLink` is the only correct way to render an address or hash — it owns truncation, the
tooltip, copy and the direction isolate.

Conventions the codebase already holds: overlay close buttons are the outlined muted box
(`border border-line … hover:border-nur`); an already-selected item takes `cursor-default`, never
`cursor-pointer`; comments state a constraint the code cannot show rather than narrating a change.

## Responsive rules

Mobile-first, and effectively **one breakpoint**: `sm:` carries ~45 usages, `lg:` 3. Do not add
`md:`/`xl:` layers without a real need. Target viewports for review:

```
Desktop 1440 × 900     Tablet 1024 × 768     Mobile 390 × 844
```

Below `sm:` the header collapses into the nav drawer — that is where mobile bugs surface.

## RTL/LTR rules

Ten languages, two right-to-left (`fa`, `ar`). **Logical properties only** — `ms-`/`me-`,
`ps-`/`pe-`, `start-`/`end-`, `text-start`/`text-end`, `border-s`/`border-e`. The codebase contains
zero `ml-`/`mr-`/`pl-`/`pr-`/`left-`/`right-`; a physical side needs a written justification like
the one above the `<dl>` in `contract-panel.component.azeroth`.

Every hash, address and amount wears `data` / `amount` / `hash` so it cannot reorder inside a
mirrored line. Signs stay inside the isolate. `icon-flip` mirrors directional glyphs only. Leading
is scoped per language, not per direction.

**A layout verified in LTR is not verified.** Detail: `.claude/skills/rtl-bidi-ui/`.

## Accessibility rules

Native HTML semantics before ARIA — **do not add ARIA attributes reflexively.** Icon-only controls
carry an `aria-label`; `:focus-visible` is styled globally; headings descend without skipping; the
language dialog is `role="dialog"` + `aria-modal` and returns focus to its trigger; state is never
colour-only (the selected language carries a tick as well as `text-nur`).

## Playwright / visual QA

Playwright reaches the app through the **Playwright MCP** (user scope). There is no in-repo
Playwright config and none is needed. Scratch output lands in `.playwright-mcp/`, which is ignored.

The loop, for every significant UI change: build/serve → three viewports → both directions →
inspect → fix → re-check the same cell. Detail: `.claude/skills/visual-qa/`.

## Testing workflow

Vitest in both workspaces. The browser half runs under happy-dom with `@azerothjs/testing`
(`renderTest` / `fire` / `cleanup`); the server half runs against `:memory:` sqlite and a stubbed
chain gateway. Nothing binds a port or reaches the network.

Both halves lean on module-level singletons, so **`npm run test:shuffle` is a gate** — a test that
only passes in declaration order will fail for somebody else at random.

Anything touching amounts belongs in `application/src/lib/format.ts` and needs a test: a uint256
does not survive a double, and an explorer that misreports a balance has failed at its only job.

## Performance rules

Measure before optimising. Prefer transform/opacity for motion; avoid animating width/height or
anything forcing synchronous layout. Both entrances are `motion-safe:` at the call site, so
reduced-motion readers get the result without the travel. The server side already caches repeated
node reads (`server/src/chain/cache.ts`) — do not add a second caching layer in the browser without
a measurement showing one is needed.

## Agents and skills

`.claude/agents/frontend-ui-ux.md` implements UI and verifies it in a browser.
`.claude/agents/frontend-reviewer.md` reviews without editing.
`.claude/skills/` holds `nura-design-system`, `rtl-bidi-ui` and `visual-qa`.

Installed plugins: `frontend-design` (Anthropic) for aesthetic direction on greenfield work, and
`modern-web-guidance` (Google Chrome) for current platform practice. **Where either disagrees with
this repository's settled visual language, this repository wins.**

MCP servers: Context7 (current library docs — prefer it over memory), Filesystem (scoped to this
project), Playwright (browser QA).
