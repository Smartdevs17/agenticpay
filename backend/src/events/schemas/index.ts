import { z } from 'zod';
import { PaymentEventSchemas } from './payment.events.js';
import { ProjectEventSchemas } from './project.events.js';
import { VerificationEventSchemas } from './verification.events.js';

// Combine all event schemas
export const EventSchemas = {
  ...PaymentEventSchemas,
  ...ProjectEventSchemas,
  ...VerificationEventSchemas,
} as const;

// Type for all event types
export type EventType = keyof typeof EventSchemas;

// Type inference for event payloads
export type EventPayload<T extends EventType> = z.infer<(typeof EventSchemas)[T]>;

// Schema registry class
export class EventSchemaRegistry {
  private schemas: Map<string, z.ZodSchema> = new Map();

  constructor() {
    // Register all schemas
    for (const [eventType, schema] of Object.entries(EventSchemas)) {
      this.register(eventType, schema);
    }
  }

  register(eventType: string, schema: z.ZodSchema): void {
    this.schemas.set(eventType, schema);
  }

  getSchema(eventType: string): z.ZodSchema | undefined {
    return this.schemas.get(eventType);
  }

  hasSchema(eventType: string): boolean {
    return this.schemas.has(eventType);
  }

  validate<T>(eventType: string, payload: unknown): T {
    const schema = this.getSchema(eventType);
    if (!schema) {
      throw new Error(`No schema registered for event type: ${eventType}`);
    }
    return schema.parse(payload) as T;
  }

  safeValidate<T>(eventType: string, payload: unknown): { success: true; data: T } | { success: false; error: z.ZodError } {
    const schema = this.getSchema(eventType);
    if (!schema) {
      return { success: false, error: new z.ZodError([{ code: z.ZodIssueCode.custom, message: `No schema registered for event type: ${eventType}`, path: [] }]) };
    }
    const result = schema.safeParse(payload);
    if (result.success) {
      return { success: true, data: result.data as T };
    }
    return { success: false, error: result.error };
  }

  getAllEventTypes(): string[] {
    return Array.from(this.schemas.keys());
  }
}

// Singleton instance
export const eventSchemaRegistry = new EventSchemaRegistry();
