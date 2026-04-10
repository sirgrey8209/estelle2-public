/**
 * @file error.ts
 * @description 에러 관련 타입 정의
 */

/**
 * 에러 페이로드 인터페이스
 */
export interface ErrorPayload {
  /** 에러 코드 */
  code: string;
  /** 에러 메시지 */
  message: string;
  /** 추가 데이터 (선택적) */
  data?: unknown;
}
