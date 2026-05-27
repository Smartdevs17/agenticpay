import { randomUUID } from 'node:crypto';

export type ServiceStatus = 'healthy' | 'degraded' | 'unhealthy' | 'unknown';

export interface ServiceInstance {
  id: string;
  name: string;
  version: string;
  host: string;
  port: number;
  protocol: 'http' | 'grpc';
  status: ServiceStatus;
  metadata: Record<string, string>;
  registeredAt: string;
  lastHeartbeatAt: string;
  ttlSeconds: number;
}

export interface ServiceEndpoint {
  name: string;
  instances: ServiceInstance[];
  loadBalancingPolicy: 'round_robin' | 'least_connections' | 'random';
}

const registry = new Map<string, ServiceInstance>();
const serviceIndex = new Map<string, Set<string>>();
let rrCounters = new Map<string, number>();

const HEARTBEAT_TIMEOUT_MS = 30_000;

export function registerService(input: Omit<ServiceInstance, 'id' | 'registeredAt' | 'lastHeartbeatAt'>): ServiceInstance {
  const instance: ServiceInstance = {
    ...input,
    id: randomUUID(),
    registeredAt: new Date().toISOString(),
    lastHeartbeatAt: new Date().toISOString(),
  };

  registry.set(instance.id, instance);
  const ids = serviceIndex.get(instance.name) ?? new Set<string>();
  ids.add(instance.id);
  serviceIndex.set(instance.name, ids);

  return instance;
}

export function deregisterService(instanceId: string): boolean {
  const instance = registry.get(instanceId);
  if (!instance) return false;

  registry.delete(instanceId);
  const ids = serviceIndex.get(instance.name);
  if (ids) ids.delete(instanceId);

  return true;
}

export function heartbeat(instanceId: string): ServiceInstance | undefined {
  const instance = registry.get(instanceId);
  if (!instance) return undefined;

  instance.lastHeartbeatAt = new Date().toISOString();
  instance.status = 'healthy';
  registry.set(instanceId, instance);
  return instance;
}

export function updateServiceStatus(instanceId: string, status: ServiceStatus): ServiceInstance | undefined {
  const instance = registry.get(instanceId);
  if (!instance) return undefined;
  instance.status = status;
  registry.set(instanceId, instance);
  return instance;
}

export function getService(instanceId: string): ServiceInstance | undefined {
  return registry.get(instanceId);
}

export function getServiceEndpoint(name: string): ServiceEndpoint {
  const ids = serviceIndex.get(name) ?? new Set<string>();
  const instances = Array.from(ids)
    .map((id) => registry.get(id))
    .filter((i): i is ServiceInstance => i !== undefined);

  return { name, instances, loadBalancingPolicy: 'round_robin' };
}

export function resolveInstance(name: string): ServiceInstance | undefined {
  const endpoint = getServiceEndpoint(name);
  const healthy = endpoint.instances.filter((i) => i.status === 'healthy' || i.status === 'degraded');
  if (healthy.length === 0) return undefined;

  const counter = rrCounters.get(name) ?? 0;
  const selected = healthy[counter % healthy.length];
  rrCounters.set(name, counter + 1);
  return selected;
}

export function getAllServices(): ServiceInstance[] {
  return Array.from(registry.values());
}

export function pruneStaleInstances(): number {
  const cutoff = Date.now() - HEARTBEAT_TIMEOUT_MS;
  let pruned = 0;

  for (const instance of registry.values()) {
    if (new Date(instance.lastHeartbeatAt).getTime() < cutoff) {
      instance.status = 'unhealthy';
      registry.set(instance.id, instance);
      pruned += 1;
    }
  }

  return pruned;
}

export function getRegistryStats() {
  const all = Array.from(registry.values());
  return {
    total: all.length,
    healthy: all.filter((i) => i.status === 'healthy').length,
    degraded: all.filter((i) => i.status === 'degraded').length,
    unhealthy: all.filter((i) => i.status === 'unhealthy').length,
    services: Array.from(serviceIndex.keys()),
  };
}
