# Multi-Channel Notifications — Preference Matrix

Issue #1352 — channel × category matrix.

## Backend

`backend/src/services/notifications.ts`

Channels: `email`, `sms`, `push`, `inApp`, `whatsapp`  
Categories: `payments`, `invoices`, `marketing`, `security`, `productUpdates`

A notification is delivered on a channel only when:

1. The channel master switch is on
2. The `(channel, category)` matrix cell is true
3. Quiet hours are not active (security always bypasses quiet hours)

`dispatch()` resolves and records channel eligibility (`deliveredChannels`); the existing channel services remain the transport layer.

```ts
import { multiChannelNotifications } from '../services/notifications.js';

await multiChannelNotifications.setMatrixCell(userId, 'email', 'marketing', false);
await multiChannelNotifications.dispatch({
  userId,
  category: 'payments',
  title: 'Payment received',
  body: '…',
});
```

### HTTP

- `GET /api/v1/notifications/preferences/matrix?userId=`
- `PUT /api/v1/notifications/preferences/matrix` `{ userId, matrix }`
- `POST /api/v1/notifications/dispatch`

## Frontend

`frontend/components/notifications/PreferenceMatrix.tsx` renders the editable matrix UI.
