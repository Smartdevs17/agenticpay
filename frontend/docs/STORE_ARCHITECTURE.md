# Frontend Store Architecture (Issue #1406)

This document describes the modular slice architecture for the application state store in `frontend/store`.

## Architecture Overview

The global store is composed using [Zustand](https://github.com/pmndrs/zustand) with modular feature slices:
- **Auth Slice** (`frontend/store/slices/authSlice.ts`): User authentication status, public address, user metadata, and login types.
- **Payment Slice** (`frontend/store/slices/paymentSlice.ts`): Active payment configuration, form data, processing status, and errors.
- **Project Slice** (`frontend/store/slices/projectSlice.ts`): Projects collection, current active project, and loading indicators.

All slices are combined into `AppStore` in `frontend/store/useStore.ts`.

## Persistence

The store uses Zustand's `persist` middleware with the persistent storage key:
- Storage key: `'agenticpay-store'`
- Persisted fields: `address`, `email`, `name`, `loginType`, `isAuthenticated`, `paymentType`, `formData`

The serialized storage schema is backward-compatible with earlier versions of AgenticPay so existing user sessions remain intact.

## Narrow Selector Hooks

To avoid unnecessary component re-renders when unrelated slices update, components should subscribe using the narrow hooks exported from `frontend/store/useStore.ts`:

```tsx
import { useIsAuthenticated, useUserAddress, usePaymentType } from '@/store/useStore';

function UserBadge() {
  // Only re-renders when address changes, NOT on payment or project slice updates!
  const address = useUserAddress();
  return <span>{address}</span>;
}
```

Available narrow hooks:
- **Auth**: `useIsAuthenticated`, `useUserAddress`, `useUserEmail`, `useUserName`, `useUserProfileImage`, `useTimezone`, `useLoginType`, `useAuthActions`
- **Payment**: `usePaymentType`, `usePaymentFormData`, `useIsPaymentProcessing`, `usePaymentErrorMessage`, `usePaymentActions`
- **Project**: `useProjects`, `useCurrentProjectId`, `useIsProjectsLoading`, `useProjectActions`
- **Generic Selector**: `useAppSelector(selector, equalityFn)`
