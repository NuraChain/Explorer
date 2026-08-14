import { BadRequestError } from '@azerothjs/http';

import type { ChainGateway } from './chain/client.ts';
import { analyze, describeEvents, describeFunctions, detectStandards } from './chain/contract.ts';
import { FUNCTION_BY_SELECTOR, READABLE_CALLS, selectorOf, type KnownFunction } from './chain/signatures.ts';
import { normalize, type IndexStore } from './chain/store.ts';
import { ArgumentError, decodeReturn, encodeCall } from './chain/values.ts';
import { iso } from './present.ts';
import type { ContractCallResult, ContractDetail, ContractRead, ProxyKind } from './schemas.ts';

// One contract, described from the node and the index together.
//
// The split is the same one the rest of this server makes: the CHAIN answers what the contract is
// (its code, and what its getters currently return), and the INDEX answers what happened to it
// (who deployed it, in which transaction). Neither can answer the other's half - a node cannot
// map a contract back to the transaction that created it, and an index cannot know a balance
// changed a second ago.

const EMPTY_WORD = `0x${ '0'.repeat(64) }`;
const ZERO_ADDRESS = `0x${ '0'.repeat(40) }`;

/**
 * The storage slots a proxy keeps its implementation pointer in.
 *
 * Fixed, ugly constants on purpose: each is a hash of a namespace string minus one, chosen by its
 * EIP so that no compiler-allocated variable can ever collide with it. They are the reason a
 * proxy can be followed at all - the pointer is in storage, where no amount of reading the
 * bytecode will find it.
 */
const IMPLEMENTATION_SLOT = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';
const BEACON_SLOT = '0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50';
const PROXIABLE_SLOT = '0xc5f16f0fcc639fa48a6947836d9850f504798523bf8c9a3a87d5876cf622bcf7';

/** How many getters may be called for one page. A contract cannot make this unbounded. */
const MAX_READS = 24;

/** The low 20 bytes of a storage word, or null when the slot is empty. */
function addressInWord(word: string): string | null
{
    const value = `0x${ word.slice(-40) }`.toLowerCase();
    return value === ZERO_ADDRESS || word === EMPTY_WORD ? null : value;
}

/** Follows whichever proxy pointer this address keeps, if it keeps one. */
async function findProxy(chain: ChainGateway, address: string, code: string): Promise<{ kind: ProxyKind; implementation: string } | null>
{
    const clone = analyze(code).minimalProxy;
    if (clone !== null)
    {
        return { kind: 'eip1167', implementation: clone };
    }

    const [direct, beacon, proxiable] = await Promise.all([
        chain.storageAt(address, IMPLEMENTATION_SLOT).catch(() => EMPTY_WORD),
        chain.storageAt(address, BEACON_SLOT).catch(() => EMPTY_WORD),
        chain.storageAt(address, PROXIABLE_SLOT).catch(() => EMPTY_WORD)
    ]);

    const implementation = addressInWord(direct);
    if (implementation !== null)
    {
        return { kind: 'eip1967', implementation };
    }

    const beaconAt = addressInWord(beacon);
    if (beaconAt !== null)
    {
        // A beacon holds the implementation for every proxy pointed at it, so the pointer here is
        // one hop short: ask the beacon what it currently serves. An unanswered call means the
        // slot held something that is not a beacon, and nothing is claimed.
        const answer = await chain.call(beaconAt, selectorOf('implementation()')).catch(() => '0x');
        const behind = answer.length >= 66 ? addressInWord(answer.slice(0, 66)) : null;
        return behind === null ? null : { kind: 'beacon', implementation: behind };
    }

    const legacy = addressInWord(proxiable);
    return legacy === null ? null : { kind: 'eip1822', implementation: legacy };
}

/** One getter's answer, decoded to text. Null when the contract refused or answered nonsense. */
function decodeRead(type: string, data: string): string | null
{
    try
    {
        return decodeReturn([type], data)[0]?.value ?? null;
    }
    catch
    {
        // A contract is free to answer a standard selector with a shape the standard does not
        // describe. That is its business; this page simply does not print it.
        return null;
    }
}

/**
 * Calls every zero-argument getter the dispatcher actually lists.
 *
 * Gated on the SELECTOR being present rather than tried blindly: a call to a function a contract
 * does not have reaches its fallback, and a fallback is free to return whatever it likes - which
 * is how an explorer ends up printing a total supply for a contract that has none.
 */
async function readValues(chain: ChainGateway, address: string, selectors: ReadonlySet<string>): Promise<ContractRead[]>
{
    const wanted = READABLE_CALLS.filter((entry) => selectors.has(entry.selector)).slice(0, MAX_READS);
    const answers = await Promise.all(wanted.map(async (entry): Promise<ContractRead | null> =>
    {
        const data = await chain.call(address, entry.selector).catch(() => '0x');
        const value = decodeRead(entry.type, data);
        return value === null ? null : { name: entry.name, signature: entry.signature, type: entry.type, value };
    }));
    return answers.filter((entry): entry is ContractRead => entry !== null);
}

/**
 * The function a call names, or a refusal.
 *
 * A selector this server cannot name is a selector it cannot encode arguments for either - there
 * is no ABI behind it - so the refusal is the honest answer rather than a best effort.
 */
function resolve(selector: string): KnownFunction
{
    const entry = FUNCTION_BY_SELECTOR.get(selector.toLowerCase());
    if (entry === undefined)
    {
        throw new BadRequestError(`No published signature is known for ${ selector }, so its arguments cannot be encoded.`);
    }
    return entry;
}

/** Turns a rejected argument into the 400 the field that produced it can be pointed at. */
function asBadRequest(error: unknown): never
{
    if (error instanceof ArgumentError)
    {
        throw new BadRequestError(`Argument ${ error.at + 1 }: ${ error.message }`);
    }
    throw error;
}

/**
 * The calldata for a call, encoded and handed back.
 *
 * NOTHING is sent here, and nothing touches the chain: this server has a node connection and no
 * business signing with it. The bytes go to the browser, the browser gives them to a wallet, and
 * the wallet's owner decides. That is also why this stays a pure function of its input - an
 * explorer that could send transactions would be a very different thing to run.
 */
export function calldataFor(selector: string, args: readonly string[]): string
{
    const entry = resolve(selector);
    try
    {
        return encodeCall(entry, args);
    }
    catch (error)
    {
        return asBadRequest(error);
    }
}

/**
 * One `eth_call` against a contract, decoded.
 *
 * Restricted to `view` and `pure` functions of the signature table, which is what keeps this from
 * being an open relay for the node behind it: the callable surface is a fixed list of published
 * read-only getters, not whatever the caller writes in the body. A state-changing function is
 * refused here on purpose - it belongs to a wallet, which pays for it and asks first.
 */
export async function readContract(
    { chain }: InspectDeps,
    target: string,
    selector: string,
    args: readonly string[]
): Promise<ContractCallResult>
{
    const entry = resolve(selector);
    if (entry.mutability !== 'view' && entry.mutability !== 'pure')
    {
        throw new BadRequestError(`${ entry.signature } changes state; send it from a wallet rather than reading it here.`);
    }

    let data: string;
    try
    {
        data = encodeCall(entry, args);
    }
    catch (error)
    {
        return asBadRequest(error);
    }

    try
    {
        const returned = await chain.call(normalize(target), data);
        return { values: decodeReturn(entry.outputs, returned), error: '' };
    }
    catch (error)
    {
        // A revert is an ANSWER, not a server fault: `ownerOf` on an unminted id is supposed to
        // fail, and the reason it gives is the useful part. It comes back as a 200 carrying the
        // reason, so the page can print it where the value would have gone.
        return { values: [], error: reasonOf(error) };
    }
}

/** The one line worth showing from a viem error, capped so a node cannot fill the page. */
function reasonOf(error: unknown): string
{
    const short = typeof error === 'object' && error !== null && 'shortMessage' in error
        ? String((error as { shortMessage: unknown }).shortMessage)
        : String(error instanceof Error ? error.message : error);
    const line = short.split('\n')[0] ?? '';
    return line.length > 200 ? `${ line.slice(0, 199) }…` : line;
}

export interface InspectDeps
{
    store: IndexStore;
    chain: ChainGateway;
}

export async function inspectContract({ store, chain }: InspectDeps, target: string): Promise<ContractDetail>
{
    const address = normalize(target);
    const code = await chain.code(address).catch(() => '0x');
    const facts = analyze(code);
    const creation = store.contractCreation(address);

    const deployment = creation === null
        ? null
        : {
            txHash: creation.hash,
            deployer: creation.from_addr,
            blockNumber: creation.block_number,
            at: iso(creation.timestamp)
        };

    if (code === '0x')
    {
        // An address with no code is not a failure to look one up - it is an ordinary account, and
        // saying so is the answer. `creation` is still reported: a contract that selfdestructed
        // was deployed, and the deployment is a fact about this address either way.
        return {
            address,
            isContract: false,
            bytecode: '0x',
            codeSize: 0,
            compiler: '',
            metadataUri: '',
            standards: [],
            functions: [],
            events: [],
            reads: [],
            proxy: null,
            fromImplementation: false,
            creation: deployment
        };
    }

    const proxy = await findProxy(chain, address, code);

    // Behind a proxy, the interesting bytecode is the implementation's: a proxy's own dispatcher
    // forwards everything and lists nothing, so reading the functions off it would report a
    // contract that does nothing at all.
    const behind = proxy === null ? '0x' : await chain.code(proxy.implementation).catch(() => '0x');
    const fromImplementation = behind !== '0x';
    const effective = fromImplementation ? analyze(behind) : facts;

    const selectors = new Set(effective.selectors);
    // Read the values from THIS address, not from the implementation: a proxy holds the storage,
    // and the implementation's own copy of it is empty.
    const reads = await readValues(chain, address, selectors);

    return {
        address,
        isContract: true,
        bytecode: code,
        codeSize: facts.size,
        compiler: facts.compiler === '' && fromImplementation ? effective.compiler : facts.compiler,
        metadataUri: facts.metadataUri === '' && fromImplementation ? effective.metadataUri : facts.metadataUri,
        standards: detectStandards(effective.selectors),
        functions: describeFunctions(effective.selectors),
        events: describeEvents(effective.topics),
        reads,
        proxy,
        fromImplementation,
        creation: deployment
    };
}
