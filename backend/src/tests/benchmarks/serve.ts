import http from 'node:http';
import { createBenchmarkApp } from './benchmark-app.js';

const PORT = Number(process.env.PORT ?? 3099);
const app = createBenchmarkApp();
const server = http.createServer(app);

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Benchmark server listening on ${PORT}`);
});
