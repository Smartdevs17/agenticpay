import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Contract Storage Layout Analysis Tool
 * Uses solc to extract and compare storage layouts between contract versions.
 */

interface StorageItem {
  astId: number;
  contract: string;
  label: string;
  offset: number;
  slot: string;
  type: string;
}

interface StorageLayout {
  storage: StorageItem[];
  types: Record<string, any>;
}

export function analyzeStorageLayout(contractPath: string, contractName: string): StorageLayout {
  console.log(`[Analysis] Analyzing storage layout for ${contractName} at ${contractPath}...`);
  
  try {
    // Requires solc to be installed and available in PATH
    const output = execSync(`solc --storage-layout --combined-json storage-layout ${contractPath}`).toString();
    const json = JSON.parse(output);
    
    // Find the contract in the output (solc combined-json keys are "path:name")
    const key = Object.keys(json.contracts).find(k => k.endsWith(`:${contractName}`));
    if (!key) {
      throw new Error(`Contract ${contractName} not found in solc output`);
    }
    
    return json.contracts[key].storageLayout;
  } catch (error) {
    console.error(`[Error] Failed to analyze storage layout: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

export function compareLayouts(oldLayout: StorageLayout, newLayout: StorageLayout) {
  const shifts: string[] = [];
  const deletions: string[] = [];
  const additions: string[] = [];

  const oldStorage = new Map(oldLayout.storage.map(item => [item.label, item]));
  const newStorage = new Map(newLayout.storage.map(item => [item.label, item]));

  // Check for shifts and deletions
  for (const [label, oldItem] of oldStorage) {
    const newItem = newStorage.get(label);
    if (!newItem) {
      deletions.push(label);
    } else if (newItem.slot !== oldItem.slot || newItem.offset !== oldItem.offset) {
      shifts.push(`${label}: slot ${oldItem.slot} -> ${newItem.slot}, offset ${oldItem.offset} -> ${newItem.offset}`);
    }
  }

  // Check for additions
  for (const [label, newItem] of newStorage) {
    if (!oldStorage.has(label)) {
      additions.push(`${label} at slot ${newItem.slot}`);
    }
  }

  return { shifts, deletions, additions };
}

// Example usage if run directly
if (require.main === module) {
  const contractPath = process.argv[2] || 'contracts/Splitter.sol';
  const contractName = process.argv[3] || 'Splitter';
  
  try {
    const layout = analyzeStorageLayout(contractPath, contractName);
    const outputPath = path.join(path.dirname(contractPath), 'migrations', `${contractName}.layout.json`);
    fs.writeFileSync(outputPath, JSON.stringify(layout, null, 2));
    console.log(`[Success] Storage layout saved to ${outputPath}`);
  } catch (err) {
    process.exit(1);
  }
}
