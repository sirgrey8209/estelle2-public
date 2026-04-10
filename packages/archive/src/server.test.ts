import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import { ArchiveService } from './archive-service.js';
import { createArchiveServer } from './server.js';

// ─── Helper ──────────────────────────────────────────────────

function request(
  port: number,
  method: string,
  path: string,
  body?: unknown,
  extraHeaders?: Record<string, string>,
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = { ...extraHeaders };
    if (body) headers['Content-Type'] = 'application/json';

    const options: http.RequestOptions = {
      hostname: '127.0.0.1',
      port,
      path,
      method,
      headers,
    };

    const req = http.request(options, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        resolve({
          status: res.statusCode!,
          headers: res.headers,
          body: Buffer.concat(chunks),
        });
      });
    });

    req.on('error', reject);

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

function json(res: { body: Buffer }): unknown {
  return JSON.parse(res.body.toString('utf-8'));
}

// ─── Tests ───────────────────────────────────────────────────

describe('Archive HTTP Server', () => {
  let tempDir: string;
  let service: ArchiveService;
  let server: http.Server;
  let port: number;

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'archive-server-test-'));
    service = new ArchiveService(tempDir);
    server = createArchiveServer(service);

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        if (typeof addr === 'object' && addr !== null) {
          port = addr.port;
        }
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    await rm(tempDir, { recursive: true, force: true });
  });

  // ─── CORS ────────────────────────────────────────────────

  describe('CORS', () => {
    it('should include CORS headers for allowed origins', async () => {
      const res = await request(port, 'GET', '/archive/list', undefined, {
        Origin: 'http://localhost:8080',
      });
      expect(res.headers['access-control-allow-origin']).toBe('http://localhost:8080');
    });

    it('should not include CORS origin for unknown origins', async () => {
      const res = await request(port, 'GET', '/archive/list', undefined, {
        Origin: 'http://evil.com',
      });
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('should handle OPTIONS preflight with 204', async () => {
      const res = await request(port, 'OPTIONS', '/archive/list', undefined, {
        Origin: 'http://localhost:8080',
      });
      expect(res.status).toBe(204);
      expect(res.headers['access-control-allow-origin']).toBe('http://localhost:8080');
      expect(res.headers['access-control-allow-methods']).toBeDefined();
      expect(res.headers['access-control-allow-headers']).toBeDefined();
      expect(res.body.length).toBe(0);
    });
  });

  // ─── 404 ─────────────────────────────────────────────────

  describe('unknown routes', () => {
    it('should return 404 for unknown paths', async () => {
      const res = await request(port, 'GET', '/unknown');
      expect(res.status).toBe(404);
      const body = json(res) as { error: string };
      expect(body.error).toBeDefined();
    });
  });

  // ─── /archive/list ──────────────────────────────────────

  describe('GET /archive/list', () => {
    beforeEach(async () => {
      await mkdir(join(tempDir, 'docs'), { recursive: true });
      await writeFile(join(tempDir, 'docs/readme.md'), '# Hello');
      await writeFile(join(tempDir, 'root.txt'), 'root');
    });

    afterEach(async () => {
      await rm(join(tempDir, 'docs'), { recursive: true, force: true });
      await rm(join(tempDir, 'root.txt'), { force: true });
    });

    it('should list root directory by default', async () => {
      const res = await request(port, 'GET', '/archive/list');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('application/json');
      const body = json(res) as { entries: unknown[]; path: string };
      expect(body.entries).toBeDefined();
      expect(Array.isArray(body.entries)).toBe(true);
    });

    it('should support path parameter', async () => {
      const res = await request(port, 'GET', '/archive/list?path=docs');
      expect(res.status).toBe(200);
      const body = json(res) as { entries: { name: string }[]; path: string };
      expect(body.path).toBe('docs');
      expect(body.entries.some((e) => e.name === 'readme.md')).toBe(true);
    });

    it('should support depth parameter', async () => {
      const res = await request(port, 'GET', '/archive/list?depth=2');
      expect(res.status).toBe(200);
      const body = json(res) as { entries: { name: string; children?: unknown[] }[] };
      const docs = body.entries.find((e) => e.name === 'docs');
      expect(docs?.children).toBeDefined();
    });
  });

  // ─── /archive/read ──────────────────────────────────────

  describe('GET /archive/read', () => {
    beforeEach(async () => {
      await writeFile(join(tempDir, 'hello.txt'), 'Hello, World!');
      await writeFile(join(tempDir, 'image.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    });

    afterEach(async () => {
      await rm(join(tempDir, 'hello.txt'), { force: true });
      await rm(join(tempDir, 'image.png'), { force: true });
    });

    it('should require path parameter', async () => {
      const res = await request(port, 'GET', '/archive/read');
      expect(res.status).toBe(400);
      const body = json(res) as { error: string };
      expect(body.error).toBeDefined();
    });

    it('should return text files as JSON', async () => {
      const res = await request(port, 'GET', '/archive/read?path=hello.txt');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('application/json');
      const body = json(res) as { content: string; mimeType: string; size: number };
      expect(body.content).toBe('Hello, World!');
      expect(body.mimeType).toBe('text/plain');
      expect(body.size).toBe(13);
    });

    it('should return binary files as raw bytes', async () => {
      const res = await request(port, 'GET', '/archive/read?path=image.png');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('image/png');
      expect(res.headers['content-length']).toBe('4');
      // Raw bytes, not JSON-wrapped
      expect(res.body).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    });

    it('should return 404 for non-existent files', async () => {
      const res = await request(port, 'GET', '/archive/read?path=nonexistent.txt');
      expect(res.status).toBe(404);
      const body = json(res) as { error: string };
      expect(body.error).toBeDefined();
    });
  });

  // ─── /archive/write ─────────────────────────────────────

  describe('POST /archive/write', () => {
    afterEach(async () => {
      await rm(join(tempDir, 'written.txt'), { force: true }).catch(() => {});
      await rm(join(tempDir, 'deep'), { recursive: true, force: true }).catch(() => {});
    });

    it('should create a file', async () => {
      const res = await request(port, 'POST', '/archive/write', {
        path: 'written.txt',
        content: 'test content',
      });
      expect(res.status).toBe(200);
      const body = json(res) as { ok: boolean };
      expect(body.ok).toBe(true);

      const content = await readFile(join(tempDir, 'written.txt'), 'utf-8');
      expect(content).toBe('test content');
    });

    it('should auto-create directories', async () => {
      const res = await request(port, 'POST', '/archive/write', {
        path: 'deep/nested/file.txt',
        content: 'deep content',
      });
      expect(res.status).toBe(200);

      const content = await readFile(join(tempDir, 'deep/nested/file.txt'), 'utf-8');
      expect(content).toBe('deep content');
    });

    it('should return 400 for missing path', async () => {
      const res = await request(port, 'POST', '/archive/write', {
        content: 'no path',
      });
      expect(res.status).toBe(400);
    });

    it('should return 400 for missing content', async () => {
      const res = await request(port, 'POST', '/archive/write', {
        path: 'missing-content.txt',
      });
      expect(res.status).toBe(400);
    });
  });

  // ─── /archive/glob ──────────────────────────────────────

  describe('GET /archive/glob', () => {
    beforeEach(async () => {
      await mkdir(join(tempDir, 'src'), { recursive: true });
      await writeFile(join(tempDir, 'src/index.ts'), 'code');
      await writeFile(join(tempDir, 'src/util.ts'), 'util');
      await writeFile(join(tempDir, 'notes.md'), '# notes');
    });

    afterEach(async () => {
      await rm(join(tempDir, 'src'), { recursive: true, force: true });
      await rm(join(tempDir, 'notes.md'), { force: true });
    });

    it('should require pattern parameter', async () => {
      const res = await request(port, 'GET', '/archive/glob');
      expect(res.status).toBe(400);
      const body = json(res) as { error: string };
      expect(body.error).toBeDefined();
    });

    it('should return matching files', async () => {
      const res = await request(port, 'GET', '/archive/glob?pattern=**/*.ts');
      expect(res.status).toBe(200);
      const body = json(res) as { matches: string[] };
      expect(body.matches).toContain('src/index.ts');
      expect(body.matches).toContain('src/util.ts');
    });

    it('should return empty array for no matches', async () => {
      const res = await request(port, 'GET', '/archive/glob?pattern=**/*.xyz');
      expect(res.status).toBe(200);
      const body = json(res) as { matches: string[] };
      expect(body.matches).toEqual([]);
    });
  });

  // ─── /archive/grep ──────────────────────────────────────

  describe('GET /archive/grep', () => {
    beforeEach(async () => {
      await mkdir(join(tempDir, 'src'), { recursive: true });
      await writeFile(join(tempDir, 'src/main.ts'), 'const hello = "world";\nfunction greet() {}');
      await writeFile(join(tempDir, 'notes.md'), '# Hello\nSome hello notes.');
    });

    afterEach(async () => {
      await rm(join(tempDir, 'src'), { recursive: true, force: true });
      await rm(join(tempDir, 'notes.md'), { force: true });
    });

    it('should require query parameter', async () => {
      const res = await request(port, 'GET', '/archive/grep');
      expect(res.status).toBe(400);
      const body = json(res) as { error: string };
      expect(body.error).toBeDefined();
    });

    it('should return matching lines', async () => {
      const res = await request(port, 'GET', '/archive/grep?query=hello');
      expect(res.status).toBe(200);
      const body = json(res) as { matches: { path: string; line: number; content: string }[] };
      expect(body.matches.length).toBeGreaterThanOrEqual(2);
      for (const match of body.matches) {
        expect(match.path).toBeDefined();
        expect(typeof match.line).toBe('number');
        expect(match.content).toContain('hello');
      }
    });

    it('should support optional path parameter', async () => {
      const res = await request(port, 'GET', '/archive/grep?query=hello&path=src');
      expect(res.status).toBe(200);
      const body = json(res) as { matches: { path: string }[] };
      for (const match of body.matches) {
        expect(match.path.startsWith('src/')).toBe(true);
      }
    });
  });

  // ─── /archive/delete ────────────────────────────────────

  describe('DELETE /archive/delete', () => {
    it('should delete a file', async () => {
      await writeFile(join(tempDir, 'to-delete.txt'), 'bye');
      const res = await request(port, 'DELETE', '/archive/delete?path=to-delete.txt');
      expect(res.status).toBe(200);
      const body = json(res) as { ok: boolean };
      expect(body.ok).toBe(true);
      await expect(stat(join(tempDir, 'to-delete.txt'))).rejects.toThrow();
    });

    it('should delete directory with recursive', async () => {
      await mkdir(join(tempDir, 'del-dir/sub'), { recursive: true });
      await writeFile(join(tempDir, 'del-dir/sub/file.txt'), 'data');
      const res = await request(port, 'DELETE', '/archive/delete?path=del-dir&recursive=true');
      expect(res.status).toBe(200);
      await expect(stat(join(tempDir, 'del-dir'))).rejects.toThrow();
    });

    it('should return 400 for missing path', async () => {
      const res = await request(port, 'DELETE', '/archive/delete');
      expect(res.status).toBe(400);
      const body = json(res) as { error: string };
      expect(body.error).toBeDefined();
    });
  });

  // ─── /archive/rename ────────────────────────────────────

  describe('POST /archive/rename', () => {
    it('should rename a file', async () => {
      await writeFile(join(tempDir, 'rename-src.txt'), 'content');
      const res = await request(port, 'POST', '/archive/rename', {
        from: 'rename-src.txt',
        to: 'rename-dst.txt',
      });
      expect(res.status).toBe(200);
      const body = json(res) as { ok: boolean };
      expect(body.ok).toBe(true);
      const content = await readFile(join(tempDir, 'rename-dst.txt'), 'utf-8');
      expect(content).toBe('content');
    });

    it('should return 400 for missing from/to', async () => {
      const res1 = await request(port, 'POST', '/archive/rename', { from: 'a.txt' });
      expect(res1.status).toBe(400);

      const res2 = await request(port, 'POST', '/archive/rename', { to: 'b.txt' });
      expect(res2.status).toBe(400);
    });

    it('should return 404 for non-existent file', async () => {
      const res = await request(port, 'POST', '/archive/rename', {
        from: 'nonexistent.txt',
        to: 'dest.txt',
      });
      expect(res.status).toBe(404);
      const body = json(res) as { error: string };
      expect(body.error).toBeDefined();
    });
  });

  // ─── /archive/download ─────────────────────────────────

  describe('GET /archive/download', () => {
    beforeEach(async () => {
      await writeFile(join(tempDir, 'dl-file.txt'), 'download me');
      await mkdir(join(tempDir, 'dl-folder/sub'), { recursive: true });
      await writeFile(join(tempDir, 'dl-folder/a.txt'), 'file a');
      await writeFile(join(tempDir, 'dl-folder/sub/b.txt'), 'file b');
    });

    afterEach(async () => {
      await rm(join(tempDir, 'dl-file.txt'), { force: true });
      await rm(join(tempDir, 'dl-folder'), { recursive: true, force: true });
    });

    it('should require path parameter', async () => {
      const res = await request(port, 'GET', '/archive/download');
      expect(res.status).toBe(400);
    });

    it('should download a file with Content-Disposition attachment', async () => {
      const res = await request(port, 'GET', '/archive/download?path=dl-file.txt');
      expect(res.status).toBe(200);
      expect(res.headers['content-disposition']).toContain('attachment');
      expect(res.headers['content-disposition']).toContain('dl-file.txt');
      expect(res.body.toString('utf-8')).toBe('download me');
    });

    it('should download a folder as zip', async () => {
      const res = await request(port, 'GET', '/archive/download?path=dl-folder');
      expect(res.status).toBe(200);
      expect(res.headers['content-disposition']).toContain('attachment');
      expect(res.headers['content-disposition']).toContain('dl-folder.zip');
      expect(res.headers['content-type']).toBe('application/zip');
      // ZIP magic number: PK (0x50 0x4b)
      expect(res.body[0]).toBe(0x50);
      expect(res.body[1]).toBe(0x4b);
    });

    it('should return 404 for non-existent path', async () => {
      const res = await request(port, 'GET', '/archive/download?path=nonexistent');
      expect(res.status).toBe(404);
    });
  });
});
