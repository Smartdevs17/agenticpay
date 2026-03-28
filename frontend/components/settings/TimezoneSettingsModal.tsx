'use client';

import { useEffect, useMemo, useState } from 'react';
import { Clock3, LocateFixed } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  formatDateTimeInTimeZone,
  getBrowserTimeZone,
  isValidTimeZone,
  resolveTimeZone,
} from '@/lib/utils';
import { useAuthStore } from '@/store/useAuthStore';

interface TimezoneSettingsModalProps {
  open: boolean;
  onClose: () => void;
}

const TIMEZONE_DATALIST_ID = 'timezone-options';

function getSupportedTimeZones() {
  if (typeof Intl.supportedValuesOf !== 'function') {
    return [];
  }

  return Intl.supportedValuesOf('timeZone');
}

export function TimezoneSettingsModal({ open, onClose }: TimezoneSettingsModalProps) {
  const storedTimeZone = useAuthStore((state) => state.timezone);
  const setTimezone = useAuthStore((state) => state.setTimezone);
  const browserTimeZone = getBrowserTimeZone();
  const [localTimeZone, setLocalTimeZone] = useState<string>(resolveTimeZone(storedTimeZone));

  useEffect(() => {
    if (open) {
      setLocalTimeZone(resolveTimeZone(storedTimeZone));
    }
  }, [open, storedTimeZone]);

  const supportedTimeZones = useMemo(() => getSupportedTimeZones(), []);
  const previewTimeZone = resolveTimeZone(localTimeZone);

  const handleDetectTimezone = () => {
    const detectedTimeZone = resolveTimeZone(browserTimeZone);
    setLocalTimeZone(detectedTimeZone);
    toast.success(`Detected timezone: ${detectedTimeZone}`);
  };

  const handleSave = () => {
    if (!isValidTimeZone(localTimeZone)) {
      toast.error('Enter a valid IANA timezone such as Europe/London');
      return;
    }

    setTimezone(resolveTimeZone(localTimeZone));
    toast.success('Timezone preference saved');
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen: boolean) => !nextOpen && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Clock3 className="h-5 w-5 text-primary" />
            Timezone Settings
          </DialogTitle>
          <DialogDescription>
            Choose how dates and times are shown across your dashboard.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="rounded-lg border border-border bg-muted/30 p-4 text-sm">
            <p className="font-medium text-foreground">Detected timezone</p>
            <p className="mt-1 text-muted-foreground">
              {browserTimeZone ?? 'Unavailable in this browser'}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="timezone">Preferred timezone</Label>
            <Input
              id="timezone"
              list={TIMEZONE_DATALIST_ID}
              value={localTimeZone}
              onChange={(event) => setLocalTimeZone(event.target.value)}
              placeholder="e.g. America/New_York"
            />
            <datalist id={TIMEZONE_DATALIST_ID}>
              {supportedTimeZones.map((timeZone) => (
                <option key={timeZone} value={timeZone} />
              ))}
            </datalist>
            <p className="text-xs text-muted-foreground">
              Use a valid IANA timezone, like `Africa/Lagos` or `America/Los_Angeles`.
            </p>
          </div>

          <div className="rounded-lg border border-border p-4">
            <p className="text-sm font-medium text-foreground">Preview</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {formatDateTimeInTimeZone(new Date(), previewTimeZone)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">{previewTimeZone}</p>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button type="button" variant="outline" onClick={handleDetectTimezone}>
            <LocateFixed className="mr-2 h-4 w-4" />
            Use detected timezone
          </Button>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="button" onClick={handleSave}>
              Save timezone
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
