import { Router } from 'express';
import { AppError, asyncHandler } from '../middleware/errorHandler.js';
import { cacheControl, CacheTTL } from '../middleware/cache.js';
import {
  registerService,
  deregisterService,
  heartbeat,
  updateServiceStatus,
  getService,
  getServiceEndpoint,
  resolveInstance,
  getAllServices,
  pruneStaleInstances,
  getRegistryStats,
} from '../services/service-registry.js';
import {
  getCircuitState,
  getAllCircuits,
  resetCircuit,
} from '../middleware/circuit-breaker.js';
import type { ServiceStatus } from '../services/service-registry.js';

export const serviceMeshRouter = Router();

// Service Registry
serviceMeshRouter.post(
  '/registry/register',
  asyncHandler(async (req, res) => {
    const { name, version, host, port, protocol, metadata, ttlSeconds } = req.body as {
      name?: string;
      version?: string;
      host?: string;
      port?: number;
      protocol?: 'http' | 'grpc';
      metadata?: Record<string, string>;
      ttlSeconds?: number;
    };

    if (!name || !host || !port) {
      throw new AppError(400, 'name, host and port are required', 'VALIDATION_ERROR');
    }

    const instance = registerService({
      name,
      version: version ?? '1.0.0',
      host,
      port,
      protocol: protocol ?? 'http',
      status: 'healthy',
      metadata: metadata ?? {},
      ttlSeconds: ttlSeconds ?? 30,
    });

    res.status(201).json(instance);
  })
);

serviceMeshRouter.delete(
  '/registry/:instanceId',
  asyncHandler(async (req, res) => {
    const deregistered = deregisterService(req.params.instanceId);
    if (!deregistered) throw new AppError(404, 'Service instance not found', 'NOT_FOUND');
    res.json({ message: 'Service deregistered', instanceId: req.params.instanceId });
  })
);

serviceMeshRouter.post(
  '/registry/:instanceId/heartbeat',
  asyncHandler(async (req, res) => {
    const instance = heartbeat(req.params.instanceId);
    if (!instance) throw new AppError(404, 'Service instance not found', 'NOT_FOUND');
    res.json(instance);
  })
);

serviceMeshRouter.patch(
  '/registry/:instanceId/status',
  asyncHandler(async (req, res) => {
    const { status } = req.body as { status?: ServiceStatus };
    if (!status) throw new AppError(400, 'status is required', 'VALIDATION_ERROR');

    const instance = updateServiceStatus(req.params.instanceId, status);
    if (!instance) throw new AppError(404, 'Service instance not found', 'NOT_FOUND');
    res.json(instance);
  })
);

serviceMeshRouter.get(
  '/registry',
  cacheControl({ maxAge: CacheTTL.SHORT }),
  asyncHandler(async (_req, res) => {
    res.json(getAllServices());
  })
);

serviceMeshRouter.get(
  '/registry/stats',
  cacheControl({ maxAge: CacheTTL.SHORT }),
  asyncHandler(async (_req, res) => {
    res.json(getRegistryStats());
  })
);

serviceMeshRouter.get(
  '/registry/:instanceId',
  cacheControl({ maxAge: CacheTTL.SHORT }),
  asyncHandler(async (req, res) => {
    const instance = getService(req.params.instanceId);
    if (!instance) throw new AppError(404, 'Service instance not found', 'NOT_FOUND');
    res.json(instance);
  })
);

serviceMeshRouter.get(
  '/discover/:serviceName',
  asyncHandler(async (req, res) => {
    const endpoint = getServiceEndpoint(req.params.serviceName);
    res.json(endpoint);
  })
);

serviceMeshRouter.get(
  '/resolve/:serviceName',
  asyncHandler(async (req, res) => {
    const instance = resolveInstance(req.params.serviceName);
    if (!instance) throw new AppError(503, `No healthy instances for service ${req.params.serviceName}`, 'SERVICE_UNAVAILABLE');
    res.json(instance);
  })
);

serviceMeshRouter.post(
  '/registry/prune',
  asyncHandler(async (_req, res) => {
    const pruned = pruneStaleInstances();
    res.json({ pruned, message: `${pruned} stale instances marked unhealthy` });
  })
);

// Circuit Breakers
serviceMeshRouter.get(
  '/circuits',
  cacheControl({ maxAge: CacheTTL.SHORT }),
  asyncHandler(async (_req, res) => {
    res.json(getAllCircuits());
  })
);

serviceMeshRouter.get(
  '/circuits/:name',
  cacheControl({ maxAge: CacheTTL.SHORT }),
  asyncHandler(async (req, res) => {
    res.json(getCircuitState(req.params.name));
  })
);

serviceMeshRouter.post(
  '/circuits/:name/reset',
  asyncHandler(async (req, res) => {
    resetCircuit(req.params.name);
    res.json({ message: `Circuit ${req.params.name} reset to closed state` });
  })
);
