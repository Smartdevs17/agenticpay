import { Express } from 'express';
import path from 'path';
import fs from 'fs';
import { OpenAPIMetadata, OpenAPISchema } from './openapi-decorators.js';

export interface OpenAPISpecification {
  openapi: string;
  info: {
    title: string;
    description?: string;
    contact?: {
      name?: string;
      url?: string;
      email?: string;
    };
    license?: {
      name: string;
      url?: string;
    };
    version: string;
  };
  servers: Array<{
    url: string;
    description?: string;
    variables?: Record<string, any>;
  }>;
  paths: Record<string, any>;
  components: {
    schemas: Record<string, OpenAPISchema>;
    securitySchemes: Record<string, any>;
    responses: Record<string, any>;
  };
  security?: Record<string, string[]>[];
  tags?: Array<{
    name: string;
    description?: string;
    externalDocs?: {
      url: string;
      description?: string;
    };
  }>;
  externalDocs?: {
    url: string;
    description?: string;
  };
}

export class OpenAPIGenerator {
  private spec: OpenAPISpecification;
  private schemas: Map<string, OpenAPISchema> = new Map();

  constructor(config: {
    title: string;
    description?: string;
    version: string;
    baseUrl?: string;
  }) {
    this.spec = {
      openapi: '3.1.0',
      info: {
        title: config.title,
        description: config.description,
        version: config.version,
        contact: {
          name: 'AgenticPay Team',
          url: 'https://github.com/Smartdevs17/agenticpay',
          email: 'hello@agenticpay.com',
        },
        license: {
          name: 'Apache-2.0',
          url: 'https://opensource.org/licenses/Apache-2.0',
        },
      },
      servers: [
        {
          url: config.baseUrl || 'http://localhost:3000/api/v1',
          description: 'Development server',
        },
        {
          url: 'https://api.agenticpay.com/api/v1',
          description: 'Production server',
        },
      ],
      paths: {},
      components: {
        schemas: {},
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
            description: 'JWT authentication',
          },
          apiKeyAuth: {
            type: 'apiKey',
            in: 'header',
            name: 'X-API-Key',
            description: 'API Key authentication',
          },
        },
        responses: {
          NotFound: {
            description: 'Resource not found',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    error: { type: 'string' },
                    statusCode: { type: 'number', example: 404 },
                  },
                },
              },
            },
          },
          Unauthorized: {
            description: 'Unauthorized access',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    error: { type: 'string' },
                    statusCode: { type: 'number', example: 401 },
                  },
                },
              },
            },
          },
          InternalError: {
            description: 'Internal server error',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    error: { type: 'string' },
                    statusCode: { type: 'number', example: 500 },
                  },
                },
              },
            },
          },
        },
      },
      security: [{ bearerAuth: [] }],
      tags: [],
      externalDocs: {
        url: 'https://docs.agenticpay.com',
        description: 'Full API documentation',
      },
    };
  }

  registerPath(method: string, path: string, operation: any): void {
    const pathKey = path.replace(/:[^/]+/g, (match) => `{${match.slice(1)}}`);
    const methodLower = method.toLowerCase();

    if (!this.spec.paths[pathKey]) {
      this.spec.paths[pathKey] = {};
    }

    this.spec.paths[pathKey][methodLower] = {
      tags: operation.tags || [],
      summary: operation.summary,
      description: operation.description,
      operationId: operation.operationId || `${method}_${pathKey}`,
      parameters: this.formatParameters(operation.parameters),
      requestBody: operation.requestBody,
      responses: this.formatResponses(operation.responses),
      security: operation.security,
      deprecated: operation.deprecated || false,
    };
  }

  private formatParameters(params?: any[]): any[] {
    if (!params) return [];

    return params.map((param) => ({
      name: param.name,
      in: param.in,
      description: param.description,
      required: param.required || false,
      schema: param.schema,
      example: param.example,
      deprecated: param.deprecated || false,
    }));
  }

  private formatResponses(responses?: Record<string, any>): Record<string, any> {
    if (!responses) {
      return {
        '200': {
          description: 'Success',
        },
      };
    }

    return Object.entries(responses).reduce(
      (acc, [status, response]) => {
        acc[status] = {
          description: response.description,
          content: response.content,
          headers: response.headers,
        };
        return acc;
      },
      {} as Record<string, any>
    );
  }

  registerSchema(name: string, schema: OpenAPISchema): void {
    this.schemas.set(name, schema);
    this.spec.components.schemas[name] = schema;
  }

  registerTag(name: string, description?: string): void {
    this.spec.tags = this.spec.tags || [];
    this.spec.tags.push({
      name,
      description,
    });
  }

  getSpec(): OpenAPISpecification {
    return this.spec;
  }

  toJSON(): string {
    return JSON.stringify(this.spec, null, 2);
  }

  toYAML(): string {
    // Simple YAML conversion (would use yaml library in production)
    const json = this.toJSON();
    return `# OpenAPI Specification
# Generated automatically from AgenticPay API\n${json}`;
  }

  saveToFile(filepath: string, format: 'json' | 'yaml' = 'json'): void {
    const dir = path.dirname(filepath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const content = format === 'yaml' ? this.toYAML() : this.toJSON();
    fs.writeFileSync(filepath, content, 'utf-8');
  }

  static fromExpressApp(app: Express, config: any): OpenAPIGenerator {
    const generator = new OpenAPIGenerator(config);

    // Extract routes from Express app
    const stack = (app._router?.stack || []) as any[];

    stack.forEach((layer) => {
      const route = layer.route;
      if (route) {
        const methods = Object.keys(route.methods);
        methods.forEach((method) => {
          const path = route.path;
          const operation = this.extractRouteOperation(layer, method);
          if (operation) {
            generator.registerPath(method.toUpperCase(), path, operation);
          }
        });
      }
    });

    return generator;
  }

  private static extractRouteOperation(layer: any, method: string): any {
    // Extract operation metadata from route handlers
    const handlers = layer.route?.stack || [];
    const lastHandler = handlers[handlers.length - 1];

    if (!lastHandler) return null;

    return {
      tags: ['routes'],
      summary: layer.route?.path || 'Operation',
      description: 'API endpoint',
      responses: {
        '200': {
          description: 'Success',
        },
        '400': {
          description: 'Bad request',
        },
        '500': {
          description: 'Internal server error',
        },
      },
    };
  }
}

export function createOpenAPIGenerator(config: {
  title: string;
  description?: string;
  version: string;
  baseUrl?: string;
}): OpenAPIGenerator {
  return new OpenAPIGenerator(config);
}
