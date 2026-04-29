/**
 * HTTP surface for the MPC threshold-signing service.
 *
 * Endpoints are intentionally thin — validation goes through the Zod
 * schemas in `../schemas/mpc.ts`, and orchestration lives in
 * `../services/mpc/coordinator.ts`. Keep error messages generic here;
 * the service layer throws `Error` with rich context that the global
 * errorHandler serialises for the client.
 */
import { Router } from 'express';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import { validate } from '../middleware/validate.js';
import {
  addMemberSchema,
  ceremonySchema,
  contributeSchema,
  registerNodeSchema,
  rotateKeySchema,
  signingRequestSchema,
} from '../schemas/mpc.js';
import {
  addMember,
  contribute,
  getKey,
  getSigningSession,
  getStatus,
  listCeremonies,
  listKeys,
  removeMember,
  revokeKey,
  rotateKey,
  runCeremony,
  startSigningSession,
} from '../services/mpc/coordinator.js';
import {
  clearNodes as _clearNodesUnused,
  getNode,
  heartbeat,
  listNodes,
  registerNode,
  unregisterNode,
} from '../services/mpc/nodes.js';

// `clearNodes` is intentionally not re-exported through the HTTP API —
// it is a test-only helper. Marking it unused keeps it out of the
// public surface without forcing a separate import file.
void _clearNodesUnused;

export const mpcRouter = Router();

// Route params are typed as `string | string[] | undefined` under
// Express's generic `ParamsDictionary`, but every route we define here
// uses the scalar `:id` / `:nodeId` shape. This helper narrows the type
// once instead of casting at every call site (same pattern as
// `routes/splits.ts::firstParam`).
const paramId = (value: string | string[] | undefined): string =>
  Array.isArray(value) ? (value[0] ?? '') : (value ?? '');

/* -------------------- nodes -------------------- */

mpcRouter.get(
  '/nodes',
  asyncHandler(async (_req, res) => {
    res.json({ data: listNodes(), timestamp: new Date() });
  }),
);

mpcRouter.post(
  '/nodes',
  validate(registerNodeSchema),
  asyncHandler(async (req, res) => {
    try {
      const node = registerNode(req.body);
      res.status(201).json({ data: node, timestamp: new Date() });
    } catch (err) {
      throw translate(err, 400, 'NODE_REGISTRATION_FAILED');
    }
  }),
);

mpcRouter.post(
  '/nodes/:id/heartbeat',
  asyncHandler(async (req, res) => {
    const id = paramId(req.params.id);
    const node = heartbeat(id);
    if (!node) throw new AppError(404, `unknown node ${id}`, 'NODE_NOT_FOUND');
    res.json({ data: node, timestamp: new Date() });
  }),
);

mpcRouter.delete(
  '/nodes/:id',
  asyncHandler(async (req, res) => {
    const id = paramId(req.params.id);
    const removed = unregisterNode(id);
    if (!removed) throw new AppError(404, `unknown node ${id}`, 'NODE_NOT_FOUND');
    res.status(204).end();
  }),
);

mpcRouter.get(
  '/nodes/:id',
  asyncHandler(async (req, res) => {
    const id = paramId(req.params.id);
    const node = getNode(id);
    if (!node) throw new AppError(404, `unknown node ${id}`, 'NODE_NOT_FOUND');
    res.json({ data: node, timestamp: new Date() });
  }),
);

/* -------------------- keys & ceremonies -------------------- */

mpcRouter.post(
  '/ceremony',
  validate(ceremonySchema),
  asyncHandler(async (req, res) => {
    try {
      const result = runCeremony(req.body);
      res.status(201).json({ data: result, timestamp: new Date() });
    } catch (err) {
      throw translate(err, 400, 'CEREMONY_FAILED');
    }
  }),
);

mpcRouter.get(
  '/ceremony',
  asyncHandler(async (_req, res) => {
    res.json({ data: listCeremonies(), timestamp: new Date() });
  }),
);

mpcRouter.get(
  '/keys',
  asyncHandler(async (_req, res) => {
    res.json({ data: listKeys(), timestamp: new Date() });
  }),
);

mpcRouter.get(
  '/keys/:id',
  asyncHandler(async (req, res) => {
    const id = paramId(req.params.id);
    const key = getKey(id);
    if (!key) throw new AppError(404, `unknown key ${id}`, 'KEY_NOT_FOUND');
    res.json({ data: key, timestamp: new Date() });
  }),
);

mpcRouter.post(
  '/keys/:id/rotate',
  validate(rotateKeySchema),
  asyncHandler(async (req, res) => {
    try {
      const key = rotateKey({ keyId: paramId(req.params.id), ...req.body });
      res.json({ data: key, timestamp: new Date() });
    } catch (err) {
      throw translate(err, 400, 'KEY_ROTATION_FAILED');
    }
  }),
);

mpcRouter.post(
  '/keys/:id/members',
  validate(addMemberSchema),
  asyncHandler(async (req, res) => {
    try {
      const key = await addMember(paramId(req.params.id), req.body.nodeId);
      res.json({ data: key, timestamp: new Date() });
    } catch (err) {
      throw translate(err, 400, 'MEMBER_ADD_FAILED');
    }
  }),
);

mpcRouter.delete(
  '/keys/:id/members/:nodeId',
  asyncHandler(async (req, res) => {
    try {
      const key = await removeMember(
        paramId(req.params.id),
        paramId(req.params.nodeId),
      );
      res.json({ data: key, timestamp: new Date() });
    } catch (err) {
      throw translate(err, 400, 'MEMBER_REMOVE_FAILED');
    }
  }),
);

mpcRouter.post(
  '/keys/:id/revoke',
  asyncHandler(async (req, res) => {
    const id = paramId(req.params.id);
    const key = revokeKey(id);
    if (!key) throw new AppError(404, `unknown key ${id}`, 'KEY_NOT_FOUND');
    res.json({ data: key, timestamp: new Date() });
  }),
);

/* -------------------- signing sessions -------------------- */

mpcRouter.post(
  '/sign',
  validate(signingRequestSchema),
  asyncHandler(async (req, res) => {
    try {
      const session = startSigningSession({
        keyId: req.body.keyId,
        payload: Buffer.from(req.body.payload, 'hex'),
        requestedBy: req.body.requestedBy,
        timeoutMs: req.body.timeoutMs,
      });
      res.status(201).json({ data: session, timestamp: new Date() });
    } catch (err) {
      throw translate(err, 400, 'SIGN_REQUEST_FAILED');
    }
  }),
);

mpcRouter.get(
  '/sign/:id',
  asyncHandler(async (req, res) => {
    const id = paramId(req.params.id);
    const session = getSigningSession(id);
    if (!session) {
      throw new AppError(404, `unknown session ${id}`, 'SESSION_NOT_FOUND');
    }
    res.json({ data: session, timestamp: new Date() });
  }),
);

mpcRouter.post(
  '/sign/:id/contribute',
  validate(contributeSchema),
  asyncHandler(async (req, res) => {
    try {
      const result = await contribute({
        sessionId: paramId(req.params.id),
        nodeId: req.body.nodeId,
        approvalSignatureHex: req.body.approvalSignature,
      });
      res.json({ data: result, timestamp: new Date() });
    } catch (err) {
      throw translate(err, 400, 'CONTRIBUTE_FAILED');
    }
  }),
);

/* -------------------- status -------------------- */

mpcRouter.get(
  '/status',
  asyncHandler(async (_req, res) => {
    res.json({ data: getStatus(), timestamp: new Date() });
  }),
);

function translate(err: unknown, statusCode: number, code: string): AppError {
  if (err instanceof AppError) return err;
  const message = err instanceof Error ? err.message : String(err);
  return new AppError(statusCode, message, code);
}
