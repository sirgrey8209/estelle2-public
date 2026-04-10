/**
 * @file types/index.ts
 * @description 타입 모듈의 진입점
 *
 * 모든 공유 타입들을 이 파일에서 re-export 합니다.
 */

export * from './device.js';
export * from './message.js';
export * from './auth.js';
export * from './workspace.js';

// === 레거시 (deprecated) ===
// 하위 호환성을 위해 유지, 추후 제거 예정
export * from './claude-event.js';
export * from './claude-control.js';

// blob.js - Blob 전송 관련 타입
export * from './blob.js';

// store-message.js - 모든 타입 export
export * from './store-message.js';

// usage.js - Claude Code 사용량 타입
export * from './usage.js';

// conversation-claude.js - 대화별 Claude 상태 타입
export * from './conversation-claude.js';

// account.js - 계정 관련 타입
export * from './account.js';

// share.js - 대화 공유 관련 타입
export * from './share.js';

// widget.js - Widget Protocol 타입
export * from './widget.js';

// error.js - 에러 관련 타입
export * from './error.js';

// agent.js - 에이전트 타입
export {
  type AgentType,
  DEFAULT_AGENT_TYPE,
  isAgentType,
} from './agent.js';
