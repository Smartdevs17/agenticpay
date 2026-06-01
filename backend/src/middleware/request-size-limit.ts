import { Request, Response, NextFunction } from 'express';

const DEFAULT_MAX_BYTES = 1 * 1024 * 1024; // 1 MB JSON bodies
const UPLOAD_MAX_BYTES = 25 * 1024 * 1024; // 25 MB multipart uploads

export interface RequestSizeLimitOptions {
  maxBytes?: number;
  uploadPaths?: string[];
  uploadMaxBytes?: number;
}

/**
 * Reject oversized request bodies before they reach route handlers.
 */
export function requestSizeLimit(options: RequestSizeLimitOptions = {}) {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const uploadMaxBytes = options.uploadMaxBytes ?? UPLOAD_MAX_BYTES;
  const uploadPaths = options.uploadPaths ?? ['/api/v1/uploads', '/api/v1/forms'];

  return (req: Request, res: Response, next: NextFunction) => {
    const contentLength = Number(req.headers['content-length'] ?? 0);
    if (!contentLength) return next();

    const isUpload = uploadPaths.some((path) => req.path.startsWith(path));
    const limit = isUpload ? uploadMaxBytes : maxBytes;

    if (contentLength > limit) {
      return res.status(413).json({
        error: 'PAYLOAD_TOO_LARGE',
        message: 'Request body exceeds the allowed size limit',
      });
    }

    next();
  };
}

export default requestSizeLimit;
