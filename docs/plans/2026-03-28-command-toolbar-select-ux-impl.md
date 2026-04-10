# Command Toolbar Select UX Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 커맨드 툴바를 아이콘-only 컴팩트 모드로 변경하고, 선택 → 실행 2단계 인터랙션 도입

**Architecture:** `CommandToolbar.tsx` 단일 파일 수정. `selectedId` 상태로 선택 관리, 롱프레스 게이지는 `requestAnimationFrame`으로 구현. 바깥 클릭 감지는 `useEffect` + `mousedown` 리스너.

**Tech Stack:** React, TypeScript, Tailwind CSS, Lucide Icons

---

### Task 1: 선택 상태 추가 및 클릭 분기

**Files:**
- Modify: `packages/client/src/components/chat/CommandToolbar.tsx`

**Step 1: import에 useState 추가, selectedId 상태 선언**

`useCallback, useRef`에 `useState` 추가:

```typescript
import { useCallback, useRef, useState, useEffect } from 'react';
```

컴포넌트 내부에 상태 추가:

```typescript
const [selectedId, setSelectedId] = useState<number | 'add' | null>(null);
```

**Step 2: 기존 handleExecute를 선택/실행 분기 로직으로 교체**

기존 `handleExecute` 콜백을 제거하고 `handleClick`으로 교체:

```typescript
const handleClick = useCallback(
  (cmdId: number) => {
    if (longPressFired.current) {
      longPressFired.current = false;
      return;
    }

    if (selectedId === cmdId) {
      // 선택된 버튼 재클릭 → 실행
      if (conversationId == null) return;
      const cmd = commands.find((c) => c.id === cmdId);
      if (cmd) {
        const tempMessage = {
          id: `cmd-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
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
      // 비선택 → 선택
      setSelectedId(cmdId);
    }
  },
  [selectedId, conversationId, commands]
);
```

**Step 3: 추가 버튼도 선택/실행 분기 핸들러 작성**

```typescript
const handleAddClick = useCallback(() => {
  if (selectedId === 'add') {
    // 선택된 추가 버튼 재클릭 → 생성 대화
    if (workspaceId) {
      commandManageConversation(workspaceId);
    }
    setSelectedId(null);
  } else {
    setSelectedId('add');
  }
}, [selectedId, workspaceId]);
```

**Step 4: JSX에서 onClick 핸들러 교체**

커맨드 버튼의 `onClick`을 `handleClick`으로, 추가 버튼의 `onClick`을 `handleAddClick`으로 변경.

**Step 5: 빌드 확인**

Run: `cd packages/client && pnpm build`
Expected: 빌드 성공

---

### Task 2: 버튼 외형 — 비선택은 아이콘만, 선택은 아이콘+이름+아웃라인

**Files:**
- Modify: `packages/client/src/components/chat/CommandToolbar.tsx`

**Step 1: 커맨드 버튼 JSX 수정**

비선택 시 아이콘만, 선택 시 아이콘+이름+아웃라인:

```tsx
{commands.map((cmd) => (
  <button
    key={cmd.id}
    onClick={() => handleClick(cmd.id)}
    onPointerDown={() => handlePointerDown(cmd.id)}
    onPointerUp={handlePointerUp}
    onPointerLeave={handlePointerUp}
    className={`relative flex items-center gap-1 rounded-md border transition-colors whitespace-nowrap shrink-0 overflow-hidden ${
      selectedId === cmd.id
        ? 'px-2 py-1 text-xs border-primary ring-1 ring-primary bg-secondary/50'
        : 'p-1 border-border bg-secondary/50 hover:bg-secondary'
    }`}
    title={cmd.name}
  >
    <CommandIcon icon={cmd.icon} color={cmd.color} />
    {selectedId === cmd.id && <span>{cmd.name}</span>}
  </button>
))}
```

**Step 2: 추가 버튼 JSX 수정**

비선택 시 + 아이콘만, 선택 시 + 아이콘 + "커맨드 추가" + 아웃라인:

```tsx
<button
  onClick={handleAddClick}
  className={`flex items-center gap-1 rounded-md border transition-colors shrink-0 ${
    selectedId === 'add'
      ? 'px-2 py-1 text-xs border-primary ring-1 ring-primary bg-secondary/50'
      : 'justify-center w-6 h-6 border-dashed border-border hover:bg-secondary/50'
  }`}
  title="커맨드 추가"
>
  <Plus className="h-3 w-3 text-muted-foreground" />
  {selectedId === 'add' && <span className="text-xs text-muted-foreground">커맨드 추가</span>}
</button>
```

**Step 3: 빌드 확인**

Run: `cd packages/client && pnpm build`
Expected: 빌드 성공

---

### Task 3: 바깥 클릭 시 선택 해제

**Files:**
- Modify: `packages/client/src/components/chat/CommandToolbar.tsx`

**Step 1: 툴바에 ref 추가**

```typescript
const toolbarRef = useRef<HTMLDivElement>(null);
```

**Step 2: useEffect로 바깥 클릭 감지**

```typescript
useEffect(() => {
  if (selectedId == null) return;

  const handleOutsideClick = (e: MouseEvent) => {
    if (toolbarRef.current && !toolbarRef.current.contains(e.target as Node)) {
      setSelectedId(null);
    }
  };

  document.addEventListener('mousedown', handleOutsideClick);
  return () => document.removeEventListener('mousedown', handleOutsideClick);
}, [selectedId]);
```

**Step 3: JSX의 최상위 div에 ref 연결**

```tsx
<div ref={toolbarRef} className="relative px-3 py-1.5">
```

**Step 4: 빌드 확인**

Run: `cd packages/client && pnpm build`
Expected: 빌드 성공

---

### Task 4: 롱프레스 — 선택된 버튼에서만 동작 + 게이지 표시

**Files:**
- Modify: `packages/client/src/components/chat/CommandToolbar.tsx`

**Step 1: 롱프레스 게이지 상태 추가**

```typescript
const [longPressProgress, setLongPressProgress] = useState(0);
const longPressStart = useRef<number | null>(null);
const longPressRaf = useRef<number | null>(null);
```

**Step 2: handlePointerDown을 선택된 버튼에서만 동작하도록 수정**

기존 `handlePointerDown`/`handlePointerUp` 제거 후 교체:

```typescript
const LONG_PRESS_DURATION = 500;

const handlePointerDown = useCallback((cmdId: number) => {
  // 선택된 일반 버튼에서만 롱프레스 동작
  if (selectedId !== cmdId) return;

  longPressFired.current = false;
  longPressStart.current = performance.now();
  setLongPressProgress(0);

  const animate = (now: number) => {
    if (!longPressStart.current) return;
    const elapsed = now - longPressStart.current;
    const progress = Math.min(elapsed / LONG_PRESS_DURATION, 1);
    setLongPressProgress(progress);

    if (progress >= 1) {
      // 완료
      longPressFired.current = true;
      longPressStart.current = null;
      longPressRaf.current = null;
      setLongPressProgress(0);
      if (workspaceId) {
        commandManageConversation(workspaceId, cmdId);
      }
      return;
    }
    longPressRaf.current = requestAnimationFrame(animate);
  };

  longPressRaf.current = requestAnimationFrame(animate);
}, [selectedId, workspaceId]);

const handlePointerUp = useCallback(() => {
  longPressStart.current = null;
  setLongPressProgress(0);
  if (longPressRaf.current) {
    cancelAnimationFrame(longPressRaf.current);
    longPressRaf.current = null;
  }
}, []);
```

**Step 3: 게이지 UI — 선택된 버튼 내부에 배경 fill 오버레이**

선택된 커맨드 버튼 내부에 게이지 div 추가:

```tsx
{selectedId === cmd.id && longPressProgress > 0 && (
  <div
    className="absolute inset-0 bg-primary/20 origin-left transition-none"
    style={{ transform: `scaleX(${longPressProgress})` }}
  />
)}
```

버튼에 `relative overflow-hidden`이 이미 있으므로 추가 클래스 불필요.

**Step 4: 추가 버튼에서 롱프레스 이벤트 제거**

추가 버튼에는 `onPointerDown`/`onPointerUp`/`onPointerLeave` 핸들러를 달지 않음.

**Step 5: 빌드 확인**

Run: `cd packages/client && pnpm build`
Expected: 빌드 성공

**Step 6: 커밋**

```bash
git add packages/client/src/components/chat/CommandToolbar.tsx
git commit -m "feat: command toolbar select UX with long-press gauge"
```

---

### Task 5: 수동 검증

**Step 1: 개발 서버로 확인**

Run: `cd packages/client && pnpm dev`

체크리스트:
- [ ] 툴바에 아이콘만 표시되는가
- [ ] 클릭 시 아이콘+이름 표시 + 아웃라인 강조
- [ ] 다른 버튼 클릭 시 선택 이동
- [ ] 선택된 버튼 재클릭 시 커맨드 실행
- [ ] 바깥 클릭 시 선택 해제
- [ ] 선택된 버튼 롱프레스 시 게이지 표시
- [ ] 게이지 완료 시 편집 세션 열림
- [ ] 비선택 버튼 롱프레스 시 아무 동작 없음
- [ ] 추가 버튼: 클릭 → "커맨드 추가" 표시, 재클릭 → 생성 대화
- [ ] 추가 버튼: 롱프레스 없음
