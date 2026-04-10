/**
 * @file new-session.test.ts
 * @description new_session MCP 도구 테스트
 *
 * Claude가 대화 세션을 초기화할 때 사용하는 MCP 도구 테스트.
 * 히스토리를 삭제하고 새 세션을 시작합니다.
 *
 * 테스트 케이스:
 * - newSessionToolDefinition: 도구 정의
 * - executeNewSession: 정상 케이스, 에러 케이스, 엣지 케이스
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// 아직 구현되지 않은 모듈 - 테스트 실패 예상
import {
  getNewSessionToolDefinition,
  executeNewSession,
} from '../../../src/mcp/tools/new-session.js';

// ============================================================================
// 테스트 상수
// ============================================================================

const TEST_TOOL_USE_ID = 'toolu_new_session_test_123';

// ============================================================================
// 도구 정의 테스트
// ============================================================================

describe('newSessionToolDefinition', () => {
  // 도구 정의 가져오기
  const newSessionToolDefinition = getNewSessionToolDefinition();

  it('should_have_correct_name', () => {
    // Assert
    expect(newSessionToolDefinition.name).toBe('new_session');
  });

  it('should_have_description', () => {
    // Assert
    expect(newSessionToolDefinition.description).toBeDefined();
    expect(typeof newSessionToolDefinition.description).toBe('string');
    expect(newSessionToolDefinition.description.length).toBeGreaterThan(0);
  });

  it('should_have_empty_properties_in_input_schema', () => {
    // Assert - new_session은 파라미터 없음
    expect(newSessionToolDefinition.inputSchema).toBeDefined();
    expect(newSessionToolDefinition.inputSchema.type).toBe('object');
    const propKeys = Object.keys(newSessionToolDefinition.inputSchema.properties);
    expect(propKeys.length).toBe(0);
  });

  it('should_have_no_required_fields', () => {
    // Assert - 필수 파라미터 없음
    const required = newSessionToolDefinition.inputSchema.required || [];
    expect(required.length).toBe(0);
  });
});

// ============================================================================
// executeNewSession 테스트
// ============================================================================

describe('executeNewSession', () => {
  beforeEach(() => {
    // 환경변수 설정
    vi.stubEnv('ESTELLE_MCP_PORT', '19879');
    vi.stubEnv('ESTELLE_ENV', 'test');
    vi.stubEnv('ESTELLE_VERSION', '(test)v0401_1');
    vi.stubEnv('ESTELLE_WORKING_DIR', 'C:\\WorkSpace\\estelle2');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // ============================================================================
  // 정상 케이스 테스트
  // ============================================================================
  describe('success cases', () => {
    it('should_return_success_when_valid_toolUseId', async () => {
      // Arrange
      const args = {};
      const meta = { toolUseId: TEST_TOOL_USE_ID };

      // Act
      const result = await executeNewSession(args, meta);

      // Assert
      expect(result.isError).toBeUndefined();
      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');

      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(true);
    });

    it('should_return_newSession_true_in_response', async () => {
      // Arrange
      const args = {};
      const meta = { toolUseId: TEST_TOOL_USE_ID };

      // Act
      const result = await executeNewSession(args, meta);

      // Assert
      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(true);
      expect(data.newSession).toBe(true);
    });

    it('should_return_message_about_new_session', async () => {
      // Arrange
      const args = {};
      const meta = { toolUseId: TEST_TOOL_USE_ID };

      // Act
      const result = await executeNewSession(args, meta);

      // Assert
      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(true);
      expect(data.message).toContain('새 세션');
    });
  });

  // ============================================================================
  // 에러 케이스 테스트
  // ============================================================================
  describe('error cases', () => {
    it('should_return_error_when_toolUseId_is_empty', async () => {
      // Arrange
      const args = {};
      const meta = { toolUseId: '' };

      // Act
      const result = await executeNewSession(args, meta);

      // Assert
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toMatch(/toolUseId/i);
    });

    it('should_return_error_when_toolUseId_not_found', async () => {
      // Arrange
      const args = {};
      const meta = { toolUseId: 'toolu_unknown_id_xyz' };

      // Act
      const result = await executeNewSession(args, meta);

      // Assert
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toMatch(/not found|toolUseId/i);
    });

    it('should_return_error_when_pylon_connection_fails', async () => {
      // Arrange - 잘못된 포트 설정
      vi.stubEnv('ESTELLE_MCP_PORT', '19999');
      const args = {};
      const meta = { toolUseId: TEST_TOOL_USE_ID };

      // Act
      const result = await executeNewSession(args, meta);

      // Assert
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toMatch(/failed|error|connection/i);
    });
  });

  // ============================================================================
  // 엣지 케이스 테스트
  // ============================================================================
  describe('edge cases', () => {
    it('should_ignore_unexpected_args', async () => {
      // Arrange - new_session은 파라미터 없지만, 무관한 인자 전달 시 무시
      const args = { unexpected: 'value' } as Record<string, unknown>;
      const meta = { toolUseId: TEST_TOOL_USE_ID };

      // Act
      const result = await executeNewSession(args, meta);

      // Assert - 에러 없이 처리
      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');
    });
  });
});
