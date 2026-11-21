# Contract Storage Migration System

This system provides tools and patterns for managing contract storage migrations during proxy upgrades. It ensures storage layout compatibility and automates the creation of migration contracts.

## Components

### 1. Storage Layout Analysis (`analyze-layout.ts`)
Uses the Solidity compiler (`solc`) to extract the exact storage slot and offset for every variable in a contract.

### 2. Layout Comparison (`runner.ts`)
Compares two storage layout snapshots to identify:
- **Additions**: New variables (safe if appended).
- **Deletions**: Removed variables (dangerous, leaves "holes" or causes shifts).
- **Shifts**: Variables moving to different slots (critical, requires data migration).

### 3. Migration Contracts (`BaseMigration.sol`)
A standard interface and base contract for implementing migration logic. Migration contracts should be deployed and called by the proxy admin during the upgrade process.

### 4. Migration Generator (`generate-migration.ts`)
Automates the creation of boilerplate migration contracts when shifts are detected.

## Workflow

1. **Baseline**: Generate a baseline layout for your current contract version:
   ```bash
   npx ts-node contracts/migrations/runner.ts Splitter
   ```

2. **Develop Upgrade**: Modify your contract for the next version.

3. **Validate**: Compare the new version against the baseline:
   ```bash
   npx ts-node contracts/migrations/runner.ts Splitter contracts/migrations/Splitter.baseline.json
   ```

4. **Migrate**: If shifts are detected, use the generator to create a migration contract:
   ```bash
   npx ts-node contracts/migrations/generate-migration.ts
   ```

5. **Deploy & Verify**: Deploy the migration contract to testnet, execute `migrate()`, and then `verify()`.

## Edge Cases Handled
- **Partial Migrations**: Migration contracts can be designed to run in batches if storage is too large.
- **Rollbacks**: The `BaseMigration` interface includes a `rollback` method for emergency reverts.
- **Storage Packing**: The analyzer detects variables sharing the same slot (packing) and identifies shifts within those slots.
