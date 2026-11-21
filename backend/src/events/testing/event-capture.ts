import type { StoredEvent, DomainEventType } from '../event-types.js';

export interface CapturedEvent extends StoredEvent {
  capturedAt: string;
  handlerName?: string;
  type: string;
  aggregateId: string;
  aggregateType: string;
  version: number;
  payload: unknown;
}

export interface EventCaptureOptions {
  captureAll?: boolean;
  eventTypes?: DomainEventType[];
  aggregateId?: string;
  aggregateType?: string;
  maxEvents?: number;
}

export class EventCapture {
  private capturedEvents: CapturedEvent[] = [];
  private options: EventCaptureOptions;

  constructor(options: EventCaptureOptions = {}) {
    this.options = {
      captureAll: true,
      maxEvents: 1000,
      ...options,
    };
  }

  capture(event: StoredEvent, handlerName?: string): void {
    // Check if event should be captured based on filters
    if (!this.shouldCapture(event)) {
      return;
    }

    // Check max events limit
    if (this.options.maxEvents && this.capturedEvents.length >= this.options.maxEvents) {
      this.capturedEvents.shift(); // Remove oldest event
    }

    this.capturedEvents.push({
      ...event,
      capturedAt: new Date().toISOString(),
      handlerName,
    });
  }

  private shouldCapture(event: StoredEvent): boolean {
    if (!this.options.captureAll) {
      // If not capturing all, check specific filters
      if (this.options.eventTypes && this.options.eventTypes.length > 0) {
        if (!this.options.eventTypes.includes(event.type as DomainEventType)) {
          return false;
        }
      }

      if (this.options.aggregateId && event.aggregateId !== this.options.aggregateId) {
        return false;
      }

      if (this.options.aggregateType && event.aggregateType !== this.options.aggregateType) {
        return false;
      }
    }

    return true;
  }

  getEvents(): CapturedEvent[] {
    return [...this.capturedEvents];
  }

  getEventsByType(type: DomainEventType): CapturedEvent[] {
    return this.capturedEvents.filter((e) => e.type === type);
  }

  getEventsByAggregate(aggregateId: string): CapturedEvent[] {
    return this.capturedEvents.filter((e) => e.aggregateId === aggregateId);
  }

  getEventsByAggregateType(aggregateType: string): CapturedEvent[] {
    return this.capturedEvents.filter((e) => e.aggregateType === aggregateType);
  }

  clear(): void {
    this.capturedEvents = [];
  }

  count(): number {
    return this.capturedEvents.length;
  }

  isEmpty(): boolean {
    return this.capturedEvents.length === 0;
  }

  assertEventCount(expected: number): void {
    if (this.capturedEvents.length !== expected) {
      throw new Error(
        `Expected ${expected} events, but captured ${this.capturedEvents.length}`
      );
    }
  }

  assertEventExists(type: DomainEventType): void {
    if (!this.capturedEvents.some((e) => e.type === type)) {
      throw new Error(`Expected event of type '${type}' was not captured`);
    }
  }

  assertEventNotExists(type: DomainEventType): void {
    if (this.capturedEvents.some((e) => e.type === type)) {
      throw new Error(`Event of type '${type}' was captured but should not have been`);
    }
  }

  assertEventPayload<T>(type: DomainEventType, payload: Partial<T>): void {
    const event = this.capturedEvents.find((e) => e.type === type);
    if (!event) {
      throw new Error(`Event of type '${type}' was not captured`);
    }

    for (const [key, expectedValue] of Object.entries(payload)) {
      const actualValue = (event.payload as any)[key];
      if (actualValue !== expectedValue) {
        throw new Error(
          `Event payload mismatch for '${type}': expected ${key}=${JSON.stringify(expectedValue)}, got ${JSON.stringify(actualValue)}`
        );
      }
    }
  }

  assertEventOrder(expectedTypes: DomainEventType[]): void {
    const capturedTypes = this.capturedEvents.map((e) => e.type);
    const expectedString = expectedTypes.join(' -> ');
    const capturedString = capturedTypes.join(' -> ');

    if (JSON.stringify(capturedTypes) !== JSON.stringify(expectedTypes)) {
      throw new Error(
        `Event order mismatch. Expected: ${expectedString}, Got: ${capturedString}`
      );
    }
  }

  assertEventSequence(
    aggregateId: string,
    expectedVersions: number[]
  ): void {
    const events = this.getEventsByAggregate(aggregateId);
    const actualVersions = events.map((e) => e.version);

    if (JSON.stringify(actualVersions) !== JSON.stringify(expectedVersions)) {
      throw new Error(
        `Event sequence mismatch for aggregate ${aggregateId}. Expected versions: ${expectedVersions.join(', ')}, Got: ${actualVersions.join(', ')}`
      );
    }
  }

  getFirstEvent(): CapturedEvent | undefined {
    return this.capturedEvents[0];
  }

  getLastEvent(): CapturedEvent | undefined {
    return this.capturedEvents[this.capturedEvents.length - 1];
  }

  getEventAt(index: number): CapturedEvent | undefined {
    return this.capturedEvents[index];
  }

  toJSON(): string {
    return JSON.stringify(this.capturedEvents, null, 2);
  }

  fromJSON(json: string): void {
    this.capturedEvents = JSON.parse(json);
  }
}

export class EventCaptureManager {
  private captures: Map<string, EventCapture> = new Map();

  createCapture(name: string, options?: EventCaptureOptions): EventCapture {
    const capture = new EventCapture(options);
    this.captures.set(name, capture);
    return capture;
  }

  getCapture(name: string): EventCapture | undefined {
    return this.captures.get(name);
  }

  removeCapture(name: string): void {
    this.captures.delete(name);
  }

  clearAll(): void {
    this.captures.forEach((capture) => capture.clear());
    this.captures.clear();
  }

  getAllCaptures(): EventCapture[] {
    return Array.from(this.captures.values());
  }

  captureTo(name: string, event: StoredEvent, handlerName?: string): void {
    const capture = this.captures.get(name);
    if (capture) {
      capture.capture(event, handlerName);
    }
  }
}
