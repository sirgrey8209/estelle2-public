/**
 * Relay 서비스 설정
 */
export interface RelayConfig {
  url: string;
  authToken: string;
  deviceType: 'app' | 'pylon';
  /** Google ID 토큰 (Google OAuth 인증용) */
  idToken?: string;
  /** 재연결 간격 (ms, 기본: 3000) */
  reconnectInterval?: number;
  /** Heartbeat 간격 (ms, 기본: 10000) */
  heartbeatInterval?: number;
  /** Heartbeat 타임아웃 (ms, 기본: 30000) */
  heartbeatTimeout?: number;
}

/**
 * 메시지 타입
 */
export interface RelayMessage {
  type: string;
  payload: Record<string, unknown>;
  from?: { deviceId: number; deviceType: string; name?: string; icon?: string };
  /** 전송 대상 deviceId 배열 (숫자) */
  to?: number[];
  /** 브로드캐스트 옵션 */
  broadcast?: 'all' | 'clients' | 'pylons';
}

/**
 * 이벤트 타입
 */
export type RelayEventType =
  | 'connected'
  | 'disconnected'
  | 'authenticated'
  | 'message'
  | 'error';
