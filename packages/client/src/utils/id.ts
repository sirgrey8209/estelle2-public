/**
 * @file id.ts
 * @description ID 생성 유틸리티
 */

/**
 * 고유 ID 생성
 * @param prefix - ID 접두사 (기본: 'msg')
 * @returns 고유 ID 문자열
 */
export function generateId(prefix = 'msg'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}

/**
 * UUID v4 생성
 * @returns UUID 문자열
 */
export function generateUUID(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * 파일 ID 생성
 * @returns 파일 ID 문자열
 */
export function generateFileId(): string {
  return generateId('file');
}
