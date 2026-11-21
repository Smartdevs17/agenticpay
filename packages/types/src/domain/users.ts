import type { ISO8601, UUID } from './primitives.js';

export type UserRole = 'client' | 'freelancer' | 'admin';

export interface User {
  id: UUID;
  email: string;
  displayName?: string;
  role: UserRole;
  createdAt: ISO8601;
  updatedAt: ISO8601;
}
