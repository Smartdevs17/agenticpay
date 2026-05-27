import { readFile } from 'fs/promises';
import { join } from 'path';

export const dynamic = 'force-static';

export async function GET() {
  const filePath = join(process.cwd(), 'public', 'sw.js');
  const source = await readFile(filePath, 'utf8');

  return new Response(source, {
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Service-Worker-Allowed': '/',
    },
  });
}
