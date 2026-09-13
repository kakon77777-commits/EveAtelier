import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';

const staticFiles = Object.freeze({
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
});

const contentSecurityPolicy = [
  "default-src 'self'",
  "img-src 'self' data:",
  "style-src 'self'",
  "script-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join('; ');

function requiredSurface(surface) {
  const methods = ['getConfig', 'getWorkspace', 'submitIntent', 'submitReview', 'resolveAssetFile'];
  if (!surface || methods.some(method => typeof surface[method] !== 'function')) {
    throw new TypeError('human_surface_http_adapter_required');
  }
  return surface;
}

function headers(extra = {}) {
  return {
    'content-security-policy': contentSecurityPolicy,
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'cross-origin-resource-policy': 'same-origin',
    ...extra,
  };
}

function sendJson(response, status, value) {
  const body = Buffer.from(JSON.stringify(value));
  response.writeHead(status, headers({
    'content-type': 'application/json; charset=utf-8',
    'content-length': body.length,
    'cache-control': 'no-store',
  }));
  response.end(body);
}

function publicReason(error) {
  const message = error?.message;
  return typeof message === 'string' && /^[A-Za-z0-9:_-]+$/.test(message)
    ? message
    : 'human_surface_request_failed';
}

function statusFor(reason) {
  if (/not_found|not_in_scope|project_mismatch/.test(reason)) return 404;
  return 400;
}

function readJson(request, maxBodyBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let length = 0;
    let overflow = false;
    request.on('data', chunk => {
      length += chunk.length;
      if (length > maxBodyBytes) {
        overflow = true;
      } else {
        chunks.push(chunk);
      }
    });
    request.on('end', () => {
      if (overflow) {
        const error = new Error('human_surface_request_too_large');
        error.status = 413;
        reject(error);
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new Error('human_surface_json_invalid'));
      }
    });
    request.on('error', reject);
  });
}

export function createHumanWorkbenchHttpServer({
  surface,
  host = '127.0.0.1',
  port = 0,
  maxBodyBytes = 65_536,
  staticRoot = new URL('../../apps/workbench-ui/', import.meta.url),
} = {}) {
  surface = requiredSurface(surface);
  if (!['127.0.0.1', '::1', 'localhost'].includes(host)) {
    throw new Error('human_surface_loopback_required');
  }
  if (!Number.isSafeInteger(port) || port < 0 || port > 65_535) {
    throw new TypeError('human_surface_port_invalid');
  }
  if (!Number.isSafeInteger(maxBodyBytes) || maxBodyBytes < 64 || maxBodyBytes > 1_048_576) {
    throw new TypeError('human_surface_body_limit_invalid');
  }

  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', `http://${host}`);
      if (request.method === 'GET' && staticFiles[url.pathname]) {
        const [file, contentType] = staticFiles[url.pathname];
        const body = await readFile(new URL(file, staticRoot));
        response.writeHead(200, headers({
          'content-type': contentType,
          'content-length': body.length,
          'cache-control': 'no-store',
        }));
        response.end(body);
        return;
      }
      if (request.method === 'GET' && url.pathname === '/api/config') {
        sendJson(response, 200, surface.getConfig());
        return;
      }
      if (request.method === 'GET' && url.pathname === '/api/workspaces') {
        sendJson(response, 200, surface.getWorkspace({
          projectId: url.searchParams.get('projectId'),
          documentId: url.searchParams.get('documentId'),
        }));
        return;
      }
      if (request.method === 'GET' && url.pathname === '/api/assets') {
        const asset = surface.resolveAssetFile({
          projectId: url.searchParams.get('projectId'),
          documentId: url.searchParams.get('documentId'),
          assetId: url.searchParams.get('assetId'),
        });
        response.writeHead(200, headers({
          'content-type': asset.mediaType,
          'content-length': asset.byteSize,
          etag: `"sha256-${asset.sha256}"`,
          'cache-control': 'no-store, private',
        }));
        createReadStream(asset.path).pipe(response);
        return;
      }
      if (request.method === 'POST'
          && ['/api/intents', '/api/reviews'].includes(url.pathname)) {
        if (!String(request.headers['content-type'] ?? '').toLowerCase()
          .startsWith('application/json')) {
          sendJson(response, 415, { error: 'human_surface_json_content_type_required' });
          return;
        }
        const body = await readJson(request, maxBodyBytes);
        const value = url.pathname === '/api/intents'
          ? await surface.submitIntent(body)
          : await surface.submitReview(body);
        sendJson(response, 200, value);
        return;
      }
      sendJson(response, 404, { error: 'human_surface_route_not_found' });
    } catch (error) {
      const reason = publicReason(error);
      sendJson(response, error?.status ?? statusFor(reason), { error: reason });
    }
  });

  return {
    server,
    listen() {
      if (server.listening) throw new Error('human_surface_server_already_listening');
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => {
          server.off('error', reject);
          const address = server.address();
          if (!address || typeof address === 'string') {
            reject(new Error('human_surface_server_address_invalid'));
            return;
          }
          resolve({
            host,
            port: address.port,
            baseUrl: `http://${host === '::1' ? '[::1]' : host}:${address.port}`,
          });
        });
      });
    },
    close() {
      if (!server.listening) return Promise.resolve();
      return new Promise((resolve, reject) => {
        server.close(error => (error ? reject(error) : resolve()));
      });
    },
  };
}
