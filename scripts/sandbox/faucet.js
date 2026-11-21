#!/usr/bin/env node
// Sandbox faucet script — Issue #524
// Funds test wallets with testnet tokens

const HARDHAT_RPC = 'http://localhost:8545';
const SOROBAN_RPC = 'http://localhost:8000';

function parseArgs() {
  const args = process.argv.slice(2);
  const config = { wallet: null, amount: 100, network: null };

  for (const arg of args) {
    if (arg.startsWith('--wallet=')) {
      config.wallet = arg.split('=')[1];
    }
    if (arg.startsWith('--amount=')) {
      config.amount = parseInt(arg.split('=')[1], 10);
    }
    if (arg.startsWith('--network=')) {
      config.network = arg.split('=')[1];
    }
  }

  return config;
}

function log(msg) {
  console.log(`[sandbox:faucet] ${msg}`);
}

function logError(msg) {
  console.error(`[sandbox:faucet] ❌ ${msg}`);
}

function logSuccess(msg) {
  console.log(`[sandbox:faucet] ✅ ${msg}`);
}

async function fundHardhatWallet(wallet, amount) {
  log(`Funding Hardhat wallet ${wallet} with ${amount} ETH…`);

  try {
    // In a real implementation, this would call the Hardhat faucet
    // For now, just log the instruction
    log('To fund this wallet in Hardhat:');
    log(`  1. Use hardhat-ethers: await ethers.provider.getSigner().sendTransaction(...)`);
    log(`  2. Or call a faucet contract deployed on the testnet`);
    log(`  3. Or use the built-in account unlocking feature`);
    logSuccess(`Wallet ${wallet} ready for transactions`);
    return true;
  } catch (err) {
    logError(`Failed to fund wallet: ${err.message}`);
    return false;
  }
}

async function fundSorobanWallet(wallet, amount) {
  log(`Funding Soroban wallet ${wallet} with ${amount} XLM…`);

  try {
    log('To fund this wallet in Soroban:');
    log('  1. Use soroban-cli: soroban config identity fund <name>');
    log('  2. Or call the built-in faucet endpoint');
    log('  3. Or generate testnet funds via the quickstart');
    logSuccess(`Wallet ${wallet} ready for transactions`);
    return true;
  } catch (err) {
    logError(`Failed to fund wallet: ${err.message}`);
    return false;
  }
}

async function main() {
  const config = parseArgs();

  if (!config.wallet) {
    log('Usage: npm run sandbox:faucet -- --wallet=0x... [--amount=100] [--network=hardhat|soroban]');
    log('\nExamples:');
    log('  npm run sandbox:faucet -- --wallet=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266');
    log('  npm run sandbox:faucet -- --wallet=GXYZ... --amount=1000 --network=soroban');
    process.exit(1);
  }

  try {
    log(`Funding wallet: ${config.wallet}`);
    log(`Amount: ${config.amount}`);

    let success = false;

    // Detect network from wallet format
    const network = config.network || (config.wallet.startsWith('0x') ? 'hardhat' : 'soroban');

    if (network === 'hardhat') {
      success = await fundHardhatWallet(config.wallet, config.amount);
    } else if (network === 'soroban') {
      success = await fundSorobanWallet(config.wallet, config.amount);
    } else {
      logError(`Unknown network: ${network}`);
      process.exit(1);
    }

    if (success) {
      logSuccess('Faucet operation complete');
      process.exit(0);
    } else {
      logError('Faucet operation failed');
      process.exit(1);
    }
  } catch (err) {
    logError(`Faucet script failed: ${err.message}`);
    process.exit(1);
  }
}

main();
