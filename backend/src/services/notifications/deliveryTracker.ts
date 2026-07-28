import { config } from '../../config.js';

export interface DeliveryRecord {
  id: string;
  notificationId: string;
  channel: 'email' | 'sms' | 'push' | 'in-app';
  userId: string;
  templateId: string;
  status: 'pending' | 'sent' | 'failed' | 'delivered' | 'opened' | 'clicked' | 'read';
  messageId?: string;
  error?: string;
  sentAt?: Date;
  deliveredAt?: Date;
  openedAt?: Date;
  clickedAt?: Date;
  readAt?: Date;
  retryCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export class DeliveryTracker {
  // In a real implementation, this would use a database
  // For now, we'll use an in-memory store
  private deliveries: Map<string, DeliveryRecord> = new Map();

  async track(delivery: Omit<DeliveryRecord, 'id' | 'createdAt' | 'updatedAt'>): Promise<DeliveryRecord> {
    const now = new Date();
    const record: DeliveryRecord = {
      id: `delivery_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      notificationId: delivery.notificationId,
      channel: delivery.channel,
      userId: delivery.userId,
      templateId: delivery.templateId,
      status: delivery.status,
      messageId: delivery.messageId,
      error: delivery.error,
      sentAt: delivery.status === 'sent' || delivery.status === 'delivered' || delivery.status === 'read' ? now : undefined,
      deliveredAt: delivery.status === 'delivered' || delivery.status === 'read' ? now : undefined,
      readAt: delivery.status === 'read' ? now : undefined,
      retryCount: delivery.retryCount ?? 0,
      createdAt: now,
      updatedAt: now
    };

    this.deliveries.set(record.id, record);

    console.log(`[Delivery] Tracked ${delivery.channel} delivery for notification ${delivery.notificationId}: ${delivery.status}`);

    return record;
  }

  async updateStatus(deliveryId: string, status: 'sent' | 'failed' | 'delivered' | 'read', messageId?: string, error?: string): Promise<DeliveryRecord | undefined> {
    const record = this.deliveries.get(deliveryId);
    if (!record) return undefined;

    record.status = status;
    if (messageId) record.messageId = messageId;
    if (error) record.error = error;
    record.updatedAt = new Date();

    if (status === 'sent' || status === 'delivered' || status === 'read') {
      record.sentAt = record.sentAt || new Date();
    }
    if (status === 'delivered' || status === 'read') {
      record.deliveredAt = new Date();
    }
    if (status === 'read') {
      record.readAt = new Date();
    }

    if (status === 'failed') {
      record.retryCount += 1;
    }

    this.deliveries.set(deliveryId, record);

    console.log(`[Delivery] Updated delivery ${deliveryId} status to ${status}`);

    return record;
  }

  async getDelivery(deliveryId: string): Promise<DeliveryRecord | undefined> {
    return this.deliveries.get(deliveryId);
  }

  async getDeliveriesForNotification(notificationId: string): Promise<DeliveryRecord[]> {
    return Array.from(this.deliveries.values())
      .filter(d => d.notificationId === notificationId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async getDeliveriesForUser(userId: string, limit = 50, offset = 0): Promise<DeliveryRecord[]> {
    const userDeliveries = Array.from(this.deliveries.values())
      .filter(d => d.userId === userId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(offset, offset + limit);

    return userDeliveries;
  }

  async getFailedDeliveriesForRetry(): Promise<DeliveryRecord[]> {
    return Array.from(this.deliveries.values())
      .filter(d => d.status === 'failed' && d.retryCount < 3) // Max 3 retries
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()); // Oldest first
  }

  async getDeliveriesInRange(userId?: string, startDate?: Date, endDate?: Date): Promise<DeliveryRecord[]> {
    let results = Array.from(this.deliveries.values());

    if (userId) {
      results = results.filter(d => d.userId === userId);
    }
    if (startDate) {
      results = results.filter(d => d.createdAt >= startDate);
    }
    if (endDate) {
      results = results.filter(d => d.createdAt <= endDate);
    }

    return results.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async markAsOpened(deliveryId: string): Promise<DeliveryRecord | undefined> {
    const record = this.deliveries.get(deliveryId);
    if (!record) return undefined;
    record.status = 'opened';
    record.openedAt = new Date();
    record.updatedAt = new Date();
    this.deliveries.set(deliveryId, record);
    return record;
  }

  async markAsClicked(deliveryId: string): Promise<DeliveryRecord | undefined> {
    const record = this.deliveries.get(deliveryId);
    if (!record) return undefined;
    record.status = 'clicked';
    record.clickedAt = new Date();
    record.updatedAt = new Date();
    this.deliveries.set(deliveryId, record);
    return record;
  }

  async getUnreadCount(userId: string): Promise<number> {
    return Array.from(this.deliveries.values())
      .filter(d => d.userId === userId && d.status !== 'read' && d.status !== 'clicked' && d.channel === 'in-app')
      .length;
  }

  async markAllAsRead(userId: string): Promise<number> {
    let count = 0;
    for (const [id, record] of this.deliveries) {
      if (record.userId === userId && record.status !== 'read' && record.channel === 'in-app') {
        record.status = 'read';
        record.readAt = new Date();
        record.updatedAt = new Date();
        this.deliveries.set(id, record);
        count++;
      }
    }
    return count;
  }
}
