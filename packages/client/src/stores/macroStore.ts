import { create } from 'zustand';

export interface MacroItem {
  id: number;
  name: string;
  icon: string | null;
  color: string | null;
  content: string;
}

export interface MacroDelta {
  added?: { macro: MacroItem; workspaceIds: (number | null)[] }[];
  removed?: number[];
  updated?: MacroItem[];
}

interface MacroState {
  macrosByWorkspace: Map<number, MacroItem[]>;
  setWorkspaceMacros: (workspaceId: number, macros: MacroItem[]) => void;
  getMacrosForWorkspace: (workspaceId: number) => MacroItem[];
  reorderMacros: (workspaceId: number, macroIds: number[]) => void;
  applyDelta: (delta: MacroDelta) => void;
  reset: () => void;
}

export const useMacroStore = create<MacroState>((set, get) => ({
  macrosByWorkspace: new Map(),

  setWorkspaceMacros: (workspaceId, macros) => {
    set((state) => {
      const newMap = new Map(state.macrosByWorkspace);
      newMap.set(workspaceId, macros);
      return { macrosByWorkspace: newMap };
    });
  },

  getMacrosForWorkspace: (workspaceId) => {
    return get().macrosByWorkspace.get(workspaceId) ?? [];
  },

  reorderMacros: (workspaceId, macroIds) => {
    set((state) => {
      const newMap = new Map(state.macrosByWorkspace);
      const macros = newMap.get(workspaceId);
      if (!macros) return state;

      const reordered = macroIds
        .map(id => macros.find(c => c.id === id))
        .filter((c): c is MacroItem => c !== undefined);

      newMap.set(workspaceId, reordered);
      return { macrosByWorkspace: newMap };
    });
  },

  applyDelta: (delta) => {
    set((state) => {
      const newMap = new Map(state.macrosByWorkspace);

      // removed: 모든 워크스페이스에서 해당 매크로 제거
      if (delta.removed) {
        for (const macroId of delta.removed) {
          for (const [wsId, macros] of newMap) {
            newMap.set(wsId, macros.filter((c) => c.id !== macroId));
          }
        }
      }

      // updated: 모든 워크스페이스에서 해당 매크로 업데이트
      if (delta.updated) {
        for (const updated of delta.updated) {
          for (const [wsId, macros] of newMap) {
            newMap.set(
              wsId,
              macros.map((c) => (c.id === updated.id ? { ...c, ...updated } : c))
            );
          }
        }
      }

      // added: 지정된 워크스페이스에 추가 (null = 모든 알려진 워크스페이스)
      if (delta.added) {
        for (const { macro, workspaceIds } of delta.added) {
          const isGlobal = workspaceIds.includes(null);
          if (isGlobal) {
            for (const [wsId, macros] of newMap) {
              if (!macros.some((c) => c.id === macro.id)) {
                newMap.set(wsId, [...macros, macro]);
              }
            }
          } else {
            for (const wsId of workspaceIds) {
              if (wsId !== null) {
                const existing = newMap.get(wsId) ?? [];
                if (!existing.some((c) => c.id === macro.id)) {
                  newMap.set(wsId, [...existing, macro]);
                }
              }
            }
          }
        }
      }

      return { macrosByWorkspace: newMap };
    });
  },

  reset: () => set({ macrosByWorkspace: new Map() }),
}));
