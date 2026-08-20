// @vitest-environment node
//
// Configuration is read ONCE at boot and never re-consulted, so a mistake in it is a deployment
// that runs for a week pointed at the wrong chain. `loadConfig` takes any record rather than
// reaching for process.env, which is what lets these run without touching the real environment -
// no global is mutated here and no test can leak into another.
import { describe, it, expect } from 'vitest';
import { loadConfig, num, str, flag } from '@azerothjs/http';

import { describeChain, loadChainEnv } from '../src/chain/client.ts';
import { DEFAULT_CACHE, loadCacheOptions } from '../src/chain/cache.ts';
import { ENV } from './support/fixtures.ts';

/** The chain shape, declared exactly as loadChainEnv declares it, but read from a given record. */
function chainEnvFrom(env: Record<string, string | undefined>): ReturnType<typeof loadConfig>
{
    return loadConfig({
        rpcUrl: str('RPC_URL', { default: 'http://127.0.0.1:8545' }),
        chainId: num('CHAIN_ID', { default: 31337 }),
        name: str('CHAIN_NAME', { default: 'Local EVM' }),
        symbol: str('CURRENCY_SYMBOL', { default: 'ETH' }),
        decimals: num('CURRENCY_DECIMALS', { default: 18 }),
        siteUrl: str('CHAIN_SITE_URL', { default: '' }),
        explorerUrl: str('EXPLORER_URL', { default: '' }),
        startBlock: num('START_BLOCK', { default: 0 }),
        pollMs: num('POLL_MS', { default: 2000 }),
        batchSize: num('BATCH_SIZE', { default: 1000 }),
        concurrency: num('RPC_CONCURRENCY', { default: 1000 }),
        rpcBatchSize: num('RPC_BATCH_SIZE', { default: 100 }),
        dbPath: str('DB_PATH', { default: '.data/index.db' })
    }, env);
}

describe('the chain environment', () =>
{
    it('boots against a local node with nothing set at all', () =>
    {
        // A fresh clone with no .env has to start, or the first run is a configuration exercise.
        const config = chainEnvFrom({}) as Record<string, unknown>;
        expect(config.rpcUrl).toBe('http://127.0.0.1:8545');
        expect(config.chainId).toBe(31337);
        expect(config.startBlock).toBe(0);
        expect(config.dbPath).toBe('.data/index.db');
    });

    it('reads every value the deployment sets', () =>
    {
        const config = chainEnvFrom({
            RPC_URL: 'https://rpc.example.test',
            CHAIN_ID: '1020',
            CHAIN_NAME: 'Nura Chain',
            CURRENCY_SYMBOL: 'NURA',
            CURRENCY_DECIMALS: '18',
            START_BLOCK: '500',
            BATCH_SIZE: '512',
            DB_PATH: '/var/lib/nura/index.db'
        }) as Record<string, unknown>;

        expect(config).toMatchObject({
            rpcUrl: 'https://rpc.example.test',
            chainId: 1020,
            symbol: 'NURA',
            startBlock: 500,
            batchSize: 512,
            dbPath: '/var/lib/nura/index.db'
        });
    });

    it('refuses a malformed number at BOOT rather than at the first request', () =>
    {
        // Loud at startup is the whole contract: a NaN chain id discovered on request 400 is a
        // deployment that has been answering wrongly for an hour.
        expect(() => chainEnvFrom({ CHAIN_ID: 'mainnet' })).toThrow();
        expect(() => chainEnvFrom({ START_BLOCK: 'latest' })).toThrow();
        expect(() => chainEnvFrom({ POLL_MS: 'Infinity' })).toThrow();
        expect(() => chainEnvFrom({ BATCH_SIZE: 'NaN' })).toThrow();
        expect(() => chainEnvFrom({ CHAIN_ID: '  ' })).toThrow();
    });

    it('treats an EMPTY variable as unset, which is what `KEY=` in a .env means', () =>
    {
        // A commented-out or blank line must take the default rather than failing the boot -
        // otherwise every optional key has to be deleted rather than emptied.
        const config = chainEnvFrom({ POLL_MS: '', CHAIN_NAME: '' }) as Record<string, unknown>;
        expect(config.pollMs).toBe(2000);
        expect(config.chainName ?? config.name).toBe('Local EVM');
    });

    it('reports EVERY bad variable at once, not one per restart', () =>
    {
        let message = '';
        try
        {
            chainEnvFrom({ CHAIN_ID: 'no', CURRENCY_DECIMALS: 'nope', BATCH_SIZE: 'never' });
        }
        catch (error)
        {
            message = String(error);
        }
        expect(message).toContain('CHAIN_ID');
        expect(message).toContain('CURRENCY_DECIMALS');
        expect(message).toContain('BATCH_SIZE');
    });

    it('leaves the optional link empty rather than pointing at somebody else\'s site', () =>
    {
        // No default on purpose: a deployment on another network must not link its chain name to
        // a site that is not its own.
        const config = chainEnvFrom({}) as Record<string, unknown>;
        expect(config.siteUrl).toBe('');
        expect(config.explorerUrl).toBe('');
    });

    it('reads a real loadChainEnv against an ambient environment', () =>
    {
        // The function the server actually calls; it reads process.env, so this only asserts that
        // it produces a complete, well-typed object rather than pinning a machine's values.
        const config = loadChainEnv();
        expect(typeof config.rpcUrl).toBe('string');
        expect(Number.isInteger(config.chainId)).toBe(true);
        expect(Number.isInteger(config.startBlock)).toBe(true);
        expect(config.dbPath.length).toBeGreaterThan(0);
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
    /** The cache shape, declared as loadCacheOptions declares it, read from a given record. */
    function cacheFrom(env: Record<string, string | undefined>): Record<string, unknown>
    {
        return loadConfig({
            enabled: flag('RPC_CACHE', { default: DEFAULT_CACHE.enabled }),
            maxEntries: num('RPC_CACHE_MAX', { default: DEFAULT_CACHE.maxEntries }),
            headMs: num('RPC_CACHE_HEAD_MS', { default: DEFAULT_CACHE.headMs }),
            balanceMs: num('RPC_CACHE_BALANCE_MS', { default: DEFAULT_CACHE.balanceMs }),
            callMs: num('RPC_CACHE_CALL_MS', { default: DEFAULT_CACHE.callMs }),
            storageMs: num('RPC_CACHE_STORAGE_MS', { default: DEFAULT_CACHE.storageMs }),
            codeMs: num('RPC_CACHE_CODE_MS', { default: DEFAULT_CACHE.codeMs }),
            codeAbsentMs: num('RPC_CACHE_CODE_ABSENT_MS', { default: DEFAULT_CACHE.codeAbsentMs }),
            tokenMs: num('RPC_CACHE_TOKEN_MS', { default: DEFAULT_CACHE.tokenMs })
        }, env) as unknown as Record<string, unknown>;
    }

    it('is on by default, with every span defaulted', () =>
    {
        expect(cacheFrom({})).toEqual({ ...DEFAULT_CACHE });
    });

    it('can be switched off entirely with one variable', () =>
    {
        expect(cacheFrom({ RPC_CACHE: 'false' }).enabled).toBe(false);
        expect(cacheFrom({ RPC_CACHE: '0' }).enabled).toBe(false);
        expect(cacheFrom({ RPC_CACHE: 'no' }).enabled).toBe(false);
        expect(cacheFrom({ RPC_CACHE: 'true' }).enabled).toBe(true);
    });

    it('refuses a flag that is neither true nor false', () =>
    {
        expect(() => cacheFrom({ RPC_CACHE: 'maybe' })).toThrow();
    });

    it('lets one span be disabled without disabling the rest', () =>
    {
        const config = cacheFrom({ RPC_CACHE_BALANCE_MS: '0' });
        expect(config.balanceMs).toBe(0);
        expect(config.headMs).toBe(DEFAULT_CACHE.headMs);
    });

    it('holds the ordering the defaults exist to express', () =>
    {
        // Bytecode outlives a balance by orders of magnitude, and the absence of code outlives
        // neither. If these ever invert, the cache is serving stale answers for the wrong things.
        expect(DEFAULT_CACHE.codeMs).toBeGreaterThan(DEFAULT_CACHE.codeAbsentMs);
        expect(DEFAULT_CACHE.codeAbsentMs).toBeGreaterThan(DEFAULT_CACHE.balanceMs);
        expect(DEFAULT_CACHE.tokenMs).toBeGreaterThanOrEqual(DEFAULT_CACHE.codeMs);
        expect(DEFAULT_CACHE.headMs).toBeLessThanOrEqual(DEFAULT_CACHE.balanceMs);
    });

    it('reads a real loadCacheOptions without throwing on a bare environment', () =>
    {
        const options = loadCacheOptions();
        expect(typeof options.enabled).toBe('boolean');
        expect(options.maxEntries).toBeGreaterThan(0);
    });
});

describe('the .env example stays in step with the code', () =>
{
    it('documents every variable the server reads', async () =>
    {
        // A variable that exists and is undocumented is one a deployment will never set.
        const { readFileSync } = await import('node:fs');
        const { fileURLToPath } = await import('node:url');
        const { dirname, join } = await import('node:path');
        const here = dirname(fileURLToPath(import.meta.url));
        const example = readFileSync(join(here, '..', '.env.example'), 'utf8');

        const declared = [
            'RPC_URL', 'CHAIN_ID', 'CHAIN_NAME', 'CURRENCY_SYMBOL', 'CURRENCY_DECIMALS',
            'CHAIN_SITE_URL', 'EXPLORER_URL', 'START_BLOCK', 'POLL_MS', 'BATCH_SIZE',
            'RPC_CONCURRENCY', 'RPC_BATCH_SIZE', 'DB_PATH',
            'RPC_CACHE', 'RPC_CACHE_MAX', 'RPC_CACHE_HEAD_MS', 'RPC_CACHE_BALANCE_MS',
            'RPC_CACHE_CALL_MS', 'RPC_CACHE_STORAGE_MS', 'RPC_CACHE_CODE_MS',
            'RPC_CACHE_CODE_ABSENT_MS', 'RPC_CACHE_TOKEN_MS',
            'PORT', 'NODE_ENV', 'CLIENT_DIR', 'SSR_ENTRY'
        ];
        for (const name of declared)
        {
            expect(example, `${ name } is not documented in .env.example`).toContain(`${ name }=`);
        }
    });

    it('carries no real secret', () =>
    {
        // The file is committed. Anything that looks like a credential in it is a leak.
        const example = new URL('../.env.example', import.meta.url);
        return import('node:fs').then(({ readFileSync }) =>
        {
            const text = readFileSync(example, 'utf8');
            expect(text).not.toMatch(/PRIVATE_KEY|MNEMONIC|SECRET\s*=\s*\S/i);
            // A bare `0x` followed by 64 hex digits is a private key shape.
            expect(text).not.toMatch(/0x[0-9a-fA-F]{64}/);
        });
    });
});
