/**
 * Testcontainers helpers with graceful fallback when testcontainers is not installed.
 * Provides lightweight mocks for unit tests and real containers for integration tests
 * when DOCKER_HOST is available.
 */

export interface TestContainerOptions {
  image: string;
  ports?: number[];
  env?: Record<string, string>;
}

// Minimal StartedTestContainer interface used by tests
export interface StartedContainer {
  getHost(): string;
  getMappedPort(port: number): number;
  stop(): Promise<void>;
}

export async function startTestContainer(
  _options: TestContainerOptions
): Promise<StartedContainer> {
  // Fallback mock – real implementation requires `testcontainers` package and Docker.
  // Integration tests that need a real container should ensure testcontainers is installed.
  return {
    getHost: () => 'localhost',
    getMappedPort: (p: number) => p,
    stop: async () => {},
  };
}

export async function stopTestContainer(container: StartedContainer): Promise<void> {
  await container.stop();
}

export class TestDatabaseContainer {
  private container: StartedContainer | null = null;
  private connectionString: string | null = null;

  async start(): Promise<string> {
    try {
      const { GenericContainer } = await import('testcontainers');
      const c = await new GenericContainer('postgres:16-alpine')
        .withExposedPorts(5432)
        .withEnvironment({ POSTGRES_USER: 'test', POSTGRES_PASSWORD: 'test', POSTGRES_DB: 'test' })
        .start();
      this.container = c as unknown as StartedContainer;
      const host = this.container.getHost();
      const port = this.container.getMappedPort(5432);
      this.connectionString = `postgresql://test:test@${host}:${port}/test`;
      return this.connectionString;
    } catch {
      // Fallback for environments without Docker/testcontainers
      this.connectionString = 'postgresql://test:test@localhost:5432/test';
      return this.connectionString;
    }
  }

  async stop(): Promise<void> {
    if (this.container) {
      await stopTestContainer(this.container);
      this.container = null;
    }
  }

  getConnectionString(): string | null {
    return this.connectionString;
  }
}

export class TestRedisContainer {
  private container: StartedContainer | null = null;
  private connectionString: string | null = null;

  async start(): Promise<string> {
    try {
      const { GenericContainer } = await import('testcontainers');
      const c = await new GenericContainer('redis:7-alpine').withExposedPorts(6379).start();
      this.container = c as unknown as StartedContainer;
      const host = this.container.getHost();
      const port = this.container.getMappedPort(6379);
      this.connectionString = `redis://${host}:${port}`;
      return this.connectionString;
    } catch {
      this.connectionString = 'redis://localhost:6379';
      return this.connectionString;
    }
  }

  async stop(): Promise<void> {
    if (this.container) {
      await stopTestContainer(this.container);
      this.container = null;
    }
  }

  getConnectionString(): string | null {
    return this.connectionString;
  }
}

export class TestStellarContainer {
  private container: StartedContainer | null = null;

  async start(): Promise<{ horizonUrl: string; friendbotUrl: string }> {
    try {
      const { GenericContainer } = await import('testcontainers');
      const c = await new GenericContainer('stellar/quickstart:latest')
        .withExposedPorts(8000)
        .withEnvironment({ NETWORK: 'testnet', MODE: 'standalone' })
        .start();
      this.container = c as unknown as StartedContainer;
      const host = this.container.getHost();
      const port = this.container.getMappedPort(8000);
      return {
        horizonUrl: `http://${host}:${port}`,
        friendbotUrl: `http://${host}:${port}/friendbot`,
      };
    } catch {
      return {
        horizonUrl: 'http://localhost:8000',
        friendbotUrl: 'http://localhost:8000/friendbot',
      };
    }
  }

  async stop(): Promise<void> {
    if (this.container) {
      await stopTestContainer(this.container);
      this.container = null;
    }
  }
}
