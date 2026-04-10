# 파일런 탭 워크스페이스 드래그 순서 변경 — 구현 계획

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 파일런 탭에서 별(Star) 버튼을 드래그 핸들로 사용하여 워크스페이스 순서를 변경할 수 있게 한다.

**Architecture:** `WorkspaceHeader`의 별 버튼에 `dragHandleProps`를 연결하고, `stopPropagation()`으로 부모 롱프레스와의 충돌을 방지한다. 즐겨찾기 탭의 파일런 아이콘 드래그 핸들과 동일한 패턴.

**Tech Stack:** React, @dnd-kit/core, @dnd-kit/sortable

---

### Task 1: 별 버튼에 드래그 핸들 연결

**Files:**
- Modify: `packages/client/src/components/sidebar/WorkspaceSidebar.tsx:161-174`

**Step 1: 별 버튼을 드래그 핸들 겸용으로 변경**

기존 코드 (line 161-174):

```tsx
        ) : (
          <button
            onClick={handleFavoriteClick}
            className={cn(
              'p-0.5 rounded transition-colors',
              isFavorite
                ? 'text-yellow-500 hover:text-yellow-600'
                : 'text-muted-foreground hover:text-yellow-500'
            )}
            title={isFavorite ? '즐겨찾기 해제' : '즐겨찾기 추가'}
          >
            <Star className={cn('h-4 w-4', isFavorite && 'fill-current')} />
          </button>
        )}
```

변경 후:

```tsx
        ) : (
          <button
            {...dragHandleProps?.attributes}
            {...dragHandleProps?.listeners}
            onClick={handleFavoriteClick}
            onMouseDown={(e) => e.stopPropagation()}
            onPointerDown={(e) => {
              const handler = dragHandleProps?.listeners?.onPointerDown as ((e: React.PointerEvent) => void) | undefined;
              handler?.(e);
              e.stopPropagation();
            }}
            onTouchStart={(e) => {
              const handler = dragHandleProps?.listeners?.onTouchStart as ((e: React.TouchEvent) => void) | undefined;
              handler?.(e);
              e.stopPropagation();
            }}
            className={cn(
              'p-0.5 rounded transition-colors cursor-grab active:cursor-grabbing touch-none',
              isFavorite
                ? 'text-yellow-500 hover:text-yellow-600'
                : 'text-muted-foreground hover:text-yellow-500'
            )}
            title={isFavorite ? '즐겨찾기 해제' : '즐겨찾기 추가'}
          >
            <Star className={cn('h-4 w-4', isFavorite && 'fill-current')} />
          </button>
        )}
```

핵심 변경점:
- `dragHandleProps?.attributes`와 `dragHandleProps?.listeners` 스프레드
- `onMouseDown`: `stopPropagation()`으로 부모 롱프레스 차단
- `onPointerDown`: dnd-kit 핸들러 호출 후 `stopPropagation()`
- `onTouchStart`: dnd-kit 핸들러 호출 후 `stopPropagation()`
- `className`에 `cursor-grab active:cursor-grabbing touch-none` 추가

**Step 2: 타입 체크 실행**

Run: `cd /home/estelle/estelle2 && pnpm typecheck`
Expected: 에러 없음

**Step 3: 커밋**

```bash
git add packages/client/src/components/sidebar/WorkspaceSidebar.tsx
git commit -m "feat: enable workspace drag reorder on pylon tab star button"
```
