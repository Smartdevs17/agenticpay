export interface GeneratorConfig {
  specPath: string;
  outDir: string;
  reactQueryPath: string;
  clientPath: string;
  endpointOverrides: EndpointOverride[];
  authHeader: string;
  authScheme: string;
}

export interface EndpointOverride {
  path: string;
  method: string;
  customHookName?: string;
  customResponseType?: string;
  customRequestType?: string;
  skip?: boolean;
}

export interface ParsedEndpoint {
  path: string;
  method: string;
  operationId: string;
  summary: string;
  tags: string[];
  parameters: ParsedParameter[];
  requestBody: ParsedSchema | null;
  responses: Record<string, ParsedSchema>;
  security: Record<string, string[]>[];
}

export interface ParsedParameter {
  name: string;
  in: 'query' | 'path' | 'header' | 'cookie';
  required: boolean;
  schema: ParsedSchema;
}

export interface ParsedSchema {
  type: string;
  format?: string;
  required?: string[];
  properties?: Record<string, ParsedSchema>;
  items?: ParsedSchema;
  ref?: string;
  enum?: string[];
  description?: string;
}
