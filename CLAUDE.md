# Nura Explorer — working notes for Claude Code

An EVM block explorer. Two npm workspaces: `application/` (the UI) and `server/` (the API and the
sqlite index). Everything below is drawn from the repository as it stands — if a rule here ever
disagrees with the code, the code is right and this file needs fixing.

## Commands

```sh
npm run dev                   # ONE process on 3003: the server runs vite inside itself
npm run build                 # client bundle, SSR bundle, prerender
npm start --workspace server  # run the built app (NODE_ENV=production, honours PORT)
npm run check                 # typecheck both workspaces + oxlint — the gate
npm run lint                  # oxlint on its own (`lint:fix` applies what it can fix)
npm run format                # oxfmt — READ the note below before running this
npx azeroth check             # the typecheck half alone; the CLI's lint step knew eslint, which is gone
npm test                      # every suite
npm run test:shuffle          # every suite in random order — the isolation gate
npm run test:coverage         # server suite + coverage report
```

`npm run check`, `npm test` and `npm run test:shuffle` must all pass before a change is done.

## Linting and formatting

**oxlint replaced ESLint** (`.oxlintrc.json`): the `correctness` category plus the house rules that
survive the move - no `any`, type-only imports, interfaces over type aliases, explicit return types,
no namespaces, unused names must start with `_`. Suppress a rule where the code is deliberately the
thing it flags, with the reason written above it:

```ts
// oxlint-disable-next-line unicorn/no-new-array
```

Two things went with ESLint, and neither has a replacement yet:

- **`.azeroth` files are no longer linted.** oxlint cannot parse the single-file component format,
  so the 44 components are typechecked and nothing more - the reactivity rules that came with
  `@azerothjs/eslint-plugin` are gone. Review UI code by reading it.
- **The house STYLE is unenforced.** oxlint deliberately implements no formatting rules, and oxfmt
  is Prettier-shaped: it has no brace-style option, so `npm run format` would pull all 78 source
  files off Allman braces onto K&R. It is installed and configured (`.oxfmtrc.json` carries the
  4-space indent, single quotes, no trailing comma, 110 columns) but it has never been run against
  this repository. Do not run it without deciding to change the house style first.

---

## Frontend architecture

**AzerothJS 2.1.0 — not React.** `.azeroth` single-file components compiled by
`@azerothjs/compiler` through Vite 8. Reactivity is signals: `state`, `derived`, `effect`, with
`<Show>` and `<For>` for control flow. Every `@azerothjs/*` pin moves together: the compiled-output
contract is versioned, and a bundle built against one version fails to load against another.

There are **no hooks**. `useMemo`, `useCallback`, `memo`, React libraries and JSX runtimes do not
apply and must not be introduced. Optimise only with a measured reason; the reactive graph already
does fine-grained updates. The framework's own `use*` functions — `useLoader`, `useHead`,
`useLocale`, `useParams` — are not hooks in the React sense: they read the current scope and have
no call-order rule.

A `<Show>` never re-reads the value its `when` just checked. `<Show when={ x.data() } let={ shown }>`
and read `shown`; `x.data()!` inside the branch is a second, independent read that can observe a
null while the branch is still mounted, and the compiler reports it.

```
application/src/
  components/ui/        primitives: badge button empty-state input pagination skeleton toasts tooltip
  components/chain/     chain-aware: hash-link flow-ledger contract-panel contract-call cadence-strip
                        wallet-connect wallet-picker add-chain-button price-ticker vote-tally
                        proposal-actions
  components/layout/    brand-mark search-bar nav-drawer site-footer theme-switch language-switch
  pages/                one component per route
  stores/               locale (10 languages) · theme · toasts · wallet (EIP-6963 + EIP-1193)
  lib/loaders.ts        what each page fetches, run where the page is rendered
  lib/head.ts           the one `pageHead()` every page declares its <head> through
  lib/format.ts         all amount arithmetic — uint256 through bigint, never a double
  styles/tokens.css     every colour, font and motion value
  styles/base.css       element rules and the @utility layer
```

`server/` owns the wire shape. A new chain field starts in `server/src/schemas.ts`; the browser's
client type is inferred from that declaration, so it is decided in exactly one place.

**A page gets its data from a route LOADER, never from a resource that only runs on mount.** The
loader runs before the render and reaches this app's own api *in process* — no socket — and its
result rides the handoff into the browser, which draws it without asking again. A paged list stays
a `resource`, seeded from the loader so its first screen costs no request; because the `resource`
keyword cannot express `initialValue`, those four declarations call `createResource` directly.
A 404 from the api becomes `notFound()` in the loader, so the page and its status cannot disagree.

Two consequences worth knowing before reaching for either:

- An in-process call makes the render a function of the visitor, so the kit answers it
  `private, no-store`. **A page with a loader can never be cached**, and an ISR render cannot make
  one at all — it runs in a work unit, which is not a request root, so the api is unreachable and
  the page answers 500. `/docs` is the only cached row, and only because it asks for nothing.
- Nothing in `lib/loaders.ts` may read `request`. Destructuring the loader arguments counts.

**The `<head>` is declared by the page**, through `pageHead()` in `lib/head.ts`, which wraps the
framework's `useHead`. It runs on both sides, so a crawler and a reader with no JavaScript get the
real title, description, canonical, Open Graph and JSON-LD. Absolute urls come from `EXPLORER_URL`
only — never from the request — and where none is configured the canonical is emitted relative and
the absolute-only tags are omitted rather than guessed.

**Images go through `<Image>` and the `/_image` endpoint**, which sizes one candidate per device
width and answers content-addressed bytes. No adapter is installed, so nothing is transcoded; the
framework ships no codec and this app adds no dependency for one.

**Governance is the chain's own, and it is never indexed.** Nura is a Cosmos chain with an EVM
module, so proposals live in `x/gov` and never touch the EVM — there is not one `ProposalCreated`
log on the chain. It is read from the node's OTHER two apis instead: the Cosmos REST api for the
module's state and CometBFT's rpc for the height it was read at (`server/src/chain/cosmos.ts`,
configured by `COSMOS_REST_URL` / `COMETBFT_RPC_URL` / `COSMOS_TIMEOUT_MS`). Only the server calls
them, the routes hold the answer for five seconds, and nothing is copied into sqlite — a chain has
tens of proposals where it has millions of transactions, so a copy would only be one that can be
wrong. Cosmos addresses are bech32; `server/src/chain/bech32.ts` decodes them so a proposer or a
voter still links to the account page the EVM knows.

Writing is the separate half. Voting, depositing and submitting a proposal are ordinary EVM
transactions to the gov PRECOMPILE at `0x…0805`, encoded from the server's signature table and
signed by the reader's wallet. The two capabilities are reported separately — `enabled` says the
REST api answered, `writable` says the precompile is among the chain's `active_static_precompiles`
— because a chain that exposes one without the other is the normal case, and the page then follows
a proposal without offering an action nothing can send.

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

Ten languages, two right-to-left (`fa`, `ar`). **The SERVER decides which one**, per request — the
reader's `locale` cookie, then `Accept-Language`, then English — and stamps `<html lang>` and
`<html dir>` before the first byte leaves. Nothing in the browser detects a language or corrects
one; the store reads that stamp, and `setLocale` writes the cookie the next request is negotiated
from. Every negotiated answer carries `Vary: accept-language, cookie`.

Direction comes from `Intl`, through the same function the framework stamps the document with.
There is no table of directions to keep in step with it.

Copy lives in `src/locales/*.ts`, ten catalogues typed against English's keys. A message that
inflects after a numeral declares its CLDR forms and `count` — the RAW number — selects one;
`{n}` is the figure in the reader's own digits. A language that does not inflect says one string,
and five of them do not. Never reintroduce a `key`/`keys` pair.

**Logical properties only** — `ms-`/`me-`,
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

**Walk a PRODUCTION build, not the dev session.** They now share one route table, one renderer and
one origin, but they are not the same: the dev session ignores the page cache and renders static
pages live, and it registers `/_image` by hand where production mounts it over the built client.
`npm run build && npm start --workspace server` is what a reader gets.

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
