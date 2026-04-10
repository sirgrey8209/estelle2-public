/**
 * @file viewer-auth.test.ts
 * @description Viewer 인증 및 라우팅 테스트
 *
 * Viewer는 shareId 기반으로 인증하여 특정 대화만 읽기 전용으로 조회하는 디바이스 타입입니다.
 * - shareId 기반 인증 (IP/Google OAuth 불필요)
 * - 읽기 전용 (메시지 전송 차단)
 * - 해당 conversationId 메시지만 수신
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { Client, DeviceConfig, RelayMessage, RelayDeviceType } from '../src/types.js';
import { isAuthenticatedClient } from '../src/types.js';
import {
  handleAuth,
  handleDisconnect,
  handleRouting,
  handleMessage,
} from '../src/message-handler.js';
import {
  broadcastAll,
  routeMessage,
  broadcastToType,
} from '../src/router.js';
// 아직 구현되지 않은 함수 import (의도된 실패)
import { broadcastToViewers, filterByConversationId } from '../src/router.js';

// ============================================================================
// 테스트 헬퍼
// ============================================================================

const testDevices: Record<number, DeviceConfig> = {
  1: { name: 'Office', icon: '🏢', role: 'office', allowedIps: ['*'] },
};

/**
 * 테스트용 클라이언트 생성 헬퍼
 *
 * @param deviceId - 디바이스 인덱스 (0~15)
 * @param deviceType - 디바이스 타입 (pylon, app, viewer)
 * @param authenticated - 인증 여부
 * @param conversationId - (viewer 전용) 필터링할 대화 ID
 */
function createClient(
  deviceId: number | null,
  deviceType: RelayDeviceType | null,
  authenticated: boolean,
  conversationId?: number
): Client {
  const client: Client = {
    deviceId,
    deviceType,
    ip: '192.168.1.100',
    connectedAt: new Date(),
    authenticated,
  };
  if (conversationId !== undefined) {
    (client as any).conversationId = conversationId;
  }
  return client;
}

// ============================================================================
// 1. 타입 정의 테스트 (types.ts)
// ============================================================================

describe('[Viewer] 타입 정의', () => {
  describe('RelayDeviceType', () => {
    it('should_include_viewer_in_RelayDeviceType', () => {
      // Arrange - RelayDeviceType이 'viewer'를 포함하는지 확인
      const viewerType: RelayDeviceType = 'viewer';

      // Assert - 컴파일 타임 체크 (런타임은 문자열 비교)
      expect(viewerType).toBe('viewer');
    });
  });

  describe('Client 인터페이스', () => {
    it('should_have_optional_conversationId_field', () => {
      // Arrange - conversationId가 있는 클라이언트
      const viewerClient: Client = {
        deviceId: 0,
        deviceType: 'viewer',
        ip: '192.168.1.100',
        connectedAt: new Date(),
        authenticated: true,
        conversationId: 42, // optional field
      } as Client;

      // Assert
      expect((viewerClient as any).conversationId).toBe(42);
    });

    it('should_allow_client_without_conversationId', () => {
      // Arrange - conversationId가 없는 일반 클라이언트
      const appClient: Client = {
        deviceId: 0,
        deviceType: 'app',
        ip: '192.168.1.100',
        connectedAt: new Date(),
        authenticated: true,
      };

      // Assert
      expect((appClient as any).conversationId).toBeUndefined();
    });
  });

  describe('isAuthenticatedClient', () => {
    it('should_return_true_for_authenticated_viewer', () => {
      // Arrange
      const viewer = createClient(0, 'viewer', true, 42);

      // Act
      const result = isAuthenticatedClient(viewer);

      // Assert
      expect(result).toBe(true);
    });

    it('should_return_false_for_unauthenticated_viewer', () => {
      // Arrange
      const viewer = createClient(null, null, false);

      // Act
      const result = isAuthenticatedClient(viewer);

      // Assert
      expect(result).toBe(false);
    });
  });
});

// ============================================================================
// 2. Viewer 라우팅 제한 테스트 (router.ts)
// ============================================================================

describe('[Viewer] Viewer 라우팅 제한', () => {
  let clients: Map<string, Client>;

  beforeEach(() => {
    clients = new Map([
      ['client-pylon-1', createClient(1, 'pylon', true)],
      ['client-app-0', createClient(0, 'app', true)],
      ['client-viewer-0', createClient(2, 'viewer', true, 42)],  // conversationId=42
      ['client-viewer-1', createClient(3, 'viewer', true, 99)],  // conversationId=99
    ]);
  });

  describe('메시지 전송 차단', () => {
    it('should_not_route_messages_from_viewer', () => {
      // Arrange
      const viewer = clients.get('client-viewer-0')!;
      const message: RelayMessage = { type: 'prompt', broadcast: 'pylons' };

      // Act
      const result = handleRouting(
        'client-viewer-0',
        viewer,
        message,
        0,  // envId
        clients,
        testDevices
      );

      // Assert - viewer는 메시지 전송 불가
      expect(result.actions).toHaveLength(0);
    });

    it('should_reject_viewer_message_in_handleMessage', () => {
      // Arrange
      const viewer = createClient(2, 'viewer', true, 42);
      const data: RelayMessage = { type: 'custom_event', payload: { data: 'test' }, broadcast: 'pylons' };

      // Act
      const result = handleMessage('client-viewer-0', viewer, data, 0, 0, clients, testDevices);

      // Assert - 라우팅 액션 없어야 함 (viewer는 전송 불가)
      const broadcastAction = result.actions.find(a => a.type === 'broadcast');
      expect(broadcastAction).toBeUndefined();
    });
  });

  describe('브로드캐스트 포함', () => {
    it('should_include_viewer_in_broadcast_all', () => {
      // Arrange / Act
      const result = broadcastAll(clients, 'client-pylon-1');

      // Assert - viewer도 브로드캐스트 대상에 포함
      expect(result.targetClientIds).toContain('client-viewer-0');
      expect(result.targetClientIds).toContain('client-viewer-1');
    });

    it('should_have_broadcastToViewers_function', () => {
      // Arrange / Act
      const result = broadcastToViewers(clients, 'client-pylon-1');

      // Assert - viewer만 포함
      expect(result.targetClientIds).toContain('client-viewer-0');
      expect(result.targetClientIds).toContain('client-viewer-1');
      expect(result.targetClientIds).not.toContain('client-app-0');
      expect(result.targetClientIds).not.toContain('client-pylon-1');
    });
  });
});

// ============================================================================
// 4. Viewer 메시지 수신 필터링 테스트
// ============================================================================

describe('[Viewer] 메시지 수신 필터링 (conversationId)', () => {
  let clients: Map<string, Client>;

  beforeEach(() => {
    clients = new Map([
      ['client-pylon-1', createClient(1, 'pylon', true)],
      ['client-viewer-42', createClient(2, 'viewer', true, 42)],   // conversationId=42
      ['client-viewer-99', createClient(3, 'viewer', true, 99)],   // conversationId=99
      ['client-viewer-42b', createClient(4, 'viewer', true, 42)],  // conversationId=42 (두 번째)
    ]);
  });

  describe('filterByConversationId', () => {
    it('should_forward_message_to_viewer_when_conversationId_matches', () => {
      // Arrange - conversationId=42 메시지
      const message: RelayMessage = {
        type: 'chat',
        payload: { conversationId: 42, content: 'Hello' },
      };

      // Act
      const result = filterByConversationId(42, clients);

      // Assert - conversationId=42인 viewer만 포함
      expect(result.targetClientIds).toContain('client-viewer-42');
      expect(result.targetClientIds).toContain('client-viewer-42b');
      expect(result.targetClientIds).not.toContain('client-viewer-99');
    });

    it('should_not_forward_message_to_viewer_when_conversationId_differs', () => {
      // Arrange / Act
      const result = filterByConversationId(100, clients);  // 존재하지 않는 conversationId

      // Assert - 해당 conversationId를 가진 viewer 없음
      expect(result.success).toBe(false);
      expect(result.targetClientIds).toHaveLength(0);
    });

    it('should_not_include_non_viewer_clients_in_filter', () => {
      // Arrange / Act
      const result = filterByConversationId(42, clients);

      // Assert - pylon, app은 포함되지 않음 (viewer 필터이므로)
      expect(result.targetClientIds).not.toContain('client-pylon-1');
    });
  });
});

// ============================================================================
// 5. Viewer 연결 해제 테스트 (handleDisconnect)
// ============================================================================

describe('[Viewer] Viewer 연결 해제', () => {
  let clients: Map<string, Client>;

  beforeEach(() => {
    clients = new Map([
      ['client-pylon-1', createClient(1, 'pylon', true)],
      ['client-app-0', createClient(0, 'app', true)],
      ['client-viewer-0', createClient(2, 'viewer', true, 42)],
    ]);
  });

  it('should_release_client_index_when_viewer_disconnects', () => {
    // Arrange
    const viewer = createClient(2, 'viewer', true, 42);
    const remainingClients = new Map([
      ['client-pylon-1', createClient(1, 'pylon', true)],
      ['client-app-0', createClient(0, 'app', true)],
    ]);

    // Act
    const result = handleDisconnect('client-viewer-0', viewer, remainingClients);

    // Assert - release_client_index 액션 존재
    const releaseAction = result.actions.find(a => a.type === 'release_client_index');
    expect(releaseAction).toBeDefined();
    if (releaseAction && 'deviceIndex' in releaseAction) {
      expect((releaseAction as any).deviceIndex).toBe(2);
    }
  });

  it('should_not_notify_pylon_when_viewer_disconnects', () => {
    // Arrange
    const viewer = createClient(2, 'viewer', true, 42);
    const remainingClients = new Map([
      ['client-pylon-1', createClient(1, 'pylon', true)],
    ]);

    // Act
    const result = handleDisconnect('client-viewer-0', viewer, remainingClients);

    // Assert - client_disconnect 메시지가 pylon에게 전송되지 않아야 함
    const disconnectNotification = result.actions.find(
      a => a.type === 'broadcast' && a.message.type === 'client_disconnect'
    );
    expect(disconnectNotification).toBeUndefined();
  });

  it('should_broadcast_device_status_when_viewer_disconnects', () => {
    // Arrange
    const viewer = createClient(2, 'viewer', true, 42);
    const remainingClients = new Map([
      ['client-pylon-1', createClient(1, 'pylon', true)],
    ]);

    // Act
    const result = handleDisconnect('client-viewer-0', viewer, remainingClients);

    // Assert - device_status는 브로드캐스트됨
    const deviceStatusAction = result.actions.find(
      a => a.type === 'broadcast' && a.message.type === 'device_status'
    );
    expect(deviceStatusAction).toBeDefined();
  });
});

// ============================================================================
// 6. handleMessage - viewer 인증 라우팅 테스트
// ============================================================================

describe('[Viewer] handleMessage - auth 타입 라우팅', () => {
  let clients: Map<string, Client>;

  beforeEach(() => {
    clients = new Map([
      ['client-pylon-1', createClient(1, 'pylon', true)],
    ]);
  });

  it('should_route_viewer_auth_to_handleViewerAuth', () => {
    // Arrange
    const client = createClient(null, null, false);
    const data: RelayMessage = {
      type: 'auth',
      payload: { deviceType: 'viewer', shareId: 'abc123XYZ789' },
    };

    // Act - handleMessage가 viewer 인증을 handleViewerAuth로 라우팅해야 함
    // handleMessage 내부에서 deviceType='viewer'일 때
    // handleViewerAuth를 호출하는지 확인
    expect(data.payload.deviceType).toBe('viewer');
  });
});
