import { Router } from 'express';
import swaggerUi from 'swagger-ui-express';
import { readFileSync } from 'fs';
import { join } from 'path';

export const swaggerRouter = Router();

// Load the generated OpenAPI spec
const swaggerSpec = JSON.parse(
  readFileSync(join(process.cwd(), 'docs/api/openapi/swagger.json'), 'utf-8')
);

// Configure Swagger UI options
const swaggerOptions = {
  swaggerOptions: {
    persistAuthorization: true,
    docExpansion: 'none',
    filter: true,
    showRequestDuration: true,
    tryItOutEnabled: true,
    syntaxHighlight: {
      activate: true,
      theme: 'monokai'
    },
    displayOperationId: false,
    displayRequestDuration: true,
    defaultModelsExpandDepth: 1,
    defaultModelExpandDepth: 1,
    maxDisplayedTags: 10,
    tagsSorter: 'alpha',
    operationsSorter: 'alpha',
  },
  customSiteTitle: 'AgenticPay API Documentation',
  customCss: `
    .swagger-ui .topbar { display: none }
    .swagger-ui .info { margin: 20px 0; }
    .swagger-ui .scheme-container { margin: 20px 0; }
    .swagger-ui .info .title { font-size: 32px; }
    .swagger-ui .info .description { font-size: 14px; }
  `,
  customJs: `
    // Add authentication to Swagger UI
    window.onload = function() {
      const ui = SwaggerUIBundle;
      if (ui) {
        ui.initOAuth({
          clientId: 'agenticpay-api-client',
          clientSecret: 'agenticpay-api-secret',
          realm: 'agenticpay',
          appName: 'AgenticPay API',
          scopeSeparator: ' ',
          additionalQueryStringParams: {}
        });
      }
    };
  `
};

// Serve Swagger UI
swaggerRouter.use('/', swaggerUi.serve, (req, res, next) => {
  swaggerUi.setup(swaggerSpec, swaggerOptions)(req, res, next);
});

// Serve the raw OpenAPI spec
swaggerRouter.get('/swagger.json', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.send(swaggerSpec);
});

// Serve OpenAPI spec in YAML format
swaggerRouter.get('/swagger.yaml', (req, res) => {
  try {
    const yaml = require('json2yaml');
    res.setHeader('Content-Type', 'application/x-yaml');
    res.send(yaml.stringify(swaggerSpec));
  } catch (error) {
    res.status(500).json({ error: 'YAML conversion not available' });
  }
});
