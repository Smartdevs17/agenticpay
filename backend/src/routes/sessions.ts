import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { 
  getUserSessions, 
  terminateSession, 
  terminateOtherSessions, 
  getSessionHistory,
  trustDevice,
  createSession
} from '../services/session.js';
import { AppError } from '../middleware/errorHandler.js';
import { bruteForceProtection, recordLoginAttempt } from '../middleware/brute-force.js';
import { lockoutManager } from '../services/auth/lockout-manager.js';

export const sessionsRouter = Router();

// Mock user ID middleware for demo purposes
// In a real app, this would come from the auth middleware
const getUserId = (req: any) => req.headers['x-user-id'] || 'user_default';

// Get active sessions
sessionsRouter.get('/', asyncHandler(async (req, res) => {
  const userId = getUserId(req);
  const sessions = getUserSessions(userId);
  res.json({ sessions });
}));

// Get session history
sessionsRouter.get('/history', asyncHandler(async (req, res) => {
  const userId = getUserId(req);
  const history = getSessionHistory(userId);
  res.json({ history });
}));

// Create a new session (Mock login)
sessionsRouter.post('/login', bruteForceProtection({
  accountResolver: (req) => String(req.headers['x-user-id'] ?? req.body?.email ?? 'user_default'),
}), asyncHandler(async (req, res) => {
  const userId = getUserId(req);
  const { deviceId, browser, os } = req.body;
  
  const ip = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '127.0.0.1';
  
  const session = createSession(userId, {
    deviceId: deviceId || 'unknown',
    browser: browser || req.headers['user-agent'] || 'unknown',
    os: os || 'unknown',
    ip
  });

  await recordLoginAttempt(req, true);
  
  res.json({ session });
}));

sessionsRouter.post('/login/failure', bruteForceProtection({
  accountResolver: (req) => String(req.headers['x-user-id'] ?? req.body?.email ?? 'user_default'),
}), asyncHandler(async (req, res) => {
  const result = await recordLoginAttempt(req, false, 'invalid_credentials');
  res.status(result.lockedUntil ? 423 : 401).json({
    error: result.lockedUntil ? 'Account locked' : 'Invalid credentials',
    lockedUntil: result.lockedUntil ? new Date(result.lockedUntil).toISOString() : undefined,
    captchaRequired: res.locals.lockoutStatus?.captchaRequired ?? false,
    unlockToken: process.env.NODE_ENV === 'production' ? undefined : result.unlockToken,
  });
}));

sessionsRouter.post('/unlock', asyncHandler(async (req, res) => {
  const userId = String(req.body?.userId ?? getUserId(req));
  const unlocked = lockoutManager.unlockAccount(userId, typeof req.body?.token === 'string' ? req.body.token : undefined);
  if (!unlocked) throw new AppError(404, 'No lockout found for account', 'LOCKOUT_NOT_FOUND');
  res.json({ success: true });
}));

// Terminate a specific session
sessionsRouter.delete('/:id', asyncHandler(async (req, res) => {
  const id = req.params.id as string;
  const success = terminateSession(id);
  
  if (!success) {
    throw new AppError(404, 'Session not found', 'SESSION_NOT_FOUND');
  }
  
  res.json({ success: true });
}));

// Terminate all other sessions
sessionsRouter.delete('/others/:currentId', asyncHandler(async (req, res) => {
  const userId = getUserId(req);
  const currentId = req.params.currentId as string;
  
  const count = terminateOtherSessions(userId, currentId);
  res.json({ success: true, terminatedCount: count });
}));

// Trust a device
sessionsRouter.post('/:id/trust', asyncHandler(async (req, res) => {
  const id = req.params.id as string;
  const success = trustDevice(id);
  
  if (!success) {
    throw new AppError(404, 'Session not found', 'SESSION_NOT_FOUND');
  }
  
  res.json({ success: true });
}));
