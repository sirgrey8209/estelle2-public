# 대화 삭제 기능 개선 설계

## 요약

대화 삭제의 두 경로(Client UI / MCP 도구)가 서로 다른 정리 로직을 실행하는 문제를 해결한다. Agent 세션 정리 누락을 수정하고, MCP 경로가 기존 Pylon 핸들러를 재사용하도록 통일한다.

## 문제

1. **Agent 세션 정리 누락**: `handleConversationDelete()`에서 `agentManager.stop()`이 호출되지 않아 메모리 누수 발생
2. **경로 불일치**: MCP 도구 경로는 `workspaceStore.deleteConversation()`만 직접 호출하여 widget 취소, 메시지 정리, agent 정리를 모두 우회

## 현재 흐름

```
Client UI 경로:
  ChatHeader.handleDelete()
  → relaySender.deleteConversation() — CONVERSATION_DELETE 메시지 전송
  → Pylon.handleConversationDelete()
    → cancelWidgetForConversation()
    → clearMessagesForConversation()
    → workspaceStore.deleteConversation()
    → broadcastWorkspaceList()
    → saveWorkspaceStore()

MCP 도구 경로:
  _handleDeleteConversation()
  → workspaceStore.deleteConversation()  ← 직접 호출, 나머지 정리 우회
  → _onChange()  ← broadcastWorkspaceList만 호출
```

## 설계

### 아키텍처 제약

- `handleConversationDelete()`는 Pylon의 **private** 메서드
- PylonMcpServer는 Pylon 인스턴스를 모름 — `workspaceStore`와 콜백만 보유
- 기존 패턴: PylonMcpServer는 `onChange`, `onWidgetRender` 등 콜백으로 Pylon에 위임

### 변경 후 흐름

```
Client UI 경로 (기존 유지):
  CONVERSATION_DELETE 메시지 → Pylon.handleConversationDelete()

MCP 도구 경로 (변경):
  _handleDeleteConversation()
    1. target 검색/검증 (기존 유지)
    2. 현재 대화 삭제 차단 (기존 유지)
    3. this._onConversationDelete(targetConversationId)  ← 콜백 호출

Pylon.handleConversationDelete() (보강):
    1. agentManager.stop(eid)            ← 추가
    2. cancelWidgetForConversation()      (기존)
    3. clearMessagesForConversation()     (기존)
    4. workspaceStore.deleteConversation() (기존)
    5. broadcastWorkspaceList()           (기존)
    6. saveWorkspaceStore()              (기존)
```

### 변경 파일

| 파일 | 변경 |
|------|------|
| `packages/pylon/src/pylon.ts` | `handleConversationDelete()`에 `agentManager.stop()` 추가, 반환 타입 `boolean`으로 변경 |
| `packages/pylon/src/servers/pylon-mcp-server.ts` | `PylonMcpServerOptions`에 `onConversationDelete` 콜백 추가, `_handleDeleteConversation()`에서 콜백 호출 |
| `packages/pylon/src/bin.ts` | 콜백 연결 |

### 에러 처리

- Agent 세션이 없는 경우: `hasActiveSession()` 체크 후 조건부 호출
- `agentManager.stop()` 실패: try-catch로 감싸고 로그만 남김 — 삭제 자체를 중단하지 않음
- 콜백 시그니처: `(conversationId: ConversationId) => boolean` — 성공 여부를 MCP 응답에 반영

### 테스트

- `message-cleanup.test.ts`에 agent cleanup 검증 추가
- `workspace-store.test.ts`는 store 레벨 변경 없으므로 기존 유지
