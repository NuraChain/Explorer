import { fileURLToPath, pathToFileURL } from 'node:url';

import { pipeline, requestId, securityHeaders, rateLimit, logRequests, loadConfig, num, oneOf, str } from '@azerothjs/http';
import { manifestOf } from '@azerothjs/http/api';
import { serve, handleShutdownSignals } from '@azerothjs/http/node';
import { imageHandler, type KitErrorObserver, type PageRenderer, type PageRoute } from '@azerothjs/kit';
import { SSR_SOURCE_ENTRY } from '@azerothjs/kit/dev/entry';
import { createLogger, teeSink, terminalSink } from '@azerothjs/logger';
import { fileSink } from '@azerothjs/logger/node';

import { buildApp, createApi, registerApi, LOCALES } from './app.ts';
import { CachedChain, loadCacheOptions } from './chain/cache.ts';
import { ChainReader, loadChainEnv } from './chain/client.ts';
import { loadCosmosEnv } from './chain/cosmos.ts';
import { connectionOf, loadDatabaseEnv } from './chain/data-source.ts';
import { IndexStore } from './chain/store.ts';
import { startIndexer } from './chain/indexer.ts';
import { loadPriceEnv, SwapPriceFeed } from './price.ts';

// ONE .env, at the repository root. Resolved from this module rather than from the working
// directory, so it is found however the process is started. A variable already in the environment wins over the file.
try
{
    process.loadEnvFile(fileURLToPath(new URL('../../.env', import.meta.url)));
}
catch
{
    // No .env file - the ambient environment is the configuration (a container's --env-file).
}

/*
 * Every key in the .env is required, and none has a default in code.
 *
 * All of it is read HERE, before anything opens the database, starts the follower or binds a
 * port, so a missing key fails the boot with nothing half-started. Each loader names only its own
 * keys; their complaints are gathered into ONE error so a fresh .env is fixed in one pass rather
 * than one restart per key.
 */
const problems: string[] = [];
function read<T>(load: () => T): T
{
    try
    {
        return load();
    }
    catch (error)
    {
        const message = error instanceof Error ? error.message : String(error);
        const lines = message.split('\n').filter((line) => line.startsWith('  - '));
        problems.push(...(lines.length > 0 ? lines : [`  - ${ message }`]));
        // Never read: the throw below fires before any of these values is used.
        return undefined as T;
    }
}

const config = read(() => loadConfig({
    port: num('PORT'),
    env: oneOf('NODE_ENV', ['development', 'production', 'test']),
    // Bound only by the development session; production keeps the adapter's own bind, which is
    // what a container needs. Required anyway, so the .env is the one place it is decided.
    host: str('HOST'),
    clientDir: str('CLIENT_DIR'),
    ssrEntry: str('SSR_ENTRY')
}));
const chainEnv = read(() => loadChainEnv());
// The same node's OTHER two apis: the Cosmos REST module api and CometBFT's rpc. Governance lives
// there rather than in the EVM, and the explorer is meant to run beside the node that serves them.
const cosmosEnv = read(() => loadCosmosEnv());
const databaseEnv = read(() => loadDatabaseEnv());
const cacheOptions = read(() => loadCacheOptions());
const priceEnv = read(() => loadPriceEnv());

if (problems.length > 0)
{
    throw new Error(`Configuration is invalid (${ problems.length } problem${ problems.length === 1 ? '' : 's' }):\n`
        + problems.join('\n'));
}

const isProduction = config.env === 'production';

// Readable lines on the terminal, NDJSON in server/logs/ - both, in every mode. The file alone
// was enough while vite owned the terminal in development; this process owns it now, and a dev
// session that says nothing about the requests it is answering is a session you cannot read.
const log = createLogger({
    sink: teeSink(terminalSink(), fileSink('logs/')),
    fields: { service: 'nura-explorer-server' }
});

// The indexer half: the chain description, the PostgreSQL index, and the follower that keeps it
// current. It starts BEFORE the server binds and is never awaited - a backfill of a long chain
// takes minutes, and the explorer must serve what it already has while the rest arrives. The
// stats endpoint reports both heads so a reader can see the gap.
const chain = new ChainReader(chainEnv);
// Opening migrates the index, and fails the boot - loudly, with the reason - when the database is
// unreachable or unfit; a supervisor's restart policy is what retries it.
const store = await IndexStore.open({ connection: connectionOf(databaseEnv), log });
const indexer = startIndexer(store, chain, log);

// The API reads the node THROUGH a cache; the indexer above keeps the raw reader. Same node, two
// appetites: the sync path reads each height once and must see a reorg the moment it happens,
// while the API is asked for the same head, the same bytecode and the same balances by every
// visitor at once. See chain/cache.ts for what is held and for how long.
const reads = new CachedChain(chain, cacheOptions);

// The only read in this process that is not the chain. It is held behind its own TTL, so the
// exchange sees one request every half minute however many people are on the home page, and a
// failure there is logged and then forgotten - the route answers `null` and the page prints
// nothing rather than an error nobody can act on.
const price = new SwapPriceFeed(priceEnv, chainEnv.symbol, {
    onError: (error: unknown) => log.warn('price feed unreachable', { error: String(error) })
});

log.info('indexing', { rpc: chainEnv.rpcUrl, chainId: chainEnv.chainId, from: chainEnv.startBlock });

// This server serves the whole app - one origin, in development as in production. The SSR bundle
// is ONE self-contained file, so importing it gives the kit both the route table and the page
// renderer. Development builds nothing: the session below loads those same two exports from
// source, through vite, inside this process.
const ssr = isProduction
    ? await import(pathToFileURL(config.ssrEntry).href) as { routes: PageRoute[]; renderPage: PageRenderer }
    : undefined;

log.info('governance', { rest: cosmosEnv.restUrl, cometbft: cosmosEnv.rpcUrl });

const deps = { store, chain: reads, cosmos: cosmosEnv, price };
const observe = logRequests(log);

/*
 * The ONE api this process holds.
 *
 * Built here rather than inside `buildApp` because both arms of the boot need the same instance:
 * governance and staking each carry a five-second hold, and a second instance would be a second
 * hold asking the node on its own schedule.
 */
const api = createApi(deps);

/*
 * A page failure has nowhere else to go.
 *
 * A rejected loader renders the page at a real 500 rather than throwing, so the kernel's own
 * error path never sees it - the kit reports it here instead, and its default is `console.error`,
 * which the NDJSON log never receives.
 */
const pageError: KitErrorObserver = (error, context) =>
    log.error('page failed', { path: context.path, phase: context.phase, error });

/*
 * Development runs the production page mount, fed by vite inside THIS process.
 *
 * One origin serves the pages, the api and the HMR socket, over the same route table and the same
 * renderer a deploy uses - so locale negotiation, real 404s and the manifest splice are things
 * you can see in dev rather than things you could only see after a build. There is no second
 * port and no proxy. The import is dynamic because vite is a devDependency a production image
 * (`npm ci --omit=dev`) never installs.
 */
const kitDev = isProduction ? undefined : await import('@azerothjs/kit/dev');
const session = await kitDev?.devPages({
    root: fileURLToPath(new URL('../../application/', import.meta.url)),
    entry: SSR_SOURCE_ENTRY,
    pages: { manifest: manifestOf(api), locales: LOCALES, onError: pageError },
    routes: (target) =>
    {
        /*
         * The image endpoint, by hand, because a dev session serves no built client and
         * `images: true` is a mount error there. Rooted at `public/` rather than at `dist/`,
         * which is where the creatives live before a build copies them.
         */
        target.get('/_image', imageHandler({ root: fileURLToPath(new URL('../../application/public/', import.meta.url)) }));
        registerApi(target, api, deps);
    },
    app: { dev: true, observe },
    // The single-instance check resolves `azerothjs` from THIS module rather than from the kit,
    // so a second copy under the server half is refused at startup instead of silently splitting
    // the request scope.
    serverAnchor: import.meta.url
});

const app = session?.app ?? buildApp({
    ...deps,
    api,
    dev: !isProduction,
    observe,
    pages: ssr === undefined
        ? undefined
        : { routes: ssr.routes, clientDir: config.clientDir, renderer: ssr.renderPage, onError: pageError }
});

const handler = pipeline(
    app,
    requestId(),
    securityHeaders(),
    rateLimit({ limit: 200, windowMs: 60_000 })
);

const served = await serve(handler, {
    port: config.port,
    // Vite's own middleware, ahead of the kernel: it sees only its own urls and the files under
    // the application root. Undefined in production, where there is no session.
    before: session?.before,
    // Dev binds IPv4 loopback, because `localhost` resolves to ::1 first on some platforms and a
    // page that cannot reach its own origin is the confusing failure. HOST=0.0.0.0 opens it to
    // another device. Production keeps the adapter's own bind.
    hostname: isProduction ? undefined : config.host
});

// The HMR socket rides THIS server: vite was given a relay it never listens on, so the page dials
// its own origin and a tab survives the process restarting.
session?.attach(served.server);

/**
 * Waits for one shutdown step, but never longer than `ms`. A step still running when its time is
 * up is left behind, and a rejection it lands later is dropped - the sequence has moved on, and
 * there is nobody left to tell.
 */
function within(step: Promise<unknown> | undefined, ms: number): Promise<void>
{
    return new Promise<void>((resolve, reject) =>
    {
        if (step === undefined)
        {
            resolve();
            return;
        }
        // Unref'd: a cap must never be the thing that keeps a finished process alive.
        const timer = setTimeout(resolve, ms).unref();
        step.then(
            () =>
            {
                clearTimeout(timer);
                resolve();
            },
            (error: unknown) =>
            {
                clearTimeout(timer);
                reject(error);
            });
    });
}

/*
 * Shutdown, bounded at every step.
 *
 * The follower owns a timer and the index a pool of connections; a shutdown that leaves them
 * running keeps the process alive and a transaction open. So the follower is told to stop before
 * the drain and waited for after it - never in front of the drain, which is what lets go of the
 * port - and the store closes last, once nothing that reads it is left.
 *
 * Each wait has a cap and a hard exit caps them all, so the process ends on its own inside a
 * thirty-second stop window instead of at Docker's kill: a close that never returns - a
 * transaction that never settles, a hung pool - must not hold the port until then. Exiting with
 * the store still open loses nothing, because the cursor commits with the rows it covers and the
 * next boot resumes from it.
 */
let stopping: Promise<void> | undefined;
handleShutdownSignals(served, {
    gracePeriodMs: 8_000,
    beforeShutdown: () =>
    {
        setTimeout(() => process.exit(1), 25_000).unref();
        stopping = indexer.stop();
    },
    beforeExit: async () =>
    {
        try
        {
            await within(stopping, 5_000);
            await within(session?.close(), 2_000);
        }
        finally
        {
            await within(store.close(), 5_000);
        }
    },
    onError: (error: unknown) => log.error('shutdown failed', { error: String(error) })
});

// The panel's Server tab connects here and mirrors the server's reactive graph: request roots,
// their per-request state, and long-lived stores. That is live application data, so the bridge
// attaches ONLY under NODE_ENV=development and every upgrade must present the token below from a
// loopback peer. The token is minted per boot: it is never written to disk and never committed.
// `azeroth dev` sets NODE_ENV=development, so `npm run dev` gets the panel.
if (config.env === 'development')
{
    const { attachDevtools } = await import('@azerothjs/devtools/server');
    const token = crypto.randomUUID();
    attachDevtools(served.server, { token });
    log.info('devtools bridge', { url: `ws://localhost:${ served.port }/__azeroth/devtools?token=${ token }` });
}

log.info('Listening', { port: served.port, env: config.env });
