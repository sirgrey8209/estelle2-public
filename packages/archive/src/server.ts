import http from 'node:http';
import { createReadStream } from 'node:fs';
import { stat as fsStat } from 'node:fs/promises';
import archiver from 'archiver';
import { OAuth2Client } from 'google-auth-library';
import type { ArchiveService, ReadResult } from './archive-service.js';

// ─── Auth ────────────────────────────────────────────────────

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const ARCHIVE_API_KEY = process.env.ARCHIVE_API_KEY || '';
const ALLOWED_EMAILS = (process.env.ALLOWED_EMAILS || '').split(',').filter(Boolean);
const ALLOWED_ORIGINS = [
  'https://estelle-hub.mooo.com',
  'http://localhost:8080',
  'http://localhost:10000',
];

const oauthClient = new OAuth2Client(GOOGLE_CLIENT_ID);

/**
 * 요청을 인증합니다. 세 가지 방식 지원:
 * 1. Google ID Token (Authorization: Bearer <token>)
 * 2. API Key (X-API-Key: <key>)
 * 3. Localhost 요청은 인증 건너뜀
 */
async function authenticate(req: http.IncomingMessage): Promise<boolean> {
  // Localhost 요청은 허용 (MCP 도구 등 로컬 서버-서버 통신)
  const remoteAddr = req.socket.remoteAddress;
  if (remoteAddr === '127.0.0.1' || remoteAddr === '::1' || remoteAddr === '::ffff:127.0.0.1') {
    return true;
  }

  // API Key 인증 (서버-서버)
  const apiKey = req.headers['x-api-key'] as string | undefined;
  if (ARCHIVE_API_KEY && apiKey === ARCHIVE_API_KEY) {
    return true;
  }

  // Google ID Token 인증 (브라우저)
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return false;
  }

  const idToken = authHeader.slice(7);
  try {
    const ticket = await oauthClient.verifyIdToken({
      idToken,
      audience: GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    if (!payload?.email) return false;
    return ALLOWED_EMAILS.includes(payload.email);
  } catch {
    return false;
  }
}

// ─── Helpers ─────────────────────────────────────────────────

function setCors(res: http.ServerResponse, req: http.IncomingMessage): void {
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
}

function sendJson(res: http.ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(body);
}

function sendError(res: http.ServerResponse, status: number, message: string): void {
  sendJson(res, status, { error: message });
}

function parseQuery(url: string): { pathname: string; params: URLSearchParams } {
  const parsed = new URL(url, 'http://localhost');
  return { pathname: parsed.pathname, params: parsed.searchParams };
}

const MAX_BODY_SIZE = 10 * 1024 * 1024; // 10MB

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalSize = 0;
    req.on('data', (chunk: Buffer) => {
      totalSize += chunk.length;
      if (totalSize > MAX_BODY_SIZE) {
        req.destroy();
        reject(new Error('Request body too large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

// ─── Route Handlers ──────────────────────────────────────────

async function handleList(
  service: ArchiveService,
  params: URLSearchParams,
  res: http.ServerResponse,
): Promise<void> {
  const path = params.get('path') ?? '';
  const depth = parseInt(params.get('depth') ?? '1', 10);

  // Use '.' for empty path to match ArchiveService convention
  const listPath = path === '' ? '.' : path;
  const result = await service.list(listPath, depth);
  sendJson(res, 200, result);
}

async function handleRead(
  service: ArchiveService,
  params: URLSearchParams,
  res: http.ServerResponse,
): Promise<void> {
  const path = params.get('path');
  if (!path) {
    sendError(res, 400, 'Missing required parameter: path');
    return;
  }

  const result: ReadResult = await service.read(path);

  if (Buffer.isBuffer(result.content)) {
    // Binary: return raw bytes
    res.writeHead(200, {
      'Content-Type': result.mimeType,
      'Content-Length': result.size,
    });
    res.end(result.content);
  } else {
    // Text: return JSON envelope
    sendJson(res, 200, {
      content: result.content,
      mimeType: result.mimeType,
      size: result.size,
    });
  }
}

async function handleWrite(
  service: ArchiveService,
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  const raw = await readBody(req);
  let parsed: { path?: string; content?: string };

  try {
    parsed = JSON.parse(raw);
  } catch {
    sendError(res, 400, 'Invalid JSON body');
    return;
  }

  if (!parsed.path) {
    sendError(res, 400, 'Missing required field: path');
    return;
  }
  if (parsed.content === undefined || parsed.content === null) {
    sendError(res, 400, 'Missing required field: content');
    return;
  }

  await service.write(parsed.path, parsed.content);
  sendJson(res, 200, { ok: true });
}

async function handleGlob(
  service: ArchiveService,
  params: URLSearchParams,
  res: http.ServerResponse,
): Promise<void> {
  const pattern = params.get('pattern');
  if (!pattern) {
    sendError(res, 400, 'Missing required parameter: pattern');
    return;
  }

  const nocase = params.get('nocase') === '1';
  const matches = await service.glob(pattern, { nocase });
  sendJson(res, 200, { matches });
}

async function handleGrep(
  service: ArchiveService,
  params: URLSearchParams,
  res: http.ServerResponse,
): Promise<void> {
  const query = params.get('query');
  if (!query) {
    sendError(res, 400, 'Missing required parameter: query');
    return;
  }

  const path = params.get('path') ?? undefined;
  const matches = await service.grep(query, path);
  sendJson(res, 200, { matches });
}

async function handleDelete(
  service: ArchiveService,
  params: URLSearchParams,
  res: http.ServerResponse,
): Promise<void> {
  const path = params.get('path');
  if (!path) {
    sendError(res, 400, 'Missing required parameter: path');
    return;
  }

  const recursive = params.get('recursive') === 'true';
  await service.delete(path, recursive);
  sendJson(res, 200, { ok: true });
}

async function handleRename(
  service: ArchiveService,
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  const raw = await readBody(req);
  let parsed: { from?: string; to?: string };

  try {
    parsed = JSON.parse(raw);
  } catch {
    sendError(res, 400, 'Invalid JSON body');
    return;
  }

  if (!parsed.from) {
    sendError(res, 400, 'Missing required field: from');
    return;
  }
  if (!parsed.to) {
    sendError(res, 400, 'Missing required field: to');
    return;
  }

  await service.rename(parsed.from, parsed.to);
  sendJson(res, 200, { ok: true });
}

async function handleDownload(
  service: ArchiveService,
  params: URLSearchParams,
  res: http.ServerResponse,
): Promise<void> {
  const path = params.get('path');
  if (!path) {
    sendError(res, 400, 'Missing required parameter: path');
    return;
  }

  const info = await service.download(path);

  if (info.isDirectory) {
    // Zip streaming
    res.writeHead(200, {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${info.filename}.zip"`,
    });

    const archive = archiver('zip', { zlib: { level: 5 } });
    archive.pipe(res);
    archive.on('error', (err) => {
      console.error('[Archive] zip error:', err);
      res.destroy();
    });
    archive.directory(info.fullPath, false);
    await archive.finalize();
  } else {
    // File download
    const fileStat = await fsStat(info.fullPath);

    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': fileStat.size,
      'Content-Disposition': `attachment; filename="${info.filename}"`,
    });

    createReadStream(info.fullPath).pipe(res);
  }
}

// ─── Server Factory ──────────────────────────────────────────

export function createArchiveServer(service: ArchiveService): http.Server {
  const server = http.createServer(async (req, res) => {
    setCors(res, req);

    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // Authenticate
    const authorized = await authenticate(req);
    if (!authorized) {
      sendError(res, 401, 'Unauthorized');
      return;
    }

    const { pathname, params } = parseQuery(req.url ?? '/');

    try {
      switch (pathname) {
        case '/archive/list':
          if (req.method !== 'GET') {
            sendError(res, 405, 'Method not allowed');
            return;
          }
          await handleList(service, params, res);
          break;

        case '/archive/read':
          if (req.method !== 'GET') {
            sendError(res, 405, 'Method not allowed');
            return;
          }
          await handleRead(service, params, res);
          break;

        case '/archive/write':
          if (req.method !== 'POST') {
            sendError(res, 405, 'Method not allowed');
            return;
          }
          await handleWrite(service, req, res);
          break;

        case '/archive/glob':
          if (req.method !== 'GET') {
            sendError(res, 405, 'Method not allowed');
            return;
          }
          await handleGlob(service, params, res);
          break;

        case '/archive/grep':
          if (req.method !== 'GET') {
            sendError(res, 405, 'Method not allowed');
            return;
          }
          await handleGrep(service, params, res);
          break;

        case '/archive/delete':
          if (req.method !== 'DELETE') {
            sendError(res, 405, 'Method not allowed');
            return;
          }
          await handleDelete(service, params, res);
          break;

        case '/archive/rename':
          if (req.method !== 'POST') {
            sendError(res, 405, 'Method not allowed');
            return;
          }
          await handleRename(service, req, res);
          break;

        case '/archive/download':
          if (req.method !== 'GET') {
            sendError(res, 405, 'Method not allowed');
            return;
          }
          await handleDownload(service, params, res);
          break;

        default:
          sendError(res, 404, `Not found: ${pathname}`);
          break;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Internal server error';
      const code = err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        sendError(res, 404, message);
      } else {
        sendError(res, 500, message);
      }
    }
  });

  return server;
}
