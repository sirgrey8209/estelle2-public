import { useRelayStore, useSyncStore } from '../stores';
import { useAuthStore } from '../stores/authStore';
import { useArchiveStore } from '../stores/archiveStore';
import { useResponsive } from '../hooks/useResponsive';
import { LoadingOverlay } from '../components/common/LoadingOverlay';
import { ResponsiveLayout } from '../layouts/ResponsiveLayout';
import { WorkspaceSidebar } from '../components/sidebar/WorkspaceSidebar';
import { ChatArea } from '../components/chat/ChatArea';
import { ArchiveViewer } from '../components/archive/ArchiveViewer';
import { ArchiveTree } from '../components/archive/ArchiveTree';
import { ArchiveContent } from '../components/archive/ArchiveContent';
import { LoginScreen } from '../components/auth/LoginScreen';

export function HomePage() {
  const { isConnected, isAuthenticated } = useRelayStore();
  const { isAuthenticated: isGoogleAuthenticated } = useAuthStore();
  const archiveOpen = useArchiveStore((s) => s.isOpen);
  const workspaceSync = useSyncStore((s) => s.workspaceSync);
  const { isDesktop, isTablet } = useResponsive();
  const isMobile = !isDesktop && !isTablet;

  // Google 로그인하지 않은 경우 로그인 화면 표시
  if (!isGoogleAuthenticated) {
    return <LoginScreen />;
  }

  // 로딩 메시지 결정
  const getLoadingMessage = () => {
    if (!isConnected) return 'Relay 서버에 연결 중...';
    if (!isAuthenticated) return '인증 중...';
    if (workspaceSync !== 'synced') {
      return workspaceSync === 'failed'
        ? '워크스페이스 동기화 실패'
        : '워크스페이스 동기화 중...';
    }
    return null;
  };

  const loadingMessage = getLoadingMessage();

  // 아카이브 모드
  if (archiveOpen) {
    if (isMobile) {
      // 모바일: 캐러셀로 탐색기(sidebar) ↔ 뷰어(main) 전환
      return (
        <ResponsiveLayout
          sidebar={<ArchiveTree />}
          main={<ArchiveContent />}
        />
      );
    }
    // 데스크톱: 사이드바 숨기고 ArchiveViewer가 전체 영역 차지
    return (
      <>
        <ResponsiveLayout
          sidebar={null}
          main={<ArchiveViewer />}
        />
      </>
    );
  }

  return (
    <>
      <ResponsiveLayout
        sidebar={<WorkspaceSidebar />}
        main={<ChatArea />}
      />
      {loadingMessage && <LoadingOverlay message={loadingMessage} />}
    </>
  );
}
