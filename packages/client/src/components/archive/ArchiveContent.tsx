import { useMemo, useContext } from 'react';
import { FileText, Download, Loader2, ChevronLeft, FolderOpen } from 'lucide-react';
import { useArchiveStore, type FileEntry } from '../../stores/archiveStore';
import { archiveReadUrl, archiveDownloadUrl } from '../../services/archiveApi';
import { parseMarkdown, MarkdownElement } from '../../lib/markdown';
import { MobileLayoutContext } from '../../layouts/MobileLayout';

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp']);

function getExtension(path: string): string {
  const dot = path.lastIndexOf('.');
  return dot >= 0 ? path.slice(dot).toLowerCase() : '';
}

function getFileName(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash >= 0 ? path.slice(slash + 1) : path;
}

function formatSize(bytes: number): string {
  if (bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function findEntry(entries: FileEntry[], targetPath: string): FileEntry | null {
  for (const entry of entries) {
    if (entry.path === targetPath) return entry;
    if (entry.children) {
      const found = findEntry(entry.children, targetPath);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Markdown 파일 렌더링
 */
function MarkdownRenderer({ content }: { content: string }) {
  const elements = useMemo(() => parseMarkdown(content), [content]);

  return (
    <div className="p-6 max-w-3xl">
      {elements.map((element, index) => (
        <MarkdownElement key={index} element={element} />
      ))}
    </div>
  );
}

/**
 * 이미지 파일 렌더링
 */
function ImageRenderer({ path }: { path: string }) {
  const url = archiveReadUrl(path);
  const filename = getFileName(path);

  return (
    <div className="flex items-center justify-center p-6 h-full">
      <img
        src={url}
        alt={filename}
        className="max-w-full max-h-full object-contain"
      />
    </div>
  );
}

/**
 * 텍스트 파일 렌더링
 */
function TextRenderer({ content }: { content: string }) {
  return (
    <div className="p-6">
      <pre className="font-mono text-sm leading-6 opacity-80 whitespace-pre-wrap select-text">
        {content}
      </pre>
    </div>
  );
}

/**
 * 기타 파일 정보 표시
 */
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

/**
 * Archive 파일 내용 뷰어 (우측 패널)
 */
export function ArchiveContent() {
  const { selectedPath, selectedContent, selectedMimeType, selectedType, isLoading } = useArchiveStore();
  const { openSidebar } = useContext(MobileLayoutContext);

  // 빈 상태
  if (!selectedPath) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
        <FileText className="h-12 w-12 opacity-20" />
        <p className="text-sm">Select a file to view</p>
        <button
          onClick={openSidebar}
          className="mt-2 text-xs text-primary hover:underline sm:hidden"
        >
          ← Back to files
        </button>
      </div>
    );
  }

  // 로딩 상태
  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm">Loading...</p>
      </div>
    );
  }

  // 내용 없음 (에러) — 디렉토리는 content가 null이어도 정상
  if (selectedContent === null && selectedType !== 'directory') {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
        <FileText className="h-12 w-12 opacity-20" />
        <p className="text-sm">Failed to load file</p>
      </div>
    );
  }

  const ext = getExtension(selectedPath);
  const isImage = IMAGE_EXTENSIONS.has(ext);
  const isMarkdown = ext === '.md' || ext === '.markdown';
  const isText = selectedMimeType?.startsWith('text/') || selectedMimeType === 'application/json';

  // 파일 이름 표시 + 내용
  return (
    <div className="flex flex-col h-full">
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

      {/* 내용 영역 */}
      <div className="flex-1 overflow-auto">
        {selectedType === 'directory' ? (
          <FolderRenderer path={selectedPath} />
        ) : isImage ? (
          <ImageRenderer path={selectedPath} />
        ) : isMarkdown ? (
          <MarkdownRenderer content={selectedContent ?? ''} />
        ) : isText ? (
          <TextRenderer content={selectedContent ?? ''} />
        ) : (
          <FileInfoRenderer path={selectedPath} mimeType={selectedMimeType || 'unknown'} />
        )}
      </div>
    </div>
  );
}
