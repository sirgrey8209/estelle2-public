/**
 * @file macro-store.ts
 * @description MacroStore - 매크로 툴바용 매크로 저장소 (SQLite 기반)
 *
 * 워크스페이스별 매크로 버튼 데이터를 관리하는 SQLite 기반 저장소입니다.
 *
 * @example
 * ```typescript
 * const store = new MacroStore('data/macros.db');
 * const id = store.createMacro('Review', 'search', '#ff0000', 'Review this code');
 * store.assignMacro(id, null); // 글로벌
 * const macros = store.getMacros(workspaceId);
 * store.close();
 * ```
 */

import Database from 'better-sqlite3';

export interface MacroListItem {
  id: number;
  name: string;
  icon: string | null;
  color: string | null;
  content: string;
}

export class MacroStore {
  private db: Database.Database;
  private stmtInsertMacro!: Database.Statement;
  private stmtDeleteMacro!: Database.Statement;
  private stmtGetContent!: Database.Statement;
  private stmtGetMacros!: Database.Statement;
  private stmtAssign!: Database.Statement;
  private stmtUnassign!: Database.Statement;
  private stmtGetMaxOrder!: Database.Statement;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this._initSchema();
    this._prepareStatements();
  }

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

  private _prepareStatements(): void {
    this.stmtInsertMacro = this.db.prepare(
      'INSERT INTO commands (name, icon, color, content) VALUES (?, ?, ?, ?)'
    );
    this.stmtDeleteMacro = this.db.prepare('DELETE FROM commands WHERE id = ?');
    this.stmtGetContent = this.db.prepare('SELECT content FROM commands WHERE id = ?');
    this.stmtGetMacros = this.db.prepare(
      'SELECT c.id, c.name, c.icon, c.color, c.content FROM commands c INNER JOIN command_assignments ca ON c.id = ca.command_id WHERE ca.workspace_id = ? ORDER BY ca."order" ASC'
    );
    this.stmtGetMaxOrder = this.db.prepare(
      'SELECT MAX("order") as max_order FROM command_assignments WHERE workspace_id = ?'
    );
    this.stmtAssign = this.db.prepare(
      'INSERT OR IGNORE INTO command_assignments (command_id, workspace_id, "order") VALUES (?, ?, ?)'
    );
    this.stmtUnassign = this.db.prepare(
      'DELETE FROM command_assignments WHERE command_id = ? AND workspace_id = ?'
    );
  }

  createMacro(name: string, icon: string | null, color: string | null, content: string): number {
    const result = this.stmtInsertMacro.run(name, icon, color, content);
    return Number(result.lastInsertRowid);
  }

  updateMacro(id: number, fields: { name?: string; icon?: string; color?: string; content?: string }): boolean {
    const setClauses: string[] = [];
    const values: unknown[] = [];

    if (fields.name !== undefined) { setClauses.push('name = ?'); values.push(fields.name); }
    if (fields.icon !== undefined) { setClauses.push('icon = ?'); values.push(fields.icon); }
    if (fields.color !== undefined) { setClauses.push('color = ?'); values.push(fields.color); }
    if (fields.content !== undefined) { setClauses.push('content = ?'); values.push(fields.content); }

    if (setClauses.length === 0) return false;

    values.push(id);
    const stmt = this.db.prepare(`UPDATE commands SET ${setClauses.join(', ')} WHERE id = ?`);
    const result = stmt.run(...values);
    return result.changes > 0;
  }

  deleteMacro(id: number): boolean {
    const result = this.stmtDeleteMacro.run(id);
    return result.changes > 0;
  }

  getContent(id: number): string | null {
    const row = this.stmtGetContent.get(id) as { content: string } | undefined;
    return row?.content ?? null;
  }

  getMacros(workspaceId: number): MacroListItem[] {
    return this.stmtGetMacros.all(workspaceId) as MacroListItem[];
  }

  assignMacro(macroId: number, workspaceId: number | null): void {
    const wsId = workspaceId ?? 0;
    const maxOrder = this.stmtGetMaxOrder.get(wsId) as { max_order: number | null } | undefined;
    const nextOrder = (maxOrder?.max_order ?? -1) + 1;
    this.stmtAssign.run(macroId, wsId, nextOrder);
  }

  reorderMacros(workspaceId: number, macroIds: number[]): boolean {
    const updateOrder = this.db.prepare(
      'UPDATE command_assignments SET "order" = ? WHERE command_id = ? AND workspace_id = ?'
    );
    const reorder = this.db.transaction((ids: number[]) => {
      for (let i = 0; i < ids.length; i++) {
        updateOrder.run(i, ids[i], workspaceId);
      }
    });
    reorder(macroIds);
    return true;
  }

  /**
   * 글로벌 매크로를 특정 워크스페이스에 전파
   * 워크스페이스 생성 시 호출. 글로벌 order를 유지.
   */
  propagateGlobalMacros(workspaceId: number): void {
    const globalMacros = this.db.prepare(
      'SELECT command_id, "order" FROM command_assignments WHERE workspace_id = 0 ORDER BY "order" ASC'
    ).all() as { command_id: number; order: number }[];

    for (const gc of globalMacros) {
      this.db.prepare(
        'INSERT OR IGNORE INTO command_assignments (command_id, workspace_id, "order") VALUES (?, ?, ?)'
      ).run(gc.command_id, workspaceId, gc.order);
    }
  }

  /**
   * 특정 글로벌 매크로를 모든 워크스페이스에 전파
   * 매크로가 글로벌로 할당될 때 호출. order는 각 워크스페이스의 맨 뒤.
   *
   * @param macroId - 전파할 매크로 ID
   * @param allWorkspaceIds - 전체 워크스페이스 ID 목록 (WorkspaceStore에서 제공)
   */
  propagateGlobalToAllWorkspaces(macroId: number, allWorkspaceIds?: number[]): void {
    if (allWorkspaceIds) {
      // 워크스페이스 목록이 주어지면 이미 할당된 것만 제외하고 전파
      const assigned = new Set(
        (this.db.prepare(
          'SELECT workspace_id FROM command_assignments WHERE command_id = ? AND workspace_id != 0'
        ).all(macroId) as { workspace_id: number }[]).map(r => r.workspace_id)
      );
      for (const wsId of allWorkspaceIds) {
        if (!assigned.has(wsId)) {
          this.assignMacro(macroId, wsId);
        }
      }
    } else {
      // 폴백: DB에 기록된 워크스페이스만 대상 (하위 호환)
      const workspaces = this.db.prepare(
        'SELECT DISTINCT workspace_id FROM command_assignments WHERE workspace_id != 0 AND workspace_id NOT IN (SELECT workspace_id FROM command_assignments WHERE command_id = ? AND workspace_id != 0)'
      ).all(macroId) as { workspace_id: number }[];
      for (const ws of workspaces) {
        this.assignMacro(macroId, ws.workspace_id);
      }
    }
  }

  unassignMacro(macroId: number, workspaceId: number | null): void {
    this.stmtUnassign.run(macroId, workspaceId ?? 0);
  }

  getMacrosByWorkspaces(workspaceIds: number[]): Map<number, MacroListItem[]> {
    const result = new Map<number, MacroListItem[]>();
    for (const wsId of workspaceIds) {
      result.set(wsId, this.getMacros(wsId));
    }
    return result;
  }

  getAssignedWorkspaceIds(macroId: number): (number | null)[] {
    const stmt = this.db.prepare(
      'SELECT workspace_id FROM command_assignments WHERE command_id = ?'
    );
    const rows = stmt.all(macroId) as { workspace_id: number }[];
    return rows.map(r => r.workspace_id === 0 ? null : r.workspace_id);
  }

  getMacroById(id: number): MacroListItem | null {
    const stmt = this.db.prepare('SELECT id, name, icon, color, content FROM commands WHERE id = ?');
    const row = stmt.get(id) as MacroListItem | undefined;
    return row ?? null;
  }

  close(): void {
    this.db.close();
  }
}
