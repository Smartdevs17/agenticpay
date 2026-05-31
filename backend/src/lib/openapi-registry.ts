import type { ZodTypeAny } from 'zod';
import type { OpenAPIGenerator } from './openapi-generator.js';
import { zodToOpenApiSchema, zodExample } from './zod-openapi.js';
import {
  invoiceSchema,
  verificationSchema,
  bulkVerificationSchema,
  createOnboardingSchema,
  submitDocumentSchema,
  createEscrowSchema,
  fundEscrowSchema,
} from '../schemas/index.js';

export interface RouteRegistration {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  tags: string[];
  summary: string;
  description?: string;
  requestSchema?: ZodTypeAny;
  responseSchema?: ZodTypeAny;
  security?: boolean;
  deprecated?: boolean;
}

/** Top API surface — synced with Express routers under /api/v1 */
export const API_ROUTE_REGISTRY: RouteRegistration[] = [
  {
    method: 'GET',
    path: '/health',
    tags: ['Health'],
    summary: 'Service health check',
    description: 'Returns dependency status for Stellar, OpenAI, and scheduler.',
    security: false,
  },
  {
    method: 'GET',
    path: '/ready',
    tags: ['Health'],
    summary: 'Readiness probe',
    security: false,
  },
  {
    method: 'POST',
    path: '/verification/verify',
    tags: ['Verification'],
    summary: 'Verify work submission',
    description: 'AI-powered verification of freelancer deliverables.',
    requestSchema: verificationSchema,
    security: true,
  },
  {
    method: 'POST',
    path: '/verification/verify/batch',
    tags: ['Verification'],
    summary: 'Batch verify work submissions',
    requestSchema: bulkVerificationSchema,
    security: true,
  },
  {
    method: 'POST',
    path: '/invoice/generate',
    tags: ['Invoicing'],
    summary: 'Generate invoice',
    requestSchema: invoiceSchema,
    security: true,
  },
  {
    method: 'POST',
    path: '/onboarding',
    tags: ['Onboarding'],
    summary: 'Create merchant onboarding',
    requestSchema: createOnboardingSchema,
    security: true,
  },
  {
    method: 'POST',
    path: '/onboarding/{id}/documents',
    tags: ['Onboarding'],
    summary: 'Submit onboarding document',
    requestSchema: submitDocumentSchema,
    security: true,
  },
  {
    method: 'POST',
    path: '/escrow',
    tags: ['Escrow'],
    summary: 'Create escrow agreement',
    requestSchema: createEscrowSchema,
    security: true,
  },
  {
    method: 'POST',
    path: '/escrow/{id}/fund',
    tags: ['Escrow'],
    summary: 'Fund escrow',
    requestSchema: fundEscrowSchema,
    security: true,
  },
  {
    method: 'POST',
    path: '/escrow/{id}/milestones/{milestoneId}/confirm',
    tags: ['Escrow', 'Payments'],
    summary: 'Confirm milestone payment',
    description: 'Release or confirm funds for a completed milestone.',
    security: true,
  },
  {
    method: 'POST',
    path: '/disputes',
    tags: ['Disputes'],
    summary: 'File a dispute',
    description: 'Open a payment dispute for arbitration.',
    security: true,
  },
  {
    method: 'POST',
    path: '/disputes/{id}/respond',
    tags: ['Disputes'],
    summary: 'Respond to dispute',
    security: true,
  },
  {
    method: 'POST',
    path: '/disputes/{id}/resolve',
    tags: ['Disputes'],
    summary: 'Resolve dispute',
    security: true,
  },
  {
    method: 'GET',
    path: '/stellar/payment/{transactionHash}',
    tags: ['Stellar'],
    summary: 'Get Stellar payment status',
    security: true,
  },
  {
    method: 'GET',
    path: '/sandbox/status',
    tags: ['Sandbox'],
    summary: 'Sandbox environment status',
    security: false,
  },
  {
    method: 'POST',
    path: '/sandbox/payments/process',
    tags: ['Sandbox', 'Payments'],
    summary: 'Process mock payment (sandbox)',
    security: false,
  },
];

export function registerRoutesFromRegistry(generator: OpenAPIGenerator): void {
  const registeredSchemas = new Set<string>();

  for (const route of API_ROUTE_REGISTRY) {
    if (route.requestSchema) {
      const schemaName = route.requestSchema.constructor?.name ?? 'Request';
      const ref = `Request_${route.path.replace(/[^a-zA-Z0-9]/g, '_')}`;
      if (!registeredSchemas.has(ref)) {
        generator.registerSchema(ref, zodToOpenApiSchema(route.requestSchema, ref) as never);
        registeredSchemas.add(ref);
      }
    }

    for (const tag of route.tags) {
      generator.registerTag(tag);
    }

    const security = route.security === false ? [] : [{ bearerAuth: [] }];

    generator.registerPath(route.method, route.path, {
      tags: route.tags,
      summary: route.summary,
      description: route.description,
      security,
      deprecated: route.deprecated,
      requestBody: route.requestSchema
        ? {
            required: true,
            content: {
              'application/json': {
                schema: zodToOpenApiSchema(route.requestSchema),
                examples: {
                  default: {
                    summary: 'Example request',
                    value: zodExample(route.requestSchema),
                  },
                },
              },
            },
          }
        : undefined,
      responses: {
        '200': {
          description: 'Successful response',
          content: {
            'application/json': {
              schema: { type: 'object' },
            },
          },
        },
        '400': { $ref: '#/components/responses/BadRequest' },
        '401': { $ref: '#/components/responses/Unauthorized' },
        '404': { $ref: '#/components/responses/NotFound' },
        '500': { $ref: '#/components/responses/InternalError' },
      },
    });
  }

  // Authentication documentation tag
  generator.registerTag(
    'Authentication',
    'All protected endpoints require `Authorization: Bearer <token>`. Obtain tokens via your merchant dashboard or API key management.'
  );
}
