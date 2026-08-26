'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { apiCall } from '@/lib/api/client';

interface InAppNotification {
  id: string;
  title: string;
  message: string;
  read: boolean;
  createdAt: string;
  type: string;
}

interface DeliveryRecord {
  id: string;
  notificationId: string;
  channel: string;
  status: string;
  sentAt: string;
  deliveredAt?: string;
}

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState<InAppNotification[]>([]);
  const [deliveries, setDeliveries] = useState<DeliveryRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'notifications' | 'history'>('notifications');

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [notifRes, deliveryRes] = await Promise.all([
          apiCall<{ notifications: InAppNotification[] }>('/notifications/in-app/user/default-user?limit=50'),
          apiCall<{ deliveries: DeliveryRecord[] }>('/notifications/delivery/user/default-user?limit=20'),
        ]);
        setNotifications(notifRes.notifications || []);
        setDeliveries(deliveryRes.deliveries || []);
      } catch (err) {
        console.error('Failed to fetch notifications:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  const markAsRead = async (id: string) => {
    try {
      await apiCall(`/notifications/in-app/${id}/read`, { method: 'POST' });
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, read: true } : n))
      );
    } catch (err) {
      console.error('Failed to mark as read:', err);
    }
  };

  const unreadCount = notifications.filter((n) => !n.read).length;

  if (loading) {
    return <div className="p-6 text-center text-muted-foreground">Loading notifications...</div>;
  }

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Notifications</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {unreadCount > 0 ? `${unreadCount} unread notification${unreadCount > 1 ? 's' : ''}` : 'All caught up'}
          </p>
        </div>
      </div>

      <div className="flex gap-2 border-b pb-2">
        <Button
          variant={activeTab === 'notifications' ? 'default' : 'ghost'}
          size="sm"
          onClick={() => setActiveTab('notifications')}
        >
          In-App ({notifications.length})
        </Button>
        <Button
          variant={activeTab === 'history' ? 'default' : 'ghost'}
          size="sm"
          onClick={() => setActiveTab('history')}
        >
          Delivery History ({deliveries.length})
        </Button>
      </div>

      {activeTab === 'notifications' && (
        <Card>
          <CardContent className="p-0">
            {notifications.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground text-center">No notifications yet.</p>
            ) : (
              <div className="divide-y">
                {notifications.map((n) => (
                  <div
                    key={n.id}
                    className={`p-4 flex items-start justify-between ${!n.read ? 'bg-blue-50 dark:bg-blue-950/20' : ''}`}
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">{n.title}</span>
                        {!n.read && <Badge className="bg-blue-100 text-blue-700">New</Badge>}
                      </div>
                      <p className="text-sm text-muted-foreground">{n.message}</p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(n.createdAt).toLocaleString()}
                      </p>
                    </div>
                    {!n.read && (
                      <Button variant="ghost" size="sm" onClick={() => markAsRead(n.id)}>
                        Mark read
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {activeTab === 'history' && (
        <Card>
          <CardContent className="p-0">
            {deliveries.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground text-center">No delivery history.</p>
            ) : (
              <div className="divide-y">
                {deliveries.map((d) => (
                  <div key={d.id} className="p-4 flex items-center justify-between">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline">{d.channel}</Badge>
                        <Badge
                          className={
                            d.status === 'delivered'
                              ? 'bg-green-100 text-green-700'
                              : d.status === 'failed'
                              ? 'bg-red-100 text-red-700'
                              : 'bg-gray-100 text-gray-700'
                          }
                        >
                          {d.status}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Sent: {new Date(d.sentAt).toLocaleString()}
                        {d.deliveredAt && ` | Delivered: ${new Date(d.deliveredAt).toLocaleString()}`}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
