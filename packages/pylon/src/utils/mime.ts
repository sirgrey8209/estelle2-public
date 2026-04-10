/**
 * @file mime.ts
 * @description MIME 타입 유틸리티
 */

/**
 * 확장자별 MIME 타입 매핑 (pylon-mcp-server.ts의 가장 완전한 버전 기준)
 */
export const MIME_TYPES: Record<string, string> = {
  // 이미지
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',

  // 오디오
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',

  // 마크다운
  '.md': 'text/markdown',
  '.markdown': 'text/markdown',

  // 텍스트
  '.txt': 'text/plain',
  '.log': 'text/plain',
  '.csv': 'text/csv',

  // 데이터 포맷
  '.json': 'application/json',
  '.xml': 'text/xml',
  '.yaml': 'text/yaml',
  '.yml': 'text/yaml',

  // 웹
  '.html': 'text/html',
  '.css': 'text/css',

  // 프로그래밍 언어
  '.js': 'text/javascript',
  '.ts': 'text/typescript',
  '.dart': 'text/x-dart',
  '.py': 'text/x-python',
  '.java': 'text/x-java',
  '.c': 'text/x-c',
  '.cpp': 'text/x-c++',
  '.h': 'text/x-c',
  '.go': 'text/x-go',
  '.rs': 'text/x-rust',

  // 스크립트
  '.sh': 'text/x-shellscript',
  '.bat': 'text/x-batch',
  '.ps1': 'text/x-powershell',
};

/**
 * 확장자로 MIME 타입을 조회
 * @param ext - 파일 확장자 (예: '.png')
 * @param fallback - 매칭 없을 때 기본값 (기본: 'application/octet-stream')
 */
export function getMimeType(ext: string, fallback = 'application/octet-stream'): string {
  return MIME_TYPES[ext.toLowerCase()] ?? fallback;
}
