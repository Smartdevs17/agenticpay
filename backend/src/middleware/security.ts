import { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { InputSanitizer, sanitizeInput, contentSecurityPolicy, createSecurityRateLimit } from './sanitize';

/**
 * Comprehensive Security Middleware Stack
 * Implements defense-in-depth security measures
 */

export class SecurityMiddleware {
  private static instance: SecurityMiddleware;
  private sanitizer: InputSanitizer;

  constructor() {
    this.sanitizer = InputSanitizer.getInstance();
  }

  public static getInstance(): SecurityMiddleware {
    if (!SecurityMiddleware.instance) {
      SecurityMiddleware.instance = new SecurityMiddleware();
    }
    return SecurityMiddleware.instance;
  }

  /**
   * Apply all security middleware
   */
  public applySecurity(app: any): void {
    // 1. Helmet for basic security headers
    app.use(helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://vercel.live"],
          styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
          fontSrc: ["'self'", "https://fonts.gstatic.com"],
          imgSrc: ["'self'", "data:", "https:", "blob:"],
          connectSrc: ["'self'", "https://api.stellar.org", "https://horizon-testnet.stellar.org"],
          frameSrc: ["'none'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          frameAncestors: ["'none'"],
          upgradeInsecureRequests: []
        }
      },
      hsts: {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true
      }
    }));

    // 2. Content Security Policy
    app.use(contentSecurityPolicy());

    // 3. Rate limiting
    app.use(this.createRateLimits());

    // 4. Input sanitization
    app.use(sanitizeInput({
      sqlEscape: true,
      xssProtection: true,
      htmlSanitization: true,
      commandEscape: true
    }));

    // 5. Request logging for security monitoring
    app.use(this.securityLogger);
  }

  /**
   * Create rate limiting middleware
   */
  private createRateLimits() {
    // General rate limit
    const generalLimit = rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 100, // limit each IP to 100 requests per windowMs
      message: {
        error: 'Too many requests',
        message: 'Rate limit exceeded. Please try again later.'
      },
      standardHeaders: true,
      legacyHeaders: false,
    });

    // Strict rate limit for sensitive endpoints
    const strictLimit = rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 10, // limit each IP to 10 requests per windowMs
      message: {
        error: 'Too many requests',
        message: 'Rate limit exceeded for sensitive operations.'
      },
      standardHeaders: true,
      legacyHeaders: false,
    });

    return (req: Request, res: Response, next: NextFunction) => {
      // Apply strict limit to sensitive endpoints
      const sensitivePaths = [
        '/api/v1/auth/login',
        '/api/v1/auth/register',
        '/api/v1/verification/verify',
        '/api/v1/invoice/create'
      ];

      const isSensitive = sensitivePaths.some(path => req.path.startsWith(path));
      
      if (isSensitive) {
        return strictLimit(req, res, next);
      } else {
        return generalLimit(req, res, next);
      }
    };
  }

  /**
   * Security request logger
   */
  private securityLogger(req: Request, res: Response, next: NextFunction): void {
    const startTime = Date.now();
    
    // Log potentially dangerous requests
    const suspiciousPatterns = [
      /\b(select|insert|update|delete|drop|union|exec|script)\b/i,
      /<script[^>]*>.*?<\/script>/gi,
      /javascript:/gi,
      /on\w+\s*=/gi,
      /['"]\s*;\s*['"]/gi,
      /\.\.\//g
    ];

    const isSuspicious = suspiciousPatterns.some(pattern => 
      pattern.test(JSON.stringify({
        body: req.body,
        query: req.query,
        params: req.params
      }))
    );

    if (isSuspicious) {
      console.warn('🚨 Suspicious request detected:', {
        ip: req.ip,
        method: req.method,
        path: req.path,
        userAgent: req.get('User-Agent'),
        timestamp: new Date().toISOString(),
        body: req.body,
        query: req.query,
        params: req.params
      });
    }

    // Continue with request
    res.on('finish', () => {
      const duration = Date.now() - startTime;
      
      if (isSuspicious || res.statusCode >= 400) {
        console.warn('🔒 Security event:', {
          ip: req.ip,
          method: req.method,
          path: req.path,
          statusCode: res.statusCode,
          duration,
          timestamp: new Date().toISOString()
        });
      }
    });

    next();
  }
}

/**
 * SQL Injection Prevention Helper
 */
export class SQLInjectionPrevention {
  /**
   * Validate SQL query parameters
   */
  public static validateQueryParams(params: any[]): boolean {
    const dangerousPatterns = [
      /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|UNION|EXEC|SCRIPT)\b)/i,
      /(\b(OR|AND)\s+\d+\s*=\s*\d+)/i,
      /(--|\/\*|\*\/|;)/,
      /(\b(WAITFOR|DELAY)\b)/i,
      /(\b(BENCHMARK|SLEEP)\b)/i
    ];

    for (const param of params) {
      if (typeof param === 'string') {
        for (const pattern of dangerousPatterns) {
          if (pattern.test(param)) {
            console.warn('🚨 Potential SQL injection detected:', param);
            return false;
          }
        }
      }
    }

    return true;
  }

  /**
   * Create safe SQL query with parameterization
   */
  public static createSafeQuery(template: string, params: any[]): { query: string; safeParams: any[] } {
    if (!this.validateQueryParams(params)) {
      throw new Error('Invalid SQL parameters detected');
    }

    // Simple parameterization (in production, use proper ORM)
    let query = template;
    let paramIndex = 0;

    // Replace placeholders with safe parameters
    query = query.replace(/\?/g, () => {
      if (paramIndex < params.length) {
        const param = params[paramIndex++];
        return typeof param === 'string' ? `'${param.replace(/'/g, "''")}'` : String(param);
      }
      return '?';
    });

    return { query, safeParams: params };
  }
}

/**
 * Command Injection Prevention
 */
export class CommandInjectionPrevention {
  private static dangerousCommands = [
    'rm', 'rmdir', 'del', 'format', 'fdisk',
    'cat', 'type', 'more', 'less',
    'wget', 'curl', 'nc', 'netcat',
    'ssh', 'telnet', 'ftp',
    'exec', 'eval', 'system', 'shell_exec',
    'passthru', 'popen', 'proc_open'
  ];

  private static dangerousChars = ['|', '&', ';', '<', '>', '`', '$', '(', ')', '{', '}', '[', ']'];

  /**
   * Check for command injection attempts
   */
  public static detectCommandInjection(input: string): boolean {
    const lowerInput = input.toLowerCase();

    // Check for dangerous commands
    for (const command of this.dangerousCommands) {
      if (lowerInput.includes(command)) {
        console.warn('🚨 Dangerous command detected:', command);
        return true;
      }
    }

    // Check for dangerous characters
    for (const char of this.dangerousChars) {
      if (input.includes(char)) {
        console.warn('🚨 Dangerous character detected:', char);
        return true;
      }
    }

    return false;
  }

  /**
   * Sanitize command arguments
   */
  public static sanitizeCommandArgs(args: string[]): string[] {
    return args.map(arg => {
      // Remove dangerous characters
      let sanitized = arg;
      for (const char of this.dangerousChars) {
        sanitized = sanitized.replace(new RegExp(`\\${char}`, 'g'), `\\${char}`);
      }
      return sanitized;
    });
  }
}

/**
 * XSS Prevention Helper
 */
export class XSSPrevention {
  /**
   * Detect XSS attempts
   */
  public static detectXSS(input: string): boolean {
    const xssPatterns = [
      /<script[^>]*>.*?<\/script>/gi,
      /javascript:/gi,
      /on\w+\s*=/gi,
      /<iframe[^>]*>/gi,
      /<object[^>]*>/gi,
      /<embed[^>]*>/gi,
      /<link[^>]*>/gi,
      /<meta[^>]*>/gi,
      /expression\s*\(/gi,
      /@import/gi,
      /vbscript:/gi
    ];

    for (const pattern of xssPatterns) {
      if (pattern.test(input)) {
        console.warn('🚨 XSS attempt detected:', input);
        return true;
      }
    }

    return false;
  }

  /**
   * Generate secure content headers
   */
  public static getSecureHeaders(): Record<string, string> {
    return {
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'X-XSS-Protection': '1; mode=block',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Permissions-Policy': 'geolocation=(), microphone=(), camera=(), payment=(), usb=(), magnetometer=(), gyroscope=()'
    };
  }
}

/**
 * Input Validation Helper
 */
export class InputValidation {
  /**
   * Validate common input patterns
   */
  public static validateInput(input: string, type: 'email' | 'url' | 'numeric' | 'alphanumeric' | 'uuid'): boolean {
    const patterns = {
      email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
      url: /^https?:\/\/.+/,
      numeric: /^\d+$/,
      alphanumeric: /^[a-zA-Z0-9]+$/,
      uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    };

    const pattern = patterns[type];
    if (!pattern) {
      throw new Error(`Unknown validation type: ${type}`);
    }

    return pattern.test(input);
  }

  /**
   * Validate file upload safety
   */
  public static validateFileUpload(filename: string, mimetype: string, size: number): boolean {
    // Check file extension
    const dangerousExtensions = [
      '.exe', '.bat', '.cmd', '.com', '.pif', '.scr', '.vbs', '.js', '.jar',
      '.php', '.asp', '.aspx', '.jsp', '.sh', '.py', '.rb', '.pl'
    ];

    const extension = filename.toLowerCase().substring(filename.lastIndexOf('.'));
    if (dangerousExtensions.includes(extension)) {
      console.warn('🚨 Dangerous file extension detected:', extension);
      return false;
    }

    // Check file size (max 10MB)
    if (size > 10 * 1024 * 1024) {
      console.warn('🚨 File size too large:', size);
      return false;
    }

    // Check MIME type
    const allowedMimeTypes = [
      'image/jpeg', 'image/png', 'image/gif', 'image/webp',
      'text/plain', 'text/csv', 'application/pdf',
      'application/json', 'application/xml'
    ];

    if (!allowedMimeTypes.includes(mimetype)) {
      console.warn('🚨 Dangerous MIME type detected:', mimetype);
      return false;
    }

    return true;
  }
}

/**
 * Security monitoring and alerting
 */
export class SecurityMonitor {
  private static alerts: Array<{
    timestamp: Date;
    type: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
    message: string;
    details: any;
  }> = [];

  /**
   * Log security event
   */
  public static logEvent(type: string, severity: 'low' | 'medium' | 'high' | 'critical', message: string, details?: any): void {
    const alert = {
      timestamp: new Date(),
      type,
      severity,
      message,
      details
    };

    this.alerts.push(alert);

    // Keep only last 1000 alerts
    if (this.alerts.length > 1000) {
      this.alerts = this.alerts.slice(-1000);
    }

    // Log to console with appropriate level
    const logMessage = `🔒 ${severity.toUpperCase()} [${type}]: ${message}`;
    
    switch (severity) {
      case 'critical':
      case 'high':
        console.error(logMessage, details);
        break;
      case 'medium':
        console.warn(logMessage, details);
        break;
      case 'low':
        console.info(logMessage, details);
        break;
    }
  }

  /**
   * Get recent security alerts
   */
  public static getRecentAlerts(hours: number = 24): typeof SecurityMonitor.alerts {
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);
    return this.alerts.filter(alert => alert.timestamp > cutoff);
  }

  /**
   * Check for attack patterns
   */
  public static detectAttackPattern(req: Request): boolean {
    const patterns = [
      { name: 'SQL Injection', check: (body: any) => typeof body === 'string' && /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|UNION|EXEC|SCRIPT)\b)/i.test(body) },
      { name: 'XSS', check: (body: any) => typeof body === 'string' && /<script[^>]*>.*?<\/script>/gi.test(body) },
      { name: 'Command Injection', check: (body: any) => typeof body === 'string' && CommandInjectionPrevention.detectCommandInjection(body) },
      { name: 'Path Traversal', check: (body: any) => typeof body === 'string' && /\.\.\//g.test(body) }
    ];

    for (const pattern of patterns) {
      if (pattern.check(req.body) || pattern.check(req.query) || pattern.check(req.params)) {
        this.logEvent(pattern.name, 'high', `${pattern.name} attempt detected`, {
          ip: req.ip,
          path: req.path,
          userAgent: req.get('User-Agent')
        });
        return true;
      }
    }

    return false;
  }
}

export default SecurityMiddleware;
