import { defineConfig } from 'hardhat/config';

// The dev chain, and nothing else. This project does not author contracts - it INDEXES them -
// so hardhat is here purely to run a local node with funded accounts for `npm run seed` to
// transact against. The seed's own token is compiled with solc directly.
//
// Any EVM node works: point RPC_URL at anvil, a devnet, or NuraChain itself and the explorer
// neither knows nor cares.
export default defineConfig({
    solidity: '0.8.28',
    networks: {
        // `hardhat node` serves this at http://127.0.0.1:8545 with chain id 31337.
        hardhat: {
            type: 'edr-simulated',
            chainId: 31337,
            // Blocks on a timer rather than per transaction, so the explorer's cadence strip
            // has a real heartbeat to draw instead of a flat line between bursts.
            mining: { auto: true, interval: 3000 }
        }
    }
});
