// The one place a test gets an index from: a schema of its own in a real PostgreSQL.
//
// The suite runs against PostgreSQL itself, through the same TypeORM and pg the server uses - a
// stand-in would agree with production only where somebody remembered to make it. The database is
// TEST_DATABASE_URL, from the environment or from that one key of server/.env (see
// vitest.config.ts). Every store a test opens gets a schema nobody else will pick, so files run in
// parallel and in any order without seeing each other's rows, and everything a test opened - its
// followers first, so none is left polling a closed store - is torn down after it by `setup.ts`.
import pg from 'pg';

import type { IndexerHandle } from '../../src/chain/indexer.ts';
import { IndexStore } from '../../src/chain/store.ts';

/** A schema this suite made: `t_<worker>_<process>_<n>`. Nothing else in the database matches. */
export const TEST_SCHEMA = /^t_\d+_\d+_\d+$/;

interface Opened
{
    store: IndexStore;
    schema: string;

    /** Whether the teardown drops the schema too - false for a second store over another's. */
    owns: boolean;
}

const opened: Opened[] = [];
const followers: IndexerHandle[] = [];
let made = 0;

/** One connection per worker for making and dropping schemas; each store brings a pool of its own. */
let admin: pg.Pool | null = null;

function database(): string
{
    const url = process.env.TEST_DATABASE_URL;
    if (url === undefined || url === '')
    {
        throw new Error('TEST_DATABASE_URL is not set: the server suite needs a PostgreSQL database it may create '
            + 'schemas in - set it in the environment or in server/.env (see server/.env.example)');
    }
    return url;
}

function adminPool(): pg.Pool
{
    admin ??= new pg.Pool({ connectionString: database(), max: 1 });
    return admin;
}

export interface TestStoreOptions
{
    /**
     * Strict by default: a query that escapes the transaction it was written in fails on the spot
     * instead of committing on a connection of its own. Off only where a test runs two callers at
     * once on purpose.
     */
    strict?: boolean;
}

/** An empty index for one test, in a schema of its own, torn down after the test. */
export async function openTestStore(options: TestStoreOptions = {}): Promise<IndexStore>
{
    made += 1;
    const schema = `t_${ process.env.VITEST_POOL_ID ?? '0' }_${ process.pid }_${ made }`;
    await adminPool().query(`CREATE SCHEMA "${ schema }"`);
    try
    {
        // Two connections: one for a transaction and one for a read beside it is all any test
        // asks of a store, and a worker that opened several must still fit the server's limit.
        const store = await IndexStore.open({
            connection: { url: database(), schema, poolSize: 2 },
            strict: options.strict ?? true
        });
        opened.push({ store, schema, owns: true });
        return store;
    }
    catch (error)
    {
        await adminPool().query(`DROP SCHEMA IF EXISTS "${ schema }" CASCADE`);
        throw error;
    }
}

/** The schema a store opened by this harness lives in. */
export function schemaOf(store: IndexStore): string
{
    const entry = opened.find((candidate) => candidate.store === store);
    if (entry === undefined)
    {
        throw new Error('not a store this harness opened');
    }
    return entry.schema;
}

/**
 * A second store over the same schema as `store` - what a restart is - closed after the test like
 * the first. The schema is dropped once, with its original.
 */
export async function reopen(store: IndexStore): Promise<IndexStore>
{
    const schema = schemaOf(store);
    const again = await IndexStore.open({ connection: { url: database(), schema, poolSize: 2 }, strict: true });
    opened.push({ store: again, schema, owns: false });
    return again;
}

/** A statement against the test database itself, outside any store - for looking at what one left. */
export async function inspect<T extends Record<string, unknown>>(sql: string, parameters: unknown[] = []): Promise<T[]>
{
    return (await adminPool().query<T>(sql, parameters)).rows;
}

/** The database the suite runs against, for a test that needs a connection of its own. */
export function testDatabase(): string
{
    return database();
}

/** Registers a running follower, so the teardown stops it before closing the store under it. */
export function follow(handle: IndexerHandle): IndexerHandle
{
    followers.push(handle);
    return handle;
}

/** Stops every follower, closes every store and drops every schema the current test made. */
export async function releaseTestStores(): Promise<void>
{
    await Promise.all(followers.splice(0).map((handle) => handle.stop()));
    const closing = opened.splice(0);
    await Promise.all(closing.map(({ store }) => store.close()));
    for (const { schema } of closing.filter((entry) => entry.owns))
    {
        await adminPool().query(`DROP SCHEMA IF EXISTS "${ schema }" CASCADE`);
    }
}

/** Ends this worker's own connection once its file is done. */
export async function closeTestDatabase(): Promise<void>
{
    const pool = admin;
    admin = null;
    await pool?.end();
}

/**
 * Drops every schema this suite has ever made in the database at `url` - the leftovers of a run
 * that died before its teardown included. Only names matching {@link TEST_SCHEMA}; nothing else
 * in the database is touched.
 */
export async function sweepTestSchemas(url: string): Promise<void>
{
    const client = new pg.Client({ connectionString: url });
    await client.connect();
    try
    {
        const { rows } = await client.query<{ name: string }>("SELECT nspname AS name FROM pg_namespace WHERE nspname LIKE 't\\_%'");
        for (const { name } of rows.filter((row) => TEST_SCHEMA.test(row.name)))
        {
            await client.query(`DROP SCHEMA IF EXISTS "${ name }" CASCADE`);
        }
    }
    finally
    {
        await client.end();
    }
}
