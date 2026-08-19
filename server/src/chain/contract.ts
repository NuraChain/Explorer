import { EVENT_BY_TOPIC, FUNCTION_BY_SELECTOR, selectorOf, type KnownEvent, type KnownFunction } from './signatures.ts';

// What can be read off a contract's bytecode, with nothing but `eth_getCode`.
//
// A deployed contract is one blob of runtime bytecode. There is no ABI in it, no names, no source
// - solc keeps those in a metadata file the chain never sees. What IS in it, always, is the
// dispatcher: the prologue that compares the first four bytes of the calldata against every
// selector the contract answers to. Reading those comparisons back out gives the contract's
// entry points, which is the difference between "some contract" and "an ERC-20 with a mint and an
// owner".
//
// Everything here is pure and offline: bytes in, facts out. Nothing guesses. A selector with no
// entry in the signature table is reported as four bytes rather than labelled with a plausible
// name, because a WRONG name on a function someone is about to call is worse than no name.

/** PUSH1..PUSH32 - the only opcodes that carry immediate data, and so the only ones to skip. */
const PUSH1 = 0x60;
const PUSH4 = 0x63;
const PUSH32 = 0x7f;

/**
 * The opcodes a dispatcher puts immediately after the selector it pushed.
 *
 * Without this filter every four-byte constant in the contract - a timestamp, a mask, a chain id -
 * reads as a function. `EQ` is the linear dispatcher solc emits at low optimiser settings, `GT`
 * and `LT` are the pivots of the binary search it emits above ~5 functions, and `SUB` and `XOR`
 * are how Vyper and hand-written assembly compare the same four bytes.
 */
const COMPARISONS = new Set([0x10, 0x11, 0x03, 0x14, 0x18]);

/** Facts read off the runtime bytecode. Every field is derived from the bytes alone. */
export interface BytecodeFacts
{
    /** Length of the deployed code in BYTES, metadata included - what the chain charges for. */
    size: number;

    /** Selectors the dispatcher compares against, in the order the dispatcher lists them. */
    selectors: string[];

    /** 32-byte constants that match a known event topic. */
    topics: string[];

    /** `0.8.30` when solc stamped its version into the metadata trailer, else ''. */
    compiler: string;

    /** `ipfs://Qm...` or `bzz://...` - where the compiler said the source metadata lives. Else ''. */
    metadataUri: string;

    /** The implementation an EIP-1167 minimal proxy forwards to, read from its own bytes. */
    minimalProxy: string | null;
}

function bytesOf(code: string): Uint8Array
{
    const body = code.startsWith('0x') ? code.slice(2) : code;
    const size = Math.floor(body.length / 2);
    const bytes = new Uint8Array(size);
    for (let at = 0; at < size; at++)
    {
        bytes[at] = Number.parseInt(body.slice(at * 2, at * 2 + 2), 16);
    }
    return bytes;
}

function hexOf(bytes: Uint8Array, from: number, to: number): string
{
    let out = '0x';
    for (let at = from; at < to; at++)
    {
        out += (bytes[at] ?? 0).toString(16).padStart(2, '0');
    }
    return out;
}

/**
 * Walks the code as OPCODES rather than scanning it as bytes.
 *
 * A push carries its operand inline, so a byte-wise search finds selectors inside the operands of
 * other pushes - a 32-byte constant contains 29 different "PUSH4"s that were never instructions.
 * Stepping over each push's data is what makes the difference between a function list and noise.
 */
function scan(bytes: Uint8Array, limit: number): { selectors: string[]; topics: string[] }
{
    const selectors: string[] = [];
    const topics: string[] = [];
    const seenSelector = new Set<string>();
    const seenTopic = new Set<string>();

    let at = 0;
    while (at < limit)
    {
        const op = bytes[at]!;
        if (op < PUSH1 || op > PUSH32)
        {
            at++;
            continue;
        }

        const width = op - PUSH1 + 1;
        const start = at + 1;
        const end = start + width;
        if (end > limit)
        {
            // A push whose operand runs past the end is not an instruction: the walk has fallen
            // into data. Stop rather than read the tail as code.
            break;
        }

        if (op === PUSH4 && COMPARISONS.has(bytes[end] ?? 0))
        {
            const selector = hexOf(bytes, start, end);
            if (!seenSelector.has(selector))
            {
                seenSelector.add(selector);
                selectors.push(selector);
            }
        }
        else if (op === PUSH32)
        {
            const topic = hexOf(bytes, start, end);
            // Only topics the table can NAME are kept. Every other 32-byte constant in a contract
            // is a storage slot, a mask or a role hash, and listing those as events would bury the
            // handful that are one.
            if (EVENT_BY_TOPIC.has(topic) && !seenTopic.has(topic))
            {
                seenTopic.add(topic);
                topics.push(topic);
            }
        }

        at = end;
    }

    return { selectors, topics };
}

/**
 * Where the executable code ends and solc's metadata trailer begins.
 *
 * The last two bytes of a solc-compiled contract are the LENGTH of a CBOR blob that precedes
 * them. That blob is data, and walking it as opcodes produces pushes that were never
 * instructions, so the scan stops here.
 */
function metadataStart(bytes: Uint8Array): number
{
    if (bytes.length < 4)
    {
        return bytes.length;
    }
    const declared = ((bytes[bytes.length - 2] ?? 0) << 8) | (bytes[bytes.length - 1] ?? 0);
    const start = bytes.length - 2 - declared;
    // A CBOR map header (major type 5, a small count) is the only thing that legitimately starts
    // the trailer. Anything else means those last two bytes were code that happened to look like
    // a length.
    if (declared === 0 || start < 0 || (bytes[start]! & 0xe0) !== 0xa0)
    {
        return bytes.length;
    }
    return start;
}

type CborValue = string | number | boolean | Uint8Array | Map<string, CborValue> | null;

/**
 * The sliver of CBOR that solc's trailer uses: a small map of text keys to byte strings, text,
 * unsigned integers and booleans. Not a general decoder - anything else returns null, and the
 * caller reports no metadata rather than a half-read one.
 */
function readCbor(bytes: Uint8Array, at: number): { value: CborValue; next: number } | null
{
    if (at >= bytes.length)
    {
        return null;
    }
    const initial = bytes[at]!;
    const major = initial >> 5;
    const minor = initial & 0x1f;

    let length = minor;
    let next = at + 1;
    if (minor === 24)
    {
        length = bytes[next++] ?? 0;
    }
    else if (minor === 25)
    {
        length = ((bytes[next] ?? 0) << 8) | (bytes[next + 1] ?? 0);
        next += 2;
    }
    else if (minor > 25)
    {
        return null;
    }

    if (major === 0)
    {
        return { value: length, next };
    }
    if (major === 2 || major === 3)
    {
        const end = next + length;
        if (end > bytes.length)
        {
            return null;
        }
        const slice = bytes.slice(next, end);
        return {
            value: major === 2 ? slice : new TextDecoder().decode(slice),
            next: end
        };
    }
    if (major === 5)
    {
        const map = new Map<string, CborValue>();
        for (let entry = 0; entry < length; entry++)
        {
            const key = readCbor(bytes, next);
            if (key === null || typeof key.value !== 'string')
            {
                return null;
            }
            const value = readCbor(bytes, key.next);
            if (value === null)
            {
                return null;
            }
            map.set(key.value, value.value);
            next = value.next;
        }
        return { value: map, next };
    }
    if (major === 7)
    {
        // Only the two simple values solc emits: false (20) and true (21).
        return minor === 20 || minor === 21 ? { value: minor === 21, next } : null;
    }
    return null;
}

const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/** Multihash bytes -> the `Qm...` a reader can paste into any IPFS gateway. */
function base58(bytes: Uint8Array): string
{
    let value = 0n;
    for (const byte of bytes)
    {
        value = (value << 8n) | BigInt(byte);
    }
    let out = '';
    while (value > 0n)
    {
        out = BASE58[Number(value % 58n)] + out;
        value /= 58n;
    }
    // Base58 loses leading zero bytes to the arithmetic; each is written back as a '1'.
    for (const byte of bytes)
    {
        if (byte !== 0)
        {
            break;
        }
        out = `1${ out }`;
    }
    return out;
}

function toHex(bytes: Uint8Array): string
{
    let out = '';
    for (const byte of bytes)
    {
        out += byte.toString(16).padStart(2, '0');
    }
    return out;
}

/**
 * The compiler's own account of itself, from the CBOR trailer solc appends to every contract.
 *
 * This is NOT verification: it is what the compiler stamped, and a deployer can stamp anything.
 * It is still the single most useful line on this page, because it says which compiler to point
 * at the source when someone does want to verify it.
 */
function readMetadata(bytes: Uint8Array, start: number): { compiler: string; metadataUri: string }
{
    const empty = { compiler: '', metadataUri: '' };
    if (start >= bytes.length)
    {
        return empty;
    }
    const decoded = readCbor(bytes, start);
    if (decoded === null || !(decoded.value instanceof Map))
    {
        return empty;
    }

    const map = decoded.value;
    const solc = map.get('solc');
    const ipfs = map.get('ipfs');
    const bzzr1 = map.get('bzzr1') ?? map.get('bzzr0');

    return {
        // Three bytes, one per version part. A string here instead means a nightly build, which
        // solc writes verbatim.
        compiler: solc instanceof Uint8Array && solc.length === 3
            ? `${ solc[0] }.${ solc[1] }.${ solc[2] }`
            : typeof solc === 'string' ? solc : '',
        metadataUri: ipfs instanceof Uint8Array
            ? `ipfs://${ base58(ipfs) }`
            : bzzr1 instanceof Uint8Array ? `bzz://${ toHex(bzzr1) }` : ''
    };
}

/** The body of an EIP-1167 minimal proxy, around the 20 address bytes it delegates to. */
const MINIMAL_PROXY_HEAD = '363d3d373d3d3d363d73';
const MINIMAL_PROXY_TAIL = '5af43d82803e903d91602b57fd5bf3';

/**
 * The implementation an EIP-1167 clone points at, read from the clone's own 45 bytes.
 *
 * Worth a special case because a clone has NO dispatcher of its own: it forwards everything. Read
 * as bytecode it looks like a contract with no functions at all, which is exactly wrong - it has
 * every function its implementation has.
 */
export function minimalProxyTarget(code: string): string | null
{
    const body = (code.startsWith('0x') ? code.slice(2) : code).toLowerCase();
    const head = body.indexOf(MINIMAL_PROXY_HEAD);
    if (head === -1)
    {
        return null;
    }
    const start = head + MINIMAL_PROXY_HEAD.length;
    const target = body.slice(start, start + 40);
    if (target.length < 40 || !body.startsWith(MINIMAL_PROXY_TAIL, start + 40))
    {
        return null;
    }
    return `0x${ target }`;
}

/** Everything the bytes alone can say. */
export function analyze(code: string): BytecodeFacts
{
    const bytes = bytesOf(code);
    const start = metadataStart(bytes);
    const { selectors, topics } = scan(bytes, start);
    const { compiler, metadataUri } = readMetadata(bytes, start);

    return {
        size: bytes.length,
        selectors,
        topics,
        compiler,
        metadataUri,
        minimalProxy: minimalProxyTarget(code)
    };
}

/** A selector paired with its signature, or with nothing when the table does not know it. */
export interface DescribedFunction extends KnownFunction
{
    known: boolean;
}

/**
 * Selectors -> what to print for each. Named ones first, alphabetically, then the unknown ones by
 * selector: a reader scanning for `transfer` should not have to walk past forty hex strings, and
 * the unnamed ones are still listed because their COUNT is the honest measure of what this page
 * does not know.
 */
export function describeFunctions(selectors: readonly string[]): DescribedFunction[]
{
    const described = selectors.map((selector): DescribedFunction =>
    {
        const known = FUNCTION_BY_SELECTOR.get(selector);
        return known === undefined
            ? { selector, signature: '', name: '', inputs: [], outputs: [], mutability: 'unknown', known: false }
            : { ...known, known: true };
    });

    return described.sort((left, right) =>
    {
        if (left.known !== right.known)
        {
            return left.known ? -1 : 1;
        }
        return left.known
            ? left.signature.localeCompare(right.signature)
            : left.selector.localeCompare(right.selector);
    });
}

export function describeEvents(topics: readonly string[]): KnownEvent[]
{
    return topics
        .map((topic) => EVENT_BY_TOPIC.get(topic))
        .filter((event): event is KnownEvent => event !== undefined)
        .sort((left, right) => left.signature.localeCompare(right.signature));
}

/**
 * The interfaces a selector set satisfies.
 *
 * Detected by what the contract ANSWERS, not by what it claims: `supportsInterface` is a function
 * a contract can return anything from, while a dispatcher that compares against all six ERC-20
 * selectors is one that implements them. Names are identifiers ("ERC-20"), so they are not
 * translated - the standard is called the same thing in every language.
 */
const STANDARDS: ReadonlyArray<readonly [string, readonly string[]]> = [
    ['ERC-20', ['totalSupply()', 'balanceOf(address)', 'transfer(address,uint256)', 'transferFrom(address,address,uint256)', 'approve(address,uint256)', 'allowance(address,address)']],
    ['ERC-721', ['ownerOf(uint256)', 'safeTransferFrom(address,address,uint256)', 'getApproved(uint256)', 'setApprovalForAll(address,bool)', 'isApprovedForAll(address,address)']],
    ['ERC-1155', ['balanceOfBatch(address[],uint256[])', 'safeBatchTransferFrom(address,address,uint256[],uint256[],bytes)', 'safeTransferFrom(address,address,uint256,uint256,bytes)']],
    ['ERC-165', ['supportsInterface(bytes4)']],
    ['ERC-2612', ['permit(address,address,uint256,uint256,uint8,bytes32,bytes32)', 'nonces(address)', 'DOMAIN_SEPARATOR()']],
    ['ERC-4626', ['asset()', 'totalAssets()', 'convertToShares(uint256)', 'deposit(uint256,address)']],
    ['Ownable', ['owner()', 'transferOwnership(address)']],
    ['AccessControl', ['hasRole(bytes32,address)', 'getRoleAdmin(bytes32)', 'grantRole(bytes32,address)']],
    ['Pausable', ['paused()']],
    ['Upgradeable', ['proxiableUUID()']],
    // Not standards bodies, but the contracts a chain with a DEX on it is mostly made of. The
    // rule is the same one every entry above follows: claimed only when the dispatcher answers
    // every selector listed, so the badge says what the code does and not what it is called.
    ['Uniswap V2 pair', ['getReserves()', 'token0()', 'token1()', 'swap(uint256,uint256,address,bytes)', 'mint(address)', 'burn(address)']],
    ['Uniswap V2 factory', ['getPair(address,address)', 'createPair(address,address)', 'allPairsLength()']],
    ['Uniswap V2 router', ['swapExactTokensForTokens(uint256,uint256,address[],address,uint256)', 'addLiquidity(address,address,uint256,uint256,uint256,uint256,address,uint256)', 'getAmountsOut(uint256,address[])', 'WETH()']],
    ['Multicall3', ['aggregate3((address,bool,bytes)[])', 'tryAggregate(bool,(address,bytes)[])', 'getEthBalance(address)']]
];

const STANDARD_SELECTORS = STANDARDS.map(([label, signatures]) => ({
    label,
    selectors: signatures.map(selectorOf)
}));

export function detectStandards(selectors: readonly string[]): string[]
{
    const present = new Set(selectors);
    return STANDARD_SELECTORS
        .filter((standard) => standard.selectors.every((selector) => present.has(selector)))
        .map((standard) => standard.label);
}
