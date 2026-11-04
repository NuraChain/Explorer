# Nura Explorer — Open-Source EVM Block Explorer for Nura Chain

**Nura Explorer** is the open-source block explorer for [Nura Chain](https://nurachain.net). It indexes blockchain data locally so developers and users can inspect blocks, transactions, token transfers and on-chain activity through a searchable web interface.

Live explorer: **[explorer.nurachain.net](https://explorer.nurachain.net)**

## Features

- **Local blockchain index:** follow blocks, transactions and transfers from an EVM-compatible JSON-RPC endpoint.
- **PostgreSQL storage:** persist indexed chain data locally for fast application queries.
- **Live EVM reads:** query current network and account information from the configured node.
- **Token and contract data:** inspect EVM addresses and on-chain contract information.
- **Cosmos ecosystem data:** the server can also read governance and node information from the configured Cosmos REST and CometBFT endpoints.
- **Network context:** show the chain name, native currency and links associated with the configured network.
- **Deployable infrastructure:** run the explorer against your own PostgreSQL database and compatible EVM RPC endpoint.

## Technology

Nura Explorer is a TypeScript application organised into application/ and server/ npm workspaces. It uses Node.js 24.11+, PostgreSQL and the AzerothJS toolchain.

## Run locally

You need Node.js 24.11 or newer and a UTF-8 PostgreSQL database.

~~~bash
git clone https://github.com/NuraChain/Explorer.git
cd Explorer
npm ci
cp .env.example .env
~~~

Edit .env before starting the application. Every server configuration key is required. The example file documents the JSON-RPC endpoint, chain ID and currency, Cosmos REST and CometBFT endpoints, explorer origin, price source, indexer settings and PostgreSQL connection.

Start the development application:

~~~bash
npm run dev
~~~

| Command | Purpose |
| --- | --- |
| npm run dev | Start the application in development mode |
| npm run check | Run application checks and linting |
| npm run build | Build the production application |
| npm test | Run tests across the workspaces |
| npm run test:coverage | Run server tests with coverage |
| npm run test:shuffle | Run tests in shuffled order |

The server's default port in .env.example is 4300.

## Docker

A Dockerfile is included at the repository root for building the application image. Configure the same environment variables used by a local deployment and ensure the container can reach PostgreSQL and the selected blockchain RPC endpoints.

## Configuration notes

- Set EXPLORER_URL to the public origin where this explorer is served. It is used for canonical and Open Graph metadata.
- Set CHAIN_SITE_URL to the network's official website.
- START_BLOCK controls the first block indexed. Lowering it requires indexing more history.
- Tune BATCH_SIZE, RPC_CONCURRENCY and RPC_BATCH_SIZE to the capacity and limits of your RPC provider.
- Protect the PostgreSQL database and never commit real credentials in .env.

## Related Nura Chain projects

- [Nura Chain](https://nurachain.net)
- [Nura Wallet](https://github.com/NuraChain/Wallet)
- [Nura Swap](https://swap.nurachain.net)
- [Nura Smart Contracts](https://github.com/NuraChain/SmartContract)
