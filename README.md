# Nura Explorer

An open source block explorer for EVM chains. Every block, transaction and transfer is indexed locally, so you can follow where value actually moved.

The index lives in PostgreSQL: copy `.env.example` to `.env` at the repository root and fill it in (every key is required). The `Dockerfile` header shows how to run the image against a database of your own.

Licensed under the [MIT License](license).
