import { useCallback, useRef, useState, useEffect } from 'react';
import * as LucideIcons from 'lucide-react';
import { Plus, Pencil, Trash2, X } from 'lucide-react';
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
import { useMacroStore } from '../../stores/macroStore';
import { useConversationStore } from '../../stores/conversationStore';
import { executeMacro, macroManageConversation, reorderMacros, unassignMacroFromWorkspace } from '../../services/relaySender';
import type { MacroItem } from '../../stores/macroStore';
import type { StoreMessage } from '@estelle/core';

interface MacroToolbarProps {
  conversationId: number | null;
  workspaceId: number | null;
  disabled?: boolean;
  getText?: () => string;
  clearText?: () => void;
}

/**
 * Lucide 아이콘 이름(kebab-case)을 PascalCase로 변환하여 컴포넌트 가져오기
 */
function getLucideIcon(name: string): LucideIcons.LucideIcon | null {
  const pascalCase = name
    .split('-')
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join('');
  return (
    ((LucideIcons as Record<string, unknown>)[pascalCase] as LucideIcons.LucideIcon | undefined) ??
    null
  );
}

/**
 * 문자열이 이모지로 시작하는지 판별
 */
function isEmoji(str: string): boolean {
  return /^\p{Emoji_Presentation}/u.test(str);
}

/**
 * 매크로 아이콘 렌더링
 */
function MacroIcon({ icon, color }: { icon: string | null; color: string | null }) {
  if (!icon) return null;

  if (isEmoji(icon)) {
    return <span className="text-sm leading-none">{icon}</span>;
  }

  const LucideIcon = getLucideIcon(icon);
  if (LucideIcon) {
    return <LucideIcon className="h-3.5 w-3.5" style={color ? { color } : undefined} />;
  }

  // 아이콘을 찾지 못하면 텍스트로 표시
  return <span className="text-xs leading-none">{icon}</span>;
}

/**
 * 드래그 가능한 매크로 버튼 (dnd-kit sortable)
 */
interface SortableMacroButtonProps {
  cmd: MacroItem;
  isSelected: boolean;
  isEditMode: boolean;
  onClick: () => void;
}

function SortableMacroButton({ cmd, isSelected, isEditMode, onClick }: SortableMacroButtonProps) {
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
          <MacroIcon icon={cmd.icon} color={cmd.color} />
          {isSelected && <span>{cmd.name}</span>}
        </span>
      </button>
    </div>
  );
}

/**
 * 매크로 툴바
 * - 클릭으로 선택, 선택된 상태에서 클릭으로 실행
 * - 툴바 롱프레스(500ms) → 편집 모드 진입
 * - 편집 모드에서 드래그로 순서 변경, 편집/삭제 가능
 * - + 버튼 → 선택 후 클릭으로 새 매크로 생성 대화
 */
const EDIT_LONG_PRESS_DURATION = 500;

export function MacroToolbar({ conversationId, workspaceId, disabled = false, getText, clearText }: MacroToolbarProps) {
  const macrosByWorkspace = useMacroStore((state) => state.macrosByWorkspace);
  const macros = workspaceId ? (macrosByWorkspace.get(workspaceId) ?? []) : [];

  const [selectedId, setSelectedId] = useState<number | 'add' | null>(null);
  const [isEditMode, setIsEditMode] = useState(false);
  const [editGaugeProgress, setEditGaugeProgress] = useState(0);
  const editLongPressStart = useRef<number | null>(null);
  const editLongPressRaf = useRef<number | null>(null);

  const toolbarRef = useRef<HTMLDivElement>(null);

  // Clear selection when disabled transitions to true
  useEffect(() => {
    if (disabled) {
      setSelectedId(null);
    }
  }, [disabled]);

  // Outside click: deselect when clicking outside toolbar
  useEffect(() => {
    if (selectedId == null && !isEditMode) return;

    const handleMouseDown = (e: MouseEvent) => {
      if (toolbarRef.current && !toolbarRef.current.contains(e.target as Node)) {
        setSelectedId(null);
        setIsEditMode(false);
      }
    };

    document.addEventListener('mousedown', handleMouseDown);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
    };
  }, [selectedId, isEditMode]);

  const selectedMacro = typeof selectedId === 'number'
    ? macros.find(c => c.id === selectedId) ?? null
    : null;

  // Cleanup rAF on unmount
  useEffect(() => {
    return () => {
      if (editLongPressRaf.current != null) {
        cancelAnimationFrame(editLongPressRaf.current);
      }
    };
  }, []);

  // Toolbar long-press → gauge animation → edit mode
  const handleToolbarPointerDown = useCallback(() => {
    if (isEditMode) return;

    editLongPressStart.current = performance.now();
    setEditGaugeProgress(0);

    const animate = () => {
      if (editLongPressStart.current == null) return;

      const elapsed = performance.now() - editLongPressStart.current;
      const progress = Math.min(elapsed / EDIT_LONG_PRESS_DURATION, 1);
      setEditGaugeProgress(progress);

      if (progress >= 1) {
        setIsEditMode(true);
        editLongPressStart.current = null;
        editLongPressRaf.current = null;
        setEditGaugeProgress(0);
        return;
      }

      editLongPressRaf.current = requestAnimationFrame(animate);
    };

    editLongPressRaf.current = requestAnimationFrame(animate);
  }, [isEditMode]);

  const handleToolbarPointerUp = useCallback(() => {
    if (editLongPressRaf.current != null) {
      cancelAnimationFrame(editLongPressRaf.current);
      editLongPressRaf.current = null;
    }
    editLongPressStart.current = null;
    setEditGaugeProgress(0);
  }, []);

  const handleMacroClick = useCallback(
    (macroId: number) => {
      if (disabled) return;

      if (isEditMode) {
        // 편집 모드에서는 선택만 (실행하지 않음)
        setSelectedId(macroId);
        return;
      }

      if (selectedId === macroId) {
        // 선택된 버튼 클릭 → 실행 후 선택 해제
        if (conversationId == null) return;

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
      } else {
        // 미선택 또는 다른 버튼 클릭 → 선택
        setSelectedId(macroId);
      }
    },
    [selectedId, conversationId, macros, isEditMode, disabled, getText, clearText]
  );

  const handleAddClick = useCallback(() => {
    if (disabled) return;

    if (selectedId === 'add') {
      // 선택된 상태에서 클릭 → 실행 후 선택 해제
      if (workspaceId) {
        macroManageConversation(workspaceId);
      }
      setSelectedId(null);
    } else {
      // 미선택 → 선택
      setSelectedId('add');
    }
  }, [selectedId, workspaceId, disabled]);

  const handleEdit = useCallback(() => {
    if (!selectedMacro || !workspaceId) return;
    macroManageConversation(workspaceId, selectedMacro.id);
    setIsEditMode(false);
    setSelectedId(null);
  }, [selectedMacro, workspaceId]);

  const handleDelete = useCallback(() => {
    if (!selectedMacro || !workspaceId) return;
    unassignMacroFromWorkspace(selectedMacro.id, workspaceId);
    setSelectedId(null);
  }, [selectedMacro, workspaceId]);

  // dnd-kit sensors
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

      const oldIndex = macros.findIndex(c => c.id === active.id);
      const newIndex = macros.findIndex(c => c.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return;

      const newOrder = arrayMove(macros, oldIndex, newIndex);
      const newIds = newOrder.map(c => c.id);

      // 낙관적 업데이트
      useMacroStore.getState().reorderMacros(workspaceId, newIds);
      // 서버 동기화
      reorderMacros(workspaceId, newIds);
    },
    [macros, workspaceId]
  );

  return (
    <div
      className={`relative px-3 py-1.5 w-fit overflow-hidden rounded-md${disabled ? ' opacity-50 pointer-events-none' : ''}`}
      ref={toolbarRef}
      onPointerDown={handleToolbarPointerDown}
      onPointerUp={handleToolbarPointerUp}
      onPointerLeave={handleToolbarPointerUp}
    >
      {/* 편집 모드 바 */}
      {isEditMode && (
        <div className="flex items-center gap-1.5 px-1 py-1 mb-1 rounded-md bg-muted/50 border border-border text-xs">
          <span className="text-muted-foreground truncate min-w-0 flex-1">
            {selectedMacro ? selectedMacro.name : '매크로를 선택하세요'}
          </span>
          <button
            onClick={handleEdit}
            disabled={!selectedMacro}
            className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-muted-foreground hover:bg-secondary disabled:opacity-30 shrink-0"
          >
            <Pencil className="h-3 w-3" />
            <span>편집</span>
          </button>
          <button
            onClick={handleDelete}
            disabled={!selectedMacro}
            className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-destructive hover:bg-destructive/10 disabled:opacity-30 shrink-0"
          >
            <Trash2 className="h-3 w-3" />
            <span>삭제</span>
          </button>
          <button
            onClick={() => { setIsEditMode(false); setSelectedId(null); }}
            className="flex items-center justify-center w-5 h-5 rounded hover:bg-secondary shrink-0"
          >
            <X className="h-3 w-3 text-muted-foreground" />
          </button>
        </div>
      )}

      {/* 롱프레스 게이지 */}
      {editGaugeProgress > 0 && (
        <div
          className="absolute inset-0 bg-primary/10 origin-left transition-none rounded-md pointer-events-none"
          style={{ transform: `scaleX(${editGaugeProgress})` }}
        />
      )}

      <div className="relative flex items-center gap-1.5 overflow-x-auto hide-scrollbar">
        {/* 매크로 버튼들 (DndContext) */}
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={macros.map(c => c.id)}
            strategy={horizontalListSortingStrategy}
          >
            {macros.map((macro) => (
              <SortableMacroButton
                key={macro.id}
                cmd={macro}
                isSelected={selectedId === macro.id}
                isEditMode={isEditMode}
                onClick={() => handleMacroClick(macro.id)}
              />
            ))}
          </SortableContext>
        </DndContext>

        {/* + 추가 버튼 */}
        {(() => {
          const isAddSelected = selectedId === 'add';
          return (
            <button
              onClick={handleAddClick}
              className={`flex items-center justify-center rounded-md border transition-colors shrink-0 ${
                isAddSelected
                  ? 'gap-1 px-2 py-1 border-2 border-primary bg-secondary/50 hover:bg-secondary'
                  : 'w-6 h-6 border-dashed border-border hover:bg-secondary/50'
              }`}
              title="매크로 추가"
            >
              <Plus className="h-3 w-3 text-muted-foreground" />
              {isAddSelected && <span className="text-xs text-muted-foreground whitespace-nowrap">매크로 추가</span>}
            </button>
          );
        })()}
      </div>
    </div>
  );
}
