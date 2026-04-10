import { create } from 'zustand';

/**
 * Archive 파일 엔트리 (서버 응답과 동일한 구조)
 */
export interface FileEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  modifiedAt?: string;
  children?: FileEntry[];
}

/**
 * Archive UI 상태 인터페이스
 */
export interface ArchiveState {
  /** Archive 뷰어 표시 여부 */
  isOpen: boolean;

  /** 루트 디렉토리 목록 */
  entries: FileEntry[];

  /** 선택된 파일 경로 */
  selectedPath: string | null;

  /** 선택된 파일 내용 */
  selectedContent: string | null;

  /** 선택된 파일 MIME 타입 */
  selectedMimeType: string | null;

  /** 선택된 항목 타입 (파일 또는 디렉토리) */
  selectedType: 'file' | 'directory' | null;

  /** 트리에서 펼쳐진 디렉토리 경로 */
  expandedDirs: Set<string>;

  /** 로딩 상태 */
  isLoading: boolean;

  // Actions
  setOpen: (open: boolean) => void;
  toggleOpen: () => void;
  setEntries: (entries: FileEntry[]) => void;
  setSelected: (path: string | null, content: string | null, mimeType: string | null, type?: 'file' | 'directory' | null) => void;
  toggleDir: (path: string) => void;
  setLoading: (loading: boolean) => void;
  /** 특정 디렉토리의 children 업데이트 */
  updateDirChildren: (dirPath: string, children: FileEntry[]) => void;
  /** 트리 상태 리셋 (expandedDirs, selection 초기화) */
  resetTree: () => void;
}

/**
 * entries 배열에서 dirPath에 해당하는 디렉토리의 children을 업데이트
 */
function updateChildrenRecursive(entries: FileEntry[], dirPath: string, children: FileEntry[]): FileEntry[] {
  return entries.map((entry) => {
    if (entry.path === dirPath && entry.type === 'directory') {
      return { ...entry, children };
    }
    if (entry.children) {
      return { ...entry, children: updateChildrenRecursive(entry.children, dirPath, children) };
    }
    return entry;
  });
}

/**
 * Archive UI 상태 관리 스토어
 */
export const useArchiveStore = create<ArchiveState>((set) => ({
  isOpen: false,
  entries: [],
  selectedPath: null,
  selectedContent: null,
  selectedMimeType: null,
  selectedType: null,
  expandedDirs: new Set(),
  isLoading: false,

  setOpen: (open) => set({ isOpen: open }),

  toggleOpen: () => set((state) => ({ isOpen: !state.isOpen })),

  setEntries: (entries) => set({ entries }),

  setSelected: (path, content, mimeType, type = null) =>
    set({ selectedPath: path, selectedContent: content, selectedMimeType: mimeType, selectedType: type }),

  toggleDir: (path) =>
    set((state) => {
      const next = new Set(state.expandedDirs);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return { expandedDirs: next };
    }),

  setLoading: (loading) => set({ isLoading: loading }),

  updateDirChildren: (dirPath, children) =>
    set((state) => ({
      entries: updateChildrenRecursive(state.entries, dirPath, children),
    })),

  resetTree: () =>
    set({
      expandedDirs: new Set(),
      selectedPath: null,
      selectedContent: null,
      selectedMimeType: null,
      selectedType: null,
    }),
}));
