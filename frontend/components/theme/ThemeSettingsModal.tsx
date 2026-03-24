'use client';

import { useState, type ReactNode } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { useThemeStore, ThemeMode } from '@/store/useThemeStore';
import { Clock, Sun, SunMoon, MapPin, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

interface ThemeSettingsModalProps {
  open: boolean;
  onClose: () => void;
}

function pad(n: number) {
  return String(n).padStart(2, '0');
}

function toTimeString(hour: number) {
  return `${pad(hour)}:00`;
}

function fromTimeString(value: string): number {
  return parseInt(value.split(':')[0], 10);
}

export function ThemeSettingsModal({ open, onClose }: ThemeSettingsModalProps) {
  const { mode, startHour, endHour, latitude, longitude, setMode, setSchedule, setLocation } =
    useThemeStore();

  const [localMode, setLocalMode] = useState<ThemeMode>(mode);
  const [localStart, setLocalStart] = useState(toTimeString(startHour));
  const [localEnd, setLocalEnd] = useState(toTimeString(endHour));
  const [localLat, setLocalLat] = useState(latitude !== null ? String(latitude) : '');
  const [localLon, setLocalLon] = useState(longitude !== null ? String(longitude) : '');
  const [geoLoading, setGeoLoading] = useState(false);

  const handleDetectLocation = () => {
    if (!('geolocation' in navigator)) {
      toast.error('Geolocation is not supported by your browser');
      return;
    }
    setGeoLoading(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocalLat(String(pos.coords.latitude.toFixed(4)));
        setLocalLon(String(pos.coords.longitude.toFixed(4)));
        setGeoLoading(false);
        toast.success('Location detected!');
      },
      () => {
        toast.error('Could not detect location. Please enter manually.');
        setGeoLoading(false);
      },
      { timeout: 8000 }
    );
  };

  const handleSave = () => {
    setMode(localMode);

    if (localMode === 'scheduled') {
      setSchedule(fromTimeString(localStart), fromTimeString(localEnd));
    }

    if (localMode === 'sunrise') {
      const lat = parseFloat(localLat);
      const lon = parseFloat(localLon);
      if (!isNaN(lat) && !isNaN(lon)) {
        setLocation(lat, lon);
      }
    }

    toast.success('Theme preferences saved');
    onClose();
  };

  const modes: { value: ThemeMode; label: string; icon: ReactNode; desc: string }[] = [
    {
      value: 'manual',
      label: 'Manual',
      icon: <SunMoon className="h-4 w-4" />,
      desc: 'Toggle dark mode with the toolbar button',
    },
    {
      value: 'scheduled',
      label: 'Scheduled',
      icon: <Clock className="h-4 w-4" />,
      desc: 'Automatically switch based on custom hours',
    },
    {
      value: 'sunrise',
      label: 'Sunrise & Sunset',
      icon: <Sun className="h-4 w-4" />,
      desc: 'Follow local sunrise and sunset times',
    },
  ];

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-primary" />
            Dark Mode Schedule
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Mode selector */}
          <div className="space-y-2">
            {modes.map((m) => (
              <button
                key={m.value}
                onClick={() => setLocalMode(m.value)}
                className={`w-full flex items-start gap-3 p-3 rounded-lg border text-left transition-all duration-200 ${
                  localMode === m.value
                    ? 'border-primary bg-primary/5 text-primary'
                    : 'border-border hover:border-primary/50 hover:bg-muted/50'
                }`}
              >
                <span className="mt-0.5 shrink-0">{m.icon}</span>
                <div>
                  <p className="text-sm font-medium leading-none">{m.label}</p>
                  <p className="text-xs text-muted-foreground mt-1">{m.desc}</p>
                </div>
                <span className="ml-auto mt-0.5 shrink-0">
                  <span
                    className={`inline-block h-4 w-4 rounded-full border-2 transition-colors duration-200 ${
                      localMode === m.value ? 'border-primary bg-primary' : 'border-muted-foreground'
                    }`}
                  />
                </span>
              </button>
            ))}
          </div>

          {/* Scheduled — time pickers */}
          {localMode === 'scheduled' && (
            <div className="rounded-lg border border-border p-4 space-y-3 bg-muted/30">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Dark hours
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="start-hour" className="text-xs">
                    Start (dark from)
                  </Label>
                  <input
                    id="start-hour"
                    type="time"
                    value={localStart}
                    onChange={(e) => setLocalStart(e.target.value)}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="end-hour" className="text-xs">
                    End (light from)
                  </Label>
                  <input
                    id="end-hour"
                    type="time"
                    value={localEnd}
                    onChange={(e) => setLocalEnd(e.target.value)}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Dark period spans from{' '}
                <span className="font-medium text-foreground">{localStart}</span> to{' '}
                <span className="font-medium text-foreground">{localEnd}</span> (wraps midnight if
                end &lt; start).
              </p>
            </div>
          )}

          {/* Sunrise — location inputs */}
          {localMode === 'sunrise' && (
            <div className="rounded-lg border border-border p-4 space-y-3 bg-muted/30">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Location
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleDetectLocation}
                disabled={geoLoading}
                className="w-full gap-2"
              >
                {geoLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <MapPin className="h-4 w-4" />
                )}
                {geoLoading ? 'Detecting…' : 'Use my location'}
              </Button>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="latitude" className="text-xs">
                    Latitude
                  </Label>
                  <input
                    id="latitude"
                    type="number"
                    step="0.0001"
                    min="-90"
                    max="90"
                    placeholder="e.g. 48.8566"
                    value={localLat}
                    onChange={(e) => setLocalLat(e.target.value)}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="longitude" className="text-xs">
                    Longitude
                  </Label>
                  <input
                    id="longitude"
                    type="number"
                    step="0.0001"
                    min="-180"
                    max="180"
                    placeholder="e.g. 2.3522"
                    value={localLon}
                    onChange={(e) => setLocalLon(e.target.value)}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSave}>Save preferences</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
