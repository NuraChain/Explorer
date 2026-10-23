import { loadConfig, num, str } from '@azerothjs/http';
import pg from 'pg';
import type { DataSourceOptions } from 'typeorm';

import { ENTITIES } from './entities.ts';
import { InitialIndex1792713600000 } from './migrations/1792713600000-initial-index.ts';

// Where the index lives, and the TypeORM configuration every index is opened with.
//
// The invariants are written down here once - the driver, the entities, the migrations, how an
// int8 crosses into JS, how long anything may wait - so a deployment and the test suite differ only
// in WHERE they connect, never in how.

/** The database a deployment's environment names. */
export interface DatabaseEnv
{
    /** A PostgreSQL connection string. Secret: it carries the password, so it is redacted from logs. */
    url: string;

    /** Connections the pool may hold. The follower holds one per batch; a request, one per read. */
    poolSize: number;
}

/** Reads the database configuration from the environment (or `env`, for a test). */
export function loadDatabaseEnv(env?: Record<string, string | undefined>): DatabaseEnv
{
    return loadConfig({
        // No default. An index silently pointed at the wrong database is worse than a server that
        // refuses to start, and the boot error names the variable.
        url: str('DATABASE_URL', { secret: true }),
        poolSize: num('DATABASE_POOL_SIZE', { default: 10 })
    }, env);
}

/** How to reach a database - all that differs between a deployment and a test. */
export interface Connection
{
    url?: string;

    /** The schema the tables live in; `public` unless a test gives every store its own. */
    schema?: string;

    poolSize?: number;

    /** pg Pool and client options, laid over the limits below. */
    extra?: Record<string, unknown>;
}

/** Every migration, in order - an explicit list like the entities, never a glob. */
export const MIGRATIONS = [InitialIndex1792713600000];

/** The one member of TypeORM's options union this index is opened with. */
export type PostgresOptions = Extract<DataSourceOptions, { type: 'postgres' }>;

/** The DataSource configuration for one connection. */
export function dataSourceOptions(connection: Connection): PostgresOptions
{
    return {
        type: 'postgres',
        // Handed over rather than left to TypeORM to `require`: the server's own copy of pg, found
        // the way every other import is, wherever npm placed it.
        driver: pg,
        url: connection.url,
        schema: connection.schema,
        poolSize: connection.poolSize ?? 10,
        applicationName: 'nura-explorer',
        // Every count, height and timestamp is an int8, and pg hands int8 to JS as a STRING unless
        // told otherwise - the wire schemas would then refuse every list. None of them gets near
        // 2^53; wei never is an int8 at all. The store checks this took effect when it opens.
        parseInt8: true,
        installExtensions: false,
        synchronize: false,
        migrationsRun: false,
        entities: ENTITIES,
        migrations: MIGRATIONS,
        extra: {
            // pg waits forever by default, for a connection and for a query alike. A database that
            // stops answering must cost a request an error, not hold it - and its pooled connection
            // - for as long as the database takes.
            connectionTimeoutMillis: 5_000,
            idleTimeoutMillis: 30_000,
            statement_timeout: 30_000,
            lock_timeout: 10_000,
            idle_in_transaction_session_timeout: 60_000,
            keepAlive: true,
            ...connection.extra
        }
    };
}

/** The connection a deployment's environment describes. */
export function connectionOf(env: DatabaseEnv): Connection
{
    return { url: env.url, poolSize: env.poolSize };
}
