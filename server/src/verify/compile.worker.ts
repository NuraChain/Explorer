import { createRequire } from 'node:module';
import { parentPort, workerData } from 'node:worker_threads';

// solc, on its own thread.
//
// A compiler build is a ten-megabyte Emscripten module, and compiling a real contract with it
// occupies a core for anything from half a second to half a minute. On the main thread that is
// not slow, it is DOWN: the event loop stops, and every other reader waiting on a block page
// waits for someone else's verification to finish. So each compile gets a worker, the parent
// keeps a timeout on it, and a runaway is terminated rather than survived.
//
// Nothing is interpreted here. The worker takes a standard-json string, hands it to solc, and
// posts back whatever solc said - the parent decides what it means.

interface CompileRequest
{
    /** The soljson build to load, as an absolute path. */
    file: string;

    /** A solc standard-json input, already serialised. */
    input: string;
}

interface SolcModule
{
    version(): string;
    compile(input: string): string;
}

const { file, input } = workerData as CompileRequest;
const require = createRequire(import.meta.url);

try
{
    // `setupMethods` wraps a raw Emscripten module in the same API solc-js exposes for its own
    // bundled compiler, which is how ONE wrapper drives every version from 0.4 to today - the
    // low-level entry points changed names several times, and it knows all of them.
    const { setupMethods } = require('solc') as { setupMethods(soljson: unknown): SolcModule };
    const solc = setupMethods(require(file));

    parentPort?.postMessage({ output: solc.compile(input), version: solc.version(), error: '' });
}
catch (error)
{
    // A throw here is the compiler failing to LOAD or to run at all - not a source file with a
    // syntax error, which comes back inside a perfectly good output document.
    parentPort?.postMessage({ output: '', version: '', error: error instanceof Error ? error.message : String(error) });
}
