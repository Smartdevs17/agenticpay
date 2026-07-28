export class PaymentError extends Error {
  constructor(
    message: string,
    public code: string = 'PAYMENT_ERROR',
    public statusCode: number = 400,
    public metadata?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'PaymentError';
  }
}

export class AuthError extends Error {
  constructor(
    message: string,
    public code: string = 'AUTH_ERROR',
    public statusCode: number = 401,
    public metadata?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

export class ProjectError extends Error {
  constructor(
    message: string,
    public code: string = 'PROJECT_ERROR',
    public statusCode: number = 400,
    public metadata?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ProjectError';
  }
}

export class DisputeError extends Error {
  constructor(
    message: string,
    public code: string = 'DISPUTE_ERROR',
    public statusCode: number = 400,
    public metadata?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'DisputeError';
  }
}

export class NotFoundError extends Error {
  constructor(
    message: string,
    public code: string = 'NOT_FOUND',
    public statusCode: number = 404,
    public metadata?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'NotFoundError';
  }
}

export class ValidationError extends Error {
  constructor(
    message: string,
    public code: string = 'VALIDATION_ERROR',
    public statusCode: number = 422,
    public metadata?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ValidationError';
  }
}
