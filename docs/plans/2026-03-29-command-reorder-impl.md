# 커맨드 버튼 순서 변경 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 커맨드 툴바에 편집 모드(롱프레스 진입)를 도입하여 드래그 앤 드롭으로 커맨드 순서를 변경하고, 편집/삭제 기능을 제공한다.

**Architecture:** command_assignments 테이블에 order 컬럼을 추가하고, 글로벌 커맨드가 워크스페이스에 자동 전파되는 구조로 변경한다. 클라이언트는 편집 모드에서 dnd-kit으로 드래그 순서 변경을 지원하며, COMMAND_REORDER 메시지로 Pylon에 동기화한다.

**Tech Stack:** SQLite (better-sqlite3), React, Zustand, @dnd-kit/core + @dnd-kit/sortable, WebSocket

---

### Task 1: CommandStore — order 컬럼 추가 및 쿼리 변경

**Files:**
- Modify: `packages/pylon/src/stores/command-store.ts`
- Test: `packages/pylon/tests/stores/command-store.test.ts`

**Step 1: Write the failing tests**

`packages/pylon/tests/stores/command-store.test.ts` 에 추가:

```typescript
describe('order management', () => {
  it('should return commands ordered by order column', () => {
    const id1 = store.createCommand('First', null, null, 'c1');
    const id2 = store.createCommand('Second', null, null, 'c2');
    const id3 = store.createCommand('Third', null, null, 'c3');
    store.assignCommand(id1, 42);
    store.assignCommand(id2, 42);
    store.assignCommand(id3, 42);

    // 기본 order는 0이므로 id 순서대로 나옴
    store.reorderCommands(42, [id3, id1, id2]);

    const commands = store.getCommands(42);
    expect(commands.map(c => c.id)).toEqual([id3, id1, id2]);
  });

  it('should maintain separate order per workspace', () => {
    const id1 = store.createCommand('A', null, null, 'a');
    const id2 = store.createCommand('B', null, null, 'b');
    store.assignCommand(id1, 10);
    store.assignCommand(id2, 10);
    store.assignCommand(id1, 20);
    store.assignCommand(id2, 20);

    store.reorderCommands(10, [id2, id1]);
    store.reorderCommands(20, [id1, id2]);

    expect(store.getCommands(10).map(c => c.id)).toEqual([id2, id1]);
    expect(store.getCommands(20).map(c => c.id)).toEqual([id1, id2]);
  });

  it('should assign with order at the end by default', () => {
    const id1 = store.createCommand('A', null, null, 'a');
    const id2 = store.createCommand('B', null, null, 'b');
    store.assignCommand(id1, 42);
    store.assignCommand(id2, 42);

    // 순서대로 추가하면 order가 0, 1이어야 함
    const commands = store.getCommands(42);
    expect(commands[0].id).toBe(id1);
    expect(commands[1].id).toBe(id2);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `pnpm --filter @estelle/pylon test -- tests/stores/command-store.test.ts`
Expected: FAIL — `reorderCommands` method not found

**Step 3: Implement schema migration and methods**

`packages/pylon/src/stores/command-store.ts` 변경:

1. `_initSchema()`에 마이그레이션 추가:
```typescript
private _initSchema(): void {
  this.db.exec(`
    CREATE TABLE IF NOT EXISTS commands (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      icon TEXT,
      color TEXT,
      content TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS command_assignments (
      command_id INTEGER NOT NULL REFERENCES commands(id) ON DELETE CASCADE,
      workspace_id INTEGER NOT NULL DEFAULT 0,
      "order" INTEGER NOT NULL DEFAULT 0,
      UNIQUE(command_id, workspace_id)
    );

    UPDATE command_assignments SET workspace_id = 0 WHERE workspace_id IS NULL;
  `);

  // order 컬럼 마이그레이션 (기존 DB에 컬럼이 없을 수 있음)
  const columns = this.db.pragma('table_info(command_assignments)') as { name: string }[];
  if (!columns.some(c => c.name === 'order')) {
    this.db.exec('ALTER TABLE command_assignments ADD COLUMN "order" INTEGER NOT NULL DEFAULT 0');
  }
}
```

2. `stmtGetCommands` 쿼리 변경:
```typescript
this.stmtGetCommands = this.db.prepare(
  'SELECT c.id, c.name, c.icon, c.color, c.content FROM commands c INNER JOIN command_assignments ca ON c.id = ca.command_id WHERE ca.workspace_id = ? ORDER BY ca."order" ASC'
);
```

3. `assignCommand` — 자동으로 맨 뒤 order 부여:
```typescript
assignCommand(commandId: number, workspaceId: number | null): void {
  const wsId = workspaceId ?? 0;
  // 현재 workspace의 최대 order 조회
  const maxOrder = this.stmtGetMaxOrder.get(wsId) as { max_order: number | null } | undefined;
  const nextOrder = (maxOrder?.max_order ?? -1) + 1;
  this.stmtAssign.run(commandId, wsId, nextOrder);
}
```

prepared statement 추가:
```typescript
private stmtGetMaxOrder!: Database.Statement;

// _prepareStatements()에서:
this.stmtGetMaxOrder = this.db.prepare(
  'SELECT MAX("order") as max_order FROM command_assignments WHERE workspace_id = ?'
);
this.stmtAssign = this.db.prepare(
  'INSERT OR IGNORE INTO command_assignments (command_id, workspace_id, "order") VALUES (?, ?, ?)'
);
```

4. `reorderCommands` 메서드 추가:
```typescript
reorderCommands(workspaceId: number, commandIds: number[]): boolean {
  const updateOrder = this.db.prepare(
    'UPDATE command_assignments SET "order" = ? WHERE command_id = ? AND workspace_id = ?'
  );
  const reorder = this.db.transaction((ids: number[]) => {
    for (let i = 0; i < ids.length; i++) {
      updateOrder.run(i, ids[i], workspaceId);
    }
  });
  reorder(commandIds);
  return true;
}
```

**Step 4: Run tests to verify they pass**

Run: `pnpm --filter @estelle/pylon test -- tests/stores/command-store.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/pylon/src/stores/command-store.ts packages/pylon/tests/stores/command-store.test.ts
git commit -m "feat(pylon): add order column to command_assignments and reorderCommands method"
```

---

### Task 2: CommandStore — 글로벌 커맨드 전파 메서드

**Files:**
- Modify: `packages/pylon/src/stores/command-store.ts`
- Test: `packages/pylon/tests/stores/command-store.test.ts`

**Step 1: Write the failing tests**

```typescript
describe('global command propagation', () => {
  it('propagateGlobalCommands should register all global commands to a workspace', () => {
    const id1 = store.createCommand('G1', null, null, 'g1');
    const id2 = store.createCommand('G2', null, null, 'g2');
    store.assignCommand(id1, null); // global
    store.assignCommand(id2, null); // global

    store.propagateGlobalCommands(42);

    const commands = store.getCommands(42);
    expect(commands).toHaveLength(2);
    expect(commands.map(c => c.id)).toEqual([id1, id2]);
  });

  it('propagateGlobalCommands should preserve global order', () => {
    const id1 = store.createCommand('G1', null, null, 'g1');
    const id2 = store.createCommand('G2', null, null, 'g2');
    store.assignCommand(id1, null);
    store.assignCommand(id2, null);
    store.reorderCommands(0, [id2, id1]); // global order: id2 first

    store.propagateGlobalCommands(42);

    const commands = store.getCommands(42);
    expect(commands.map(c => c.id)).toEqual([id2, id1]);
  });

  it('propagateGlobalCommands should skip already-assigned commands', () => {
    const id1 = store.createCommand('G1', null, null, 'g1');
    store.assignCommand(id1, null);
    store.assignCommand(id1, 42); // already in workspace

    store.propagateGlobalCommands(42); // should not duplicate

    const commands = store.getCommands(42);
    expect(commands).toHaveLength(1);
  });

  it('propagateGlobalToAllWorkspaces should add command to all workspaces', () => {
    // 워크스페이스 10, 20에 기존 커맨드가 있음
    const existing = store.createCommand('Existing', null, null, 'e');
    store.assignCommand(existing, 10);
    store.assignCommand(existing, 20);

    // 새 글로벌 커맨드 생성
    const globalCmd = store.createCommand('NewGlobal', null, null, 'ng');
    store.assignCommand(globalCmd, null);

    store.propagateGlobalToAllWorkspaces(globalCmd);

    // 워크스페이스 10, 20에 모두 추가됨 (맨 뒤 order)
    expect(store.getCommands(10).map(c => c.id)).toContain(globalCmd);
    expect(store.getCommands(20).map(c => c.id)).toContain(globalCmd);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `pnpm --filter @estelle/pylon test -- tests/stores/command-store.test.ts`
Expected: FAIL — methods not found

**Step 3: Implement propagation methods**

```typescript
/**
 * 글로벌 커맨드를 특정 워크스페이스에 전파
 * 워크스페이스 생성 시 호출. 글로벌 order를 유지.
 */
propagateGlobalCommands(workspaceId: number): void {
  const globalCommands = this.db.prepare(
    'SELECT command_id, "order" FROM command_assignments WHERE workspace_id = 0 ORDER BY "order" ASC'
  ).all() as { command_id: number; order: number }[];

  for (const gc of globalCommands) {
    this.db.prepare(
      'INSERT OR IGNORE INTO command_assignments (command_id, workspace_id, "order") VALUES (?, ?, ?)'
    ).run(gc.command_id, workspaceId, gc.order);
  }
}

/**
 * 특정 글로벌 커맨드를 모든 워크스페이스에 전파
 * 커맨드가 글로벌로 할당될 때 호출. order는 각 워크스페이스의 맨 뒤.
 */
propagateGlobalToAllWorkspaces(commandId: number): void {
  // 이미 등록된 워크스페이스 제외, 모든 고유 워크스페이스 조회
  const workspaces = this.db.prepare(
    'SELECT DISTINCT workspace_id FROM command_assignments WHERE workspace_id != 0 AND workspace_id NOT IN (SELECT workspace_id FROM command_assignments WHERE command_id = ? AND workspace_id != 0)'
  ).all(commandId) as { workspace_id: number }[];

  for (const ws of workspaces) {
    this.assignCommand(commandId, ws.workspace_id);
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `pnpm --filter @estelle/pylon test -- tests/stores/command-store.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/pylon/src/stores/command-store.ts packages/pylon/tests/stores/command-store.test.ts
git commit -m "feat(pylon): add global command propagation methods to CommandStore"
```

---

### Task 3: Core — 메시지 타입 추가

**Files:**
- Modify: `packages/core/src/constants/message-type.ts`

**Step 1: Add COMMAND_REORDER message type**

`packages/core/src/constants/message-type.ts`의 Command 섹션에 추가:

```typescript
  /** 커맨드 순서 변경 (Client → Pylon) */
  COMMAND_REORDER: 'command_reorder',
```

`COMMAND_MANAGE_CONVERSATION` 바로 위에 추가.

**Step 2: Commit**

```bash
git add packages/core/src/constants/message-type.ts
git commit -m "feat(core): add COMMAND_REORDER message type"
```

---

### Task 4: Pylon — COMMAND_REORDER 핸들러 + 글로벌 전파 연결

**Files:**
- Modify: `packages/pylon/src/pylon.ts`

**Step 1: Add COMMAND_REORDER handler registration**

`packages/pylon/src/pylon.ts`의 handleMessage 메서드에서, `command_manage_conversation` 핸들러 등록 근처(라인 1008 부근)에 추가:

```typescript
handlers.set('command_reorder', (payload) => {
  this.handleCommandReorder(payload);
});
```

**Step 2: Implement handleCommandReorder**

기존 `handleConversationReorder` (라인 1900) 근처에 추가:

```typescript
/**
 * command_reorder 처리
 */
private handleCommandReorder(payload: Record<string, unknown> | undefined): void {
  if (!this.deps.commandStore) return;

  const { workspaceId, commandIds } = payload || {};
  if (!workspaceId || !commandIds || !Array.isArray(commandIds)) return;

  this.deps.commandStore.reorderCommands(workspaceId as number, commandIds as number[]);
  this.broadcastWorkspaceList();
}
```

**Step 3: Hook global propagation into workspace creation**

`handleWorkspaceCreate` (라인 1779)에서, `this.broadcastWorkspaceList()` 호출 전에 추가:

```typescript
// 글로벌 커맨드를 새 워크스페이스에 전파
if (this.deps.commandStore) {
  this.deps.commandStore.propagateGlobalCommands(result.workspace.workspaceId);
}
```

**Step 4: Hook global propagation into command assign**

`handleCommandAssign` (라인 3875)에서, assign=true이고 workspaceId가 null(글로벌)일 때 전파 추가:

```typescript
private handleCommandAssign(
  payload: Record<string, unknown> | undefined,
  _from: MessageFrom | undefined
): void {
  if (!this.deps.commandStore) return;

  const commandId = payload?.commandId as number;
  const workspaceId = payload?.workspaceId as number | null;
  const assign = payload?.assign as boolean;
  if (!commandId || assign === undefined) return;

  if (assign) {
    this.deps.commandStore.assignCommand(commandId, workspaceId ?? null);
    // 글로벌 할당이면 모든 워크스페이스에 전파
    if (workspaceId === null || workspaceId === 0) {
      this.deps.commandStore.propagateGlobalToAllWorkspaces(commandId);
    }
  } else {
    this.deps.commandStore.unassignCommand(commandId, workspaceId ?? null);
  }
  this.broadcastWorkspaceList();
}
```

**Step 5: Change getCommands query call in broadcastWorkspaceList**

`broadcastWorkspaceList` (라인 2976)에서는 `getCommandsByWorkspaces`를 호출하는데, 이 메서드가 내부적으로 `getCommands`를 호출하므로 Task 1에서 쿼리를 변경하면 자동으로 ORDER BY가 적용됨. 별도 변경 불필요.

**Step 6: Commit**

```bash
git add packages/pylon/src/pylon.ts
git commit -m "feat(pylon): add COMMAND_REORDER handler and global command propagation"
```

---

### Task 5: Client — relaySender + commandStore 변경

**Files:**
- Modify: `packages/client/src/services/relaySender.ts`
- Modify: `packages/client/src/stores/commandStore.ts`
- Modify: `packages/client/src/hooks/useMessageRouter.ts`

**Step 1: Add reorderCommands to relaySender**

`packages/client/src/services/relaySender.ts`의 커맨드 섹션(라인 588 부근)에 추가:

```typescript
/**
 * 커맨드 순서 변경
 * - workspaceId에서 pylonId 추출하여 해당 Pylon에만 전송
 */
export function reorderCommands(workspaceId: number, commandIds: number[]): boolean {
  const pylonId = getPylonIdFromWorkspace(workspaceId);
  return sendMessage({
    type: MessageType.COMMAND_REORDER,
    payload: { workspaceId, commandIds },
    to: [pylonId],
  });
}

/**
 * 커맨드 워크스페이스 등록 해제 (편집바 삭제 버튼)
 */
export function unassignCommandFromWorkspace(commandId: number, workspaceId: number): boolean {
  const pylonId = getPylonIdFromWorkspace(workspaceId);
  return sendMessage({
    type: MessageType.COMMAND_ASSIGN,
    payload: { commandId, workspaceId, assign: false },
    to: [pylonId],
  });
}
```

**Step 2: Add reorderCommands to commandStore**

`packages/client/src/stores/commandStore.ts`에 `reorderCommands` 액션 추가:

```typescript
interface CommandState {
  commandsByWorkspace: Map<number, CommandItem[]>;
  setWorkspaceCommands: (workspaceId: number, commands: CommandItem[]) => void;
  getCommandsForWorkspace: (workspaceId: number) => CommandItem[];
  reorderCommands: (workspaceId: number, commandIds: number[]) => void;
  applyDelta: (delta: CommandDelta) => void;
  reset: () => void;
}

// create 콜백 내에 추가:
reorderCommands: (workspaceId, commandIds) => {
  set((state) => {
    const newMap = new Map(state.commandsByWorkspace);
    const commands = newMap.get(workspaceId);
    if (!commands) return state;

    const reordered = commandIds
      .map(id => commands.find(c => c.id === id))
      .filter((c): c is CommandItem => c !== undefined);

    newMap.set(workspaceId, reordered);
    return { commandsByWorkspace: newMap };
  });
},
```

**Step 3: Commit**

```bash
git add packages/client/src/services/relaySender.ts packages/client/src/stores/commandStore.ts
git commit -m "feat(client): add reorderCommands and unassignCommandFromWorkspace"
```

---

### Task 6: Client — CommandToolbar 편집 모드 UI

**Files:**
- Modify: `packages/client/src/components/chat/CommandToolbar.tsx`

이 태스크는 큰 변경이므로 서브 스텝별로 나눔.

**Step 1: 기존 롱프레스 로직 제거 및 편집 모드 상태 추가**

`CommandToolbar.tsx`에서:

1. 기존 `longPressProgress`, `longPressFired`, `longPressStart`, `longPressRaf` 상태/ref 제거
2. 기존 `handlePointerDown(cmdId)`, `handlePointerUp`, `cancelLongPress` 제거
3. 기존 `LONG_PRESS_DURATION` 상수 제거
4. 버튼의 `onPointerDown`, `onPointerUp`, `onPointerLeave` 제거
5. 롱프레스 게이지 JSX 제거

새로 추가:

```typescript
const [isEditMode, setIsEditMode] = useState(false);
const editLongPressStart = useRef<number | null>(null);
const editLongPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

const EDIT_LONG_PRESS_DURATION = 500;
```

**Step 2: 툴바 영역 롱프레스 → 편집 모드 진입**

```typescript
const handleToolbarPointerDown = useCallback(() => {
  editLongPressStart.current = Date.now();
  editLongPressTimer.current = setTimeout(() => {
    setIsEditMode(true);
    editLongPressStart.current = null;
  }, EDIT_LONG_PRESS_DURATION);
}, []);

const handleToolbarPointerUp = useCallback(() => {
  if (editLongPressTimer.current) {
    clearTimeout(editLongPressTimer.current);
    editLongPressTimer.current = null;
  }
  editLongPressStart.current = null;
}, []);
```

툴바 `<div>`에 적용:
```tsx
<div
  className="relative px-3 py-1.5"
  ref={toolbarRef}
  onPointerDown={handleToolbarPointerDown}
  onPointerUp={handleToolbarPointerUp}
  onPointerLeave={handleToolbarPointerUp}
>
```

**Step 3: 편집 모드에서 클릭 동작 변경**

`handleCommandClick` 수정 — 편집 모드에서는 선택만:

```typescript
const handleCommandClick = useCallback(
  (cmdId: number) => {
    if (isEditMode) {
      // 편집 모드에서는 선택만 (실행하지 않음)
      setSelectedId(cmdId);
      return;
    }

    if (selectedId === cmdId) {
      // 선택된 버튼 클릭 → 실행
      if (conversationId == null) return;
      const cmd = commands.find((c) => c.id === cmdId);
      if (cmd) {
        const tempMessage = {
          id: `cmd-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
          role: 'user' as const,
          type: 'command_execute' as const,
          content: cmd.content,
          timestamp: Date.now(),
          commandId: cmd.id,
          commandName: cmd.name,
          commandIcon: cmd.icon,
          commandColor: cmd.color,
          temporary: true,
        } as StoreMessage;
        useConversationStore.getState().addMessage(conversationId, tempMessage);
      }
      executeCommand(cmdId, conversationId);
      setSelectedId(null);
    } else {
      setSelectedId(cmdId);
    }
  },
  [selectedId, conversationId, commands, isEditMode]
);
```

**Step 4: 편집바 JSX 추가**

`return` 문 내에서, 커맨드 버튼 `<div>` 위에 추가:

```tsx
{isEditMode && (
  <div className="flex items-center gap-1.5 px-1 py-1 mb-1 rounded-md bg-muted/50 border border-border text-xs">
    {/* 선택된 커맨드 이름 */}
    <span className="text-muted-foreground truncate min-w-0 flex-1">
      {selectedCmd ? selectedCmd.name : '커맨드를 선택하세요'}
    </span>

    {/* 편집 버튼 */}
    <button
      onClick={handleEdit}
      disabled={!selectedCmd}
      className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-muted-foreground hover:bg-secondary disabled:opacity-30 shrink-0"
    >
      <Pencil className="h-3 w-3" />
      <span>편집</span>
    </button>

    {/* 삭제 버튼 */}
    <button
      onClick={handleDelete}
      disabled={!selectedCmd}
      className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-destructive hover:bg-destructive/10 disabled:opacity-30 shrink-0"
    >
      <Trash2 className="h-3 w-3" />
      <span>삭제</span>
    </button>

    {/* 닫기 버튼 */}
    <button
      onClick={() => setIsEditMode(false)}
      className="flex items-center justify-center w-5 h-5 rounded hover:bg-secondary shrink-0"
    >
      <X className="h-3 w-3 text-muted-foreground" />
    </button>
  </div>
)}
```

import 추가:
```typescript
import { Plus, Pencil, Trash2, X } from 'lucide-react';
```

selectedCmd 계산:
```typescript
const selectedCmd = typeof selectedId === 'number'
  ? commands.find(c => c.id === selectedId) ?? null
  : null;
```

**Step 5: 편집/삭제 핸들러**

```typescript
import { commandManageConversation, unassignCommandFromWorkspace } from '../../services/relaySender';

const handleEdit = useCallback(() => {
  if (!selectedCmd || !workspaceId) return;
  commandManageConversation(workspaceId, selectedCmd.id);
  setIsEditMode(false);
  setSelectedId(null);
}, [selectedCmd, workspaceId]);

const handleDelete = useCallback(() => {
  if (!selectedCmd || !workspaceId) return;
  unassignCommandFromWorkspace(selectedCmd.id, workspaceId);
  setSelectedId(null);
}, [selectedCmd, workspaceId]);
```

**Step 6: Commit**

```bash
git add packages/client/src/components/chat/CommandToolbar.tsx
git commit -m "feat(client): add edit mode with edit bar to CommandToolbar"
```

---

### Task 7: Client — CommandToolbar 드래그 앤 드롭

**Files:**
- Modify: `packages/client/src/components/chat/CommandToolbar.tsx`

**Step 1: Add dnd-kit imports and sensors**

```typescript
import {
  DndContext,
  closestCenter,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  horizontalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
```

**Step 2: Create SortableCommandButton component**

CommandToolbar 컴포넌트 위에 추가:

```typescript
interface SortableCommandButtonProps {
  cmd: CommandItem;
  isSelected: boolean;
  isEditMode: boolean;
  onClick: () => void;
}

function SortableCommandButton({ cmd, isSelected, isEditMode, onClick }: SortableCommandButtonProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: cmd.id, disabled: !isEditMode });

  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...(isEditMode ? { ...attributes, ...listeners } : {})}
      className={isDragging ? 'opacity-50' : ''}
    >
      <button
        onClick={onClick}
        className={`relative flex items-center gap-1 text-xs rounded-md transition-colors whitespace-nowrap shrink-0 overflow-hidden ${
          isSelected
            ? 'px-2 py-1 border-2 border-primary bg-secondary/50 hover:bg-secondary'
            : 'p-1 border border-border bg-secondary/50 hover:bg-secondary'
        }`}
        title={cmd.name}
      >
        <span className="relative flex items-center gap-1">
          <CommandIcon icon={cmd.icon} color={cmd.color} />
          {isSelected && <span>{cmd.name}</span>}
        </span>
      </button>
    </div>
  );
}
```

**Step 3: Integrate DndContext into CommandToolbar**

```typescript
const sensors = useSensors(
  useSensor(PointerSensor, {
    activationConstraint: { distance: 8 },
  }),
  useSensor(TouchSensor, {
    activationConstraint: { delay: 100, tolerance: 5 },
  })
);

const handleDragEnd = useCallback(
  (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id || !workspaceId) return;

    const oldIndex = commands.findIndex(c => c.id === active.id);
    const newIndex = commands.findIndex(c => c.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const newOrder = arrayMove(commands, oldIndex, newIndex);
    const newIds = newOrder.map(c => c.id);

    // 낙관적 업데이트
    useCommandStore.getState().reorderCommands(workspaceId, newIds);
    // 서버 동기화
    reorderCommands(workspaceId, newIds);
  },
  [commands, workspaceId]
);
```

import 추가:
```typescript
import { reorderCommands, unassignCommandFromWorkspace } from '../../services/relaySender';
```

커맨드 버튼 목록을 DndContext + SortableContext로 감싸기:

```tsx
<DndContext
  sensors={sensors}
  collisionDetection={closestCenter}
  onDragEnd={handleDragEnd}
>
  <SortableContext
    items={commands.map(c => c.id)}
    strategy={horizontalListSortingStrategy}
  >
    {commands.map((cmd) => (
      <SortableCommandButton
        key={cmd.id}
        cmd={cmd}
        isSelected={selectedId === cmd.id}
        isEditMode={isEditMode}
        onClick={() => handleCommandClick(cmd.id)}
      />
    ))}
  </SortableContext>
</DndContext>
```

참고: `horizontalListSortingStrategy`는 커맨드 툴바가 가로 배열이므로 적절.

**Step 4: Run dev server and manually test**

Run: `pnpm dev`
확인:
1. 툴바 롱프레스 → 편집 모드 진입
2. 편집 모드에서 버튼 드래그로 순서 변경
3. 편집바에서 편집/삭제 동작
4. X 버튼으로 편집 모드 종료
5. 일반 모드에서 기존 클릭 동작 유지

**Step 5: Commit**

```bash
git add packages/client/src/components/chat/CommandToolbar.tsx
git commit -m "feat(client): add drag-and-drop reorder in edit mode"
```

---

### Task 8: MCP tools — create_command 글로벌 전파 연결

**Files:**
- Modify: `packages/pylon/src/mcp/tools/command.ts`

**Step 1: Update executeCreateCommand**

`executeCreateCommand` (라인 126)에서, 글로벌 할당 시 전파 로직 추가.

기존 코드(라인 153-160):
```typescript
const assignedIds = (args.workspaceIds && args.workspaceIds.length > 0)
  ? args.workspaceIds
  : [null];

for (const wsId of assignedIds) {
  store.assignCommand(commandId, wsId);
}
```

변경:
```typescript
const assignedIds = (args.workspaceIds && args.workspaceIds.length > 0)
  ? args.workspaceIds
  : [null];

for (const wsId of assignedIds) {
  store.assignCommand(commandId, wsId);
}

// 글로벌 할당이면 모든 워크스페이스에 전파
if (assignedIds.includes(null)) {
  store.propagateGlobalToAllWorkspaces(commandId);
}
```

**Step 2: Update executeAssignCommand**

`executeAssignCommand` (라인 357)에서, 글로벌 할당 시 전파 추가.

기존 코드(라인 382-384):
```typescript
for (const wsId of args.workspaceIds) {
  store.assignCommand(args.commandId, wsId);
}
```

변경:
```typescript
for (const wsId of args.workspaceIds) {
  store.assignCommand(args.commandId, wsId);
}

// 글로벌 할당이면 모든 워크스페이스에 전파
if (args.workspaceIds.includes(null)) {
  store.propagateGlobalToAllWorkspaces(args.commandId);
}
```

**Step 3: Commit**

```bash
git add packages/pylon/src/mcp/tools/command.ts
git commit -m "feat(pylon): propagate global commands on create and assign"
```

---

### Task 9: 전체 빌드 & 타입 체크

**Step 1: Run typecheck**

Run: `pnpm typecheck`
Expected: 에러 없음

**Step 2: Run full tests**

Run: `pnpm test`
Expected: 모든 테스트 통과

**Step 3: Fix any issues**

타입 에러나 테스트 실패가 있으면 수정.

**Step 4: Commit (if fixes needed)**

```bash
git add -A
git commit -m "fix: resolve type/test issues from command reorder feature"
```
