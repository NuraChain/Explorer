import { Worker } from 'node:worker_threads';

import { BadRequestError } from '@azerothjs/http';

import { normalize } from '../chain/store.ts';
import type { ChainGateway } from '../chain/client.ts';
import { compareDeployed, unlinkedLibraries, type ImmutableReferences } from './match.ts';
import type { CompilerBuild, CompilerSupply } from './compilers.ts';
import type { SourceStore } from './store.ts';

// Turning submitted source into a verified contract.
//
// The shape of the thing: build a solc standard-json input, run the exact compiler build the
// submission named, and see whether any contract in the result reproduces the bytes at the
// address. Everything else here is guard rails around those three steps - because this is the one
// endpoint on the server that a stranger can make do real work, and work that costs a CPU core
// for as long as a compile takes.
//
// What this deliberately does NOT need: constructor arguments. Etherscan asks for them because it
// compares CREATION bytecode, which carries them on the end. This compares the RUNTIME code the
// chain actually holds, which does not - so the most common reason a verification fails there
// does not exist here.

/** The largest submission accepted, in bytes of JSON. A contract is text; text does not need more. */
const MAX_INPUT_BYTES = 1_500_000;

/** How long one compile may run before its thread is killed. */
const COMPILE_TIMEOUT_MS = 120_000;

/** How many submissions may be waiting while one compiles. Past this, the answer is "not now". */
const MAX_QUEUED = 4;

/** What the browser sends. Text throughout - a compiler version is not a number. */
export interface VerifyRequest
{
    /** `single` wraps one file into a standard input; `json` is a standard input already. */
    kind: 'single' | 'json';

    /** A long version (`0.8.24+commit.e11b9ed9`) or a bare release (`0.8.24`). */
    compiler: string;

    /** Which contract in the sources to expect. '' tries every one of them. */
    name: string;

    /** The file name to compile `source` under, in `single` mode. */
    fileName: string;

    /** Solidity source, or a solc standard-json document. */
    source: string;

    optimizer: boolean;
    runs: number;

    /** '' leaves the compiler on its own default for that version. */
    evmVersion: string;
    license: string;
}

/** What came back. `ok` is the only field a caller has to read; the rest say why. */
export interface VerifyOutcome
{
    ok: boolean;
    match: 'full' | 'partial' | 'none';

    /** The contract that matched, when one did. */
    name: string;

    /** One line about the outcome, meant to be shown as it is. */
    message: string;

    /** Compiler diagnostics of severity `error`, verbatim. Empty when the source compiled. */
    errors: string[];
}

/** Runs a standard-json input through one compiler build and returns solc's raw output. */
export type CompileFn = (build: CompilerBuild, input: string) => Promise<string>;

interface CompiledContract
{
    abi?: unknown;
    evm?: {
        deployedBytecode?: {
            object?: string;
            immutableReferences?: ImmutableReferences;
            linkReferences?: Record<string, Record<string, unknown>>;
        };
    };
}

interface SolcOutput
{
    errors?: Array<{ severity?: string; formattedMessage?: string; message?: string }>;
    contracts?: Record<string, Record<string, CompiledContract>>;
}

/**
 * solc on a worker thread, with a timer on it.
 *
 * The compiler is a ten-megabyte Emscripten module and a compile holds a core for seconds. On the
 * main thread that stops every other request in the process; on a worker it costs one core and
 * the rest of the explorer keeps answering. The timeout is not optional either - `viaIR` on a
 * large contract can run for minutes, and a request nobody is waiting for any more must not keep
 * a core for the rest of the afternoon.
 */
export function solcCompiler(supply: CompilerSupply): CompileFn
{
    return async (build, input) =>
    {
        const file = await supply.ensure(build);
        return new Promise<string>((settle, fail) =>
        {
            const worker = new Worker(new URL('./compile.worker.ts', import.meta.url), {
                workerData: { file, input }
            });
            const timer = setTimeout(() =>
            {
                void worker.terminate();
                fail(new Error('The compiler ran longer than this explorer allows and was stopped.'));
            }, COMPILE_TIMEOUT_MS);

            const done = (): void =>
            {
                clearTimeout(timer);
                void worker.terminate();
            };

            worker.on('message', (message: { output: string; error: string }) =>
            {
                done();
                if (message.error !== '')
                {
                    fail(new Error(message.error));
                    return;
                }
                settle(message.output);
            });
            worker.on('error', (error) =>
            {
                done();
                fail(error);
            });
        });
    };
}

/** The `outputSelection` a verification needs, whatever else a submitted document asks for. */
const REQUIRED_OUTPUT = [
    'abi',
    'evm.deployedBytecode.object',
    'evm.deployedBytecode.immutableReferences',
    'evm.deployedBytecode.linkReferences'
];

interface StandardInput
{
    language?: string;
    sources?: Record<string, { content?: string }>;
    settings?: {
        optimizer?: { enabled?: boolean; runs?: number };
        evmVersion?: string;
        outputSelection?: Record<string, Record<string, string[]>>;
        [key: string]: unknown;
    };
}

/**
 * The submission as a solc standard-json document.
 *
 * A single file is wrapped into one; a submitted document is taken as it is, with only the output
 * selection widened - its optimizer settings, remappings, library addresses and `viaIR` flag are
 * exactly the knobs that decide whether the bytes come out the same, so overriding any of them
 * would be overriding the answer.
 */
function inputOf(request: VerifyRequest): { input: StandardInput; optimizer: boolean; runs: number; evmVersion: string }
{
    if (request.kind === 'json')
    {
        let parsed: StandardInput;
        try
        {
            parsed = JSON.parse(request.source) as StandardInput;
        }
        catch
        {
            throw new BadRequestError('That is not a solc standard-json document - it does not parse as JSON.');
        }
        if (parsed.sources === undefined || Object.keys(parsed.sources).length === 0)
        {
            throw new BadRequestError('The standard-json document has no `sources`.');
        }

        const settings = parsed.settings ?? {};
        return {
            input: {
                ...parsed,
                language: parsed.language ?? 'Solidity',
                settings: { ...settings, outputSelection: { '*': { '*': REQUIRED_OUTPUT } } }
            },
            optimizer: settings.optimizer?.enabled === true,
            runs: settings.optimizer?.runs ?? 200,
            evmVersion: settings.evmVersion ?? ''
        };
    }

    if (request.source.trim() === '')
    {
        throw new BadRequestError('There is no source to compile.');
    }

    const fileName = request.fileName.trim() === '' ? 'Contract.sol' : request.fileName.trim();
    return {
        input: {
            language: 'Solidity',
            sources: { [fileName]: { content: request.source } },
            settings: {
                optimizer: { enabled: request.optimizer, runs: request.runs },
                // Omitted entirely when unset: naming an evmVersion is not the same as leaving it
                // to the compiler, and a wrong one changes the opcodes that come out.
                ...(request.evmVersion === '' ? {} : { evmVersion: request.evmVersion }),
                outputSelection: { '*': { '*': REQUIRED_OUTPUT } }
            }
        },
        optimizer: request.optimizer,
        runs: request.runs,
        evmVersion: request.evmVersion
    };
}

/** The compiler's own complaints, the fatal ones only. Warnings are not a failed verification. */
function fatalErrors(output: SolcOutput): string[]
{
    return (output.errors ?? [])
        .filter((entry) => entry.severity === 'error')
        .map((entry) => entry.formattedMessage ?? entry.message ?? 'The compiler reported an error.');
}

export interface VerifierDeps
{
    chain: ChainGateway;
    sources: SourceStore;
    supply: CompilerSupply;
    compile: CompileFn;
}

/**
 * The submission endpoint's whole behaviour, with a queue of one in front of it.
 *
 * Serialised on purpose. Compilation is the only CPU-bound work this server does, and running
 * four of them at once on a two-core box makes all four slow AND takes the explorer down with
 * them. Waiting is the better answer, and being told to come back is a better answer still than
 * an unbounded queue nobody is watching.
 */
export class Verifier
{
    readonly #deps: VerifierDeps;

    #running: Promise<unknown> = Promise.resolve();

    #queued = 0;

    constructor(deps: VerifierDeps)
    {
        this.#deps = deps;
    }

    public async submit(address: string, request: VerifyRequest): Promise<VerifyOutcome>
    {
        if (this.#queued >= MAX_QUEUED)
        {
            throw new BadRequestError('This explorer is compiling other submissions right now. Try again in a minute.');
        }

        this.#queued++;
        const mine = this.#running.then(() => this.#verify(address, request), () => this.#verify(address, request));
        // The chain is what the NEXT submission waits on, and it must not be the rejected promise
        // this call is about to throw - that would make one failure the whole queue's failure.
        this.#running = mine.catch(() => undefined);
        try
        {
            return await mine;
        }
        finally
        {
            this.#queued--;
        }
    }

    async #verify(target: string, request: VerifyRequest): Promise<VerifyOutcome>
    {
        const address = normalize(target);
        const onchain = await this.#deps.chain.code(address).catch(() => '0x');
        if (onchain === '0x' || onchain === '')
        {
            throw new BadRequestError('There is no contract at this address, so there is nothing to verify against.');
        }

        const build = await this.#deps.supply.resolve(request.compiler);
        if (build === null)
        {
            throw new BadRequestError(`This explorer has no build of solc ${ request.compiler }, and none was offered by the binaries host.`);
        }

        const { input, optimizer, runs, evmVersion } = inputOf(request);
        const serialised = JSON.stringify(input);
        if (Buffer.byteLength(serialised) > MAX_INPUT_BYTES)
        {
            throw new BadRequestError(`That submission is larger than the ${ Math.round(MAX_INPUT_BYTES / 1000) } KB this explorer accepts.`);
        }

        const raw = await this.#deps.compile(build, serialised);
        let output: SolcOutput;
        try
        {
            output = JSON.parse(raw) as SolcOutput;
        }
        catch
        {
            throw new BadRequestError('The compiler produced something this explorer could not read.');
        }

        const errors = fatalErrors(output);
        if (errors.length > 0)
        {
            return { ok: false, match: 'none', name: '', message: 'The source did not compile.', errors };
        }

        const found = this.#pick(output, onchain, request.name.trim());
        if ('reason' in found)
        {
            return { ok: false, match: 'none', name: '', message: found.reason, errors: [] };
        }

        this.#deps.sources.save({
            address,
            name: found.name,
            compiler: build.longVersion,
            optimizer: optimizer ? 1 : 0,
            runs,
            evm_version: evmVersion,
            license: request.license.trim(),
            match_kind: found.match,
            abi: JSON.stringify(found.abi ?? []),
            input: serialised
        });

        return {
            ok: true,
            match: found.match,
            name: found.name,
            message: found.match === 'full'
                ? 'The compiler reproduced the deployed bytecode exactly.'
                : 'The compiler reproduced the deployed code; only the metadata trailer differs.',
            errors: []
        };
    }

    /**
     * The contract in the output whose bytecode is the one on the chain.
     *
     * Every contract is tried, not just the one that was named: a submission compiles its imports
     * too, and a person who mistypes the name of their own contract has still published the right
     * source. A named one is checked first so that two identical contracts in one file resolve
     * the way the submitter meant.
     */
    #pick(
        output: SolcOutput,
        onchain: string,
        wanted: string
    ): { name: string; match: 'full' | 'partial'; abi: unknown } | { reason: string }
    {
        const candidates: Array<{ name: string; contract: CompiledContract }> = [];
        for (const contracts of Object.values(output.contracts ?? {}))
        {
            for (const [name, contract] of Object.entries(contracts))
            {
                candidates.push({ name, contract });
            }
        }
        if (candidates.length === 0)
        {
            return { reason: 'The source compiled but declares no contract.' };
        }

        const ordered = wanted === ''
            ? candidates
            : [...candidates.filter((entry) => entry.name === wanted), ...candidates.filter((entry) => entry.name !== wanted)];

        const unlinked = new Set<string>();
        for (const { name, contract } of ordered)
        {
            const deployed = contract.evm?.deployedBytecode;
            const object = deployed?.object ?? '';
            if (object === '' || object === '0x')
            {
                // An interface, an abstract contract, or a library that was inlined. Nothing was
                // deployed from it, so there is nothing here to be the code at this address.
                continue;
            }

            const libraries = unlinkedLibraries(object);
            if (libraries.length > 0)
            {
                libraries.forEach((entry) => unlinked.add(entry));
                continue;
            }

            const match = compareDeployed(onchain, object, deployed?.immutableReferences ?? {});
            if (match !== null)
            {
                return { name, match, abi: contract.abi };
            }
        }

        if (unlinked.size > 0)
        {
            return {
                reason: 'The compiled code still has library placeholders in it. Submit a standard-json document with `settings.libraries` giving each library its deployed address.'
            };
        }

        return {
            reason: `None of the ${ ordered.length } compiled contracts produced the bytecode at this address. Check the compiler version, the optimizer setting and the number of runs against what the contract was deployed with.`
        };
    }
}
