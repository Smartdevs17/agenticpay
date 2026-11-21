/**
 * CQRS Infrastructure — Issue #490
 * Separates write (command) and read (query) concerns for high-volume tables.
 * Write models use the primary Prisma client; reads use a read-replica or
 * the primary as fallback.
 */

export * from './command-bus.js';
export * from './query-bus.js';
export * from './commands/index.js';
export * from './queries/index.js';
export * from './projections/index.js';
