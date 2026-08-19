import { toEventSelector, toFunctionSelector } from 'viem';

import { splitTypes } from './values.ts';

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

/**
 * What a function promises about state - plus `library`, which is not a mutability at all.
 *
 * A Solidity LIBRARY's public functions live at their own address and are reached by
 * DELEGATECALL from the contract that linked them. They are named here like anything else, but
 * they can never be called at this address: a library holds no storage of its own, and calling
 * one directly runs its code against nothing. `library` is what keeps them out of the two
 * sections that offer a call.
 */
export type Mutability = 'view' | 'pure' | 'nonpayable' | 'payable' | 'library' | 'unknown';

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

    // --- Uniswap V2 pair ----------------------------------------------------------------------
    // The single largest source of unnamed selectors on a chain with a DEX on it: a pair answers
    // sixteen calls and a standards table that stops at ERC-20 names none of them. `mint` and
    // `burn` take one address here and mean something else than the ERC-20 pair of the same name
    // - which is exactly why they are worth writing down rather than guessing at.
    ['getReserves()', 'view', 'uint112,uint112,uint32'],
    ['token0()', 'view', 'address'],
    ['token1()', 'view', 'address'],
    ['factory()', 'view', 'address'],
    ['mint(address)', 'nonpayable', 'uint256'],
    ['burn(address)', 'nonpayable', 'uint256,uint256'],
    ['swap(uint256,uint256,address,bytes)', 'nonpayable', ''],
    ['skim(address)', 'nonpayable', ''],
    ['sync()', 'nonpayable', ''],
    ['price0CumulativeLast()', 'view', 'uint256'],
    ['price1CumulativeLast()', 'view', 'uint256'],
    ['kLast()', 'view', 'uint256'],
    ['MINIMUM_LIQUIDITY()', 'pure', 'uint256'],
    ['PERMIT_TYPEHASH()', 'pure', 'bytes32'],
    ['initialize(address,address)', 'nonpayable', ''],

    // --- Uniswap V2 factory -------------------------------------------------------------------
    ['feeTo()', 'view', 'address'],
    ['feeToSetter()', 'view', 'address'],
    ['getPair(address,address)', 'view', 'address'],
    ['allPairs(uint256)', 'view', 'address'],
    ['allPairsLength()', 'view', 'uint256'],
    ['createPair(address,address)', 'nonpayable', 'address'],
    ['setFeeTo(address)', 'nonpayable', ''],
    ['setFeeToSetter(address)', 'nonpayable', ''],
    // The fee-on-swap addition this fork adds on top of the standard factory: `swapFee` reads the
    // rate a pair pays, `MAX_SWAP_FEE` caps it, and `setSwapFee` writes a new one.
    ['swapFee()', 'view', 'uint32'],
    ['MAX_SWAP_FEE()', 'view', 'uint32'],
    ['setSwapFee(uint32)', 'nonpayable', ''],

    // --- Uniswap V2 router --------------------------------------------------------------------
    // Which of these is payable is not a detail: `swapExactETHForTokens` takes the currency being
    // swapped as the transaction's own value, and a router entry marked nonpayable would offer no
    // field to put it in.
    ['WETH()', 'pure', 'address'],
    ['addLiquidity(address,address,uint256,uint256,uint256,uint256,address,uint256)', 'nonpayable', 'uint256,uint256,uint256'],
    ['addLiquidityETH(address,uint256,uint256,uint256,address,uint256)', 'payable', 'uint256,uint256,uint256'],
    ['removeLiquidity(address,address,uint256,uint256,uint256,address,uint256)', 'nonpayable', 'uint256,uint256'],
    ['removeLiquidityETH(address,uint256,uint256,uint256,address,uint256)', 'nonpayable', 'uint256,uint256'],
    ['removeLiquidityWithPermit(address,address,uint256,uint256,uint256,address,uint256,bool,uint8,bytes32,bytes32)', 'nonpayable', 'uint256,uint256'],
    ['removeLiquidityETHWithPermit(address,uint256,uint256,uint256,address,uint256,bool,uint8,bytes32,bytes32)', 'nonpayable', 'uint256,uint256'],
    ['removeLiquidityETHSupportingFeeOnTransferTokens(address,uint256,uint256,uint256,address,uint256)', 'nonpayable', 'uint256'],
    ['removeLiquidityETHWithPermitSupportingFeeOnTransferTokens(address,uint256,uint256,uint256,address,uint256,bool,uint8,bytes32,bytes32)', 'nonpayable', 'uint256'],
    ['swapExactTokensForTokens(uint256,uint256,address[],address,uint256)', 'nonpayable', 'uint256[]'],
    ['swapTokensForExactTokens(uint256,uint256,address[],address,uint256)', 'nonpayable', 'uint256[]'],
    ['swapExactETHForTokens(uint256,address[],address,uint256)', 'payable', 'uint256[]'],
    ['swapTokensForExactETH(uint256,uint256,address[],address,uint256)', 'nonpayable', 'uint256[]'],
    ['swapExactTokensForETH(uint256,uint256,address[],address,uint256)', 'nonpayable', 'uint256[]'],
    ['swapETHForExactTokens(uint256,address[],address,uint256)', 'payable', 'uint256[]'],
    ['swapExactTokensForTokensSupportingFeeOnTransferTokens(uint256,uint256,address[],address,uint256)', 'nonpayable', ''],
    ['swapExactETHForTokensSupportingFeeOnTransferTokens(uint256,address[],address,uint256)', 'payable', ''],
    ['swapExactTokensForETHSupportingFeeOnTransferTokens(uint256,uint256,address[],address,uint256)', 'nonpayable', ''],
    ['quote(uint256,uint256,uint256)', 'pure', 'uint256'],
    ['getAmountOut(uint256,uint256,uint256)', 'pure', 'uint256'],
    ['getAmountIn(uint256,uint256,uint256)', 'pure', 'uint256'],
    ['getAmountsOut(uint256,address[])', 'view', 'uint256[]'],
    ['getAmountsIn(uint256,address[])', 'view', 'uint256[]'],

    // --- Uniswap V3 factory ------------------------------------------------------------------
    // A pool is created, not deployed: `createPool` deploys it deterministically, and every pool
    // answers `factory()` with the address below. Fee tiers are the factory's table - `enableFeeAmount`
    // writes one and `feeAmountTickSpacing` reads it back.
    ['createPool(address,address,uint24)', 'nonpayable', 'address'],
    ['getPool(address,address,uint24)', 'view', 'address'],
    ['enableFeeAmount(uint24,int24)', 'nonpayable', ''],
    ['feeAmountTickSpacing(uint24)', 'view', 'int24'],
    ['parameters()', 'view', 'address,address,address,uint24,int24'],
    ['setOwner(address)', 'nonpayable', ''],

    // --- Uniswap V3 swap router --------------------------------------------------------------
    // The `exact` families take one struct parameter, spelled as a tuple. `exactInput` starts from
    // a known amount in, `exactOutput` reaches a known amount out, and each has a `Single` form
    // that skips the encoded path for one hop.
    ['WETH9()', 'view', 'address'],
    ['exactInput((bytes,address,uint256,uint256,uint256))', 'payable', 'uint256'],
    ['exactInputSingle((address,address,uint24,address,uint256,uint256,uint256,uint160))', 'payable', 'uint256'],
    ['exactOutput((bytes,address,uint256,uint256,uint256))', 'payable', 'uint256'],
    ['exactOutputSingle((address,address,uint24,address,uint256,uint256,uint256,uint160))', 'payable', 'uint256'],
    ['refundETH()', 'payable', ''],
    ['unwrapWETH9(uint256,address)', 'payable', ''],
    ['unwrapWETH9WithFee(uint256,address,uint256,address)', 'payable', ''],
    ['sweepToken(address,uint256,address)', 'payable', ''],
    ['sweepTokenWithFee(address,uint256,address,uint256,address)', 'payable', ''],
    ['selfPermit(address,uint256,uint256,uint8,bytes32,bytes32)', 'payable', ''],
    ['selfPermitAllowed(address,uint256,uint256,uint8,bytes32,bytes32)', 'payable', ''],
    ['selfPermitAllowedIfNecessary(address,uint256,uint256,uint8,bytes32,bytes32)', 'payable', ''],
    ['selfPermitIfNecessary(address,uint256,uint256,uint8,bytes32,bytes32)', 'payable', ''],
    ['uniswapV3SwapCallback(int256,int256,bytes)', 'nonpayable', ''],

    // --- Uniswap V3 non-fungible position manager --------------------------------------------
    // Liquidity is an NFT. `mint` opens a position and returns its id, `increaseLiquidity` and
    // `decreaseLiquidity` move it, `collect` takes the fees it earned. Each takes one struct, so
    // each is spelled as one tuple parameter.
    ['baseURI()', 'pure', 'string'],
    ['positions(uint256)', 'view', 'uint96,address,address,address,uint24,int24,int24,uint128,uint256,uint256,uint128,uint128'],
    ['mint((address,address,uint24,int24,int24,uint256,uint256,uint256,uint256,address,uint256))', 'payable', 'uint256,uint128,uint256,uint256'],
    ['increaseLiquidity((uint256,uint256,uint256,uint256,uint256,uint256))', 'payable', 'uint128,uint256,uint256'],
    ['decreaseLiquidity((uint256,uint128,uint256,uint256,uint256))', 'payable', 'uint256,uint256'],
    ['collect((uint256,address,uint128,uint128))', 'payable', 'uint256,uint256'],
    ['createAndInitializePoolIfNecessary(address,address,uint24,uint160)', 'payable', 'address'],
    ['permit(address,uint256,uint256,uint8,bytes32,bytes32)', 'payable', ''],
    ['uniswapV3MintCallback(uint256,uint256,bytes)', 'nonpayable', ''],

    // --- Uniswap V3 quoter, tick lens and descriptors -----------------------------------------
    // `quoteExact*` are nonpayable rather than view: the quoter routes a real (zero-amount) swap
    // through a pool to read its price, so the ABI cannot promise it changes nothing.
    ['quoteExactInput(bytes,uint256)', 'nonpayable', 'uint256,uint160[],uint32[],uint256'],
    ['quoteExactInputSingle((address,address,uint256,uint24,uint160))', 'nonpayable', 'uint256,uint160,uint32,uint256'],
    ['quoteExactOutput(bytes,uint256)', 'nonpayable', 'uint256,uint160[],uint32[],uint256'],
    ['quoteExactOutputSingle((address,address,uint256,uint24,uint160))', 'nonpayable', 'uint256,uint160,uint32,uint256'],
    ['getPopulatedTicksInWord(address,int16)', 'view', '(int24,int128,uint128)[]'],
    ['tokenURI(address,uint256)', 'view', 'string'],
    ['flipRatio(address,address,uint256)', 'view', 'bool'],
    ['tokenRatioPriority(address,uint256)', 'view', 'int256'],
    ['nativeCurrencyLabel()', 'view', 'string'],
    ['nativeCurrencyLabelBytes()', 'view', 'bytes32'],
    ['constructTokenURI((uint256,address,address,string,string,uint8,uint8,bool,int24,int24,int24,int24,uint24,address))', 'pure', 'string'],

    // --- Solidity libraries -------------------------------------------------------------------
    // A library's selector is NOT hashed the way every other entry in this file is.
    //
    // For an ordinary function the compiler expands a struct parameter into its tuple, which is
    // what the entry directly above does. For a LIBRARY it does not: a library may take arguments
    // the ABI has no spelling for - a storage pointer, a recursive struct - so the compiler keeps
    // the parameter's QUALIFIED NAME instead, and hashes `Lib.StructName` verbatim. The two forms
    // hash to different selectors, and only the qualified one appears in deployed bytecode.
    //
    // Uniswap V3's NFTDescriptor is the library almost every chain has a copy of - the position
    // manager links it to draw the SVG for a liquidity NFT - and it is the whole reason a reader
    // meets a 24KB contract with exactly ONE selector on it. Both forms are kept: the tuple above
    // for a fork that inlines the function into a contract, this one for the library itself.
    ['constructTokenURI(NFTDescriptor.ConstructTokenURIParams)', 'library', 'string'],

    // --- Multicall3 ---------------------------------------------------------------------------
    // Deployed at the same address on most chains and called by every wallet and dashboard, so an
    // explorer that cannot name it leaves its busiest contract reading as twenty unknown bytes.
    // The batching entries take arrays of structs, which no signature STRING can describe - they
    // are named here and refuse to encode, which is the honest half of what this table can do.
    ['aggregate((address,bytes)[])', 'payable', 'uint256,bytes[]'],
    ['aggregate3((address,bool,bytes)[])', 'payable', '(bool,bytes)[]'],
    ['aggregate3Value((address,bool,uint256,bytes)[])', 'payable', '(bool,bytes)[]'],
    ['blockAndAggregate((address,bytes)[])', 'payable', 'uint256,bytes32,(bool,bytes)[]'],
    ['tryAggregate(bool,(address,bytes)[])', 'payable', '(bool,bytes)[]'],
    ['tryBlockAndAggregate(bool,(address,bytes)[])', 'payable', 'uint256,bytes32,(bool,bytes)[]'],
    ['getBasefee()', 'view', 'uint256'],
    ['getBlockHash(uint256)', 'view', 'bytes32'],
    ['getBlockNumber()', 'view', 'uint256'],
    ['getChainId()', 'view', 'uint256'],
    ['getCurrentBlockCoinbase()', 'view', 'address'],
    ['getCurrentBlockDifficulty()', 'view', 'uint256'],
    ['getCurrentBlockGasLimit()', 'view', 'uint256'],
    ['getCurrentBlockTimestamp()', 'view', 'uint256'],
    ['getEthBalance(address)', 'view', 'uint256'],
    ['getLastBlockHash()', 'view', 'bytes32'],

    // --- Admin conveniences bolted onto ordinary tokens ---------------------------------------
    // Not from any standard: these are the two extras that turned up on real deployments here,
    // recovered by hashing candidate names until keccak agreed with the selector. That is the
    // only way a name gets into this file - a name that does not hash to its selector is not a
    // name, and a plausible-looking one would be worse than the four bytes it replaced.
    ['rescueERC20(address,address,uint256)', 'nonpayable', ''],
    ['mintBatch(address[],uint256[])', 'nonpayable', ''],

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
    'EIP712DomainChanged()',
    // Uniswap V2 pair and factory.
    'PairCreated(address,address,address,uint256)',
    'SwapFeeUpdated(uint32,uint32)',
    'Mint(address,uint256,uint256)',
    'Burn(address,uint256,uint256,address)',
    'Swap(address,uint256,uint256,uint256,uint256,address)',
    'Sync(uint112,uint112)',
    // Uniswap V3 factory and position manager.
    'FeeAmountEnabled(uint24,int24)',
    'OwnerChanged(address,address)',
    'PoolCreated(address,address,uint24,int24,address)',
    'IncreaseLiquidity(uint256,uint128,uint256,uint256)',
    'DecreaseLiquidity(uint256,uint128,uint256,uint256)',
    'Collect(uint256,address,uint256,uint256)'
];

/** A comma-separated type list; '' is NO types, not one nameless one (''.split(',') is ['']). */
function types(list: string): string[]
{
    return splitTypes(list);
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
    // A liquidity pair has no useful name or symbol - `UNI-V2` says nothing about which pair it
    // is. The two tokens ARE its identity, so they are read on sight like a token's symbol.
    'token0()',
    'token1()',
    'owner()',
    'getOwner()',
    'pendingOwner()',
    'admin()',
    'paused()',
    'asset()',
    'totalAssets()',
    'implementation()',
    'factory()',
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
