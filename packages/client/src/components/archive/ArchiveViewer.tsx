import { useEffect } from 'react';
import { useArchiveStore } from '../../stores/archiveStore';
import { archiveList } from '../../services/archiveApi';
import { ArchiveTree } from './ArchiveTree';
import { ArchiveContent } from './ArchiveContent';

/**
 * Archive 뷰어 컨테이너
 *
 * VSCode 스타일: 좌측 트리 + 우측 콘텐츠
 * AppHeader 아래 전체 영역을 차지합니다.
 * 상단 바 토글은 AppHeader의 아카이브 버튼이 담당합니다.
 */
export function ArchiveViewer() {
  const setEntries = useArchiveStore((s) => s.setEntries);
  const resetTree = useArchiveStore((s) => s.resetTree);

  // 마운트 시 트리 상태 리셋 + 루트 디렉토리 로드
  useEffect(() => {
    let cancelled = false;
    resetTree();

    async function loadRoot() {
      try {
        const entries = await archiveList('', 1);
        if (!cancelled) {
          setEntries(entries);
        }
      } catch (err) {
        console.error('[Archive] Failed to load root:', err);
      }
    }

    loadRoot();
    return () => { cancelled = true; };
  }, [setEntries, resetTree]);

  return (
    <div className="flex h-full bg-background">
      {/* 좌측: 파일 트리 */}
      <div className="w-64 shrink-0 border-r border-border overflow-hidden">
        <ArchiveTree />
      </div>

      {/* 우측: 파일 콘텐츠 */}
      <div className="flex-1 min-w-0 overflow-hidden">
        <ArchiveContent />
      </div>
    </div>
  );
}
