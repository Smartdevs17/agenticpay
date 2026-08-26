# Gas Optimization Guide

## Overview

This document describes the gas optimization techniques applied to AgenticPay EVM smart contracts. All optimizations are designed to maintain functional equivalence while reducing gas costs.

## Techniques Applied

### 1. Yul Assembly for Critical Paths

Assembly is used in performance-critical operations where Solidity generates suboptimal EVM bytecode:

- **SLOAD/SSTORE optimizations**: Direct storage slot access via `sload`/`sstore` avoids Solidity's bounds checking and automatic retry logic
- **Self-balance**: `selfbalance()` replaces `address(this).balance` (saves ~20 gas per call)
- **Mappings**: Direct slot computation for mapping reads avoids redundant keccak256 calculations

**Example - SplitterV1:**
```solidity
uint256 len;
assembly {
    len := sload(recipients.slot)
}
```

### 2. Unchecked Arithmetic

Safe arithmetic (Solidity 0.8+ default) is bypassed where overflow is provably impossible:

- Loop counters (`++i`)
- Timestamp calculations (`block.timestamp + delay`)
- Balance subtractions (checked earlier via `if` guards)
- Fee calculations bounded by basis-point constraints

### 3. Custom Errors (Replace `require`)

All string-based `require` statements replaced with custom errors:

- **Before**: `require(ok, "Transfer failed");`
- **After**: `revert TransferFailed(to, amount);`
- **Savings**: ~50 gas per occurrence (shorter deploy bytecode + cheaper reverts)

### 4. Storage Packing

State variables arranged to minimize slot usage:

- `uint16` for basis points (never exceeds 10,000)
- `bool` for flags (packed with adjacent variables)
- `uint256` for timestamps (avoids unnecessary casting)

### 5. Storage Pointer (Reference) Usage

Using `storage` pointers instead of `memory` copies to avoid copying entire structs:

- **Before**: `Recipient memory r = recipients[i];`
- **After**: `Recipient storage r = recipients[i];`

### 6. Redundant SLOAD Elimination

Storage reads are cached in local variables when the value doesn't change:

```solidity
uint16 _platformFeeBps;
assembly {
    _platformFeeBps := sload(platformFeeBps.slot)
}
```

### 7. Loop Optimizations

- Pre-compute array lengths
- Use `unchecked { ++i; }` pattern for iteration
- Use `storage` references to avoid copying

## Contract-Specific Optimizations

| Contract | Key Optimizations | Estimated Savings |
|----------|------------------|-------------------|
| SplitterV1 | Assembly SLOAD, storage pointers, unchecked math | ~15-20% |
| TokenizedFiat | Custom errors, unchecked math, storage caching | ~10-15% |
| TimelockController | Assembly mapping, unchecked math, require→custom errors | ~10-15% |
| EmergencyPause | Assembly mapping, storage optimizations | ~10-15% |
| BridgeHTLC | Custom errors, storage pointers, unchecked math | ~10-15% |
| RelayPaymaster | Custom errors, unchecked math | ~10-15% |
| GasPriceOracle | Assembly mapping reads, unchecked math | ~15-20% |

## Running Gas Benchmarks

```bash
cd contracts/evm
REPORT_GAS=true npm run test:gas
```

To run specific gas benchmark tests:

```bash
npx hardhat test test/gas/GasBenchmark.test.ts
```

## CI Gas Regression Gate

The CI pipeline includes a gas regression check that fails if gas increases beyond a threshold. See `.github/workflows/contracts-evm.yml` for configuration.
