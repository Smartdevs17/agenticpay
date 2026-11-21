import { HardwareWalletProvider, WalletType, TransactionSimulation, WalletConnectionState, TransactionStatus, WalletEvent } from './types';
import LedgerWalletProvider from './ledger-integration';
import TrezorWalletProvider from './trezor-integration';
import { Transaction, Networks, Horizon } from '@stellar/stellar-sdk';

/**
 * Hardware Wallet Manager
 * Manages multiple hardware wallet connections and provides unified interface
 */

export class HardwareWalletManager {
  private providers: Map<WalletType, HardwareWalletProvider> = new Map();
  private activeProvider: HardwareWalletProvider | null = null;
  private eventListeners: Map<string, ((event: WalletEvent) => void)[]> = new Map();
  private connectionState: WalletConnectionState = {
    isConnected: false,
    address: null,
    publicKey: null,
    deviceInfo: null,
    error: null
  };

  constructor() {
    this.initializeProviders();
  }

  /**
   * Initialize all hardware wallet providers
   */
  private initializeProviders(): void {
    this.providers.set(WalletType.LEDGER, new LedgerWalletProvider());
    this.providers.set(WalletType.TREZOR, new TrezorWalletProvider());
  }

  /**
   * Get available wallet providers
   */
  getAvailableProviders(): WalletType[] {
    return Array.from(this.providers.keys());
  }

  /**
   * Get provider by type
   */
  getProvider(type: WalletType): HardwareWalletProvider | undefined {
    return this.providers.get(type);
  }

  /**
   * Connect to hardware wallet
   */
  async connect(type: WalletType): Promise<WalletConnectionState> {
    const provider = this.providers.get(type);
    if (!provider) {
      throw new Error(`Unsupported wallet type: ${type}`);
    }

    try {
      // Initialize provider
      await provider.initialize();
      
      // Connect to device
      const { address, publicKey } = await provider.connect();
      
      // Get device info
      const deviceInfo = await provider.getDeviceInfo();
      
      // Update state
      this.activeProvider = provider;
      this.connectionState = {
        isConnected: true,
        address,
        publicKey,
        deviceInfo,
        error: null
      };

      // Emit connect event
      this.emitEvent('connect', { type, address, publicKey, deviceInfo });

      return { ...this.connectionState };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Connection failed';
      
      this.connectionState.error = errorMessage;
      this.emitEvent('error', { type, error: errorMessage });
      
      throw error;
    }
  }

  /**
   * Disconnect from hardware wallet
   */
  async disconnect(): Promise<void> {
    if (this.activeProvider) {
      try {
        await this.activeProvider.disconnect();
      } catch (error) {
        console.error('Error disconnecting wallet:', error);
      }

      this.activeProvider = null;
      this.connectionState = {
        isConnected: false,
        address: null,
        publicKey: null,
        deviceInfo: null,
        error: null
      };

      this.emitEvent('disconnect', {});
    }
  }

  /**
   * Get current connection state
   */
  getConnectionState(): WalletConnectionState {
    return { ...this.connectionState };
  }

  /**
   * Check if wallet is connected
   */
  isConnected(): boolean {
    return this.connectionState.isConnected && !!this.activeProvider;
  }

  /**
   * Get current wallet address
   */
  async getAddress(): Promise<string> {
    if (!this.activeProvider) {
      throw new Error('No wallet connected');
    }
    return this.activeProvider.getAddress();
  }

  /**
   * Get current wallet public key
   */
  async getPublicKey(): Promise<string> {
    if (!this.activeProvider) {
      throw new Error('No wallet connected');
    }
    return this.activeProvider.getPublicKey();
  }

  /**
   * Create and simulate transaction
   */
  async createTransaction(params: {
    to: string;
    amount: string;
    asset?: string;
    memo?: string;
    networkPassphrase?: string;
  }): Promise<{ transactionXDR: string; simulation: TransactionSimulation }> {
    if (!this.activeProvider) {
      throw new Error('No wallet connected');
    }

    const networkPassphrase = params.networkPassphrase || Networks.TESTNET;
    const sourceAddress = await this.activeProvider.getAddress();
    
    // Create transaction
    const account = await this.getAccountInfo(sourceAddress);
    const transaction = new TransactionBuilder(account, {
      fee: '100',
      networkPassphrase
    });

    // Add payment operation
    transaction.addOperation(Operation.payment({
      destination: params.to,
      asset: params.asset ? new Asset(params.asset, 'G...') : Asset.native(),
      amount: params.amount
    }));

    // Add memo if provided
    if (params.memo) {
      transaction.addMemo(Memo.text(params.memo));
    }

    // Build transaction
    const builtTransaction = transaction.setTimeout(30).build();
    const transactionXDR = builtTransaction.toXDR();

    // Simulate transaction
    const simulation = await this.activeProvider.simulateTransaction(transactionXDR, networkPassphrase);

    return { transactionXDR, simulation };
  }

  /**
   * Sign and submit transaction
   */
  async signAndSubmitTransaction(transactionXDR: string, networkPassphrase?: string): Promise<TransactionStatus> {
    if (!this.activeProvider) {
      throw new Error('No wallet connected');
    }

    try {
      const network = networkPassphrase || Networks.TESTNET;
      
      // Sign transaction
      const signedXDR = await this.activeProvider.signTransaction(transactionXDR, network);
      
      // Submit to network
      const horizon = new Horizon.Server('https://horizon-testnet.stellar.org');
      const transaction = new Transaction(signedXDR, network);
      
      const result = await horizon.submitTransaction(transaction);
      
      const status: TransactionStatus = {
        hash: result.hash,
        status: result.successful ? 'success' : 'failed',
        timestamp: Date.now(),
        error: result.successful ? undefined : 'Transaction failed'
      };

      this.emitEvent('transaction', { status, transaction: result });
      
      return status;
    } catch (error) {
      const status: TransactionStatus = {
        hash: '',
        status: 'failed',
        timestamp: Date.now(),
        error: error instanceof Error ? error.message : 'Transaction failed'
      };

      this.emitEvent('transaction', { status, error });
      
      throw error;
    }
  }

  /**
   * Get account info from Horizon
   */
  private async getAccountInfo(address: string): Promise<any> {
    const horizon = new Horizon.Server('https://horizon-testnet.stellar.org');
    return await horizon.loadAccount(address);
  }

  /**
   * Simulate transaction without signing
   */
  async simulateTransaction(transactionXDR: string, networkPassphrase?: string): Promise<TransactionSimulation> {
    if (!this.activeProvider) {
      throw new Error('No wallet connected');
    }

    return this.activeProvider.simulateTransaction(transactionXDR, networkPassphrase || Networks.TESTNET);
  }

  /**
   * Get device information
   */
  async getDeviceInfo(): Promise<{ version: string; model: string } | null> {
    if (!this.activeProvider) {
      return null;
    }

    return this.activeProvider.getDeviceInfo();
  }

  /**
   * Check if device app is supported
   */
  async checkAppSupport(): Promise<boolean> {
    if (!this.activeProvider) {
      return false;
    }

    return this.activeProvider.checkAppSupport();
  }

  /**
   * Add event listener
   */
  addEventListener(event: string, listener: (event: WalletEvent) => void): void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, []);
    }
    this.eventListeners.get(event)!.push(listener);
  }

  /**
   * Remove event listener
   */
  removeEventListener(event: string, listener: (event: WalletEvent) => void): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      const index = listeners.indexOf(listener);
      if (index > -1) {
        listeners.splice(index, 1);
      }
    }
  }

  /**
   * Emit event to listeners
   */
  private emitEvent(type: string, payload: any): void {
    const event: WalletEvent = { type, payload };
    const listeners = this.eventListeners.get(type);
    
    if (listeners) {
      listeners.forEach(listener => {
        try {
          listener(event);
        } catch (error) {
          console.error('Error in event listener:', error);
        }
      });
    }
  }

  /**
   * Get transaction history
   */
  async getTransactionHistory(limit: number = 10): Promise<TransactionStatus[]> {
    if (!this.activeProvider) {
      throw new Error('No wallet connected');
    }

    const address = await this.activeProvider.getAddress();
    const horizon = new Horizon.Server('https://horizon-testnet.stellar.org');
    
    try {
      const transactions = await horizon
        .transactions()
        .forAccount(address)
        .order('desc')
        .limit(limit)
        .call();

      return transactions.records.map(record => ({
        hash: record.hash,
        status: record.successful ? 'success' : 'failed',
        timestamp: new Date(record.created_at).getTime(),
        error: record.successful ? undefined : 'Transaction failed'
      }));
    } catch (error) {
      console.error('Error fetching transaction history:', error);
      return [];
    }
  }

  /**
   * Get account balance
   */
  async getBalance(): Promise<{ asset: string; balance: string }[]> {
    if (!this.activeProvider) {
      throw new Error('No wallet connected');
    }

    const address = await this.activeProvider.getAddress();
    const horizon = new Horizon.Server('https://horizon-testnet.stellar.org');
    
    try {
      const account = await horizon.loadAccount(address);
      
      return account.balances.map(balance => ({
        asset: balance.asset_type === 'native' ? 'XLM' : balance.asset_code || 'Unknown',
        balance: balance.balance
      }));
    } catch (error) {
      console.error('Error fetching balance:', error);
      return [];
    }
  }

  /**
   * Validate address format
   */
  validateAddress(address: string): boolean {
    // Stellar address validation (G-prefixed public key)
    return /^G[A-Z0-9]{55}$/.test(address);
  }

  /**
   * Get supported networks
   */
  getSupportedNetworks(): string[] {
    return ['Testnet', 'Public'];
  }

  /**
   * Switch network
   */
  async switchNetwork(network: string): Promise<void> {
    // For Stellar, network switching is handled at the transaction level
    // This method is for compatibility with other wallet interfaces
    console.log(`Switching to ${network} network`);
  }
}

export default HardwareWalletManager;
