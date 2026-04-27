import { z } from 'zod';

/**
 * Security validation schemas for input sanitization
 * Provides comprehensive validation rules for all API endpoints
 */

export const SecuritySchemas = {
  // User authentication schemas
  auth: {
    login: z.object({
      email: z.string().email().max(255).transform(val => val.toLowerCase().trim()),
      password: z.string().min(8).max(128).regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/, 
        'Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character')
    }),

    register: z.object({
      email: z.string().email().max(255).transform(val => val.toLowerCase().trim()),
      password: z.string().min(8).max(128).regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/, 
        'Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character'),
      name: z.string().min(2).max(100).regex(/^[a-zA-Z\s'-]+$/, 'Name can only contain letters, spaces, hyphens, and apostrophes'),
      role: z.enum(['client', 'freelancer', 'admin']).default('client')
    }),

    resetPassword: z.object({
      email: z.string().email().max(255).transform(val => val.toLowerCase().trim()),
      token: z.string().min(32).max(512),
      newPassword: z.string().min(8).max(128).regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/, 
        'Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character')
    })
  },

  // Project management schemas
  project: {
    create: z.object({
      freelancerId: z.string().uuid('Invalid freelancer ID format'),
      amount: z.number().positive().max(1000000000, 'Amount cannot exceed 1 billion'),
      description: z.string().min(10).max(2000).transform(val => val.trim()),
      githubRepo: z.string().url().max(500).transform(val => val.trim()),
      deadline: z.number().int().positive().max(Date.now() + 365 * 24 * 60 * 60 * 1000, 'Deadline cannot be more than 1 year in the future')
    }),

    update: z.object({
      projectId: z.string().uuid(),
      description: z.string().min(10).max(2000).transform(val => val.trim()).optional(),
      githubRepo: z.string().url().max(500).transform(val => val.trim()).optional(),
      deadline: z.number().int().positive().max(Date.now() + 365 * 24 * 60 * 60 * 1000, 'Deadline cannot be more than 1 year in the future').optional()
    }),

    fund: z.object({
      projectId: z.string().uuid(),
      amount: z.number().positive().max(1000000000, 'Amount cannot exceed 1 billion')
    }),

    submitWork: z.object({
      projectId: z.string().uuid(),
      deliverables: z.string().min(10).max(5000).transform(val => val.trim()),
      workEvidence: z.array(z.string().url()).max(10, 'Maximum 10 evidence URLs allowed')
    }),

    verifyWork: z.object({
      projectId: z.string().uuid(),
      approved: z.boolean(),
      feedback: z.string().max(1000).transform(val => val.trim()).optional()
    })
  },

  // Verification schemas
  verification: {
    create: z.object({
      projectId: z.string().uuid(),
      freelancerId: z.string().uuid(),
      deliverables: z.string().min(10).max(5000).transform(val => val.trim()),
      requirements: z.string().min(10).max(2000).transform(val => val.trim())
    }),

    batch: z.object({
      verifications: z.array(z.object({
        projectId: z.string().uuid(),
        freelancerId: z.string().uuid(),
        deliverables: z.string().min(10).max(5000).transform(val => val.trim()),
        requirements: z.string().min(10).max(2000).transform(val => val.trim())
      })).max(100, 'Maximum 100 verifications per batch')
    }),

    update: z.object({
      verificationId: z.string().uuid(),
      status: z.enum(['pending', 'approved', 'rejected']),
      feedback: z.string().max(1000).transform(val => val.trim()).optional()
    })
  },

  // Invoice schemas
  invoice: {
    create: z.object({
      projectId: z.string().uuid(),
      freelancerId: z.string().uuid(),
      amount: z.number().positive().max(1000000000, 'Amount cannot exceed 1 billion'),
      currency: z.enum(['XLM', 'USD', 'EUR', 'GBP']).default('XLM'),
      dueDate: z.number().int().positive().max(Date.now() + 365 * 24 * 60 * 60 * 1000, 'Due date cannot be more than 1 year in the future'),
      items: z.array(z.object({
        description: z.string().min(5).max(200).transform(val => val.trim()),
        quantity: z.number().positive().max(1000),
        unitPrice: z.number().positive().max(1000000)
      })).max(50, 'Maximum 50 items per invoice')
    }),

    update: z.object({
      invoiceId: z.string().uuid(),
      status: z.enum(['draft', 'sent', 'paid', 'overdue', 'cancelled']),
      paidAmount: z.number().positive().max(1000000000).optional()
    })
  },

  // Stellar transaction schemas
  stellar: {
    transaction: z.object({
      transactionHash: z.string().regex(/^[a-fA-F0-9]{64}$/, 'Invalid transaction hash format'),
      network: z.enum(['testnet', 'public']).default('testnet')
    }),

    payment: z.object({
      fromAddress: z.string().regex(/^G[A-Z0-9]{55}$/, 'Invalid Stellar address format'),
      toAddress: z.string().regex(/^G[A-Z0-9]{55}$/, 'Invalid Stellar address format'),
      amount: z.string().regex(/^\d+(\.\d{1,7})?$/, 'Invalid amount format'),
      assetCode: z.string().length(1, 12).regex(/^[A-Z]{1,12}$/, 'Asset code must be 1-12 uppercase letters').optional(),
      assetIssuer: z.string().regex(/^G[A-Z0-9]{55}$/, 'Invalid asset issuer address').optional()
    })
  },

  // File upload schemas
  upload: {
    avatar: z.object({
      filename: z.string().regex(/^[a-zA-Z0-9._-]+\.(jpg|jpeg|png|gif|webp)$/i, 'Invalid image format'),
      mimetype: z.enum(['image/jpeg', 'image/png', 'image/gif', 'image/webp']),
      size: z.number().max(5 * 1024 * 1024, 'Avatar size cannot exceed 5MB')
    }),

    document: z.object({
      filename: z.string().regex(/^[a-zA-Z0-9._-]+\.(pdf|doc|docx|txt)$/i, 'Invalid document format'),
      mimetype: z.enum(['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain']),
      size: z.number().max(10 * 1024 * 1024, 'Document size cannot exceed 10MB')
    })
  },

  // Search and filtering schemas
  search: {
    projects: z.object({
      query: z.string().max(100).transform(val => val.trim()).optional(),
      status: z.enum(['created', 'funded', 'in_progress', 'work_submitted', 'verified', 'completed', 'disputed', 'cancelled']).optional(),
      client: z.string().uuid().optional(),
      freelancer: z.string().uuid().optional(),
      minAmount: z.number().positive().optional(),
      maxAmount: z.number().positive().optional(),
      page: z.number().int().positive().max(1000).default(1),
      limit: z.number().int().positive().max(100).default(20),
      sortBy: z.enum(['created_at', 'amount', 'deadline']).default('created_at'),
      sortOrder: z.enum(['asc', 'desc']).default('desc')
    }),

    users: z.object({
      query: z.string().max(100).transform(val => val.trim()).optional(),
      role: z.enum(['client', 'freelancer', 'admin']).optional(),
      verified: z.boolean().optional(),
      page: z.number().int().positive().max(1000).default(1),
      limit: z.number().int().positive().max(100).default(20),
      sortBy: z.enum(['created_at', 'name', 'email']).default('created_at'),
      sortOrder: z.enum(['asc', 'desc']).default('desc')
    })
  },

  // Admin schemas
  admin: {
    userManagement: z.object({
      userId: z.string().uuid(),
      action: z.enum(['activate', 'deactivate', 'verify', 'unverify', 'ban', 'unban']),
      reason: z.string().max(500).transform(val => val.trim()).optional()
    }),

    systemConfig: z.object({
      key: z.string().regex(/^[a-zA-Z0-9._-]+$/, 'Invalid config key format'),
      value: z.any(),
      description: z.string().max(200).transform(val => val.trim())
    }),

    bulkAction: z.object({
      action: z.enum(['delete', 'archive', 'restore']),
      entity: z.enum(['users', 'projects', 'invoices', 'verifications']),
      ids: z.array(z.string().uuid()).max(1000, 'Cannot process more than 1000 items at once')
    })
  }
};

/**
 * Custom validation functions for complex scenarios
 */
export const CustomValidators = {
  /**
   * Validate Stellar address format
   */
  stellarAddress: (address: string): boolean => {
    return /^G[A-Z0-9]{55}$/.test(address);
  },

  /**
   * Validate GitHub repository URL
   */
  githubRepo: (url: string): boolean => {
    return /^https:\/\/github\.com\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+(\/.*)?$/.test(url);
  },

  /**
   * Validate password strength
   */
  passwordStrength: (password: string): { isValid: boolean; score: number; feedback: string[] } => {
    const feedback: string[] = [];
    let score = 0;

    // Length check
    if (password.length >= 8) score += 1;
    else feedback.push('Password should be at least 8 characters long');

    // Uppercase check
    if (/[A-Z]/.test(password)) score += 1;
    else feedback.push('Password should contain at least one uppercase letter');

    // Lowercase check
    if (/[a-z]/.test(password)) score += 1;
    else feedback.push('Password should contain at least one lowercase letter');

    // Number check
    if (/\d/.test(password)) score += 1;
    else feedback.push('Password should contain at least one number');

    // Special character check
    if (/[@$!%*?&]/.test(password)) score += 1;
    else feedback.push('Password should contain at least one special character (@$!%*?&)');

    // Common patterns check
    const commonPatterns = [
      /123456/,
      /password/i,
      /qwerty/i,
      /admin/i,
      /letmein/i
    ];

    for (const pattern of commonPatterns) {
      if (pattern.test(password)) {
        score -= 2;
        feedback.push('Password contains common patterns that are easy to guess');
        break;
      }
    }

    return {
      isValid: score >= 4,
      score: Math.max(0, Math.min(5, score)),
      feedback
    };
  },

  /**
   * Validate file content type
   */
  fileContentType: (filename: string, mimetype: string): boolean => {
    const extension = filename.toLowerCase().split('.').pop();
    const mimeMap: Record<string, string[]> = {
      'jpg': ['image/jpeg'],
      'jpeg': ['image/jpeg'],
      'png': ['image/png'],
      'gif': ['image/gif'],
      'webp': ['image/webp'],
      'pdf': ['application/pdf'],
      'doc': ['application/msword'],
      'docx': ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
      'txt': ['text/plain']
    };

    return mimeMap[extension]?.includes(mimetype) || false;
  },

  /**
   * Validate API key format
   */
  apiKey: (key: string): boolean => {
    return /^[a-zA-Z0-9]{32,64}$/.test(key);
  },

  /**
   * Validate webhook URL
   */
  webhookUrl: (url: string): boolean => {
    return /^https:\/\/[a-zA-Z0-9.-]+(\.[a-zA-Z]{2,})?(\/.*)?$/.test(url);
  }
};

/**
 * Error messages for validation failures
 */
export const ValidationMessages = {
  required: 'This field is required',
  invalidEmail: 'Please provide a valid email address',
  invalidPassword: 'Password must be at least 8 characters long and contain uppercase, lowercase, number, and special character',
  invalidUrl: 'Please provide a valid URL',
  invalidUuid: 'Invalid ID format',
  invalidAmount: 'Amount must be a positive number',
  invalidDate: 'Invalid date format',
  invalidFile: 'Invalid file format or size',
  invalidStellarAddress: 'Invalid Stellar address format',
  invalidGithubRepo: 'Invalid GitHub repository URL',
  tooLong: 'This field is too long',
  tooShort: 'This field is too short',
  invalidFormat: 'Invalid format',
  unauthorized: 'You are not authorized to perform this action',
  forbidden: 'This action is forbidden',
  rateLimitExceeded: 'Too many requests. Please try again later',
  invalidToken: 'Invalid or expired token',
  accountLocked: 'Account has been locked due to suspicious activity',
  maintenanceMode: 'Service is currently under maintenance'
};

export default SecuritySchemas;
