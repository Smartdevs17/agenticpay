import { Request, Response, NextFunction } from 'express';
import { updateSessionActivity, getSession, checkSessionAnomaly } from '../services/session.js';
import { AppError } from './errorHandler.js';
import { logger } from './logger.js';

export function sessionMiddleware(req: Request, res: Response, next: NextFunction) {
  const sessionId = req.headers['x-session-id'] as string;

  if (sessionId) {
    const session = getSession(sessionId);

    if (session) {
      if (session.status === 'terminated') {
        next(new AppError(401, 'Your session has been terminated. Please log in again.', 'SESSION_TERMINATED'));
        return;
      }

      const currentIp = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '127.0.0.1';

      updateSessionActivity(sessionId, currentIp);

      const anomaly = checkSessionAnomaly(session, currentIp);
      if (anomaly) {
        logger.warn({ sessionId, userId: session.userId, anomaly }, 'Session anomaly detected');
        res.setHeader('X-Session-Warning', anomaly);
      }
    }
  }

  next();
}
