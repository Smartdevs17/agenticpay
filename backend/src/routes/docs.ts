import { Router, type Request, type Response } from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const docsRouter = Router();

const DOCS_ROOT = path.resolve(__dirname, '../../docs/api');

function loadOpenApiSpec(): object | null {
  const specPath = path.join(DOCS_ROOT, 'openapi/openapi.json');
  if (!fs.existsSync(specPath)) return null;
  return JSON.parse(fs.readFileSync(specPath, 'utf-8')) as object;
}

/** Swagger UI — served at /docs */
docsRouter.get('/', (_req: Request, res: Response) => {
  res.type('html').send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <title>AgenticPay API</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css"/>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    SwaggerUIBundle({
      url: '/docs/openapi.json',
      dom_id: '#swagger-ui',
      deepLinking: true,
      presets: [SwaggerUIBundle.presets.apis, SwaggerUIBundle.SwaggerUIStandalonePreset],
      layout: 'StandaloneLayout',
    });
  </script>
</body>
</html>`);
});

docsRouter.get('/openapi.json', (_req: Request, res: Response) => {
  const spec = loadOpenApiSpec();
  if (!spec) {
    return res.status(503).json({
      error: 'OpenAPI spec not generated',
      hint: 'Run: cd backend && npm run openapi:generate',
    });
  }
  res.json(spec);
});

docsRouter.get('/explorer', (_req: Request, res: Response) => {
  res.redirect('/docs');
});
