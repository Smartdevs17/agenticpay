# Push Notification System Setup Guide

## Overview

AgenticPay includes a comprehensive push notification system built on Web Push API (VAPID protocol) with PWA support. This guide covers setup, configuration, and usage.

## Table of Contents

1. [Environment Variables](#environment-variables)
2. [Database Setup](#database-setup)
3. [Backend Configuration](#backend-configuration)
4. [Frontend Integration](#frontend-integration)
5. [Service Worker Setup](#service-worker-setup)
6. [API Endpoints](#api-endpoints)
7. [Usage Examples](#usage-examples)
8. [Troubleshooting](#troubleshooting)

## Environment Variables

### Backend (.env)

```bash
# VAPID Keys for Web Push
# Generate using: npm run generate:vapid-keys
VAPID_PUBLIC_KEY=<your_vapid_public_key>
VAPID_PRIVATE_KEY=<your_vapid_private_key>

# CORS Configuration
CORS_ALLOWED_ORIGINS=http://localhost:3000,http://localhost:3001

# WebSocket Configuration (optional)
WS_ENABLED=true
WS_PORT=3001
```

### Frontend (.env.local)

```bash
# Backend API URL
NEXT_PUBLIC_API_URL=http://localhost:3001/api/v1

# WebSocket Configuration
NEXT_PUBLIC_WS_URL=http://localhost:3001
NEXT_PUBLIC_WS_ENABLED=true
```

## Generating VAPID Keys

VAPID keys are required for the Web Push API. Generate them using the built-in utility:

```bash
cd backend
npm run generate:vapid-keys
```

This will output your public and private keys. Copy them to your `.env` file:

```bash
VAPID_PUBLIC_KEY=<key_from_output>
VAPID_PRIVATE_KEY=<key_from_output>
```

**Important**: Keep your VAPID private key secret. Never commit it to version control.

## Database Setup

### Run Migrations

The push notification system uses three new database tables:

1. **push_subscriptions** - Stores user push subscription endpoints
2. **push_preferences** - Stores user notification preferences
3. **notification_logs** - Tracks all sent notifications

Run migrations:

```bash
cd backend
npm run db:migrate
```

### Verify Tables

```sql
-- Check if tables were created
SELECT table_name FROM information_schema.tables 
WHERE table_schema='public' 
AND table_name IN ('push_subscriptions', 'push_preferences', 'notification_logs');
```

## Backend Configuration

### 1. Initialize WebSocket Server

Update your Express server setup to initialize WebSocket support:

```typescript
import express from 'express';
import { createServer } from 'http';
import { webSocketService } from './services/websocket.js';

const app = express();
const httpServer = createServer(app);

// Initialize WebSocket
const io = webSocketService.initialize(httpServer);

// Start server
httpServer.listen(3001, () => {
  console.log('Server running on port 3001');
});
```

### 2. Mount Push Routes

In your Express app setup:

```typescript
import { pushRouter } from './routes/push.js';

app.use('/api/v1/push', pushRouter);
```

### 3. Authentication Middleware

Ensure auth middleware is configured for push routes. The middleware should attach `user.id` and `user.tenantId` to the request:

```typescript
// middleware/auth.ts
export const authMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const token = req.headers.authorization?.split(' ')[1];
  
  // Validate JWT and attach user to request
  // (req as any).user = { id: userId, tenantId: tenantId };
  
  next();
};
```

## Frontend Integration

### 1. Install Dependencies

```bash
cd frontend
npm install socket.io-client
```

### 2. Add Notification Components

Import and use the notification components in your app:

```typescript
import { PushNotificationManager } from '@/components/PushSubscription';
import { NotificationCenter } from '@/components/NotificationCenter';
import { NotificationPreferences } from '@/components/NotificationPreferences';

export function App() {
  return (
    <div>
      {/* Notification Manager - handles subscription */}
      <PushNotificationManager />
      
      {/* Notification Center - displays history */}
      <NotificationCenter />
      
      {/* Preferences - user settings */}
      <NotificationPreferences />
    </div>
  );
}
```

### 3. Setup WebSocket Provider

Wrap your app with the WebSocket provider for real-time notifications:

```typescript
import { WebSocketNotificationProvider } from '@/hooks/useWebSocketNotifications';

export function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <WebSocketNotificationProvider>
      {children}
    </WebSocketNotificationProvider>
  );
}
```

## Service Worker Setup

The service worker is automatically registered and includes push event handling. Key features:

- **Push Event Handler**: Shows browser notifications
- **Notification Click**: Navigates to deep links
- **Notification Close**: Logs dismissals
- **Offline Support**: Queues notifications when offline

No additional setup needed - the service worker is already configured in `frontend/service-worker.ts`.

## API Endpoints

All push endpoints require authentication (Bearer token in Authorization header).

### Subscribe to Push Notifications

```http
POST /api/v1/push/subscribe
Content-Type: application/json
Authorization: Bearer <token>

{
  "subscription": {
    "endpoint": "https://fcm.googleapis.com/...",
    "keys": {
      "p256dh": "...",
      "auth": "..."
    }
  }
}

Response: 201 Created
{
  "success": true,
  "subscriptionId": "uuid"
}
```

### Unsubscribe from Push

```http
DELETE /api/v1/push/unsubscribe
Content-Type: application/json
Authorization: Bearer <token>

{
  "endpoint": "https://fcm.googleapis.com/..."
}

Response: 204 No Content
```

### Send Push Notification

```http
POST /api/v1/push/notify
Content-Type: application/json
Authorization: Bearer <token>

{
  "userId": "target-user-id",
  "category": "payment_notification",
  "title": "Payment Received",
  "body": "You've received $50 for your completed milestone",
  "icon": "/icons/payment.png",
  "badge": "/icons/badge.png",
  "data": {
    "projectId": "project-123",
    "amount": "50"
  },
  "deepLink": "/payments/project-123"
}

Response: 200 OK
{
  "sent": 1,
  "failed": 0,
  "notificationLogId": "uuid"
}
```

### Get VAPID Public Key

```http
GET /api/v1/push/vapid-public-key

Response: 200 OK
{
  "publicKey": "BCxyz..."
}
```

### Get User Preferences

```http
GET /api/v1/push/preferences
Authorization: Bearer <token>

Response: 200 OK
{
  "paymentNotifications": true,
  "disputeAlerts": true,
  "projectUpdates": true,
  "milestoneReminders": true,
  "securityAlerts": true,
  "subscriptionUpdates": true,
  "systemNotifications": true,
  "groupNotifications": true,
  "notifySound": true,
  "notifyBadge": true,
  "locale": "en",
  "timezone": "UTC"
}
```

### Update User Preferences

```http
PUT /api/v1/push/preferences
Content-Type: application/json
Authorization: Bearer <token>

{
  "paymentNotifications": false,
  "notifySound": false
}

Response: 200 OK
{
  "paymentNotifications": false,
  "notifySound": false,
  ...
}
```

### Get Notification History

```http
GET /api/v1/push/history?limit=50
Authorization: Bearer <token>

Response: 200 OK
[
  {
    "id": "uuid",
    "title": "Payment Received",
    "body": "...",
    "category": "payment_notification",
    "status": "delivered",
    "sentAt": "2025-06-01T10:30:00Z",
    "deliveredAt": "2025-06-01T10:30:05Z",
    "clickedAt": null,
    "createdAt": "2025-06-01T10:30:00Z"
  }
]
```

### Mark Notification as Clicked

```http
POST /api/v1/push/mark-clicked/:notificationId
Authorization: Bearer <token>

Response: 200 OK
{
  "success": true
}
```

## Usage Examples

### Subscribe User to Push Notifications

```typescript
import { useNotificationSubscription } from '@/components/PushSubscription';

export function MyComponent() {
  const { subscribe, isSubscribed } = useNotificationSubscription();

  return (
    <button onClick={subscribe} disabled={isSubscribed}>
      {isSubscribed ? 'Already Subscribed' : 'Enable Notifications'}
    </button>
  );
}
```

### Send Notification from Backend

```typescript
import { pushService } from './services/push.js';
import { NotificationCategory } from '@prisma/client';

// In your service/controller
const result = await pushService.sendNotification({
  tenantId: 'tenant-123',
  userId: 'user-456',
  category: 'payment_notification' as NotificationCategory,
  title: 'Payment Received',
  body: 'Your payment of $100 has been received and approved',
  icon: '/icons/payment.png',
  deepLink: '/payments/123',
  data: {
    paymentId: 'payment-123',
    amount: '100'
  }
});

console.log(`Sent: ${result.sent}, Failed: ${result.failed}`);
```

### Listen for Real-Time Notifications (Frontend)

```typescript
import { useWebSocketNotifications } from '@/hooks/useWebSocketNotifications';

export function NotificationListener() {
  const { isConnected, notification } = useWebSocketNotifications();

  useEffect(() => {
    if (notification) {
      console.log('Received:', notification);
      // Handle notification
    }
  }, [notification]);

  return (
    <div>
      Status: {isConnected ? 'Connected' : 'Disconnected'}
    </div>
  );
}
```

## Notification Categories

The system supports the following notification categories:

- **payment_notification** - Payment-related updates
- **dispute_alert** - Dispute notifications (high priority)
- **project_update** - Project status changes
- **milestone_reminder** - Milestone reminders
- **security_alert** - Security-related alerts (high priority)
- **subscription_update** - Subscription changes
- **system_notification** - General system messages

Users can enable/disable each category via preferences.

## Browser Support

| Browser | Support | Requirements |
|---------|---------|--------------|
| Chrome 50+ | ✅ | HTTPS, Service Worker |
| Firefox 48+ | ✅ | HTTPS, Service Worker |
| Safari 15.1+ | ✅ | HTTPS, Service Worker |
| Edge 17+ | ✅ | HTTPS, Service Worker |

**HTTPS Required**: Push notifications only work on HTTPS connections (or localhost for development).

## Troubleshooting

### "Service Worker not registered"

Make sure `service-worker.ts` is available at `public/service-worker.js`:

```bash
# Build the service worker
npm run build
```

### "Push permission denied"

Users can re-enable notifications in browser settings:
- Chrome/Edge: Settings → Privacy → Site Settings → Notifications
- Firefox: Preferences → Privacy → Permissions → Notifications
- Safari: System Preferences → Notifications

### "Failed to fetch VAPID public key"

Check that:
1. Backend is running and accessible
2. CORS is properly configured
3. `VAPID_PUBLIC_KEY` env var is set
4. Push routes are mounted on the Express app

### "Subscription endpoint invalid"

This usually means:
1. Push subscription expired (unsubscribe and resubscribe)
2. Browser cleared service worker data (unsubscribe and resubscribe)
3. User manually disabled notifications (check browser settings)

### "WebSocket connection failed"

Check that:
1. WebSocket is enabled (`WS_ENABLED=true`)
2. Socket.io is installed on frontend
3. CORS is configured for WebSocket connections
4. Auth token is valid

### Notifications not appearing

Check:
1. User has not disabled the category in preferences
2. Notification is actually being sent (check logs)
3. Service worker is installed (check DevTools → Application → Service Workers)
4. Browser is not in "Do Not Disturb" mode

## Security Considerations

1. **VAPID Keys**: Keep private keys secret and never commit to version control
2. **Authentication**: All endpoints require valid JWT tokens
3. **Rate Limiting**: Implement rate limiting on notification endpoints
4. **Validation**: Validate all notification data before sending
5. **HTTPS**: Always use HTTPS in production (required for push)

## Performance Tips

1. **Batch Operations**: Use batch endpoints for multiple users
2. **Caching**: Cache VAPID public key on client
3. **Retry Logic**: Implement exponential backoff for failed sends
4. **Cleanup**: Regularly clean up old notification logs
5. **Grouping**: Use notification tags to group related notifications

## Next Steps

- Implement analytics for notification tracking
- Add scheduled notification support
- Create admin dashboard for notification management
- Integrate with email for fallback notifications
- Add webhook support for external notification triggers

## Support

For issues or questions:
- Check the [Troubleshooting](#troubleshooting) section
- Review server logs for error details
- Check browser console for client-side errors
- See [API Endpoints](#api-endpoints) for endpoint documentation
