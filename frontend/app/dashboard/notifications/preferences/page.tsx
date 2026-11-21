'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { apiCall } from '@/lib/api/client';

interface NotificationPreferences {
  userId: string;
  emailEnabled: boolean;
  smsEnabled: boolean;
  pushEnabled: boolean;
  inAppEnabled: boolean;
  payments: boolean;
  invoices: boolean;
  marketing: boolean;
  security: boolean;
  productUpdates: boolean;
  quietHoursEnabled: boolean;
  quietHoursStart: string;
  quietHoursEnd: string;
  updatedAt: string;
}

export default function NotificationPreferencesPage() {
  const [prefs, setPrefs] = useState<NotificationPreferences | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const fetchPrefs = async () => {
      try {
        const res = await apiCall<NotificationPreferences>('/notifications/preferences/default-user');
        setPrefs(res);
      } catch (err) {
        console.error('Failed to fetch preferences:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchPrefs();
  }, []);

  const handleSave = async () => {
    if (!prefs) return;
    setSaving(true);
    try {
      await apiCall('/notifications/preferences/default-user', {
        method: 'PUT',
        body: JSON.stringify(prefs),
      });
    } catch (err) {
      console.error('Failed to save preferences:', err);
    } finally {
      setSaving(false);
    }
  };

  const toggle = (key: keyof NotificationPreferences) => {
    if (!prefs) return;
    setPrefs({ ...prefs, [key]: !prefs[key] });
  };

  if (loading || !prefs) {
    return <div className="p-6 text-center text-muted-foreground">Loading preferences...</div>;
  }

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Notification Preferences</h1>
          <p className="text-sm text-muted-foreground mt-1">Control how and when you receive notifications.</p>
        </div>
        <Button onClick={handleSave} disabled={saving}>
          {saving ? 'Saving...' : 'Save Changes'}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Delivery Channels</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {[
            { key: 'emailEnabled' as const, label: 'Email', desc: 'Receive notifications via email' },
            { key: 'smsEnabled' as const, label: 'SMS', desc: 'Receive notifications via text message' },
            { key: 'pushEnabled' as const, label: 'Push', desc: 'Receive push notifications in browser' },
            { key: 'inAppEnabled' as const, label: 'In-App', desc: 'Show notifications in the dashboard' },
          ].map(({ key, label, desc }) => (
            <div key={key} className="flex items-center justify-between p-3 border rounded">
              <div>
                <p className="font-medium text-sm">{label}</p>
                <p className="text-xs text-muted-foreground">{desc}</p>
              </div>
              <button
                onClick={() => toggle(key)}
                className={`w-11 h-6 rounded-full transition-colors ${prefs[key] ? 'bg-green-500' : 'bg-gray-300'}`}
              >
                <span
                  className={`block w-5 h-5 bg-white rounded-full transition-transform ${
                    prefs[key] ? 'translate-x-5.5' : 'translate-x-0.5'
                  }`}
                />
              </button>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Notification Categories</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {[
            { key: 'payments' as const, label: 'Payments', desc: 'Payment received, sent, or failed' },
            { key: 'invoices' as const, label: 'Invoices', desc: 'Invoice created, paid, or overdue' },
            { key: 'security' as const, label: 'Security', desc: 'Login alerts, suspicious activity' },
            { key: 'productUpdates' as const, label: 'Product Updates', desc: 'New features and improvements' },
            { key: 'marketing' as const, label: 'Marketing', desc: 'Promotions and newsletters' },
          ].map(({ key, label, desc }) => (
            <div key={key} className="flex items-center justify-between p-3 border rounded">
              <div>
                <p className="font-medium text-sm">{label}</p>
                <p className="text-xs text-muted-foreground">{desc}</p>
              </div>
              <button
                onClick={() => toggle(key)}
                className={`w-11 h-6 rounded-full transition-colors ${prefs[key] ? 'bg-green-500' : 'bg-gray-300'}`}
              >
                <span
                  className={`block w-5 h-5 bg-white rounded-full transition-transform ${
                    prefs[key] ? 'translate-x-5.5' : 'translate-x-0.5'
                  }`}
                />
              </button>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Quiet Hours</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between p-3 border rounded">
            <div>
              <p className="font-medium text-sm">Enable Quiet Hours</p>
              <p className="text-xs text-muted-foreground">Pause non-urgent notifications during set hours</p>
            </div>
            <button
              onClick={() => toggle('quietHoursEnabled')}
              className={`w-11 h-6 rounded-full transition-colors ${prefs.quietHoursEnabled ? 'bg-green-500' : 'bg-gray-300'}`}
            >
              <span
                className={`block w-5 h-5 bg-white rounded-full transition-transform ${
                  prefs.quietHoursEnabled ? 'translate-x-5.5' : 'translate-x-0.5'
                }`}
              />
            </button>
          </div>
          {prefs.quietHoursEnabled && (
            <div className="grid grid-cols-2 gap-4 p-3 border rounded">
              <div className="space-y-1">
                <Label>Start Time</Label>
                <input
                  type="time"
                  value={prefs.quietHoursStart}
                  onChange={(e) => setPrefs({ ...prefs, quietHoursStart: e.target.value })}
                  className="w-full border rounded px-3 py-2 text-sm bg-background"
                />
              </div>
              <div className="space-y-1">
                <Label>End Time</Label>
                <input
                  type="time"
                  value={prefs.quietHoursEnd}
                  onChange={(e) => setPrefs({ ...prefs, quietHoursEnd: e.target.value })}
                  className="w-full border rounded px-3 py-2 text-sm bg-background"
                />
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
