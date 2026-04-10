/**
 * @file path.ts
 * @description 플랫폼별 경로 유틸리티
 */

import os from 'os';

/** Windows 플랫폼 여부 */
export const IS_WINDOWS = os.platform() === 'win32';

/** 플랫폼에 맞는 경로 구분자 */
export const PATH_SEP = IS_WINDOWS ? '\\' : '/';

/** 플랫폼 타입 */
export type PlatformType = 'windows' | 'linux';

/**
 * 경로 구분자를 플랫폼에 맞게 정규화
 *
 * @param inputPath - 정규화할 경로
 * @param platform - 대상 플랫폼 (기본: 현재 OS)
 * @returns 정규화된 경로
 */
export function normalizePath(inputPath: string, platform?: PlatformType): string {
  const isWin = platform ? platform === 'windows' : IS_WINDOWS;
  const trimmed = inputPath.trim();
  if (isWin) {
    return trimmed.replace(/\//g, '\\');
  } else {
    return trimmed.replace(/\\/g, '/');
  }
}
