<div align="center">

# Nura Explorer

**An open source block explorer for EVM chains. Every block, transaction and transfer is indexed locally, so you can follow where value actually moved.**

[![CI](https://github.com/NuraChain/Explorer/actions/workflows/ci.yml/badge.svg)](https://github.com/NuraChain/Explorer/actions/workflows/ci.yml)
[![Built with AzerothJS](https://img.shields.io/badge/built%20with-AzerothJS-5fb3e8)](https://github.com/AzerothJS/AzerothJS)
[![Node >= 24](https://img.shields.io/badge/node-%3E%3D24-brightgreen)](https://nodejs.org)

<img src="docs/screenshots/home-desktop-dark.png" alt="Nura Explorer overview" width="840" />

</div>

---

## What it is

A self-hosted explorer for any EVM-compatible chain. Point it at a JSON-RPC endpoint and it
indexes the chain into a local SQLite file, then serves six pages over that index: a live
overview, blocks, transactions, block and transaction detail, and an address page with a flow
ledger showing value in and out - plus, when the address holds code, what that code can do.

It speaks **standard Ethereum JSON-RPC** and nothing else - no vendor API, no hosted service, no
tracing extensions. It runs against NuraChain, a local Hardhat or Anvil node, or any other EVM
network.

It is **not** a Bitcoin explorer: Bitcoin is UTXO-based and speaks a different RPC.

### Why it indexes instead of proxying the node

Ethereum JSON-RPC has no method that answers *"what has this address done?"*. There is
`eth_getBalance` for a number and `eth_getTransactionByHash` for a hash you already know, but no
address history. Every explorer you have used - Etherscan included - answers that question from
its own index rather than from the node. So does this one.

The index is a **cache, not a source of truth**. Delete `.data/index.db` and it replays from
`START_BLOCK`.

### What a contract address shows

A deployed contract keeps no names. `eth_getCode` returns runtime bytecode - no ABI, no source,
no argument names - so an explorer either verifies source or reads the bytes. This one reads the
bytes, and says so on the page:

- **Entry points.** The dispatcher compares the first four bytes of every call against the
  selectors it answers to. Walking the opcodes recovers that list, and a table of published
  signatures gives most of them their names back. A selector no standard claims is printed as
  four bytes rather than labelled with a plausible guess.
- **Interfaces.** ERC-20, 721, 1155, 165, 2612, 4626, Ownable, AccessControl, Pausable - claimed
  only when every selector of that interface is present, so the badge means the contract answers
  them, not that it says it does.
- **Current values.** The zero-argument getters it actually has (`name`, `symbol`, `decimals`,
  `totalSupply`, `owner`, `paused`, ...), called live and decoded.
- **Compiler and source metadata.** solc appends a CBOR trailer naming its version and an IPFS
  hash of the metadata. That is what the deployer stamped, not proof of anything - but it says
  which compiler to point at the source if you want to verify it.
- **Proxies.** EIP-1967, beacon, EIP-1822 and EIP-1167 clones are followed to their
  implementation, and the functions come from there. A proxy's own code answers nothing.
- **Deployment.** Who deployed it, in which transaction and block. This half comes from the
  index - the chain cannot map a contract back to the receipt that created it.

Everything above is what the page can say **before** anyone publishes source. It says so at the
top, too - the notice is not a disclaimer to be trimmed.

### Publishing source

Anyone can publish the source of a deployed contract, from the contract's own page. There is no
account, no key and no approval queue, because **the chain is the credential**: the explorer
compiles what you submit with the exact solc build you name and accepts it only if the result is
the runtime bytecode already at that address. A submission that does not reproduce those bytes is
refused, and one that does cannot be wrong about what the code is.

What changes on the page afterwards:

- **Every selector gets its real name.** Not "some standard calls this `transfer`" but "the source
  that produced these bytes declares this function" - so the selectors that were four bytes become
  named, typed and callable, including the ones no standard has ever claimed.
- **Structs can be passed.** A published ABI carries a tuple's components, which a signature string
  cannot, so a function taking a struct is callable rather than merely listed.
- **The contract's own getters are read.** Zero-argument `view` functions beyond the standard
  handful are called and shown with the rest of the current values.
- **The source is on the page**, with the compiler, the optimizer settings and the licence it was
  submitted under.

Two things are compared honestly rather than smoothed over:

- **Immutables are excluded.** The constructor writes them after deployment; solc emits zeros there
  and says exactly which bytes, so those ranges are not compared. Anything else in them would be a
  different contract.
- **A full match and a partial match are different claims.** Full means identical bytes, metadata
  trailer included. Partial means identical everywhere the EVM executes, differing only in the
  trailer - which a moved comment or a different file path is enough to change. The page shows
  which one it has; a partial match proves the instructions, not the comments around them.

**Constructor arguments are never asked for.** Etherscan needs them because it compares *creation*
bytecode, which carries them on the end. This compares the *runtime* code the chain holds, which
does not - so the most common reason a verification fails elsewhere does not exist here.

Two forms are accepted: a single Solidity file, or a solc **standard-json** document taken exactly
as written - remappings, library addresses and `viaIR` included, since every one of those decides
whether the bytes come out the same. A contract linked against libraries needs the second form,
with `settings.libraries` filled in; unlinked placeholders are refused rather than blanked out,
because blanking them would mean not checking the twenty bytes a reader most wants checked.

Compilers come from `SOLC_DIR` first and are downloaded once from
[binaries.soliditylang.org](https://binaries.soliditylang.org) if missing, checked against the
sha256 that host publishes and cached on disk. Populate the directory by hand and the explorer
never makes an outbound request. Each compile runs on a worker thread with a timeout, and one runs
at a time - so a submission cannot take the explorer down with it.

Verified source lives in **its own database** (`SOURCES_DB_PATH`), not in the index. The index is a
cache the chain can replay; this is text somebody typed, and nothing can reproduce it. Back it up.

### Calling one

A named function can also be called, and the page splits the two kinds because the EVM does:

- **Read** - `view` and `pure`. Answered by this server through its own node: arguments are
  encoded, `eth_call` runs, and the return is decoded against the type the standard declares. No
  wallet, no signature, no fee. A revert comes back as the reason it gives, printed where the
  value would have been, because a revert is an answer.
- **Write** - everything else. The server encodes the calldata and stops there. The browser hands
  those bytes to the reader's own wallet (EIP-1193, so any injected wallet), the wallet asks its
  owner, and the wallet sends it. **Nothing here signs, and the server's own node connection is
  never in that path.**

Two constraints are load-bearing:

- The read endpoint is not an RPC passthrough. Only `view`/`pure` entries of the signature table
  can be named, so the callable surface is a fixed list of published getters rather than whatever
  a caller writes in the body.
- No Write button exists until the wallet is connected **and on this chain**. The same calldata
  sent on another network reaches a different contract, or nothing at all.

Selectors with no published signature are listed but not callable - without an ABI there is no
way to know what arguments they take. [Publishing the source](#publishing-source) is what supplies
one, and it is what turns those rows into named, callable functions.

---

<div align="center">

| | |
| --- | --- |
| <img src="docs/screenshots/address-desktop-dark.png" alt="Address page with the flow ledger" /> | <img src="docs/screenshots/blocks-desktop-light.png" alt="Blocks list in the light theme" /> |

<img src="docs/screenshots/blocks-mobile-dark.png" alt="Mobile navigation drawer" width="390" />

</div>

## Requirements

- **Node.js >= 24** - the server runs TypeScript natively, with no build step
- An EVM JSON-RPC endpoint

---

## Run it

```sh
npm install
cp server/.env.example server/.env    # then set RPC_URL and CHAIN_ID
npm run dev
```

Open **http://localhost:3001**. The API runs on **:3000**, with `/api` proxied to it.

The indexer starts with the server, catches up from `START_BLOCK` to the head, then follows new
blocks every `POLL_MS`. The first sync of a long chain takes a while; the UI works while it runs
and fills in as blocks land.

### Against NuraChain

```ini
RPC_URL=https://rpc.nurachain.net
CHAIN_ID=1020
CHAIN_NAME=Nura Chain
CURRENCY_SYMBOL=NURA
CHAIN_SITE_URL=https://nurachain.net
START_BLOCK=0
```

### Against a long-lived public chain

Indexing a mainnet from genesis is not practical on one machine. Start near the head:

```ini
RPC_URL=https://your-node
CHAIN_ID=1
START_BLOCK=21000000     # a recent height, NOT 0
POLL_MS=6000             # keep it under the chain's block time
BATCH_SIZE=25            # raise for a fast node, lower for a rate-limited one
```

Only blocks from `START_BLOCK` up are searchable. That is the trade for a first sync measured in
minutes rather than weeks.

---

## Configuration

Every key the server reads is documented in [`server/.env.example`](server/.env.example). Keep
the two files in step: a key added there belongs in `.env` too.

| Key | Default | What it does |
| --- | --- | --- |
| `PORT` | `3000` | Server port |
| `NODE_ENV` | `development` | `production` serves the built client |
| `CLIENT_DIR` | `../application/dist` | Built client, served from the same origin |
| `SSR_ENTRY` | `../application/dist-server/entry.server.js` | SSR bundle |
| `RPC_URL` | `http://127.0.0.1:8545` | The chain to index |
| `CHAIN_ID` | `31337` | Chain id, shown in the UI |
| `CHAIN_NAME` | `Local EVM` | Shown in the header and footer |
| `CURRENCY_SYMBOL` | `ETH` | Suffixes every amount |
| `CURRENCY_DECIMALS` | `18` | Native token decimals |
| `CHAIN_SITE_URL` | *(unset)* | The chain's website, linked from its name in the footer |
| `EXPLORER_URL` | *(unset)* | This explorer's public URL, given to wallets as the block explorer |
| `START_BLOCK` | `0` | Height to index from |
| `POLL_MS` | `2000` | How often to check for a new head |
| `BATCH_SIZE` | `25` | Blocks per catch-up batch |
| `DB_PATH` | `.data/index.db` | The SQLite index |
| `SOURCES_DB_PATH` | `.data/sources.db` | Published source. **Not** replayable - back this one up |
| `SOLC_DIR` | `.data/solc` | Where solc builds are kept, and where downloads land |

---

## Production

```sh
npm run build
NODE_ENV=production npm start
```

One process serves the API and the built client on one origin, so there is no CORS to configure.
Put a reverse proxy in front for TLS.

In a container - build from the repo ROOT, where the workspace lockfile and `.dockerignore` live:

```sh
docker build -f server/Dockerfile -t nura-explorer .
docker run -p 3000:3000 --env-file server/.env nura-explorer
```

`/api/healthz` answers orchestrator probes.

### As a systemd service

On a bare host, from a fresh clone - the unit runs the server directly from source, with the
client built ahead of it:

```sh
npm ci
cp server/.env.example server/.env    # then set RPC_URL and CHAIN_ID
npm run build
sudo npm run service:install
sudo npm run service:start
```

`sudo npm run service:deploy` rebuilds and restarts after a `git pull`.

What to know before running it for real:

- **The index is a file.** Back up `DB_PATH`, or accept a replay on loss. Deleting it is safe.
- **`SOURCES_DB_PATH` is a different file, and deleting it is not safe.** Verified source cannot be
  replayed from the chain. It is the one piece of state here that is not a cache.
- **Verification compiles on the box.** One at a time, on a worker thread, with a timeout - but it
  is real CPU work a stranger can ask for. Put it behind the same reverse proxy as everything else.
- **Reorgs are handled.** On a parent-hash mismatch the indexer walks back and rolls the orphaned blocks out, rather than serving transactions that were un-mined.
- **`eth_getBlockReceipts` is probed once** and falls back to per-transaction receipts on nodes
  that lack it - slower, still correct.
- **Rate limiting is on.** A burst of requests answers `429`.

---

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Server and client together |
| `npm run build` | Client bundle, SSR bundle, prerender |
| `npm start` | Run the built app (set `NODE_ENV=production`) |
| `npm run check` | Typecheck and lint every workspace |
| `npm test` | Server and unit suites |
| `npm run service:deploy` | Rebuild and restart (root) |
| `npm run service:install` | Write and load the systemd unit (root) |
| `npm run service:uninstall` | Stop, disable and remove the unit (root) |
| `npm run service:start` / `:stop` / `:restart` | Control the service (root) |
| `npm run service:status` | What systemd thinks of it |

---

## Structure

```
application/                    the UI
  src/components/ui/            button, badge, card, input, pagination, skeleton, toast, tooltip
  src/components/chain/         hash links, cadence strip, flow ledger
  src/pages/                    home, blocks, block, txs, tx, address
server/                         the API and the indexer
  src/app.ts                    every route, schema and handler, declared once
  src/chain/client.ts           the JSON-RPC gateway
  src/chain/indexer.ts          catch-up, follow, reorg rollback, transfer decoding
  src/chain/store.ts            the SQLite index
  src/chain/contract.ts         bytecode -> selectors, event topics, compiler metadata
  src/chain/signatures.ts       the selector -> signature table that gives them names back
  src/chain/values.ts           typed text <-> abi encoding, for the arguments of a call
  src/inspect.ts                one contract: describing it, reading it, encoding a call to it
```

The API is declared once in `server/src/app.ts`, and the browser gets a typed client from that
same declaration - `client.blocks.one(...)` is checked against the handler's own schema.

---

## Contributing

Issues and pull requests are welcome. For anything larger than a fix, open an issue first so the
approach can be agreed before you spend the time.

Before opening a pull request, both gates must pass:

```sh
npm run check
npm test
```

House style is enforced by the linter and visible in any neighbouring file: Allman braces, one
import per module, and comments that state a constraint the code cannot show rather than narrating
what changed.

- **Adding a page:** one row in `application/src/routes.ts` plus its `*.page.azeroth` component.
- **Adding a chain field:** it starts in `server/src/schemas.ts`. The browser's client is inferred
  from the server's declaration, so the wire shape is decided in exactly one place.
- **Anything touching amounts** belongs in `application/src/lib/format.ts` and needs a test. A
  uint256 does not survive a double, and an explorer that misreports a balance has failed at its
  only job.

## Security

**Do not open a public issue for a security bug.** Report it privately so a fix can ship before
the details are public.

Two things worth knowing before you deploy this:

- **The index is a cache, never a source of truth.** Every figure the UI shows can be re-derived
  from the chain by deleting `DB_PATH` and replaying. Nothing irreplaceable lives in it.
- **`RPC_URL` may carry a provider key.** It is read server-side and never reaches the browser -
  the client only ever talks to this server's own API. Keep it that way when adding endpoints.

## License

MIT
