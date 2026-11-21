# Repository Pattern with Query Builders — Issue #728

AgenticPay uses the **Repository Pattern** with **Query Builders** for type-safe, composable database access.

## Overview

- **Repository**: Data access layer abstracting Prisma
- **Query Builder**: Fluent API for composing complex queries
- **Multiple Backends**: Prisma, Redis, TimescaleDB support

## Architecture

### Repository Interface

```typescript
// src/repositories/interfaces/Repository.ts
export interface Repository<T> {
  findById(id: string): Promise<T | null>;
  findMany(options?: FindManyOptions<T>): Promise<T[]>;
  create(data: Omit<T, 'id'>): Promise<T>;
  update(id: string, data: Partial<T>): Promise<T | null>;
  delete(id: string): Promise<boolean>;
  query(raw: string, params?: unknown[]): Promise<T[]>;
}
```

### Query Builder

```typescript
// src/repositories/QueryBuilder.ts
const qb = new QueryBuilder<User>()
  .where({ status: 'active' })
  .orderBy('createdAt', 'desc')
  .limit(10)
  .offset(20);

const query = qb.build();
```

## Creating a Repository

### Step 1: Define the Entity Type

```typescript
export interface User {
  id: string;
  email: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}
```

### Step 2: Create the Repository Class

```typescript
// src/repositories/UserRepository.ts
import { PrismaRepository } from './implementations/PrismaRepository.js';
import { prisma } from '../lib/prisma.js';

export class UserRepository extends PrismaRepository<User> {
  constructor() {
    super(prisma.user as any);
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.findMany({ where: { email } as any }).then(u => u[0] || null);
  }

  async findActive(): Promise<User[]> {
    const qb = new QueryBuilder<User>()
      .where({ status: 'active' } as any)
      .orderBy('createdAt', 'desc');
    return this.findMany(qb.build() as any);
  }
}
```

### Step 3: Use in Routes/Services

```typescript
// src/routes/users.ts
import { UserRepository } from '../repositories/UserRepository.js';

const userRepo = new UserRepository();

router.get('/:id', async (req, res) => {
  const user = await userRepo.findById(req.params.id);
  res.json(user);
});

router.post('/', async (req, res) => {
  const user = await userRepo.create(req.body);
  res.status(201).json(user);
});
```

## Query Builder Examples

### Simple WHERE

```typescript
const qb = new QueryBuilder<User>()
  .where({ status: 'active' });
```

### Multiple Conditions

```typescript
const qb = new QueryBuilder<User>()
  .where({ status: 'active', role: 'admin' });
```

### Ordering

```typescript
const qb = new QueryBuilder<User>()
  .orderBy('createdAt', 'desc')
  .orderBy('name', 'asc');
```

### Pagination

```typescript
const qb = new QueryBuilder<User>()
  .limit(20)
  .offset(40); // Items 41-60
```

### Complex Queries

```typescript
const qb = new QueryBuilder<User>()
  .where({ status: 'active' })
  .orderBy('updatedAt', 'desc')
  .limit(10);
```

## Backend Implementations

### Prisma Repository

Used for relational databases (PostgreSQL, MySQL):

```typescript
export class PrismaRepository<T> implements Repository<T> {
  findById(id: string): Promise<T | null>;
  findMany(options: FindManyOptions<T>): Promise<T[]>;
  // ... other methods
}
```

### Redis Repository

Used for caching and session storage:

```typescript
export class RedisRepository<T> implements Repository<T> {
  findById(id: string): Promise<T | null>;
  findMany(options: FindManyOptions<T>): Promise<T[]>;
  // ... other methods
}
```

### TimescaleDB Repository

Used for time-series data:

```typescript
export class TimescaleRepository<T> implements Repository<T> {
  findById(id: string): Promise<T | null>;
  findMany(options: FindManyOptions<T>): Promise<T[]>;
  // ... other methods
}
```

## Existing Repositories

- **APIKeyRepository** — API key management
- **ProjectRepository** — Project data
- **CategoryRepository** — Categories
- **ComplianceRepository** — Compliance data
- **OnboardingRepository** — Onboarding workflows

## Migration Guide

To migrate direct Prisma calls to repositories:

### Before

```typescript
const user = await prisma.user.findUnique({ where: { id: '123' } });
```

### After

```typescript
const userRepo = new UserRepository();
const user = await userRepo.findById('123');
```

## See Also

- [Repository Pattern](https://martinfowler.com/eaaCatalog/repository.html)
- [Query Builder Pattern](https://en.wikipedia.org/wiki/Builder_pattern)
- [Prisma ORM](https://www.prisma.io/)
