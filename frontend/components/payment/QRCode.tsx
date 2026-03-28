'use client';

import { useRef } from 'react';
import { QRCodeCanvas } from 'qrcode.react';
import { Download, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface PaymentQRModalProps {
  address: string;
  isOpen: boolean;
  onClose: () => void;
}

export function PaymentQRModal({ address, isOpen, onClose }: PaymentQRModalProps) {
  const qrRef = useRef<HTMLDivElement>(null);

  // If the modal isn't triggered, don't render anything
  if (!isOpen) return null;

  // Handles the "Allow download" acceptance criteria
  const handleDownload = () => {
    const canvas = qrRef.current?.querySelector('canvas');
    if (canvas) {
      const pngUrl = canvas
        .toDataURL('image/png')
        .replace('image/png', 'image/octet-stream');
      const downloadLink = document.createElement('a');
      downloadLink.href = pngUrl;
      downloadLink.download = `agenticpay-address-${address.slice(0, 6)}.png`;
      document.body.appendChild(downloadLink);
      downloadLink.click();
      document.body.removeChild(downloadLink);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="relative w-full max-w-sm bg-white rounded-2xl shadow-2xl p-6 m-4 animate-in fade-in zoom-in duration-200">
        
        {/* Close Button */}
        <button 
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 transition-colors"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="text-center mb-6">
          <h2 className="text-xl font-bold text-gray-900">Payment Address</h2>
          <p className="text-sm text-gray-500 mt-1">Scan to send funds</p>
        </div>

        {/* QR Code Container */}
        <div 
          ref={qrRef} 
          className="flex justify-center bg-gray-50 p-6 rounded-xl border border-gray-100 mb-6"
        >
          <QRCodeCanvas 
            value={address}
            size={200}
            bgColor={"#f9fafb"} 
            fgColor={"#111827"} 
            level={"H"}
            includeMargin={false}
          />
        </div>

        {/* Address Display & Download Button */}
        <div className="flex flex-col gap-3">
          <div className="bg-gray-100 p-3 rounded-lg flex items-center justify-center">
            <code className="text-xs text-gray-600 font-mono break-all text-center">
              {address}
            </code>
          </div>
          
          <Button onClick={handleDownload} className="w-full flex items-center gap-2">
            <Download className="h-4 w-4" />
            Download QR Code
          </Button>
        </div>

      </div>
    </div>
  );
}