import { z } from 'zod';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format: YYYY-MM-DD');

const countryCode = z
  .string()
  .regex(/^[A-Za-z]{2}$/, 'Use a 2-letter ISO country code')
  .transform((value) => value.toUpperCase());

export const kycDocumentTypeSchema = z.enum([
  'passport',
  'drivers_license',
  'national_id',
  'utility_bill',
  'bank_statement',
]);

export const kycPersonalInfoSchema = z.object({
  firstName: z.string().trim().min(1, 'First name is required').max(100),
  lastName: z.string().trim().min(1, 'Last name is required').max(100),
  dateOfBirth: isoDate,
  nationality: countryCode,
  countryOfResidence: countryCode,
  address: z.object({
    line1: z.string().trim().min(1, 'Address is required').max(200),
    line2: z.string().trim().max(200).optional(),
    city: z.string().trim().min(1, 'City is required').max(100),
    state: z.string().trim().max(100).optional(),
    postalCode: z.string().trim().min(2).max(12),
    country: countryCode,
  }),
});

export const kycDocumentUploadSchema = z
  .object({
    type: kycDocumentTypeSchema,
    documentNumber: z.string().trim().max(40).optional(),
    issuingCountry: countryCode,
    issueDate: isoDate.optional(),
    expiryDate: isoDate.optional(),
    fileName: z.string().trim().min(1, 'File name is required').max(255),
    mimeType: z.string().trim().min(1, 'MIME type is required'),
    fileSize: z.number().int().positive('File size must be positive'),
    fileContent: z.string().min(1).optional(),
    fileUrl: z.string().url().optional(),
  })
  .refine((data) => data.fileContent !== undefined || data.fileUrl !== undefined, {
    message: 'Provide fileContent or fileUrl',
    path: ['fileContent'],
  });

export const kycReviewSchema = z
  .object({
    decision: z.enum(['approved', 'rejected']),
    reviewerId: z.string().trim().min(1, 'Reviewer ID is required'),
    reasons: z.array(z.string().trim().min(1)).optional(),
    notes: z.string().trim().max(1000).optional(),
  })
  .refine((data) => data.decision === 'approved' || (data.reasons?.length ?? 0) > 0, {
    message: 'At least one reason is required when rejecting',
    path: ['reasons'],
  });

export const kycDocumentReviewSchema = z
  .object({
    approved: z.boolean(),
    reasons: z.array(z.string().trim().min(1)).optional(),
  })
  .refine((data) => data.approved || (data.reasons?.length ?? 0) > 0, {
    message: 'At least one reason is required when rejecting a document',
    path: ['reasons'],
  });
