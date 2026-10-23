// @vitest-environment node
//
// Configuration is read ONCE at boot and never re-consulted, so a mistake in it is a deployment
// that runs for a week pointed at the wrong chain. Every loader takes a record rather than only
// reaching for process.env, which is what lets these run without touching the real environment -
// no global is mutated here and no test can leak into another.
//
// None of the keys has a default in code: every one is in the root .env, and a missing one fails
// the boot by name.
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

import { describe, it, expect } from 'vitest';

import { describeChain, loadChainEnv } from '../src/chain/client.ts';
import { loadCacheOptions } from '../src/chain/cache.ts';
import { loadCosmosEnv } from '../src/chain/cosmos.ts';
import { loadDatabaseEnv } from '../src/chain/data-source.ts';
import { loadPriceEnv } from '../src/price.ts';
import { ENV } from './support/fixtures.ts';

/** The committed example, parsed exactly as `process.loadEnvFile` would read it. */
const EXAMPLE = readFileSync(new URL('../../.env.example', import.meta.url), 'utf8');
const EXAMPLE_ENV: Record<string, string | undefined> = parseEnv(EXAMPLE);

const CHAIN = {
    RPC_URL: 'https://rpc.example.test',
    CHAIN_ID: '1020',
    CHAIN_NAME: 'Nura Chain',
    CURRENCY_SYMBOL: 'NURA',
    CURRENCY_DECIMALS: '18',
    CHAIN_SITE_URL: 'https://chain.example.test',
    EXPLORER_URL: 'https://explorer.example.test',
    START_BLOCK: '500',
    POLL_MS: '3000',
    BATCH_SIZE: '512',
    RPC_CONCURRENCY: '512',
    RPC_BATCH_SIZE: '128'
};

const CACHE = {
    RPC_CACHE: 'true',
    RPC_CACHE_MAX: '4096',
    RPC_CACHE_HEAD_MS: '1000',
    RPC_CACHE_BALANCE_MS: '2000',
    RPC_CACHE_CALL_MS: '2000',
    RPC_CACHE_STORAGE_MS: '2000',
    RPC_CACHE_CODE_MS: '600000',
    RPC_CACHE_CODE_ABSENT_MS: '5000',
    RPC_CACHE_TOKEN_MS: '600000'
};

/** The message a loader throws for `env`, or '' when it does not throw. */
function failure(load: () => unknown): string
{
    try
    {
        load();
    }
    catch (error)
    {
        return String(error);
    }
    return '';
}

describe('the chain environment', () =>
{
    it('reads every value the deployment sets', () =>
    {
        expect(loadChainEnv(CHAIN)).toEqual({
            rpcUrl: 'https://rpc.example.test',
            chainId: 1020,
            name: 'Nura Chain',
            symbol: 'NURA',
            decimals: 18,
            siteUrl: 'https://chain.example.test',
            explorerUrl: 'https://explorer.example.test',
            startBlock: 500,
            pollMs: 3000,
            batchSize: 512,
            concurrency: 512,
            rpcBatchSize: 128
        });
    });

    it('refuses to boot with nothing set, and names EVERY key it wants at once', () =>
    {
        // Not one key per restart: a fresh .env is fixed in one pass.
        const message = failure(() => loadChainEnv({}));
        for (const name of Object.keys(CHAIN))
        {
            expect(message).toContain(name);
        }
    });

    it('refuses each key on its own - there is no default left to fall back on', () =>
    {
        for (const name of Object.keys(CHAIN))
        {
            expect(() => loadChainEnv({ ...CHAIN, [name]: undefined }), name).toThrow(name);
        }
    });

    it('treats an EMPTY variable as missing, which is what `KEY=` in a .env means', () =>
    {
        expect(() => loadChainEnv({ ...CHAIN, POLL_MS: '' })).toThrow('POLL_MS');
        expect(() => loadChainEnv({ ...CHAIN, EXPLORER_URL: '' })).toThrow('EXPLORER_URL');
    });

    it('refuses a malformed number at BOOT rather than at the first request', () =>
    {
        // Loud at startup is the whole contract: a NaN chain id discovered on request 400 is a
        // deployment that has been answering wrongly for an hour.
        expect(() => loadChainEnv({ ...CHAIN, CHAIN_ID: 'mainnet' })).toThrow();
        expect(() => loadChainEnv({ ...CHAIN, START_BLOCK: 'latest' })).toThrow();
        expect(() => loadChainEnv({ ...CHAIN, POLL_MS: 'Infinity' })).toThrow();
        expect(() => loadChainEnv({ ...CHAIN, BATCH_SIZE: 'NaN' })).toThrow();
        expect(() => loadChainEnv({ ...CHAIN, CHAIN_ID: '  ' })).toThrow();
    });

    it('reports EVERY bad variable at once, not one per restart', () =>
    {
        const message = failure(() =>
            loadChainEnv({ ...CHAIN, CHAIN_ID: 'no', CURRENCY_DECIMALS: 'nope', BATCH_SIZE: 'never' }));
        expect(message).toContain('CHAIN_ID');
        expect(message).toContain('CURRENCY_DECIMALS');
        expect(message).toContain('BATCH_SIZE');
    });
});

describe('the database environment', () =>
{
    const CONNECTION = 'postgres://explorer:hunter2@db.example.test:5432/nura_explorer';

    it('refuses to boot without a database, and names the variable it wants', () =>
    {
        expect(() => loadDatabaseEnv({ DATABASE_POOL_SIZE: '10' })).toThrow('DATABASE_URL');
        expect(() => loadDatabaseEnv({ DATABASE_URL: '', DATABASE_POOL_SIZE: '10' })).toThrow('DATABASE_URL');
    });

    it('refuses to boot without a pool size', () =>
    {
        expect(() => loadDatabaseEnv({ DATABASE_URL: CONNECTION })).toThrow('DATABASE_POOL_SIZE');
    });

    it('reads the url and the pool size', () =>
    {
        expect(loadDatabaseEnv({ DATABASE_URL: CONNECTION, DATABASE_POOL_SIZE: '25' }))
            .toMatchObject({ url: CONNECTION, poolSize: 25 });
    });

    it('refuses a malformed pool size at boot', () =>
    {
        expect(() => loadDatabaseEnv({ DATABASE_URL: CONNECTION, DATABASE_POOL_SIZE: 'lots' })).toThrow('DATABASE_POOL_SIZE');
    });

    it('keeps the password out of the configuration\'s own printed forms', () =>
    {
        // The url carries the database password. The value is there for the store to use; a
        // config object logged in a debugging panic must not carry it into the log as well.
        const config = loadDatabaseEnv({ DATABASE_URL: CONNECTION, DATABASE_POOL_SIZE: '10' });
        expect(config.url).toBe(CONNECTION);
        expect(JSON.stringify(config)).not.toContain('hunter2');
        expect(String(config)).not.toContain('hunter2');
        // Nor into a boot failure that sits beside it.
        expect(failure(() => loadDatabaseEnv({ DATABASE_URL: CONNECTION }))).not.toContain('hunter2');
    });
});

describe('the governance and price environments', () =>
{
    it('refuse to boot with any key missing, and name it', () =>
    {
        const cosmos = failure(() => loadCosmosEnv({}));
        expect(cosmos).toContain('COSMOS_REST_URL');
        expect(cosmos).toContain('COMETBFT_RPC_URL');
        expect(cosmos).toContain('COSMOS_TIMEOUT_MS');

        const price = failure(() => loadPriceEnv({}));
        expect(price).toContain('SWAP_API_URL');
        expect(price).toContain('PRICE_TTL_MS');
        expect(price).toContain('PRICE_STALE_MS');
        expect(price).toContain('PRICE_TIMEOUT_MS');
    });

    it('read what the deployment sets', () =>
    {
        expect(loadCosmosEnv({
            COSMOS_REST_URL: 'http://node.test:1317',
            COMETBFT_RPC_URL: 'http://node.test:26657',
            COSMOS_TIMEOUT_MS: '4000'
        })).toEqual({ restUrl: 'http://node.test:1317', rpcUrl: 'http://node.test:26657', timeoutMs: 4000 });

        expect(loadPriceEnv({
            SWAP_API_URL: 'https://swap.example.test',
            PRICE_TTL_MS: '30000',
            PRICE_STALE_MS: '600000',
            PRICE_TIMEOUT_MS: '4000'
        })).toEqual({ apiUrl: 'https://swap.example.test', ttlMs: 30_000, staleMs: 600_000, timeoutMs: 4000 });
    });
});

describe('describeChain', () =>
{
    it('builds the viem chain from the configured values, with no hidden defaults', () =>
    {
        const chain = describeChain(ENV);
        expect(chain.id).toBe(1020);
        expect(chain.name).toBe('NuraChain');
        expect(chain.nativeCurrency).toEqual({ name: 'NURA', symbol: 'NURA', decimals: 18 });
        expect(chain.rpcUrls.default.http).toEqual(['stub']);
    });

    it('carries a non-18-decimal currency through', () =>
    {
        const chain = describeChain({ ...ENV, decimals: 6, symbol: 'USDX' });
        expect(chain.nativeCurrency.decimals).toBe(6);
        expect(chain.nativeCurrency.symbol).toBe('USDX');
    });
});

describe('the cache configuration', () =>
{
    it('reads every span the deployment sets', () =>
    {
        expect(loadCacheOptions(CACHE)).toEqual({
            enabled: true,
            maxEntries: 4096,
            headMs: 1000,
            balanceMs: 2000,
            callMs: 2000,
            storageMs: 2000,
            codeMs: 600_000,
            codeAbsentMs: 5000,
            tokenMs: 600_000
        });
    });

    it('refuses to boot with nothing set, and names every span', () =>
    {
        const message = failure(() => loadCacheOptions({}));
        for (const name of Object.keys(CACHE))
        {
            expect(message).toContain(name);
        }
    });

    it('can be switched off entirely with one variable', () =>
    {
        expect(loadCacheOptions({ ...CACHE, RPC_CACHE: 'false' }).enabled).toBe(false);
        expect(loadCacheOptions({ ...CACHE, RPC_CACHE: '0' }).enabled).toBe(false);
        expect(loadCacheOptions({ ...CACHE, RPC_CACHE: 'no' }).enabled).toBe(false);
        expect(loadCacheOptions({ ...CACHE, RPC_CACHE: 'true' }).enabled).toBe(true);
    });

    it('refuses a flag that is neither true nor false', () =>
    {
        expect(() => loadCacheOptions({ ...CACHE, RPC_CACHE: 'maybe' })).toThrow('RPC_CACHE');
    });

    it('lets one span be disabled without disabling the rest', () =>
    {
        const config = loadCacheOptions({ ...CACHE, RPC_CACHE_BALANCE_MS: '0' });
        expect(config.balanceMs).toBe(0);
        expect(config.headMs).toBe(1000);
    });
});

describe('the .env example stays in step with the code', () =>
{
    it('documents every variable the server reads', () =>
    {
        // A variable that exists and is undocumented is one a deployment will never set - and
        // with no default behind it, one that stops the boot.
        const declared = [
            ...Object.keys(CHAIN), ...Object.keys(CACHE),
            'DATABASE_URL', 'DATABASE_POOL_SIZE', 'TEST_DATABASE_URL',
            'COSMOS_REST_URL', 'COMETBFT_RPC_URL', 'COSMOS_TIMEOUT_MS',
            'SWAP_API_URL', 'PRICE_TTL_MS', 'PRICE_STALE_MS', 'PRICE_TIMEOUT_MS',
            'PORT', 'NODE_ENV', 'HOST', 'CLIENT_DIR', 'SSR_ENTRY'
        ];
        for (const name of declared)
        {
            expect(EXAMPLE_ENV[name], `${ name } is not set in .env.example`).toBeTruthy();
        }
    });

    it('is a complete configuration every loader accepts as it stands', () =>
    {
        // Copying the example is how a deployment starts; it must boot without filling anything in.
        expect(() => loadChainEnv(EXAMPLE_ENV)).not.toThrow();
        expect(() => loadCacheOptions(EXAMPLE_ENV)).not.toThrow();
        expect(() => loadCosmosEnv(EXAMPLE_ENV)).not.toThrow();
        expect(() => loadDatabaseEnv(EXAMPLE_ENV)).not.toThrow();
        expect(() => loadPriceEnv(EXAMPLE_ENV)).not.toThrow();
    });

    it('carries no real secret', () =>
    {
        // The file is committed. Anything that looks like a credential in it is a leak.
        expect(EXAMPLE).not.toMatch(/PRIVATE_KEY|MNEMONIC|SECRET\s*=\s*\S/i);
        // A bare `0x` followed by 64 hex digits is a private key shape.
        expect(EXAMPLE).not.toMatch(/0x[0-9a-fA-F]{64}/);
        // A connection string with a password in it - `scheme://user:password@host` - is a
        // credential however ordinary the url around it looks.
        expect(EXAMPLE).not.toMatch(/[a-z]+:\/\/[^\s/:@]+:[^\s@]+@/i);
    });
});
