export class AgenticPayError extends Error {
  readonly status?: number;
  readonly code?: string;
  readonly details?: unknown;

  constructor(message: string, options?: { status?: number; code?: string; details?: unknown }) {
    super(message);
    this.name = 'AgenticPayError';
    this.status = options?.status;
    this.code = options?.code;
    this.details = options?.details;
  }
}
