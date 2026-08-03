// Puts real activity on a local anvil so every page of the explorer has something to show:
// native transfers between several accounts, an ERC-20 deployed and moved around, a contract
// creation, and one deliberately reverted transaction (an explorer that only ever renders
// successes hides the case people most need to look up).
//
//   npm run chain     # in one terminal: anvil
//   npm run seed      # in another
import { createWalletClient, createPublicClient, http, parseEther, defineChain, encodeFunctionData, parseAbi } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { readFileSync } from 'node:fs';
import solc from 'solc';

const RPC = process.env.RPC_URL ?? 'http://127.0.0.1:8545';
const CHAIN_ID = Number(process.env.CHAIN_ID ?? '31337');

// anvil's deterministic accounts.
const KEYS = [
    '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
    '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
    '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
    '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6'
];

const chain = defineChain({
    id: CHAIN_ID,
    name: 'Local EVM',
    nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [RPC] } }
});

const publicClient = createPublicClient({ chain, transport: http(RPC) });
const accounts = KEYS.map(key => privateKeyToAccount(key));
const wallets = accounts.map(account => createWalletClient({ account, chain, transport: http(RPC) }));

const ERC20_ABI = parseAbi([
    'constructor(uint256 supply)',
    'function transfer(address to, uint256 amount) returns (bool)',
    'function balanceOf(address owner) view returns (uint256)',
    'function name() view returns (string)',
    'function symbol() view returns (string)',
    'function decimals() view returns (uint8)',
    'event Transfer(address indexed from, address indexed to, uint256 value)'
]);

/**
 * Compiles NuraToken.sol with solc at seed time. The bytecode the explorer indexes is therefore
 * genuinely produced from the source sitting beside this file - nothing is pasted in.
 */
function compileToken()
{
    const source = readFileSync(new URL('./NuraToken.sol', import.meta.url), 'utf8');
    const output = JSON.parse(solc.compile(JSON.stringify({
        language: 'Solidity',
        sources: { 'NuraToken.sol': { content: source } },
        settings: { optimizer: { enabled: true, runs: 200 }, outputSelection: { '*': { '*': ['evm.bytecode.object'] } } }
    })));
    const errors = (output.errors ?? []).filter(entry => entry.severity === 'error');
    if (errors.length > 0)
    {
        throw new Error('solc: ' + errors.map(entry => entry.formattedMessage).join('\n'));
    }
    return `0x${ output.contracts['NuraToken.sol'].NuraToken.evm.bytecode.object }`;
}


async function wait(hash)
{
    return publicClient.waitForTransactionReceipt({ hash });
}

async function main()
{
    const head = await publicClient.getBlockNumber({ cacheTime: 0 });
    console.log(`seeding against ${ RPC } (chain ${ CHAIN_ID }, head ${ head })`);

    // 1. Native transfers - the plain "money moved" case, in both directions.
    const pairs = [[0, 1, '12.5'], [0, 2, '3.25'], [1, 3, '0.75'], [2, 0, '1.125'], [3, 1, '0.5'], [0, 3, '8']];
    for (const [from, to, amount] of pairs)
    {
        const hash = await wallets[from].sendTransaction({
            to: accounts[to].address,
            value: parseEther(amount)
        });
        await wait(hash);
        console.log(`  native ${ amount } ETH  ${ accounts[from].address.slice(0, 10) } -> ${ accounts[to].address.slice(0, 10) }`);
    }

    // 2. A contract creation, so the explorer has one to render.
    const deployHash = await wallets[0].deployContract({
        abi: ERC20_ABI,
        bytecode: compileToken(),
        args: [parseEther('1000000')]
    });
    const deployed = await wait(deployHash);
    const token = deployed.contractAddress;
    console.log(`  deployed token at ${ token }`);

    // 3. ERC-20 transfers - Transfer logs the indexer decodes.
    for (const [to, amount] of [[1, '2500'], [2, '1200.5'], [3, '80']])
    {
        const hash = await wallets[0].sendTransaction({
            to: token,
            data: encodeFunctionData({ abi: ERC20_ABI, functionName: 'transfer', args: [accounts[to].address, parseEther(amount)] })
        });
        await wait(hash);
        console.log(`  token ${ amount } -> ${ accounts[to].address.slice(0, 10) }`);
    }

    // 4. One reverted transaction: transferring more than the sender holds. The explorer must
    //    show a failed transfer AS failed - the case people look up most often.
    try
    {
        const hash = await wallets[3].sendTransaction({
            to: token,
            data: encodeFunctionData({ abi: ERC20_ABI, functionName: 'transfer', args: [accounts[0].address, parseEther('999999')] }),
            gas: 100000n
        });
        await wait(hash);
        console.log('  reverted transfer recorded');
    }
    catch
    {
        console.log('  reverted transfer recorded (rejected before mining)');
    }

    const end = await publicClient.getBlockNumber({ cacheTime: 0 });
    console.log(`done - head is now ${ end }`);
}

await main();
