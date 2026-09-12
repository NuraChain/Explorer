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

    // --- Uniswap V3 pool ----------------------------------------------------------------------
    // The contract a V3 deployment has thousands of, and the one a reader is most likely to land
    // on from a swap: the factory and the router are one address each, a POOL exists per pair per
    // fee tier. Its getters are also the only place the chain will tell you a price - `slot0`
    // carries the current sqrt price and tick - so leaving them as raw selectors made the most
    // interesting contract on a DEX the least readable one.
    ['slot0()', 'view', 'uint160,int24,uint16,uint16,uint16,uint8,bool'],
    ['liquidity()', 'view', 'uint128'],
    ['fee()', 'view', 'uint24'],
    ['tickSpacing()', 'view', 'int24'],
    ['maxLiquidityPerTick()', 'view', 'uint128'],
    ['feeGrowthGlobal0X128()', 'view', 'uint256'],
    ['feeGrowthGlobal1X128()', 'view', 'uint256'],
    ['protocolFees()', 'view', 'uint128,uint128'],
    ['ticks(int24)', 'view', 'uint128,int128,uint256,uint256,int56,uint160,uint32,bool'],
    ['tickBitmap(int16)', 'view', 'uint256'],
    ['positions(bytes32)', 'view', 'uint128,uint256,uint256,uint128,uint128'],
    ['observations(uint256)', 'view', 'uint32,int56,uint160,bool'],
    ['observe(uint32[])', 'view', 'int56[],uint160[]'],
    ['snapshotCumulativesInside(int24,int24)', 'view', 'int56,uint160,uint32'],
    ['initialize(uint160)', 'nonpayable', ''],
    // The four that move liquidity. Each is a CALLBACK protocol - the pool calls back into the
    // caller for payment - so they are named here and are not usable from a wallet directly; the
    // position manager is what a person actually sends.
    ['mint(address,int24,int24,uint128,bytes)', 'nonpayable', 'uint256,uint256'],
    ['burn(int24,int24,uint128)', 'nonpayable', 'uint256,uint256'],
    ['collect(address,int24,int24,uint128,uint128)', 'nonpayable', 'uint128,uint128'],
    ['swap(address,bool,int256,uint160,bytes)', 'nonpayable', 'int256,int256'],
    ['flash(address,uint256,uint256,bytes)', 'nonpayable', ''],
    ['increaseObservationCardinalityNext(uint16)', 'nonpayable', ''],
    ['setFeeProtocol(uint8,uint8)', 'nonpayable', ''],
    ['collectProtocol(address,uint128,uint128)', 'nonpayable', 'uint128,uint128'],

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

    // --- Governor (OpenZeppelin, and the Bravo shape it kept) ---------------------------------
    // The write half is here for the same reason the read half is: this table is what lets the
    // explorer ENCODE a call. Nothing is signed or sent from this process - the bytes go to the
    // browser and the wallet's owner decides - but a vote that cannot be encoded is a governance
    // page a reader can only watch.
    ['propose(address[],uint256[],bytes[],string)', 'nonpayable', 'uint256'],
    ['queue(address[],uint256[],bytes[],bytes32)', 'nonpayable', 'uint256'],
    ['execute(address[],uint256[],bytes[],bytes32)', 'payable', 'uint256'],
    ['cancel(address[],uint256[],bytes[],bytes32)', 'nonpayable', 'uint256'],
    ['castVote(uint256,uint8)', 'nonpayable', 'uint256'],
    ['castVoteWithReason(uint256,uint8,string)', 'nonpayable', 'uint256'],
    ['castVoteWithReasonAndParams(uint256,uint8,string,bytes)', 'nonpayable', 'uint256'],
    ['castVoteBySig(uint256,uint8,address,bytes)', 'nonpayable', 'uint256'],
    ['state(uint256)', 'view', 'uint8'],
    ['proposalVotes(uint256)', 'view', 'uint256,uint256,uint256'],
    ['proposalSnapshot(uint256)', 'view', 'uint256'],
    ['proposalDeadline(uint256)', 'view', 'uint256'],
    ['proposalProposer(uint256)', 'view', 'address'],
    ['proposalEta(uint256)', 'view', 'uint256'],
    ['proposalNeedsQueuing(uint256)', 'view', 'bool'],
    ['hasVoted(uint256,address)', 'view', 'bool'],
    ['quorum(uint256)', 'view', 'uint256'],
    ['quorumNumerator()', 'view', 'uint256'],
    ['quorumDenominator()', 'view', 'uint256'],
    ['votingDelay()', 'view', 'uint256'],
    ['votingPeriod()', 'view', 'uint256'],
    ['proposalThreshold()', 'view', 'uint256'],
    ['hashProposal(address[],uint256[],bytes[],bytes32)', 'pure', 'uint256'],
    ['COUNTING_MODE()', 'view', 'string'],
    ['timelock()', 'view', 'address'],
    // `token()` is ERC-4626's as well, and one entry serves both: a selector has one signature,
    // and what it MEANS is the contract's business, not this table's.

    // --- The Cosmos gov precompile (cosmos/evm, 0x…0805) --------------------------------------
    // A chain whose governance lives in its own `x/gov` module rather than in a deployed contract
    // still reaches the EVM through this fixed address: queries answer `eth_call`, and the five
    // transactions are ordinary EVM transactions a wallet signs. The signatures are here for the
    // same reason every other one is - so this server can ENCODE the call and name it back.
    ['submitProposal(address,bytes,(string,uint256)[])', 'nonpayable', 'uint64'],
    ['cancelProposal(address,uint64)', 'nonpayable', 'bool'],
    ['deposit(address,uint64,(string,uint256)[])', 'nonpayable', 'bool'],
    ['vote(address,uint64,uint8,string)', 'nonpayable', 'bool'],
    ['voteWeighted(address,uint64,(uint8,string)[],string)', 'nonpayable', 'bool'],
    ['getProposal(uint64)', 'view', '(uint64,string[],uint32,(string,string,string,string),uint64,uint64,(string,uint256)[],uint64,uint64,string,string,string,address)'],
    ['getProposals(uint32,address,address,(bytes,uint64,uint64,bool,bool))', 'view', '(uint64,string[],uint32,(string,string,string,string),uint64,uint64,(string,uint256)[],uint64,uint64,string,string,string,address)[],(bytes,uint64)'],
    ['getTallyResult(uint64)', 'view', '(string,string,string,string)'],
    ['getVote(uint64,address)', 'view', '(uint64,address,(uint8,string)[],string)'],
    ['getVotes(uint64,(bytes,uint64,uint64,bool,bool))', 'view', '(uint64,address,(uint8,string)[],string)[],(bytes,uint64)'],
    ['getDeposit(uint64,address)', 'view', '(uint64,address,(string,uint256)[])'],
    ['getDeposits(uint64,(bytes,uint64,uint64,bool,bool))', 'view', '(uint64,address,(string,uint256)[])[],(bytes,uint64)'],
    ['getConstitution()', 'view', 'string'],

    // --- The Cosmos staking precompile (cosmos/evm, 0x…0800) ----------------------------------
    // Governance's neighbour, and the same arrangement: `x/staking` is a Cosmos module that never
    // touches the EVM, and this fixed address is what lets a wallet that only speaks Ethereum send
    // a `MsgDelegate`. The explorer READS the validator set from the module's REST api instead
    // (see chain/staking.ts) - these are here so the four transactions can be ENCODED.
    //
    // A validator is named by its BECH32 operator address, which is why every one of these takes
    // a `string` where an EVM contract would take an address: `nuravaloper1…` is the module's own
    // key for a validator, and the twenty bytes underneath it belong to the operator's ACCOUNT,
    // not to the validator. Passing the hex form would name something else.
    //
    // `undelegate` and `redelegate` answer a COMPLETION TIME rather than a success flag: both
    // start a clock the module will finish on its own, and the useful answer is when.
    ['delegate(address,string,uint256)', 'nonpayable', 'bool'],
    ['undelegate(address,string,uint256)', 'nonpayable', 'int64'],
    ['redelegate(address,string,string,uint256)', 'nonpayable', 'int64'],
    // Takes the CREATION HEIGHT of the entry being cancelled: a delegator may have several
    // withdrawals in flight from one validator, and the height is what tells them apart.
    ['cancelUnbondingDelegation(address,string,uint256,uint256)', 'nonpayable', 'bool'],
    ['delegation(address,string)', 'view', 'uint256,(string,uint256)'],
    ['validators(string,(bytes,uint64,uint64,bool,bool))', 'view', '(string,string,bool,uint8,uint256,uint256,(string,string,string,string,string),int64,int64,uint256,uint256)[],(bytes,uint64)'],

    // --- The Cosmos distribution precompile (cosmos/evm, 0x…0801) -----------------------------
    // Where a delegator's rewards are claimed from. `withdrawDelegatorRewards` takes ONE validator
    // and answers what it paid; `claimRewards` sweeps up to `maxRetrieve` of them in one
    // transaction, which is what a reader staked with six validators actually wants.
    //
    // A reward is a `DecCoin` inside the module - it accrues as an eighteen-place decimal - but
    // what these RETURN is whole base units, because that is what was actually transferred.
    ['withdrawDelegatorRewards(address,string)', 'nonpayable', '(string,uint256)[]'],
    ['claimRewards(address,uint32)', 'nonpayable', 'bool'],
    ['setWithdrawAddress(address,string)', 'nonpayable', 'bool'],
    ['delegatorValidators(address)', 'view', 'string[]'],
    ['delegationRewards(address,string)', 'view', '(string,uint256)[]'],

    // --- Goman prediction markets (the factory) -----------------------------------------------
    // Not a standard, and not a guess either: these are named from the ABI this chain's own
    // prediction client ships (NuraChain/Goman, `application/src/lib/abis/prediction-factory.json`),
    // and the selectors below are hashed from those signatures like every other entry here. It
    // earns a section because a chain has ONE factory and every market it stamps is reached from
    // it - leaving the factory unnamed leaves the whole market tree unreadable.
    //
    // A market is a CLONE. The factory holds a CPMM implementation and a parimutuel one and
    // stamps EIP-1167 proxies off them, so the two creates differ in nothing a signature can
    // show: the same `MarketParams`, a different template. `createMarket` is the CPMM half and
    // is payable because the value sent seeds the pool; the parimutuel half takes no value, and
    // its name really is `createMarket2` - the client's ABI spells it that way.
    //
    // The nine-field tuple the five list calls return is one market's row - market, creator,
    // title, category, status, createdAt, lockTime, resolveTime, outcomeCount - written out at
    // each of them, because a signature has no way to carry a struct's NAME.
    //
    // `category` is a uint32 ID, not the label: the factory keeps the words in its own table, one
    // per language (`categoryMeaning(uint32,bytes8)`), so a market carries the id and a reader is
    // shown whichever language they asked for. A row that spelled the category as a string is an
    // OLDER factory than the one deployed here.
    ['marketCount()', 'view', 'uint256'],
    ['marketImplementation()', 'view', 'address'],
    ['poolImplementation()', 'view', 'address'],
    ['treasury()', 'view', 'address'],
    ['BPS()', 'view', 'uint16'],
    ['MAX_FEE_BPS()', 'view', 'uint16'],
    ['MAX_SIGNERS()', 'view', 'uint256'],
    ['defaultFeeBps()', 'view', 'uint16'],
    ['defaultProtocolFeeShareBps()', 'view', 'uint16'],
    ['requiredConfirmations()', 'view', 'uint256'],
    ['marketAt(uint256)', 'view', '(address,address,string,uint32,uint8,uint64,uint64,uint64,uint32)'],
    ['marketAddress(uint256)', 'view', 'address'],
    // Which template a market was stamped from: the CPMM one, or the parimutuel pool.
    ['marketKind(uint256)', 'view', 'uint8'],
    ['countByStatus(uint8)', 'view', 'uint256'],
    ['marketsPaged(uint256,uint256)', 'view', '(address,address,string,uint32,uint8,uint64,uint64,uint64,uint32)[]'],
    ['activeMarkets(uint256,uint256)', 'view', '(address,address,string,uint32,uint8,uint64,uint64,uint64,uint32)[]'],
    ['closedMarkets(uint256,uint256)', 'view', '(address,address,string,uint32,uint8,uint64,uint64,uint64,uint32)[]'],
    ['resolvedMarkets(uint256,uint256)', 'view', '(address,address,string,uint32,uint8,uint64,uint64,uint64,uint32)[]'],
    ['marketsByStatus(uint8,uint256,uint256)', 'view', '(address,address,string,uint32,uint8,uint64,uint64,uint64,uint32)[]'],
    // Resolution is an n-of-m the factory keeps itself: the signers confirm an outcome, and the
    // market is only told once `requiredConfirmations()` of them have named the SAME one.
    ['resolutionSigners()', 'view', 'address[]'],
    ['isResolutionSigner(address)', 'view', 'bool'],
    ['confirmationCount(uint256,uint256)', 'view', 'uint256'],
    ['confirmationOf(uint256,address)', 'view', 'uint256'],
    ['confirmResolution(uint256,uint256)', 'nonpayable', ''],
    ['createMarket((string,string,uint32,string,address,uint64,uint64,uint16,uint16,string[]))', 'payable', 'uint256,address'],
    ['createMarket2((string,string,uint32,string,address,uint64,uint64,uint16,uint16,string[]))', 'nonpayable', 'uint256,address'],
    ['closeMarket(uint256)', 'nonpayable', ''],
    ['voidMarket(uint256)', 'nonpayable', ''],
    ['pauseMarket(uint256)', 'nonpayable', ''],
    ['unpauseMarket(uint256)', 'nonpayable', ''],
    ['setResolutionSigners(address[],uint256)', 'nonpayable', ''],
    ['setDefaultFees(uint16,uint16)', 'nonpayable', ''],
    ['setTreasury(address)', 'nonpayable', ''],
    // A market caches the treasury it was stamped with; this pushes the factory's current one on
    // to a market already deployed, which is why it takes an id and not an address.
    ['repointTreasury(uint256)', 'nonpayable', ''],

    // --- Nura bridge tokens -------------------------------------------------------------------
    // The three assets bridged in from other chains - BNB, USDT and the bridge token itself.
    // Everything else they answer is ERC-20 or AccessControl and is named above; this is the one
    // addition, the burn an operator performs when the asset leaves for the other side. It is a
    // ROLE-gated burn of somebody else's balance, which is why it is not `burnFrom` - no
    // allowance is involved and none is spent.
    ['adminBurn(address,uint256)', 'nonpayable', ''],

    // --- Faucet token (test networks) ---------------------------------------------------------
    // A test-net ERC-20 anybody can draw from. `faucetEnabled` is worth naming because a faucet
    // that stopped answering is the first thing a reader checks when a test wallet will not fill.
    ['deployer()', 'view', 'address'],
    ['faucet(uint256)', 'nonpayable', ''],
    ['faucetEnabled()', 'view', 'bool'],

    // --- Airdrop (one signed claim per address) -----------------------------------------------
    // Pays a fixed amount of the native coin to the first `maxClaims` addresses that present a
    // signature from a SIGNER_ROLE key. The signature is what decides eligibility - the on-chain
    // checks only stop double claims and overruns - so `getReward` carries it and `claimDigest`
    // is the EIP-712 digest that was signed, bound to this contract and this chain.
    //
    // The three counters beside them are what says whether a claim can still succeed: `maxClaims`
    // caps the campaign, `fundedClaims` is how many the contract's own balance could actually
    // pay, and `outstandingLiability` is what it already owes. A campaign whose remaining claims
    // exceed its funded ones is one that will run out, and that is readable from these alone.
    ['SIGNER_ROLE()', 'view', 'bytes32'],
    ['claimDigest(address,uint256)', 'view', 'bytes32'],
    ['fund()', 'payable', ''],
    ['fundedClaims()', 'view', 'uint256'],
    ['getReward(uint256,bytes)', 'nonpayable', ''],
    ['hasClaimed(address)', 'view', 'bool'],
    ['maxClaims()', 'view', 'uint256'],
    ['outstandingLiability()', 'view', 'uint256'],
    ['remainingClaims()', 'view', 'uint256'],
    ['rewardAmount()', 'view', 'uint256'],
    ['setRewardAmount(uint256)', 'nonpayable', ''],
    ['totalClaims()', 'view', 'uint256'],
    ['withdraw(address,uint256)', 'nonpayable', ''],

    // --- Collateralised NFT vault -------------------------------------------------------------
    // An ERC-721 where every token is a claim on a fixed amount of one ERC-20 held by the vault.
    // `lockedAmount(id)` is what THAT token redeems for and never changes; `lockAmount()` is only
    // what the NEXT mint will reserve, so the two are different questions and both are named.
    //
    // `vaultState()` answers eight of these counters in one call - the whole solvency picture in
    // a single eth_call rather than eight - which is why it is worth naming even though every
    // figure in it is separately readable.
    ['availableBacking()', 'view', 'uint256'],
    ['backingToken()', 'view', 'address'],
    ['deposit(uint256)', 'nonpayable', ''],
    ['lockAmount()', 'view', 'uint256'],
    ['lockedAmount(uint256)', 'view', 'uint256'],
    ['mintBatch(address,uint256)', 'nonpayable', 'uint256'],
    ['publicMintEnabled()', 'view', 'bool'],
    ['redeem(uint256)', 'nonpayable', ''],
    ['remainingMintCapacity()', 'view', 'uint256'],
    ['setBaseURI(string)', 'nonpayable', ''],
    ['setLockAmount(uint256)', 'nonpayable', ''],
    ['setPublicMintEnabled(bool)', 'nonpayable', ''],
    ['tokenBalance()', 'view', 'uint256'],
    ['totalMinted()', 'view', 'uint256'],
    ['totalRedeemed()', 'view', 'uint256'],
    ['totalReserved()', 'view', 'uint256'],
    ['vaultState()', 'view', 'uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256'],
    ['withdrawExcessTokens(address,uint256)', 'nonpayable', ''],

    // --- Goman prediction markets (the factory's category table) ------------------------------
    // A category is a uint32 ID plus a table of words for it, one row per language tag (`bytes8`,
    // eg `en`/`fa`). The factory holds the words so a market carries only the id and every client
    // spells it in the reader's own language - which is also why `categoryMeanings` returns the
    // tags and the strings as two parallel arrays rather than one list of pairs.
    ['DEFAULT_LANG()', 'view', 'bytes8'],
    ['MAX_CATEGORY_LANGS()', 'view', 'uint256'],
    ['addCategory(uint32,bytes8[],string[])', 'nonpayable', ''],
    ['categoryCount()', 'view', 'uint256'],
    ['categoryIds()', 'view', 'uint32[]'],
    ['categoryLanguages(uint32)', 'view', 'bytes8[]'],
    ['categoryMeaning(uint32,bytes8)', 'view', 'string'],
    ['categoryMeanings(uint32)', 'view', 'bytes8[],string[]'],
    ['categoryState(uint32)', 'view', 'bool,bool'],
    ['countByCategory(uint32)', 'view', 'uint256'],
    ['distributeMarket(uint256,uint256)', 'nonpayable', 'uint256'],
    ['marketsByCategory(uint32,uint256,uint256)', 'view', '(address,address,string,uint32,uint8,uint64,uint64,uint64,uint32)[]'],
    ['setCategoryEnabled(uint32,bool)', 'nonpayable', ''],
    ['setCategoryMeanings(uint32,bytes8[],string[])', 'nonpayable', ''],
    ['setMarketAutoDistribute(uint256,bool)', 'nonpayable', ''],
    ['sweepUnclaimed(uint256)', 'nonpayable', 'uint256'],

    // --- Goman prediction markets (one CPMM market) -------------------------------------------
    // The contract a reader actually lands on from a trade. Outcomes are ERC-1155 ids inside the
    // market, so `totalSupply(uint256)` and `balanceOf(address,uint256)` are per-OUTCOME figures
    // and not the market's own; `LP_TOKEN_ID()` is the id that holds liquidity instead of an
    // outcome. `calcBuy`/`calcSell` quote a trade without sending it, and `getPrices` is the
    // whole implied-probability vector in one call.
    //
    // A market also answers `getReserves()`, which is NOT added here: the selector already
    // belongs to the Uniswap V2 pair above, whose `uint112,uint112,uint32` this market spells
    // `uint256[]`. One selector cannot hold two return shapes, and a V2 pair is the commoner
    // contract - so the pair keeps the name and a market's reserves decode as raw bytes rather
    // than as three wrong numbers.
    //
    // `exists(uint256)` is shared with the profile registry below for the same reason `token()`
    // is shared with ERC-4626: a selector has one signature, and what it MEANS is the contract's.
    ['AUTO_DISTRIBUTE_BATCH()', 'view', 'uint256'],
    ['CLAIM_WINDOW()', 'view', 'uint64'],
    ['LP_TOKEN_ID()', 'view', 'uint256'],
    ['MAX_OUTCOMES()', 'view', 'uint256'],
    ['addFunding(uint256)', 'payable', 'uint256'],
    ['autoDistribute()', 'view', 'bool'],
    ['buy(uint256,uint256,uint256)', 'payable', 'uint256'],
    ['calcBuy(uint256,uint256)', 'view', 'uint256'],
    ['calcSell(uint256,uint256)', 'view', 'uint256'],
    ['categoryId()', 'view', 'uint32'],
    ['claimDeadline()', 'view', 'uint64'],
    ['close()', 'nonpayable', ''],
    ['controller()', 'view', 'address'],
    ['createdAt()', 'view', 'uint64'],
    ['creator()', 'view', 'address'],
    ['description()', 'view', 'string'],
    ['distribute(uint256)', 'nonpayable', 'uint256'],
    ['distributionProgress()', 'view', 'uint256,uint256'],
    ['endedAt()', 'view', 'uint64'],
    ['exists(uint256)', 'view', 'bool'],
    ['feeBps()', 'view', 'uint16'],
    ['getPrices()', 'view', 'uint256[]'],
    ['holderCount()', 'view', 'uint256'],
    ['imageURI()', 'view', 'string'],
    ['initialize(address,address,(string,string,uint32,string,address,uint64,uint64,uint16,uint16,string[]))', 'payable', ''],
    ['lockTime()', 'view', 'uint64'],
    ['mergeSets(uint256)', 'nonpayable', ''],
    ['outcomeCount()', 'view', 'uint256'],
    ['outcomeName(uint256)', 'view', 'string'],
    ['pendingPayout(address)', 'view', 'uint256'],
    ['protocolFeeShareBps()', 'view', 'uint16'],
    ['redeem()', 'nonpayable', 'uint256'],
    ['removeFunding(uint256)', 'nonpayable', ''],
    ['resolve(uint256)', 'nonpayable', ''],
    ['resolveTime()', 'view', 'uint64'],
    ['sell(uint256,uint256,uint256,uint256)', 'nonpayable', 'uint256'],
    ['setAutoDistribute(bool)', 'nonpayable', ''],
    ['status()', 'view', 'uint8'],
    ['sweepUnclaimed()', 'nonpayable', 'uint256'],
    ['title()', 'view', 'string'],
    ['totalSets()', 'view', 'uint256'],
    ['totalSupply(uint256)', 'view', 'uint256'],
    ['voidMarket()', 'nonpayable', ''],
    ['winningOutcome()', 'view', 'uint256'],

    // --- Goman prediction markets (the parimutuel pool) ---------------------------------------
    // The factory's other template: one stake per outcome, no curve and no LP. `impliedOdds` and
    // `previewPayout` are what a pool answers instead of a price, and `myStake` reads the caller's
    // own - it takes an outcome and not an address, so it is only meaningful through eth_call
    // with a `from`, which is exactly how the explorer issues it.
    ['bet(uint256)', 'payable', 'uint256'],
    ['claim()', 'nonpayable', 'uint256'],
    ['distributableAmount()', 'view', 'uint256'],
    ['impliedOdds(uint256)', 'view', 'uint256'],
    ['myStake(uint256)', 'view', 'uint256'],
    ['participantCount()', 'view', 'uint256'],
    ['previewPayout(uint256)', 'view', 'uint256'],
    ['stakedFor(uint256)', 'view', 'uint256'],
    ['totalPool()', 'view', 'uint256'],

    // --- Goman prediction markets (the fee treasury) ------------------------------------------
    // Where every market's protocol share lands. `collectedFor` splits the total by the market
    // that paid it, so a reader can see which market funded the balance.
    ['collectedFor(address)', 'view', 'uint256'],
    ['depositFee(address)', 'payable', ''],
    ['feeRecipient()', 'view', 'address'],
    ['setFeeRecipient(address)', 'nonpayable', ''],
    ['totalCollected()', 'view', 'uint256'],

    // --- Nura profile registry ----------------------------------------------------------------
    // One profile per address, behind a proxy, with a username the registry normalises and owns.
    //
    // Almost every field is stored under a hashed key and read back by its plain name, which is
    // why so many of these take a string: `setField(id,'bio',...)` writes what `getField(id,'bio')`
    // reads. `setLocalizedField` adds a language tag to that key, and `resolveField` is the one
    // to call - it answers the localised value where there is one and falls back to the plain
    // field where there is not, so a client asks once rather than twice.
    //
    // Transfer is TWO-STEP (`transferProfile` then `acceptProfile`, with `cancelTransfer` in
    // between), because a profile sent to a wrong address would otherwise be gone with its
    // username. `recoveryAddressOf` is the separate escape hatch for a lost key.
    ['MAX_USERNAME_LENGTH()', 'view', 'uint256'],
    ['MAX_VALUE_LENGTH()', 'view', 'uint256'],
    ['MIN_USERNAME_LENGTH()', 'view', 'uint256'],
    ['acceptProfile(uint256)', 'nonpayable', ''],
    ['addImage(uint256,string,string,string)', 'nonpayable', 'uint256'],
    ['addItem(uint256,string,(string,string,string)[])', 'nonpayable', 'uint256'],
    ['addSocial(uint256,string,string,string)', 'nonpayable', 'uint256'],
    ['addWebsite(uint256,string,string)', 'nonpayable', 'uint256'],
    ['approveExtension(uint256,string,bool)', 'nonpayable', ''],
    ['cancelTransfer(uint256)', 'nonpayable', ''],
    ['createProfile(string,string,string,string)', 'nonpayable', 'uint256'],
    ['deleteProfile(uint256)', 'nonpayable', ''],
    ['extensionIdOf(address)', 'view', 'bytes32'],
    ['getExtension(string)', 'view', 'address'],
    ['getExtensionField(uint256,string,string,string)', 'view', 'string'],
    ['getExtensions()', 'view', 'bytes32[],address[]'],
    ['getField(uint256,string)', 'view', 'string'],
    ['getItemAttribute(uint256,uint256,string,string)', 'view', 'string'],
    ['getItemCount(uint256,string)', 'view', 'uint256'],
    ['getItemIds(uint256,string)', 'view', 'uint256[]'],
    ['getItemKind(uint256,uint256)', 'view', 'string'],
    ['getLocalizedField(uint256,string,string)', 'view', 'string'],
    ['getProfileRecord(uint256)', 'view', '(address,string,uint64,uint64,address,address,uint256)'],
    ['isAuthorized(uint256,address)', 'view', 'bool'],
    ['isExtensionApproved(uint256,string)', 'view', 'bool'],
    ['isOperator(address,address)', 'view', 'bool'],
    ['isUsernameAvailable(string)', 'view', 'bool'],
    ['normalizeUsername(string)', 'pure', 'string'],
    ['pendingOwnerOf(uint256)', 'view', 'address'],
    ['profileIdOf(address)', 'view', 'uint256'],
    ['profilesCreated()', 'view', 'uint256'],
    ['recoveryAddressOf(uint256)', 'view', 'address'],
    ['registerExtension(string,address)', 'nonpayable', ''],
    ['removeExtensionField(uint256,string,string,string)', 'nonpayable', ''],
    ['removeField(uint256,string,string)', 'nonpayable', ''],
    ['removeImage(uint256,uint256)', 'nonpayable', ''],
    ['removeItem(uint256,uint256)', 'nonpayable', ''],
    ['removeSocial(uint256,uint256)', 'nonpayable', ''],
    ['removeWebsite(uint256,uint256)', 'nonpayable', ''],
    ['reserveUsername(string,address)', 'nonpayable', ''],
    ['resolveField(uint256,string,string)', 'view', 'string'],
    ['resolveFields(uint256,string[],string)', 'view', 'string[]'],
    ['resolveItemAttribute(uint256,uint256,string,string)', 'view', 'string'],
    ['resolveItemAttributes(uint256,uint256,string[],string)', 'view', 'string[]'],
    ['resolveUsername(string)', 'view', 'uint256,address'],
    ['setExtensionField(uint256,string,string,string)', 'nonpayable', ''],
    ['setField(uint256,string,string)', 'nonpayable', ''],
    ['setFields(uint256,(string,string,string)[])', 'nonpayable', ''],
    ['setItemAttribute(uint256,uint256,string,string,string)', 'nonpayable', ''],
    ['setItemAttributes(uint256,uint256,(string,string,string)[])', 'nonpayable', ''],
    ['setLocalizedField(uint256,string,string,string)', 'nonpayable', ''],
    ['setOperator(address,bool)', 'nonpayable', ''],
    ['setRecoveryAddress(uint256,address)', 'nonpayable', ''],
    ['setUsername(uint256,string)', 'nonpayable', ''],
    ['transferProfile(uint256,address)', 'nonpayable', ''],
    ['unregisterExtension(string)', 'nonpayable', ''],
    ['unreserveUsername(string)', 'nonpayable', ''],
    ['updateImage(uint256,uint256,string,string,string)', 'nonpayable', ''],
    ['updateSocial(uint256,uint256,string,string,string)', 'nonpayable', ''],
    ['updateWebsite(uint256,uint256,string,string)', 'nonpayable', ''],
    ['usernameOf(uint256)', 'view', 'string'],
    ['usernameReservation(string)', 'view', 'address,bool'],

    // --- Nura profile lens (the read-only view) -----------------------------------------------
    // A separate address that reads the registry and assembles whole profiles - the registry
    // itself answers one field per call. Every entry takes a language tag and resolves through
    // it, and `getFullProfile` returns the profile with its images, socials and websites in ONE
    // call, which is the difference between a profile page and thirty eth_calls.
    ['core()', 'view', 'address'],
    ['getFullProfile(address,string)', 'view', '((uint256,address,string,uint64,uint64,string,string,string,string,string,string,string),(uint256,string,string,string)[],(uint256,string,string,string)[],(uint256,string,string,string)[])'],
    ['getFullProfileById(uint256,string)', 'view', '((uint256,address,string,uint64,uint64,string,string,string,string,string,string,string),(uint256,string,string,string)[],(uint256,string,string,string)[],(uint256,string,string,string)[])'],
    ['getImage(uint256,uint256,string)', 'view', '(uint256,string,string,string)'],
    ['getImages(uint256,string)', 'view', '(uint256,string,string,string)[]'],
    ['getItems(uint256,string,string,string[],uint256,uint256)', 'view', '(uint256,string[])[],uint256'],
    ['getProfile(address,string)', 'view', '(uint256,address,string,uint64,uint64,string,string,string,string,string,string,string)'],
    ['getProfileById(uint256,string)', 'view', '(uint256,address,string,uint64,uint64,string,string,string,string,string,string,string)'],
    ['getProfileByUsername(string,string)', 'view', '(uint256,address,string,uint64,uint64,string,string,string,string,string,string,string)'],
    ['getSocial(uint256,uint256,string)', 'view', '(uint256,string,string,string)'],
    ['getSocials(uint256,string)', 'view', '(uint256,string,string,string)[]'],
    ['getWebsite(uint256,uint256,string)', 'view', '(uint256,string,string,string)'],
    ['getWebsites(uint256,string)', 'view', '(uint256,string,string,string)[]'],

    // --- Nura profile extensions (the social verifier) ----------------------------------------
    // An extension contract a profile owner approves, which writes fields the registry will not
    // let the owner write themselves: a handle is only recorded once a VERIFIER_ROLE key has
    // signed for it. `nonces(uint256)` is per PROFILE ID, not per address - the sibling of the
    // ERC-2612 `nonces(address)` above and a different selector.
    ['EXTENSION_ID()', 'view', 'bytes32'],
    ['VERIFIER_ROLE()', 'view', 'bytes32'],
    ['extensionId()', 'pure', 'bytes32'],
    ['hashVerifyHandle(uint256,string,string,uint256)', 'view', 'bytes32'],
    ['nonces(uint256)', 'view', 'uint256'],
    ['profileRegistry()', 'view', 'address'],
    ['registry()', 'view', 'address'],
    ['revokeHandle(uint256,string)', 'nonpayable', ''],
    ['verifiedHandle(uint256,string)', 'view', 'string'],
    ['verifyHandle(uint256,string,string,uint256,bytes)', 'nonpayable', ''],

    // --- Uniswap V3 callbacks and the interfaces around them ----------------------------------
    // The flash callback completes the set beside the mint and swap ones above. The other three
    // are interfaces a periphery contract requires of its counterparty rather than calls a reader
    // sends: `onERC721Received` is what makes a contract able to hold a position NFT at all,
    // `isValidSignature` is ERC-1271 contract-wallet approval, and this `permit` is the DAI-style
    // allowed-flag form - a different signature from the ERC-2612 one above, and its own selector.
    ['isValidSignature(bytes32,bytes)', 'view', 'bytes4'],
    ['onERC721Received(address,address,uint256,bytes)', 'nonpayable', 'bytes4'],
    ['permit(address,address,uint256,uint256,bool,uint8,bytes32,bytes32)', 'nonpayable', ''],
    ['uniswapV3FlashCallback(uint256,uint256,bytes)', 'nonpayable', ''],

    // --- Odds and ends every toolchain emits --------------------------------------------------
    // `multicall` is PAYABLE: Uniswap's periphery base declares it so, and the value sent covers
    // whichever of the batched calls wants it. Marked nonpayable it would offer no value field,
    // and a batch that mints a position with native currency could not be sent at all.
    ['multicall(bytes[])', 'payable', 'bytes[]'],
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
    // Governor, and the votes token underneath it.
    'ProposalCreated(uint256,address,address[],uint256[],string[],bytes[],uint256,uint256,string)',
    'ProposalQueued(uint256,uint256)',
    'ProposalExecuted(uint256)',
    'ProposalCanceled(uint256)',
    'VoteCast(address,uint256,uint8,uint256,string)',
    'VoteCastWithParams(address,uint256,uint8,uint256,string,bytes)',
    'DelegateChanged(address,address,address)',
    'DelegateVotesChanged(address,uint256,uint256)',
    // Uniswap V3 factory and position manager.
    'FeeAmountEnabled(uint24,int24)',
    'OwnerChanged(address,address)',
    'PoolCreated(address,address,uint24,int24,address)',
    'IncreaseLiquidity(uint256,uint128,uint256,uint256)',
    'DecreaseLiquidity(uint256,uint128,uint256,uint256)',
    'Collect(uint256,address,uint256,uint256)',
    // The bridged assets, minted here against a deposit on the other chain.
    'BridgeBurn(address,uint256,address)',
    'BridgeMint(address,uint256,address)',
    'TokensRescued(address,address,uint256)',
    // The airdrop.
    'Funded(address,uint256)',
    'RewardAmountUpdated(uint256,uint256)',
    'RewardClaimed(address,uint256,uint256)',
    'Withdrawn(address,uint256)',
    // The collateralised NFT vault.
    'BaseURIUpdated(string)',
    'Deposited(address,uint256,uint256)',
    'ExcessTokensWithdrawn(address,uint256)',
    'LockAmountUpdated(uint256,uint256)',
    'NFTMinted(address,uint256,uint256)',
    'NFTRedeemed(address,uint256,uint256)',
    'PublicMintUpdated(bool)',
    // Goman prediction markets - the factory, a market, the pool and the fee treasury.
    // `RewardClaimed` is the market's, and is a different topic from the airdrop's above - three
    // arguments against that one's three of other types, so the two never collide.
    'AutoDistributeSet(address,bool)',
    'BetPlaced(address,address,uint256,uint256)',
    'CategoryAdded(uint32)',
    'CategoryEnabledSet(uint32,bool)',
    'CategoryMeaningSet(uint32,bytes8,string)',
    'DistributionAdvanced(address,uint256,uint256,uint256)',
    'FeeCollected(address,uint256)',
    'FeeRecipientChanged(address)',
    'FeeWithdrawn(address,uint256)',
    'FeesUpdated(uint16,uint16)',
    'LiquidityAdded(address,address,uint256,uint256)',
    'LiquidityRemoved(address,address,uint256)',
    'MarketClosed(address)',
    'MarketCreated(uint256,address,address,uint32,uint256,uint256)',
    'MarketPaused(address)',
    'MarketResolved(address,uint256)',
    'MarketUnpaused(address)',
    'MarketVoided(address)',
    'PayoutDeferred(address,address,uint256)',
    'PredictionPlaced(address,address,uint256,uint256,uint256)',
    'PredictionSold(address,address,uint256,uint256,uint256)',
    'ResolutionConfirmed(uint256,address,uint256,uint256)',
    'ResolutionExecuted(uint256,uint256,uint256)',
    'ResolutionSignersUpdated(address[],uint256)',
    'RewardClaimed(address,address,uint256)',
    'TreasuryUpdated(address)',
    'UnclaimedSwept(address,address,uint256)',
    // The profile registry and its extensions. Names and keys are logged HASHED - a username
    // or a field key arrives as bytes32, because an indexed string is stored as its hash and the
    // original is not in the log at all; the unhashed value is on the contract, which is what
    // `usernameOf` and `getField` are for.
    'ExtensionAdded(bytes32,address)',
    'ExtensionApprovalSet(uint256,bytes32,bool)',
    'ExtensionFieldRemoved(uint256,bytes32,bytes32,bytes32)',
    'ExtensionFieldUpdated(uint256,bytes32,bytes32,bytes32,string)',
    'ExtensionRemoved(bytes32,address)',
    'FieldRemoved(uint256,bytes32,bytes32)',
    'FieldUpdated(uint256,bytes32,string)',
    'HandleRevoked(uint256,bytes32)',
    'HandleVerified(uint256,bytes32,string,address)',
    'ImageAdded(uint256,uint256,string,string,string)',
    'ImageRemoved(uint256,uint256)',
    'ImageUpdated(uint256,uint256,string,string,string)',
    'ItemAdded(uint256,uint256,bytes32)',
    'ItemAttributeRemoved(uint256,uint256,bytes32,bytes32)',
    'ItemAttributeUpdated(uint256,uint256,bytes32,bytes32,string)',
    'ItemRemoved(uint256,uint256,bytes32)',
    'LocalizedFieldUpdated(uint256,bytes32,bytes32,string)',
    'OperatorSet(address,address,bool)',
    'ProfileCreated(uint256,address,bytes32)',
    'ProfileDeleted(uint256,address,bytes32)',
    'ProfileTransferCancelled(uint256)',
    'ProfileTransferInitiated(uint256,address,address)',
    'ProfileTransferred(uint256,address,address)',
    'ProfileUpdated(uint256)',
    'RecoveryAddressSet(uint256,address)',
    'SocialAdded(uint256,uint256,string,string,string)',
    'SocialRemoved(uint256,uint256)',
    'SocialUpdated(uint256,uint256,string,string,string)',
    'UsernameChanged(uint256,bytes32,bytes32)',
    'UsernameReserved(bytes32,address)',
    'UsernameUnreserved(bytes32)',
    'WebsiteAdded(uint256,uint256,string,string)',
    'WebsiteRemoved(uint256,uint256)',
    'WebsiteUpdated(uint256,uint256,string,string)',
    // The Uniswap V3 pool, and deliberately not the V2 pair's: `Mint`, `Burn`, `Swap` and
    // `Collect` are spelled differently here and hash to different topics, so both sets are named.
    'Burn(address,int24,int24,uint128,uint256,uint256)',
    'Collect(address,address,int24,int24,uint128,uint128)',
    'CollectProtocol(address,address,uint128,uint128)',
    'Flash(address,address,uint256,uint256,uint256,uint256)',
    'IncreaseObservationCardinalityNext(uint16,uint16)',
    'Initialize(uint160,int24)',
    'Mint(address,address,int24,int24,uint128,uint256,uint256)',
    'SetFeeProtocol(uint8,uint8,uint8,uint8)',
    'Swap(address,address,int256,int256,uint160,uint128,int24)'
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
 *
 * Two entries hashing to the same selector THROWS rather than resolving. Built with `new Map`
 * the second would simply overwrite the first: the table would be one name short, and nothing
 * anywhere would say so. A duplicate is a mistake in this file - the same signature written
 * twice under two headings - and a genuine four-byte collision between different signatures is
 * a thing to decide about, not to lose silently. Either way it is caught the first time anything
 * imports this module, which is every test run.
 */
function indexFunctions(): ReadonlyMap<string, KnownFunction>
{
    const table = new Map<string, KnownFunction>();
    for (const [signature, mutability, outputs] of FUNCTIONS)
    {
        const { name, inputs } = split(signature);
        const selector = toFunctionSelector(signature);
        const clash = table.get(selector);
        if (clash !== undefined)
        {
            throw new Error(`signature table: ${ selector } is both '${ clash.signature }' and '${ signature }'`);
        }
        table.set(selector, { selector, signature, name, inputs, outputs: types(outputs), mutability });
    }
    return table;
}

function indexEvents(): ReadonlyMap<string, KnownEvent>
{
    const table = new Map<string, KnownEvent>();
    for (const signature of EVENTS)
    {
        const { name, inputs } = split(signature);
        const topic = toEventSelector(signature);
        const clash = table.get(topic);
        if (clash !== undefined)
        {
            throw new Error(`signature table: ${ topic } is both '${ clash.signature }' and '${ signature }'`);
        }
        table.set(topic, { topic, signature, name, inputs });
    }
    return table;
}

export const FUNCTION_BY_SELECTOR: ReadonlyMap<string, KnownFunction> = indexFunctions();

export const EVENT_BY_TOPIC: ReadonlyMap<string, KnownEvent> = indexEvents();

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
