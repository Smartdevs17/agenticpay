import * as fs from 'fs';
import * as path from 'path';

/**
 * Migration Contract Generator
 * Generates a Solidity contract to migrate storage based on layout changes.
 */

export function generateMigrationContract(
  contractName: string,
  fromVersion: string,
  toVersion: string,
  shifts: string[]
): string {
  const className = `Migration_${contractName}_${fromVersion}_to_${toVersion}`;
  
  let migrationLogic = '';
  if (shifts.length === 0) {
    migrationLogic = '// No storage shifts detected. Only new variables need initialization.';
  } else {
    migrationLogic = '// Manual storage migration required for the following shifts:\n';
    shifts.forEach(shift => {
      migrationLogic += `        // ${shift}\n`;
    });
    migrationLogic += '        // Use sstore/sload assembly for precise slot migration if needed.\n';
  }

  return `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./BaseMigration.sol";

/**
 * @title ${className}
 * @notice Generated migration contract for ${contractName} upgrade from ${fromVersion} to ${toVersion}.
 */
contract ${className} is BaseMigration {
    function migrate(address target) external override onlyAdmin {
        ${migrationLogic}
        
        // Example slot migration:
        // bytes32 oldSlot = 0x...;
        // bytes32 newSlot = 0x...;
        // assembly {
        //     let val := sload(oldSlot)
        //     sstore(newSlot, val)
        // }
    }

    function verify(address target) external view override returns (bool) {
        // Add verification logic here (e.g., check that new variables have expected values)
        return true;
    }
}
`;
}

// Example usage
if (require.main === module) {
  const contractName = 'Splitter';
  const fromVersion = 'V1';
  const toVersion = 'V2';
  const shifts = ['platformFeeBps: slot 1 -> slot 2']; // Mock shift for demo
  
  const content = generateMigrationContract(contractName, fromVersion, toVersion, shifts);
  const outputPath = path.join('contracts', 'migrations', `Migration_${contractName}_${fromVersion}_to_${toVersion}.sol`);
  fs.writeFileSync(outputPath, content);
  console.log(`[Success] Migration contract generated at ${outputPath}`);
}
