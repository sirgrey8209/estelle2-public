import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MacroStore } from '../../src/stores/macro-store.js';

describe('MacroStore', () => {
  let store: MacroStore;

  beforeEach(() => {
    store = new MacroStore(':memory:');
  });

  afterEach(() => {
    store.close();
  });

  describe('createMacro', () => {
    it('should create a macro and return its id', () => {
      const id = store.createMacro('Review', 'search', '#ff0000', 'Review this code');
      expect(id).toBe(1);
    });

    it('should create macro with null icon and color', () => {
      const id = store.createMacro('Deploy', null, null, 'Deploy to production');
      expect(id).toBe(1);
    });
  });

  describe('getMacros', () => {
    it('should return global macros when querying workspace 0', () => {
      const id = store.createMacro('Global Cmd', 'star', null, 'global content');
      store.assignMacro(id, null);

      const macros = store.getMacros(0);
      expect(macros).toHaveLength(1);
      expect(macros[0]).toEqual({
        id, name: 'Global Cmd', icon: 'star', color: null, content: 'global content',
      });
    });

    it('should return workspace-specific macros', () => {
      const id = store.createMacro('WS Cmd', 'zap', '#00ff00', 'ws content');
      store.assignMacro(id, 42);

      const macros = store.getMacros(42);
      expect(macros).toHaveLength(1);
      expect(macros[0].name).toBe('WS Cmd');
    });

    it('should return only macros assigned to the queried workspace', () => {
      const id1 = store.createMacro('Cmd A', 'star', null, 'a');
      store.assignMacro(id1, 42);
      const id2 = store.createMacro('Cmd B', 'zap', null, 'b');
      store.assignMacro(id2, 42);

      const macros = store.getMacros(42);
      expect(macros).toHaveLength(2);
    });

    it('should not return macros for other workspaces', () => {
      const id = store.createMacro('Other', 'x', null, 'other');
      store.assignMacro(id, 99);

      const macros = store.getMacros(42);
      expect(macros).toHaveLength(0);
    });

    it('should not return global macros for non-zero workspace', () => {
      const id = store.createMacro('Global', null, null, 'g');
      store.assignMacro(id, null); // global (workspace_id = 0)

      const macros = store.getMacros(42);
      expect(macros).toHaveLength(0);
    });

    it('should include content in list response', () => {
      const id = store.createMacro('Cmd', null, null, 'secret content');
      store.assignMacro(id, 1);

      const macros = store.getMacros(1);
      expect(macros[0]).toHaveProperty('content', 'secret content');
    });
  });

  describe('getContent', () => {
    it('should return content for a valid macro id', () => {
      const id = store.createMacro('Cmd', null, null, 'the content');
      expect(store.getContent(id)).toBe('the content');
    });

    it('should return null for non-existent macro id', () => {
      expect(store.getContent(999)).toBeNull();
    });
  });

  describe('updateMacro', () => {
    it('should update name', () => {
      const id = store.createMacro('Old', 'star', null, 'content');
      store.updateMacro(id, { name: 'New' });
      store.assignMacro(id, 1);

      const macros = store.getMacros(1);
      expect(macros[0].name).toBe('New');
    });

    it('should update content', () => {
      const id = store.createMacro('Cmd', null, null, 'old content');
      store.updateMacro(id, { content: 'new content' });
      expect(store.getContent(id)).toBe('new content');
    });

    it('should return false for non-existent macro', () => {
      const result = store.updateMacro(999, { name: 'x' });
      expect(result).toBe(false);
    });
  });

  describe('deleteMacro', () => {
    it('should delete macro and its assignments', () => {
      const id = store.createMacro('Cmd', null, null, 'content');
      store.assignMacro(id, null);
      store.assignMacro(id, 42);

      store.deleteMacro(id);

      expect(store.getContent(id)).toBeNull();
      expect(store.getMacros(42)).toHaveLength(0);
    });
  });

  describe('getMacrosByWorkspaces', () => {
    it('should return macros grouped by workspaceId', () => {
      const cmd1 = store.createMacro('Cmd1', 'star', null, 'c1');
      store.assignMacro(cmd1, 42);
      store.assignMacro(cmd1, 99);
      const cmd2 = store.createMacro('Cmd2', 'zap', null, 'c2');
      store.assignMacro(cmd2, 42);

      const result = store.getMacrosByWorkspaces([42, 99]);
      expect(result.get(42)).toHaveLength(2);
      expect(result.get(99)).toHaveLength(1);
    });
  });

  describe('getAssignedWorkspaceIds', () => {
    it('should return assigned workspace ids', () => {
      const id = store.createMacro('Cmd', null, null, 'c');
      store.assignMacro(id, null);
      store.assignMacro(id, 42);
      const wsIds = store.getAssignedWorkspaceIds(id);
      expect(wsIds).toContain(null);
      expect(wsIds).toContain(42);
    });

    it('should convert internal 0 back to null for global assignments', () => {
      const id = store.createMacro('Cmd', null, null, 'c');
      store.assignMacro(id, null);
      const wsIds = store.getAssignedWorkspaceIds(id);
      expect(wsIds).toEqual([null]);
    });
  });

  describe('getMacroById', () => {
    it('should return full macro data', () => {
      const id = store.createMacro('Cmd', 'star', '#ff0', 'content');
      const cmd = store.getMacroById(id);
      expect(cmd).toEqual({ id, name: 'Cmd', icon: 'star', color: '#ff0', content: 'content' });
    });

    it('should return null for non-existent id', () => {
      expect(store.getMacroById(999)).toBeNull();
    });
  });

  describe('assignMacro / unassignMacro', () => {
    it('should assign macro to workspace', () => {
      const id = store.createMacro('Cmd', null, null, 'c');
      store.assignMacro(id, 42);

      expect(store.getMacros(42)).toHaveLength(1);
    });

    it('should unassign macro from workspace', () => {
      const id = store.createMacro('Cmd', null, null, 'c');
      store.assignMacro(id, 42);
      store.unassignMacro(id, 42);

      expect(store.getMacros(42)).toHaveLength(0);
    });

    it('should not duplicate assignments', () => {
      const id = store.createMacro('Cmd', null, null, 'c');
      store.assignMacro(id, 42);
      store.assignMacro(id, 42);

      expect(store.getMacros(42)).toHaveLength(1);
    });

    it('should not duplicate global (null) assignments', () => {
      const id = store.createMacro('Cmd', null, null, 'c');
      store.assignMacro(id, null);
      store.assignMacro(id, null); // duplicate

      const macros = store.getMacros(0);
      expect(macros).toHaveLength(1);
    });

    it('should allow same macro to be assigned to both global and workspace', () => {
      const id = store.createMacro('Both', 'star', null, 'both content');
      store.assignMacro(id, null); // global (internally 0)
      store.assignMacro(id, 42);  // workspace-specific

      expect(store.getMacros(0)).toHaveLength(1);
      expect(store.getMacros(42)).toHaveLength(1);
      expect(store.getMacros(0)[0].name).toBe('Both');
      expect(store.getMacros(42)[0].name).toBe('Both');
    });
  });

  describe('global macro propagation', () => {
    it('propagateGlobalMacros should register all global macros to a workspace', () => {
      const id1 = store.createMacro('G1', null, null, 'g1');
      const id2 = store.createMacro('G2', null, null, 'g2');
      store.assignMacro(id1, null); // global
      store.assignMacro(id2, null); // global

      store.propagateGlobalMacros(42);

      const macros = store.getMacros(42);
      expect(macros).toHaveLength(2);
      expect(macros.map(c => c.id)).toEqual([id1, id2]);
    });

    it('propagateGlobalMacros should preserve global order', () => {
      const id1 = store.createMacro('G1', null, null, 'g1');
      const id2 = store.createMacro('G2', null, null, 'g2');
      store.assignMacro(id1, null);
      store.assignMacro(id2, null);
      store.reorderMacros(0, [id2, id1]); // global order: id2 first

      store.propagateGlobalMacros(42);

      const macros = store.getMacros(42);
      expect(macros.map(c => c.id)).toEqual([id2, id1]);
    });

    it('propagateGlobalMacros should skip already-assigned macros', () => {
      const id1 = store.createMacro('G1', null, null, 'g1');
      store.assignMacro(id1, null);
      store.assignMacro(id1, 42); // already in workspace

      store.propagateGlobalMacros(42); // should not duplicate

      const macros = store.getMacros(42);
      expect(macros).toHaveLength(1);
    });

    it('propagateGlobalToAllWorkspaces should add macro to all workspaces', () => {
      // 워크스페이스 10, 20에 기존 매크로가 있음
      const existing = store.createMacro('Existing', null, null, 'e');
      store.assignMacro(existing, 10);
      store.assignMacro(existing, 20);

      // 새 글로벌 매크로 생성
      const globalCmd = store.createMacro('NewGlobal', null, null, 'ng');
      store.assignMacro(globalCmd, null);

      store.propagateGlobalToAllWorkspaces(globalCmd);

      // 워크스페이스 10, 20에 모두 추가됨 (맨 뒤 order)
      expect(store.getMacros(10).map(c => c.id)).toContain(globalCmd);
      expect(store.getMacros(20).map(c => c.id)).toContain(globalCmd);
    });
  });

  describe('order management', () => {
    it('should return macros ordered by order column', () => {
      const id1 = store.createMacro('First', null, null, 'c1');
      const id2 = store.createMacro('Second', null, null, 'c2');
      const id3 = store.createMacro('Third', null, null, 'c3');
      store.assignMacro(id1, 42);
      store.assignMacro(id2, 42);
      store.assignMacro(id3, 42);

      // 기본 order는 0,1,2이므로 id 순서대로 나옴
      store.reorderMacros(42, [id3, id1, id2]);

      const macros = store.getMacros(42);
      expect(macros.map(c => c.id)).toEqual([id3, id1, id2]);
    });

    it('should maintain separate order per workspace', () => {
      const id1 = store.createMacro('A', null, null, 'a');
      const id2 = store.createMacro('B', null, null, 'b');
      store.assignMacro(id1, 10);
      store.assignMacro(id2, 10);
      store.assignMacro(id1, 20);
      store.assignMacro(id2, 20);

      store.reorderMacros(10, [id2, id1]);
      store.reorderMacros(20, [id1, id2]);

      expect(store.getMacros(10).map(c => c.id)).toEqual([id2, id1]);
      expect(store.getMacros(20).map(c => c.id)).toEqual([id1, id2]);
    });

    it('should assign with order at the end by default', () => {
      const id1 = store.createMacro('A', null, null, 'a');
      const id2 = store.createMacro('B', null, null, 'b');
      store.assignMacro(id1, 42);
      store.assignMacro(id2, 42);

      // 순서대로 추가하면 order가 0, 1이어야 함
      const macros = store.getMacros(42);
      expect(macros[0].id).toBe(id1);
      expect(macros[1].id).toBe(id2);
    });
  });
});
