import type { StoredEvent } from '../event-types.js';
import type { PersistentEventStore } from '../persistence/event-store.js';
import { eventSchemaRegistry } from '../schemas/index.js';

export interface ReplayOptions {
  fromSequence?: number;
  toSequence?: number;
  eventTypes?: string[];
  aggregateId?: string;
  aggregateType?: string;
  dryRun?: boolean;
  validateSchemas?: boolean;
  stopOnError?: boolean;
}

export interface ReplayResult {
  totalEvents: number;
  processedEvents: number;
  failedEvents: number;
  skippedEvents: number;
  errors: Array<{ event: StoredEvent; error: string }>;
  duration: number;
}

export interface EventHandler<T = unknown> {
  (event: StoredEvent<T>): void | Promise<void>;
}

export class EventReplayer {
  constructor(private readonly eventStore: PersistentEventStore) {}

  async replay(
    handler: EventHandler,
    options: ReplayOptions = {}
  ): Promise<ReplayResult> {
    const startTime = Date.now();
    const result: ReplayResult = {
      totalEvents: 0,
      processedEvents: 0,
      failedEvents: 0,
      skippedEvents: 0,
      errors: [],
      duration: 0,
    };

    try {
      // Fetch events based on filters
      let events: StoredEvent[] = [];

      if (options.aggregateId && options.aggregateType) {
        events = await this.eventStore.loadEvents(
          options.aggregateType,
          options.aggregateId,
          options.fromSequence ?? 0
        );
      } else if (options.eventTypes && options.eventTypes.length > 0) {
        // Get events by types
        for (const eventType of options.eventTypes) {
          const typeEvents = await this.eventStore.getEventsByType(eventType as any);
          events.push(...typeEvents);
        }
        events.sort((a, b) => a.sequenceNumber - b.sequenceNumber);
      } else {
        events = await this.eventStore.getAllEvents(options.fromSequence ?? 0);
      }

      // Filter by sequence range
      if (options.toSequence !== undefined) {
        events = events.filter((e) => e.sequenceNumber <= options.toSequence!);
      }

      result.totalEvents = events.length;

      // Process each event
      for (const event of events) {
        try {
          // Validate schema if enabled
          if (options.validateSchemas !== false) {
            if (eventSchemaRegistry.hasSchema(event.type)) {
              const validation = eventSchemaRegistry.safeValidate(event.type, event.payload);
              if (!validation.success) {
                result.failedEvents++;
                result.errors.push({
                  event,
                  error: `Schema validation failed: ${validation.error.errors.map(e => e.message).join(', ')}`,
                });
                if (options.stopOnError) {
                  break;
                }
                continue;
              }
            }
          }

          // Skip if dry run
          if (options.dryRun) {
            result.skippedEvents++;
            continue;
          }

          // Execute handler
          await handler(event);
          result.processedEvents++;
        } catch (error) {
          result.failedEvents++;
          result.errors.push({
            event,
            error: error instanceof Error ? error.message : String(error),
          });

          if (options.stopOnError) {
            break;
          }
        }
      }
    } catch (error) {
      result.errors.push({
        event: {} as StoredEvent,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    result.duration = Date.now() - startTime;
    return result;
  }

  async replayToState<T>(
    aggregateType: string,
    aggregateId: string,
    initialState: T,
    stateReducer: (state: T, event: StoredEvent) => T,
    options: ReplayOptions = {}
  ): Promise<T> {
    let state = initialState;

    await this.replay(async (event) => {
      state = stateReducer(state, event);
    }, {
      ...options,
      aggregateType,
      aggregateId,
    });

    return state;
  }

  async replayWithSnapshot<T>(
    aggregateType: string,
    aggregateId: string,
    stateReducer: (state: T, event: StoredEvent) => T,
    options: ReplayOptions = {}
  ): Promise<T> {
    // Try to load snapshot first
    const snapshot = await this.eventStore.getSnapshot(aggregateType, aggregateId);

    let initialState: T;
    let fromVersion = 0;

    if (snapshot) {
      initialState = snapshot.state as T;
      fromVersion = snapshot.version;
    } else {
      initialState = {} as T;
    }

    return this.replayToState(aggregateType, aggregateId, initialState, stateReducer, {
      ...options,
      fromSequence: fromVersion,
    });
  }

  async getEventTimeline(aggregateType: string, aggregateId: string): Promise<StoredEvent[]> {
    return this.eventStore.loadEvents(aggregateType, aggregateId);
  }

  async compareStates<T>(
    aggregateType: string,
    aggregateId: string,
    stateReducer: (state: T, event: StoredEvent) => T,
    currentState: T,
    options: ReplayOptions = {}
  ): Promise<{ matches: boolean; replayedState: T; differences: string[] }> {
    const replayedState = await this.replayToState(aggregateType, aggregateId, {} as T, stateReducer, options);

    const differences: string[] = [];

    // Simple deep comparison
    const compareObjects = (obj1: any, obj2: any, path = ''): void => {
      for (const key in obj1) {
        const value1 = obj1[key];
        const value2 = obj2[key];
        const currentPath = path ? `${path}.${key}` : key;

        if (value1 !== value2) {
          if (typeof value1 === 'object' && typeof value2 === 'object') {
            compareObjects(value1, value2, currentPath);
          } else {
            differences.push(`${currentPath}: ${JSON.stringify(value1)} !== ${JSON.stringify(value2)}`);
          }
        }
      }

      for (const key in obj2) {
        if (!(key in obj1)) {
          differences.push(`${path ? `${path}.${key}` : key}: missing in replayed state`);
        }
      }
    };

    compareObjects(currentState, replayedState);

    return {
      matches: differences.length === 0,
      replayedState,
      differences,
    };
  }
}
