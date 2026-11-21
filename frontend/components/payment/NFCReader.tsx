'use client';

import { useEffect, useRef, useState } from 'react';
import { Wifi, WifiOff, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

interface NFCReaderProps {
  onRead: (url: string) => void;
}

export function NFCReader({ onRead }: NFCReaderProps) {
  const [status, setStatus] = useState<'idle' | 'scanning' | 'unsupported'>('idle');
  const readerRef = useRef<any>(null);

  const supported = typeof window !== 'undefined' && 'NDEFReader' in window;

  const startScan = async () => {
    if (!supported) {
      setStatus('unsupported');
      return;
    }
    setStatus('scanning');
    try {
      // @ts-ignore
      const ndef = new window.NDEFReader();
      readerRef.current = ndef;

      await ndef.scan();

      ndef.addEventListener('reading', ({ message }: any) => {
        for (const record of message.records) {
          if (record.recordType === 'url') {
            const decoder = new TextDecoder();
            const url = decoder.decode(record.data);
            setStatus('idle');
            onRead(url);
            return;
          }
        }
        toast.error('NFC tag does not contain a payment URL.');
        setStatus('idle');
      });

      ndef.addEventListener('readingerror', () => {
        toast.error('Could not read NFC tag.');
        setStatus('idle');
      });
    } catch (err: any) {
      toast.error(`NFC scan failed: ${err?.message ?? 'Unknown error'}`);
      setStatus('idle');
    }
  };

  const stopScan = () => {
    readerRef.current = null;
    setStatus('idle');
  };

  // Cleanup on unmount
  useEffect(() => () => { readerRef.current = null; }, []);

  if (!supported) {
    return (
      <div className="flex items-center gap-2 text-sm text-amber-600 p-3 bg-amber-50 rounded-lg border border-amber-200">
        <WifiOff className="h-4 w-4 shrink-0" />
        NFC is not supported on this device or browser.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {status === 'scanning' ? (
        <div className="flex flex-col items-center gap-3 p-6 rounded-xl border-2 border-dashed border-blue-200 bg-blue-50">
          <Wifi className="h-10 w-10 text-blue-500 animate-pulse" />
          <p className="text-sm text-blue-700 font-medium">Hold an NFC tag near your device…</p>
          <Button variant="outline" size="sm" onClick={stopScan}>Cancel</Button>
        </div>
      ) : (
        <Button onClick={startScan} variant="outline" className="flex items-center gap-2 w-full">
          <Wifi className="h-4 w-4" />
          Scan NFC Tag
        </Button>
      )}
    </div>
  );
}
