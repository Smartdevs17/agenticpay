import { Request, Response, NextFunction } from 'express';
import DOMPurify from 'dompurify';
import sanitizeHtml from 'sanitize-html';
import validator from 'validator';
import xss from 'xss';
import escape from 'escape-html';
import SQLString from 'sqlstring';

/**
 * Input Sanitization Middleware
 * Provides comprehensive protection against SQL injection, XSS, and command injection
 */

export interface SanitizeOptions {
  // SQL injection prevention
  sqlEscape?: boolean;
  sqlParameterize?: boolean;
  
  // XSS prevention
  xssProtection?: boolean;
  htmlSanitization?: boolean;
  escapeHtml?: boolean;
  
  // Input validation
  validateEmail?: boolean;
  validateUrl?: boolean;
  validateNumeric?: boolean;
  
  // Command injection prevention
  commandEscape?: boolean;
  
  // Custom sanitization rules
  customRules?: Array<(value: any) => any>;
}

export class InputSanitizer {
  private static instance: InputSanitizer;
  
  public static getInstance(): InputSanitizer {
    if (!InputSanitizer.instance) {
      InputSanitizer.instance = new InputSanitizer();
    }
    return InputSanitizer.instance;
  }

  /**
   * Main sanitization function
   */
  public sanitize(input: any, options: SanitizeOptions = {}): any {
    const defaultOptions: SanitizeOptions = {
      sqlEscape: true,
      sqlParameterize: true,
      xssProtection: true,
      htmlSanitization: true,
      escapeHtml: true,
      validateEmail: true,
      validateUrl: true,
      validateNumeric: true,
      commandEscape: true,
      customRules: []
    };

    const finalOptions = { ...defaultOptions, ...options };

    if (typeof input === 'string') {
      return this.sanitizeString(input, finalOptions);
    } else if (Array.isArray(input)) {
      return input.map(item => this.sanitize(item, finalOptions));
    } else if (typeof input === 'object' && input !== null) {
      return this.sanitizeObject(input, finalOptions);
    }

    return input;
  }

  /**
   * Sanitize string values
   */
  private sanitizeString(input: string, options: SanitizeOptions): string {
    let sanitized = input;

    // SQL Injection Prevention
    if (options.sqlEscape) {
      sanitized = this.escapeSql(sanitized);
    }

    // XSS Protection
    if (options.xssProtection) {
      sanitized = xss(sanitized);
    }

    // HTML Sanitization
    if (options.htmlSanitization) {
      sanitized = DOMPurify.sanitize(sanitized);
    }

    // HTML Escaping
    if (options.escapeHtml) {
      sanitized = escape(sanitized);
    }

    // Command Injection Prevention
    if (options.commandEscape) {
      sanitized = this.escapeCommands(sanitized);
    }

    // Apply custom rules
    if (options.customRules) {
      for (const rule of options.customRules) {
        sanitized = rule(sanitized);
      }
    }

    return sanitized;
  }

  /**
   * Sanitize object values recursively
   */
  private sanitizeObject(obj: any, options: SanitizeOptions): any {
    const sanitized: any = {};

    for (const [key, value] of Object.entries(obj)) {
      // Sanitize key names to prevent key injection
      const sanitizedKey = this.sanitizeKey(key);
      
      if (value === null || value === undefined) {
        sanitized[sanitizedKey] = value;
      } else if (typeof value === 'string') {
        sanitized[sanitizedKey] = this.sanitizeString(value, options);
      } else if (Array.isArray(value)) {
        sanitized[sanitizedKey] = value.map(item => this.sanitize(item, options));
      } else if (typeof value === 'object') {
        sanitized[sanitizedKey] = this.sanitizeObject(value, options);
      } else {
        sanitized[sanitizedKey] = value;
      }
    }

    return sanitized;
  }

  /**
   * Sanitize object keys
   */
  private sanitizeKey(key: string): string {
    // Remove dangerous characters from keys
    return key.replace(/[^a-zA-Z0-9_]/g, '');
  }

  /**
   * SQL injection escape
   */
  private escapeSql(input: string): string {
    return SQLString.escape(input).replace(/^'(.*)'$/, '$1');
  }

  /**
   * Command injection escape
   */
  private escapeCommands(input: string): string {
    // Remove dangerous shell characters
    const dangerousChars = ['|', '&', ';', '<', '>', '`', '$', '(', ')', '{', '}', '[', ']'];
    let escaped = input;
    
    for (const char of dangerousChars) {
      escaped = escaped.replace(new RegExp(`\\${char}`, 'g'), `\\${char}`);
    }
    
    return escaped;
  }

  /**
   * Validate and sanitize email
   */
  public sanitizeEmail(email: string): string | null {
    if (!validator.isEmail(email)) {
      return null;
    }
    return validator.normalizeEmail(email) || null;
  }

  /**
   * Validate and sanitize URL
   */
  public sanitizeUrl(url: string): string | null {
    if (!validator.isURL(url, { protocols: ['http', 'https'] })) {
      return null;
    }
    return validator.normalizeUrl(url);
  }

  /**
   * Validate and sanitize numeric input
   */
  public sanitizeNumeric(input: string): number | null {
    if (!validator.isNumeric(input)) {
      return null;
    }
    return parseFloat(input);
  }

  /**
   * Create parameterized SQL query
   */
  public createParameterizedQuery(query: string, params: any[]): { sql: string; values: any[] } {
    const sanitizedParams = params.map(param => this.sanitize(param, { sqlEscape: true }));
    
    // Replace ? placeholders with proper parameterization
    let index = 0;
    const sql = query.replace(/\?/g, () => {
      if (index < sanitizedParams.length) {
        const param = sanitizedParams[index++];
        return typeof param === 'string' ? `'${this.escapeSql(param)}'` : String(param);
      }
      return '?';
    });

    return { sql, values: sanitizedParams };
  }
}

/**
 * Express middleware for input sanitization
 */
export const sanitizeInput = (options: SanitizeOptions = {}) => {
  const sanitizer = InputSanitizer.getInstance();

  return (req: Request, res: Response, next: NextFunction) => {
    try {
      // Sanitize request body
      if (req.body) {
        req.body = sanitizer.sanitize(req.body, options);
      }

      // Sanitize query parameters
      if (req.query) {
        req.query = sanitizer.sanitize(req.query, options);
      }

      // Sanitize URL parameters
      if (req.params) {
        req.params = sanitizer.sanitize(req.params, options);
      }

      // Sanitize headers (excluding system headers)
      if (req.headers) {
        const safeHeaders = ['content-type', 'authorization', 'accept', 'user-agent'];
        for (const [key, value] of Object.entries(req.headers)) {
          if (safeHeaders.includes(key.toLowerCase()) && typeof value === 'string') {
            req.headers[key] = sanitizer.sanitizeString(value, options);
          }
        }
      }

      next();
    } catch (error) {
      console.error('Sanitization error:', error);
      res.status(400).json({
        error: 'Invalid input detected',
        message: 'Request contains malicious or malformed input'
      });
    }
  };
};

/**
 * Content Security Policy middleware
 */
export const contentSecurityPolicy = () => {
  return (req: Request, res: Response, next: NextFunction) => {
    const csp = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://vercel.live",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data: https: blob:",
      "connect-src 'self' https://api.stellar.org https://horizon-testnet.stellar.org",
      "frame-src 'none'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "upgrade-insecure-requests"
    ].join('; ');

    res.setHeader('Content-Security-Policy', csp);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');

    next();
  };
};

/**
 * Input validation middleware using Zod schemas
 */
export const validateInput = (schema: any) => {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      // Validate request body against schema
      if (req.body) {
        req.body = schema.parse(req.body);
      }

      // Validate query parameters
      if (req.query && schema.shape.query) {
        req.query = schema.shape.query.parse(req.query);
      }

      // Validate URL parameters
      if (req.params && schema.shape.params) {
        req.params = schema.shape.params.parse(req.params);
      }

      next();
    } catch (error) {
      console.error('Validation error:', error);
      res.status(400).json({
        error: 'Validation failed',
        message: 'Input does not match required format',
        details: error.errors
      });
    }
  };
};

/**
 * Rate limiting for brute force protection
 */
export const createSecurityRateLimit = (windowMs: number = 15 * 60 * 1000, max: number = 100) => {
  const requests = new Map<string, { count: number; resetTime: number }>();

  return (req: Request, res: Response, next: NextFunction) => {
    const clientIp = req.ip || req.connection.remoteAddress || 'unknown';
    const now = Date.now();
    const windowStart = now - windowMs;

    // Clean up old entries
    for (const [ip, data] of requests.entries()) {
      if (data.resetTime < now) {
        requests.delete(ip);
      }
    }

    // Get or create client data
    let clientData = requests.get(clientIp);
    if (!clientData) {
      clientData = { count: 0, resetTime: now + windowMs };
      requests.set(clientIp, clientData);
    }

    // Check if window has expired
    if (clientData.resetTime < now) {
      clientData.count = 0;
      clientData.resetTime = now + windowMs;
    }

    // Increment count
    clientData.count++;

    // Set rate limit headers
    res.setHeader('X-RateLimit-Limit', max);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, max - clientData.count));
    res.setHeader('X-RateLimit-Reset', new Date(clientData.resetTime).toISOString());

    // Check if limit exceeded
    if (clientData.count > max) {
      return res.status(429).json({
        error: 'Too many requests',
        message: 'Rate limit exceeded. Please try again later.',
        retryAfter: Math.ceil((clientData.resetTime - now) / 1000)
      });
    }

    next();
  };
};

export default InputSanitizer;
