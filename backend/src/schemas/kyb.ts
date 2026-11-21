import { z } from 'zod';

export const uboSchema = z.object({
  name: z.string().min(1),
  ownershipPercentage: z.number().min(0).max(100),
  nationality: z.string().min(2),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format: YYYY-MM-DD'),
  documentType: z.enum(['passport', 'national_id', 'drivers_license']),
  documentNumber: z.string().min(1),
});

export const kybSubmitSchema = z.object({
  businessId: z.string().min(1),
  businessName: z.string().min(1),
  registrationNumber: z.string().min(1),
  registrationCountry: z.string().min(2),
  businessType: z.enum(['llc', 'corporation', 'partnership', 'sole_proprietorship', 'other']),
  incorporationDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  ubos: z.array(uboSchema).min(1, 'At least one UBO required'),
  documents: z.array(
    z.object({
      type: z.enum(['registration_certificate', 'articles_of_incorporation', 'proof_of_address', 'tax_id', 'other']),
      url: z.string().url(),
      name: z.string().min(1),
    })
  ).min(1, 'At least one document required'),
  website: z.string().url().optional(),
  contactEmail: z.string().email(),
});

export const kybReviewSchema = z.object({
  decision: z.enum(['approved', 'rejected', 'requires_more_info']),
  reviewerNotes: z.string().optional(),
  requestedDocuments: z.array(z.string()).optional(),
});

export const kybRenewalSchema = z.object({
  documents: z.array(
    z.object({
      type: z.string().min(1),
      url: z.string().url(),
      name: z.string().min(1),
    })
  ).min(1),
  notes: z.string().optional(),
});
