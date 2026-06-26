import { buildApp } from './app.js';

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? '127.0.0.1';

const app = buildApp();
app
  .listen({ port, host })
  .then((addr) => {
    console.log(`Codebook API listening on ${addr}`);
    console.log(`  GET  ${addr}/api/health`);
    console.log(`  GET  ${addr}/api/reading-plan?fixture=rate-limit`);
    console.log(`  POST ${addr}/api/reading-plan  { fixture | repo,base,head, ingestor? }`);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
