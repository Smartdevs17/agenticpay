import type { Request, Response, NextFunction } from 'express';
import type { Readable } from 'node:stream';
import { streamingExportService } from '../services/exports/streaming-export.js';

/**
 * Middleware that monitors client disconnections during streaming responses
 * and cancels the associated export job + database query when the client
 * disconnects early.
 */
export function streamCancel(exportIdExtractor: (req: Request) => string | undefined) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const exportId = exportIdExtractor(req);
    if (!exportId) {
      next();
      return;
    }

    const onClose = () => {
      const jobResult = streamingExportService.getJob(exportId);
      if (jobResult.ok && jobResult.value.status === 'running') {
        streamingExportService.cancelExport(exportId);
      }
      cleanup();
    };

    const onError = () => {
      const jobResult = streamingExportService.getJob(exportId);
      if (jobResult.ok && jobResult.value.status === 'running') {
        streamingExportService.cancelExport(exportId);
      }
      cleanup();
    };

    const cleanup = () => {
      req.removeListener('close', onClose);
      req.removeListener('error', onError);
    };

    req.on('close', onClose);
    req.on('error', onError);

    next();
  };
}

/**
 * Pipe a readable stream to the HTTP response with automatic cleanup
 * on client disconnect. Sets appropriate headers for streaming downloads.
 */
export function pipeStreamToResponse(params: {
  stream: Readable;
  res: Response;
  req: Request;
  exportId: string;
  filename: string;
  contentType: string;
}): void {
  const { stream, res, req, exportId, filename, contentType } = params;

  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Transfer-Encoding', 'chunked');
  res.setHeader('X-Export-Id', exportId);
  res.setHeader('Cache-Control', 'no-cache');

  const onClientClose = () => {
    stream.destroy();
    streamingExportService.cancelExport(exportId);
  };

  req.on('close', onClientClose);

  stream.on('error', (err) => {
    req.removeListener('close', onClientClose);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Stream error', message: err.message });
    } else {
      res.end();
    }
  });

  stream.on('end', () => {
    req.removeListener('close', onClientClose);
  });

  stream.pipe(res);
}
