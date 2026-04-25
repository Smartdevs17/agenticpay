import { readFile } from 'node:fs/promises';
import path from 'node:path';

export async function GET() {
  const swPath = path.join(process.cwd(), 'public', 'sw.js');
  const serviceWorkerSource = await readFile(swPath, 'utf8');

  return new Response(serviceWorkerSource, {
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Service-Worker-Allowed': '/',
    },
  });
}
