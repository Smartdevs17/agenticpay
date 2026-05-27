import { Request, Response, NextFunction } from 'express';
import { updateSessionActivity, getSession, checkSessionAnomaly } from '../services/session.js';

/**
 * Middleware to track session activity and detect anomalies.
 */
export function sessionMiddleware(req: Request, res: Response, next: NextFunction) {
  const sessionId = req.headers['x-session-id'] as string;
  
  if (sessionId) {
    const session = getSession(sessionId);
    
    if (session) {
      if (session.status === 'terminated') {
        return res.status(401).json({
          error: {
            code: 'SESSION_TERMINATED',
            message: 'Your session has been terminated. Please log in again.',
            status: 401
          }
        });
      }

      const currentIp = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '127.0.0.1';
      
      // Update activity
      updateSessionActivity(sessionId, currentIp);
      
      // Check for anomalies
      const anomaly = checkSessionAnomaly(session, currentIp);
      if (anomaly) {
        console.warn(`[Session Anomaly] ${anomaly} for session ${sessionId} (User: ${session.userId})`);
        res.setHeader('X-Session-Warning', anomaly);
      }
    }
  }
  
  next();
}
