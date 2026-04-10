/**
 * @file VersionSection.tsx
 * @description 버전 정보 섹션
 *
 * Client, Relay, Pylon 버전 정보를 표시합니다.
 */

import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { useSettingsStore, useRelayStore } from '../../stores';
import { requestVersions } from '../../services/relaySender';

/**
 * PWA 강제 새로고침 — 3단계 캐시 무효화
 * 1. Service Worker 등록 해제
 * 2. Cache Storage 전체 삭제
 * 3. 타임스탬프 파라미터로 하드 리로드
 */
async function forceRefresh() {
  if ('serviceWorker' in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    for (const registration of registrations) {
      await registration.unregister();
    }
  }

  if ('caches' in window) {
    const cacheNames = await caches.keys();
    await Promise.all(cacheNames.map((name) => caches.delete(name)));
  }

  window.location.href =
    window.location.origin + window.location.pathname + '?t=' + Date.now();
}

/** Pylon deviceId별 메타 정보 (Relay의 DEVICES 상수와 동기화) */
const PYLON_META: Record<number, { icon: string; role: string }> = {
  1: { icon: '🏢', role: 'office' },
  2: { icon: '🏠', role: 'home' },
  3: { icon: '☁️', role: 'cloud' },
};

export function VersionSection() {
  const clientVersion = useSettingsStore((s) => s.clientVersion);
  const relayVersion = useSettingsStore((s) => s.relayVersion);
  const pylonVersions = useSettingsStore((s) => s.pylonVersions);
  const directDeviceIds = useRelayStore((s) => s.directDeviceIds);
  const [refreshing, setRefreshing] = useState(false);

  // 컴포넌트 마운트 시 버전 정보 요청
  useEffect(() => {
    requestVersions();
  }, []);

  const handleForceRefresh = useCallback(async () => {
    setRefreshing(true);
    await forceRefresh();
    // 페이지가 리로드되므로 setRefreshing(false)는 불필요하지만,
    // 만약 리로드가 실패했을 때를 대비
    setRefreshing(false);
  }, []);

  // Pylon 엔트리를 deviceId 기준으로 정렬
  const sortedPylons = Object.entries(pylonVersions)
    .map(([id, version]) => ({ id: Number(id), version }))
    .sort((a, b) => a.id - b.id);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <span>📦</span>
          버전 정보
          <button
            onClick={handleForceRefresh}
            disabled={refreshing}
            className="ml-auto p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50"
            title="강제 새로고침 (SW 해제 + 캐시 삭제)"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
          </button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-1.5 text-sm">
          {/* Client 버전 */}
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Client</span>
            <span className="font-mono">{clientVersion}</span>
          </div>

          {/* Relay 버전 */}
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Relay</span>
            <span className="font-mono">
              {relayVersion ?? '연결 중...'}
            </span>
          </div>

          {/* Pylon 버전들 */}
          {sortedPylons.length === 0 ? (
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Pylon</span>
              <span className="text-muted-foreground">연결된 Pylon 없음</span>
            </div>
          ) : (
            sortedPylons.map(({ id, version }) => {
              const meta = PYLON_META[id] ?? { icon: '🔌', role: 'unknown' };
              const isDirect = directDeviceIds.includes(id);
              return (
                <div key={id} className="flex items-center justify-between">
                  <span className="text-muted-foreground">
                    {meta.icon} {meta.role}
                  </span>
                  <span className="flex items-center gap-2">
                    {isDirect && (
                      <span className="text-xs px-1.5 py-0.5 rounded bg-primary/15 text-primary">
                        Direct
                      </span>
                    )}
                    <span className="font-mono">{version}</span>
                  </span>
                </div>
              );
            })
          )}
        </div>
      </CardContent>
    </Card>
  );
}
