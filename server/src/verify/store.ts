import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

// Where verified source lives, and why it is NOT in the index.
//
// `.data/index.db` is a cache: every row in it is derived from the chain, and the README tells
// operators they may delete it and let the indexer replay. Source code is the opposite - somebody
// typed it in, nothing on the chain can reproduce it, and a replay would lose it forever. So it
// gets its own file, its own lifetime and its own backup story.
//
// A row here is only ever written after the compiler reproduced the deployed bytecode (see
// match.ts). That is what makes an open submission endpoint safe: the bytes are the credential,
// so there is nothing to authenticate - and nothing a wrong ABI could quietly overwrite.

/** Bumped when a column changes. Unlike the index, this table is MIGRATED, never dropped. */
const SCHEMA_VERSION = '1';

const DDL = `
CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS verified (
    address TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    compiler TEXT NOT NULL,
    optimizer INTEGER NOT NULL,
    runs INTEGER NOT NULL,
    evm_version TEXT NOT NULL,
    license TEXT NOT NULL,
    match_kind TEXT NOT NULL,
    abi TEXT NOT NULL,
    input TEXT NOT NULL,
    verified_at INTEGER NOT NULL
);
`;

export interface VerifiedRow
{
    address: string;

    /** The contract whose bytecode matched - one submission can declare a dozen. */
    name: string;

    /** The long version, `0.8.24+commit.e11b9ed9`: a bare `0.8.24` does not pin a build. */
    compiler: string;
    optimizer: number;
    runs: number;

    /** '' when the submission left this to the compiler's own default for that version. */
    evm_version: string;
    license: string;

    /** 'full' or 'partial' - what the comparison in match.ts concluded. */
    match_kind: string;

    /** The ABI as the compiler emitted it, verbatim JSON. */
    abi: string;

    /**
     * The solc standard-json input that produced the match, verbatim.
     *
     * Kept whole rather than as a bare `sources` map, because it is the RECIPE: with the compiler
     * version above, anyone can rerun it and get the deployed bytes back. The source files shown
     * on the page are read out of it, so there is no second copy to drift from what was compiled.
     */
    input: string;
    verified_at: number;
}

/** One source file as the page shows it. */
export interface SourceFile
{
    path: string;
    content: string;
}

export class SourceStore
{
    readonly #db: DatabaseSync;

    readonly #statements = new Map<string, StatementSync>();

    constructor(path: string)
    {
        // sqlite creates the FILE but not the directory holding it - the same reason the index
        // does this, and the same fresh-clone failure if it does not.
        if (path !== ':memory:')
        {
            const parent = dirname(resolve(path));
            if (!existsSync(parent))
            {
                mkdirSync(parent, { recursive: true });
            }
        }
        this.#db = new DatabaseSync(path);
        // `synchronous = FULL`, unlike the index: nothing can replay these rows, so one fsync per
        // commit is the price of not losing a submission to a power cut. There are a handful of
        // writes a day here, not a hundred thousand a minute.
        this.#db.exec(`
            PRAGMA journal_mode = WAL;
            PRAGMA synchronous = FULL;
            PRAGMA busy_timeout = 5000;`);
        this.#db.exec(DDL);
        this.#migrate();
    }

    #stmt(sql: string): StatementSync
    {
        let statement = this.#statements.get(sql);
        if (statement === undefined)
        {
            statement = this.#db.prepare(sql);
            this.#statements.set(sql, statement);
        }
        return statement;
    }

    /**
     * Records the schema version, and would ALTER rather than drop.
     *
     * The index migrates by dropping, because the chain replays it. Nothing replays this file, so
     * a future column is an ALTER and a backfill; until there is one, stamping the version is the
     * whole of the work - and the stamp is what a later migration will branch on.
     */
    #migrate(): void
    {
        const known = this.#stmt('SELECT value FROM meta WHERE key = ?').get('schema') as { value: string } | undefined;
        if (known?.value === SCHEMA_VERSION)
        {
            return;
        }
        this.#stmt('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value')
            .run('schema', SCHEMA_VERSION);
    }

    public close(): void
    {
        this.#db.close();
    }

    public find(address: string): VerifiedRow | null
    {
        const row = this.#stmt('SELECT * FROM verified WHERE address = ?').get(address.toLowerCase());
        return (row as VerifiedRow | undefined) ?? null;
    }

    /** Whether this address has published source, without dragging the sources across. */
    public isVerified(address: string): boolean
    {
        return this.#stmt('SELECT 1 FROM verified WHERE address = ?').get(address.toLowerCase()) !== undefined;
    }

    /**
     * Writes a verification, replacing any earlier one for the same address.
     *
     * Replacing is safe for the same reason the endpoint needs no password: a row exists only
     * because the compiler reproduced the deployed bytecode, so a second submission that also
     * matches describes the same code. One that does not match never reaches here.
     */
    public save(row: Omit<VerifiedRow, 'verified_at'> & { verified_at?: number }): void
    {
        this.#stmt(`
            INSERT INTO verified (address, name, compiler, optimizer, runs, evm_version, license, match_kind, abi, input, verified_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (address) DO UPDATE SET
                name = excluded.name,
                compiler = excluded.compiler,
                optimizer = excluded.optimizer,
                runs = excluded.runs,
                evm_version = excluded.evm_version,
                license = excluded.license,
                match_kind = excluded.match_kind,
                abi = excluded.abi,
                input = excluded.input,
                verified_at = excluded.verified_at`)
            .run(
                row.address.toLowerCase(),
                row.name,
                row.compiler,
                row.optimizer,
                row.runs,
                row.evm_version,
                row.license,
                row.match_kind,
                row.abi,
                row.input,
                row.verified_at ?? Math.floor(Date.now() / 1000));
    }

    /** How many contracts on this deployment have published source. */
    public count(): number
    {
        const row = this.#stmt('SELECT COUNT(*) AS total FROM verified').get() as { total: number } | undefined;
        return row?.total ?? 0;
    }
}

/**
 * The source files inside a stored standard-json input.
 *
 * Read back rather than stored twice: the input IS the record, and a second copy of the same text
 * is a second thing that can disagree with what the compiler was actually given.
 */
export function sourcesOf(input: string): SourceFile[]
{
    try
    {
        const parsed = JSON.parse(input) as { sources?: Record<string, { content?: string }> };
        return Object.entries(parsed.sources ?? {})
            .map(([path, entry]) => ({ path, content: entry.content ?? '' }))
            .sort((left, right) => left.path.localeCompare(right.path));
    }
    catch
    {
        // A row whose input will not parse is a row written by a version of this server that no
        // longer exists. The page shows the ABI and says the sources are unavailable, rather than
        // failing the whole request over them.
        return [];
    }
}
