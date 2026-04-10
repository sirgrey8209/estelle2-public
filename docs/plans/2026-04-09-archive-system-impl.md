# Archive System Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 클라우드 서버에 파일시스템 기반 문서 저장소를 만들고, HTTP API + MCP 도구 + 허브 UI 뷰어를 통해 두 PC에서 접근 가능하게 한다.

**Architecture:** 클라우드 서버의 `/home/estelle/archive/` 디렉토리가 진실의 원천. HTTP API 서버가 파일 접근을 제공하고, MCP 도구는 로컬이면 직접 fs 접근, 원격이면 HTTP API를 호출한다. 허브 UI에 VSCode 스타일 뷰어를 통합한다.

**Tech Stack:** Node.js (raw http), TypeScript, Vitest, React, Zustand, Tailwind, Radix UI

**Design Doc:** `docs/plans/2026-04-09-archive-system-design.md`

---

## Task 1: Archive 패키지 스캐폴딩

**Files:**
- Create: `packages/archive/package.json`
- Create: `packages/archive/tsconfig.json`
- Create: `packages/archive/src/index.ts`

**Step 1: 패키지 디렉토리 및 package.json 생성**

```json
{
  "name": "@estelle/archive",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "glob": "^11.0.0"
  },
  "devDependencies": {
    "typescript": "^5.7.3",
    "vitest": "^3.0.4",
    "@types/node": "^22.13.4"
  }
}
```

**Step 2: tsconfig.json 생성**

기존 패키지(`packages/relay/tsconfig.json`)의 패턴을 따른다.

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "declaration": true,
    "sourceMap": true
  },
  "include": ["src/**/*"]
}
```

**Step 3: 빈 엔트리 포인트 생성**

```typescript
// packages/archive/src/index.ts
export { createArchiveServer } from './server.js';
```

**Step 4: npm install 실행**

Run: `cd packages/archive && npm install`

**Step 5: 커밋**

```bash
git add packages/archive/
git commit -m "feat(archive): scaffold archive package"
```

---

## Task 2: Archive 파일 서비스 (코어 로직)

**Files:**
- Create: `packages/archive/src/archive-service.ts`
- Create: `packages/archive/src/archive-service.test.ts`

이 서비스는 파일시스템 접근을 추상화한다. HTTP 서버와 MCP 도구 모두 이 서비스를 사용한다.

**Step 1: 테스트 작성**

```typescript
// packages/archive/src/archive-service.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ArchiveService } from './archive-service.js';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

describe('ArchiveService', () => {
  let service: ArchiveService;
  let testRoot: string;

  beforeEach(async () => {
    testRoot = path.join(os.tmpdir(), `archive-test-${Date.now()}`);
    await fs.mkdir(testRoot, { recursive: true });
    service = new ArchiveService(testRoot);
  });

  afterEach(async () => {
    await fs.rm(testRoot, { recursive: true, force: true });
  });

  describe('write', () => {
    it('should create a text file', async () => {
      await service.write('notes/hello.md', '# Hello');
      const content = await fs.readFile(path.join(testRoot, 'notes/hello.md'), 'utf-8');
      expect(content).toBe('# Hello');
    });

    it('should create intermediate directories', async () => {
      await service.write('a/b/c/deep.md', 'deep');
      const content = await fs.readFile(path.join(testRoot, 'a/b/c/deep.md'), 'utf-8');
      expect(content).toBe('deep');
    });

    it('should reject path traversal', async () => {
      await expect(service.write('../escape.md', 'bad')).rejects.toThrow();
    });
  });

  describe('read', () => {
    it('should read a text file', async () => {
      await fs.mkdir(path.join(testRoot, 'notes'), { recursive: true });
      await fs.writeFile(path.join(testRoot, 'notes/test.md'), '# Test');
      const result = await service.read('notes/test.md');
      expect(result.content).toBe('# Test');
      expect(result.mimeType).toBe('text/markdown');
    });

    it('should throw on non-existent file', async () => {
      await expect(service.read('nope.md')).rejects.toThrow();
    });

    it('should reject path traversal', async () => {
      await expect(service.read('../../etc/passwd')).rejects.toThrow();
    });
  });

  describe('list', () => {
    it('should list root directory with depth 1', async () => {
      await fs.mkdir(path.join(testRoot, 'notes'), { recursive: true });
      await fs.mkdir(path.join(testRoot, 'projects'), { recursive: true });
      await fs.writeFile(path.join(testRoot, 'readme.md'), 'hi');
      const result = await service.list('', 1);
      expect(result.entries).toHaveLength(3);
    });

    it('should respect depth limit', async () => {
      await fs.mkdir(path.join(testRoot, 'a/b/c'), { recursive: true });
      await fs.writeFile(path.join(testRoot, 'a/b/c/deep.md'), 'deep');
      const result = await service.list('', 1);
      const aEntry = result.entries.find(e => e.name === 'a');
      expect(aEntry?.children).toBeUndefined();
    });
  });

  describe('glob', () => {
    it('should find files by pattern', async () => {
      await fs.mkdir(path.join(testRoot, 'notes'), { recursive: true });
      await fs.writeFile(path.join(testRoot, 'notes/a.md'), 'a');
      await fs.writeFile(path.join(testRoot, 'notes/b.txt'), 'b');
      const result = await service.glob('**/*.md');
      expect(result).toEqual(['notes/a.md']);
    });
  });

  describe('grep', () => {
    it('should search file contents', async () => {
      await fs.mkdir(path.join(testRoot, 'notes'), { recursive: true });
      await fs.writeFile(path.join(testRoot, 'notes/a.md'), '# Hello World');
      await fs.writeFile(path.join(testRoot, 'notes/b.md'), '# Goodbye');
      const result = await service.grep('Hello');
      expect(result).toHaveLength(1);
      expect(result[0].path).toBe('notes/a.md');
    });
  });
});
```

**Step 2: 테스트 실행해서 실패 확인**

Run: `cd packages/archive && npx vitest run`
Expected: FAIL (archive-service.ts 없음)

**Step 3: ArchiveService 구현**

```typescript
// packages/archive/src/archive-service.ts
import fs from 'fs/promises';
import path from 'path';
import { glob as globFn } from 'glob';

export interface FileEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  modifiedAt?: string;
  children?: FileEntry[];
}

export interface ListResult {
  entries: FileEntry[];
  path: string;
}

export interface ReadResult {
  content: string | Buffer;
  mimeType: string;
  size: number;
}

export interface GrepMatch {
  path: string;
  line: number;
  content: string;
}

const TEXT_EXTENSIONS = new Set(['.md', '.txt', '.json', '.yml', '.yaml', '.csv', '.xml', '.html', '.css', '.js', '.ts']);

function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const mimeMap: Record<string, string> = {
    '.md': 'text/markdown', '.txt': 'text/plain', '.json': 'application/json',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp',
    '.pdf': 'application/pdf', '.zip': 'application/zip',
    '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  };
  return mimeMap[ext] || 'application/octet-stream';
}

function isTextFile(filePath: string): boolean {
  return TEXT_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

export class ArchiveService {
  constructor(private readonly rootDir: string) {}

  private resolvePath(relativePath: string): string {
    const resolved = path.resolve(this.rootDir, relativePath);
    if (!resolved.startsWith(this.rootDir)) {
      throw new Error(`Path traversal denied: ${relativePath}`);
    }
    return resolved;
  }

  async write(relativePath: string, content: string | Buffer): Promise<void> {
    const fullPath = this.resolvePath(relativePath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, content);
  }

  async read(relativePath: string): Promise<ReadResult> {
    const fullPath = this.resolvePath(relativePath);
    const stat = await fs.stat(fullPath);
    const mimeType = getMimeType(relativePath);

    if (isTextFile(relativePath)) {
      const content = await fs.readFile(fullPath, 'utf-8');
      return { content, mimeType, size: stat.size };
    }
    const content = await fs.readFile(fullPath);
    return { content, mimeType, size: stat.size };
  }

  async list(relativePath: string, depth: number = 1): Promise<ListResult> {
    const fullPath = this.resolvePath(relativePath || '');
    const entries = await this.readDir(fullPath, depth);
    return { entries, path: relativePath || '' };
  }

  private async readDir(dirPath: string, depth: number): Promise<FileEntry[]> {
    const items = await fs.readdir(dirPath, { withFileTypes: true });
    const entries: FileEntry[] = [];

    for (const item of items) {
      const itemPath = path.join(dirPath, item.name);
      const relativePath = path.relative(this.rootDir, itemPath);
      const stat = await fs.stat(itemPath);

      const entry: FileEntry = {
        name: item.name,
        path: relativePath,
        type: item.isDirectory() ? 'directory' : 'file',
        size: stat.size,
        modifiedAt: stat.mtime.toISOString(),
      };

      if (item.isDirectory() && depth > 1) {
        entry.children = await this.readDir(itemPath, depth - 1);
      }

      entries.push(entry);
    }

    return entries.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }

  async glob(pattern: string): Promise<string[]> {
    const matches = await globFn(pattern, { cwd: this.rootDir, nodir: true });
    return matches.sort();
  }

  async grep(query: string, relativePath?: string): Promise<GrepMatch[]> {
    const searchPath = relativePath ? this.resolvePath(relativePath) : this.rootDir;
    const files = await globFn('**/*', { cwd: searchPath, nodir: true });
    const results: GrepMatch[] = [];

    for (const file of files) {
      const fullPath = path.join(searchPath, file);
      if (!isTextFile(file)) continue;

      try {
        const content = await fs.readFile(fullPath, 'utf-8');
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].includes(query)) {
            results.push({
              path: path.relative(this.rootDir, fullPath),
              line: i + 1,
              content: lines[i].trim(),
            });
          }
        }
      } catch { /* skip unreadable files */ }
    }
    return results;
  }
}
```

**Step 4: 테스트 실행해서 통과 확인**

Run: `cd packages/archive && npx vitest run`
Expected: ALL PASS

**Step 5: 커밋**

```bash
git add packages/archive/src/archive-service.ts packages/archive/src/archive-service.test.ts
git commit -m "feat(archive): implement ArchiveService with tests"
```

---

## Task 3: Archive HTTP 서버

**Files:**
- Create: `packages/archive/src/server.ts`
- Create: `packages/archive/src/server.test.ts`
- Create: `packages/archive/src/bin.ts`

**Step 1: 서버 테스트 작성**

```typescript
// packages/archive/src/server.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createArchiveServer } from './server.js';
import { ArchiveService } from './archive-service.js';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import http from 'http';

function request(server: http.Server, method: string, urlPath: string, body?: string): Promise<{ status: number; data: any }> {
  return new Promise((resolve, reject) => {
    const addr = server.address() as { port: number };
    const req = http.request({ hostname: '127.0.0.1', port: addr.port, path: urlPath, method, headers: body ? { 'Content-Type': 'application/json' } : {} }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode!, data: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode!, data }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

describe('Archive HTTP Server', () => {
  let server: http.Server;
  let testRoot: string;

  beforeAll(async () => {
    testRoot = path.join(os.tmpdir(), `archive-server-test-${Date.now()}`);
    await fs.mkdir(testRoot, { recursive: true });
    await fs.mkdir(path.join(testRoot, 'notes'), { recursive: true });
    await fs.writeFile(path.join(testRoot, 'notes/hello.md'), '# Hello World');
    await fs.writeFile(path.join(testRoot, 'readme.md'), '# Root');

    const service = new ArchiveService(testRoot);
    server = createArchiveServer(service);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  });

  afterAll(async () => {
    server.close();
    await fs.rm(testRoot, { recursive: true, force: true });
  });

  it('GET /archive/list should return directory listing', async () => {
    const { status, data } = await request(server, 'GET', '/archive/list?depth=1');
    expect(status).toBe(200);
    expect(data.entries.length).toBeGreaterThanOrEqual(2);
  });

  it('GET /archive/read should return file content', async () => {
    const { status, data } = await request(server, 'GET', '/archive/read?path=notes/hello.md');
    expect(status).toBe(200);
    expect(data.content).toBe('# Hello World');
  });

  it('POST /archive/write should create a file', async () => {
    const body = JSON.stringify({ path: 'new/test.md', content: '# New File' });
    const { status } = await request(server, 'POST', '/archive/write', body);
    expect(status).toBe(200);
    const written = await fs.readFile(path.join(testRoot, 'new/test.md'), 'utf-8');
    expect(written).toBe('# New File');
  });

  it('GET /archive/glob should find files', async () => {
    const { status, data } = await request(server, 'GET', '/archive/glob?pattern=**/*.md');
    expect(status).toBe(200);
    expect(data.matches).toContain('notes/hello.md');
  });

  it('GET /archive/grep should search content', async () => {
    const { status, data } = await request(server, 'GET', '/archive/grep?query=Hello');
    expect(status).toBe(200);
    expect(data.results.length).toBeGreaterThanOrEqual(1);
  });

  it('should return 404 for unknown routes', async () => {
    const { status } = await request(server, 'GET', '/unknown');
    expect(status).toBe(404);
  });
});
```

**Step 2: 테스트 실행해서 실패 확인**

Run: `cd packages/archive && npx vitest run`
Expected: FAIL (server.ts 없음)

**Step 3: HTTP 서버 구현**

```typescript
// packages/archive/src/server.ts
import http from 'http';
import { ArchiveService } from './archive-service.js';

function parseQuery(url: string): { pathname: string; params: URLSearchParams } {
  const parsed = new URL(url, 'http://localhost');
  return { pathname: parsed.pathname, params: parsed.searchParams };
}

async function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => resolve(body));
  });
}

function json(res: http.ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data));
}

export function createArchiveServer(service: ArchiveService): http.Server {
  return http.createServer(async (req, res) => {
    // CORS preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      });
      res.end();
      return;
    }

    try {
      const { pathname, params } = parseQuery(req.url || '/');

      if (pathname === '/archive/list' && req.method === 'GET') {
        const p = params.get('path') || '';
        const depth = Math.min(parseInt(params.get('depth') || '1'), 3);
        const result = await service.list(p, depth);
        return json(res, 200, result);
      }

      if (pathname === '/archive/read' && req.method === 'GET') {
        const p = params.get('path');
        if (!p) return json(res, 400, { error: 'path is required' });
        const result = await service.read(p);
        if (Buffer.isBuffer(result.content)) {
          res.writeHead(200, {
            'Content-Type': result.mimeType,
            'Content-Length': result.size,
            'Access-Control-Allow-Origin': '*',
          });
          res.end(result.content);
        } else {
          return json(res, 200, { content: result.content, mimeType: result.mimeType, size: result.size });
        }
        return;
      }

      if (pathname === '/archive/write' && req.method === 'POST') {
        const body = JSON.parse(await readBody(req));
        if (!body.path || body.content === undefined) return json(res, 400, { error: 'path and content required' });
        await service.write(body.path, body.content);
        return json(res, 200, { success: true, path: body.path });
      }

      if (pathname === '/archive/glob' && req.method === 'GET') {
        const pattern = params.get('pattern');
        if (!pattern) return json(res, 400, { error: 'pattern is required' });
        const matches = await service.glob(pattern);
        return json(res, 200, { matches });
      }

      if (pathname === '/archive/grep' && req.method === 'GET') {
        const query = params.get('query');
        if (!query) return json(res, 400, { error: 'query is required' });
        const p = params.get('path') || undefined;
        const results = await service.grep(query, p);
        return json(res, 200, { results });
      }

      json(res, 404, { error: 'not found' });
    } catch (err: any) {
      json(res, 500, { error: err.message });
    }
  });
}
```

```typescript
// packages/archive/src/bin.ts
import { ArchiveService } from './archive-service.js';
import { createArchiveServer } from './server.js';

const ARCHIVE_ROOT = process.env.ARCHIVE_ROOT || '/home/estelle/archive';
const PORT = parseInt(process.env.ARCHIVE_PORT || '3009');

const service = new ArchiveService(ARCHIVE_ROOT);
const server = createArchiveServer(service);

server.listen(PORT, () => {
  console.log(`Archive server listening on port ${PORT}`);
  console.log(`Archive root: ${ARCHIVE_ROOT}`);
});
```

**Step 4: 테스트 실행해서 통과 확인**

Run: `cd packages/archive && npx vitest run`
Expected: ALL PASS

**Step 5: 커밋**

```bash
git add packages/archive/src/server.ts packages/archive/src/server.test.ts packages/archive/src/bin.ts packages/archive/src/index.ts
git commit -m "feat(archive): implement HTTP server with tests"
```

---

## Task 4: PM2 및 Caddy 설정

**Files:**
- Modify: `config/environments.json` (archive 포트 추가)
- Modify: `scripts/dev-server.js` (archive 프로세스 추가)
- Modify: `/etc/caddy/Caddyfile` (리버스 프록시 추가)

**Step 1: environments.json에 archive 설정 추가**

참고: `config/environments.json` 확인 후 각 환경(dev, stage, release)에 archive 섹션 추가.

```json
"archive": {
  "port": 3009,
  "root": "/home/estelle/archive"
}
```

**Step 2: dev-server.js에 archive 프로세스 추가**

기존 PM2 프로세스 설정 패턴을 따라 archive 서비스를 추가한다.

```javascript
{
  name: 'estelle-archive',
  script: 'packages/archive/dist/bin.js',
  env: {
    ARCHIVE_PORT: config.archive.port,
    ARCHIVE_ROOT: config.archive.root,
  }
}
```

**Step 3: Caddyfile에 리버스 프록시 추가**

```
handle /archive/* {
    reverse_proxy localhost:3009
}
```

**Step 4: 빌드 및 서비스 시작 확인**

Run: `cd packages/archive && npm run build`
Run: PM2로 archive 서비스 시작
Run: `curl http://localhost:3009/archive/list` → 200 응답 확인

**Step 5: 커밋**

```bash
git add config/environments.json scripts/dev-server.js
git commit -m "feat(archive): add PM2 and Caddy configuration"
```

---

## Task 5: MCP 도구 구현 (archive_write, archive_read)

**Files:**
- Create: `packages/pylon/src/mcp/tools/archive.ts`
- Modify: `packages/pylon/src/mcp/server.ts` (도구 등록)

**Step 1: archive MCP 도구 정의 및 구현**

```typescript
// packages/pylon/src/mcp/tools/archive.ts
import { ArchiveService } from '@estelle/archive';
import type { McpResponse, ToolMeta } from '../types.js';

// 로컬 서비스 (master에서만 사용)
let localService: ArchiveService | null = null;

function getLocalService(): ArchiveService {
  if (!localService) {
    const root = process.env.ARCHIVE_ROOT || '/home/estelle/archive';
    localService = new ArchiveService(root);
  }
  return localService;
}

// 원격 서비스 (slave에서 HTTP API 호출)
const ARCHIVE_API = process.env.ARCHIVE_API_URL || 'http://YOUR_SERVER_IP:3009';

function isMaster(): boolean {
  return process.env.ESTELLE_ROLE === 'master';
}

async function remoteGet(endpoint: string, params: Record<string, string>): Promise<any> {
  const url = new URL(endpoint, ARCHIVE_API);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Archive API error: ${res.status}`);
  return res.json();
}

async function remotePost(endpoint: string, body: object): Promise<any> {
  const res = await fetch(new URL(endpoint, ARCHIVE_API).toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Archive API error: ${res.status}`);
  return res.json();
}

// --- Tool Definitions ---

export function getArchiveWriteDefinition() {
  return {
    name: 'archive_write',
    description: 'Create or update a file in the shared archive. Specify relative path and content.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        path: { type: 'string', description: 'Relative path (e.g. "notes/meeting.md")' },
        content: { type: 'string', description: 'File content (text)' },
      },
      required: ['path', 'content'],
    },
  };
}

export function getArchiveReadDefinition() {
  return {
    name: 'archive_read',
    description: 'Read a file from the shared archive.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        path: { type: 'string', description: 'Relative path to the file' },
      },
      required: ['path'],
    },
  };
}

export function getArchiveListDefinition() {
  return {
    name: 'archive_list',
    description: 'List directory contents in the archive. Returns entries up to specified depth.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        path: { type: 'string', description: 'Directory path (default: root)' },
        depth: { type: 'number', description: 'Depth limit (default: 1, max: 3)' },
      },
    },
  };
}

export function getArchiveGlobDefinition() {
  return {
    name: 'archive_glob',
    description: 'Find files by name pattern in the archive.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        pattern: { type: 'string', description: 'Glob pattern (e.g. "**/*.md", "projects/*.png")' },
      },
      required: ['pattern'],
    },
  };
}

export function getArchiveGrepDefinition() {
  return {
    name: 'archive_grep',
    description: 'Search text content in archive files.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Search text' },
        path: { type: 'string', description: 'Limit search to this subdirectory (optional)' },
      },
      required: ['query'],
    },
  };
}

// --- Tool Executors ---

export async function executeArchiveWrite(args: { path: string; content: string }): Promise<McpResponse> {
  if (!args.path || args.content === undefined) return { content: [{ type: 'text', text: 'path and content are required' }], isError: true };
  if (isMaster()) {
    await getLocalService().write(args.path, args.content);
  } else {
    await remotePost('/archive/write', { path: args.path, content: args.content });
  }
  return { content: [{ type: 'text', text: `Written: ${args.path}` }] };
}

export async function executeArchiveRead(args: { path: string }): Promise<McpResponse> {
  if (!args.path) return { content: [{ type: 'text', text: 'path is required' }], isError: true };
  if (isMaster()) {
    const result = await getLocalService().read(args.path);
    return { content: [{ type: 'text', text: typeof result.content === 'string' ? result.content : `[Binary file: ${result.mimeType}, ${result.size} bytes]` }] };
  }
  const data = await remoteGet('/archive/read', { path: args.path });
  return { content: [{ type: 'text', text: data.content }] };
}

export async function executeArchiveList(args: { path?: string; depth?: number }): Promise<McpResponse> {
  if (isMaster()) {
    const result = await getLocalService().list(args.path || '', args.depth || 1);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
  const params: Record<string, string> = {};
  if (args.path) params.path = args.path;
  if (args.depth) params.depth = String(args.depth);
  const data = await remoteGet('/archive/list', params);
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

export async function executeArchiveGlob(args: { pattern: string }): Promise<McpResponse> {
  if (!args.pattern) return { content: [{ type: 'text', text: 'pattern is required' }], isError: true };
  if (isMaster()) {
    const matches = await getLocalService().glob(args.pattern);
    return { content: [{ type: 'text', text: JSON.stringify(matches, null, 2) }] };
  }
  const data = await remoteGet('/archive/glob', { pattern: args.pattern });
  return { content: [{ type: 'text', text: JSON.stringify(data.matches, null, 2) }] };
}

export async function executeArchiveGrep(args: { query: string; path?: string }): Promise<McpResponse> {
  if (!args.query) return { content: [{ type: 'text', text: 'query is required' }], isError: true };
  if (isMaster()) {
    const results = await getLocalService().grep(args.query, args.path);
    return { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] };
  }
  const params: Record<string, string> = { query: args.query };
  if (args.path) params.path = args.path;
  const data = await remoteGet('/archive/grep', params);
  return { content: [{ type: 'text', text: JSON.stringify(data.results, null, 2) }] };
}
```

**Step 2: server.ts에 도구 등록**

`packages/pylon/src/mcp/server.ts`의 `ListToolsRequestSchema` 핸들러에 5개 정의 추가, `CallToolRequestSchema` switch에 5개 케이스 추가. 기존 패턴(send_file, link_doc 등) 따른다.

**Step 3: 빌드 후 도구 목록 확인**

Run: 빌드 후 MCP 도구 목록에 `archive_write`, `archive_read`, `archive_list`, `archive_glob`, `archive_grep` 표시 확인.

**Step 4: 커밋**

```bash
git add packages/pylon/src/mcp/tools/archive.ts packages/pylon/src/mcp/server.ts
git commit -m "feat(archive): add 5 MCP tools for archive access"
```

---

## Task 6: 허브 UI - ArchiveViewer 컴포넌트

**Files:**
- Create: `packages/client/src/stores/archiveStore.ts`
- Create: `packages/client/src/components/archive/ArchiveViewer.tsx`
- Create: `packages/client/src/components/archive/ArchiveTree.tsx`
- Create: `packages/client/src/components/archive/ArchiveContent.tsx`
- Modify: `packages/client/src/layouts/AppHeader.tsx` (버튼 추가)
- Modify: `packages/client/src/pages/HomePage.tsx` (뷰 전환)

**Step 1: archiveStore 생성**

```typescript
// packages/client/src/stores/archiveStore.ts
import { create } from 'zustand';

export interface FileEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  modifiedAt?: string;
  children?: FileEntry[];
}

interface ArchiveState {
  isOpen: boolean;
  entries: FileEntry[];
  selectedPath: string | null;
  selectedContent: string | null;
  selectedMimeType: string | null;
  expandedDirs: Set<string>;
  isLoading: boolean;

  setOpen: (open: boolean) => void;
  toggleOpen: () => void;
  setEntries: (entries: FileEntry[]) => void;
  setSelected: (path: string | null, content: string | null, mimeType: string | null) => void;
  toggleDir: (path: string) => void;
  setLoading: (loading: boolean) => void;
}

export const useArchiveStore = create<ArchiveState>((set, get) => ({
  isOpen: false,
  entries: [],
  selectedPath: null,
  selectedContent: null,
  selectedMimeType: null,
  expandedDirs: new Set(),
  isLoading: false,

  setOpen: (open) => set({ isOpen: open }),
  toggleOpen: () => set(s => ({ isOpen: !s.isOpen })),
  setEntries: (entries) => set({ entries }),
  setSelected: (path, content, mimeType) => set({ selectedPath: path, selectedContent: content, selectedMimeType: mimeType }),
  toggleDir: (path) => set(s => {
    const next = new Set(s.expandedDirs);
    next.has(path) ? next.delete(path) : next.add(path);
    return { expandedDirs: next };
  }),
  setLoading: (loading) => set({ isLoading: loading }),
}));
```

**Step 2: API 유틸 함수**

Archive HTTP API 호출 유틸을 ArchiveViewer 내부 또는 별도 서비스 파일에 작성. `fetch` 기반.

```typescript
// packages/client/src/services/archiveApi.ts
const BASE = '/archive';

export async function archiveList(path = '', depth = 1) {
  const res = await fetch(`${BASE}/list?path=${encodeURIComponent(path)}&depth=${depth}`);
  return res.json();
}

export async function archiveRead(path: string) {
  const res = await fetch(`${BASE}/read?path=${encodeURIComponent(path)}`);
  return res.json();
}
```

**Step 3: ArchiveTree 컴포넌트 (좌측 디렉토리 트리)**

- `useArchiveStore`에서 entries와 expandedDirs 사용
- 디렉토리 클릭 → 하위 항목 로드 (depth 1로 lazy load)
- 파일 클릭 → archiveRead 호출 → selectedContent 업데이트
- 재귀 렌더링, 들여쓰기, 폴더/파일 아이콘 (lucide-react)

**Step 4: ArchiveContent 컴포넌트 (우측 메인)**

- `selectedContent`가 null이면 빈 상태 안내 표시
- `.md` → 기존 마크다운 렌더러 재활용 (`markdown.tsx`)
- 이미지 → `<img>` 태그 (src를 `/archive/read?path=...`로)
- 기타 → 파일 정보 + 다운로드 링크

**Step 5: ArchiveViewer 컴포넌트 (통합)**

```typescript
// packages/client/src/components/archive/ArchiveViewer.tsx
// 좌측 ArchiveTree (w-64) + 우측 ArchiveContent (flex-1)
// 마운트 시 archiveList('', 1) 호출하여 루트 로드
```

**Step 6: AppHeader에 버튼 추가**

`AppHeader.tsx`에서 기존 프로젝트 버튼 옆에 아카이브 버튼 추가. `Archive` 아이콘 (lucide-react). 클릭 시 `useArchiveStore.toggleOpen()`.

**Step 7: HomePage에서 뷰 전환**

```typescript
// HomePage.tsx
const { isOpen: archiveOpen } = useArchiveStore();

<ResponsiveLayout
  sidebar={<WorkspaceSidebar />}
  main={archiveOpen ? <ArchiveViewer /> : <ChatArea />}
/>
```

**Step 8: 브라우저에서 동작 확인**

1. 허브 접속 → 아카이브 버튼 보이는지 확인
2. 클릭 → ArchiveViewer 표시되는지 확인
3. 디렉토리 탐색 → 파일 선택 → 내용 표시 확인
4. md 파일 마크다운 렌더링 확인
5. 다시 버튼 클릭 → 대화 화면 복귀 확인

**Step 9: 커밋**

```bash
git add packages/client/src/stores/archiveStore.ts packages/client/src/services/archiveApi.ts packages/client/src/components/archive/
git add packages/client/src/layouts/AppHeader.tsx packages/client/src/pages/HomePage.tsx
git commit -m "feat(archive): add ArchiveViewer UI integrated in hub"
```

---

## Task 7: 아카이브 루트 디렉토리 초기화 및 통합 테스트

**Files:**
- Create: `/home/estelle/archive/` (초기 디렉토리 구조)

**Step 1: 아카이브 루트 생성**

```bash
mkdir -p /home/estelle/archive/{projects,notes,references,shared}
echo "# Archive\n\nEstelle shared document archive." > /home/estelle/archive/readme.md
```

**Step 2: 전체 빌드 및 서비스 시작**

Run: 전체 빌드 (`npm run build`)
Run: PM2 재시작 (archive 포함)

**Step 3: 통합 테스트**

1. `curl http://localhost:3009/archive/list` → 초기 디렉토리 표시
2. MCP 도구 `archive_write` → 파일 생성 확인
3. MCP 도구 `archive_read` → 방금 쓴 파일 읽기 확인
4. 웹 UI에서 아카이브 뷰어 열고 파일 탐색 확인

**Step 4: 커밋**

```bash
git commit -m "feat(archive): complete archive system integration"
```
