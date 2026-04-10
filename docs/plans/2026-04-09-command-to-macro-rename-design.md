# Command → Macro 전면 리네임 설계

## 목적

"커맨드"라는 이름이 일반적인 프로그래밍 용어(CLI command, slash command 등)와 혼동을 일으키므로, Estelle의 매크로 툴바 기능 전체를 "매크로(macro)"로 리네임한다.

## 접근 방식

**빅뱅 리네임** — 모든 패키지(core, pylon, client)와 문서를 한 번에 변경하고 단일 커밋으로 반영한다. monorepo 내 타입 공유 특성상 점진적 변경은 중간 빌드 실패를 유발하므로 한 번에 진행한다.

## 네이밍 규칙

케이스를 유지하며 1:1 치환:

| 기존 | 변경 |
|------|------|
| `command` | `macro` |
| `Command` | `Macro` |
| `COMMAND` | `MACRO` |
| `commands` | `macros` |
| `커맨드` | `매크로` |

### 예외 (변경하지 않음)

- `SlashCommand` / `slashCommand` / `getSessionSlashCommands` — 에디터 슬래시 커맨드, 별개 기능
- `claude_control` 메시지 내부 명령어
- git 히스토리 커밋 메시지

## 변경 대상

### 1. 파일 리네임 (7개)

| 기존 | 변경 |
|------|------|
| `pylon/src/mcp/tools/command.ts` | `macro.ts` |
| `pylon/src/stores/command-store.ts` | `macro-store.ts` |
| `pylon/tests/stores/command-store.test.ts` | `macro-store.test.ts` |
| `client/src/stores/commandStore.ts` | `macroStore.ts` |
| `client/src/stores/commandStore.test.ts` | `macroStore.test.ts` |
| `client/src/components/chat/CommandToolbar.tsx` | `MacroToolbar.tsx` |
| `client/src/components/chat/CommandBubble.tsx` | `MacroBubble.tsx` |

### 2. MCP 도구 이름 (7개)

`create_command` → `create_macro`, `update_command` → `update_macro`, `delete_command` → `delete_macro`, `list_commands` → `list_macros`, `get_command` → `get_macro`, `assign_command` → `assign_macro`, `unassign_command` → `unassign_macro`

### 3. 메시지 타입 상수 (9개, core)

`COMMAND_EXECUTE` → `MACRO_EXECUTE`, `COMMAND_CREATE` → `MACRO_CREATE`, `COMMAND_CREATE_RESULT` → `MACRO_CREATE_RESULT`, `COMMAND_UPDATE` → `MACRO_UPDATE`, `COMMAND_DELETE` → `MACRO_DELETE`, `COMMAND_ASSIGN` → `MACRO_ASSIGN`, `COMMAND_CHANGED` → `MACRO_CHANGED`, `COMMAND_REORDER` → `MACRO_REORDER`, `COMMAND_MANAGE_CONVERSATION` → `MACRO_MANAGE_CONVERSATION`

문자열 값도 변경: `'command_execute'` → `'macro_execute'` 등

### 4. DB 테이블 (2개)

- `commands` → `macros`
- `command_assignments` → `macro_assignments`

CommandStore 내 SQL 문에서 테이블명 변경. 기존 DB 파일(`commands.db`)은 `macros.db`로 리네임하거나, 파일명은 유지하고 테이블명만 변경. (DB 파일명도 `macros.db`로 변경 권장)

### 5. 타입/인터페이스/클래스

- `CommandStore` → `MacroStore`
- `CommandListItem` → `MacroListItem`
- `CommandItem` → `MacroItem`
- `CommandDelta` → `MacroDelta`
- `useCommandStore` → `useMacroStore`
- `CommandToolbar` → `MacroToolbar`
- `CommandBubble` → `MacroBubble`
- `CommandIcon` → `MacroIcon`
- `SortableCommandButton` → `SortableMacroButton`
- `CommandExecuteMessage` → `MacroExecuteMessage`
- `isCommandExecuteMessage` → `isMacroExecuteMessage`
- `CommandChangedDelta` → `MacroChangedDelta`
- `NotifyCommandChangedResult` → `NotifyMacroChangedResult`
- `onCommandChanged` → `onMacroChanged`

### 6. 함수명 (relaySender 등)

- `executeCommand()` → `executeMacro()`
- `createCommand()` → `createMacro()`
- `updateCommand()` → `updateMacro()`
- `deleteCommand()` → `deleteMacro()`
- `commandManageConversation()` → `macroManageConversation()`
- `reorderCommands()` → `reorderMacros()`
- `unassignCommandFromWorkspace()` → `unassignMacroFromWorkspace()`
- `notifyCommandChanged()` → `notifyMacroChanged()`

### 7. PylonClient / PylonMcpServer

- `PylonRequest.action` 유니온: `'notify_command_changed'` → `'notify_macro_changed'`
- `McpNotifyCommandChangedSuccessResponse` → `McpNotifyMacroChangedSuccessResponse`
- `_handleCommandChanged()` → `_handleMacroChanged()`
- `_onCommandChanged` → `_onMacroChanged`

### 8. 스킬 문서 (estelle-master)

- `SKILL.md` — command-store → macro-store, 커맨드 → 매크로 등
- `reference/message-types.md` — Command 섹션 → Macro 섹션
- `reference/data-flow.md` — Command 관리 → Macro 관리
- `reference/mcp-tools.md` — 7개 커맨드 도구 → 매크로 도구

## 검증

- `pnpm test` 전체 통과
- `pnpm typecheck` 통과
- grep으로 잔여 `command` 참조 확인 (SlashCommand 등 예외 제외)
