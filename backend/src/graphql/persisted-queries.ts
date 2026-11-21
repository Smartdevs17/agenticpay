type PersistedRecord = {
  id: string;
  query: string;
  registeredAt: string;
};

class PersistedQueryRegistry {
  private queries = new Map<string, PersistedRecord>();

  register(id: string, query: string): PersistedRecord {
    const record: PersistedRecord = {
      id,
      query,
      registeredAt: new Date().toISOString(),
    };
    this.queries.set(id, record);
    return record;
  }

  get(id: string): PersistedRecord | undefined {
    return this.queries.get(id);
  }

  has(id: string): boolean {
    return this.queries.has(id);
  }

  ids(): Set<string> {
    return new Set([...this.queries.keys()]);
  }
}

export const persistedQueryRegistry = new PersistedQueryRegistry();