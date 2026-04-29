#!/usr/bin/env node

/**
 * OpenAPI Specification Generator for AgenticPay
 * Generates OpenAPI spec, Postman collection, and SDK code
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createOpenAPIGenerator } from '../lib/openapi-generator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface GeneratorConfig {
  title: string;
  version: string;
  description: string;
  baseUrl: string;
  outputDir: string;
  generateSDKs: boolean;
  sdkLanguages: string[];
}

async function loadConfig(): Promise<GeneratorConfig> {
  const configPath = path.join(process.cwd(), 'openapi.config.json');

  const defaultConfig: GeneratorConfig = {
    title: 'AgenticPay API',
    version: '1.0.0',
    description: 'AI-Powered Payment Infrastructure for Autonomous Agents',
    baseUrl: 'http://localhost:3000/api/v1',
    outputDir: path.join(process.cwd(), 'docs', 'api'),
    generateSDKs: true,
    sdkLanguages: ['typescript', 'python', 'go'],
  };

  if (fs.existsSync(configPath)) {
    const custom = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    return { ...defaultConfig, ...custom };
  }

  return defaultConfig;
}

async function generateOpenAPISpec(config: GeneratorConfig): Promise<void> {
  console.log('📋 Generating OpenAPI Specification...');

  const generator = createOpenAPIGenerator({
    title: config.title,
    version: config.version,
    description: config.description,
    baseUrl: config.baseUrl,
  });

  // Example: Register common API endpoints
  registerCommonEndpoints(generator);

  // Save OpenAPI spec
  const specDir = path.join(config.outputDir, 'openapi');
  if (!fs.existsSync(specDir)) {
    fs.mkdirSync(specDir, { recursive: true });
  }

  generator.saveToFile(path.join(specDir, 'openapi.json'), 'json');
  generator.saveToFile(path.join(specDir, 'openapi.yaml'), 'yaml');

  console.log('✅ OpenAPI specification generated');
  console.log(`   📁 ${path.join(specDir, 'openapi.json')}`);
  console.log(`   📁 ${path.join(specDir, 'openapi.yaml')}`);
}

async function generatePostmanCollection(config: GeneratorConfig): Promise<void> {
  console.log('📮 Generating Postman Collection...');

  const postmanCollection = {
    info: {
      name: 'AgenticPay API',
      description: 'Postman collection for AgenticPay API',
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    },
    item: [
      {
        name: 'Verification',
        item: [
          {
            name: 'Batch Verify',
            request: {
              method: 'POST',
              url: {
                raw: `${config.baseUrl}/verification/verify/batch`,
                protocol: 'http',
                host: ['localhost'],
                port: '3000',
                path: ['api', 'v1', 'verification', 'verify', 'batch'],
              },
              header: [
                {
                  key: 'Authorization',
                  value: 'Bearer {{token}}',
                  type: 'text',
                },
                {
                  key: 'Content-Type',
                  value: 'application/json',
                  type: 'text',
                },
              ],
              body: {
                mode: 'raw',
                raw: JSON.stringify(
                  {
                    verifications: [],
                  },
                  null,
                  2
                ),
              },
            },
          },
        ],
      },
      {
        name: 'Invoice',
        item: [
          {
            name: 'Generate Invoice',
            request: {
              method: 'POST',
              url: {
                raw: `${config.baseUrl}/invoice/generate`,
                protocol: 'http',
                host: ['localhost'],
                port: '3000',
                path: ['api', 'v1', 'invoice', 'generate'],
              },
              header: [
                {
                  key: 'Authorization',
                  value: 'Bearer {{token}}',
                  type: 'text',
                },
              ],
              body: {
                mode: 'raw',
                raw: JSON.stringify(
                  {
                    projectId: 'project-id',
                    workDescription: 'Work completed',
                    hoursWorked: 10,
                    hourlyRate: 50,
                  },
                  null,
                  2
                ),
              },
            },
          },
        ],
      },
    ],
    auth: {
      type: 'bearer',
      bearer: [
        {
          key: 'token',
          value: '{{token}}',
          type: 'string',
        },
      ],
    },
    variable: [
      {
        key: 'baseUrl',
        value: config.baseUrl,
      },
      {
        key: 'token',
        value: '',
      },
    ],
  };

  const postmanDir = path.join(config.outputDir, 'postman');
  if (!fs.existsSync(postmanDir)) {
    fs.mkdirSync(postmanDir, { recursive: true });
  }

  fs.writeFileSync(
    path.join(postmanDir, 'AgenticPay-API.postman_collection.json'),
    JSON.stringify(postmanCollection, null, 2)
  );

  console.log('✅ Postman collection generated');
  console.log(`   📁 ${path.join(postmanDir, 'AgenticPay-API.postman_collection.json')}`);
}

async function generateSDKs(config: GeneratorConfig): Promise<void> {
  if (!config.generateSDKs) return;

  console.log('🔧 Generating SDK Code...');

  for (const language of config.sdkLanguages) {
    await generateSDKForLanguage(language, config);
  }

  console.log('✅ SDKs generated');
}

async function generateSDKForLanguage(language: string, config: GeneratorConfig): Promise<void> {
  const sdkDir = path.join(config.outputDir, 'sdks', language);
  if (!fs.existsSync(sdkDir)) {
    fs.mkdirSync(sdkDir, { recursive: true });
  }

  switch (language) {
    case 'typescript':
      generateTypeScriptSDK(sdkDir, config);
      break;
    case 'python':
      generatePythonSDK(sdkDir, config);
      break;
    case 'go':
      generateGoSDK(sdkDir, config);
      break;
  }

  console.log(`   ✅ ${language.toUpperCase()} SDK generated to ${sdkDir}`);
}

function generateTypeScriptSDK(outputDir: string, config: GeneratorConfig): void {
  const client = `
// Auto-generated TypeScript SDK for AgenticPay API
import axios, { AxiosInstance } from 'axios';

export class AgenticPayClient {
  private client: AxiosInstance;

  constructor(token: string, baseUrl: string = '${config.baseUrl}') {
    this.client = axios.create({
      baseURL: baseUrl,
      headers: {
        'Authorization': \`Bearer \${token}\`,
        'Content-Type': 'application/json',
      },
    });
  }

  /**
   * Batch verify work submissions
   */
  async batchVerify(verifications: any[]): Promise<any> {
    const response = await this.client.post('/verification/verify/batch', {
      verifications,
    });
    return response.data;
  }

  /**
   * Generate invoice for completed work
   */
  async generateInvoice(projectId: string, workDescription: string, hoursWorked: number, hourlyRate: number): Promise<any> {
    const response = await this.client.post('/invoice/generate', {
      projectId,
      workDescription,
      hoursWorked,
      hourlyRate,
    });
    return response.data;
  }

  /**
   * Get payment status from Stellar
   */
  async getPaymentStatus(transactionHash: string): Promise<any> {
    const response = await this.client.get(\`/stellar/payment/\${transactionHash}\`);
    return response.data;
  }
}

export default AgenticPayClient;
  `;

  fs.writeFileSync(path.join(outputDir, 'client.ts'), client);

  const packageJson = {
    name: '@agenticpay/sdk',
    version: config.version,
    description: 'TypeScript SDK for AgenticPay API',
    main: 'dist/client.js',
    types: 'dist/client.d.ts',
    scripts: {
      build: 'tsc',
      test: 'jest',
    },
    dependencies: {
      axios: '^1.0.0',
    },
    devDependencies: {
      '@types/node': '^20.0.0',
      typescript: '^5.0.0',
    },
  };

  fs.writeFileSync(path.join(outputDir, 'package.json'), JSON.stringify(packageJson, null, 2));
}

function generatePythonSDK(outputDir: string, config: GeneratorConfig): void {
  const client = `
"""
Auto-generated Python SDK for AgenticPay API
"""

import requests
from typing import Optional, Dict, Any


class AgenticPayClient:
    """AgenticPay API Client"""

    def __init__(self, token: str, base_url: str = "${config.baseUrl}"):
        self.base_url = base_url
        self.headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        }

    def batch_verify(self, verifications: list) -> Dict[str, Any]:
        """Batch verify work submissions"""
        response = requests.post(
            f"{self.base_url}/verification/verify/batch",
            json={"verifications": verifications},
            headers=self.headers,
        )
        return response.json()

    def generate_invoice(
        self,
        project_id: str,
        work_description: str,
        hours_worked: float,
        hourly_rate: float,
    ) -> Dict[str, Any]:
        """Generate invoice for completed work"""
        response = requests.post(
            f"{self.base_url}/invoice/generate",
            json={
                "projectId": project_id,
                "workDescription": work_description,
                "hoursWorked": hours_worked,
                "hourlyRate": hourly_rate,
            },
            headers=self.headers,
        )
        return response.json()

    def get_payment_status(self, transaction_hash: str) -> Dict[str, Any]:
        """Get payment status from Stellar"""
        response = requests.get(
            f"{self.base_url}/stellar/payment/{transaction_hash}",
            headers=self.headers,
        )
        return response.json()
  `;

  fs.writeFileSync(path.join(outputDir, 'client.py'), client);

  const requirements = `
requests>=2.31.0
typing-extensions>=4.0.0
  `;

  fs.writeFileSync(path.join(outputDir, 'requirements.txt'), requirements);
}

function generateGoSDK(outputDir: string, config: GeneratorConfig): void {
  const client = `
package agenticpay

import (
    "bytes"
    "encoding/json"
    "fmt"
    "io"
    "net/http"
)

// Client represents the AgenticPay API client
type Client struct {
    BaseURL string
    Token   string
    HTTP    *http.Client
}

// NewClient creates a new AgenticPay API client
func NewClient(token, baseURL string) *Client {
    if baseURL == "" {
        baseURL = "${config.baseUrl}"
    }
    return &Client{
        BaseURL: baseURL,
        Token:   token,
        HTTP:    &http.Client{},
    }
}

// BatchVerify verifies work submissions in batch
func (c *Client) BatchVerify(verifications []interface{}) (interface{}, error) {
    payload := map[string]interface{}{
        "verifications": verifications,
    }
    return c.doRequest("POST", "/verification/verify/batch", payload)
}

// GenerateInvoice generates an invoice for completed work
func (c *Client) GenerateInvoice(projectID, workDescription string, hoursWorked, hourlyRate float64) (interface{}, error) {
    payload := map[string]interface{}{
        "projectId":      projectID,
        "workDescription": workDescription,
        "hoursWorked":    hoursWorked,
        "hourlyRate":     hourlyRate,
    }
    return c.doRequest("POST", "/invoice/generate", payload)
}

func (c *Client) doRequest(method, path string, payload interface{}) (interface{}, error) {
    url := fmt.Sprintf("%s%s", c.BaseURL, path)

    body, err := json.Marshal(payload)
    if err != nil {
        return nil, err
    }

    req, err := http.NewRequest(method, url, bytes.NewBuffer(body))
    if err != nil {
        return nil, err
    }

    req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", c.Token))
    req.Header.Set("Content-Type", "application/json")

    resp, err := c.HTTP.Do(req)
    if err != nil {
        return nil, err
    }
    defer resp.Body.Close()

    respBody, err := io.ReadAll(resp.Body)
    if err != nil {
        return nil, err
    }

    var result interface{}
    err = json.Unmarshal(respBody, &result)
    if err != nil {
        return nil, err
    }

    return result, nil
}
  `;

  fs.writeFileSync(path.join(outputDir, 'client.go'), client);

  const goMod = `
module github.com/Smartdevs17/agenticpay-sdk-go

go 1.21
  `;

  fs.writeFileSync(path.join(outputDir, 'go.mod'), goMod);
}

function registerCommonEndpoints(generator: any): void {
  // Register verification endpoints
  generator.registerPath('POST', '/verification/verify/batch', {
    tags: ['Verification'],
    summary: 'Batch verify work submissions',
    description: 'Verify multiple work submissions in a single request',
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              verifications: {
                type: 'array',
                items: {
                  type: 'object',
                },
              },
            },
          },
        },
      },
    },
    responses: {
      '200': {
        description: 'Verifications processed successfully',
      },
      '400': {
        description: 'Invalid request',
      },
    },
  });

  // Register invoice endpoints
  generator.registerPath('POST', '/invoice/generate', {
    tags: ['Invoice'],
    summary: 'Generate invoice',
    description: 'Generate an invoice for completed work',
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              projectId: { type: 'string' },
              workDescription: { type: 'string' },
              hoursWorked: { type: 'number' },
              hourlyRate: { type: 'number' },
            },
            required: ['projectId', 'workDescription', 'hoursWorked', 'hourlyRate'],
          },
        },
      },
    },
    responses: {
      '200': {
        description: 'Invoice generated successfully',
      },
      '400': {
        description: 'Invalid request',
      },
    },
  });

  // Register Stellar endpoints
  generator.registerPath('GET', '/stellar/payment/:transactionHash', {
    tags: ['Stellar'],
    summary: 'Get payment status',
    description: 'Get the status of a payment from Stellar',
    parameters: [
      {
        name: 'transactionHash',
        in: 'path',
        required: true,
        schema: { type: 'string' },
      },
    ],
    responses: {
      '200': {
        description: 'Payment status retrieved',
      },
      '404': {
        description: 'Payment not found',
      },
    },
  });
}

export async function main(): Promise<void> {
  try {
    const config = await loadConfig();
    console.log('🚀 OpenAPI Generator for AgenticPay');
    console.log(`📦 Version: ${config.version}`);
    console.log('');

    await generateOpenAPISpec(config);
    await generatePostmanCollection(config);
    await generateSDKs(config);

    console.log('');
    console.log('✨ Generation complete!');
    console.log(`📁 Documentation available in: ${config.outputDir}`);
  } catch (error) {
    console.error('❌ Generation failed:', error);
    process.exit(1);
  }
}

main();
