/**
 * Runs the Netlify functions locally during `npm run dev`.
 *
 * On Netlify, a request to /api/auth-login is routed to
 * netlify/functions/auth-login.ts (see netlify.toml). This plugin does the same
 * thing on your own machine, so local development behaves exactly like the live
 * site without needing any extra tools installed.
 *
 * Development only - it is not part of the deployed build.
 */

import { existsSync } from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';

const FUNCTIONS_DIR = 'netlify/functions';

/** Turns a Node request into the standard Web Request the functions expect. */
async function toWebRequest(req: IncomingMessage): Promise<Request> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    headers.set(key, Array.isArray(value) ? value.join(', ') : value);
  }

  const method = req.method ?? 'GET';
  let body: Buffer | undefined;

  if (method !== 'GET' && method !== 'HEAD') {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
    }
    body = Buffer.concat(chunks);
  }

  return new Request(url.toString(), {
    method,
    headers,
    body: body && body.length > 0 ? new Uint8Array(body) : undefined,
  });
}

async function sendWebResponse(res: ServerResponse, response: Response): Promise<void> {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => res.setHeader(key, value));
  const buffer = Buffer.from(await response.arrayBuffer());
  res.end(buffer);
}

export function localFunctionsPlugin(): Plugin {
  return {
    name: 'pilot-prospector:local-functions',
    apply: 'serve',

    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const rawUrl = req.url ?? '';
        if (!rawUrl.startsWith('/api/')) return next();

        // /api/auth-login?foo=1 -> "auth-login"
        const name = rawUrl.slice('/api/'.length).split('?')[0]?.replace(/\/+$/, '') ?? '';

        // Reject anything that tries to escape the functions folder.
        if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
          res.statusCode = 400;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'Unknown endpoint.' }));
          return;
        }

        const filePath = path.resolve(server.config.root, FUNCTIONS_DIR, `${name}.ts`);
        if (!existsSync(filePath)) {
          res.statusCode = 404;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: `No such endpoint: /api/${name}` }));
          return;
        }

        try {
          const module = (await server.ssrLoadModule(filePath)) as {
            default?: (request: Request) => Promise<Response> | Response;
          };

          if (typeof module.default !== 'function') {
            throw new Error(`${name}.ts does not export a default handler`);
          }

          const request = await toWebRequest(req);
          const response = await module.default(request);
          await sendWebResponse(res, response);
        } catch (error) {
          server.config.logger.error(
            `[local-functions] /api/${name} failed: ${(error as Error)?.message}`,
          );
          console.error(error);
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(
            JSON.stringify({
              error:
                (error as Error)?.message ??
                'The local function crashed. Check the terminal for details.',
            }),
          );
        }
      });
    },
  };
}
