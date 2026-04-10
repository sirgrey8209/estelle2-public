import { useCallback, useContext, useEffect } from 'react';
import { FolderOpen, FolderClosed, FileText, Loader2 } from 'lucide-react';
import { useArchiveStore, type FileEntry } from '../../stores/archiveStore';
import { archiveList, archiveRead } from '../../services/archiveApi';
import { MobileLayoutContext } from '../../layouts/MobileLayout';

interface TreeNodeProps {
  entry: FileEntry;
  depth: number;
}

function TreeNode({ entry, depth }: TreeNodeProps) {
  const {
    expandedDirs,
    selectedPath,
    toggleDir,
    updateDirChildren,
    setSelected,
    setLoading,
  } = useArchiveStore();
  const { closeSidebar } = useContext(MobileLayoutContext);

  const isExpanded = expandedDirs.has(entry.path);
  const isSelected = selectedPath === entry.path;
  const isDir = entry.type === 'directory';

  const handleClick = useCallback(async () => {
    if (isDir) {
      // 디렉토리: 콘텐츠 영역에 폴더 뷰 표시 + 토글 + lazy load
      setSelected(entry.path, null, null, 'directory');
      closeSidebar();
      toggleDir(entry.path);
      if (!isExpanded && !entry.children) {
        try {
          const children = await archiveList(entry.path, 1);
          updateDirChildren(entry.path, children);
        } catch (err) {
          console.error('[Archive] Failed to load directory:', entry.path, err);
        }
      }
    } else {
      // 파일: 내용 로드 + 모바일에서는 뷰어 페이지로 전환
      setSelected(entry.path, null, null, 'file');
      setLoading(true);
      closeSidebar();
      try {
        const result = await archiveRead(entry.path);
        setSelected(entry.path, result.content, result.mimeType, 'file');
      } catch (err) {
        console.error('[Archive] Failed to read file:', entry.path, err);
        setSelected(entry.path, null, null, 'file');
      } finally {
        setLoading(false);
      }
    }
  }, [isDir, isExpanded, entry, toggleDir, updateDirChildren, setSelected, setLoading, closeSidebar]);

  const paddingLeft = 8 + depth * 16;

  return (
    <>
      <button
        onClick={handleClick}
        className={`
          flex items-center w-full text-left py-1 px-2 text-sm
          hover:bg-accent/50 transition-colors
          ${isSelected ? 'bg-accent text-accent-foreground' : 'text-foreground/80'}
        `}
        style={{ paddingLeft }}
      >
        {isDir ? (
          isExpanded ? (
            <FolderOpen className="h-4 w-4 mr-1.5 shrink-0 text-primary/70" />
          ) : (
            <FolderClosed className="h-4 w-4 mr-1.5 shrink-0 text-primary/70" />
          )
        ) : (
          <FileText className="h-4 w-4 mr-1.5 shrink-0 text-muted-foreground" />
        )}
        <span className="truncate">{entry.name}</span>
      </button>

      {isDir && isExpanded && entry.children && (
        entry.children.map((child) => (
          <TreeNode key={child.path} entry={child} depth={depth + 1} />
        ))
      )}

      {isDir && isExpanded && !entry.children && (
        <div className="flex items-center py-1" style={{ paddingLeft: paddingLeft + 16 }}>
          <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
        </div>
      )}
    </>
  );
}

/**
 * Archive 파일 트리 (좌측 사이드바)
 */
export function ArchiveTree() {
  const { entries, resetTree, setEntries } = useArchiveStore();

  // 마운트 시 루트 로드 (모바일에서 ArchiveViewer 없이 직접 사용될 때)
  useEffect(() => {
    if (entries.length > 0) return;
    let cancelled = false;
    resetTree();

    async function loadRoot() {
      try {
        const loaded = await archiveList('', 1);
        if (!cancelled) setEntries(loaded);
      } catch (err) {
        console.error('[Archive] Failed to load root:', err);
      }
    }
    loadRoot();
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (entries.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin mr-2" />
        Loading...
      </div>
    );
  }

  return (
    <div className="overflow-y-auto h-full py-1">
      {entries.map((entry) => (
        <TreeNode key={entry.path} entry={entry} depth={0} />
      ))}
    </div>
  );
}
