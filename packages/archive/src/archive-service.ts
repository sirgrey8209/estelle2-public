import { readdir, readFile, writeFile, mkdir, stat, rm, unlink, rmdir, rename as fsRename } from 'node:fs/promises';
import { join, resolve, relative, extname, dirname } from 'node:path';
import { glob as globFn } from 'glob';

// ─── Types ────────────────────────────────────────────────────

export interface FileEntry {
  name: string;
  path: string; // relative to archive root
  type: 'file' | 'directory';
  size?: number;
  modifiedAt?: string; // ISO string
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

export interface DownloadInfo {
  isDirectory: boolean;
  filename: string;
  fullPath: string;
}

// ─── MIME & Text Detection ────────────────────────────────────

const MIME_MAP: Record<string, string> = {
  '.md': 'text/markdown',
  '.txt': 'text/plain',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.ts': 'text/typescript',
  '.yml': 'text/yaml',
  '.yaml': 'text/yaml',
  '.csv': 'text/csv',
  '.xml': 'text/xml',
};

/** Max bytes to sample for binary detection */
const BINARY_CHECK_BYTES = 8192;

function getMimeType(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  return MIME_MAP[ext] ?? 'application/octet-stream';
}

/**
 * Detect whether a file is text.
 *
 * Strategy (hybrid):
 * 1. Known text MIME types (text/*, application/json) → text
 * 2. Known binary MIME types (image/*, audio/*, video/*, application/pdf, etc.) → binary
 * 3. Unknown extension (application/octet-stream) → null byte detection on first 8KB
 *
 * This avoids file I/O for known extensions and uses content inspection only when needed.
 */
async function isTextFile(filePath: string): Promise<boolean> {
  const mime = getMimeType(filePath);

  // Known text types (SVG is XML-based text despite image/* MIME)
  if (mime.startsWith('text/') || mime === 'application/json' || mime === 'image/svg+xml') return true;

  // Known binary types (not octet-stream)
  if (mime !== 'application/octet-stream') return false;

  // Unknown extension → inspect content for null bytes
  const { open } = await import('node:fs/promises');
  const fh = await open(filePath, 'r');
  try {
    const buf = Buffer.alloc(BINARY_CHECK_BYTES);
    const { bytesRead } = await fh.read(buf, 0, BINARY_CHECK_BYTES, 0);
    if (bytesRead === 0) return true; // empty file = text

    // UTF-16 BOM detection → treat as binary (not UTF-8 readable)
    if (bytesRead >= 2) {
      if ((buf[0] === 0xff && buf[1] === 0xfe) || (buf[0] === 0xfe && buf[1] === 0xff)) {
        return false;
      }
    }

    // Check for null bytes
    for (let i = 0; i < bytesRead; i++) {
      if (buf[i] === 0) return false;
    }
    return true;
  } finally {
    await fh.close();
  }
}

// ─── ArchiveService ───────────────────────────────────────────

export class ArchiveService {
  private readonly root: string;

  constructor(rootDir: string) {
    this.root = resolve(rootDir);
  }

  /**
   * Resolve a relative path within the archive root, rejecting path traversal.
   */
  private resolveSafe(relativePath: string): string {
    if (relativePath.startsWith('/')) {
      throw new Error(`Absolute paths are not allowed: ${relativePath}`);
    }

    const resolved = resolve(this.root, relativePath);

    if (resolved !== this.root && !resolved.startsWith(this.root + '/')) {
      throw new Error(`Path traversal detected: ${relativePath}`);
    }

    return resolved;
  }

  /**
   * Delete a file or directory. For non-empty directories, recursive must be true.
   */
  async delete(relativePath: string, recursive: boolean = false): Promise<void> {
    const fullPath = this.resolveSafe(relativePath);
    const stats = await stat(fullPath);
    if (stats.isDirectory()) {
      if (recursive) {
        await rm(fullPath, { recursive: true });
      } else {
        await rmdir(fullPath);
      }
    } else {
      await unlink(fullPath);
    }
  }

  /**
   * Rename/move a file or directory. Auto-creates intermediate directories for the destination.
   */
  async rename(fromPath: string, toPath: string): Promise<void> {
    const fullFrom = this.resolveSafe(fromPath);
    const fullTo = this.resolveSafe(toPath);
    await mkdir(dirname(fullTo), { recursive: true });
    await fsRename(fullFrom, fullTo);
  }

  /**
   * Create/update a file. Auto-creates intermediate directories.
   */
  async write(relativePath: string, content: string | Buffer): Promise<void> {
    const fullPath = this.resolveSafe(relativePath);
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, content);
  }

  /**
   * Read a file. Returns content (string for text, Buffer for binary), mimeType, and size.
   */
  async read(relativePath: string): Promise<ReadResult> {
    const fullPath = this.resolveSafe(relativePath);
    const stats = await stat(fullPath);
    const mimeType = getMimeType(fullPath);

    if (await isTextFile(fullPath)) {
      const content = await readFile(fullPath, 'utf-8');
      return { content, mimeType, size: stats.size };
    }

    const content = await readFile(fullPath);
    return { content, mimeType, size: stats.size };
  }

  /**
   * Resolve download target info (file or directory).
   * For files: returns path for direct streaming.
   * For directories: returns path for archiver to zip.
   */
  async download(relativePath: string): Promise<DownloadInfo> {
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

  /**
   * List directory entries up to the given depth. Default depth 1, max 3.
   * Sorted: directories first, then alphabetically.
   */
  async list(relativePath: string, depth: number = 1): Promise<ListResult> {
    const effectiveDepth = Math.min(Math.max(depth, 1), 3);
    const fullPath = this.resolveSafe(relativePath);

    const entries = await this.listRecursive(fullPath, relativePath === '.' ? '' : relativePath, effectiveDepth);

    return { entries, path: relativePath };
  }

  private async listRecursive(
    dirPath: string,
    relativeBase: string,
    remainingDepth: number,
  ): Promise<FileEntry[]> {
    const dirents = await readdir(dirPath, { withFileTypes: true });

    const entries: FileEntry[] = [];

    for (const dirent of dirents) {
      const entryRelPath = relativeBase ? `${relativeBase}/${dirent.name}` : dirent.name;
      const entryFullPath = join(dirPath, dirent.name);

      if (dirent.isDirectory()) {
        const entry: FileEntry = {
          name: dirent.name,
          path: entryRelPath,
          type: 'directory',
        };

        if (remainingDepth > 1) {
          entry.children = await this.listRecursive(
            entryFullPath,
            entryRelPath,
            remainingDepth - 1,
          );
        }

        entries.push(entry);
      } else if (dirent.isFile()) {
        const stats = await stat(entryFullPath);
        entries.push({
          name: dirent.name,
          path: entryRelPath,
          type: 'file',
          size: stats.size,
          modifiedAt: stats.mtime.toISOString(),
        });
      }
    }

    // Sort: directories first, then alphabetically within each group
    entries.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === 'directory' ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });

    return entries;
  }

  /**
   * Find files by glob pattern. Returns relative paths.
   * Matches both files and directories.
   */
  async glob(
    pattern: string,
    options?: { nocase?: boolean },
  ): Promise<string[]> {
    if (pattern.includes('..')) {
      throw new Error('Glob patterns with ".." are not allowed');
    }

    const matches = await globFn(pattern, {
      cwd: this.root,
      posix: true,
      ...(options?.nocase && { nocase: true }),
    });

    // Double-check: filter results that escape root
    // Append '/' to directory entries for clarity
    const results: string[] = [];
    for (const m of matches) {
      if (m.startsWith('..') || m.startsWith('/')) continue;
      try {
        const s = await stat(join(this.root, m));
        results.push(s.isDirectory() ? `${m}/` : m);
      } catch {
        results.push(m);
      }
    }
    return results.sort();
  }

  /**
   * Search text file contents. Returns matches with path, line number, content.
   */
  async grep(
    query: string,
    relativePath?: string,
    maxResults = 500,
  ): Promise<GrepMatch[]> {
    const searchRoot = relativePath ? this.resolveSafe(relativePath) : this.root;
    const matches: GrepMatch[] = [];

    await this.grepRecursive(searchRoot, query, matches, maxResults);

    return matches;
  }

  private static readonly MAX_GREP_FILE_SIZE = 10 * 1024 * 1024; // 10MB

  private async grepRecursive(
    dirPath: string,
    query: string,
    matches: GrepMatch[],
    maxResults: number,
  ): Promise<void> {
    if (matches.length >= maxResults) return;

    const dirents = await readdir(dirPath, { withFileTypes: true });

    for (const dirent of dirents) {
      if (matches.length >= maxResults) return;

      const fullPath = join(dirPath, dirent.name);

      if (dirent.isDirectory()) {
        await this.grepRecursive(fullPath, query, matches, maxResults);
      } else if (dirent.isFile() && await isTextFile(fullPath)) {
        const fileStat = await stat(fullPath);
        if (fileStat.size > ArchiveService.MAX_GREP_FILE_SIZE) continue;

        const content = await readFile(fullPath, 'utf-8');
        const lines = content.split('\n');

        for (let i = 0; i < lines.length; i++) {
          if (lines[i].includes(query)) {
            matches.push({
              path: relative(this.root, fullPath),
              line: i + 1,
              content: lines[i],
            });
            if (matches.length >= maxResults) return;
          }
        }
      }
    }
  }
}
