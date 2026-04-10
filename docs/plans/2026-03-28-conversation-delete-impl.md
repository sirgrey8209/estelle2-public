# 대화 삭제 기능 개선 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 대화 삭제의 두 경로(Client UI / MCP 도구)를 통일하고, 누락된 Agent 세션 정리를 추가한다.

**Architecture:** MCP 도구 경로가 Pylon의 `handleConversationDelete()` 핸들러를 `triggerConversationDelete()` wrapper를 통해 콜백으로 재사용하도록 변경한다. Agent 세션 정리는 이 핸들러 한 곳에만 추가하면 두 경로 모두 적용된다. `handleWorkspaceDelete()`에도 동일한 agent/widget 정리를 추가한다.

**Tech Stack:** TypeScript, Vitest

---

### Task 1: handleConversationDelete에 Agent 세션 정리 추가

**Files:**
- Modify: `packages/pylon/src/pylon.ts:2027-2046`
- Test: `packages/pylon/tests/message-cleanup.test.ts`

**Step 1: 실패하는 테스트 작성**

`packages/pylon/tests/message-cleanup.test.ts`의 `handleConversationDelete - 메시지 삭제` describe 블록 안, 마지막 테스트 뒤에 추가:

```typescript
    it('should_stop_agent_session_when_conversation_deleted', () => {
      // Arrange: 워크스페이스와 대화 생성, agent 세션 활성화
      const { workspace } = deps.workspaceStore.createWorkspace('Test', 'C:\\test');
      const conversation = deps.workspaceStore.createConversation(workspace.workspaceId, 'Conv1')!;
      (deps.agentManager.hasActiveSession as ReturnType<typeof vi.fn>).mockReturnValue(true);

      // Act: 대화 삭제
      pylon.handleMessage({
        type: 'conversation_delete',
        from: { deviceId: 'client-1' },
        payload: { conversationId: conversation.conversationId },
      });

      // Assert: agentManager.stop이 호출되어야 함
      expect(deps.agentManager.stop).toHaveBeenCalledWith(conversation.conversationId);
    });

    it('should_not_call_agent_stop_when_no_active_session', () => {
      // Arrange: 워크스페이스와 대화 생성, agent 세션 없음
      const { workspace } = deps.workspaceStore.createWorkspace('Test', 'C:\\test');
      const conversation = deps.workspaceStore.createConversation(workspace.workspaceId, 'Conv1')!;
      (deps.agentManager.hasActiveSession as ReturnType<typeof vi.fn>).mockReturnValue(false);

      // Act: 대화 삭제
      pylon.handleMessage({
        type: 'conversation_delete',
        from: { deviceId: 'client-1' },
        payload: { conversationId: conversation.conversationId },
      });

      // Assert: agentManager.stop이 호출되지 않아야 함
      expect(deps.agentManager.stop).not.toHaveBeenCalled();
    });

    it('should_continue_deletion_even_if_agent_stop_throws', () => {
      // Arrange: agent stop이 에러를 던지도록 설정
      const { workspace } = deps.workspaceStore.createWorkspace('Test', 'C:\\test');
      const conversation = deps.workspaceStore.createConversation(workspace.workspaceId, 'Conv1')!;
      (deps.agentManager.hasActiveSession as ReturnType<typeof vi.fn>).mockReturnValue(true);
      (deps.agentManager.stop as ReturnType<typeof vi.fn>).mockImplementation(() => { throw new Error('stop failed'); });

      // Act: 대화 삭제
      pylon.handleMessage({
        type: 'conversation_delete',
        from: { deviceId: 'client-1' },
        payload: { conversationId: conversation.conversationId },
      });

      // Assert: agent stop 실패에도 불구하고 대화는 삭제되어야 함
      expect(deps.workspaceStore.getConversation(conversation.conversationId)).toBeUndefined();
    });
```

**Step 2: 테스트 실행 — 실패 확인**

Run: `cd /home/estelle/estelle2 && npx vitest run packages/pylon/tests/message-cleanup.test.ts`
Expected: 첫 번째, 세 번째 테스트 FAIL

**Step 3: 구현**

`packages/pylon/src/pylon.ts`의 `handleConversationDelete` 메서드를 다음으로 교체 (line 2027-2046):

기존:
```typescript
  private handleConversationDelete(payload: Record<string, unknown> | undefined): void {
    const { conversationId } = payload || {};
    if (!conversationId) return;

    const eid = conversationId as ConversationId;

    // 위젯 정리 (있으면)
    this.deps.mcpServer?.cancelWidgetForConversation(conversationId as number);

    // 삭제 전에 메시지 정리
    this.clearMessagesForConversation(eid);

    const success = this.deps.workspaceStore.deleteConversation(eid);
    if (success) {
      this.broadcastWorkspaceList();
      this.saveWorkspaceStore().catch((err) => {
        this.deps.logger.error(`[Pylon] Failed to save after conversation delete: ${err}`);
      });
    }
  }
```

변경:
```typescript
  private handleConversationDelete(payload: Record<string, unknown> | undefined): boolean {
    const { conversationId } = payload || {};
    if (!conversationId) return false;

    const eid = conversationId as ConversationId;

    // Agent 세션 정리 (있으면)
    try {
      if (this.deps.agentManager.hasActiveSession(eid)) {
        this.deps.agentManager.stop(eid);
      }
    } catch (err) {
      this.deps.logger.error(`[Pylon] Failed to stop agent session on delete: ${err}`);
    }

    // 위젯 정리 (있으면)
    this.deps.mcpServer?.cancelWidgetForConversation(conversationId as number);

    // 삭제 전에 메시지 정리
    this.clearMessagesForConversation(eid);

    const success = this.deps.workspaceStore.deleteConversation(eid);
    if (success) {
      this.broadcastWorkspaceList();
      this.saveWorkspaceStore().catch((err) => {
        this.deps.logger.error(`[Pylon] Failed to save after conversation delete: ${err}`);
      });
    }
    return success;
  }
```

**Step 4: 테스트 실행 — 통과 확인**

Run: `cd /home/estelle/estelle2 && npx vitest run packages/pylon/tests/message-cleanup.test.ts`
Expected: ALL PASS

**Step 5: 커밋**

```bash
git add packages/pylon/src/pylon.ts packages/pylon/tests/message-cleanup.test.ts
git commit -m "fix: stop agent session on conversation delete"
```

---

### Task 2: handleWorkspaceDelete에 Agent/Widget 정리 추가

**Files:**
- Modify: `packages/pylon/src/pylon.ts:1843-1872`
- Test: `packages/pylon/tests/message-cleanup.test.ts`

**Step 1: 실패하는 테스트 작성**

`packages/pylon/tests/message-cleanup.test.ts`의 `handleWorkspaceDelete - 메시지 삭제` describe 블록 안, 마지막 테스트 뒤에 추가:

```typescript
    it('should_stop_agent_sessions_for_all_conversations_when_workspace_deleted', async () => {
      // Arrange: 워크스페이스와 여러 대화 생성
      const { workspace } = deps.workspaceStore.createWorkspace('Test', 'C:\\test');
      const conv1 = deps.workspaceStore.createConversation(workspace.workspaceId, 'Conv1')!;
      const conv2 = deps.workspaceStore.createConversation(workspace.workspaceId, 'Conv2')!;
      (deps.agentManager.hasActiveSession as ReturnType<typeof vi.fn>).mockReturnValue(true);

      // Act: 워크스페이스 삭제
      pylon.handleMessage({
        type: 'workspace_delete',
        from: { deviceId: 'client-1' },
        payload: { workspaceId: workspace.workspaceId },
      });

      // Assert: 모든 대화의 agent 세션이 정리되어야 함
      expect(deps.agentManager.stop).toHaveBeenCalledWith(conv1.conversationId);
      expect(deps.agentManager.stop).toHaveBeenCalledWith(conv2.conversationId);
    });
```

**Step 2: 테스트 실행 — 실패 확인**

Run: `cd /home/estelle/estelle2 && npx vitest run packages/pylon/tests/message-cleanup.test.ts`
Expected: FAIL (`stop`이 호출되지 않음)

**Step 3: 구현**

`packages/pylon/src/pylon.ts`의 `handleWorkspaceDelete` 메서드에서 for 루프를 변경 (line 1852-1855):

기존:
```typescript
    if (workspace) {
      for (const conv of workspace.conversations) {
        this.clearMessagesForConversation(conv.conversationId);
      }
    }
```

변경:
```typescript
    if (workspace) {
      for (const conv of workspace.conversations) {
        // Agent 세션 정리
        try {
          if (this.deps.agentManager.hasActiveSession(conv.conversationId)) {
            this.deps.agentManager.stop(conv.conversationId);
          }
        } catch (err) {
          this.deps.logger.error(`[Pylon] Failed to stop agent on workspace delete: ${err}`);
        }
        // 위젯 정리
        this.deps.mcpServer?.cancelWidgetForConversation(conv.conversationId);
        // 메시지 정리
        this.clearMessagesForConversation(conv.conversationId);
      }
    }
```

**Step 4: 테스트 실행 — 통과 확인**

Run: `cd /home/estelle/estelle2 && npx vitest run packages/pylon/tests/message-cleanup.test.ts`
Expected: ALL PASS

**Step 5: 커밋**

```bash
git add packages/pylon/src/pylon.ts packages/pylon/tests/message-cleanup.test.ts
git commit -m "fix: stop agent sessions and cancel widgets on workspace delete"
```

---

### Task 3: triggerConversationDelete public wrapper 추가

**Files:**
- Modify: `packages/pylon/src/pylon.ts` (line 673 부근, `triggerClaudeSend` 뒤)

**Step 1: public wrapper 메서드 추가**

`packages/pylon/src/pylon.ts`에서 `triggerClaudeSend` 메서드 뒤에 추가 (line 674 뒤):

```typescript
  /**
   * 대화 삭제 트리거 (외부에서 호출 가능)
   *
   * @description
   * MCP delete_conversation 등에서 대화 삭제를 요청할 때 호출합니다.
   * agent 정리, widget 정리, 메시지 정리, store 삭제를 모두 수행합니다.
   */
  triggerConversationDelete(conversationId: number): boolean {
    return this.handleConversationDelete({ conversationId });
  }
```

**Step 2: 테스트 실행**

Run: `cd /home/estelle/estelle2 && npx vitest run packages/pylon/tests/message-cleanup.test.ts`
Expected: ALL PASS (기존 동작 변경 없음)

**Step 3: 커밋**

```bash
git add packages/pylon/src/pylon.ts
git commit -m "feat: add triggerConversationDelete public wrapper"
```

---

### Task 4: PylonMcpServer에 onConversationDelete 콜백 추가

**Files:**
- Modify: `packages/pylon/src/servers/pylon-mcp-server.ts:101-124` (옵션 인터페이스)
- Modify: `packages/pylon/src/servers/pylon-mcp-server.ts:355-392` (private 필드)
- Modify: `packages/pylon/src/servers/pylon-mcp-server.ts:398-419` (생성자)

**Step 1: PylonMcpServerOptions에 콜백 타입 추가**

`packages/pylon/src/servers/pylon-mcp-server.ts`의 `PylonMcpServerOptions` 인터페이스에 추가 (line 114, `onConversationCreate` 뒤):

```typescript
  /** 대화 삭제 시 호출되는 콜백 (delete_conversation 성공 시) */
  onConversationDelete?: (conversationId: number) => boolean;
```

**Step 2: private 필드 추가**

`packages/pylon/src/servers/pylon-mcp-server.ts`의 private 필드 영역에 추가 (line 372, `_onContinueTask` 뒤):

```typescript
  private _onConversationDelete?: (conversationId: number) => boolean;
```

**Step 3: 생성자에서 할당**

`packages/pylon/src/servers/pylon-mcp-server.ts`의 생성자에서 추가 (line 410, `_onContinueTask` 할당 뒤):

```typescript
    this._onConversationDelete = options?.onConversationDelete;
```

**Step 4: 테스트 실행 — 기존 테스트 깨지지 않는지 확인**

Run: `cd /home/estelle/estelle2 && npx vitest run packages/pylon/tests/`
Expected: ALL PASS (기존 동작 변경 없음)

**Step 5: 커밋**

```bash
git add packages/pylon/src/servers/pylon-mcp-server.ts
git commit -m "feat: add onConversationDelete callback to PylonMcpServer"
```

---

### Task 5: _handleDeleteConversation에서 콜백 사용

**Files:**
- Modify: `packages/pylon/src/servers/pylon-mcp-server.ts:1476-1492`

**Step 1: _handleDeleteConversation 변경**

`packages/pylon/src/servers/pylon-mcp-server.ts`의 삭제 실행 부분(line 1476-1492)을 다음으로 교체:

기존:
```typescript
    // 삭제 실행
    const success = this._workspaceStore.deleteConversation(targetConversationId);
    if (!success) {
      return {
        success: false,
        error: '대화 삭제에 실패했습니다',
      };
    }

    // 변경 알림
    this._onChange?.();

    return {
      success: true,
      conversation: deletedInfo,
    };
```

변경:
```typescript
    // 삭제 실행 (콜백을 통해 Pylon의 정리 로직을 재사용)
    const success = this._onConversationDelete
      ? this._onConversationDelete(targetConversationId)
      : this._workspaceStore.deleteConversation(targetConversationId);
    if (!success) {
      return {
        success: false,
        error: '대화 삭제에 실패했습니다',
      };
    }

    // 콜백이 없는 경우에만 직접 변경 알림 (콜백 내부에서 broadcast/save 처리)
    if (!this._onConversationDelete) {
      this._onChange?.();
    }

    return {
      success: true,
      conversation: deletedInfo,
    };
```

**Step 2: 테스트 실행**

Run: `cd /home/estelle/estelle2 && npx vitest run packages/pylon/tests/`
Expected: ALL PASS

**Step 3: 커밋**

```bash
git add packages/pylon/src/servers/pylon-mcp-server.ts
git commit -m "refactor: use onConversationDelete callback in MCP delete handler"
```

---

### Task 6: bin.ts에서 콜백 연결

**Files:**
- Modify: `packages/pylon/src/bin.ts:503-568`

**Step 1: 콜백 연결**

`packages/pylon/src/bin.ts`의 PylonMcpServer 생성자 옵션에 추가 (line 514, `onConversationCreate` 콜백 뒤):

```typescript
    onConversationDelete: (conversationId: number) => {
      return pylon.triggerConversationDelete(conversationId);
    },
```

**Step 2: 테스트 실행**

Run: `cd /home/estelle/estelle2 && npx vitest run packages/pylon/tests/`
Expected: ALL PASS

**Step 3: 커밋**

```bash
git add packages/pylon/src/bin.ts
git commit -m "feat: wire conversation delete callback from MCP to Pylon handler"
```

---

### Task 7: 전체 검증

**Step 1: 전체 pylon 테스트 실행**

Run: `cd /home/estelle/estelle2 && npx vitest run packages/pylon/tests/`
Expected: ALL PASS

**Step 2: 타입 체크**

Run: `cd /home/estelle/estelle2 && npx tsc --noEmit -p packages/pylon/tsconfig.json`
Expected: 에러 없음

**Step 3: 최종 커밋 (필요 시)**

변경 사항이 있으면 커밋.
