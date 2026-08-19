import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

// Where a compiler comes from.
//
// Verification is only meaningful if the EXACT build that produced the deployed bytecode runs
// again: solc changes its output between patch releases, so `0.8.24` is not a compiler - only
// `0.8.24+commit.e11b9ed9` is. This module is the supply of those builds, and it looks in one
// place before it reaches for another.
//
// Local first, then the network. An operator who drops soljson files into SOLC_DIR never makes an
// outbound request, which is the same rule the rest of this explorer follows: nothing here needs
// a third party to be online in order to work. But a fresh install has an empty directory, and a
// verification form offering no compilers is a feature that does not exist - so a missing build
// is fetched once from the official binaries host, checked against the sha256 that host publishes
// alongside it, and cached on disk forever after.

/** The official builds, and the two directories they live in. */
const BINARIES = 'https://binaries.soliditylang.org';

/**
 * WebAssembly builds first: they are several times faster than the asm.js ones and cover every
 * release back to 0.3.6. `bin` is the fallback for the handful of releases that were never
 * rebuilt to wasm - an old contract is exactly the case where source is worth publishing.
 */
const DIRECTORIES = ['emscripten-wasm32', 'bin'] as const;

/** How long a fetched release list is trusted before it is asked for again. */
const LIST_TTL_MS = 6 * 60 * 60 * 1000;

/** A remote list is a few hundred KB; a build is ten MB. Neither should hang the request. */
const LIST_TIMEOUT_MS = 15_000;
const DOWNLOAD_TIMEOUT_MS = 180_000;

/** One build of the compiler, as the binaries host describes it. */
export interface CompilerBuild
{
    /** `0.8.24` - the release. Several builds can share it; only one is a release build. */
    version: string;

    /** `0.8.24+commit.e11b9ed9` - the build. THIS is what pins compiler output. */
    longVersion: string;

    /** Which directory on the binaries host holds it. */
    directory: string;

    /** The file name within that directory. */
    path: string;

    /** The digest the host publishes for it, `0x...`. Empty for a build found only on disk. */
    sha256: string;
}

/** A build as the verification form lists it. */
export interface CompilerOption
{
    version: string;
    longVersion: string;

    /** True when the build is already on disk, so choosing it downloads nothing. */
    local: boolean;
}

interface ListEntry
{
    path: string;
    version: string;
    longVersion: string;
    prerelease?: string;
    sha256?: string;
}

interface ReleaseList
{
    builds: ListEntry[];
    releases: Record<string, string>;
}

/** The canonical on-disk name, whichever directory the build was fetched from. */
function fileNameOf(longVersion: string): string
{
    return `soljson-v${ longVersion }.js`;
}

/**
 * `soljson-v0.8.24+commit.e11b9ed9.js` -> `0.8.24+commit.e11b9ed9`, or null for anything else.
 *
 * `.cjs` is accepted as well as `.js` because that is what an operator reaches for when they know
 * this package is ESM. Both work - see {@link CompilerSupply.ensure} for why.
 */
function longVersionOf(fileName: string): string | null
{
    const match = /^soljson-v(.+)\.(?:js|cjs)$/.exec(fileName);
    return match?.[1] ?? null;
}

/** `0.8.24+commit.e11b9ed9` -> `[0, 8, 24]`, for ordering. A missing part sorts as 0. */
function ordinal(version: string): number
{
    const [major = '0', minor = '0', patch = '0'] = version.split('+')[0]!.split('.');
    return Number(major) * 1_000_000 + Number(minor) * 1_000 + Number(patch);
}

export interface CompilerSupplyOptions
{
    /** Where builds are kept, and where downloads land. */
    directory: string;

    /** Swappable so the tests never touch the network. */
    fetchImpl?: typeof fetch;
}

/**
 * The set of compilers this server can run, and the file for any one of them.
 *
 * Holds two caches, both cheap and both allowed to be stale: the release lists (re-fetched every
 * few hours) and the set of files on disk (re-read whenever a download lands).
 */
export class CompilerSupply
{
    readonly #directory: string;

    readonly #fetch: typeof fetch;

    #lists: CompilerBuild[] | null = null;

    #listedAt = 0;

    /** One in-flight fetch per build, so two submissions of the same version download it once. */
    readonly #downloads = new Map<string, Promise<string>>();

    constructor(options: CompilerSupplyOptions)
    {
        this.#directory = resolve(options.directory);
        this.#fetch = options.fetchImpl ?? fetch;
    }

    /** The builds already on disk, newest first. Cheap enough to re-read on every call. */
    public localBuilds(): CompilerBuild[]
    {
        if (!existsSync(this.#directory))
        {
            return [];
        }
        return readdirSync(this.#directory)
            .map(longVersionOf)
            .filter((entry): entry is string => entry !== null)
            .map((longVersion): CompilerBuild => ({
                version: longVersion.split('+')[0] ?? longVersion,
                longVersion,
                directory: '',
                path: fileNameOf(longVersion),
                sha256: ''
            }))
            .sort((left, right) => ordinal(right.version) - ordinal(left.version));
    }

    /**
     * Every RELEASE the binaries host publishes, newest first.
     *
     * Releases only - the nightlies are thousands of builds nobody deploys from, and a select
     * element with 2000 entries is not a choice a person can make. A contract compiled by a
     * nightly is verified by dropping that build into SOLC_DIR, where it is picked up by name.
     */
    async #remoteBuilds(): Promise<CompilerBuild[]>
    {
        if (this.#lists !== null && Date.now() - this.#listedAt < LIST_TTL_MS)
        {
            return this.#lists;
        }

        const found = new Map<string, CompilerBuild>();
        for (const directory of DIRECTORIES)
        {
            const list = await this.#releaseList(directory);
            if (list === null)
            {
                continue;
            }
            const digests = new Map(list.builds.map((entry) => [entry.path, entry.sha256 ?? '']));
            for (const [version, path] of Object.entries(list.releases))
            {
                // The FIRST directory to claim a release wins, so a wasm build is never displaced
                // by the slower asm.js one for the same version.
                if (found.has(version))
                {
                    continue;
                }
                const build = list.builds.find((entry) => entry.path === path);
                found.set(version, {
                    version,
                    longVersion: build?.longVersion ?? version,
                    directory,
                    path,
                    sha256: digests.get(path) ?? ''
                });
            }
        }

        if (found.size === 0)
        {
            // Nothing reachable. Do NOT cache the emptiness - the next submission should try
            // again rather than be told for six hours that no compiler exists.
            return this.#lists ?? [];
        }

        this.#lists = [...found.values()].sort((left, right) => ordinal(right.version) - ordinal(left.version));
        this.#listedAt = Date.now();
        return this.#lists;
    }

    async #releaseList(directory: string): Promise<ReleaseList | null>
    {
        try
        {
            const response = await this.#fetch(`${ BINARIES }/${ directory }/list.json`, {
                signal: AbortSignal.timeout(LIST_TIMEOUT_MS)
            });
            return response.ok ? (await response.json()) as ReleaseList : null;
        }
        catch
        {
            // Offline, blocked, or the host is having a day. Local builds still work, and the
            // form says so rather than showing an error where a list belongs.
            return null;
        }
    }

    /**
     * What the form offers: everything on disk, then every release that could be fetched.
     *
     * `offline` is not an error - it is the state of a deployment with no outbound access, and it
     * changes what the page should say: with local builds it is a shorter list, with none it is
     * "ask the operator to populate SOLC_DIR".
     */
    public async options(): Promise<{ versions: CompilerOption[]; offline: boolean }>
    {
        const local = new Set(this.localBuilds().map((entry) => entry.longVersion));
        const remote = await this.#remoteBuilds();
        const merged = new Map<string, CompilerOption>();

        for (const build of this.localBuilds())
        {
            merged.set(build.longVersion, { version: build.version, longVersion: build.longVersion, local: true });
        }
        for (const build of remote)
        {
            if (!merged.has(build.longVersion))
            {
                merged.set(build.longVersion, {
                    version: build.version,
                    longVersion: build.longVersion,
                    local: local.has(build.longVersion)
                });
            }
        }

        return {
            versions: [...merged.values()].sort((left, right) => ordinal(right.version) - ordinal(left.version)),
            offline: remote.length === 0
        };
    }

    /**
     * The build a submission named, by long version or by bare release.
     *
     * A bare `0.8.24` resolves to that release's build, which is what a person reading a pragma
     * has in hand. Anything not on disk and not in the lists is refused by name.
     */
    public async resolve(wanted: string): Promise<CompilerBuild | null>
    {
        const asked = wanted.trim().replace(/^v/, '');
        if (asked === '')
        {
            return null;
        }

        const onDisk = this.localBuilds().find((entry) => entry.longVersion === asked || entry.version === asked);
        if (onDisk !== undefined)
        {
            return onDisk;
        }

        const remote = await this.#remoteBuilds();
        return remote.find((entry) => entry.longVersion === asked || entry.version === asked) ?? null;
    }

    /**
     * The path to a build's file, downloading it once if it is not already here.
     *
     * The digest is checked before the file is put in place, and the write is a rename from a
     * temporary name in the same directory: a download interrupted halfway must not leave
     * something that LOOKS like a compiler, because the next request would load it and fail in a
     * way that has nothing to do with the source anyone submitted.
     */
    public async ensure(build: CompilerBuild): Promise<string>
    {
        this.#declareCommonJs();

        const target = join(this.#directory, fileNameOf(build.longVersion));
        if (existsSync(target))
        {
            return target;
        }
        if (build.directory === '')
        {
            throw new Error(`The compiler ${ build.longVersion } is not on disk and no download location is known for it.`);
        }

        const running = this.#downloads.get(build.longVersion);
        if (running !== undefined)
        {
            return running;
        }

        const download = this.#download(build, target).finally(() => this.#downloads.delete(build.longVersion));
        this.#downloads.set(build.longVersion, download);
        return download;
    }

    /**
     * Marks the build directory as CommonJS, which is what makes any of this loadable.
     *
     * A soljson build is a CommonJS file that ends in `.js`, and this server is an ESM package -
     * so Node reads every `.js` under it as a module and the compiler dies on its first
     * `__dirname`. The nearest `package.json` decides that question, and one containing
     * `{"type":"commonjs"}` beside the builds answers it for all of them, whatever they are named
     * and whoever put them there. Written rather than documented, because the alternative is an
     * operator dropping in the official file under its official name and getting a stack trace.
     */
    #declareCommonJs(): void
    {
        if (!existsSync(this.#directory))
        {
            mkdirSync(this.#directory, { recursive: true });
        }
        const marker = join(this.#directory, 'package.json');
        if (!existsSync(marker))
        {
            writeFileSync(marker, `${ JSON.stringify({ type: 'commonjs' }, null, 4) }\n`);
        }
    }

    async #download(build: CompilerBuild, target: string): Promise<string>
    {
        const response = await this.#fetch(`${ BINARIES }/${ build.directory }/${ build.path }`, {
            signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS)
        });
        if (!response.ok)
        {
            throw new Error(`The compiler ${ build.longVersion } could not be fetched (${ response.status }).`);
        }

        const bytes = Buffer.from(await response.arrayBuffer());
        const digest = `0x${ createHash('sha256').update(bytes).digest('hex') }`;
        // An empty published digest means the list did not carry one; the file is still used, and
        // the honest reason is that there is nothing to compare it against - not that it passed.
        if (build.sha256 !== '' && digest !== build.sha256.toLowerCase())
        {
            throw new Error(`The compiler ${ build.longVersion } did not match its published checksum and was discarded.`);
        }

        if (!existsSync(this.#directory))
        {
            mkdirSync(this.#directory, { recursive: true });
        }
        const staging = `${ target }.${ process.pid }.part`;
        writeFileSync(staging, bytes);
        renameSync(staging, target);
        return target;
    }
}
