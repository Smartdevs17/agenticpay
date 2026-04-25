'use client';

import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, Usb, Shield, AlertTriangle, CheckCircle, XCircle } from 'lucide-react';
import HardwareWalletManager from '@/wallets/hardware/hardware-wallet-manager';
import { WalletType, TransactionSimulation, WalletConnectionState } from '@/wallets/hardware/types';

interface HardwareWalletConnectProps {
  onConnect?: (state: WalletConnectionState) => void;
  onDisconnect?: () => void;
  className?: string;
}

export function HardwareWalletConnect({ onConnect, onDisconnect, className }: HardwareWalletConnectProps) {
  const [manager] = useState(() => new HardwareWalletManager());
  const [connectionState, setConnectionState] = useState<WalletConnectionState>({
    isConnected: false,
    address: null,
    publicKey: null,
    deviceInfo: null,
    error: null
  });
  const [isConnecting, setIsConnecting] = useState(false);
  const [selectedWallet, setSelectedWallet] = useState<WalletType | null>(null);
  const [simulation, setSimulation] = useState<TransactionSimulation | null>(null);
  const [showSimulation, setShowSimulation] = useState(false);

  useEffect(() => {
    // Set up event listeners
    manager.addEventListener('connect', (event) => {
      setConnectionState({
        isConnected: true,
        address: event.payload.address,
        publicKey: event.payload.publicKey,
        deviceInfo: event.payload.deviceInfo,
        error: null
      });
      onConnect?.(connectionState);
    });

    manager.addEventListener('disconnect', () => {
      setConnectionState({
        isConnected: false,
        address: null,
        publicKey: null,
        deviceInfo: null,
        error: null
      });
      onDisconnect?.();
    });

    manager.addEventListener('error', (event) => {
      setConnectionState(prev => ({
        ...prev,
        error: event.payload.error
      }));
    });

    return () => {
      manager.disconnect();
    };
  }, [manager, onConnect, onDisconnect]);

  const handleConnect = async (walletType: WalletType) => {
    setIsConnecting(true);
    setSelectedWallet(walletType);
    setConnectionState(prev => ({ ...prev, error: null }));

    try {
      await manager.connect(walletType);
    } catch (error) {
      console.error('Connection failed:', error);
    } finally {
      setIsConnecting(false);
      setSelectedWallet(null);
    }
  };

  const handleDisconnect = async () => {
    try {
      await manager.disconnect();
    } catch (error) {
      console.error('Disconnect failed:', error);
    }
  };

  const handleSimulateTransaction = async () => {
    if (!manager.isConnected()) return;

    try {
      // Create a sample transaction for simulation
      const { transactionXDR, simulation } = await manager.createTransaction({
        to: 'GDQERSEYYQYJ5F4YH7LQF7XQ5Q7QQLQQLQQLQQLQQLQQLQQLQQLQQLQQLQ',
        amount: '100',
        asset: 'XLM',
        memo: 'Test transaction'
      });

      setSimulation(simulation);
      setShowSimulation(true);
    } catch (error) {
      console.error('Simulation failed:', error);
    }
  };

  const getWalletIcon = (type: WalletType) => {
    switch (type) {
      case WalletType.LEDGER:
        return <Usb className="w-6 h-6" />;
      case WalletType.TREZOR:
        return <Shield className="w-6 h-6" />;
      default:
        return <Usb className="w-6 h-6" />;
    }
  };

  const getWalletDescription = (type: WalletType) => {
    switch (type) {
      case WalletType.LEDGER:
        return 'Connect your Ledger Nano S/X device';
      case WalletType.TREZOR:
        return 'Connect your Trezor Model T/One device';
      default:
        return 'Connect your hardware wallet';
    }
  };

  return (
    <div className={className}>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="w-5 h-5" />
            Hardware Wallet Connection
          </CardTitle>
          <CardDescription>
            Connect your Ledger or Trezor device for secure transaction signing
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {connectionState.isConnected ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between p-4 bg-green-50 rounded-lg border border-green-200">
                <div className="flex items-center gap-3">
                  <CheckCircle className="w-5 h-5 text-green-600" />
                  <div>
                    <p className="font-medium text-green-900">Connected</p>
                    <p className="text-sm text-green-700">
                      {connectionState.deviceInfo?.model || 'Hardware Wallet'}
                    </p>
                  </div>
                </div>
                <Button variant="outline" onClick={handleDisconnect}>
                  Disconnect
                </Button>
              </div>

              <div className="space-y-2">
                <p className="text-sm font-medium">Wallet Address:</p>
                <p className="text-sm font-mono bg-gray-100 p-2 rounded">
                  {connectionState.address}
                </p>
              </div>

              <div className="space-y-2">
                <p className="text-sm font-medium">Public Key:</p>
                <p className="text-sm font-mono bg-gray-100 p-2 rounded break-all">
                  {connectionState.publicKey}
                </p>
              </div>

              {connectionState.deviceInfo && (
                <div className="space-y-2">
                  <p className="text-sm font-medium">Device Info:</p>
                  <div className="flex gap-2">
                    <Badge variant="secondary">
                      {connectionState.deviceInfo.model}
                    </Badge>
                    <Badge variant="outline">
                      v{connectionState.deviceInfo.version}
                    </Badge>
                  </div>
                </div>
              )}

              <div className="flex gap-2">
                <Button onClick={handleSimulateTransaction} variant="outline">
                  Test Transaction
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {connectionState.error && (
                <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>{connectionState.error}</AlertDescription>
                </Alert>
              )}

              <div className="grid gap-3">
                {manager.getAvailableProviders().map((walletType) => (
                  <Button
                    key={walletType}
                    variant="outline"
                    className="h-auto p-4 justify-start"
                    onClick={() => handleConnect(walletType)}
                    disabled={isConnecting && selectedWallet === walletType}
                  >
                    <div className="flex items-center gap-3">
                      {getWalletIcon(walletType)}
                      <div className="text-left">
                        <p className="font-medium">{walletType}</p>
                        <p className="text-sm text-muted-foreground">
                          {getWalletDescription(walletType)}
                        </p>
                      </div>
                    </div>
                    {isConnecting && selectedWallet === walletType && (
                      <Loader2 className="w-4 h-4 ml-auto animate-spin" />
                    )}
                  </Button>
                ))}
              </div>

              <div className="text-xs text-muted-foreground space-y-1">
                <p>• Make sure your device is unlocked and connected</p>
                <p>• Open the Stellar app on your device</p>
                <p>• Allow connection when prompted</p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Transaction Simulation Dialog */}
      <Dialog open={showSimulation} onOpenChange={setShowSimulation}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Transaction Simulation</DialogTitle>
            <DialogDescription>
              Preview of what will happen when you sign this transaction
            </DialogDescription>
          </DialogHeader>
          
          {simulation && (
            <div className="space-y-4">
              <div className="space-y-2">
                <h4 className="font-medium">Operations</h4>
                {simulation.operations.map((op, index) => (
                  <div key={index} className="p-3 bg-gray-50 rounded-lg">
                    <p className="text-sm font-medium">{op.description}</p>
                    <div className="text-xs text-muted-foreground mt-1">
                      <p>Type: {op.type}</p>
                      <p>Amount: {op.amount} {op.asset}</p>
                      {op.destination !== 'N/A' && (
                        <p>To: {op.destination}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <h4 className="font-medium">Fee</h4>
                  <p className="text-sm">{simulation.fee} stroops</p>
                </div>
                <div>
                  <h4 className="font-medium">Gas Estimate</h4>
                  <p className="text-sm">{simulation.gasEstimate} units</p>
                </div>
              </div>

              {simulation.warnings.length > 0 && (
                <div className="space-y-2">
                  <h4 className="font-medium text-yellow-600">Warnings</h4>
                  {simulation.warnings.map((warning, index) => (
                    <Alert key={index} variant="destructive">
                      <AlertTriangle className="h-4 w-4" />
                      <AlertDescription>{warning}</AlertDescription>
                    </Alert>
                  ))}
                </div>
              )}

              <div className="flex items-center gap-2">
                {simulation.requiresApproval ? (
                  <Badge variant="secondary">
                    <AlertTriangle className="w-3 h-3 mr-1" />
                    Requires Manual Approval
                  </Badge>
                ) : (
                  <Badge variant="outline">
                    <CheckCircle className="w-3 h-3 mr-1" />
                    Standard Transaction
                  </Badge>
                )}
                <Badge variant="outline">
                  ~{Math.round(simulation.estimatedTime / 1000)}s
                </Badge>
              </div>

              <div className="flex gap-2 pt-4">
                <Button onClick={() => setShowSimulation(false)} variant="outline">
                  Close
                </Button>
                <Button className="bg-green-600 hover:bg-green-700">
                  Sign Transaction
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default HardwareWalletConnect;
