# Nura Explorer

An open source block explorer for EVM chains. Every block, transaction and transfer is indexed locally, so you can follow where value actually moved.

The index lives in PostgreSQL: copy `server/.env.example` to `server/.env` and set `DATABASE_URL`, or run `docker compose up -d --build` for the explorer and its database together (see `compose.yaml`).

Licensed under the [MIT License](license).
