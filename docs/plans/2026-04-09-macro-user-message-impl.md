# Macro User Message & Execution Guard Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 매크로 실행 시 입력창 텍스트를 함께 전송하고, 응답 중 매크로 실행을 차단하는 기능 구현.

**Architecture:** `MacroExecuteMessage` 타입에 `userMessage` 옵셔널 필드를 추가하고, 클라이언트 MacroToolbar → relaySender → Pylon handler → message-store 순서로 파이프라인을 확장. 응답 중 차단은 MacroToolbar에 `disabled` prop을 전달하여 처리.

**Tech Stack:** TypeScript, React, Zustand, SQLite (better-sqlite3)

---

### Task 1: Core 타입 확장 — MacroExecuteMessage에 userMessage 추가

**Files:**
- Modify: `packages/core/src/types/store-message.ts:356-377`

**Step 1: MacroExecuteMessage에 userMessage 필드 추가**

`packages/core/src/types/store-message.ts`의 `MacroExecuteMessage` 인터페이스에 옵셔널 필드를 추가:

```typescript
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

  /** 유저 추가 메시지 (선택적) */
  userMessage?: string;
}
```

**Step 2: 빌드 확인**

Run: `cd /home/estelle/estelle2 && pnpm build --filter @estelle/core`
Expected: 성공 (옵셔널 필드 추가라 기존 코드 영향 없음)

**Step 3: 커밋**

```bash
git add packages/core/src/types/store-message.ts
git commit -m "feat(core): add userMessage field to MacroExecuteMessage"
```

---

### Task 2: relaySender — executeMacro에 userMessage 파라미터 추가

**Files:**
- Modify: `packages/client/src/services/relaySender.ts:621-628`

**Step 1: executeMacro 함수 시그니처 확장**

```typescript
export function executeMacro(macroId: number, conversationId: number, userMessage?: string): boolean {
  const pylonId = getPylonIdFromConversation(conversationId);
  return sendMessage({
    type: MessageType.MACRO_EXECUTE,
    payload: { macroId, conversationId, ...(userMessage ? { userMessage } : {}) },
    to: [pylonId],
  });
}
```

**Step 2: 빌드 확인**

Run: `cd /home/estelle/estelle2 && pnpm build --filter @estelle/client`
Expected: 성공 (옵셔널 파라미터 추가라 기존 호출부 영향 없음)

**Step 3: 커밋**

```bash
git add packages/client/src/services/relaySender.ts
git commit -m "feat(client): add userMessage param to executeMacro"
```

---

### Task 3: MacroToolbar — 입력창 텍스트 가져오기 + disabled prop

**Files:**
- Modify: `packages/client/src/components/chat/MacroToolbar.tsx:26-29, 209-247, 305-396`
- Modify: `packages/client/src/components/chat/InputBar.tsx:392-396`

**Step 1: MacroToolbar props 확장**

`MacroToolbarProps` 인터페이스에 3개 prop 추가:

```typescript
interface MacroToolbarProps {
  conversationId: number | null;
  workspaceId: number | null;
  disabled?: boolean;
  getText?: () => string;
  clearText?: () => void;
}
```

컴포넌트 시그니처도 업데이트:

```typescript
export function MacroToolbar({ conversationId, workspaceId, disabled = false, getText, clearText }: MacroToolbarProps) {
```

**Step 2: handleMacroClick에서 userMessage 전달 + 텍스트 비우기**

`handleMacroClick` 콜백에서 실행 부분(line 217-240)을 수정:

```typescript
if (selectedId === macroId) {
  // 선택된 버튼 클릭 → 실행 후 선택 해제
  if (conversationId == null || disabled) return;

  const userMessage = getText?.()?.trim() || undefined;

  const macro = macros.find((c) => c.id === macroId);
  if (macro) {
    // optimistic update: macro_execute 임시 메시지 추가
    const tempMessage = {
      id: `macro-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
      role: 'user' as const,
      type: 'macro_execute' as const,
      content: macro.content,
      timestamp: Date.now(),
      macroId: macro.id,
      macroName: macro.name,
      macroIcon: macro.icon,
      macroColor: macro.color,
      userMessage,
      temporary: true,
    } as StoreMessage;
    useConversationStore.getState().addMessage(conversationId, tempMessage);
  }

  executeMacro(macroId, conversationId, userMessage);
  if (userMessage) clearText?.();
  setSelectedId(null);
}
```

`handleMacroClick`의 deps 배열에 `disabled`, `getText`, `clearText` 추가:

```typescript
[selectedId, conversationId, macros, isEditMode, disabled, getText, clearText]
```

**Step 3: disabled 상태에서 매크로 선택도 차단**

`handleMacroClick` 최상단에 disabled 가드 추가:

```typescript
const handleMacroClick = useCallback(
  (macroId: number) => {
    if (disabled) return;

    if (isEditMode) {
      // ...existing
```

`handleAddClick`에도 동일하게:

```typescript
const handleAddClick = useCallback(() => {
  if (disabled) return;
  // ...existing
```

**Step 4: 툴바 UI에 disabled 시각 처리**

최외곽 `<div>`에 조건부 opacity 추가:

```tsx
<div
  className={`relative px-3 py-1.5 w-fit overflow-hidden rounded-md${disabled ? ' opacity-50 pointer-events-none' : ''}`}
  ref={toolbarRef}
  onPointerDown={handleToolbarPointerDown}
  onPointerUp={handleToolbarPointerUp}
  onPointerLeave={handleToolbarPointerUp}
>
```

**Step 5: InputBar에서 props 전달**

`InputBar.tsx`의 MacroToolbar 렌더링 부분(line 393-396)을 수정:

```tsx
<MacroToolbar
  conversationId={conversationId}
  workspaceId={selectedConversation?.workspaceId ? parseInt(selectedConversation.workspaceId, 10) : null}
  disabled={isWorking}
  getText={() => text}
  clearText={() => setText('')}
/>
```

**Step 6: 빌드 확인**

Run: `cd /home/estelle/estelle2 && pnpm build --filter @estelle/client`
Expected: 성공

**Step 7: 커밋**

```bash
git add packages/client/src/components/chat/MacroToolbar.tsx packages/client/src/components/chat/InputBar.tsx
git commit -m "feat(client): pass user message with macro execution and disable during streaming"
```

---

### Task 4: Pylon — handleMacroExecute에서 userMessage 처리

**Files:**
- Modify: `packages/pylon/src/pylon.ts:3701-3781`

**Step 1: payload에서 userMessage 추출**

`handleMacroExecute` 메서드 상단에 추가:

```typescript
const macroId = payload?.macroId as number;
const conversationId = payload?.conversationId as number;
const userMessage = (payload?.userMessage as string | undefined)?.trim() || undefined;
```

**Step 2: 메시지 합성 함수**

Claude에 전달할 메시지를 합성:

```typescript
const messageToSend = userMessage
  ? `[Macro: ${macro.name}]\n${macro.content}\n\n[User Message]\n${userMessage}`
  : macro.content;
```

**Step 3: messageStore 호출에 userMessage 전달**

```typescript
this.deps.messageStore.addMacroExecuteMessage(
  conversationId,
  messageToSend,
  macro.id,
  macro.name,
  macro.icon,
  macro.color,
  userMessage,
);
```

**Step 4: claude_event 브로드캐스트에 userMessage 포함**

```typescript
this.send({
  type: 'claude_event',
  payload: {
    conversationId,
    event: {
      type: 'macroExecute',
      content: macro.content,
      timestamp: Date.now(),
      macroId: macro.id,
      macroName: macro.name,
      macroIcon: macro.icon,
      macroColor: macro.color,
      userMessage,
    },
  },
  broadcast: 'clients',
});
```

**Step 5: agentManager.sendMessage에 합성 메시지 전달**

```typescript
this.deps.agentManager.sendMessage(conversationId, messageToSend, {
  workingDir,
  agentSessionId,
  systemPrompt,
  systemReminder,
});
```

**Step 6: 빌드 확인**

Run: `cd /home/estelle/estelle2 && pnpm build --filter @estelle/pylon`
Expected: 성공 (message-store 변경 전이므로 Task 5 이후에 최종 확인)

**Step 7: 커밋**

```bash
git add packages/pylon/src/pylon.ts
git commit -m "feat(pylon): handle userMessage in macro execution"
```

---

### Task 5: message-store — addMacroExecuteMessage에 userMessage 추가

**Files:**
- Modify: `packages/pylon/src/stores/message-store.ts:1077-1099`

**Step 1: 함수 시그니처에 userMessage 파라미터 추가**

```typescript
addMacroExecuteMessage(
  sessionId: number,
  content: string,
  macroId: number,
  macroName: string,
  macroIcon: string | null,
  macroColor: string | null,
  userMessage?: string,
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
    ...(userMessage ? { userMessage } : {}),
  };

  this.stmtInsert.run(this._messageToRow(sessionId, msg));
  return this.getMessages(sessionId);
}
```

**Step 2: 전체 빌드 확인**

Run: `cd /home/estelle/estelle2 && pnpm build`
Expected: 성공

**Step 3: 커밋**

```bash
git add packages/pylon/src/stores/message-store.ts
git commit -m "feat(pylon): store userMessage in macro execute messages"
```

---

### Task 6: 전체 빌드 및 동작 확인

**Step 1: 전체 빌드**

Run: `cd /home/estelle/estelle2 && pnpm build`
Expected: 모든 패키지 빌드 성공

**Step 2: 타입 체크**

Run: `cd /home/estelle/estelle2 && pnpm typecheck` (또는 `tsc --noEmit`)
Expected: 타입 에러 없음

**Step 3: 최종 커밋 (필요 시)**

빌드 과정에서 수정이 필요했다면 추가 커밋.
