/**
 * @file archiveApi.ts
 * @description Archive 서버 HTTP API 클라이언트
 *
 * Archive 서버(포트 3009)에 직접 요청합니다.
 * localhost에서는 3009 포트, 그 외에는 동일 호스트 3009 포트를 사용합니다.
 */

import type { FileEntry } from '../stores/archiveStore';
import { useAuthStore } from '../stores/authStore';

/**
 * Archive API는 Caddy 리버스 프록시를 통해 접근합니다.
 * /archive/* → localhost:3009 으로 프록시됩니다.
 * 상대 경로를 사용하므로 별도 base URL이 필요 없습니다.
 */
const BASE = '';

/**
 * 인증 헤더를 생성합니다.
 * Google ID Token이 있으면 Authorization: Bearer 헤더를 포함합니다.
 */
function getAuthHeaders(): Record<string, string> {
  const idToken = useAuthStore.getState().getIdToken();
  if (idToken) {
    return { Authorization: `Bearer ${idToken}` };
  }
  return {};
}

interface ListResponse {
  entries: FileEntry[];
  path: string;
}

interface ReadTextResponse {
  content: string;
  mimeType: string;
  size: number;
}

/**
 * 디렉토리 목록 조회
 */
export async function archiveList(path = '', depth = 1): Promise<FileEntry[]> {
  const params = new URLSearchParams();
  if (path) params.set('path', path);
  params.set('depth', String(depth));

  const res = await fetch(`${BASE}/archive/list?${params}`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `Failed to list: ${res.status}`);
  }

  const data: ListResponse = await res.json();
  return data.entries;
}

/**
 * 파일 읽기
 *
 * 텍스트 파일: JSON envelope { content, mimeType, size } 반환
 * 바이너리 파일: raw bytes 반환 (Content-Type 헤더로 mimeType 확인)
 */
export async function archiveRead(path: string): Promise<{ content: string; mimeType: string; size: number }> {
  const params = new URLSearchParams({ path });
  const res = await fetch(`${BASE}/archive/read?${params}`, {
    headers: getAuthHeaders(),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `Failed to read: ${res.status}`);
  }

  const contentType = res.headers.get('Content-Type') || '';

  // 텍스트 파일은 JSON envelope로 반환됨
  if (contentType.includes('application/json')) {
    const data: ReadTextResponse = await res.json();
    return data;
  }

  // 바이너리 파일은 raw bytes로 반환됨 - blob URL 생성
  const blob = await res.blob();
  const blobUrl = URL.createObjectURL(blob);
  return {
    content: blobUrl,
    mimeType: contentType,
    size: blob.size,
  };
}

/**
 * 바이너리 파일의 직접 URL (이미지 등)
 */
export function archiveReadUrl(path: string): string {
  const params = new URLSearchParams({ path });
  return `${BASE}/archive/read?${params}`;
}

/**
 * 파일/폴더 다운로드 URL (Content-Disposition: attachment)
 */
export function archiveDownloadUrl(path: string): string {
  const params = new URLSearchParams({ path });
  return `${BASE}/archive/download?${params}`;
}
