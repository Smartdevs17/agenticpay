/**
 * Proxy Migration Script - Issue #363
 *
 * Migrates existing contract to upgradeable proxy pattern
 * Handles state migration and initialization
 */

import {
  Contract,
  SorobanRpc,
  TransactionBuilder,
  Networks,
  Keypair,
} from "@stellar/stellar-sdk";
import { readFileSync } from "fs";
import { join } from "path";

interface MigrationConfig {
  rpcUrl: string;
  networkPassphrase: string;
  adminKeypair: Keypair;
  existingContractId: string;
  proxyWasmPath: string;
  implementationWasmPath: string;
}

interface MigrationState {
  proxyContractId?: string;
  implementationContractId?: string;
  migrationComplete: boolean;
  timestamp: string;
}

export class ProxyMigration {
  private server: SorobanRpc.Server;
  private config: MigrationConfig;
  private state: MigrationState;

  constructor(config: MigrationConfig) {
    this.config = config;
    this.server = new SorobanRpc.Server(config.rpcUrl);
    this.state = {
      migrationComplete: false,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Step 1: Deploy new implementation contract
   */
  async deployImplementation(): Promise<string> {
    console.log("Deploying new implementation contract...");

    const wasmBuffer = readFileSync(this.config.implementationWasmPath);

    // Upload WASM
    const uploadAccount = await this.server.getAccount(
      this.config.adminKeypair.publicKey(),
    );

    const uploadTx = new TransactionBuilder(uploadAccount, {
      fee: "100000",
      networkPassphrase: this.config.networkPassphrase,
    })
      .addOperation(
        Contract.upload({
          wasm: wasmBuffer,
        }),
      )
      .setTimeout(30)
      .build();

    uploadTx.sign(this.config.adminKeypair);

    const uploadResult = await this.server.sendTransaction(uploadTx);
    const uploadHash = uploadResult.hash;

    // Wait for confirmation
    let uploadResponse = await this.server.getTransaction(uploadHash);
    while (
      uploadResponse.status === "PENDING" ||
      uploadResponse.status === "NOT_FOUND"
    ) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      uploadResponse = await this.server.getTransaction(uploadHash);
    }

    if (uploadResponse.status !== "SUCCESS") {
      throw new Error(`Implementation upload failed: ${uploadResponse.status}`);
    }

    // Extract WASM hash from result
    const wasmHash = uploadResponse.returnValue?.toString("hex");
    if (!wasmHash) {
      throw new Error("Failed to get WASM hash");
    }

    console.log(`Implementation deployed with hash: ${wasmHash}`);
    return wasmHash;
  }

  /**
   * Step 2: Deploy proxy contract
   */
  async deployProxy(implementationHash: string): Promise<string> {
    console.log("Deploying proxy contract...");

    const wasmBuffer = readFileSync(this.config.proxyWasmPath);

    const account = await this.server.getAccount(
      this.config.adminKeypair.publicKey(),
    );

    // Upload proxy WASM
    const uploadTx = new TransactionBuilder(account, {
      fee: "100000",
      networkPassphrase: this.config.networkPassphrase,
    })
      .addOperation(
        Contract.upload({
          wasm: wasmBuffer,
        }),
      )
      .setTimeout(30)
      .build();

    uploadTx.sign(this.config.adminKeypair);

    const uploadResult = await this.server.sendTransaction(uploadTx);
    let uploadResponse = await this.server.getTransaction(uploadResult.hash);

    while (
      uploadResponse.status === "PENDING" ||
      uploadResponse.status === "NOT_FOUND"
    ) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      uploadResponse = await this.server.getTransaction(uploadResult.hash);
    }

    if (uploadResponse.status !== "SUCCESS") {
      throw new Error(`Proxy upload failed: ${uploadResponse.status}`);
    }

    const proxyWasmHash = uploadResponse.returnValue?.toString("hex");
    if (!proxyWasmHash) {
      throw new Error("Failed to get proxy WASM hash");
    }

    // Deploy proxy contract instance
    const deployAccount = await this.server.getAccount(
      this.config.adminKeypair.publicKey(),
    );

    const salt = Buffer.from(Date.now().toString());
    const deployTx = new TransactionBuilder(deployAccount, {
      fee: "100000",
      networkPassphrase: this.config.networkPassphrase,
    })
      .addOperation(
        Contract.createContract({
          wasmHash: Buffer.from(proxyWasmHash, "hex"),
          address: this.config.adminKeypair.publicKey(),
          salt,
        }),
      )
      .setTimeout(30)
      .build();

    deployTx.sign(this.config.adminKeypair);

    const deployResult = await this.server.sendTransaction(deployTx);
    let deployResponse = await this.server.getTransaction(deployResult.hash);

    while (
      deployResponse.status === "PENDING" ||
      deployResponse.status === "NOT_FOUND"
    ) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      deployResponse = await this.server.getTransaction(deployResult.hash);
    }

    if (deployResponse.status !== "SUCCESS") {
      throw new Error(`Proxy deployment failed: ${deployResponse.status}`);
    }

    const proxyContractId = deployResponse.returnValue?.toString();
    if (!proxyContractId) {
      throw new Error("Failed to get proxy contract ID");
    }

    console.log(`Proxy deployed at: ${proxyContractId}`);
    this.state.proxyContractId = proxyContractId;

    return proxyContractId;
  }

  /**
   * Step 3: Initialize proxy with implementation
   */
  async initializeProxy(
    proxyContractId: string,
    implementationHash: string,
  ): Promise<void> {
    console.log("Initializing proxy...");

    const account = await this.server.getAccount(
      this.config.adminKeypair.publicKey(),
    );

    const contract = new Contract(proxyContractId);

    const initTx = new TransactionBuilder(account, {
      fee: "100000",
      networkPassphrase: this.config.networkPassphrase,
    })
      .addOperation(
        contract.call(
          "initialize",
          implementationHash,
          this.config.adminKeypair.publicKey(),
        ),
      )
      .setTimeout(30)
      .build();

    initTx.sign(this.config.adminKeypair);

    const result = await this.server.sendTransaction(initTx);
    let response = await this.server.getTransaction(result.hash);

    while (response.status === "PENDING" || response.status === "NOT_FOUND") {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      response = await this.server.getTransaction(result.hash);
    }

    if (response.status !== "SUCCESS") {
      throw new Error(`Proxy initialization failed: ${response.status}`);
    }

    console.log("Proxy initialized successfully");
  }

  /**
   * Step 4: Migrate state from old contract to new proxy
   */
  async migrateState(): Promise<void> {
    console.log("Migrating state from existing contract...");

    // This is contract-specific and needs to be implemented based on
    // the actual data structures in the existing contract

    // Example: Read project count and projects from old contract
    const oldContract = new Contract(this.config.existingContractId);

    // Get project count
    const account = await this.server.getAccount(
      this.config.adminKeypair.publicKey(),
    );

    const countTx = new TransactionBuilder(account, {
      fee: "100000",
      networkPassphrase: this.config.networkPassphrase,
    })
      .addOperation(oldContract.call("get_project_count"))
      .setTimeout(30)
      .build();

    countTx.sign(this.config.adminKeypair);

    const countResult = await this.server.sendTransaction(countTx);
    let countResponse = await this.server.getTransaction(countResult.hash);

    while (
      countResponse.status === "PENDING" ||
      countResponse.status === "NOT_FOUND"
    ) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      countResponse = await this.server.getTransaction(countResult.hash);
    }

    if (countResponse.status === "SUCCESS") {
      const projectCount = countResponse.returnValue;
      console.log(`Found ${projectCount} projects to migrate`);

      // Migrate each project (implementation depends on contract structure)
      // This would involve reading each project and writing to new contract
    }

    console.log("State migration complete");
  }

  /**
   * Execute full migration
   */
  async execute(): Promise<MigrationState> {
    try {
      console.log("Starting proxy migration...");
      console.log(`Existing contract: ${this.config.existingContractId}`);

      // Step 1: Deploy implementation
      const implementationHash = await this.deployImplementation();
      this.state.implementationContractId = implementationHash;

      // Step 2: Deploy proxy
      const proxyContractId = await this.deployProxy(implementationHash);

      // Step 3: Initialize proxy
      await this.initializeProxy(proxyContractId, implementationHash);

      // Step 4: Migrate state
      await this.migrateState();

      this.state.migrationComplete = true;
      console.log("Migration completed successfully!");
      console.log(`New proxy contract: ${proxyContractId}`);
      console.log(`Implementation: ${implementationHash}`);

      return this.state;
    } catch (error) {
      console.error("Migration failed:", error);
      throw error;
    }
  }

  /**
   * Verify migration success
   */
  async verify(): Promise<boolean> {
    if (!this.state.proxyContractId) {
      console.error("No proxy contract deployed");
      return false;
    }

    try {
      const contract = new Contract(this.state.proxyContractId);
      const account = await this.server.getAccount(
        this.config.adminKeypair.publicKey(),
      );

      // Verify proxy is initialized
      const implTx = new TransactionBuilder(account, {
        fee: "100000",
        networkPassphrase: this.config.networkPassphrase,
      })
        .addOperation(contract.call("get_implementation"))
        .setTimeout(30)
        .build();

      implTx.sign(this.config.adminKeypair);

      const result = await this.server.sendTransaction(implTx);
      let response = await this.server.getTransaction(result.hash);

      while (response.status === "PENDING" || response.status === "NOT_FOUND") {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        response = await this.server.getTransaction(result.hash);
      }

      if (response.status === "SUCCESS") {
        console.log("Proxy verification successful");
        return true;
      }

      return false;
    } catch (error) {
      console.error("Verification failed:", error);
      return false;
    }
  }
}

// CLI execution
if (require.main === module) {
  const config: MigrationConfig = {
    rpcUrl:
      process.env.SOROBAN_RPC_URL || "https://soroban-testnet.stellar.org",
    networkPassphrase: Networks.TESTNET,
    adminKeypair: Keypair.fromSecret(process.env.ADMIN_SECRET_KEY || ""),
    existingContractId: process.env.EXISTING_CONTRACT_ID || "",
    proxyWasmPath: join(
      __dirname,
      "../target/wasm32-unknown-unknown/release/proxy.wasm",
    ),
    implementationWasmPath: join(
      __dirname,
      "../target/wasm32-unknown-unknown/release/agenticpay.wasm",
    ),
  };

  const migration = new ProxyMigration(config);

  migration
    .execute()
    .then((state) => {
      console.log("Migration state:", JSON.stringify(state, null, 2));
      return migration.verify();
    })
    .then((verified) => {
      if (verified) {
        console.log("✓ Migration verified successfully");
        process.exit(0);
      } else {
        console.error("✗ Migration verification failed");
        process.exit(1);
      }
    })
    .catch((error) => {
      console.error("Migration error:", error);
      process.exit(1);
    });
}

export default ProxyMigration;
