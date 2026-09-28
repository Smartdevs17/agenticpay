'use client';

import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { QrCode, ScanLine, Wifi } from 'lucide-react';
import { useAuthStore } from '@/store/useAuthStore';
import { QRPaymentRequest } from '@/components/payment/QRPaymentRequest';
import { QRScanner } from '@/components/payment/QRScanner';
import { NFCReader } from '@/components/payment/NFCReader';
import { PaymentConfirmDialog, ParsedPayment } from '@/components/payment/PaymentConfirmDialog';
import { toast } from 'sonner';

function parsePaymentUrl(url: string): ParsedPayment | null {
  try {
    if (!url.startsWith('web+stellar:pay?')) return null;
    const params = new URLSearchParams(url.replace('web+stellar:pay?', ''));
    const destination = params.get('destination');
    if (!destination) return null;
    return {
      destination,
      amount: params.get('amount'),
      currency: params.get('currency') ?? 'XLM',
      memo: params.get('memo'),
      label: params.get('label'),
    };
  } catch {
    return null;
  }
}

export default function QRPaymentPage() {
  const address = useAuthStore((s) => s.address);
  const [pendingPayment, setPendingPayment] = useState<ParsedPayment | null>(null);

  const handleScanned = (url: string) => {
    const parsed = parsePaymentUrl(url);
    if (!parsed) {
      toast.error('Invalid or unsupported QR code.');
      return;
    }
    setPendingPayment(parsed);
  };

  const handleConfirm = (payment: ParsedPayment) => {
    // In a real app, this would trigger the wallet/signing flow
    toast.success(`Payment to ${payment.destination.slice(0, 8)}… initiated.`);
    setPendingPayment(null);
  };

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">QR & NFC Payments</h1>
        <p className="text-gray-600 mt-1">Generate a payment request or scan to pay in person.</p>
      </div>

      <Tabs defaultValue="receive">
        <TabsList className="grid grid-cols-3 w-full">
          <TabsTrigger value="receive" className="flex items-center gap-2">
            <QrCode className="h-4 w-4" />
            Receive
          </TabsTrigger>
          <TabsTrigger value="scan" className="flex items-center gap-2">
            <ScanLine className="h-4 w-4" />
            Scan QR
          </TabsTrigger>
          <TabsTrigger value="nfc" className="flex items-center gap-2">
            <Wifi className="h-4 w-4" />
            NFC
          </TabsTrigger>
        </TabsList>

        {/* Receive tab – generate QR + write NFC */}
        <TabsContent value="receive">
          <Card>
            <CardHeader>
              <CardTitle>Payment Request</CardTitle>
            </CardHeader>
            <CardContent>
              {address ? (
                <QRPaymentRequest address={address} />
              ) : (
                <p className="text-sm text-gray-500">Connect your wallet to generate a payment request.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Scan QR tab */}
        <TabsContent value="scan">
          <Card>
            <CardHeader>
              <CardTitle>Scan QR Code</CardTitle>
            </CardHeader>
            <CardContent>
              <QRScanner onScan={handleScanned} />
            </CardContent>
          </Card>
        </TabsContent>

        {/* NFC read tab */}
        <TabsContent value="nfc">
          <Card>
            <CardHeader>
              <CardTitle>NFC Tap to Pay</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-gray-500">
                Tap an NFC-enabled payment tag to read the payment request.
              </p>
              <NFCReader onRead={handleScanned} />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Confirmation dialog */}
      <PaymentConfirmDialog
        payment={pendingPayment}
        onConfirm={handleConfirm}
        onCancel={() => setPendingPayment(null)}
      />
    </div>
  );
}
