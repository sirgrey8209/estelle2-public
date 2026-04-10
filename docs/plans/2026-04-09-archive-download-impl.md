# Archive Download Feature Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 아카이브 뷰어에서 모든 파일과 폴더를 다운로드할 수 있게 한다 (폴더는 ZIP).

**Architecture:** 서버에 `GET /archive/download` 엔드포인트 추가 (파일은 raw bytes, 폴더는 `archiver`로 zip 스트리밍). 클라이언트 상단 바에 다운로드 버튼 통합, 폴더 선택 시 요약 카드 + ZIP 다운로드 제공.

**Tech Stack:** Node.js `archiver`, Zustand, React, Vitest

---

### Task 1: archiver 의존성 추가

**Files:**
- Modify: `packages/archive/package.json`

**Step 1: 의존성 설치**

Run: `cd /home/estelle/estelle2 && pnpm --filter @estelle/archive add archiver && pnpm --filter @estelle/archive add -D @types/archiver`

**Step 2: 설치 확인**

Run: `cd /home/estelle/estelle2 && node -e "import('archiver').then(m => console.log('archiver OK'))"`
Expected: `archiver OK`

**Step 3: Commit**

```bash
git add packages/archive/package.json pnpm-lock.yaml
git commit -m "chore(archive): add archiver dependency for zip download"
```

---

### Task 2: ArchiveService.download() — 파일 다운로드 테스트 & 구현

**Files:**
- Modify: `packages/archive/src/archive-service.ts`
- Modify: `packages/archive/src/archive-service.test.ts`

**Step 1: 파일 다운로드 실패 테스트 작성**

`archive-service.test.ts` 맨 아래(마지막 `});` 앞)에 추가:

```typescript
// ─── download() ─────────────────────────────────────────

describe('download()', () => {
  it('should return file info with isDirectory=false for a file', async () => {
    await writeFile(join(tempDir, 'doc.txt'), 'hello');
    const result = await service.download('doc.txt');
    expect(result.isDirectory).toBe(false);
    expect(result.filename).toBe('doc.txt');
    expect(result.fullPath).toBe(join(tempDir, 'doc.txt'));
  });

  it('should return directory info with isDirectory=true for a folder', async () => {
    await mkdir(join(tempDir, 'myfolder'), { recursive: true });
    await writeFile(join(tempDir, 'myfolder/a.txt'), 'a');
    const result = await service.download('myfolder');
    expect(result.isDirectory).toBe(true);
    expect(result.filename).toBe('myfolder');
    expect(result.fullPath).toBe(join(tempDir, 'myfolder'));
  });

  it('should throw for non-existent path', async () => {
    await expect(service.download('nonexistent')).rejects.toThrow();
  });

  it('should reject path traversal', async () => {
    await expect(service.download('../etc/passwd')).rejects.toThrow();
  });
});
```

**Step 2: 테스트 실패 확인**

Run: `cd /home/estelle/estelle2 && pnpm --filter @estelle/archive test -- --reporter=verbose 2>&1 | tail -20`
Expected: FAIL — `service.download is not a function`

**Step 3: download() 메서드 구현**

`archive-service.ts`에서 `ArchiveService` 클래스 안에 (예: `read()` 메서드 뒤에) 추가:

```typescript
/**
 * Resolve download target info (file or directory).
 * For files: returns path for direct streaming.
 * For directories: returns path for archiver to zip.
 */
async download(relativePath: string): Promise<{ isDirectory: boolean; filename: string; fullPath: string }> {
  const fullPath = this.resolveSafe(relativePath);
  const stats = await stat(fullPath);
  const filename = relativePath.includes('/')
    ? relativePath.slice(relativePath.lastIndexOf('/') + 1)
    : relativePath;
  return {
    isDirectory: stats.isDirectory(),
    filename,
    fullPath,
  };
}
```

또한 파일 상단의 `ArchiveService` export 영역에 `DownloadInfo` 타입을 추가:

```typescript
export interface DownloadInfo {
  isDirectory: boolean;
  filename: string;
  fullPath: string;
}
```

그리고 `download()` 반환 타입을 `Promise<DownloadInfo>`로 변경.

**Step 4: 테스트 통과 확인**

Run: `cd /home/estelle/estelle2 && pnpm --filter @estelle/archive test -- --reporter=verbose 2>&1 | tail -20`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add packages/archive/src/archive-service.ts packages/archive/src/archive-service.test.ts
git commit -m "feat(archive): add download() method to ArchiveService"
```

---

### Task 3: /archive/download HTTP 라우트 — 테스트 & 구현

**Files:**
- Modify: `packages/archive/src/server.ts`
- Modify: `packages/archive/src/server.test.ts`

**Step 1: 파일 다운로드 HTTP 테스트 작성**

`server.test.ts`의 마지막 `});` 앞에 추가:

```typescript
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

  it('should return 500 for non-existent path', async () => {
    const res = await request(port, 'GET', '/archive/download?path=nonexistent');
    expect(res.status).toBe(500);
  });
});
```

**Step 2: 테스트 실패 확인**

Run: `cd /home/estelle/estelle2 && pnpm --filter @estelle/archive test -- --reporter=verbose 2>&1 | tail -30`
Expected: FAIL — 404 Not found

**Step 3: handleDownload 함수 & 라우트 구현**

`server.ts` 상단에 archiver import 추가:

```typescript
import archiver from 'archiver';
```

`server.ts`의 `handleRename` 함수 뒤에 추가:

```typescript
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
    archive.directory(info.fullPath, false);
    await archive.finalize();
  } else {
    // File download
    const { createReadStream } = await import('node:fs');
    const fileStat = await import('node:fs/promises').then(m => m.stat(info.fullPath));

    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': fileStat.size,
      'Content-Disposition': `attachment; filename="${info.filename}"`,
    });

    createReadStream(info.fullPath).pipe(res);
  }
}
```

`createArchiveServer` 함수의 switch 문에서 `default:` 앞에 추가:

```typescript
case '/archive/download':
  if (req.method !== 'GET') {
    sendError(res, 400, 'Method not allowed');
    return;
  }
  await handleDownload(service, params, res);
  break;
```

**Step 4: 테스트 통과 확인**

Run: `cd /home/estelle/estelle2 && pnpm --filter @estelle/archive test -- --reporter=verbose 2>&1 | tail -30`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add packages/archive/src/server.ts packages/archive/src/server.test.ts
git commit -m "feat(archive): add /archive/download endpoint with zip support"
```

---

### Task 4: 클라이언트 — archiveDownloadUrl 헬퍼

**Files:**
- Modify: `packages/client/src/services/archiveApi.ts`

**Step 1: archiveDownloadUrl 함수 추가**

`archiveApi.ts`의 `archiveReadUrl` 함수 뒤에 추가:

```typescript
/**
 * 파일/폴더 다운로드 URL (Content-Disposition: attachment)
 */
export function archiveDownloadUrl(path: string): string {
  const params = new URLSearchParams({ path });
  return `${BASE}/archive/download?${params}`;
}
```

**Step 2: Commit**

```bash
git add packages/client/src/services/archiveApi.ts
git commit -m "feat(client): add archiveDownloadUrl helper"
```

---

### Task 5: 클라이언트 — 스토어에 selectedType 추가

**Files:**
- Modify: `packages/client/src/stores/archiveStore.ts`

**Step 1: selectedType 필드 추가**

`ArchiveState` 인터페이스에 추가 (selectedMimeType 뒤):

```typescript
/** 선택된 항목 타입 (파일 또는 디렉토리) */
selectedType: 'file' | 'directory' | null;
```

`setSelected` 시그니처를 변경:

```typescript
setSelected: (path: string | null, content: string | null, mimeType: string | null, type?: 'file' | 'directory' | null) => void;
```

스토어 초기값에 추가:

```typescript
selectedType: null,
```

`setSelected` 구현 변경:

```typescript
setSelected: (path, content, mimeType, type = null) =>
  set({ selectedPath: path, selectedContent: content, selectedMimeType: mimeType, selectedType: type }),
```

`resetTree` 에도 추가:

```typescript
resetTree: () =>
  set({
    expandedDirs: new Set(),
    selectedPath: null,
    selectedContent: null,
    selectedMimeType: null,
    selectedType: null,
  }),
```

**Step 2: 타입체크 확인**

Run: `cd /home/estelle/estelle2 && pnpm --filter @estelle/client typecheck 2>&1 | tail -20`

이 단계에서 `ArchiveTree.tsx`의 `setSelected` 호출이 3개 인수라서 에러가 날 수 있음. 4번째 인수 기본값이 있으므로 에러가 안 나면 그대로 진행, 에러가 나면 Task 6에서 함께 수정.

**Step 3: Commit**

```bash
git add packages/client/src/stores/archiveStore.ts
git commit -m "feat(client): add selectedType to archive store"
```

---

### Task 6: 클라이언트 — ArchiveTree 폴더 선택 동작

**Files:**
- Modify: `packages/client/src/components/archive/ArchiveTree.tsx`

**Step 1: 폴더 클릭 시 선택 + 펼치기 동시 동작**

`ArchiveTree.tsx`의 `handleClick` 콜백에서 `if (isDir)` 블록을 수정. 기존:

```typescript
if (isDir) {
  // 디렉토리: 토글 + lazy load
  toggleDir(entry.path);
  if (!isExpanded && !entry.children) {
    // ... lazy load
  }
}
```

변경:

```typescript
if (isDir) {
  // 디렉토리: 콘텐츠 영역에 폴더 뷰 표시 + 토글 + lazy load
  setSelected(entry.path, null, null, 'directory');
  closeSidebar();
  toggleDir(entry.path);
  if (!isExpanded && !entry.children) {
    try {
      const children = await archiveList(entry.path, 1);
      updateDirChildren(entry.path, children);
    } catch (err) {
      console.error('[Archive] Failed to load directory:', entry.path, err);
    }
  }
}
```

파일 클릭 부분도 `setSelected` 호출에 4번째 인수 추가:

```typescript
setSelected(entry.path, null, null, 'file');
// ...
setSelected(entry.path, result.content, result.mimeType, 'file');
// ...
setSelected(entry.path, null, null, 'file');  // error case
```

**Step 2: 타입체크 확인**

Run: `cd /home/estelle/estelle2 && pnpm --filter @estelle/client typecheck 2>&1 | tail -10`
Expected: 에러 없음

**Step 3: Commit**

```bash
git add packages/client/src/components/archive/ArchiveTree.tsx
git commit -m "feat(client): folder click selects in content area + expands"
```

---

### Task 7: 클라이언트 — ArchiveContent 다운로드 버튼 + FolderRenderer

**Files:**
- Modify: `packages/client/src/components/archive/ArchiveContent.tsx`

**Step 1: import 수정**

기존 import에서 `archiveReadUrl` 대신 `archiveDownloadUrl`도 추가:

```typescript
import { archiveReadUrl, archiveDownloadUrl } from '../../services/archiveApi';
```

`lucide-react`에서 `FolderOpen` 추가:

```typescript
import { FileText, Download, Loader2, ChevronLeft, FolderOpen } from 'lucide-react';
```

**Step 2: FolderRenderer 컴포넌트 추가**

`FileInfoRenderer` 컴포넌트 뒤에 추가:

```typescript
/**
 * 폴더 요약 표시 + ZIP 다운로드
 */
function FolderRenderer({ path }: { path: string }) {
  const { entries } = useArchiveStore();
  const folderName = getFileName(path);
  const downloadUrl = archiveDownloadUrl(path);

  // 트리에서 해당 폴더의 children을 찾아 요약 계산
  const stats = useMemo(() => {
    const folder = findEntry(entries, path);
    if (!folder?.children) return { files: 0, folders: 0, totalSize: 0 };

    let files = 0;
    let folders = 0;
    let totalSize = 0;
    for (const child of folder.children) {
      if (child.type === 'directory') folders++;
      else {
        files++;
        totalSize += child.size ?? 0;
      }
    }
    return { files, folders, totalSize };
  }, [entries, path]);

  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 text-muted-foreground">
      <FolderOpen className="h-16 w-16 opacity-30" />
      <div className="text-center">
        <p className="text-sm font-medium text-foreground">{folderName}</p>
        <p className="text-xs mt-1">
          {stats.files > 0 && `파일 ${stats.files}개`}
          {stats.files > 0 && stats.folders > 0 && ' · '}
          {stats.folders > 0 && `폴더 ${stats.folders}개`}
          {(stats.files > 0 || stats.folders > 0) && ' · '}
          {formatSize(stats.totalSize)}
        </p>
      </div>
      <a
        href={downloadUrl}
        download={`${folderName}.zip`}
        className="inline-flex items-center gap-2 px-3 py-1.5 text-sm bg-primary/10 hover:bg-primary/20 text-primary rounded-md transition-colors"
      >
        <Download className="h-4 w-4" />
        폴더 다운로드 (ZIP)
      </a>
    </div>
  );
}
```

**Step 3: findEntry 헬퍼 추가**

`formatSize` 함수 뒤에 추가:

```typescript
function findEntry(entries: { path: string; children?: typeof entries }[], targetPath: string): typeof entries[number] | null {
  for (const entry of entries) {
    if (entry.path === targetPath) return entry;
    if (entry.children) {
      const found = findEntry(entry.children, targetPath);
      if (found) return found;
    }
  }
  return null;
}
```

**Step 4: 상단 바에 다운로드 버튼 추가 + 폴더 뷰 분기**

`ArchiveContent` 컴포넌트를 수정. `selectedType`을 스토어에서 가져오고, 상단 바에 다운로드 버튼 추가, 폴더 분기 추가.

스토어 destructuring에 `selectedType` 추가:

```typescript
const { selectedPath, selectedContent, selectedMimeType, selectedType, isLoading } = useArchiveStore();
```

파일 경로 바 부분 수정 — `<span>` 뒤에 다운로드 버튼 추가:

```typescript
{/* 파일 경로 바 */}
<div className="flex items-center px-4 py-1.5 bg-muted/30 border-b border-border text-xs text-muted-foreground shrink-0">
  <button
    onClick={openSidebar}
    className="mr-1.5 p-0.5 hover:bg-accent rounded sm:hidden"
  >
    <ChevronLeft className="h-3.5 w-3.5" />
  </button>
  {selectedType === 'directory' ? (
    <FolderOpen className="h-3.5 w-3.5 mr-1.5" />
  ) : (
    <FileText className="h-3.5 w-3.5 mr-1.5" />
  )}
  <span className="truncate flex-1">{selectedPath}</span>
  <a
    href={archiveDownloadUrl(selectedPath)}
    download
    className="ml-2 p-0.5 hover:bg-accent rounded"
    title="Download"
  >
    <Download className="h-3.5 w-3.5" />
  </a>
</div>
```

내용 영역에 폴더 분기 추가 (기존 `isImage` 분기 **앞에**):

```typescript
<div className="flex-1 overflow-auto">
  {selectedType === 'directory' ? (
    <FolderRenderer path={selectedPath} />
  ) : isImage ? (
    <ImageRenderer path={selectedPath} />
  ) : isMarkdown ? (
    <MarkdownRenderer content={selectedContent} />
  ) : isText ? (
    <TextRenderer content={selectedContent} />
  ) : (
    <FileInfoRenderer path={selectedPath} mimeType={selectedMimeType || 'unknown'} />
  )}
</div>
```

**Step 5: FileInfoRenderer에서 다운로드 버튼 제거**

상단 바에 통합되었으므로, `FileInfoRenderer`에서 `<a>` 다운로드 링크를 제거하고 파일 정보만 표시하도록 단순화:

```typescript
function FileInfoRenderer({ path, mimeType }: { path: string; mimeType: string }) {
  const filename = getFileName(path);

  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 text-muted-foreground">
      <FileText className="h-16 w-16 opacity-30" />
      <div className="text-center">
        <p className="text-sm font-medium text-foreground">{filename}</p>
        <p className="text-xs mt-1">{mimeType}</p>
      </div>
    </div>
  );
}
```

**Step 6: 타입체크 확인**

Run: `cd /home/estelle/estelle2 && pnpm --filter @estelle/client typecheck 2>&1 | tail -10`
Expected: 에러 없음

**Step 7: Commit**

```bash
git add packages/client/src/components/archive/ArchiveContent.tsx
git commit -m "feat(client): add download button to all files + folder view with zip download"
```

---

### Task 8: Caddy 프록시 확인 & 전체 빌드

**Files:**
- 확인: Caddy 설정 (이미 `/archive/*` → `localhost:3009` 프록시 중)

**Step 1: archive 패키지 빌드**

Run: `cd /home/estelle/estelle2 && pnpm --filter @estelle/archive build 2>&1 | tail -10`
Expected: 에러 없음

**Step 2: client 패키지 빌드**

Run: `cd /home/estelle/estelle2 && pnpm --filter @estelle/client build 2>&1 | tail -10`
Expected: 에러 없음

**Step 3: 전체 테스트**

Run: `cd /home/estelle/estelle2 && pnpm --filter @estelle/archive test 2>&1 | tail -10`
Expected: ALL PASS

**Step 4: Caddy 확인**

`/archive/download` 경로는 이미 `/archive/*` 프록시 규칙에 포함되므로 Caddy 설정 변경 불필요. 확인만:

Run: `grep -A2 'archive' /etc/caddy/Caddyfile 2>/dev/null || echo "Check Caddy config manually"`

**Step 5: 필요시 서비스 재시작 후 수동 테스트**
