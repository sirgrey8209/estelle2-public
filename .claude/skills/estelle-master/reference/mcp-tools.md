# Estelle MCP 도구 레퍼런스

> 코드 기반 분석 (2026-04-09)

## MCP 서버 구조

```
Pylon
  └── PylonMcpServer (stdio)
       ├── TCP 서버 (ESTELLE_MCP_PORT)
       └── Tools (27개)
           ├── 문서/파일 (4): send_file, link_doc, unlink_doc, list_docs
           ├── 아카이브 (7): archive_write/read/list/glob/grep/delete/rename
           ├── 상태 (1): get_status
           ├── 대화 (3): create_conversation, delete_conversation, rename_conversation
           ├── 세션 (3): add_prompt, continue_task, new_session
           ├── 위젯 (2): run_widget, run_widget_inline
           └── 매크로 (7): create/update/delete/list/get/assign/unassign_macro
```

### 환경변수

| 변수 | 설명 | 기본값 |
|------|------|--------|
| `ESTELLE_MCP_PORT` | MCP TCP 서버 포트 | 9880 |
| `ESTELLE_WORKING_DIR` | 상대 경로 기준 | - |
| `DATA_DIR` | 데이터/로그 디렉토리 | - |
| `MCP_TIMEOUT` | MCP 요청 타임아웃 (밀리초) | 5000 |

### 포트 할당

| 환경 | 포트 |
|------|------|
| release | 9876 |
| stage | 9877 |
| dev | 9878 |
| test | 9879 |

---

## 1. send_file

파일을 사용자에게 전송

### 파라미터

| 이름 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `path` | string | O | 전송할 파일 경로 (절대 또는 상대) |
| `description` | string | X | 파일 설명 |

### 반환값

```json
{
  "success": true,
  "file": {
    "path": "/path/to/file",
    "filename": "file.txt",
    "mimeType": "text/plain",
    "size": 1024,
    "description": "optional description"
  }
}
```

### 처리 흐름

1. path 검증 (필수)
2. PylonClient.sendFileByToolUseId() 호출
3. toolUseId → conversationId 매핑
4. 파일 존재 여부 확인
5. 청크 단위로 파일 전송

---

## 2. get_status

현재 대화 및 Pylon 상태 조회

### 파라미터

없음 (toolUseId로 대화 식별)

### 반환값

```json
{
  "success": true,
  "status": {
    "environment": "release",
    "version": "v0313_3",
    "workspace": { "id": 1, "name": "..." },
    "conversationId": 132097,
    "linkedDocuments": [{ "path": "/docs/spec.md", "addedAt": 1710524400000 }]
  }
}
```

---

## 3. create_conversation

현재 워크스페이스에 새 대화 생성

### 파라미터

| 이름 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `name` | string | X | 대화 이름 (기본: "새 대화") |
| `files` | string[] | X | 연결할 파일 경로 |
| `agent` | string | X | 에이전트 선택 ("claude" 또는 "codex", 기본: "claude") |
| `initialMessage` | string | X | 생성 후 자동 전송할 메시지 |
| `autoSelect` | boolean | X | 자동으로 대화 전환 (기본: false) |

### 반환값

```json
{
  "success": true,
  "conversation": {
    "conversationId": 132098,
    "name": "새 대화",
    "linkedDocuments": []
  }
}
```

---

## 4. delete_conversation

대화 삭제

### 파라미터

| 이름 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `target` | string | O | 대화 이름 또는 ID |

### 반환값

```json
{
  "success": true,
  "deleted": { "conversationId": 132097, "name": "삭제된 대화" }
}
```

### 제약

- 현재 대화는 삭제 불가

### 처리 흐름

MCP 도구 경로와 Client UI 경로가 동일한 정리 로직을 사용:

```
MCP 도구 경로:
  _handleDeleteConversation()
    1. target 검색 (ID 또는 이름)
    2. 현재 대화 삭제 차단
    3. onConversationDelete 콜백 → Pylon.triggerConversationDelete()

Client UI 경로:
  ChatHeader → relaySender.deleteConversation()
    → CONVERSATION_DELETE 메시지 → Pylon.handleConversationDelete()
```

두 경로 모두 `handleConversationDelete()`에서 처리:

1. `agentManager.stop()` — Agent 세션 정리 (try-catch, 실패해도 삭제 계속)
2. `cancelWidgetForConversation()` — Widget 세션 정리
3. `clearMessagesForConversation()` — SQLite 메시지 삭제
4. `workspaceStore.deleteConversation()` — 메모리 상태 제거
5. `broadcastWorkspaceList()` — 클라이언트 동기화
6. `saveWorkspaceStore()` — 영속 저장소 저장

---

## 5. rename_conversation

대화 이름 변경

### 파라미터

| 이름 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `newName` | string | O | 새 이름 |
| `target` | string | X | 대화 이름/ID (없으면 현재 대화) |

### 반환값

```json
{
  "success": true,
  "conversation": { "conversationId": 132097, "name": "새 이름" }
}
```

---

## 6. link_doc

현재 대화에 문서 연결

### 파라미터

| 이름 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `path` | string | O | 문서 경로 |

### 반환값

```json
{
  "success": true,
  "path": "/path/to/doc.md",
  "docs": ["/path/to/doc.md", "/other/doc.md"]
}
```

### 동작

- WorkspaceStore.linkDocument() 호출
- 브로드캐스트로 클라이언트 동기화
- 활성 세션에 "문서 추가됨" 리마인더 전송

---

## 7. unlink_doc

문서 연결 해제

### 파라미터

| 이름 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `path` | string | O | 문서 경로 |

### 반환값

```json
{
  "success": true,
  "path": "/path/to/doc.md"
}
```

---

## 8. list_docs

연결된 문서 목록 조회

### 파라미터

없음

### 반환값

```json
{
  "success": true,
  "docs": ["/path/to/doc1.md", "/path/to/doc2.md"]
}
```

---

## 9. add_prompt

파일 내용을 시스템 프롬프트로 설정

### 파라미터

| 이름 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `path` | string | O | 프롬프트 파일 경로 |

### 반환값

```json
{
  "success": true,
  "message": "System prompt set",
  "newSession": true,
  "path": "/path/to/prompt.md"
}
```

### 동작

1. ESTELLE_WORKING_DIR 기준 절대 경로 해석
2. 파일 존재 및 타입 확인
3. UTF-8로 읽기
4. PylonClient.setSystemPromptByToolUseId() 호출
5. 새 세션 자동 시작

---

## 10. continue_task

세션 재시작 (히스토리 유지)

### 파라미터

| 이름 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `reason` | string | X | 재시작 사유 (예: "토큰 한도 초과") |

### 반환값

```json
{
  "success": true,
  "message": "Session restarted",
  "newSession": true,
  "systemMessageAdded": true,
  "historyPreserved": true
}
```

### 동작

1. 현재 세션 종료
2. 재시작 로그 메시지 추가
3. 새 세션 시작 (히스토리 유지)

---

## 11. run_widget

인터랙티브 위젯 세션 시작 (CLI 프로세스)

### 파라미터

| 이름 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `command` | string | O | 실행할 CLI 명령어 |
| `cwd` | string | O | 작업 디렉토리 (절대 경로) |
| `args` | string[] | X | CLI 인자 |

### 반환값

```json
{
  "success": true,
  "result": {
    "exitCode": 0,
    "stdout": "...",
    "stderr": ""
  }
}
```

### 동작

1. command, cwd 검증
2. PylonClient.runWidget() 호출
3. Widget 세션 생성 → WIDGET_READY 브로드캐스트
4. 클라이언트가 WIDGET_CLAIM → CLI 프로세스 실행
5. WIDGET_RENDER/WIDGET_INPUT으로 양방향 통신
6. CLI 완료 시 WIDGET_COMPLETE 브로드캐스트
7. **타임아웃 없음** - 사용자 인터랙션 대기

---

## 12. run_widget_inline

인라인 위젯 세션 시작 (HTML/JavaScript)

### 파라미터

| 이름 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `html` | string | O | HTML 템플릿 (CSS 포함 가능) |
| `code` | string | X | JavaScript 코드 |
| `height` | number | X | 초기 높이 (px) |

### 반환값

```json
{
  "success": true,
  "result": {
    "data": {},
    "action": "submit"
  }
}
```

### 동작

1. html 검증
2. PylonClient.runWidgetInline() 호출
3. CLI 프로세스 없이 클라이언트가 HTML을 직접 렌더링
4. 사용자 액션 제출까지 대기
5. **타임아웃 없음**

### run_widget과의 차이

- CLI 프로세스 불필요 (클라이언트 사이드 실행)
- HTML/CSS/JS로 커스텀 UI 구성
- 더 가볍고 빠름

---

## 13. new_session

세션 초기화 (히스토리 삭제)

### 파라미터

없음

### 반환값

```json
{
  "success": true,
  "message": "Session initialized",
  "newSession": true
}
```

### 동작

1. PylonClient.newSessionByToolUseId() 호출
2. 대화 히스토리 전체 삭제
3. 새 세션 시작

### continue_task과의 차이

- `new_session`: 히스토리 **삭제** 후 새 세션
- `continue_task`: 히스토리 **유지**하면서 새 세션

---

## 14. create_macro

매크로 툴바에 새 매크로 생성

### 파라미터

| 이름 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `name` | string | O | 매크로 이름 (버튼에 표시) |
| `icon` | string | X | 아이콘 이름 (Lucide 아이콘 또는 이모지) |
| `color` | string | X | 색상 코드 (예: "#ff0000") |
| `content` | string | O | 실행 시 전송할 프롬프트 |
| `workspaceIds` | (number\|null)[] | X | 할당할 워크스페이스 (null=글로벌, 기본: [null]) |

### 반환값

```json
{
  "success": true,
  "macro": { "id": 1, "name": "검색", "icon": "search", "color": null, "content": "..." }
}
```

### 동작

1. MacroStore.createMacro() 호출
2. 지정된 workspaceIds에 할당
3. notifyMacroChanged({ added }) 브로드캐스트

---

## 15. update_macro

기존 매크로 수정

### 파라미터

| 이름 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `macroId` | number | O | 수정할 매크로 ID |
| `name` | string | X | 새 이름 |
| `icon` | string | X | 새 아이콘 |
| `color` | string | X | 새 색상 |
| `content` | string | X | 새 프롬프트 |

### 반환값

```json
{
  "success": true,
  "macroId": 1,
  "updated": { "name": "새 이름" }
}
```

### 제약

- 최소 하나의 필드 필요

---

## 16. delete_macro

매크로 삭제 (워크스페이스 할당도 함께 삭제)

### 파라미터

| 이름 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `macroId` | number | O | 삭제할 매크로 ID |

### 반환값

```json
{
  "success": true,
  "deletedMacroId": 1
}
```

---

## 17. list_macros

매크로 목록 조회

### 파라미터

| 이름 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `workspaceId` | number | X | 워크스페이스 ID (없으면 글로벌만) |

### 반환값

```json
{
  "success": true,
  "macros": [{ "id": 1, "name": "검색", "icon": "search", "color": null, "content": "..." }],
  "count": 1
}
```

---

## 18. get_macro

매크로 상세 조회 (할당된 워크스페이스 포함)

### 파라미터

| 이름 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `macroId` | number | O | 조회할 매크로 ID |

### 반환값

```json
{
  "success": true,
  "macro": { "id": 1, "name": "검색", "icon": "search", "content": "...", "workspaceIds": [null, 1, 2] }
}
```

---

## 19. assign_macro

매크로를 워크스페이스에 할당 (기존 할당 교체)

### 파라미터

| 이름 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `macroId` | number | O | 할당할 매크로 ID |
| `workspaceIds` | (number\|null)[] | O | 워크스페이스 ID 배열 (null=글로벌) |

### 반환값

```json
{
  "success": true,
  "macroId": 1,
  "workspaceIds": [null, 1, 2]
}
```

---

## 20. unassign_macro

매크로의 워크스페이스 할당 해제

### 파라미터

| 이름 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `macroId` | number | O | 해제할 매크로 ID |
| `workspaceIds` | (number\|null)[] | O | 해제할 워크스페이스 ID 배열 (null=글로벌 해제) |

### 반환값

```json
{
  "success": true,
  "macroId": 1,
  "unassignedWorkspaceIds": [1]
}
```

### Macro 도구 공통 특징

- **MacroStore 직접 접근**: toolUseId 기반 라우팅 대신 SQLite 직접 조회 (매크로는 대화와 무관한 글로벌 데이터)
- **변경 알림**: 모든 변경 후 `notifyMacroChanged(delta)` → `macro_changed` 브로드캐스트
- **파일 위치**: `pylon/src/mcp/tools/macro.ts`

---

## 21. archive_write

공유 아카이브에 파일 생성/수정

### 파라미터

| 이름 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `path` | string | O | 상대 경로 (예: "notes/todo.md") |
| `content` | string | O | 파일 내용 |

### 동작

- 중간 디렉토리 자동 생성 (mkdir -p)
- path traversal 차단 (`..` 탈출 방지)
- master: ArchiveService 직접 사용 / remote: HTTP POST

---

## 22. archive_read

아카이브에서 파일 읽기

### 파라미터

| 이름 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `path` | string | O | 상대 경로 |

### 반환값

텍스트 파일: 내용 문자열 / 바이너리: 메타데이터 (MIME, 크기)

---

## 23. archive_list

디렉토리 목록 조회 (depth 제한)

### 파라미터

| 이름 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `path` | string | X | 디렉토리 경로 (기본: 루트) |
| `depth` | number | X | 탐색 깊이 (기본 1, 최대 3) |

### 반환값

FileEntry 배열 (name, path, type, size, modifiedAt). 디렉토리 먼저, 알파벳 순 정렬.

---

## 24. archive_glob

파일명 패턴 검색

### 파라미터

| 이름 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `pattern` | string | O | glob 패턴 (예: "**/*.md") |

### 반환값

매칭된 상대 경로 배열

---

## 25. archive_grep

텍스트 파일 내용 검색

### 파라미터

| 이름 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `query` | string | O | 검색 텍스트 |
| `path` | string | X | 검색 범위 제한 디렉토리 |

### 반환값

GrepMatch 배열 (path, line, content)

---

## 26. archive_delete

파일 또는 디렉토리 삭제

### 파라미터

| 이름 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `path` | string | O | 삭제 대상 경로 |
| `recursive` | boolean | X | 비어있지 않은 디렉토리 강제 삭제 (기본: false) |

---

## 27. archive_rename

파일/디렉토리 이름 변경 또는 이동

### 파라미터

| 이름 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `from` | string | O | 원본 경로 |
| `to` | string | O | 대상 경로 |

### 동작

- 대상 경로의 중간 디렉토리 자동 생성
- from, to 모두 path traversal 차단

---

### Archive 도구 공통 특징

- **저장소**: `<아카이브 경로 - 유저 환경에 맞게 설정>` (파일시스템 기반, 인덱스 없음)
- **이중 접근**: master에서는 `ArchiveService` 직접 사용, remote에서는 HTTP API (`http://<서버 IP - 유저 환경에 맞게 설정>:3009`) 호출
- **master 판별**: `ESTELLE_ROLE=master` 환경변수 또는 archive 루트 디렉토리 존재 여부
- **HTTP API**: Caddy 프록시 (`/archive/*` → localhost:3009)
- **웹 UI**: 허브 클라이언트에 통합된 ArchiveViewer (VSCode 스타일 트리+콘텐츠)
- **모바일**: 캐러셀 패턴으로 탐색기 ↔ 뷰어 전환
- **파일 위치**: `pylon/src/mcp/tools/archive.ts`
- **서비스 패키지**: `packages/archive/` (ArchiveService, HTTP 서버)

---

## 공통 응답 형식

### 성공

```json
{
  "content": [{ "type": "text", "text": "{...JSON...}" }]
}
```

### 실패

```json
{
  "content": [{ "type": "text", "text": "{\"success\":false,\"error\":\"...\"}" }],
  "isError": true
}
```

---

## PylonClient 통신

### 연결 방식

```
MCP 도구 호출
    ↓
PylonClient (TCP 연결 127.0.0.1:ESTELLE_MCP_PORT)
    ↓
PylonMcpServer (Pylon 내부 TCP 서버)
    ↓
toolUseId → conversationId 매핑
    ↓
실제 처리 (Store, AgentManager, WidgetManager 등)
```

### toolUseId 기반 라우팅

- Claude가 도구 호출 시 `toolUseId` 발급
- MCP 서버에서 `meta['claudecode/toolUseId']` 추출
- PylonClient에 toolUseId 전달
- PylonMcpServer에서 `lookup_and_*` 액션으로 변환
- AgentManager.toolContextMap에서 conversationId 조회

### 요청 액션 매핑

| 도구 | Pylon 액션 | 비고 |
|------|-----------|------|
| send_file | lookup_and_send_file | |
| link_doc | lookup_and_link | |
| unlink_doc | lookup_and_unlink | |
| list_docs | lookup_and_list | |
| get_status | lookup_and_get_status | |
| create_conversation | lookup_and_create_conversation | |
| delete_conversation | lookup_and_delete_conversation | |
| rename_conversation | lookup_and_rename_conversation | |
| add_prompt | lookup_and_set_system_prompt | |
| continue_task | lookup_and_continue_task | |
| new_session | lookup_and_new_session | |
| run_widget | lookup_and_run_widget | |
| run_widget_inline | lookup_and_run_widget_inline | |
| create_macro | (직접 MacroStore) | conversationId 불필요 |
| update_macro | (직접 MacroStore) | conversationId 불필요 |
| delete_macro | (직접 MacroStore) | conversationId 불필요 |
| list_macros | (직접 MacroStore) | conversationId 불필요 |
| get_macro | (직접 MacroStore) | conversationId 불필요 |
| assign_macro | (직접 MacroStore) | conversationId 불필요 |
| unassign_macro | (직접 MacroStore) | conversationId 불필요 |
| archive_write | (직접 ArchiveService/HTTP) | conversationId 불필요 |
| archive_read | (직접 ArchiveService/HTTP) | conversationId 불필요 |
| archive_list | (직접 ArchiveService/HTTP) | conversationId 불필요 |
| archive_glob | (직접 ArchiveService/HTTP) | conversationId 불필요 |
| archive_grep | (직접 ArchiveService/HTTP) | conversationId 불필요 |
| archive_delete | (직접 ArchiveService/HTTP) | conversationId 불필요 |
| archive_rename | (직접 ArchiveService/HTTP) | conversationId 불필요 |

---

## 파일 위치

| 구성 | 경로 |
|------|------|
| MCP 서버 | `pylon/src/mcp/server.ts` |
| PylonClient | `pylon/src/mcp/pylon-client.ts` |
| send_file | `pylon/src/mcp/tools/send-file.ts` |
| 문서 도구 | `pylon/src/mcp/tools/link-document.ts` |
| 상태 조회 | `pylon/src/mcp/tools/get-status.ts` |
| 대화 관리 | `pylon/src/mcp/tools/conversation.ts` |
| 시스템 프롬프트 | `pylon/src/mcp/tools/system-prompt.ts` |
| 작업 계속 | `pylon/src/mcp/tools/continue-task.ts` |
| Widget 실행 | `pylon/src/mcp/tools/run-widget.ts` |
| Inline Widget | `pylon/src/mcp/tools/run-widget-inline.ts` |
| 세션 초기화 | `pylon/src/mcp/tools/new-session.ts` |
| 매크로 도구 (7개) | `pylon/src/mcp/tools/macro.ts` |
| 아카이브 도구 (7개) | `pylon/src/mcp/tools/archive.ts` |
| 아카이브 서비스 | `packages/archive/src/archive-service.ts` |
| 아카이브 HTTP 서버 | `packages/archive/src/server.ts` |

---

## 주요 업데이트 (2026-04-09)
- Archive 도구 7개 추가 (archive_write/read/list/glob/grep/delete/rename)
- `@estelle/archive` 패키지 신규 (ArchiveService, HTTP 서버)
- Archive HTTP API (포트 3009, Caddy 프록시 `/archive/*`)
- 허브 UI에 ArchiveViewer 통합 (데스크톱: 트리+콘텐츠, 모바일: 캐러셀)
- Archive 도구는 master에서 ArchiveService 직접 사용, remote에서 HTTP API 호출
- 총 도구 수 20 → 27

## 주요 업데이트 (2026-03-28 이후)
- `new_session` 도구 추가 (히스토리 삭제 후 세션 초기화)
- Macro 도구 7개 추가 (create/update/delete/list/get/assign/unassign_macro)
- Macro 도구는 MacroStore 직접 접근 (toolUseId 라우팅 불필요)
- `create_conversation`에 `initialMessage`, `autoSelect` 파라미터 추가
- PylonClient에 `newSessionByToolUseId()`, `notifyMacroChanged()` 메서드 추가
- 총 도구 수 12 → 20

## 주요 업데이트 (2026-03-03 ~ 2026-03-28)
- `delete_conversation` MCP 경로와 Client UI 경로 통일 — 동일한 정리 로직 사용
- `delete_conversation` 삭제 시 Agent 세션 정리 추가 (`agentManager.stop()`)
- `run_widget` 도구 추가 (CLI 기반 인터랙티브 위젯)
- `run_widget_inline` 도구 추가 (HTML/JS 인라인 위젯)
- `create_conversation`에 `agent` 파라미터 추가 ("claude" 또는 "codex")
- Widget 도구 타임아웃 비활성화 (사용자 상호작용 기반)
