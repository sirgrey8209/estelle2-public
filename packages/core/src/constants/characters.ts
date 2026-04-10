/**
 * @file characters.ts
 * @description 캐릭터(디바이스) 정보 상수 정의
 *
 * 시스템에 등록된 디바이스들의 표시 이름, 아이콘, 설명을 정의합니다.
 * App에서 디바이스 목록을 표시할 때 사용됩니다.
 */

import type { Character } from '../types/device.js';

/**
 * @deprecated Character 타입을 사용하세요 (types/device.ts)
 */
export type CharacterInfo = Character;

/**
 * 캐릭터(디바이스) 정보 상수
 *
 * @description
 * 시스템에 등록된 디바이스들의 메타데이터를 정의합니다.
 *
 * 디바이스 종류:
 * - 1, 2: Pylon이 실행되는 PC (회사, 집 등)
 * - lucy: 모바일 App
 * - estelle: Relay 서버 자체
 *
 * @example
 * ```typescript
 * import { Characters } from '@estelle/core';
 *
 * // 디바이스 표시 이름 가져오기
 * const deviceInfo = Characters['1'];
 * console.log(`${deviceInfo.icon} ${deviceInfo.name}`);
 * // 출력: 🏢 Device 1
 *
 * // 모든 디바이스 목록 표시
 * Object.entries(Characters).forEach(([id, info]) => {
 *   console.log(`${info.icon} ${info.name} - ${info.description}`);
 * });
 * ```
 */
export const Characters = {
  /** 회사 PC */
  '1': {
    name: 'Device 1',
    icon: '\uD83C\uDFE2', // 🏢
    description: '\uD68C\uC0AC', // 회사
  },
  /** 집 PC */
  '2': {
    name: 'Device 2',
    icon: '\uD83C\uDFE0', // 🏠
    description: '\uC9D1', // 집
  },
  /** 모바일 App */
  lucy: {
    name: 'Lucy',
    icon: '\uD83D\uDCF1', // 📱
    description: 'Mobile',
  },
  /** Relay 서버 */
  estelle: {
    name: 'Estelle',
    icon: '\uD83D\uDCAB', // 💫
    description: 'Relay',
  },
} as const satisfies Record<string, Character>;

/**
 * 캐릭터 ID 유니온 타입
 *
 * @description
 * Characters 객체의 모든 키들의 유니온 타입입니다.
 * 디바이스 ID를 받는 함수의 파라미터 타입으로 사용합니다.
 *
 * @example
 * ```typescript
 * function getCharacterInfo(id: CharacterId): CharacterInfo {
 *   return Characters[id];
 * }
 * ```
 */
export type CharacterId = keyof typeof Characters;
