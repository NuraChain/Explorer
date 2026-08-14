import { toEventSelector, toFunctionSelector } from 'viem';

// The dictionary that gives a 4-byte selector back its name.
//
// A deployed contract keeps NO names. `eth_getCode` returns the dispatcher's selectors and
// nothing else, so `0xa9059cbb` is all the chain can say about `transfer(address,uint256)` - the
// mapping is one-way, and the only way back is a table of signatures somebody wrote down.
//
// That table is HERE rather than fetched from a signature registry, for the same reason the rest
// of this explorer indexes instead of proxying: an explorer that needs a third party online to
// name a function stops naming functions the day that party is down.
//
// Every entry is from a published standard or from the OpenZeppelin contracts most of these
// chains deploy, so a name shown here is the name its author gave it - never a guess. A selector
// this file does not know is shown as its raw four bytes, which is the honest answer.

export type Mutability = 'view' | 'pure' | 'nonpayable' | 'payable' | 'unknown';

/** One entry of the table: the signature, split into the parts a reader is shown. */
export interface KnownFunction
{
    selector: string;
    signature: string;
    name: string;
    inputs: string[];

    /**
     * What the function answers with. Not in the bytecode at ANY optimisation level - the EVM
     * returns bytes and the ABI decides what they mean - so a call can only be decoded for a
     * signature whose standard declared this. Empty means it returns nothing.
     */
    outputs: string[];
    mutability: Mutability;
}

export interface KnownEvent
{
    topic: string;
    signature: string;
    name: string;
    inputs: string[];
}

/**
 * Signature -> the mutability and return types its standard declares.
 *
 * Neither survives compilation: `view` is a promise made in the ABI rather than a flag in the
 * EVM, and a return type is what the ABI says the returned bytes MEAN. Both are carried here
 * because the standard that named the function also declared them - and without them a call
 * cannot be offered at all, because there would be no way to say what came back.
 *
 * The third column is comma-separated, exactly as a signature's arguments are; '' returns nothing.
 */
const FUNCTIONS: ReadonlyArray<readonly [string, Mutability, string]> = [
    // --- ERC-20 -----------------------------------------------------------------------------
    ['name()', 'view', 'string'],
    ['symbol()', 'view', 'string'],
    ['decimals()', 'view', 'uint8'],
    ['totalSupply()', 'view', 'uint256'],
    ['balanceOf(address)', 'view', 'uint256'],
    ['transfer(address,uint256)', 'nonpayable', 'bool'],
    ['transferFrom(address,address,uint256)', 'nonpayable', 'bool'],
    ['approve(address,uint256)', 'nonpayable', 'bool'],
    ['allowance(address,address)', 'view', 'uint256'],
    ['increaseAllowance(address,uint256)', 'nonpayable', 'bool'],
    ['decreaseAllowance(address,uint256)', 'nonpayable', 'bool'],
    ['mint(address,uint256)', 'nonpayable', ''],
    ['burn(uint256)', 'nonpayable', ''],
    ['burnFrom(address,uint256)', 'nonpayable', ''],
    ['cap()', 'view', 'uint256'],
    // BNB-chain's BEP-20 addition; it appears on a great many EVM tokens.
    ['getOwner()', 'view', 'address'],

    // --- EIP-2612 (permit) ------------------------------------------------------------------
    ['permit(address,address,uint256,uint256,uint8,bytes32,bytes32)', 'nonpayable', ''],
    ['nonces(address)', 'view', 'uint256'],
    ['DOMAIN_SEPARATOR()', 'view', 'bytes32'],
    ['eip712Domain()', 'view', 'bytes1,string,string,uint256,address,bytes32,uint256[]'],

    // --- ERC-165 ----------------------------------------------------------------------------
    ['supportsInterface(bytes4)', 'view', 'bool'],

    // --- ERC-721 ----------------------------------------------------------------------------
    ['ownerOf(uint256)', 'view', 'address'],
    ['safeTransferFrom(address,address,uint256)', 'nonpayable', ''],
    ['safeTransferFrom(address,address,uint256,bytes)', 'nonpayable', ''],
    ['setApprovalForAll(address,bool)', 'nonpayable', ''],
    ['getApproved(uint256)', 'view', 'address'],
    ['isApprovedForAll(address,address)', 'view', 'bool'],
    ['tokenURI(uint256)', 'view', 'string'],
    ['tokenOfOwnerByIndex(address,uint256)', 'view', 'uint256'],
    ['tokenByIndex(uint256)', 'view', 'uint256'],
    ['safeMint(address,uint256)', 'nonpayable', ''],
    ['safeMint(address,string)', 'nonpayable', ''],

    // --- ERC-1155 ---------------------------------------------------------------------------
    ['balanceOf(address,uint256)', 'view', 'uint256'],
    ['balanceOfBatch(address[],uint256[])', 'view', 'uint256[]'],
    ['safeTransferFrom(address,address,uint256,uint256,bytes)', 'nonpayable', ''],
    ['safeBatchTransferFrom(address,address,uint256[],uint256[],bytes)', 'nonpayable', ''],
    ['uri(uint256)', 'view', 'string'],

    // --- Ownable ----------------------------------------------------------------------------
    ['owner()', 'view', 'address'],
    ['transferOwnership(address)', 'nonpayable', ''],
    ['renounceOwnership()', 'nonpayable', ''],
    ['pendingOwner()', 'view', 'address'],
    ['acceptOwnership()', 'nonpayable', ''],

    // --- AccessControl ----------------------------------------------------------------------
    ['hasRole(bytes32,address)', 'view', 'bool'],
    ['getRoleAdmin(bytes32)', 'view', 'bytes32'],
    ['grantRole(bytes32,address)', 'nonpayable', ''],
    ['revokeRole(bytes32,address)', 'nonpayable', ''],
    ['renounceRole(bytes32,address)', 'nonpayable', ''],
    ['DEFAULT_ADMIN_ROLE()', 'view', 'bytes32'],
    ['getRoleMember(bytes32,uint256)', 'view', 'address'],
    ['getRoleMemberCount(bytes32)', 'view', 'uint256'],
    // The role constants OpenZeppelin's own templates declare. They are getters like any other,
    // and a token that has one is a token somebody can mint, burn or pause.
    ['MINTER_ROLE()', 'view', 'bytes32'],
    ['PAUSER_ROLE()', 'view', 'bytes32'],
    ['BURNER_ROLE()', 'view', 'bytes32'],
    ['UPGRADER_ROLE()', 'view', 'bytes32'],
    ['SNAPSHOT_ROLE()', 'view', 'bytes32'],
    ['OPERATOR_ROLE()', 'view', 'bytes32'],
    ['ADMIN_ROLE()', 'view', 'bytes32'],

    // --- ERC-5805 / ERC-6372 (votes and the clock they count on) ----------------------------
    ['delegate(address)', 'nonpayable', ''],
    ['delegates(address)', 'view', 'address'],
    ['getVotes(address)', 'view', 'uint256'],
    ['getPastVotes(address,uint256)', 'view', 'uint256'],
    ['getPastTotalSupply(uint256)', 'view', 'uint256'],
    ['clock()', 'view', 'uint48'],
    ['CLOCK_MODE()', 'view', 'string'],

    // --- Pausable ---------------------------------------------------------------------------
    ['paused()', 'view', 'bool'],
    ['pause()', 'nonpayable', ''],
    ['unpause()', 'nonpayable', ''],

    // --- Proxies and upgrades ---------------------------------------------------------------
    ['implementation()', 'view', 'address'],
    ['upgradeTo(address)', 'nonpayable', ''],
    ['upgradeToAndCall(address,bytes)', 'payable', ''],
    ['admin()', 'view', 'address'],
    ['changeAdmin(address)', 'nonpayable', ''],
    ['proxiableUUID()', 'view', 'bytes32'],
    ['initialize()', 'nonpayable', ''],
    ['initialize(address)', 'nonpayable', ''],
    ['initialize(string,string)', 'nonpayable', ''],
    ['UPGRADE_INTERFACE_VERSION()', 'view', 'string'],

    // --- ERC-4626 (tokenised vault) ---------------------------------------------------------
    ['asset()', 'view', 'address'],
    ['totalAssets()', 'view', 'uint256'],
    ['deposit(uint256,address)', 'nonpayable', 'uint256'],
    ['mint(uint256,address)', 'nonpayable', 'uint256'],
    ['withdraw(uint256,address,address)', 'nonpayable', 'uint256'],
    ['redeem(uint256,address,address)', 'nonpayable', 'uint256'],
    ['convertToShares(uint256)', 'view', 'uint256'],
    ['convertToAssets(uint256)', 'view', 'uint256'],
    ['previewDeposit(uint256)', 'view', 'uint256'],
    ['previewRedeem(uint256)', 'view', 'uint256'],
    ['maxDeposit(address)', 'view', 'uint256'],
    ['maxRedeem(address)', 'view', 'uint256'],

    // --- Wrapped native -----------------------------------------------------------------------
    ['deposit()', 'payable', ''],
    ['withdraw(uint256)', 'nonpayable', ''],

    // --- Odds and ends every toolchain emits --------------------------------------------------
    ['multicall(bytes[])', 'nonpayable', 'bytes[]'],
    ['version()', 'view', 'string'],
    ['VERSION()', 'view', 'string']
];

/** Event signatures, for the 32-byte topics a dispatcher pushes before it logs. */
const EVENTS: readonly string[] = [
    'Transfer(address,address,uint256)',
    'Approval(address,address,uint256)',
    'ApprovalForAll(address,address,bool)',
    'TransferSingle(address,address,address,uint256,uint256)',
    'TransferBatch(address,address,address,uint256[],uint256[])',
    'URI(string,uint256)',
    'OwnershipTransferred(address,address)',
    'OwnershipTransferStarted(address,address)',
    'Paused(address)',
    'Unpaused(address)',
    'RoleGranted(bytes32,address,address)',
    'RoleRevoked(bytes32,address,address)',
    'RoleAdminChanged(bytes32,bytes32,bytes32)',
    'Upgraded(address)',
    'AdminChanged(address,address)',
    'BeaconUpgraded(address)',
    'Initialized(uint8)',
    'Initialized(uint64)',
    'Deposit(address,uint256)',
    'Withdrawal(address,uint256)',
    'Deposit(address,address,uint256,uint256)',
    'Withdraw(address,address,address,uint256,uint256)',
    'EIP712DomainChanged()'
];

/** A comma-separated type list; '' is NO types, not one nameless one (''.split(',') is ['']). */
function types(list: string): string[]
{
    return list === '' ? [] : list.split(',');
}

/** `transfer(address,uint256)` -> `['transfer', ['address', 'uint256']]`. */
function split(signature: string): { name: string; inputs: string[] }
{
    const open = signature.indexOf('(');
    return {
        name: signature.slice(0, open),
        inputs: types(signature.slice(open + 1, signature.lastIndexOf(')')))
    };
}

/**
 * Selector -> function, hashed at import.
 *
 * The selectors are computed rather than written down: a hand-copied 4-byte hash is a typo that
 * mislabels a function forever, and `toFunctionSelector` is the same keccak the compiler used.
 */
export const FUNCTION_BY_SELECTOR: ReadonlyMap<string, KnownFunction> = new Map(
    FUNCTIONS.map(([signature, mutability, outputs]) =>
    {
        const { name, inputs } = split(signature);
        const selector = toFunctionSelector(signature);
        return [selector, { selector, signature, name, inputs, outputs: types(outputs), mutability }] as const;
    }));

export const EVENT_BY_TOPIC: ReadonlyMap<string, KnownEvent> = new Map(
    EVENTS.map((signature) =>
    {
        const { name, inputs } = split(signature);
        const topic = toEventSelector(signature);
        return [topic, { topic, signature, name, inputs }] as const;
    }));

/** The selector of a signature this table knows. Throws on a signature it does not - a typo. */
export function selectorOf(signature: string): string
{
    return toFunctionSelector(signature);
}

/**
 * The getters worth calling on sight, in the order a reader wants to see them.
 *
 * Zero-argument only: a call taking arguments needs values nobody has supplied yet, and those
 * are offered on the page instead of guessed at here. The order is the point of the list - it
 * is what an identity panel reads like, which alphabetical never is.
 */
const IDENTITY: readonly string[] = [
    'name()',
    'symbol()',
    'decimals()',
    'totalSupply()',
    'cap()',
    'owner()',
    'getOwner()',
    'pendingOwner()',
    'admin()',
    'paused()',
    'asset()',
    'totalAssets()',
    'implementation()',
    'version()',
    'VERSION()',
    'UPGRADE_INTERFACE_VERSION()',
    'DOMAIN_SEPARATOR()',
    'DEFAULT_ADMIN_ROLE()'
];

/** One of {@link IDENTITY}, resolved against the table so the return type is stated once. */
export interface ReadableCall
{
    selector: string;
    signature: string;
    name: string;
    type: string;
}

export const READABLE_CALLS: readonly ReadableCall[] = IDENTITY
    .map((signature) => FUNCTION_BY_SELECTOR.get(toFunctionSelector(signature)))
    // A single return value, because this panel prints one figure per row. Anything the table
    // does not describe is simply not on the list - it cannot be, the lookup is the source.
    .filter((entry): entry is KnownFunction => entry !== undefined && entry.outputs.length === 1)
    .map((entry) => ({
        selector: entry.selector,
        signature: entry.signature,
        name: entry.name,
        type: entry.outputs[0]!
    }));
