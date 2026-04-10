/**
 * @file archive.ts
 * @description Archive MCP 도구 구현 (5개)
 *
 * archive_write, archive_read, archive_list, archive_glob, archive_grep
 *
 * Master 서버에서는 ArchiveService를 직접 사용하고,
 * Remote(slave) 머신에서는 HTTP API를 통해 접근합니다.
 */

import { existsSync } from 'node:fs';

// ============================================================================
// 타입
// ============================================================================

interface McpTextContent {
  type: 'text';
  text: string;
}

interface McpResponse {
  content: McpTextContent[];
  isError?: boolean;
}

interface ArchiveWriteArgs {
  path?: string;
  content?: string;
}

interface ArchiveReadArgs {
  path?: string;
}

interface ArchiveListArgs {
  path?: string;
  depth?: number;
}

interface ArchiveGlobArgs {
  pattern?: string;
  nocase?: boolean;
}

interface ArchiveGrepArgs {
  query?: string;
  path?: string;
}

interface ArchiveDeleteArgs {
  path?: string;
  recursive?: boolean;
}

interface ArchiveRenameArgs {
  from?: string;
  to?: string;
}

// ============================================================================
// 헬퍼 함수
// ============================================================================

function createSuccessResponse(data: unknown): McpResponse {
  return {
    content: [{ type: 'text', text: JSON.stringify(data) }],
  };
}

function createErrorResponse(message: string): McpResponse {
  return {
    content: [{ type: 'text', text: JSON.stringify({ error: message }) }],
    isError: true,
  };
}

/**
 * Master 서버 여부 판별.
 * Archive root 디렉토리가 로컬에 존재하면 master로 간주합니다.
 */
function isMaster(): boolean {
  if (process.env.ESTELLE_ROLE === 'master') return true;
  const root = process.env.ARCHIVE_ROOT || '/home/estelle/archive';
  return existsSync(root);
}

/**
 * Archive API base URL (remote 접속 시 사용)
 */
function getApiUrl(): string {
  return process.env.ARCHIVE_API_URL || 'http://YOUR_SERVER_IP:3009';
}

/**
 * ArchiveService 인스턴스를 lazy-load합니다 (singleton).
 * Master에서만 호출됩니다.
 */
let _archiveService: InstanceType<typeof import('@estelle/archive').ArchiveService> | null = null;

async function getArchiveService(): Promise<InstanceType<typeof import('@estelle/archive').ArchiveService>> {
  if (!_archiveService) {
    const { ArchiveService } = await import('@estelle/archive');
    const root = process.env.ARCHIVE_ROOT || '/home/estelle/archive';
    _archiveService = new ArchiveService(root);
  }
  return _archiveService;
}

// ============================================================================
// 도구 정의
// ============================================================================

export function getArchiveWriteDefinition() {
  return {
    name: 'archive_write',
    description: 'Archive에 파일을 생성하거나 업데이트합니다. 중간 디렉토리는 자동 생성됩니다.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        path: {
          type: 'string',
          description: 'Archive root 기준 상대 경로 (예: "notes/todo.md")',
        },
        content: {
          type: 'string',
          description: '파일에 쓸 내용',
        },
      },
      required: ['path', 'content'],
    },
  };
}

export function getArchiveReadDefinition() {
  return {
    name: 'archive_read',
    description: 'Archive에서 파일을 읽습니다. 텍스트 파일의 내용, MIME 타입, 크기를 반환합니다.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        path: {
          type: 'string',
          description: 'Archive root 기준 상대 경로 (예: "notes/todo.md")',
        },
      },
      required: ['path'],
    },
  };
}

export function getArchiveListDefinition() {
  return {
    name: 'archive_list',
    description: 'Archive 디렉토리의 파일/폴더 목록을 조회합니다. depth로 하위 깊이를 지정할 수 있습니다 (최대 3).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        path: {
          type: 'string',
          description: 'Archive root 기준 상대 경로 (생략 시 루트 디렉토리)',
        },
        depth: {
          type: 'number',
          description: '탐색 깊이 (기본값 1, 최대 3)',
        },
      },
      required: [],
    },
  };
}

export function getArchiveGlobDefinition() {
  return {
    name: 'archive_glob',
    description: 'Archive에서 glob 패턴으로 파일을 검색합니다. 매칭되는 파일과 디렉토리의 상대 경로를 반환합니다. 디렉토리는 끝에 /가 붙습니다.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        pattern: {
          type: 'string',
          description: 'Glob 패턴 (예: "**/*.md", "notes/*.txt")',
        },
        nocase: {
          type: 'boolean',
          description: '대소문자 무시 여부 (기본값: false)',
        },
      },
      required: ['pattern'],
    },
  };
}

export function getArchiveGrepDefinition() {
  return {
    name: 'archive_grep',
    description: 'Archive 텍스트 파일에서 문자열을 검색합니다. 매칭되는 파일, 줄 번호, 내용을 반환합니다.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: '검색할 문자열',
        },
        path: {
          type: 'string',
          description: '검색 범위를 제한할 하위 경로 (생략 시 전체 Archive 검색)',
        },
      },
      required: ['query'],
    },
  };
}

export function getArchiveDeleteDefinition() {
  return {
    name: 'archive_delete',
    description: 'Archive에서 파일 또는 디렉토리를 삭제합니다. 비어있지 않은 디렉토리는 recursive를 true로 설정해야 합니다.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        path: {
          type: 'string',
          description: 'Archive root 기준 상대 경로 (예: "notes/old.md")',
        },
        recursive: {
          type: 'boolean',
          description: '디렉토리 내 하위 항목까지 모두 삭제할지 여부 (기본값 false)',
        },
      },
      required: ['path'],
    },
  };
}

export function getArchiveRenameDefinition() {
  return {
    name: 'archive_rename',
    description: 'Archive에서 파일 또는 디렉토리의 이름을 변경하거나 이동합니다. 중간 디렉토리는 자동 생성됩니다.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        from: {
          type: 'string',
          description: '원본 경로 (Archive root 기준 상대 경로)',
        },
        to: {
          type: 'string',
          description: '대상 경로 (Archive root 기준 상대 경로)',
        },
      },
      required: ['from', 'to'],
    },
  };
}

// ============================================================================
// 실행 함수
// ============================================================================

export async function executeArchiveWrite(args: ArchiveWriteArgs): Promise<McpResponse> {
  if (!args.path) {
    return createErrorResponse('path is required');
  }
  if (args.content === undefined || args.content === null) {
    return createErrorResponse('content is required');
  }

  try {
    if (isMaster()) {
      const service = await getArchiveService();
      await service.write(args.path, args.content);
      return createSuccessResponse({ ok: true });
    }

    // Remote: HTTP API
    const res = await fetch(`${getApiUrl()}/archive/write`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: args.path, content: args.content }),
    });

    if (!res.ok) {
      const body = await res.json() as { error?: string };
      return createErrorResponse(body.error ?? `HTTP ${res.status}`);
    }

    return createSuccessResponse({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return createErrorResponse(`archive_write failed: ${message}`);
  }
}

export async function executeArchiveRead(args: ArchiveReadArgs): Promise<McpResponse> {
  if (!args.path) {
    return createErrorResponse('path is required');
  }

  try {
    if (isMaster()) {
      const service = await getArchiveService();
      const result = await service.read(args.path);

      if (Buffer.isBuffer(result.content)) {
        return createSuccessResponse({
          content: `[binary: ${result.mimeType}, ${result.size} bytes]`,
          mimeType: result.mimeType,
          size: result.size,
        });
      }

      return createSuccessResponse({
        content: result.content,
        mimeType: result.mimeType,
        size: result.size,
      });
    }

    // Remote: HTTP API
    const url = new URL(`${getApiUrl()}/archive/read`);
    url.searchParams.set('path', args.path);
    const res = await fetch(url.toString());

    if (!res.ok) {
      const body = await res.json() as { error?: string };
      return createErrorResponse(body.error ?? `HTTP ${res.status}`);
    }

    const data = await res.json() as Record<string, unknown>;
    return createSuccessResponse(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return createErrorResponse(`archive_read failed: ${message}`);
  }
}

export async function executeArchiveList(args: ArchiveListArgs): Promise<McpResponse> {
  try {
    const listPath = args.path || '.';
    const depth = args.depth ?? 1;

    if (isMaster()) {
      const service = await getArchiveService();
      const result = await service.list(listPath, depth);
      return createSuccessResponse(result);
    }

    // Remote: HTTP API
    const url = new URL(`${getApiUrl()}/archive/list`);
    if (args.path) url.searchParams.set('path', args.path);
    if (args.depth !== undefined) url.searchParams.set('depth', String(args.depth));
    const res = await fetch(url.toString());

    if (!res.ok) {
      const body = await res.json() as { error?: string };
      return createErrorResponse(body.error ?? `HTTP ${res.status}`);
    }

    const data = await res.json() as Record<string, unknown>;
    return createSuccessResponse(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return createErrorResponse(`archive_list failed: ${message}`);
  }
}

export async function executeArchiveGlob(args: ArchiveGlobArgs): Promise<McpResponse> {
  if (!args.pattern) {
    return createErrorResponse('pattern is required');
  }

  try {
    if (isMaster()) {
      const service = await getArchiveService();
      const matches = await service.glob(args.pattern, { nocase: args.nocase });
      return createSuccessResponse({ matches });
    }

    // Remote: HTTP API
    const url = new URL(`${getApiUrl()}/archive/glob`);
    url.searchParams.set('pattern', args.pattern);
    if (args.nocase) url.searchParams.set('nocase', '1');
    const res = await fetch(url.toString());

    if (!res.ok) {
      const body = await res.json() as { error?: string };
      return createErrorResponse(body.error ?? `HTTP ${res.status}`);
    }

    const data = await res.json() as Record<string, unknown>;
    return createSuccessResponse(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return createErrorResponse(`archive_glob failed: ${message}`);
  }
}

export async function executeArchiveGrep(args: ArchiveGrepArgs): Promise<McpResponse> {
  if (!args.query) {
    return createErrorResponse('query is required');
  }

  try {
    if (isMaster()) {
      const service = await getArchiveService();
      const matches = await service.grep(args.query, args.path);
      return createSuccessResponse({ matches });
    }

    // Remote: HTTP API
    const url = new URL(`${getApiUrl()}/archive/grep`);
    url.searchParams.set('query', args.query);
    if (args.path) url.searchParams.set('path', args.path);
    const res = await fetch(url.toString());

    if (!res.ok) {
      const body = await res.json() as { error?: string };
      return createErrorResponse(body.error ?? `HTTP ${res.status}`);
    }

    const data = await res.json() as Record<string, unknown>;
    return createSuccessResponse(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return createErrorResponse(`archive_grep failed: ${message}`);
  }
}

export async function executeArchiveDelete(args: ArchiveDeleteArgs): Promise<McpResponse> {
  if (!args.path) {
    return createErrorResponse('path is required');
  }

  try {
    if (isMaster()) {
      const service = await getArchiveService();
      await service.delete(args.path, args.recursive ?? false);
      return createSuccessResponse({ ok: true });
    }

    // Remote: HTTP API
    const url = new URL(`${getApiUrl()}/archive/delete`);
    url.searchParams.set('path', args.path);
    if (args.recursive) url.searchParams.set('recursive', 'true');
    const res = await fetch(url.toString(), { method: 'DELETE' });

    if (!res.ok) {
      const body = await res.json() as { error?: string };
      return createErrorResponse(body.error ?? `HTTP ${res.status}`);
    }

    return createSuccessResponse({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return createErrorResponse(`archive_delete failed: ${message}`);
  }
}

export async function executeArchiveRename(args: ArchiveRenameArgs): Promise<McpResponse> {
  if (!args.from) {
    return createErrorResponse('from is required');
  }
  if (!args.to) {
    return createErrorResponse('to is required');
  }

  try {
    if (isMaster()) {
      const service = await getArchiveService();
      await service.rename(args.from, args.to);
      return createSuccessResponse({ ok: true });
    }

    // Remote: HTTP API
    const res = await fetch(`${getApiUrl()}/archive/rename`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: args.from, to: args.to }),
    });

    if (!res.ok) {
      const body = await res.json() as { error?: string };
      return createErrorResponse(body.error ?? `HTTP ${res.status}`);
    }

    return createSuccessResponse({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return createErrorResponse(`archive_rename failed: ${message}`);
  }
}
