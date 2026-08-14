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
 * Signature -> the mutability its standard declares.
 *
 * Mutability cannot be recovered from bytecode: `view` is a promise made in the ABI, not a flag in
 * the EVM. It is carried here because the standard that named the function also declared it, and
 * a reader deciding whether a call can change anything needs to know.
 */
const FUNCTIONS: ReadonlyArray<readonly [string, Mutability]> = [
    // --- ERC-20 -----------------------------------------------------------------------------
    ['name()', 'view'],
    ['symbol()', 'view'],
    ['decimals()', 'view'],
    ['totalSupply()', 'view'],
    ['balanceOf(address)', 'view'],
    ['transfer(address,uint256)', 'nonpayable'],
    ['transferFrom(address,address,uint256)', 'nonpayable'],
    ['approve(address,uint256)', 'nonpayable'],
    ['allowance(address,address)', 'view'],
    ['increaseAllowance(address,uint256)', 'nonpayable'],
    ['decreaseAllowance(address,uint256)', 'nonpayable'],
    ['mint(address,uint256)', 'nonpayable'],
    ['burn(uint256)', 'nonpayable'],
    ['burnFrom(address,uint256)', 'nonpayable'],
    ['cap()', 'view'],
    // BNB-chain's BEP-20 addition; it appears on a great many EVM tokens.
    ['getOwner()', 'view'],

    // --- EIP-2612 (permit) ------------------------------------------------------------------
    ['permit(address,address,uint256,uint256,uint8,bytes32,bytes32)', 'nonpayable'],
    ['nonces(address)', 'view'],
    ['DOMAIN_SEPARATOR()', 'view'],
    ['eip712Domain()', 'view'],

    // --- ERC-165 ----------------------------------------------------------------------------
    ['supportsInterface(bytes4)', 'view'],

    // --- ERC-721 ----------------------------------------------------------------------------
    ['ownerOf(uint256)', 'view'],
    ['safeTransferFrom(address,address,uint256)', 'nonpayable'],
    ['safeTransferFrom(address,address,uint256,bytes)', 'nonpayable'],
    ['setApprovalForAll(address,bool)', 'nonpayable'],
    ['getApproved(uint256)', 'view'],
    ['isApprovedForAll(address,address)', 'view'],
    ['tokenURI(uint256)', 'view'],
    ['tokenOfOwnerByIndex(address,uint256)', 'view'],
    ['tokenByIndex(uint256)', 'view'],
    ['safeMint(address,uint256)', 'nonpayable'],
    ['safeMint(address,string)', 'nonpayable'],

    // --- ERC-1155 ---------------------------------------------------------------------------
    ['balanceOf(address,uint256)', 'view'],
    ['balanceOfBatch(address[],uint256[])', 'view'],
    ['safeTransferFrom(address,address,uint256,uint256,bytes)', 'nonpayable'],
    ['safeBatchTransferFrom(address,address,uint256[],uint256[],bytes)', 'nonpayable'],
    ['uri(uint256)', 'view'],

    // --- Ownable ----------------------------------------------------------------------------
    ['owner()', 'view'],
    ['transferOwnership(address)', 'nonpayable'],
    ['renounceOwnership()', 'nonpayable'],
    ['pendingOwner()', 'view'],
    ['acceptOwnership()', 'nonpayable'],

    // --- AccessControl ----------------------------------------------------------------------
    ['hasRole(bytes32,address)', 'view'],
    ['getRoleAdmin(bytes32)', 'view'],
    ['grantRole(bytes32,address)', 'nonpayable'],
    ['revokeRole(bytes32,address)', 'nonpayable'],
    ['renounceRole(bytes32,address)', 'nonpayable'],
    ['DEFAULT_ADMIN_ROLE()', 'view'],
    ['getRoleMember(bytes32,uint256)', 'view'],
    ['getRoleMemberCount(bytes32)', 'view'],
    // The role constants OpenZeppelin's own templates declare. They are getters like any other,
    // and a token that has one is a token somebody can mint, burn or pause.
    ['MINTER_ROLE()', 'view'],
    ['PAUSER_ROLE()', 'view'],
    ['BURNER_ROLE()', 'view'],
    ['UPGRADER_ROLE()', 'view'],
    ['SNAPSHOT_ROLE()', 'view'],
    ['OPERATOR_ROLE()', 'view'],
    ['ADMIN_ROLE()', 'view'],

    // --- ERC-5805 / ERC-6372 (votes and the clock they count on) ----------------------------
    ['delegate(address)', 'nonpayable'],
    ['delegates(address)', 'view'],
    ['getVotes(address)', 'view'],
    ['getPastVotes(address,uint256)', 'view'],
    ['getPastTotalSupply(uint256)', 'view'],
    ['clock()', 'view'],
    ['CLOCK_MODE()', 'view'],

    // --- Pausable ---------------------------------------------------------------------------
    ['paused()', 'view'],
    ['pause()', 'nonpayable'],
    ['unpause()', 'nonpayable'],

    // --- Proxies and upgrades ---------------------------------------------------------------
    ['implementation()', 'view'],
    ['upgradeTo(address)', 'nonpayable'],
    ['upgradeToAndCall(address,bytes)', 'payable'],
    ['admin()', 'view'],
    ['changeAdmin(address)', 'nonpayable'],
    ['proxiableUUID()', 'view'],
    ['initialize()', 'nonpayable'],
    ['initialize(address)', 'nonpayable'],
    ['initialize(string,string)', 'nonpayable'],
    ['UPGRADE_INTERFACE_VERSION()', 'view'],

    // --- ERC-4626 (tokenised vault) ---------------------------------------------------------
    ['asset()', 'view'],
    ['totalAssets()', 'view'],
    ['deposit(uint256,address)', 'nonpayable'],
    ['mint(uint256,address)', 'nonpayable'],
    ['withdraw(uint256,address,address)', 'nonpayable'],
    ['redeem(uint256,address,address)', 'nonpayable'],
    ['convertToShares(uint256)', 'view'],
    ['convertToAssets(uint256)', 'view'],
    ['previewDeposit(uint256)', 'view'],
    ['previewRedeem(uint256)', 'view'],
    ['maxDeposit(address)', 'view'],
    ['maxRedeem(address)', 'view'],

    // --- Wrapped native -----------------------------------------------------------------------
    ['deposit()', 'payable'],
    ['withdraw(uint256)', 'nonpayable'],

    // --- Odds and ends every toolchain emits --------------------------------------------------
    ['multicall(bytes[])', 'nonpayable'],
    ['version()', 'view'],
    ['VERSION()', 'view']
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

/** `transfer(address,uint256)` -> `['transfer', ['address', 'uint256']]`. */
function split(signature: string): { name: string; inputs: string[] }
{
    const open = signature.indexOf('(');
    const body = signature.slice(open + 1, signature.lastIndexOf(')'));
    return {
        name: signature.slice(0, open),
        // A signature with no arguments has an EMPTY body, and ''.split(',') is [''] - one
        // argument of no type, which would print as `name()` taking a nameless parameter.
        inputs: body === '' ? [] : body.split(',')
    };
}

/**
 * Selector -> function, hashed at import.
 *
 * The selectors are computed rather than written down: a hand-copied 4-byte hash is a typo that
 * mislabels a function forever, and `toFunctionSelector` is the same keccak the compiler used.
 */
export const FUNCTION_BY_SELECTOR: ReadonlyMap<string, KnownFunction> = new Map(
    FUNCTIONS.map(([signature, mutability]) =>
    {
        const { name, inputs } = split(signature);
        const selector = toFunctionSelector(signature);
        return [selector, { selector, signature, name, inputs, mutability }] as const;
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
 * A zero-argument getter worth calling, and the type its answer decodes as.
 *
 * Zero-argument ONLY, and only where the standard fixes the return type: a call with arguments
 * would need values this explorer does not have, and a return type it guessed at would print a
 * number that is not the number the contract holds.
 */
export interface ReadableCall
{
    selector: string;
    signature: string;
    name: string;
    type: 'string' | 'uint8' | 'uint256' | 'address' | 'bool' | 'bytes32';
}

const READABLE: ReadonlyArray<readonly [string, ReadableCall['type']]> = [
    ['name()', 'string'],
    ['symbol()', 'string'],
    ['decimals()', 'uint8'],
    ['totalSupply()', 'uint256'],
    ['owner()', 'address'],
    ['getOwner()', 'address'],
    ['pendingOwner()', 'address'],
    ['paused()', 'bool'],
    ['cap()', 'uint256'],
    ['asset()', 'address'],
    ['totalAssets()', 'uint256'],
    ['implementation()', 'address'],
    ['admin()', 'address'],
    ['version()', 'string'],
    ['VERSION()', 'string'],
    ['UPGRADE_INTERFACE_VERSION()', 'string'],
    ['DOMAIN_SEPARATOR()', 'bytes32'],
    ['DEFAULT_ADMIN_ROLE()', 'bytes32']
];

export const READABLE_CALLS: readonly ReadableCall[] = READABLE.map(([signature, type]) => ({
    selector: toFunctionSelector(signature),
    signature,
    name: split(signature).name,
    type
}));
