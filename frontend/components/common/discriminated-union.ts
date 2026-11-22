/**
 * Exhaustive discriminated union helper (#1414).
 * Ensures at compile-time that every member of a discriminated union is handled.
 */
export function assertNever(value: never, message?: string): never {
  throw new Error(message ?? `Unhandled discriminated union member: ${JSON.stringify(value)}`);
}
