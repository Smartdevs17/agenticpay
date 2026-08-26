'use client';

import { useCallback, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

export interface CopyButtonProps {
  value: string;
  label?: string;
  className?: string;
  size?: 'icon' | 'sm';
  onCopied?: () => void;
}

export function CopyButton({
  value,
  label = 'Copied to clipboard',
  className,
  size = 'icon',
  onCopied,
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast.success(label);
      onCopied?.();
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Failed to copy');
    }
  }, [value, label, onCopied]);

  return (
    <Button
      type="button"
      variant="ghost"
      size={size === 'sm' ? 'sm' : 'icon'}
      className={cn('shrink-0', className)}
      onClick={handleCopy}
      aria-label={copied ? 'Copied' : 'Copy to clipboard'}
      title={copied ? 'Copied' : 'Copy'}
    >
      {copied ? (
        <Check className="h-3.5 w-3.5 text-green-600" aria-hidden />
      ) : (
        <Copy className="h-3.5 w-3.5" aria-hidden />
      )}
    </Button>
  );
}
