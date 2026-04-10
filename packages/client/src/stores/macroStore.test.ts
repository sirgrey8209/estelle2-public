import { describe, it, expect, beforeEach } from 'vitest';
import { useMacroStore } from './macroStore';

describe('macroStore', () => {
  beforeEach(() => {
    useMacroStore.getState().reset();
  });

  it('초기 상태는 빈 Map', () => {
    expect(useMacroStore.getState().macrosByWorkspace.size).toBe(0);
  });

  it('setWorkspaceMacros로 워크스페이스별 매크로 설정', () => {
    useMacroStore.getState().setWorkspaceMacros(386, [
      { id: 1, name: 'Deploy', icon: 'rocket', color: '#22c55e', content: 'deploy' },
    ]);
    expect(useMacroStore.getState().macrosByWorkspace.get(386)).toHaveLength(1);
  });

  it('getMacrosForWorkspace로 특정 워크스페이스 매크로 조회', () => {
    useMacroStore.getState().setWorkspaceMacros(386, [
      { id: 1, name: 'Macro', icon: null, color: null, content: 'c' },
    ]);
    expect(useMacroStore.getState().getMacrosForWorkspace(386)).toHaveLength(1);
    expect(useMacroStore.getState().getMacrosForWorkspace(999)).toHaveLength(0);
  });

  it('applyDelta — added', () => {
    useMacroStore.getState().setWorkspaceMacros(386, []);
    useMacroStore.getState().applyDelta({
      added: [{ macro: { id: 1, name: 'New', icon: null, color: null, content: 'c' }, workspaceIds: [386] }],
    });
    expect(useMacroStore.getState().getMacrosForWorkspace(386)).toHaveLength(1);
  });

  it('applyDelta — removed', () => {
    useMacroStore.getState().setWorkspaceMacros(386, [
      { id: 1, name: 'Macro', icon: null, color: null, content: 'c' },
    ]);
    useMacroStore.getState().applyDelta({ removed: [1] });
    expect(useMacroStore.getState().getMacrosForWorkspace(386)).toHaveLength(0);
  });

  it('applyDelta — updated', () => {
    useMacroStore.getState().setWorkspaceMacros(386, [
      { id: 1, name: 'Old', icon: null, color: null, content: 'c' },
    ]);
    useMacroStore.getState().applyDelta({
      updated: [{ id: 1, name: 'New', icon: null, color: null, content: 'c' }],
    });
    expect(useMacroStore.getState().getMacrosForWorkspace(386)![0].name).toBe('New');
  });

  it('applyDelta — added with null workspaceId (global)', () => {
    useMacroStore.getState().setWorkspaceMacros(386, []);
    useMacroStore.getState().setWorkspaceMacros(512, []);
    useMacroStore.getState().applyDelta({
      added: [{ macro: { id: 1, name: 'Global', icon: null, color: null, content: 'g' }, workspaceIds: [null] }],
    });
    expect(useMacroStore.getState().getMacrosForWorkspace(386)).toHaveLength(1);
    expect(useMacroStore.getState().getMacrosForWorkspace(512)).toHaveLength(1);
  });

  it('reset으로 초기화', () => {
    useMacroStore.getState().setWorkspaceMacros(386, [
      { id: 1, name: 'Macro', icon: null, color: null, content: 'c' },
    ]);
    useMacroStore.getState().reset();
    expect(useMacroStore.getState().macrosByWorkspace.size).toBe(0);
  });
});
