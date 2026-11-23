import { describe, it, expect, beforeEach } from 'vitest';
import {
  multiChannelNotifications,
  buildPreferenceMatrix,
  isWithinQuietHours,
  type PreferenceMatrix,
} from '../notifications.js';
import { notificationPreferenceService } from '../notifications/preferenceService.js';

describe('MultiChannelNotificationService (#1352)', () => {
  beforeEach(() => {
    multiChannelNotifications.reset();
  });

  it('builds a channel × category preference matrix from defaults', async () => {
    const prefs = await notificationPreferenceService.getPreferences('user-matrix-1');
    const matrix = buildPreferenceMatrix(prefs);

    expect(matrix.email.payments).toBe(true);
    expect(matrix.email.marketing).toBe(false);
    expect(matrix.sms.security).toBe(true);
  });

  it('honours matrix cell overrides when resolving channels', async () => {
    const userId = 'user-matrix-2';
    await multiChannelNotifications.setMatrixCell(userId, 'email', 'payments', false);
    await multiChannelNotifications.setMatrixCell(userId, 'push', 'payments', true);

    const results = await multiChannelNotifications.resolveChannels(userId, 'payments', {
      bypassQuietHours: true,
    });

    expect(results.find((r) => r.channel === 'email')?.delivered).toBe(false);
    expect(results.find((r) => r.channel === 'email')?.reason).toBe('matrix_cell_disabled');
    expect(results.find((r) => r.channel === 'push')?.delivered).toBe(true);
  });

  it('suppresses non-security categories during quiet hours', async () => {
    const userId = 'user-quiet';
    await notificationPreferenceService.updatePreferences(userId, {
      quietHoursEnabled: true,
      quietHoursStart: '00:00',
      quietHoursEnd: '23:59',
    });

    const marketing = await multiChannelNotifications.resolveChannels(userId, 'marketing');
    expect(marketing.every((r) => !r.delivered && r.reason === 'quiet_hours')).toBe(true);

    const security = await multiChannelNotifications.resolveChannels(userId, 'security');
    expect(security.some((r) => r.delivered)).toBe(true);
  });

  it('detects quiet-hour windows that wrap midnight', () => {
    const prefs = {
      userId: 'x',
      emailEnabled: true,
      smsEnabled: true,
      pushEnabled: true,
      inAppEnabled: true,
      whatsappEnabled: true,
      payments: true,
      invoices: true,
      marketing: false,
      security: true,
      productUpdates: true,
      quietHoursEnabled: true,
      quietHoursStart: '22:00',
      quietHoursEnd: '06:00',
      updatedAt: new Date().toISOString(),
    };

    expect(isWithinQuietHours(prefs, new Date('2026-01-01T23:00:00'))).toBe(true);
    expect(isWithinQuietHours(prefs, new Date('2026-01-01T03:00:00'))).toBe(true);
    expect(isWithinQuietHours(prefs, new Date('2026-01-01T12:00:00'))).toBe(false);
  });

  it('dispatches only to enabled matrix channels and records history', async () => {
    const userId = 'user-dispatch';
    const matrix = await multiChannelNotifications.getMatrix(userId);
    const disabled: PreferenceMatrix = {
      ...matrix,
      email: { ...matrix.email, invoices: false },
      sms: { ...matrix.sms, invoices: false },
      push: { ...matrix.push, invoices: false },
      inApp: { ...matrix.inApp, invoices: true },
      whatsapp: { ...matrix.whatsapp, invoices: false },
    };
    await multiChannelNotifications.setMatrix(userId, disabled);

    const result = await multiChannelNotifications.dispatch({
      userId,
      category: 'invoices',
      title: 'Invoice ready',
      body: 'Your invoice is ready',
      bypassQuietHours: true,
    });

    expect(result.deliveredChannels).toEqual(['inApp']);
    expect(multiChannelNotifications.getDeliveryHistory(userId)).toHaveLength(1);
  });
});
