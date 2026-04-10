# Estelle 메시지 타입 레퍼런스

> 코드 기반 분석 (2026-04-09)

## 메시지 기본 구조

```typescript
interface Message<T = unknown> {
  type: string;              // 메시지 타입
  payload: T;                // 실제 데이터
  timestamp: number;         // Unix timestamp (ms)
  from?: DeviceId | null;    // 발신자
  to?: number[] | null;      // 수신자 pylonId 배열
  requestId?: string | null; // 요청-응답 매칭 ID
  exclude?: number[];        // 브로드캐스트 시 제외할 deviceId (Direct Connection 중복 방지)
}
```

---

## 1. Auth (인증)

| 타입 | 방향 | Payload | 용도 |
|------|------|---------|------|
| `AUTH` | Client → Relay | `{ deviceId?, deviceType, name?, mac?, idToken?, version? }` | 인증 요청 |
| `AUTH_RESULT` | Relay → Client | `{ success, error?, deviceId?, device? }` | 인증 결과 |

---

## 2. Connection (연결)

| 타입 | 방향 | Payload | 용도 |
|------|------|---------|------|
| `CONNECTED` | Relay → Client | `{ message? }` | WebSocket 연결 완료 |
| `REGISTERED` | Pylon → Client | - | Pylon 등록 완료 |
| `DEVICE_STATUS` | Pylon → Client | `{ deviceId, status, name? }` | 디바이스 상태 변경 |
| `CLIENT_DISCONNECT` | Relay → Pylon | `{ deviceId }` | 클라이언트 연결 해제 |
| `RELAY_STATUS` | 내부 | `{ connected }` | Relay 연결 상태 (로컬서버 전용) |
| `STATUS` | Pylon → Client | `{ ... }` | 상태 조회 응답 |

---

## 3. Workspace

| 타입 | 방향 | Payload | 용도 |
|------|------|---------|------|
| `WORKSPACE_LIST` | Client → Pylon | - | 목록 요청 |
| `WORKSPACE_LIST_RESULT` | Pylon → Client | `{ deviceId, workspaces, activeWorkspaceId?, activeConversationId?, account? }` | 목록 응답 |
| `WORKSPACE_CREATE` | Client → Pylon | `{ name, workingDir }` | 생성 요청 |
| `WORKSPACE_CREATE_RESULT` | Pylon → Client | `{ success, workspace?, conversation? }` | 생성 응답 |
| `WORKSPACE_DELETE` | Client → Pylon | `{ workspaceId }` | 삭제 요청 |
| `WORKSPACE_DELETE_RESULT` | Pylon → Client | - | 삭제 응답 |
| `WORKSPACE_UPDATE` | Client → Pylon | `{ workspaceId, data }` | 수정 요청 |
| `WORKSPACE_UPDATE_RESULT` | Pylon → Client | - | 수정 응답 |
| `WORKSPACE_REORDER` | Client → Pylon | `{ workspaceIds }` | 순서 변경 |
| `WORKSPACE_RENAME` | Client → Pylon | `{ workspaceId, newName }` | 이름 변경 |

---

## 4. Conversation

| 타입 | 방향 | Payload | 용도 |
|------|------|---------|------|
| `CONVERSATION_CREATE` | Client → Pylon | `{ workspaceId, name?, agentType? }` | 대화 생성 |
| `CONVERSATION_CREATE_RESULT` | Pylon → Client | `{ success, conversation? }` | 생성 응답 |
| `CONVERSATION_SELECT` | Client → Pylon | `{ conversationId, workspaceId? }` | 대화 선택 |
| `CONVERSATION_STATUS` | Pylon → Client | `{ deviceId, conversationId, status?, unread? }` | 상태 변경 |
| `CONVERSATION_DELETE` | Client → Pylon | `{ conversationId }` | 삭제 |
| `CONVERSATION_RENAME` | Client → Pylon | `{ conversationId, newName }` | 이름 변경 |
| `CONVERSATION_REORDER` | Client → Pylon | `{ workspaceId, conversationIds }` | 순서 변경 |
| `HISTORY_REQUEST` | Client → Pylon | `{ conversationId, loadBefore? }` | 히스토리 요청 |
| `HISTORY_RESULT` | Pylon → Client | `{ conversationId, messages, hasMore, totalCount, currentStatus? }` | 히스토리 응답 |

---

## 5. Claude

| 타입 | 방향 | Payload | 용도 |
|------|------|---------|------|
| `CLAUDE_SEND` | Client → Pylon | `{ conversationId, message, attachedFileIds?, attachments? }` | 메시지 전송 |
| `CLAUDE_EVENT` | Pylon → Client | `{ conversationId, event }` | Claude 이벤트 |
| `CLAUDE_PERMISSION` | Client → Pylon | `{ conversationId, toolUseId, decision }` | 권한 응답 |
| `CLAUDE_ANSWER` | Client → Pylon | `{ conversationId, toolUseId, answer }` | 질문 응답 |
| `CLAUDE_CONTROL` | Client → Pylon | `{ conversationId, action }` | 제어 (stop/new_session/clear/compact) |
| `CLAUDE_SET_PERMISSION_MODE` | Client → Pylon | `{ conversationId, mode }` | 권한 모드 설정 |
| `SUGGESTION_REQUEST` | Client → Pylon | `{ conversationId }` | 제안 요청 |
| `PYLON_STATUS` | Pylon → Client | `{ deviceId, claudeUsage }` | Pylon 상태 |

### Claude Event 서브타입

| event.type | Payload | 용도 |
|------------|---------|------|
| `init` | `{ session_id, tools? }` | 세션 초기화 |
| `state` | `{ state: 'idle'|'working'|'permission' }` | 상태 변경 |
| `text` | `{ text }` | 텍스트 스트리밍 |
| `textComplete` | - | 텍스트 완료 |
| `tool_start` | `{ toolUseId, toolName, toolInput, parentToolUseId? }` | 도구 시작 |
| `tool_complete` | `{ toolUseId, toolName, success, output?, error? }` | 도구 완료 |
| `permission_request` | `{ toolUseId, toolName, toolInput }` | 권한 요청 |
| `ask_question` | `{ toolUseId, questions[] }` | 질문 요청 |
| `result` | `{ usage, duration_ms }` | 작업 완료 |
| `error` | `{ message }` | 에러 |
| `aborted` | `{ reason: 'user'|'session_ended' }` | 중단 |
| `file_attachment` | `{ file }` | 파일 첨부 |
| `usage_update` | `{ usage }` | 실시간 사용량 |
| `macroExecute` | `{ macroId, macroName, macroIcon?, macroColor? }` | 매크로 실행 |
| `compactStart` | - | 컴팩트 시작 |
| `compactComplete` | `{ preTokens? }` | 컴팩트 완료 |

---

## 6. Blob (파일 전송)

| 타입 | 방향 | Payload | 용도 |
|------|------|---------|------|
| `BLOB_START` | Client → Pylon | `{ blobId, filename, mimeType, totalSize, chunkSize, totalChunks, encoding, context, sameDevice?, localPath? }` | 전송 시작 |
| `BLOB_CHUNK` | Client → Pylon | `{ blobId, index, data(base64), size }` | 청크 전송 |
| `BLOB_END` | Client → Pylon | `{ blobId, checksum?, totalReceived }` | 전송 완료 |
| `BLOB_ACK` | Pylon → Client | `{ blobId, receivedChunks, missingChunks }` | 전송 확인 |
| `BLOB_REQUEST` | Client → Pylon | `{ blobId, filename, localPath? }` | 다운로드 요청 |
| `BLOB_UPLOAD_COMPLETE` | Pylon → Client | `{ blobId, serverPath }` | 업로드 완료 |

---

## 7. Document

| 타입 | 방향 | Payload | 용도 |
|------|------|---------|------|
| `LINK_DOCUMENT` | Client → Pylon | `{ conversationId, path }` | 문서 연결 |
| `UNLINK_DOCUMENT` | Client → Pylon | `{ conversationId, path }` | 문서 해제 |

---

## 8. Folder

| 타입 | 방향 | Payload | 용도 |
|------|------|---------|------|
| `FOLDER_LIST` | Client → Pylon | `{ path }` | 폴더 목록 요청 |
| `FOLDER_LIST_RESULT` | Pylon → Client | `{ folders }` | 폴더 목록 응답 |
| `FOLDER_CREATE` | Client → Pylon | `{ parentPath, name }` | 폴더 생성 |
| `FOLDER_CREATE_RESULT` | Pylon → Client | `{ success }` | 생성 응답 |
| `FOLDER_RENAME` | Client → Pylon | `{ path, newName }` | 폴더 이름 변경 |
| `FOLDER_RENAME_RESULT` | Pylon → Client | - | 이름 변경 응답 |

---

## 9. Task & Worker

| 타입 | 방향 | Payload | 용도 |
|------|------|---------|------|
| `TASK_LIST` | Client → Pylon | `{ workspaceId }` | 태스크 목록 |
| `TASK_LIST_RESULT` | Pylon → Client | `{ tasks }` | 태스크 응답 |
| `TASK_GET` | Client → Pylon | `{ workspaceId, taskId }` | 태스크 조회 |
| `TASK_GET_RESULT` | Pylon → Client | `{ task }` | 태스크 응답 |
| `TASK_CREATE` | Client → Pylon | `{ workspaceId, ... }` | 태스크 생성 |
| `TASK_UPDATE` | Client → Pylon | `{ workspaceId, taskId, ... }` | 태스크 수정 |
| `TASK_STATUS` | Client → Pylon | `{ workspaceId, taskId, status }` | 상태 변경 |
| `TASK_STATUS_RESULT` | Pylon → Client | - | 태스크 상태 응답 |
| `WORKER_STATUS` | Client → Pylon | `{ workspaceId }` | 워커 상태 |
| `WORKER_STATUS_RESULT` | Pylon → Client | `{ status }` | 워커 응답 |
| `WORKER_START` | Client → Pylon | `{ workspaceId }` | 워커 시작 |
| `WORKER_START_RESULT` | Pylon → Client | - | 워커 시작 응답 |
| `WORKER_STOP` | Client → Pylon | `{ workspaceId }` | 워커 정지 |
| `WORKER_STOP_RESULT` | Pylon → Client | - | 워커 정지 응답 |

---

## 10. Account & Settings

| 타입 | 방향 | Payload | 용도 |
|------|------|---------|------|
| `ACCOUNT_SWITCH` | Client → Pylon | `{ account }` | 계정 전환 |
| `ACCOUNT_STATUS` | Pylon → Client | `{ current, subscriptionType? }` | 계정 상태 |
| `USAGE_REQUEST` | Client → Pylon | `{ requestType?, since?, until? }` | 사용량 요청 |
| `USAGE_RESPONSE` | Pylon → Client | `{ success, summary?, error? }` | 사용량 응답 |

---

## 11. Share

| 타입 | 방향 | Payload | 용도 |
|------|------|---------|------|
| `SHARE_CREATE` | Client → Pylon | `{ conversationId }` | 공유 생성 |
| `SHARE_CREATE_RESULT` | Pylon → Client | `{ shareId, url }` | 공유 응답 |
| `SHARE_HISTORY` | Viewer → Pylon | `{ shareId }` | 공유 히스토리 |

---

## 12. Widget (위젯)

### Widget 소유권 & 생명주기

| 타입 | 방향 | Payload | 용도 |
|------|------|---------|------|
| `WIDGET_READY` | Pylon → Client (broadcast) | `{ conversationId, sessionId, toolUseId, timeout }` | 위젯 준비됨 (핸드셰이크 시작) |
| `WIDGET_CLAIM` | Client → Pylon | `{ sessionId }` | 위젯 소유권 요청 |
| `WIDGET_PENDING` | Pylon → Client (broadcast) | `{ conversationId, sessionId, toolUseId }` | 위젯 대기 상태 (실행 버튼) |
| `WIDGET_COMPLETE` | Pylon → Client (broadcast) | `{ conversationId, sessionId, toolUseId, view, result }` | 위젯 완료 |
| `WIDGET_ERROR` | Pylon → Client (broadcast) | `{ conversationId, sessionId, toolUseId, error }` | 위젯 에러 |

### Widget 렌더링 & 입력

| 타입 | 방향 | Payload | 용도 |
|------|------|---------|------|
| `WIDGET_RENDER` | Pylon → Client | `{ sessionId, view }` | 위젯 렌더링 |
| `WIDGET_INPUT` | Client → Pylon | `{ sessionId, data }` | 위젯 입력 |
| `WIDGET_EVENT` | Pylon ↔ Client | `{ sessionId, data }` | 위젯 이벤트 (v2 양방향) |
| `WIDGET_CLOSE` | Pylon → Client | `{ sessionId, reason? }` | 위젯 닫기 |
| `WIDGET_CANCEL` | Client → Pylon | `{ sessionId }` | 위젯 취소 |

### Widget 유효성 확인

| 타입 | 방향 | Payload | 용도 |
|------|------|---------|------|
| `WIDGET_CHECK` | Client → Pylon | `{ conversationId, sessionId }` | 세션 유효성 확인 |
| `WIDGET_CHECK_RESULT` | Pylon → Client | `{ conversationId, sessionId, valid }` | 유효성 확인 응답 |

### Widget 상태 전이

```
CLI 실행 → WIDGET_READY (핸드셰이크)
  ├─ auto-claim 조건 만족 → WIDGET_CLAIM → WIDGET_RENDER (실행)
  └─ 조건 미충족 → WIDGET_PENDING (실행 버튼 표시)
     └─ 사용자 클릭 → WIDGET_CLAIM → WIDGET_RENDER
  ↓
WIDGET_COMPLETE 또는 WIDGET_ERROR (브로드캐스트)
```

---

## 13. Slash Commands

| 타입 | 방향 | Payload | 용도 |
|------|------|---------|------|
| `SLASH_COMMANDS_REQUEST` | Client → Pylon | `{ conversationId }` | 슬래시 명령어 요청 |
| `SLASH_COMMANDS_RESULT` | Pylon → Client | `{ slashCommands }` | 슬래시 명령어 응답 |

---

## 14. Macro (매크로 툴바)

### 매크로 CRUD & 실행

| 타입 | 방향 | Payload | 용도 |
|------|------|---------|------|
| `MACRO_EXECUTE` | Client → Pylon | `{ macroId, conversationId }` | 매크로 실행 |
| `MACRO_CREATE` | Client → Pylon | `{ name, icon?, color?, content, workspaceIds? }` | 매크로 생성 |
| `MACRO_CREATE_RESULT` | Pylon → Client | `{ macroId }` | 생성 응답 |
| `MACRO_UPDATE` | Client → Pylon | `{ macroId, name?, icon?, color?, content? }` | 매크로 수정 |
| `MACRO_DELETE` | Client → Pylon | `{ macroId }` | 매크로 삭제 |

### 매크로 할당 & 관리

| 타입 | 방향 | Payload | 용도 |
|------|------|---------|------|
| `MACRO_ASSIGN` | Client → Pylon | `{ macroId, workspaceId, assign: boolean }` | 워크스페이스 할당/해제 |
| `MACRO_REORDER` | Client → Pylon | `{ workspaceId, macroIds: number[] }` | 순서 변경 |
| `MACRO_CHANGED` | Pylon → Client (broadcast) | `{ added?, removed?, updated? }` | 변경 알림 (delta) |
| `MACRO_MANAGE_CONVERSATION` | Client → Pylon | `{ workspaceId, macroId? }` | 매크로 관리 대화 생성 |

### MACRO_CHANGED delta 구조

```typescript
{
  added?: { macro: MacroItem, workspaceIds: (number | null)[] }[];
  removed?: number[];     // macroId 배열
  updated?: MacroItem[];
}
```

### 매크로 실행 흐름

```
MACRO_EXECUTE 수신
    ↓
MacroStore에서 매크로 조회
    ↓
claude_event (macroExecute) 브로드캐스트
    ↓
macro.content를 Claude에 전송 (linkedDocs, systemPrompt 포함)
```

---

## 15. Utility

| 타입 | 방향 | Payload | 용도 |
|------|------|---------|------|
| `PING` | Client → Pylon | - | 연결 확인 |
| `PONG` | Pylon → Client | `{ timestamp }` | 연결 응답 |
| `ERROR` | 양방향 | `{ code, message }` | 에러 |
| `BUG_REPORT` | Client → Pylon | `{ message, stack }` | 버그 리포트 |
| `DEBUG_LOG` | Client → Pylon | `{ ... }` | 디버그 로그 |
| `GET_STATUS` | Client → Pylon | - | 상태 조회 |
| `STATUS` | Pylon → Client | `{ ... }` | 상태 응답 |
| `FROM_RELAY` | 내부 | `{ ... }` | Relay에서 온 메시지 통과 (로컬서버 전용) |

---

## 메시지 패턴 참고

### Request/Response 패턴
- `*_REQUEST` / `*_RESULT` 또는 `*` / `*_RESULT` 형태로 구성
- requestId를 통해 요청과 응답을 매칭

### Broadcast vs Unicast
- **Broadcast**: `to`가 없음 (모든 연결된 클라이언트에 전송)
- **Unicast**: `to` 배열로 특정 클라이언트만 대상

### 주요 업데이트 (2026-03-28 이후)
- Message 인터페이스에 `exclude` 필드 추가 (Direct Connection 중복 방지)
- Macro 메시지 9종 추가 (MACRO_EXECUTE, CREATE, CREATE_RESULT, UPDATE, DELETE, ASSIGN, CHANGED, REORDER, MANAGE_CONVERSATION)
- Claude Event에 `macroExecute` 서브타입 추가
- `SUGGESTION_REQUEST` 메시지 추가
- `RELAY_STATUS`, `FROM_RELAY` 메시지 추가

### 주요 업데이트 (2026-03-03 ~ 2026-03-28)
- Widget 소유권 관리 메시지 추가 (WIDGET_READY, WIDGET_CLAIM, WIDGET_PENDING, WIDGET_COMPLETE, WIDGET_ERROR)
- Widget Check 메시지 추가 (WIDGET_CHECK, WIDGET_CHECK_RESULT)
- Widget Event (v2) 양방향 프로토콜 추가
- CONVERSATION_CREATE에 agentType 필드 추가
- Task 관련 메시지 확장 (TASK_CREATE, TASK_UPDATE, TASK_STATUS_RESULT)
- Folder 관련 메시지 확장 (FOLDER_RENAME, FOLDER_RENAME_RESULT)
- Workspace 응답 메시지 확장 (WORKSPACE_DELETE_RESULT, WORKSPACE_UPDATE_RESULT)
- Worker 응답 메시지 추가 (WORKER_START_RESULT, WORKER_STOP_RESULT)
