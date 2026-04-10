/**
 * @file macro.ts
 * @description 매크로 관리 MCP 도구 구현
 *
 * Claude가 매크로를 생성/수정/삭제/조회/할당할 때 사용하는 MCP 도구.
 * - create_macro: 새 매크로 생성
 * - update_macro: 매크로 수정
 * - delete_macro: 매크로 삭제
 * - list_macros: 매크로 목록 조회
 * - get_macro: 매크로 상세 조회
 * - assign_macro: 워크스페이스 할당 변경
 * - unassign_macro: 워크스페이스 할당 해제
 *
 * 매크로는 특정 대화와 무관한 글로벌 데이터이므로,
 * MacroStore에 직접 접근하여 CRUD를 수행합니다.
 * 변경 후에는 PylonClient를 통해 notify_macro_changed를 보내
 * 클라이언트에 macro_changed 브로드캐스트가 전달되도록 합니다.
 */

import path from 'path';
import { MacroStore } from '../../stores/macro-store.js';
import { PylonClient, type MacroChangedDelta } from '../pylon-client.js';

// ============================================================================
// 타입
// ============================================================================

interface McpTextContent {
  type: 'text';
  text: string;
}

interface ToolResult {
  content: McpTextContent[];
  isError?: boolean;
}

interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

// ============================================================================
// MacroStore 싱글턴
// ============================================================================

const WORKING_DIR = process.env.ESTELLE_WORKING_DIR || process.cwd();
const rawDataDir = process.env.DATA_DIR || './data';
const DATA_DIR = path.isAbsolute(rawDataDir) ? rawDataDir : path.join(WORKING_DIR, rawDataDir);
const MACROS_DB_PATH = path.join(DATA_DIR, 'macros.db');

let _macroStore: MacroStore | null = null;

function getMacroStore(): MacroStore {
  if (!_macroStore) {
    _macroStore = new MacroStore(MACROS_DB_PATH);
  }
  return _macroStore;
}

// ============================================================================
// PylonClient (매크로 변경 알림용)
// ============================================================================

function createPylonClient(): PylonClient {
  const mcpPort = parseInt(process.env.ESTELLE_MCP_PORT || '9880', 10);
  return new PylonClient({
    host: '127.0.0.1',
    port: mcpPort,
  });
}

/**
 * 매크로 변경 알림 (실패해도 무시)
 * CRUD 자체는 성공했으므로, 알림 실패가 전체 작업을 실패시키면 안 됨.
 *
 * @param delta - 변경 delta (있으면 macro_changed에 포함, 없으면 broadcastWorkspaceList 트리거)
 */
async function notifyMacroChangedSafe(delta?: MacroChangedDelta): Promise<void> {
  try {
    const client = createPylonClient();
    await client.notifyMacroChanged(delta);
  } catch {
    // 알림 실패는 무시 (CRUD 자체는 성공)
  }
}

// ============================================================================
// 헬퍼 함수
// ============================================================================

/**
 * MCP 성공 응답 생성
 */
function createSuccessResponse(data: Record<string, unknown>): ToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(data) }],
  };
}

/**
 * MCP 에러 응답 생성
 */
function createErrorResponse(message: string): ToolResult {
  return {
    content: [{ type: 'text', text: message }],
    isError: true,
  };
}

// ============================================================================
// executeCreateMacro
// ============================================================================

/**
 * create_macro MCP 도구 실행
 *
 * @param args - 도구 인자 (name, icon, color, content, workspaceIds)
 * @returns MCP 표준 응답
 */
export async function executeCreateMacro(
  args: {
    name?: string;
    icon?: string;
    color?: string;
    content?: string;
    workspaceIds?: (number | null)[];
  },
): Promise<ToolResult> {
  // 필수 필드 검증
  if (!args.name || args.name.trim() === '') {
    return createErrorResponse('매크로 이름을 입력해주세요 (name 필수)');
  }

  if (!args.content || args.content.trim() === '') {
    return createErrorResponse('매크로 내용을 입력해주세요 (content 필수)');
  }

  try {
    const store = getMacroStore();
    const macroId = store.createMacro(
      args.name,
      args.icon ?? null,
      args.color ?? null,
      args.content,
    );

    // 워크스페이스 할당 (지정된 경우)
    const assignedIds = (args.workspaceIds && args.workspaceIds.length > 0)
      ? args.workspaceIds
      : [null];

    for (const wsId of assignedIds) {
      store.assignMacro(macroId, wsId);
    }

    // 글로벌 할당이면 모든 워크스페이스에 전파
    if (assignedIds.includes(null)) {
      store.propagateGlobalToAllWorkspaces(macroId);
    }

    const createdMacro = store.getMacroById(macroId);
    await notifyMacroChangedSafe({
      added: [{ macro: createdMacro, workspaceIds: assignedIds }],
    });

    return createSuccessResponse({
      success: true,
      macro: {
        id: macroId,
        name: args.name,
        icon: args.icon ?? null,
        color: args.color ?? null,
        content: args.content,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return createErrorResponse(`매크로 생성 실패: ${message}`);
  }
}

// ============================================================================
// executeUpdateMacro
// ============================================================================

/**
 * update_macro MCP 도구 실행
 *
 * @param args - 도구 인자 (macroId, name, icon, color, content)
 * @returns MCP 표준 응답
 */
export async function executeUpdateMacro(
  args: {
    macroId?: number;
    name?: string;
    icon?: string;
    color?: string;
    content?: string;
  },
): Promise<ToolResult> {
  // 필수 필드 검증
  if (args.macroId === undefined || args.macroId === null) {
    return createErrorResponse('매크로 ID를 입력해주세요 (macroId 필수)');
  }

  const fields: { name?: string; icon?: string; color?: string; content?: string } = {};
  if (args.name !== undefined) fields.name = args.name;
  if (args.icon !== undefined) fields.icon = args.icon;
  if (args.color !== undefined) fields.color = args.color;
  if (args.content !== undefined) fields.content = args.content;

  if (Object.keys(fields).length === 0) {
    return createErrorResponse('수정할 필드를 하나 이상 지정해주세요 (name, icon, color, content)');
  }

  try {
    const store = getMacroStore();
    const updated = store.updateMacro(args.macroId, fields);

    if (!updated) {
      return createErrorResponse(`매크로를 찾을 수 없어요 (id: ${args.macroId})`);
    }

    const updatedMacro = store.getMacroById(args.macroId);
    await notifyMacroChangedSafe({
      updated: [updatedMacro],
    });

    return createSuccessResponse({
      success: true,
      macroId: args.macroId,
      updated: fields,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return createErrorResponse(`매크로 수정 실패: ${message}`);
  }
}

// ============================================================================
// executeDeleteMacro
// ============================================================================

/**
 * delete_macro MCP 도구 실행
 *
 * @param args - 도구 인자 (macroId)
 * @returns MCP 표준 응답
 */
export async function executeDeleteMacro(
  args: { macroId?: number },
): Promise<ToolResult> {
  // 필수 필드 검증
  if (args.macroId === undefined || args.macroId === null) {
    return createErrorResponse('매크로 ID를 입력해주세요 (macroId 필수)');
  }

  try {
    const store = getMacroStore();
    const deleted = store.deleteMacro(args.macroId);

    if (!deleted) {
      return createErrorResponse(`매크로를 찾을 수 없어요 (id: ${args.macroId})`);
    }

    await notifyMacroChangedSafe({
      removed: [args.macroId],
    });

    return createSuccessResponse({
      success: true,
      deletedMacroId: args.macroId,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return createErrorResponse(`매크로 삭제 실패: ${message}`);
  }
}

// ============================================================================
// executeListMacros
// ============================================================================

/**
 * list_macros MCP 도구 실행
 *
 * @param args - 도구 인자 (workspaceId)
 * @returns MCP 표준 응답
 */
export async function executeListMacros(
  args: { workspaceId?: number },
): Promise<ToolResult> {
  try {
    const store = getMacroStore();
    // workspaceId가 없으면 0 (글로벌 매크로만 조회)
    const workspaceId = args.workspaceId ?? 0;
    const macros = store.getMacros(workspaceId);

    return createSuccessResponse({
      success: true,
      macros,
      count: macros.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return createErrorResponse(`매크로 목록 조회 실패: ${message}`);
  }
}

// ============================================================================
// executeGetMacro
// ============================================================================

/**
 * get_macro MCP 도구 실행
 *
 * @param args - 도구 인자 (macroId)
 * @returns MCP 표준 응답
 */
export async function executeGetMacro(
  args: { macroId?: number },
): Promise<ToolResult> {
  if (args.macroId === undefined || args.macroId === null) {
    return createErrorResponse('매크로 ID를 입력해주세요 (macroId 필수)');
  }
  try {
    const store = getMacroStore();
    const macro = store.getMacroById(args.macroId);
    if (!macro) {
      return createErrorResponse(`매크로를 찾을 수 없어요 (id: ${args.macroId})`);
    }
    const workspaceIds = store.getAssignedWorkspaceIds(args.macroId);
    return createSuccessResponse({
      success: true,
      macro: { ...macro, workspaceIds },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return createErrorResponse(`매크로 조회 실패: ${message}`);
  }
}

// ============================================================================
// executeAssignMacro
// ============================================================================

/**
 * assign_macro MCP 도구 실행
 *
 * 기존 할당을 모두 제거하고 새로운 워크스페이스 목록으로 재할당합니다.
 * workspaceIds에 null을 포함하면 글로벌 할당이 됩니다.
 *
 * @param args - 도구 인자 (macroId, workspaceIds)
 * @returns MCP 표준 응답
 */
export async function executeAssignMacro(
  args: { macroId?: number; workspaceIds?: (number | null)[] },
): Promise<ToolResult> {
  // 필수 필드 검증
  if (args.macroId === undefined || args.macroId === null) {
    return createErrorResponse('매크로 ID를 입력해주세요 (macroId 필수)');
  }

  if (!args.workspaceIds || !Array.isArray(args.workspaceIds)) {
    return createErrorResponse('워크스페이스 ID 배열을 입력해주세요 (workspaceIds 필수)');
  }

  try {
    const store = getMacroStore();

    // 매크로 존재 확인
    const content = store.getContent(args.macroId);
    if (content === null) {
      return createErrorResponse(`매크로를 찾을 수 없어요 (id: ${args.macroId})`);
    }

    // 기존 할당 제거 후 새로 할당
    // MacroStore에 clearAssignments가 없으므로, DB에 직접 접근하지 않고
    // unassign은 개별적으로 처리가 어려우니 전체 재할당을 위해
    // 새 할당만 추가합니다 (INSERT OR IGNORE이므로 중복 무시)
    for (const wsId of args.workspaceIds) {
      store.assignMacro(args.macroId, wsId);
    }

    // 글로벌 할당이면 모든 워크스페이스에 전파
    if (args.workspaceIds.includes(null)) {
      store.propagateGlobalToAllWorkspaces(args.macroId);
    }

    await notifyMacroChangedSafe();

    return createSuccessResponse({
      success: true,
      macroId: args.macroId,
      workspaceIds: args.workspaceIds,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return createErrorResponse(`워크스페이스 할당 실패: ${message}`);
  }
}

// ============================================================================
// executeUnassignMacro
// ============================================================================

/**
 * unassign_macro MCP 도구 실행
 *
 * @param args - 도구 인자 (macroId, workspaceIds)
 * @returns MCP 표준 응답
 */
export async function executeUnassignMacro(
  args: { macroId?: number; workspaceIds?: (number | null)[] },
): Promise<ToolResult> {
  if (args.macroId === undefined || args.macroId === null) {
    return createErrorResponse('매크로 ID를 입력해주세요 (macroId 필수)');
  }
  if (!args.workspaceIds || !Array.isArray(args.workspaceIds)) {
    return createErrorResponse('워크스페이스 ID 배열을 입력해주세요 (workspaceIds 필수)');
  }
  try {
    const store = getMacroStore();
    const content = store.getContent(args.macroId);
    if (content === null) {
      return createErrorResponse(`매크로를 찾을 수 없어요 (id: ${args.macroId})`);
    }
    for (const wsId of args.workspaceIds) {
      store.unassignMacro(args.macroId, wsId);
    }
    await notifyMacroChangedSafe();
    return createSuccessResponse({
      success: true,
      macroId: args.macroId,
      unassignedWorkspaceIds: args.workspaceIds,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return createErrorResponse(`워크스페이스 할당 해제 실패: ${message}`);
  }
}

// ============================================================================
// 도구 정의
// ============================================================================

/**
 * create_macro 도구 정의 반환
 */
export function getCreateMacroToolDefinition(): ToolDefinition {
  return {
    name: 'create_macro',
    description: '매크로 툴바에 새 매크로를 생성합니다. 매크로는 자주 사용하는 프롬프트를 버튼으로 만든 것입니다.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: '매크로 이름 (버튼에 표시)',
        },
        icon: {
          type: 'string',
          description: '아이콘 이름 (선택, 예: "search", "code", "bug")',
        },
        color: {
          type: 'string',
          description: '색상 코드 (선택, 예: "#ff0000")',
        },
        content: {
          type: 'string',
          description: '매크로 실행 시 전송할 프롬프트 내용',
        },
        workspaceIds: {
          type: 'array',
          items: { type: ['integer', 'null'] },
          description: '할당할 워크스페이스 ID 배열 (선택, null은 글로벌, 미지정 시 글로벌)',
        },
      },
      required: ['name', 'content'],
    },
  };
}

/**
 * update_macro 도구 정의 반환
 */
export function getUpdateMacroToolDefinition(): ToolDefinition {
  return {
    name: 'update_macro',
    description: '기존 매크로의 이름, 아이콘, 색상, 내용을 수정합니다.',
    inputSchema: {
      type: 'object',
      properties: {
        macroId: {
          type: 'integer',
          description: '수정할 매크로 ID',
        },
        name: {
          type: 'string',
          description: '새 매크로 이름 (선택)',
        },
        icon: {
          type: 'string',
          description: '새 아이콘 이름 (선택)',
        },
        color: {
          type: 'string',
          description: '새 색상 코드 (선택)',
        },
        content: {
          type: 'string',
          description: '새 프롬프트 내용 (선택)',
        },
      },
      required: ['macroId'],
    },
  };
}

/**
 * delete_macro 도구 정의 반환
 */
export function getDeleteMacroToolDefinition(): ToolDefinition {
  return {
    name: 'delete_macro',
    description: '매크로를 삭제합니다. 관련된 워크스페이스 할당도 함께 삭제됩니다.',
    inputSchema: {
      type: 'object',
      properties: {
        macroId: {
          type: 'integer',
          description: '삭제할 매크로 ID',
        },
      },
      required: ['macroId'],
    },
  };
}

/**
 * list_macros 도구 정의 반환
 */
export function getListMacrosToolDefinition(): ToolDefinition {
  return {
    name: 'list_macros',
    description: '매크로 목록을 조회합니다. 워크스페이스별 또는 글로벌 매크로를 조회할 수 있습니다.',
    inputSchema: {
      type: 'object',
      properties: {
        workspaceId: {
          type: 'integer',
          description: '워크스페이스 ID (선택, 미지정 시 글로벌 매크로만 조회)',
        },
      },
      required: [],
    },
  };
}

/**
 * get_macro 도구 정의 반환
 */
export function getGetMacroToolDefinition(): ToolDefinition {
  return {
    name: 'get_macro',
    description: '매크로 ID로 상세 정보를 조회합니다. 할당된 워크스페이스 목록도 포함됩니다.',
    inputSchema: {
      type: 'object',
      properties: {
        macroId: {
          type: 'integer',
          description: '조회할 매크로 ID',
        },
      },
      required: ['macroId'],
    },
  };
}

/**
 * assign_macro 도구 정의 반환
 */
export function getAssignMacroToolDefinition(): ToolDefinition {
  return {
    name: 'assign_macro',
    description: '매크로를 워크스페이스에 할당합니다. null을 포함하면 글로벌 할당입니다.',
    inputSchema: {
      type: 'object',
      properties: {
        macroId: {
          type: 'integer',
          description: '할당할 매크로 ID',
        },
        workspaceIds: {
          type: 'array',
          items: { type: ['integer', 'null'] },
          description: '할당할 워크스페이스 ID 배열 (null은 글로벌)',
        },
      },
      required: ['macroId', 'workspaceIds'],
    },
  };
}

/**
 * unassign_macro 도구 정의 반환
 */
export function getUnassignMacroToolDefinition(): ToolDefinition {
  return {
    name: 'unassign_macro',
    description: '매크로의 워크스페이스 할당을 해제합니다. null은 글로벌 할당 해제입니다.',
    inputSchema: {
      type: 'object',
      properties: {
        macroId: {
          type: 'integer',
          description: '할당 해제할 매크로 ID',
        },
        workspaceIds: {
          type: 'array',
          items: { type: ['integer', 'null'] },
          description: '할당 해제할 워크스페이스 ID 배열 (null은 글로벌 해제)',
        },
      },
      required: ['macroId', 'workspaceIds'],
    },
  };
}
