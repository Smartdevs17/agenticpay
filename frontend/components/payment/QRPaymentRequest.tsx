'use client';

import { useState, useRef, useCallback } from 'react';
import { QRCodeCanvas } from 'qrcode.react';
import { Download, Copy, Check, Wifi, WifiOff, Smartphone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';

interface QRPaymentRequestProps {
  address: string;
}

function buildPaymentUrl(address: string, amount: string, currency: string, memo: string): string {
  const params = new URLSearchParams({ currency });
  if (amount) params.set('amount', amount);
  if (memo) params.set('memo', memo);
  return `web+stellar:pay?destination=${address}&${params.toString()}`;
}

export function QRPaymentRequest({ address }: QRPaymentRequestProps) {
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('XLM');
  const [memo, setMemo] = useState('');
  const [fgColor, setFgColor] = useState('#111827');
  const [bgColor, setBgColor] = useState('#ffffff');
  const [copied, setCopied] = useState(false);
  const [nfcStatus, setNfcStatus] = useState<'idle' | 'writing' | 'success' | 'error' | 'unsupported'>('idle');
  const qrRef = useRef<HTMLDivElement>(null);

  const paymentUrl = buildPaymentUrl(address, amount, currency, memo);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(paymentUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const canvas = qrRef.current?.querySelector('canvas');
    if (!canvas) return;
    const url = canvas.toDataURL('image/png').replace('image/png', 'image/octet-stream');
    const a = document.createElement('a');
    a.href = url;
    a.download = `payment-qr-${address.slice(0, 8)}.png`;
    a.click();
  };

  const handleNfcWrite = useCallback(async () => {
    if (!('NDEFReader' in window)) {
      setNfcStatus('unsupported');
      toast.error('NFC is not supported on this device/browser.');
      return;
    }

    setNfcStatus('writing');
    try {
      // @ts-ignore – NDEFReader is not yet in TS lib
      const ndef = new window.NDEFReader();
      await ndef.write({
        records: [{ recordType: 'url', data: paymentUrl }],
      });
      setNfcStatus('success');
      toast.success('NFC tag written successfully.');
    } catch (err: any) {
      setNfcStatus('error');
      toast.error(`NFC write failed: ${err?.message ?? 'Unknown error'}`);
    }
  }, [paymentUrl]);

  return (
    <div className="space-y-6">
      {/* Amount & Memo inputs */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="space-y-1">
          <Label htmlFor="amount">Amount (optional)</Label>
          <Input
            id="amount"
            type="number"
            min="0"
            step="any"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="currency">Currency</Label>
          <Input
            id="currency"
            placeholder="XLM"
            value={currency}
            onChange={(e) => setCurrency(e.target.value.toUpperCase())}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="memo">Memo (optional)</Label>
          <Input
            id="memo"
            placeholder="Invoice #123"
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
          />
        </div>
      </div>

      {/* Style customization */}
      <div className="flex items-center gap-6">
        <div className="flex items-center gap-2">
          <Label htmlFor="fgColor">QR Color</Label>
          <input
            id="fgColor"
            type="color"
            value={fgColor}
            onChange={(e) => setFgColor(e.target.value)}
            className="w-8 h-8 rounded cursor-pointer border border-gray-200"
          />
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor="bgColor">Background</Label>
          <input
            id="bgColor"
            type="color"
            value={bgColor}
            onChange={(e) => setBgColor(e.target.value)}
            className="w-8 h-8 rounded cursor-pointer border border-gray-200"
          />
        </div>
      </div>

      {/* QR Code */}
      <div
        ref={qrRef}
        className="flex justify-center p-6 rounded-xl border border-gray-100 bg-gray-50"
        style={{ backgroundColor: bgColor }}
      >
        <QRCodeCanvas
          value={paymentUrl}
          size={220}
          bgColor={bgColor}
          fgColor={fgColor}
          level="H"
          includeMargin={false}
        />
      </div>

      {/* Payment URL display */}
      <div className="bg-gray-100 p-3 rounded-lg">
        <code className="text-xs text-gray-600 font-mono break-all">{paymentUrl}</code>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap gap-3">
        <Button variant="outline" onClick={handleCopy} className="flex items-center gap-2">
          {copied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
          {copied ? 'Copied' : 'Copy URL'}
        </Button>

        <Button variant="outline" onClick={handleDownload} className="flex items-center gap-2">
          <Download className="h-4 w-4" />
          Download QR
        </Button>

        <Button
          onClick={handleNfcWrite}
          disabled={nfcStatus === 'writing'}
          className="flex items-center gap-2"
        >
          {nfcStatus === 'writing' ? (
            <Wifi className="h-4 w-4 animate-pulse" />
          ) : nfcStatus === 'success' ? (
            <Check className="h-4 w-4 text-green-400" />
          ) : nfcStatus === 'unsupported' ? (
            <WifiOff className="h-4 w-4" />
          ) : (
            <Smartphone className="h-4 w-4" />
          )}
          {nfcStatus === 'writing'
            ? 'Hold tag near device…'
            : nfcStatus === 'success'
            ? 'Tag Written'
            : 'Write NFC Tag'}
        </Button>
      </div>

      {nfcStatus === 'unsupported' && (
        <p className="text-sm text-amber-600">
          NFC is not available. Use the QR code or share the payment URL instead.
        </p>
      )}
    </div>
  );
}
