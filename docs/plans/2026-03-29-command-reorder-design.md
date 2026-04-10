# 커맨드 버튼 순서 변경

## 개요

커맨드 툴바의 버튼 순서를 드래그 앤 드롭으로 변경할 수 있는 기능.
편집 모드를 도입하여 기존 클릭 동작과 충돌 없이 드래그를 지원한다.

## 데이터 모델 변경

### `command_assignments` 테이블

```sql
-- 기존
CREATE TABLE command_assignments (
  command_id INTEGER REFERENCES commands(id) ON DELETE CASCADE,
  workspace_id INTEGER,
  UNIQUE(command_id, workspace_id)
);

-- 변경: order 컬럼 추가
CREATE TABLE command_assignments (
  command_id INTEGER REFERENCES commands(id) ON DELETE CASCADE,
  workspace_id INTEGER,
  "order" INTEGER DEFAULT 0,
  UNIQUE(command_id, workspace_id)
);
```

### 조회 쿼리 변경

```sql
-- 기존: 글로벌(0)과 워크스페이스를 합쳐서 조회
SELECT DISTINCT c.* FROM commands c
  INNER JOIN command_assignments ca ON c.id = ca.command_id
  WHERE ca.workspace_id = 0 OR ca.workspace_id = ?

-- 변경: 워크스페이스 단독 조회 + order 정렬
SELECT c.id, c.name, c.icon, c.color, c.content FROM commands c
  INNER JOIN command_assignments ca ON c.id = ca.command_id
  WHERE ca.workspace_id = ?
  ORDER BY ca."order" ASC
```

### 글로벌 커맨드 전파 로직

| 시점 | 동작 |
|------|------|
| 워크스페이스 생성 | 글로벌(ws=0) 커맨드를 전부 해당 워크스페이스에 등록, 글로벌 order 유지 |
| 커맨드를 글로벌로 할당 | 해당 커맨드가 없는 모든 워크스페이스에 등록, order는 맨 뒤 |
| 커맨드 자체 삭제 | FK CASCADE로 모든 assignment 제거 |
| 편집바 "삭제" | 해당 워크스페이스의 assignment만 제거 |

## 메시지 & 통신

### 새 메시지 타입: `COMMAND_REORDER`

```typescript
// Payload
interface CommandReorderPayload {
  workspaceId: number;
  commandIds: number[];  // 새 순서의 커맨드 ID 배열
}
```

### 흐름 (대화 reorder와 동일 패턴)

1. 클라이언트에서 드래그 완료
2. 로컬 스토어 낙관적 업데이트
3. `COMMAND_REORDER` 메시지를 Pylon에 전송
4. Pylon이 `command_assignments`의 order 업데이트

### 기존 메시지 변경

- `WORKSPACE_LIST` 응답의 commands 배열이 `ORDER BY ca.order` 순으로 정렬
- `COMMAND_CHANGED` delta는 변경 없음 (추가/수정/삭제만 담당)

## 클라이언트 UI

### 기존 동작 제거

- 선택된 커맨드 버튼 롱프레스 → 게이지 애니메이션 → 커맨드 편집 대화 (제거)

### 편집 모드

```
[일반 모드]
┌─────────────────────────────────────────┐
│  [🔀] [📝] [+]                          │  커맨드 툴바
└─────────────────────────────────────────┘
     ↓ 툴바 아무 곳이나 롱프레스 (500ms)

[편집 모드]
┌─────────────────────────────────────────┐
│  [대화 분기]  [✏️ 편집] [🗑️ 삭제]  [✕] │  편집바
├─────────────────────────────────────────┤
│  [🔀] [📝] [+]  ← 드래그 가능, 클릭 무시 │  커맨드 툴바
└─────────────────────────────────────────┘
```

### 편집바 동작

| 요소 | 동작 |
|------|------|
| 커맨드 이름 | 현재 선택된 커맨드 표시 (선택 없으면 편집/삭제 비활성) |
| 편집 | `commandManageConversation(workspaceId, cmdId)` 호출 |
| 삭제 | 현재 워크스페이스에서 등록 해제 |
| ✕ | 편집 모드 종료 |

### 편집 모드에서 커맨드 버튼 동작

| 인터랙션 | 동작 |
|----------|------|
| 클릭 | 실행하지 않고 선택만 (편집바에 이름 반영) |
| 드래그 | dnd-kit으로 순서 변경 |

### 드래그 센서 (모바일 고려)

- `PointerSensor` + `TouchSensor` 사용
- `activationConstraint: { distance: 8 }` — 대화 드래그와 동일 패턴
- 편집 모드에서만 DndContext 활성화

## 클라이언트 상태 관리

### commandStore 변경

```typescript
interface CommandState {
  commandsByWorkspace: Map<number, CommandItem[]>;  // 배열 순서 = order
  setWorkspaceCommands: (workspaceId: number, commands: CommandItem[]) => void;
  getCommandsForWorkspace: (workspaceId: number) => CommandItem[];
  reorderCommands: (workspaceId: number, commandIds: number[]) => void;  // 새로 추가
  applyDelta: (delta: CommandDelta) => void;
  reset: () => void;
}
```

### relaySender 추가

```typescript
function reorderCommands(workspaceId: number, commandIds: number[]): boolean
```

### 변경 범위 아닌 것

- `COMMAND_CHANGED` delta 처리: 기존과 동일
- CommandItem에 별도 order 필드 불필요 — 배열 인덱스가 곧 순서
