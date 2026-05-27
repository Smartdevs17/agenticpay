'use client';

import { useEffect, useRef, useState } from 'react';
import { Camera, CameraOff, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

interface QRScannerProps {
  onScan: (url: string) => void;
}

// Dynamically import jsQR to avoid SSR issues
async function decodeQR(imageData: ImageData): Promise<string | null> {
  const jsQR = (await import('jsqr')).default;
  const result = jsQR(imageData.data, imageData.width, imageData.height);
  return result?.data ?? null;
}

export function QRScanner({ onScan }: QRScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);
  const [active, setActive] = useState(false);
  const [loading, setLoading] = useState(false);

  const stopCamera = () => {
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setActive(false);
  };

  const startCamera = async () => {
    setLoading(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setActive(true);
      scan();
    } catch {
      toast.error('Camera access denied or unavailable.');
    } finally {
      setLoading(false);
    }
  };

  const scan = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const tick = async () => {
      if (video.readyState === video.HAVE_ENOUGH_DATA) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const result = await decodeQR(imageData);
        if (result) {
          stopCamera();
          onScan(result);
          return;
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
  };

  useEffect(() => () => stopCamera(), []);

  return (
    <div className="space-y-4">
      {active ? (
        <div className="relative rounded-xl overflow-hidden border border-gray-200 bg-black">
          <video ref={videoRef} className="w-full max-h-64 object-cover" muted playsInline />
          <canvas ref={canvasRef} className="hidden" />
          {/* Scan overlay */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-48 h-48 border-2 border-white/70 rounded-lg" />
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={stopCamera}
            className="absolute top-2 right-2"
          >
            <CameraOff className="h-4 w-4" />
          </Button>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center gap-3 p-8 rounded-xl border-2 border-dashed border-gray-200 bg-gray-50">
          <Camera className="h-10 w-10 text-gray-400" />
          <p className="text-sm text-gray-500">Point your camera at a payment QR code</p>
          <Button onClick={startCamera} disabled={loading} className="flex items-center gap-2">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
            {loading ? 'Starting camera…' : 'Start Scanner'}
          </Button>
        </div>
      )}
      {/* Hidden canvas for frame capture */}
      {!active && <canvas ref={canvasRef} className="hidden" />}
    </div>
  );
}
