# RBAC Policy Sandbox

Issue #1350 — preview workspace permission changes without mutating membership.

## Service

`backend/src/services/rbacSandbox.ts`

```ts
import { rbacSandbox } from '../services/rbacSandbox.js';

// Preview promoting a member to admin
const preview = rbacSandbox.previewRoleChange(workspaceId, userId, 'admin');
// preview.diff.granted / .revoked / .unchanged
// preview.wouldAllow['payment:refund']

// Layer temporary additions/removals on a base role
rbacSandbox.previewCustomPolicy('viewer', ['payment:refund'], ['audit:read']);

// Simulate one action under a proposed role
rbacSandbox.simulateAction(workspaceId, userId, 'workspace:delete', 'owner');

// Estimate blast radius of a global role migration
rbacSandbox.previewRoleMigration(members, 'viewer', 'member');
```

## Observability

Previews emit structured `logger.info` events tagged `[rbac-sandbox]` with grant/revoke counts.
