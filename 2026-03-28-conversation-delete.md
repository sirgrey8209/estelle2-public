# 대화 삭제 기능

## 배경

Estelle v2의 대화(Conversation) 관리 기능 중 삭제에 대한 논의. 현재 대화 삭제는 **MCP 도구**와 **Client UI** 두 경로로 동작하며, 다층적인 리소스 정리와 안전 장치가 구현되어 있다.

## 현재 상태

### 아키텍처 개요

```
삭제 경로 1: Client UI (ChatHeader 삭제 버튼)
  → relaySender.deleteConversation()
  → CONVERSATION_DELETE 메시지 → Pylon.handleConversationDelete()

삭제 경로 2: MCP 도구 (Claude가 호출)
  → delete_conversation tool
  → PylonClient → PylonMcpServer._handleDeleteConversation()
  → WorkspaceStore.deleteConversation()
```

### 삭제 시 정리되는 리소스

| 리소스 | 처리 | 위치 |
|--------|------|------|
| 위젯 프로세스 | `cancelWidgetForConversation()` | Pylon.handleConversationDelete |
| SQLite 메시지 | `messageStore.clear(conversationId)` | Pylon.clearMessagesForConversation |
| 메모리 상태 | `workspaceStore.deleteConversation()` | WorkspaceStore |
| 영속 저장소 | `saveWorkspaceStore()` | Pylon |
| Client 로컬 상태 | `conversationStore.deleteConversation()` | ConversationStore |

### 안전 장치

- **현재 대화 삭제 방지**: MCP 도구에서 `targetConversationId === conversationId` 검사
- **활성 대화 삭제 시 자동 전환**: WorkspaceStore에서 첫 번째 대화로 전환
- **브로드캐스트**: 삭제 후 모든 클라이언트에 workspace 목록 업데이트

### 주요 파일

| 파일 | 역할 |
|------|------|
| `packages/core/src/constants/message-type.ts` | `CONVERSATION_DELETE` 메시지 타입 (line 92) |
| `packages/pylon/src/pylon.ts` | `handleConversationDelete` (line 2024-2046) |
| `packages/pylon/src/stores/workspace-store.ts` | `deleteConversation` 메서드 (line 555-571) |
| `packages/pylon/src/mcp/tools/conversation.ts` | MCP 도구 정의/실행 (line 131-159, 248-263) |
| `packages/pylon/src/servers/pylon-mcp-server.ts` | `_handleDeleteConversation` (line 1394-1492) |
| `packages/client/src/services/relaySender.ts` | `deleteConversation` 전송 (line 205-212) |
| `packages/client/src/components/chat/ChatHeader.tsx` | UI 삭제 핸들러 (line 122-129) |
| `packages/client/src/stores/conversationStore.ts` | 로컬 상태 정리 (line 595-608) |

### 테스트 파일

- `packages/pylon/tests/message-cleanup.test.ts` — 메시지 정리 검증
- `packages/pylon/tests/stores/workspace-store.test.ts` — WorkspaceStore 삭제/ID 재사용 검증

### 두 경로의 차이점

| | Client UI 경로 | MCP 도구 경로 |
|--|---------------|--------------|
| 트리거 | 사용자가 ChatHeader에서 삭제 | Claude가 도구 호출 |
| 대상 식별 | conversationId 직접 전달 | 이름 또는 ID 문자열로 검색 |
| 현재 대화 삭제 | UI에서 별도 제한 없음 (선택된 대화 삭제) | 명시적으로 차단 |
| 로컬 상태 정리 | 즉시 (낙관적 업데이트) | 브로드캐스트 수신 시 |

## 논의 포인트

- 이 대화 분기에서 다루고 싶은 구체적인 사항을 주인님이 지정해 주세요.
- 예시: 버그 수정, 기능 개선, 리팩토링, 에이전트 프로세스 정리 누락 여부 등
