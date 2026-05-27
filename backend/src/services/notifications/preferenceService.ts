import { config } from '../../config.js';

export interface NotificationPreferences {
  userId: string;
  // Channel enablement
  emailEnabled: boolean;
  smsEnabled: boolean;
  pushEnabled: boolean;
  inAppEnabled: boolean;
  // Category-specific enablement
  payments: boolean;
  invoices: boolean;
  marketing: boolean;
  security: boolean;
  productUpdates: boolean;
  // Quiet hours
  quietHoursEnabled: boolean;
  quietHoursStart: string; // HH:MM format
  quietHoursEnd: string; // HH:MM format
  // Updated timestamp
  updatedAt: string;
}

export class NotificationPreferenceService {
  // In a real implementation, this would use a database
  // For now, we'll use an in-memory store
  private preferences: Map<string, NotificationPreferences> = {};

  async getPreferences(userId: string): Promise<NotificationPreferences> {
    const stored = this.preferences.get(userId);
    if (stored) return stored;
    
    // Return default preferences
    const defaults: NotificationPreferences = {
      userId,
      emailEnabled: true,
      smsEnabled: true,
      pushEnabled: true,
      inAppEnabled: true,
      payments: true,
      invoices: true,
      marketing: false,
      security: true,
      productUpdates: true,
      quietHoursEnabled: false,
      quietHoursStart: '22:00',
      quietHoursEnd: '06:00',
      updatedAt: new Date().toISOString()
    };
    
    this.preferences.set(userId, defaults);
    return defaults;
  }

  async updatePreferences(userId: string, updates: Partial<NotificationPreferences>): Promise<NotificationPreferences> {
    const current = await this.getPreferences(userId);
    const updated = { ...current, ...updates, updatedAt: new Date().toISOString() };
    this.preferences.set(userId, updated);
    
    console.log(`[Preferences] Updated preferences for user ${userId}`);
    return updated;
  }

  async resetToDefaults(userId: string): Promise<NotificationPreferences> {
    const defaults: NotificationPreferences = {
      userId,
      emailEnabled: true,
      smsEnabled: true,
      pushEnabled: true,
      inAppEnabled: true,
      payments: true,
      invoices: true,
      marketing: false,
      security: true,
      productUpdates: true,
      quietHoursEnabled: false,
      quietHoursStart: '22:00',
      quietHoursEnd: '06:00',
      updatedAt: new Date().toISOString()
    };
    
    this.preferences.set(userId, defaults);
    return defaults;
  }
}