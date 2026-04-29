// OpenAPI Decorator for AgenticPay API
// Provides decorators for documenting API endpoints

export interface OpenAPIOptions {
  tags?: string[];
  summary?: string;
  description?: string;
  parameters?: OpenAPIParameter[];
  requestBody?: OpenAPIRequestBody;
  responses?: Record<string, OpenAPIResponse>;
  security?: Record<string, string[]>[];
  deprecated?: boolean;
  operationId?: string;
}

export interface OpenAPIParameter {
  name: string;
  in: 'query' | 'path' | 'header' | 'cookie';
  description?: string;
  required?: boolean;
  schema?: OpenAPISchema;
  example?: any;
  deprecated?: boolean;
}

export interface OpenAPIRequestBody {
  description?: string;
  required?: boolean;
  content: Record<string, OpenAPIMediaType>;
}

export interface OpenAPIMediaType {
  schema?: OpenAPISchema;
  examples?: Record<string, any>;
}

export interface OpenAPIResponse {
  description: string;
  content?: Record<string, OpenAPIMediaType>;
  headers?: Record<string, any>;
}

export interface OpenAPISchema {
  type?: string;
  format?: string;
  description?: string;
  example?: any;
  items?: OpenAPISchema;
  properties?: Record<string, OpenAPISchema>;
  required?: string[];
  enum?: any[];
  default?: any;
  $ref?: string;
  oneOf?: OpenAPISchema[];
  anyOf?: OpenAPISchema[];
  allOf?: OpenAPISchema[];
}

export interface OpenAPIEndpoint {
  method: string;
  path: string;
  operation: OpenAPIOptions;
}

/**
 * Decorator for documenting OpenAPI endpoints
 * @param options OpenAPI operation configuration
 */
export function ApiOperation(options: OpenAPIOptions) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    // Store metadata on the original function
    Reflect.defineMetadata('openapi:operation', options, target, propertyKey);
    return descriptor;
  };
}

/**
 * Decorator for documenting request parameters
 * @param parameters Array of parameter definitions
 */
export function ApiParameters(...parameters: OpenAPIParameter[]) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const existing = Reflect.getOwnMetadata('openapi:parameters', target, propertyKey) || [];
    Reflect.defineMetadata('openapi:parameters', [...existing, ...parameters], target, propertyKey);
    return descriptor;
  };
}

/**
 * Decorator for documenting request body schema
 * @param schema Request body schema
 */
export function ApiBody(schema: OpenAPISchema) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    Reflect.defineMetadata('openapi:body', schema, target, propertyKey);
    return descriptor;
  };
}

/**
 * Decorator for documenting response schemas
 * @param status HTTP status code
 * @param response Response definition
 */
export function ApiResponse(status: number, response: OpenAPIResponse) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const existing = Reflect.getOwnMetadata('openapi:responses', target, propertyKey) || {};
    existing[status] = response;
    Reflect.defineMetadata('openapi:responses', existing, target, propertyKey);
    return descriptor;
  };
}

/**
 * Decorator for documenting security requirements
 * @param schemes Security scheme names
 */
export function ApiSecurity(...schemes: string[]) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const security = schemes.map(scheme => ({ [scheme]: [] }));
    Reflect.defineMetadata('openapi:security', security, target, propertyKey);
    return descriptor;
  };
}

/**
 * Decorator for API tags
 * @param tags Tag names
 */
export function ApiTags(...tags: string[]) {
  return function (
    target: any,
    propertyKey?: string,
    descriptor?: PropertyDescriptor
  ) {
    if (propertyKey && descriptor) {
      // Method-level tag
      Reflect.defineMetadata('openapi:tags', tags, target, propertyKey);
      return descriptor;
    } else {
      // Class-level tag
      Reflect.defineMetadata('openapi:tags', tags, target);
      return target;
    }
  };
}

/**
 * Decorator for deprecating endpoints
 */
export function ApiDeprecated(message?: string) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    Reflect.defineMetadata('openapi:deprecated', true, target, propertyKey);
    if (message) {
      Reflect.defineMetadata('openapi:deprecation-message', message, target, propertyKey);
    }
    return descriptor;
  };
}

export class OpenAPIMetadata {
  static getEndpointMetadata(target: any, method: string): OpenAPIOptions {
    const operation = Reflect.getOwnMetadata('openapi:operation', target, method) || {};
    const parameters = Reflect.getOwnMetadata('openapi:parameters', target, method) || [];
    const body = Reflect.getOwnMetadata('openapi:body', target, method);
    const responses = Reflect.getOwnMetadata('openapi:responses', target, method) || {};
    const security = Reflect.getOwnMetadata('openapi:security', target, method);
    const tags = Reflect.getOwnMetadata('openapi:tags', target, method);
    const deprecated = Reflect.getOwnMetadata('openapi:deprecated', target, method);

    return {
      ...operation,
      parameters: parameters.length > 0 ? parameters : operation.parameters,
      requestBody: body,
      responses: Object.keys(responses).length > 0 ? responses : operation.responses,
      security: security || operation.security,
      deprecated: deprecated || operation.deprecated,
      tags: tags || operation.tags,
    };
  }

  static getClassMetadata(target: any): any {
    return Reflect.getOwnMetadata('openapi:tags', target);
  }
}
