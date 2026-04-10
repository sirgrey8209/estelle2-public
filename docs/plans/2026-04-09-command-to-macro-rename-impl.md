# Command → Macro 전면 리네임 구현 계획

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** "커맨드(command)"를 "매크로(macro)"로 전면 리네임하여 용어 혼동을 해소한다.

**Architecture:** 빅뱅 리네임 — core → pylon → client → tests → docs 순서로 모든 파일을 한 번에 변경. 각 Task는 독립적으로 작업 가능하지만, 전체 테스트는 모든 Task 완료 후에만 통과한다.

**Tech Stack:** TypeScript, SQLite (better-sqlite3), React (Zustand), Vitest

---

## 리네임 규칙

| 기존 | 변경 | 비고 |
|------|------|------|
| `command` | `macro` | 변수, 함수 인자, 로컬 변수 |
| `Command` | `Macro` | 클래스, 인터페이스, 타입, 컴포넌트 |
| `COMMAND` | `MACRO` | 상수 |
| `commands` | `macros` | 복수형, DB 테이블 |
| `커맨드` | `매크로` | 한글 주석/문자열 |
| `commandExecute` | `macroExecute` | Claude event subtype |

**예외 (변경하지 않음):**
- `SlashCommand`, `slashCommand`, `getSessionSlashCommands` — 별개 기능
- `claude_control` 내부 명령어
- `docs/plans/` 하위의 과거 설계/구현 문서

---

## Task 1: Core — 메시지 타입 상수

**Files:**
- Modify: `packages/core/src/constants/message-type.ts:231-262`

**Step 1: 메시지 타입 상수 리네임**

`// === Command ===` 섹션(약 line 231~262)을 아래로 교체:

```typescript
  // === Macro ===
  /** 매크로 실행 (Client → Pylon) */
  MACRO_EXECUTE: 'macro_execute',
  /** 매크로 생성 (Client → Pylon) */
  MACRO_CREATE: 'macro_create',
  /** 매크로 생성 응답 (Pylon → Client) */
  MACRO_CREATE_RESULT: 'macro_create_result',
  /** 매크로 수정 (Client → Pylon) */
  MACRO_UPDATE: 'macro_update',
  /** 매크로 삭제 (Client → Pylon) */
  MACRO_DELETE: 'macro_delete',
  /** 매크로 할당 변경 (Client → Pylon) */
  MACRO_ASSIGN: 'macro_assign',
  /** 매크로 변경 알림 (Pylon → Client) */
  MACRO_CHANGED: 'macro_changed',
  /** 매크로 순서 변경 (Client → Pylon) */
  MACRO_REORDER: 'macro_reorder',
  /** 매크로 관리 대화 생성 (Client → Pylon) */
  MACRO_MANAGE_CONVERSATION: 'macro_manage_conversation',
```

---

## Task 2: Core — StoreMessage 타입

**Files:**
- Modify: `packages/core/src/types/store-message.ts`

**Step 1: StoreMessageType 유니온 변경**

`'command_execute'` → `'macro_execute'` (line 42 부근)

주석도 변경: `커맨드 실행 메시지` → `매크로 실행 메시지` (line 30 부근)

**Step 2: CommandExecuteMessage 인터페이스 리네임**

line 353~377 부근의 `CommandExecuteMessage` 인터페이스를 `MacroExecuteMessage`로 리네임. 필드도 변경:

```typescript
/**
 * 매크로 실행 메시지
 *
 * 사용자가 매크로를 실행했을 때 생성되는 메시지입니다.
 * 일반 텍스트 메시지 대신 매크로 실행 버블로 표시됩니다.
 */
export interface MacroExecuteMessage extends BaseStoreMessage {
  /** 역할: 항상 'user' */
  role: 'user';

  /** 타입: 항상 'macro_execute' */
  type: 'macro_execute';

  /** 메시지 내용 */
  content: string;

  /** 매크로 ID */
  macroId: number;

  /** 매크로 이름 */
  macroName: string;

  /** 매크로 아이콘 (선택적) */
  macroIcon: string | null;

  /** 매크로 색상 (선택적) */
  macroColor: string | null;
}
```

**Step 3: StoreMessage 유니온 변경**

line 418 부근: `| CommandExecuteMessage` → `| MacroExecuteMessage`

**Step 4: 타입 가드 함수 리네임**

line 588~602 부근:

```typescript
/**
 * MacroExecuteMessage 타입 가드
 *
 * @param value - 확인할 값
 * @returns MacroExecuteMessage 타입이면 true
 */
export function isMacroExecuteMessage(value: unknown): value is MacroExecuteMessage {
  return (
    isObject(value) &&
    'role' in value && value.role === 'user' &&
    'type' in value && value.type === 'macro_execute' &&
    'id' in value && typeof value.id === 'string' &&
    'timestamp' in value && typeof value.timestamp === 'number' &&
    'macroId' in value && typeof value.macroId === 'string'
  );
}
```

**Step 5: isStoreMessage에서 호출 변경**

line 642 부근: `isCommandExecuteMessage(value)` → `isMacroExecuteMessage(value)`

---

## Task 3: Pylon — MacroStore (파일 리네임 + 코드)

**Files:**
- Rename: `pylon/src/stores/command-store.ts` → `pylon/src/stores/macro-store.ts`

**Step 1: git mv**

```bash
cd packages/pylon
git mv src/stores/command-store.ts src/stores/macro-store.ts
```

**Step 2: 파일 내용 전면 리네임**

`macro-store.ts` 내에서:

| 기존 | 변경 |
|------|------|
| `command-store.ts` | `macro-store.ts` |
| `CommandStore` | `MacroStore` |
| `CommandListItem` | `MacroListItem` |
| `커맨드 툴바용 커맨드 저장소` | `매크로 툴바용 매크로 저장소` |
| `워크스페이스별 커맨드 버튼` | `워크스페이스별 매크로 버튼` |
| `commands.db` | `macros.db` |
| `createCommand` | `createMacro` |
| `updateCommand` | `updateMacro` |
| `deleteCommand` | `deleteMacro` |
| `assignCommand` | `assignMacro` |
| `unassignCommand` | `unassignMacro` |
| `reorderCommands` | `reorderMacros` |
| `propagateGlobalCommands` | `propagateGlobalMacros` |
| `propagateGlobalToAllWorkspaces` | `propagateGlobalToAllWorkspaces` | (변경 없음 — 이미 generic) |
| `getCommands` | `getMacros` |
| `getCommandsByWorkspaces` | `getMacrosByWorkspaces` |
| `getAssignedWorkspaceIds` | `getAssignedWorkspaceIds` | (변경 없음 — generic) |
| `getCommandById` | `getMacroById` |
| `stmtInsertCommand` | `stmtInsertMacro` |
| `stmtDeleteCommand` | `stmtDeleteMacro` |
| `글로벌 커맨드` | `글로벌 매크로` |
| `커맨드가 글로벌로` | `매크로가 글로벌로` |

**DB 테이블명은 변경하지 않음** — SQL 문 안의 `commands`, `command_assignments` 테이블명은 그대로 유지. 이유: 기존 DB 파일과의 호환성. 테이블명은 내부 구현이므로 외부에 노출되지 않음.

단, DB **파일명**은 변경: `commands.db` → `macros.db` (bin.ts에서 변경)

---

## Task 4: Pylon — MCP 도구 (파일 리네임 + 코드)

**Files:**
- Rename: `pylon/src/mcp/tools/command.ts` → `pylon/src/mcp/tools/macro.ts`

**Step 1: git mv**

```bash
git mv src/mcp/tools/command.ts src/mcp/tools/macro.ts
```

**Step 2: import 경로 변경**

`command-store.js` → `macro-store.js` import 경로 변경

**Step 3: 상수/변수 리네임**

| 기존 | 변경 |
|------|------|
| `COMMANDS_DB_PATH` | `MACROS_DB_PATH` |
| `commands.db` | `macros.db` |
| `getCommandStore` | `getMacroStore` |
| `commandStore` | `macroStore` |
| `CommandStore` | `MacroStore` |
| `CommandListItem` | `MacroListItem` |

**Step 4: 실행 함수 리네임 (7개)**

| 기존 | 변경 |
|------|------|
| `executeCreateCommand` | `executeCreateMacro` |
| `executeUpdateCommand` | `executeUpdateMacro` |
| `executeDeleteCommand` | `executeDeleteMacro` |
| `executeListCommands` | `executeListMacros` |
| `executeGetCommand` | `executeGetMacro` |
| `executeAssignCommand` | `executeAssignMacro` |
| `executeUnassignCommand` | `executeUnassignMacro` |

**Step 5: 도구 정의 함수 리네임 (7개)**

| 기존 | 변경 |
|------|------|
| `getCreateCommandToolDefinition` | `getCreateMacroToolDefinition` |
| `getUpdateCommandToolDefinition` | `getUpdateMacroToolDefinition` |
| `getDeleteCommandToolDefinition` | `getDeleteMacroToolDefinition` |
| `getListCommandsToolDefinition` | `getListMacrosToolDefinition` |
| `getGetCommandToolDefinition` | `getGetMacroToolDefinition` |
| `getAssignCommandToolDefinition` | `getAssignMacroToolDefinition` |
| `getUnassignCommandToolDefinition` | `getUnassignMacroToolDefinition` |

**Step 6: 도구 정의 내 name/description 변경**

각 도구의 `name`과 `description` 문자열 변경:

```typescript
// create_command → create_macro
name: 'create_macro',
description: '매크로 툴바에 새 매크로를 생성합니다. 매크로는 자주 사용하는 프롬프트를 버튼으로 만든 것입니다.',

// update_command → update_macro
name: 'update_macro',
description: '기존 매크로의 이름, 아이콘, 색상, 내용을 수정합니다.',

// delete_command → delete_macro
name: 'delete_macro',
description: '매크로를 삭제합니다. 관련된 워크스페이스 할당도 함께 삭제됩니다.',

// list_commands → list_macros
name: 'list_macros',
description: '매크로 목록을 조회합니다. 워크스페이스별 또는 글로벌 매크로를 조회할 수 있습니다.',

// get_command → get_macro
name: 'get_macro',
description: '매크로 ID로 상세 정보를 조회합니다. 할당된 워크스페이스 목록도 포함됩니다.',

// assign_command → assign_macro
name: 'assign_macro',
description: '매크로를 워크스페이스에 할당합니다. null을 포함하면 글로벌 할당입니다.',

// unassign_command → unassign_macro
name: 'unassign_macro',
description: '매크로의 워크스페이스 할당을 해제합니다. null은 글로벌 할당 해제입니다.',
```

도구 정의 내 `commandId` 파라미터는 `macroId`로 변경. description의 `커맨드` → `매크로`.

**Step 7: 헬퍼 함수 리네임**

`notifyCommandChangedSafe` → `notifyMacroChangedSafe`
`notifyCommandChanged` → `notifyMacroChanged` (PylonClient 호출)
`CommandChangedDelta` → `MacroChangedDelta` (import)

**Step 8: 한글 주석/문자열 변경**

파일 내 모든 `커맨드` → `매크로`

---

## Task 5: Pylon — pylon-client.ts

**Files:**
- Modify: `pylon/src/mcp/pylon-client.ts`

**Step 1: 타입 리네임**

```typescript
// line 120-131
export interface MacroChangedDelta {
  added?: { command: unknown; workspaceIds: (number | null)[] }[];  // 'command' 필드는 데이터 객체이므로 'macro'로
  removed?: number[];
  updated?: unknown[];
}

export interface NotifyMacroChangedResult {
  success: boolean;
  error?: string;
}
```

주의: `MacroChangedDelta`의 `added` 배열 안의 `command` 필드 → `macro`로 변경.

**Step 2: PylonRequest delta 타입 변경**

line 201: `delta?: CommandChangedDelta` → `delta?: MacroChangedDelta`

**Step 3: 메서드 리네임**

```typescript
// line 641-646
async notifyMacroChanged(delta?: MacroChangedDelta): Promise<NotifyMacroChangedResult> {
  return this._sendRequest<NotifyMacroChangedResult>({
    action: 'notify_macro_changed',
    delta,
  } as PylonRequest);
}
```

---

## Task 6: Pylon — server.ts (MCP 서버)

**Files:**
- Modify: `pylon/src/mcp/server.ts`

**Step 1: import 경로 변경**

```typescript
import {
  executeCreateMacro,
  executeUpdateMacro,
  executeDeleteMacro,
  executeListMacros,
  executeGetMacro,
  executeAssignMacro,
  executeUnassignMacro,
  getCreateMacroToolDefinition,
  getUpdateMacroToolDefinition,
  getDeleteMacroToolDefinition,
  getListMacrosToolDefinition,
  getGetMacroToolDefinition,
  getAssignMacroToolDefinition,
  getUnassignMacroToolDefinition,
} from './tools/macro.js';
```

**Step 2: 도구 정의 등록 변경**

```typescript
getCreateMacroToolDefinition(),
getUpdateMacroToolDefinition(),
getDeleteMacroToolDefinition(),
getListMacrosToolDefinition(),
getGetMacroToolDefinition(),
getAssignMacroToolDefinition(),
getUnassignMacroToolDefinition(),
```

**Step 3: switch case 변경**

모든 `case 'create_command':` → `case 'create_macro':` 등 7개 case문. 
함수 호출도 `executeCreateCommand` → `executeCreateMacro` 등.
`commandId` 파라미터 → `macroId`.

---

## Task 7: Pylon — pylon-mcp-server.ts

**Files:**
- Modify: `pylon/src/servers/pylon-mcp-server.ts`

**Step 1: 콜백 옵션 리네임**

`onCommandChanged` → `onMacroChanged` (line 90-95 부근)
주석의 `커맨드` → `매크로`

**Step 2: 타입 리네임**

`McpNotifyCommandChangedSuccessResponse` → `McpNotifyMacroChangedSuccessResponse` (line 271-274)
응답 유니온 타입에서도 변경 (line 296)

**Step 3: private 필드 리네임**

`_onCommandChanged` → `_onMacroChanged` (line 338-342)
constructor에서의 할당: `this._onMacroChanged = options?.onMacroChanged;` (line 373)

**Step 4: 액션 핸들러 변경**

```typescript
// line 649-653
if (request.action === 'notify_macro_changed') {
  this._onMacroChanged?.(request.delta);
  return { success: true } as McpResponse;
}
```

**Step 5: McpRequest delta 주석 변경**

line 132: `커맨드 변경 delta (notify_command_changed 액션에서 사용)` → `매크로 변경 delta (notify_macro_changed 액션에서 사용)`

---

## Task 8: Pylon — pylon.ts (핸들러)

**Files:**
- Modify: `pylon/src/pylon.ts`

**Step 1: import 변경**

`CommandStore` → `MacroStore`, import 경로: `./stores/macro-store.js`

**Step 2: PylonDependencies 인터페이스 변경**

`commandStore?: CommandStore` → `macroStore?: MacroStore`
주석: `커맨드 저장소` → `매크로 저장소`

**Step 3: stop() 메서드 변경**

`this.deps.commandStore?.close()` → `this.deps.macroStore?.close()`
주석: `CommandStore 종료` → `MacroStore 종료`

**Step 4: 메시지 핸들러 등록 변경 (line 987~1013)**

```typescript
// ===== Macro =====
handlers.set('macro_execute', (payload, from) => {
  this.handleMacroExecute(payload, from);
});

handlers.set('macro_create', (payload, from) => {
  this.handleMacroCreate(payload, from);
});

handlers.set('macro_update', (payload, from) => {
  this.handleMacroUpdate(payload, from);
});

handlers.set('macro_delete', (payload, from) => {
  this.handleMacroDelete(payload, from);
});

handlers.set('macro_assign', (payload, from) => {
  this.handleMacroAssign(payload, from);
});

handlers.set('macro_reorder', (payload) => {
  this.handleMacroReorder(payload);
});

handlers.set('macro_manage_conversation', (payload, from) => {
  this.handleMacroManageConversation(payload, from);
});
```

**Step 5: broadcastWorkspaceList 내 매크로 조회 변경 (line 1762~1770)**

`this.deps.commandStore` → `this.deps.macroStore`
메서드: `getCommandsByWorkspaces` → `getMacrosByWorkspaces`
변수: `commandsByWs` → `macrosByWs`
payload 키: `commands` → `macros`

**Step 6: createWorkspace 내 글로벌 전파 변경 (line 1810~1811)**

`this.deps.commandStore` → `this.deps.macroStore`
`propagateGlobalCommands` → `propagateGlobalMacros`
주석: `글로벌 커맨드를 새 워크스페이스에 전파` → `글로벌 매크로를 새 워크스페이스에 전파`

**Step 7: getInitialContext 내 매크로 조회 변경 (line 2994~3008)**

`this.deps.commandStore` → `this.deps.macroStore`
`getCommandsByWorkspaces` → `getMacrosByWorkspaces`
변수: `commandsByWs` → `macrosByWs`
주석: `커맨드 조회` → `매크로 조회`, `태스크/워커/커맨드` → `태스크/워커/매크로`
payload 키: `commands` → `macros`

**Step 8: handleCommandExecute → handleMacroExecute (line 3695~3781)**

메서드명: `handleCommandExecute` → `handleMacroExecute`

내부 변경:
- `this.deps.commandStore` → `this.deps.macroStore`
- `commandId` 변수 → `macroId`
- `getCommandById` → `getMacroById`
- `command` 변수 → `macro`
- `addCommandExecuteMessage` → `addMacroExecuteMessage`
- `command.content` → `macro.content` 등
- `Command not found` → `Macro not found`
- Claude event subtype: `type: 'commandExecute'` → `type: 'macroExecute'`
- event payload: `commandId`, `commandName`, `commandIcon`, `commandColor` → `macroId`, `macroName`, `macroIcon`, `macroColor`
- 주석의 `커맨드` → `매크로`

**Step 9: handleCommandCreate → handleMacroCreate (line 3789~3824)**

메서드명 변경 + 내부:
- `this.deps.commandStore` → `this.deps.macroStore`
- `commandId` → `macroId`
- `createCommand` → `createMacro`
- `assignCommand` → `assignMacro`
- `type: 'command_create_result'` → `type: 'macro_create_result'`
- `type: 'command_changed'` → `type: 'macro_changed'`
- `getCommandById` → `getMacroById`
- `createdCommand` → `createdMacro`
- `command: createdCommand` (payload 키) → `macro: createdMacro`

**Step 10: handleCommandUpdate → handleMacroUpdate**

동일 패턴으로 변경. `updateCommand` → `updateMacro`, `updatedCommand` → `updatedMacro`.

**Step 11: handleCommandDelete → handleMacroDelete**

`deleteCommand` → `deleteMacro`, `type: 'command_changed'` → `type: 'macro_changed'`.

**Step 12: handleCommandAssign → handleMacroAssign**

`assignCommand` → `assignMacro`, `unassignCommand` → `unassignMacro`, `propagateGlobalToAllWorkspaces` 유지.

**Step 13: handleCommandReorder → handleMacroReorder**

`reorderCommands` → `reorderMacros`, `commandIds` → `macroIds`.

**Step 14: handleCommandManageConversation → handleMacroManageConversation**

- 대화 이름: `'커맨드 수정'` → `'매크로 수정'`, `'커맨드 생성'` → `'매크로 생성'`
- 프롬프트 문자열: `커맨드` → `매크로`, `get_command` → `get_macro`, `update_command` → `update_macro`, `delete_command` → `delete_macro`, `list_commands` → `list_macros`, `create_command` → `create_macro`

---

## Task 9: Pylon — bin.ts

**Files:**
- Modify: `pylon/src/bin.ts`

**Step 1: import 변경**

`CommandStore` → `MacroStore`, 경로: `./stores/macro-store.js`

**Step 2: 초기화 코드 변경**

```typescript
// MacroStore (SQLite)
const macrosDbPath = path.join(dataDir, 'macros.db');
const macroStore = new MacroStore(macrosDbPath);
logger.log(`[MacroStore] Using SQLite database: ${macrosDbPath}`);
```

**Step 3: deps 객체에서 변경**

`commandStore` → `macroStore`

**Step 4: onCommandChanged 콜백 변경**

```typescript
onMacroChanged: (delta) => {
  if (delta) {
    deps.relayClientV2.send({
      type: 'macro_changed',
      payload: delta,
      broadcast: 'clients',
```

---

## Task 10: Pylon — message-store.ts

**Files:**
- Modify: `pylon/src/stores/message-store.ts`

**Step 1: import 변경**

`CommandExecuteMessage` → `MacroExecuteMessage` (두 곳: line 45, 63)

**Step 2: _messageToRow — serialization 변경**

```typescript
case 'macro_execute': {
  const cmdMsg = msg as MacroExecuteMessage;
  base.content = cmdMsg.content;
  // 매크로 메타데이터를 tool_input 컬럼에 JSON으로 저장 (기존 컬럼 재활용)
  base.tool_input = JSON.stringify({
    macroId: cmdMsg.macroId,
    macroName: cmdMsg.macroName,
    macroIcon: cmdMsg.macroIcon,
    macroColor: cmdMsg.macroColor,
  });
  break;
}
```

**Step 3: _rowToMessage — deserialization 변경 (하위 호환 포함)**

```typescript
case 'macro_execute':
case 'command_execute': {  // backward compat for old DB records
  const meta = row.tool_input ? JSON.parse(row.tool_input) : {};
  return {
    id,
    timestamp,
    role: 'user' as const,
    type: 'macro_execute' as const,
    content: row.content || '',
    macroId: meta.macroId ?? meta.commandId,
    macroName: meta.macroName ?? meta.commandName,
    macroIcon: meta.macroIcon ?? meta.commandIcon ?? null,
    macroColor: meta.macroColor ?? meta.commandColor ?? null,
  };
}
```

**Step 4: addCommandExecuteMessage → addMacroExecuteMessage**

```typescript
/**
 * 매크로 실행 메시지 추가
 */
addMacroExecuteMessage(
  sessionId: number,
  content: string,
  macroId: number,
  macroName: string,
  macroIcon: string | null,
  macroColor: string | null,
): StoreMessage[] {
  const msg: MacroExecuteMessage = {
    id: generateMessageId(),
    timestamp: Date.now(),
    role: 'user',
    type: 'macro_execute',
    content,
    macroId,
    macroName,
    macroIcon,
    macroColor,
  };

  this.stmtInsert.run(this._messageToRow(sessionId, msg));
  return this.getMessages(sessionId);
}
```

---

## Task 11: Client — macroStore (파일 리네임 + 코드)

**Files:**
- Rename: `client/src/stores/commandStore.ts` → `client/src/stores/macroStore.ts`

**Step 1: git mv**

```bash
cd packages/client
git mv src/stores/commandStore.ts src/stores/macroStore.ts
```

**Step 2: 전면 리네임**

```typescript
export interface MacroItem {
  id: number;
  name: string;
  icon: string | null;
  color: string | null;
  content: string;
}

export interface MacroDelta {
  added?: { macro: MacroItem; workspaceIds: (number | null)[] }[];
  removed?: number[];
  updated?: MacroItem[];
}

interface MacroState {
  macrosByWorkspace: Map<number, MacroItem[]>;
  setWorkspaceMacros: (workspaceId: number, macros: MacroItem[]) => void;
  getMacrosForWorkspace: (workspaceId: number) => MacroItem[];
  reorderMacros: (workspaceId: number, macroIds: number[]) => void;
  applyDelta: (delta: MacroDelta) => void;
  reset: () => void;
}

export const useMacroStore = create<MacroState>((set, get) => ({
  macrosByWorkspace: new Map(),
  // ... 내부 변수: commands → macros, command → macro, CommandItem → MacroItem
  // 한글 주석: 커맨드 → 매크로
}));
```

주의: `MacroDelta.added` 의 `command` 필드 → `macro` 변경. 이에 따라 `applyDelta` 내 destructuring도 `{ macro, workspaceIds }` 로 변경.

---

## Task 12: Client — MacroToolbar (파일 리네임 + 코드)

**Files:**
- Rename: `client/src/components/chat/CommandToolbar.tsx` → `MacroToolbar.tsx`

**Step 1: git mv**

```bash
git mv src/components/chat/CommandToolbar.tsx src/components/chat/MacroToolbar.tsx
```

**Step 2: import 변경**

```typescript
import { useMacroStore } from '../../stores/macroStore';
import { executeMacro, macroManageConversation, reorderMacros, unassignMacroFromWorkspace } from '../../services/relaySender';
import type { MacroItem } from '../../stores/macroStore';
```

**Step 3: 컴포넌트/함수 리네임**

| 기존 | 변경 |
|------|------|
| `CommandToolbar` | `MacroToolbar` |
| `CommandToolbarProps` | `MacroToolbarProps` |
| `SortableCommandButton` | `SortableMacroButton` |
| `CommandIcon` | `MacroIcon` |
| `commands` (state/변수) | `macros` |
| `command` (개별 아이템) | `macro` |
| `executeCommand` | `executeMacro` |
| `commandManageConversation` | `macroManageConversation` |
| `reorderCommands` | `reorderMacros` |
| `unassignCommandFromWorkspace` | `unassignMacroFromWorkspace` |
| `useCommandStore` | `useMacroStore` |
| `getCommandsForWorkspace` | `getMacrosForWorkspace` |
| `command_execute` (임시 메시지 type) | `macro_execute` |
| `commandId`, `commandName`, `commandIcon`, `commandColor` | `macroId`, `macroName`, `macroIcon`, `macroColor` |

---

## Task 13: Client — MacroBubble (파일 리네임 + 코드)

**Files:**
- Rename: `client/src/components/chat/CommandBubble.tsx` → `MacroBubble.tsx`

**Step 1: git mv**

```bash
git mv src/components/chat/CommandBubble.tsx src/components/chat/MacroBubble.tsx
```

**Step 2: 리네임**

```typescript
interface MacroBubbleProps {
  macroName: string;
  macroIcon: string | null;
  macroColor: string | null;
  content: string;
}

export function MacroBubble({ macroName, macroIcon, macroColor, content }: MacroBubbleProps) {
  // ... 내부에서:
  // commandIcon → macroIcon
  // commandColor → macroColor
  // commandName → macroName
}
```

---

## Task 14: Client — relaySender.ts

**Files:**
- Modify: `client/src/services/relaySender.ts`

**Step 1: 함수 리네임 (7개)**

| 기존 (line) | 변경 |
|-------------|------|
| `executeCommand` (621) | `executeMacro` |
| `createCommand` (633) | `createMacro` |
| `updateCommand` (651) | `updateMacro` |
| `deleteCommand` (666) | `deleteMacro` |
| `commandManageConversation` (678) | `macroManageConversation` |
| `reorderCommands` (691) | `reorderMacros` |
| `unassignCommandFromWorkspace` (703) | `unassignMacroFromWorkspace` |

**Step 2: MessageType 상수 변경**

각 함수 내에서:
- `MessageType.COMMAND_EXECUTE` → `MessageType.MACRO_EXECUTE`
- `MessageType.COMMAND_CREATE` → `MessageType.MACRO_CREATE`
- `MessageType.COMMAND_UPDATE` → `MessageType.MACRO_UPDATE`
- `MessageType.COMMAND_DELETE` → `MessageType.MACRO_DELETE`
- `MessageType.COMMAND_MANAGE_CONVERSATION` → `MessageType.MACRO_MANAGE_CONVERSATION`
- `MessageType.COMMAND_REORDER` → `MessageType.MACRO_REORDER`
- `MessageType.COMMAND_ASSIGN` → `MessageType.MACRO_ASSIGN`

**Step 3: payload 필드 변경**

`commandId` → `macroId`, `commandIds` → `macroIds`

**Step 4: 주석 변경**

`커맨드` → `매크로` (모든 JSDoc/주석)

---

## Task 15: Client — useMessageRouter.ts

**Files:**
- Modify: `client/src/hooks/useMessageRouter.ts`

**Step 1: import 변경**

```typescript
import { useMacroStore } from '../stores/macroStore';
import type { MacroDelta } from '../stores/macroStore';
```

**Step 2: onWorkspaceListReceived 내 변경 (line 144~150)**

```typescript
// 각 워크스페이스의 매크로를 macroStore에 저장
if (workspaces) {
  for (const ws of workspaces as any[]) {
    if (ws.workspaceId && ws.macros) {
      useMacroStore.getState().setWorkspaceMacros(ws.workspaceId, ws.macros);
    }
  }
}
```

주의: payload 키가 `ws.commands` → `ws.macros` (pylon.ts의 broadcastWorkspaceList에서 변경한 것과 매칭)

**Step 3: commandExecute → macroExecute (line 929~943)**

```typescript
case 'macroExecute': {
  // ...
  const realMessage: StoreMessage = {
    id: (event.id as string) || `macro-${Date.now()}`,
    role: 'user',
    type: 'macro_execute',
    content: (event.content as string) || '',
    timestamp: (event.timestamp as number) || Date.now(),
    macroId: event.macroId as number,
    macroName: (event.macroName as string) || '',
    macroIcon: (event.macroIcon as string | null) ?? null,
    macroColor: (event.macroColor as string | null) ?? null,
  } as StoreMessage;
```

**Step 4: command_changed → macro_changed 핸들러**

파일 내에 `command_changed` 메시지 핸들러가 있으면 `macro_changed`로 변경.
`CommandDelta` → `MacroDelta` 사용 부분도 변경.

---

## Task 16: Client — MessageBubble.tsx, InputBar.tsx

**Files:**
- Modify: `client/src/components/chat/MessageBubble.tsx`
- Modify: `client/src/components/chat/InputBar.tsx`

**Step 1: MessageBubble.tsx import 변경**

```typescript
import {
  MacroExecuteMessage,
  // ...
} from '@estelle/core';
import { MacroBubble } from './MacroBubble';
```

**Step 2: MessageBubble.tsx command_execute 분기 변경**

```typescript
// macro_execute: 매크로 실행 버블
if (message.type === 'macro_execute') {
  const macroMsg = message as MacroExecuteMessage;
  return (
    <MacroBubble
      macroName={macroMsg.macroName}
      macroIcon={macroMsg.macroIcon}
      macroColor={macroMsg.macroColor}
      content={macroMsg.content}
    />
  );
}
```

**Step 3: InputBar.tsx import 변경**

```typescript
import { MacroToolbar } from './MacroToolbar';
```

JSX에서 `<CommandToolbar` → `<MacroToolbar` 변경.

---

## Task 17: Tests — Pylon 테스트

**Files:**
- Rename: `pylon/tests/stores/command-store.test.ts` → `macro-store.test.ts`

**Step 1: git mv**

```bash
git mv tests/stores/command-store.test.ts tests/stores/macro-store.test.ts
```

**Step 2: 전면 리네임**

```typescript
import { MacroStore } from '../../src/stores/macro-store.js';

describe('MacroStore', () => {
  let store: MacroStore;

  beforeEach(() => {
    store = new MacroStore(':memory:');
  });
  // ...
  // createCommand → createMacro
  // assignCommand → assignMacro
  // getCommands → getMacros
  // deleteCommand → deleteMacro
  // updateCommand → updateMacro
  // reorderCommands → reorderMacros
  // unassignCommand → unassignMacro
  // propagateGlobalCommands → propagateGlobalMacros
  // getAssignedWorkspaceIds (변경 없음)
  // getCommandById → getMacroById
  // getCommandsByWorkspaces → getMacrosByWorkspaces
  // 한글 주석: 커맨드 → 매크로
  // 테스트 설명 문자열: 'command' → 'macro'
});
```

**Step 3: pylon-mcp-server.test.ts 확인**

`notify_command_changed` 참조가 있으면 `notify_macro_changed`로 변경.
`onCommandChanged` → `onMacroChanged` 변경.

---

## Task 18: Tests — Client 테스트

**Files:**
- Rename: `client/src/stores/commandStore.test.ts` → `macroStore.test.ts`

**Step 1: git mv**

```bash
git mv src/stores/commandStore.test.ts src/stores/macroStore.test.ts
```

**Step 2: 전면 리네임**

```typescript
import { useMacroStore } from './macroStore';

describe('macroStore', () => {
  beforeEach(() => {
    useMacroStore.getState().reset();
  });

  // useCommandStore → useMacroStore
  // commandsByWorkspace → macrosByWorkspace
  // setWorkspaceCommands → setWorkspaceMacros
  // getCommandsForWorkspace → getMacrosForWorkspace
  // applyDelta — added의 { command: ... } → { macro: ... }
  // 한글 주석: 커맨드 → 매크로
});
```

---

## Task 19: estelle-master 스킬 문서

**Files:**
- Modify: `.claude/skills/estelle-master/SKILL.md`
- Modify: `.claude/skills/estelle-master/reference/message-types.md`
- Modify: `.claude/skills/estelle-master/reference/data-flow.md`
- Modify: `.claude/skills/estelle-master/reference/mcp-tools.md`

**Step 1: SKILL.md**

| 기존 | 변경 |
|------|------|
| `command-store.ts` | `macro-store.ts` |
| `CommandStore` | `MacroStore` |
| `커맨드 CRUD (SQLite)` | `매크로 CRUD (SQLite)` |
| `commandStore.ts` | `macroStore.ts` |
| `커맨드 목록 (Zustand)` | `매크로 목록 (Zustand)` |
| `커맨드 포함` | `매크로 포함` |
| `CommandToolbar.tsx` | `MacroToolbar.tsx` |
| `커맨드 툴바` | `매크로 툴바` |
| `Command 도구 7개` | `Macro 도구 7개` |
| `tools/command.ts` | `tools/macro.ts` |
| `Command MCP 도구 (7개)` | `Macro MCP 도구 (7개)` |
| `commandExecute` → `macroExecute` |
| `Command 메시지` → `Macro 메시지` |
| `COMMAND_EXECUTE, COMMAND_REORDER 등` → `MACRO_EXECUTE, MACRO_REORDER 등` |

**Step 2: reference/message-types.md**

- Section 14 제목: `Command (커맨드 툴바)` → `Macro (매크로 툴바)`
- 모든 `COMMAND_*` → `MACRO_*`
- `command_*` → `macro_*` (메시지 타입 문자열)
- `commandExecute` → `macroExecute` (Claude Event 서브타입)
- `커맨드` → `매크로` (설명)
- `command` → `macro` (delta 구조 내 필드)

**Step 3: reference/data-flow.md**

- Section 14 제목: `Command 관리` → `Macro 관리`
- `command_execute` → `macro_execute`
- `commandExecute` → `macroExecute`
- `CommandStore` → `MacroStore`
- `CommandToolbar` → `MacroToolbar`
- `commandStore` → `macroStore`
- `커맨드` → `매크로`

**Step 4: reference/mcp-tools.md**

- 도구 목록: `커맨드 (7): create/update/delete/list/get/assign/unassign_command` → `매크로 (7): create/update/delete/list/get/assign/unassign_macro`
- 7개 도구 섹션: tool name, description, 파라미터(commandId → macroId) 모두 변경
- `CommandStore` → `MacroStore`
- `커맨드` → `매크로`

---

## Task 20: 검증 및 커밋

**Step 1: TypeScript 타입 체크**

```bash
pnpm typecheck
```

Expected: 에러 없음

**Step 2: 전체 테스트 실행**

```bash
pnpm test
```

Expected: 전체 통과 (기존 테스트 수와 동일)

**Step 3: 잔여 command 참조 확인**

```bash
# 코드 파일에서 'command' 검색 (예외 제외)
rg -i "command" --type ts --type tsx -g '!docs/plans/*' -g '!*.test.*' | grep -vi "slash" | grep -vi "SlashCommand" | grep -vi "claude_control" | grep -vi "node_modules"
```

예외적으로 남아야 하는 것:
- `SlashCommand` / `slashCommand` 관련
- `claude_control` 관련
- DB SQL 내 테이블명 (`commands`, `command_assignments`)
- `_rowToMessage`의 backward compat `case 'command_execute':`

**Step 4: 커밋**

```bash
git add -A
git commit -m "refactor: rename command to macro across entire codebase

All references to 'command' (toolbar macro feature) renamed to 'macro':
- MCP tools: create/update/delete/list/get/assign/unassign_macro
- Message types: MACRO_EXECUTE, MACRO_CREATE, etc.
- Stores: MacroStore (pylon), useMacroStore (client)
- Components: MacroToolbar, MacroBubble
- 7 file renames, 9 message type renames, 14+ type renames
- estelle-master skill docs updated
- Backward compat maintained for old command_execute DB records"
```
