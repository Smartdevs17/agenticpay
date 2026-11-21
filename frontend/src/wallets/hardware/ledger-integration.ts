import { TransportWebUSB } from '@ledgerhq/hw-transport-webusb';
import { Stellar } from '@ledgerhq/hw-stellar';
import { Transaction, Networks, Operation, Asset } from '@stellar/stellar-sdk';
import { HardwareWalletProvider, TransactionSimulation, WalletType } from './types';

/**
 * Ledger Hardware Wallet Integration
 * Provides secure transaction signing with transaction simulation
 */

export class LedgerWalletProvider implements HardwareWalletProvider {
  private transport: TransportWebUSB | null = null;
  private stellar: Stellar | null = null;
  private connected = false;
  private address: string | null = null;
  private publicKey: string | null = null;

  readonly type = WalletType.LEDGER;
  readonly name = 'Ledger';
  readonly icon = '/icons/ledger.svg';

  /**
   * Initialize Ledger connection
   */
  async initialize(): Promise<void> {
    try {
      // Request WebUSB transport
      this.transport = await TransportWebUSB.create();
      this.stellar = new Stellar(this.transport);
      this.connected = true;
      
      console.log('✅ Ledger initialized successfully');
    } catch (error) {
      console.error('❌ Failed to initialize Ledger:', error);
      throw new Error('Failed to connect to Ledger device');
    }
  }

  /**
   * Connect to Ledger device and get address
   */
  async connect(): Promise<{ address: string; publicKey: string }> {
    if (!this.transport || !this.stellar) {
      await this.initialize();
    }

    try {
      // Get public key from Ledger
      const result = await this.stellar!.getAddress("44'/148'/0'", false, false);
      this.address = result.address;
      this.publicKey = result.publicKey;
      this.connected = true;

      return {
        address: this.address,
        publicKey: this.publicKey
      };
    } catch (error) {
      console.error('❌ Failed to connect to Ledger:', error);
      throw new Error('Failed to get address from Ledger device');
    }
  }

  /**
   * Disconnect from Ledger device
   */
  async disconnect(): Promise<void> {
    if (this.transport) {
      await this.transport.close();
      this.transport = null;
      this.stellar = null;
      this.connected = false;
      this.address = null;
      this.publicKey = null;
    }
  }

  /**
   * Check if wallet is connected
   */
  isConnected(): boolean {
    return this.connected && !!this.address;
  }

  /**
   * Get wallet address
   */
  async getAddress(): Promise<string> {
    if (!this.address) {
      throw new Error('Wallet not connected');
    }
    return this.address;
  }

  /**
   * Get wallet public key
   */
  async getPublicKey(): Promise<string> {
    if (!this.publicKey) {
      throw new Error('Wallet not connected');
    }
    return this.publicKey;
  }

  /**
   * Sign transaction with Ledger
   */
  async signTransaction(transactionXDR: string, networkPassphrase: string): Promise<string> {
    if (!this.transport || !this.stellar) {
      throw new Error('Ledger not connected');
    }

    try {
      // Parse the transaction
      const transaction = new Transaction(transactionXDR, networkPassphrase);
      
      // Sign with Ledger
      const signature = await this.stellar.signTransaction(
        "44'/148'/0'",
        transaction.signatureBase()
      );

      // Add signature to transaction
      transaction.addSignature(this.publicKey!, signature.signature);

      return transaction.toXDR();
    } catch (error) {
      console.error('❌ Failed to sign transaction:', error);
      throw new Error('Failed to sign transaction with Ledger');
    }
  }

  /**
   * Simulate transaction before signing
   */
  async simulateTransaction(transactionXDR: string, networkPassphrase: string): Promise<TransactionSimulation> {
    try {
      const transaction = new Transaction(transactionXDR, networkPassphrase);
      
      // Parse operations
      const operations = transaction.operations.map(op => ({
        type: op.type,
        source: op.source ? op.source : this.address,
        destination: this.getOperationDestination(op),
        amount: this.getOperationAmount(op),
        asset: this.getOperationAsset(op),
        description: this.getOperationDescription(op)
      }));

      // Calculate gas fees
      const baseFee = transaction.fee;
      const operationsCount = transaction.operations.length;
      const totalFee = baseFee * operationsCount;

      // Get current sequence number
      const sequence = transaction.sequence;

      // Estimate gas usage
      const gasEstimate = await this.estimateGasUsage(transaction);

      return {
        operations,
        fee: totalFee.toString(),
        gasEstimate,
        sequence: sequence.toString(),
        networkPassphrase,
        warnings: this.generateWarnings(operations),
        requiresApproval: this.requiresApproval(operations),
        estimatedTime: this.estimateTransactionTime(operations)
      };
    } catch (error) {
      console.error('❌ Failed to simulate transaction:', error);
      throw new Error('Failed to simulate transaction');
    }
  }

  /**
   * Get operation destination
   */
  private getOperationDestination(operation: Operation): string {
    if (operation.type === 'payment') {
      return operation.destination;
    }
    return 'N/A';
  }

  /**
   * Get operation amount
   */
  private getOperationAmount(operation: Operation): string {
    if (operation.type === 'payment') {
      return operation.amount;
    }
    return '0';
  }

  /**
   * Get operation asset
   */
  private getOperationAsset(operation: Operation): string {
    if (operation.type === 'payment') {
      if (operation.asset instanceof Asset) {
        return operation.asset.code;
      }
      return 'XLM';
    }
    return 'N/A';
  }

  /**
   * Get operation description
   */
  private getOperationDescription(operation: Operation): string {
    switch (operation.type) {
      case 'payment':
        return `Send ${operation.amount} ${this.getOperationAsset(operation)} to ${operation.destination}`;
      case 'createAccount':
        return `Create account with ${operation.startingBalance} XLM`;
      case 'setOptions':
        return 'Update account options';
      case 'manageData':
        return `Manage data: ${operation.name}`;
      default:
        return `${operation.type} operation`;
    }
  }

  /**
   * Estimate gas usage for transaction
   */
  private async estimateGasUsage(transaction: Transaction): Promise<number> {
    // Base gas estimation for Stellar transactions
    const baseGas = 10000;
    const operationGas = transaction.operations.length * 5000;
    const dataGas = transaction.memo ? 1000 : 0;
    
    return baseGas + operationGas + dataGas;
  }

  /**
   * Generate warnings for transaction
   */
  private generateWarnings(operations: any[]): string[] {
    const warnings: string[] = [];

    // Check for large amounts
    operations.forEach(op => {
      if (op.type === 'payment') {
        const amount = parseFloat(op.amount);
        if (amount > 10000) {
          warnings.push(`Large payment detected: ${op.amount} ${op.asset}`);
        }
        
        // Check for unknown assets
        if (op.asset !== 'XLM' && !this.isKnownAsset(op.asset)) {
          warnings.push(`Payment in unknown asset: ${op.asset}`);
        }
      }
    });

    // Check for multiple operations
    if (operations.length > 5) {
      warnings.push('Transaction contains many operations');
    }

    return warnings;
  }

  /**
   * Check if asset is known
   */
  private isKnownAsset(assetCode: string): boolean {
    const knownAssets = ['XLM', 'USDC', 'EURT', 'BTC', 'ETH'];
    return knownAssets.includes(assetCode);
  }

  /**
   * Check if transaction requires explicit approval
   */
  private requiresApproval(operations: any[]): boolean {
    return operations.some(op => {
      if (op.type === 'payment') {
        const amount = parseFloat(op.amount);
        return amount > 1000 || op.asset !== 'XLM';
      }
      return op.type !== 'payment';
    });
  }

  /**
   * Estimate transaction time
   */
  private estimateTransactionTime(operations: any[]): number {
    // Base time plus per-operation time
    const baseTime = 5000; // 5 seconds
    const perOperationTime = 2000; // 2 seconds per operation
    
    return baseTime + (operations.length * perOperationTime);
  }

  /**
   * Get device info
   */
  async getDeviceInfo(): Promise<{ version: string; model: string }> {
    if (!this.transport || !this.stellar) {
      throw new Error('Ledger not connected');
    }

    try {
      const appConfig = await this.stellar.getAppConfig();
      return {
        version: appConfig.version,
        model: 'Ledger Nano S/X'
      };
    } catch (error) {
      console.error('❌ Failed to get device info:', error);
      return {
        version: 'Unknown',
        model: 'Ledger'
      };
    }
  }

  /**
   * Check if device supports app
   */
  async checkAppSupport(): Promise<boolean> {
    if (!this.stellar) {
      return false;
    }

    try {
      const appConfig = await this.stellar.getAppConfig();
      return appConfig.version !== '0.0.0';
    } catch (error) {
      return false;
    }
  }
}

export default LedgerWalletProvider;
