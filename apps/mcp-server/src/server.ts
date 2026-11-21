import { createServer } from 'http';
import { MCP_SERVER_PORT } from './config.js';
import { handleAIChat } from './adapter/ai-chat.js';
import { handleAiCapabilities } from './adapter/capabilities.js';
import { createGateway } from './gateway/gateway.js';

// FU-234-C (ADR-234): the local dev script loads the repo root `.env`
// (`--env-file-if-exists=../../.env`), which carries
// `NODE_TLS_REJECT_UNAUTHORIZED=0` for the self-signed regtest LND cert the
// *server* process talks to. The mcp-server never connects to LND — it only
// calls the hosted LLM over public HTTPS — so re-enable certificate
// verification here so that inherited flag does not weaken outgoing TLS in
// dev. (Beta/prod compose forward only the LLM_* env to this service, so this
// is a no-op there.)
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '1';

// ADR-371 D1 — the public /mcp endpoint is now the external gateway: without a
// bearer it serves the read-only guest surface; with a valid MCP bearer it
// serves the connection's scoped surface (per-session McpServer, D8). The old
// identity-less NO_AUTH_CTX raw /mcp is gone (AV-2) — the in-app adapter builds
// its own per-turn server and is unaffected.
const gateway = createGateway();

const httpServer = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${MCP_SERVER_PORT}`);

  if (req.method === 'POST' && url.pathname === '/mcp') {
    await gateway.handler(req, res);
  } else if (req.method === 'POST' && url.pathname === '/ai/chat') {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', async () => {
      const body = Buffer.concat(chunks).toString();
      const { readable, writable } = new TransformStream();
      const writer = writable.getWriter();

      // ADR-390: when the browser aborts the fetch (the assistant "Stop"
      // button), the client socket closes. Abort the upstream LLM call so the
      // cancelled turn stops consuming tokens and running tools.
      const abort = new AbortController();
      res.on('close', () => abort.abort());

      const mockReq = new Request(`http://localhost:${MCP_SERVER_PORT}/ai/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      });

      handleAIChat(mockReq, writer, abort.signal).finally(() => writer.close().catch(() => {}));

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      const reader = readable.getReader();
      const pump = async () => {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            res.write(value);
          }
        } catch {
        } finally {
          res.end();
        }
      };
      pump().catch(() => {});
    });
  } else if (req.method === 'GET' && url.pathname === '/ai/config') {
    await handleAiCapabilities(res);
  } else {
    res.statusCode = 404;
    res.end('Not found');
  }
});

httpServer.listen(MCP_SERVER_PORT, () => {
  console.log(`MCP Server running at http://localhost:${MCP_SERVER_PORT}/mcp`);
  console.log(`AI Chat endpoint at http://localhost:${MCP_SERVER_PORT}/ai/chat`);
});