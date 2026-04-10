import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ArchiveService } from './archive-service.js';

describe('ArchiveService', () => {
  let tempDir: string;
  let service: ArchiveService;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'archive-test-'));
    service = new ArchiveService(tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  // ─── Path Traversal Protection ──────────────────────────────

  describe('path traversal protection', () => {
    it('should reject paths that escape the root with ..', async () => {
      await expect(service.read('../etc/passwd')).rejects.toThrow();
      await expect(service.write('../escape.txt', 'bad')).rejects.toThrow();
      await expect(service.list('../../')).rejects.toThrow();
    });

    it('should reject paths with embedded .. segments', async () => {
      await expect(service.read('foo/../../etc/passwd')).rejects.toThrow();
      await expect(service.write('a/b/../../../escape.txt', 'bad')).rejects.toThrow();
    });

    it('should allow paths with .. that stay within root', async () => {
      await service.write('a/b/test.txt', 'hello');
      const result = await service.read('a/b/../b/test.txt');
      expect(result.content).toBe('hello');
    });

    it('should reject sibling directory prefix bypass', async () => {
      // If root is /tmp/archive-test-X, a path resolving to /tmp/archive-test-X-evil/
      // must be rejected (prefix attack)
      await expect(service.read('../' + tempDir.split('/').pop() + '-evil/file.txt')).rejects.toThrow();
    });

    it('should reject absolute paths', async () => {
      await expect(service.read('/etc/passwd')).rejects.toThrow();
      await expect(service.write('/tmp/bad.txt', 'bad')).rejects.toThrow();
    });
  });

  // ─── write() ────────────────────────────────────────────────

  describe('write()', () => {
    it('should create a file with string content', async () => {
      await service.write('hello.txt', 'Hello, World!');
      const content = await readFile(join(tempDir, 'hello.txt'), 'utf-8');
      expect(content).toBe('Hello, World!');
    });

    it('should create a file with Buffer content', async () => {
      const buf = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
      await service.write('image.png', buf);
      const content = await readFile(join(tempDir, 'image.png'));
      expect(Buffer.compare(content, buf)).toBe(0);
    });

    it('should auto-create intermediate directories', async () => {
      await service.write('a/b/c/deep.txt', 'deep content');
      const content = await readFile(join(tempDir, 'a/b/c/deep.txt'), 'utf-8');
      expect(content).toBe('deep content');
    });

    it('should overwrite existing files', async () => {
      await service.write('file.txt', 'original');
      await service.write('file.txt', 'updated');
      const content = await readFile(join(tempDir, 'file.txt'), 'utf-8');
      expect(content).toBe('updated');
    });
  });

  // ─── read() ─────────────────────────────────────────────────

  describe('read()', () => {
    it('should read text files as string with correct mime type', async () => {
      await writeFile(join(tempDir, 'readme.md'), '# Title');
      const result = await service.read('readme.md');
      expect(result.content).toBe('# Title');
      expect(result.mimeType).toBe('text/markdown');
      expect(result.size).toBe(7);
    });

    it('should read JSON files as string', async () => {
      await writeFile(join(tempDir, 'data.json'), '{"key":"value"}');
      const result = await service.read('data.json');
      expect(result.content).toBe('{"key":"value"}');
      expect(result.mimeType).toBe('application/json');
    });

    it('should read binary files as Buffer', async () => {
      const buf = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
      await writeFile(join(tempDir, 'image.png'), buf);
      const result = await service.read('image.png');
      expect(Buffer.isBuffer(result.content)).toBe(true);
      expect(result.mimeType).toBe('image/png');
      expect(result.size).toBe(4);
    });

    it('should return application/octet-stream for unknown extensions', async () => {
      await writeFile(join(tempDir, 'data.bin'), Buffer.from([0x00, 0x01]));
      const result = await service.read('data.bin');
      expect(result.mimeType).toBe('application/octet-stream');
    });

    it('should throw for non-existent files', async () => {
      await expect(service.read('nonexistent.txt')).rejects.toThrow();
    });

    it('should detect various text file types', async () => {
      const textFiles: Record<string, string> = {
        'file.txt': 'text/plain',
        'file.html': 'text/html',
        'file.css': 'text/css',
        'file.js': 'text/javascript',
        'file.ts': 'text/typescript',
        'file.yml': 'text/yaml',
        'file.yaml': 'text/yaml',
        'file.csv': 'text/csv',
        'file.xml': 'text/xml',
        'file.svg': 'image/svg+xml',
      };

      for (const [filename, expectedMime] of Object.entries(textFiles)) {
        await writeFile(join(tempDir, filename), 'content');
        const result = await service.read(filename);
        expect(typeof result.content).toBe('string');
        expect(result.mimeType).toBe(expectedMime);
      }
    });
  });

  // ─── list() ─────────────────────────────────────────────────

  describe('list()', () => {
    beforeEach(async () => {
      // Create a directory structure:
      // root/
      //   alpha/
      //     nested/
      //       deep.txt
      //     inner.txt
      //   beta/
      //     b.txt
      //   aaa.txt
      //   zzz.txt
      await mkdir(join(tempDir, 'alpha/nested'), { recursive: true });
      await mkdir(join(tempDir, 'beta'), { recursive: true });
      await writeFile(join(tempDir, 'alpha/nested/deep.txt'), 'deep');
      await writeFile(join(tempDir, 'alpha/inner.txt'), 'inner');
      await writeFile(join(tempDir, 'beta/b.txt'), 'b');
      await writeFile(join(tempDir, 'aaa.txt'), 'aaa');
      await writeFile(join(tempDir, 'zzz.txt'), 'zzz');
    });

    it('should list root directory entries at depth 1', async () => {
      const result = await service.list('.');
      expect(result.path).toBe('.');
      expect(result.entries).toHaveLength(4); // alpha, beta, aaa.txt, zzz.txt
    });

    it('should sort directories first, then alphabetically', async () => {
      const result = await service.list('.');
      const names = result.entries.map((e) => e.name);
      // Directories first (alpha, beta), then files (aaa.txt, zzz.txt)
      expect(names).toEqual(['alpha', 'beta', 'aaa.txt', 'zzz.txt']);
    });

    it('should include type information', async () => {
      const result = await service.list('.');
      const alpha = result.entries.find((e) => e.name === 'alpha');
      const aaa = result.entries.find((e) => e.name === 'aaa.txt');
      expect(alpha?.type).toBe('directory');
      expect(aaa?.type).toBe('file');
    });

    it('should include size and modifiedAt for files', async () => {
      const result = await service.list('.');
      const aaa = result.entries.find((e) => e.name === 'aaa.txt');
      expect(aaa?.size).toBe(3);
      expect(aaa?.modifiedAt).toBeDefined();
      // Should be a valid ISO string
      expect(new Date(aaa!.modifiedAt!).toISOString()).toBe(aaa!.modifiedAt);
    });

    it('should include relative path from root', async () => {
      const result = await service.list('.');
      const alpha = result.entries.find((e) => e.name === 'alpha');
      expect(alpha?.path).toBe('alpha');

      const aaa = result.entries.find((e) => e.name === 'aaa.txt');
      expect(aaa?.path).toBe('aaa.txt');
    });

    it('should list subdirectory contents', async () => {
      const result = await service.list('alpha');
      expect(result.path).toBe('alpha');
      const names = result.entries.map((e) => e.name);
      expect(names).toEqual(['nested', 'inner.txt']);
    });

    it('should list nested children at depth 2', async () => {
      const result = await service.list('.', 2);
      const alpha = result.entries.find((e) => e.name === 'alpha');
      expect(alpha?.children).toBeDefined();
      expect(alpha!.children!.length).toBe(2); // nested dir + inner.txt

      const childNames = alpha!.children!.map((c) => c.name);
      expect(childNames).toEqual(['nested', 'inner.txt']);
    });

    it('should list nested children at depth 3', async () => {
      const result = await service.list('.', 3);
      const alpha = result.entries.find((e) => e.name === 'alpha');
      const nested = alpha!.children!.find((c) => c.name === 'nested');
      expect(nested?.children).toBeDefined();
      expect(nested!.children!.length).toBe(1);
      expect(nested!.children![0].name).toBe('deep.txt');
    });

    it('should cap depth at 3', async () => {
      // Depth 10 should behave like depth 3
      const result = await service.list('.', 10);
      const alpha = result.entries.find((e) => e.name === 'alpha');
      const nested = alpha!.children!.find((c) => c.name === 'nested');
      // deep.txt should be there at depth 3
      expect(nested?.children).toBeDefined();
      expect(nested!.children![0].name).toBe('deep.txt');
      // No further children (depth is capped)
      expect(nested!.children![0].children).toBeUndefined();
    });

    it('should default depth to 1', async () => {
      const result = await service.list('.');
      const alpha = result.entries.find((e) => e.name === 'alpha');
      // At depth 1, directories should not have children populated
      expect(alpha?.children).toBeUndefined();
    });

    it('should throw for non-existent directory', async () => {
      await expect(service.list('nonexistent')).rejects.toThrow();
    });
  });

  // ─── delete() ───────────────────────────────────────────────

  describe('delete()', () => {
    it('should delete a file', async () => {
      await writeFile(join(tempDir, 'to-delete.txt'), 'bye');
      await service.delete('to-delete.txt');
      await expect(stat(join(tempDir, 'to-delete.txt'))).rejects.toThrow();
    });

    it('should delete an empty directory', async () => {
      await mkdir(join(tempDir, 'empty-dir'));
      await service.delete('empty-dir');
      await expect(stat(join(tempDir, 'empty-dir'))).rejects.toThrow();
    });

    it('should delete a non-empty directory with recursive=true', async () => {
      await mkdir(join(tempDir, 'full-dir/sub'), { recursive: true });
      await writeFile(join(tempDir, 'full-dir/sub/file.txt'), 'data');
      await service.delete('full-dir', true);
      await expect(stat(join(tempDir, 'full-dir'))).rejects.toThrow();
    });

    it('should throw when deleting non-empty directory without recursive', async () => {
      await mkdir(join(tempDir, 'nonempty'), { recursive: true });
      await writeFile(join(tempDir, 'nonempty/file.txt'), 'data');
      await expect(service.delete('nonempty')).rejects.toThrow();
    });

    it('should throw for non-existent file', async () => {
      await expect(service.delete('nonexistent.txt')).rejects.toThrow();
    });

    it('should throw on path traversal', async () => {
      await expect(service.delete('../etc/passwd')).rejects.toThrow();
    });
  });

  // ─── rename() ──────────────────────────────────────────────

  describe('rename()', () => {
    it('should rename a file', async () => {
      await writeFile(join(tempDir, 'old.txt'), 'content');
      await service.rename('old.txt', 'new.txt');
      const content = await readFile(join(tempDir, 'new.txt'), 'utf-8');
      expect(content).toBe('content');
      await expect(stat(join(tempDir, 'old.txt'))).rejects.toThrow();
    });

    it('should rename a directory', async () => {
      await mkdir(join(tempDir, 'old-dir'));
      await writeFile(join(tempDir, 'old-dir/file.txt'), 'data');
      await service.rename('old-dir', 'new-dir');
      const content = await readFile(join(tempDir, 'new-dir/file.txt'), 'utf-8');
      expect(content).toBe('data');
      await expect(stat(join(tempDir, 'old-dir'))).rejects.toThrow();
    });

    it('should auto-create intermediate directories', async () => {
      await writeFile(join(tempDir, 'move-me.txt'), 'moving');
      await service.rename('move-me.txt', 'a/b/c/moved.txt');
      const content = await readFile(join(tempDir, 'a/b/c/moved.txt'), 'utf-8');
      expect(content).toBe('moving');
    });

    it('should throw on path traversal for from', async () => {
      await expect(service.rename('../escape.txt', 'safe.txt')).rejects.toThrow();
    });

    it('should throw on path traversal for to', async () => {
      await writeFile(join(tempDir, 'safe.txt'), 'data');
      await expect(service.rename('safe.txt', '../escape.txt')).rejects.toThrow();
    });
  });

  // ─── glob() ─────────────────────────────────────────────────

  describe('glob()', () => {
    beforeEach(async () => {
      await mkdir(join(tempDir, 'src'), { recursive: true });
      await mkdir(join(tempDir, 'docs'), { recursive: true });
      await writeFile(join(tempDir, 'src/index.ts'), 'code');
      await writeFile(join(tempDir, 'src/util.ts'), 'util');
      await writeFile(join(tempDir, 'docs/readme.md'), '# docs');
      await writeFile(join(tempDir, 'root.txt'), 'root');
    });

    it('should find files by extension pattern', async () => {
      const results = await service.glob('**/*.ts');
      expect(results).toHaveLength(2);
      expect(results).toContain('src/index.ts');
      expect(results).toContain('src/util.ts');
    });

    it('should find files by directory pattern', async () => {
      const results = await service.glob('docs/**');
      expect(results).toContain('docs/readme.md');
    });

    it('should find all files with wildcard', async () => {
      const results = await service.glob('**/*');
      expect(results.length).toBeGreaterThanOrEqual(4);
    });

    it('should return relative paths', async () => {
      const results = await service.glob('**/*.md');
      expect(results).toEqual(['docs/readme.md']);
      // Paths should not start with /
      for (const p of results) {
        expect(p.startsWith('/')).toBe(false);
      }
    });

    it('should return empty array for no matches', async () => {
      const results = await service.glob('**/*.xyz');
      expect(results).toEqual([]);
    });

    it('should match directories with trailing slash', async () => {
      const results = await service.glob('**/src');
      expect(results).toContain('src/');
    });

    it('should match directories by wildcard pattern', async () => {
      const results = await service.glob('**/*oc*');
      expect(results).toContain('docs/');
    });

    it('should support nocase option for case-insensitive matching', async () => {
      await mkdir(join(tempDir, 'MyDocs'), { recursive: true });
      await writeFile(join(tempDir, 'MyDocs/Note.MD'), 'note');

      // Case-sensitive (default): should not match
      const sensitive = await service.glob('**/*.md');
      expect(sensitive).not.toContain('MyDocs/Note.MD');

      // Case-insensitive: should match
      const insensitive = await service.glob('**/*.md', { nocase: true });
      expect(insensitive).toContain('MyDocs/Note.MD');
    });

    it('should match directory names case-insensitively with nocase', async () => {
      await mkdir(join(tempDir, 'MyDocs'), { recursive: true });
      await writeFile(join(tempDir, 'MyDocs/file.txt'), 'content');

      const results = await service.glob('**/mydocs/**', { nocase: true });
      expect(results).toContain('MyDocs/file.txt');
    });
  });

  // ─── grep() ─────────────────────────────────────────────────

  describe('grep()', () => {
    beforeEach(async () => {
      await mkdir(join(tempDir, 'src'), { recursive: true });
      await writeFile(
        join(tempDir, 'src/main.ts'),
        'const hello = "world";\nfunction greet() {\n  return hello;\n}\n',
      );
      await writeFile(
        join(tempDir, 'src/util.ts'),
        'export function hello() {\n  return "hello world";\n}\n',
      );
      await writeFile(join(tempDir, 'notes.md'), '# Hello\nSome notes about hello world.\n');
    });

    it('should find matches across files', async () => {
      const results = await service.grep('hello');
      expect(results.length).toBeGreaterThanOrEqual(3);
    });

    it('should return path, line number, and content', async () => {
      const results = await service.grep('hello');
      for (const match of results) {
        expect(match.path).toBeDefined();
        expect(typeof match.line).toBe('number');
        expect(match.line).toBeGreaterThan(0);
        expect(typeof match.content).toBe('string');
      }
    });

    it('should return relative paths', async () => {
      const results = await service.grep('hello');
      for (const match of results) {
        expect(match.path.startsWith('/')).toBe(false);
      }
    });

    it('should search within a specific subdirectory', async () => {
      const results = await service.grep('hello', 'src');
      for (const match of results) {
        expect(match.path.startsWith('src/')).toBe(true);
      }
    });

    it('should return empty array for no matches', async () => {
      const results = await service.grep('xyznonexistent');
      expect(results).toEqual([]);
    });

    it('should include matching line content', async () => {
      const results = await service.grep('greet');
      expect(results).toHaveLength(1);
      expect(results[0].content).toContain('greet');
      expect(results[0].path).toBe('src/main.ts');
      expect(results[0].line).toBe(2);
    });
  });

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
});
