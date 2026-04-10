/**
 * @file pylon.ts
 * @description Pylon - Estelle 시스템의 핵심 서비스
 *
 * Pylon은 Claude Code와 클라이언트 앱 사이를 중계하는 핵심 서비스입니다.
 * 모든 모듈(WorkspaceStore, MessageStore, AgentManager, BlobHandler 등)을
 * 통합하고 메시지 라우팅을 담당합니다.
 *
 * 주요 기능:
 * - Relay 서버 연결 및 인증
 * - 워크스페이스/대화 관리
 * - Claude SDK 연동 및 이벤트 전달
 * - Blob(이미지) 전송 처리
 * - 세션 뷰어 관리
 *
 * 설계 원칙:
 * - 의존성 주입을 통한 테스트 용이성
 * - 모킹 없이 테스트 가능한 순수 로직 중심
 * - 외부 I/O는 어댑터/콜백으로 분리
 *
 * @example
 * ```typescript
 * import { Pylon, createDefaultDependencies } from './pylon.js';
 *
 * const config = {
 *   deviceId: 1,
 *   relayUrl: 'ws://relay.example.com',
 *   uploadsDir: './uploads',
 * };
 *
 * const deps = createDefaultDependencies(config);
 * const pylon = new Pylon(config, deps);
 *
 * await pylon.start();
 * ```
 */

import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import type { PermissionModeValue, ConversationStatusValue, ConversationId, AccountType, ViewNode } from '@estelle/core';
import { decodeConversationIdFull, isWidgetCheckPayload, isWidgetClaimPayload } from '@estelle/core';
import type { WorkspaceStore, Workspace, Conversation } from './stores/workspace-store.js';
import type { MessageStore, StoreMessage } from './stores/message-store.js';
import type { ShareStore } from './stores/share-store.js';
import type { MacroStore } from './stores/macro-store.js';
import type { AgentManagerEvent, SystemPromptPreset } from './agent/agent-manager.js';
import type { PlatformType } from './utils/path.js';
import type { PersistenceAdapter, PersistedAccount } from './persistence/types.js';
import { generateThumbnail } from './utils/thumbnail.js';
import {
  buildSystemPrompt,
  buildInitialReminder,
  buildDocumentAddedReminder,
  buildDocumentRemovedReminder,
  buildConversationRenamedReminder,
} from './utils/session-context.js';
import { findAutorunDoc } from './utils/autorun-detector.js';
import { handleAssetRequest } from './handlers/widget-asset-handler.js';

// ============================================================================
// 타입 정의
// ============================================================================

/**
 * Pylon 설정
 */
export interface PylonConfig {
  /** 디바이스 ID (숫자) */
  deviceId: number;

  /** 디바이스 이름 (선택) */
  deviceName?: string;

  /** Relay 서버 URL */
  relayUrl: string;

  /** 업로드 파일 저장 디렉토리 */
  uploadsDir: string;

  /** 빌드 환경 (dev, stage, release) */
  buildEnv?: string;

  /** 에셋 서버 포트 (선택, 기본값: 0 = 랜덤 포트) */
  assetServerPort?: number;
}

/**
 * RelayClient 인터페이스 (의존성 주입용)
 */
export interface RelayClientAdapter {
  connect(): void;
  disconnect(): void;
  send(message: unknown): void;
  isConnected(): boolean;
  onMessage(callback: (data: unknown) => void): void;
  onStatusChange(callback: (isConnected: boolean) => void): void;
}

// SystemPromptPreset is imported from './agent/agent-manager.js'

/**
 * AgentManager 인터페이스 (의존성 주입용)
 */
export interface AgentManagerAdapter {
  sendMessage(conversationId: number, message: string, options: {
    workingDir: string;
    agentSessionId?: string;
    systemPrompt?: string | SystemPromptPreset;
    systemReminder?: string;
    plugins?: Array<{ type: 'local'; path: string }>;
  }): Promise<void>;
  stop(conversationId: number): void;
  newSession(conversationId: number): void;
  cleanup(): void;
  abortAllSessions(): number[];
  respondPermission(conversationId: number, toolUseId: string, decision: 'allow' | 'deny' | 'allowAll'): void;
  respondQuestion(conversationId: number, toolUseId: string, answer: string): void;
  hasActiveSession(conversationId: number): boolean;
  getSessionStartTime(conversationId: number): number | null;
  getPendingEvent(conversationId: number): unknown;
  getSessionIdByToolUseId(toolUseId: string): number | null;
  getSessionTools(conversationId: number): string[];
  requestSuggestion(conversationId: number, agentSessionId: string, workingDir: string): void;
}

/**
 * BlobHandler 인터페이스 (의존성 주입용)
 */
export interface BlobHandlerAdapter {
  handleBlobStart(payload: unknown, from: number): { success: boolean; path?: string };
  handleBlobChunk(payload: unknown): { success: boolean };
  handleBlobEnd(payload: unknown): { success: boolean; path?: string; context?: unknown };
  handleBlobRequest(payload: unknown, from: number): { success: boolean; error?: string };
}

/**
 * TaskManager 인터페이스 (의존성 주입용)
 */
export interface TaskManagerAdapter {
  listTasks(workingDir: string): { success: boolean; tasks: unknown[] };
  getTask(workingDir: string, taskId: string): { success: boolean; task?: unknown };
  updateTaskStatus(workingDir: string, taskId: string, status: string, error?: string): { success: boolean };
}

/**
 * WorkerManager 인터페이스 (의존성 주입용)
 */
export interface WorkerManagerAdapter {
  getWorkerStatus(workspaceId: number, workingDir: string): { running: boolean };
  startWorker(workspaceId: number, workingDir: string, callback: unknown): Promise<{ success: boolean }>;
  stopWorker(workspaceId: number, workingDir: string): { success: boolean };
}

/**
 * 드라이브 정보
 */
interface DriveInfo {
  path: string;
  label: string;
  hasChildren: boolean;
}

// PlatformType is imported from './utils/path.js'

/**
 * FolderManager 인터페이스 (의존성 주입용)
 */
export interface FolderManagerAdapter {
  listFolders(path: string): { success: boolean; folders: unknown[]; platform: PlatformType };
  listDrives(): { success: boolean; drives: DriveInfo[]; platform: PlatformType; error?: string };
  createFolder(parentPath: string, name: string): { success: boolean };
  renameFolder(folderPath: string, newName: string): { success: boolean };
  getPlatform(): PlatformType;
  getDefaultPath(): string;
}

/**
 * Logger 인터페이스 (의존성 주입용)
 */
export interface LoggerAdapter {
  log(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

/**
 * CredentialManager 인터페이스 (의존성 주입용)
 */
export interface CredentialManagerAdapter {
  getCurrentAccount(): Promise<{ account: AccountType; subscriptionType: string } | null>;
  switchAccount(account: AccountType): Promise<void>;
  hasBackup(account: AccountType): Promise<boolean>;
}

/**
 * PacketLogger 인터페이스 (의존성 주입용)
 */
export interface PacketLoggerAdapter {
  logSend(source: string, message: unknown): void;
  logRecv(source: string, message: unknown): void;
}

/**
 * 버그 리포트 작성기 인터페이스
 */
export interface BugReportWriter {
  /** 버그 리포트 파일에 내용 추가 */
  append(content: string): void;
}

/**
 * WidgetSession 상태 (WidgetManager에서 사용)
 */
export interface WidgetSessionInfo {
  sessionId: string;
  conversationId: number;
  toolUseId: string;
  status: 'ready' | 'running' | 'completed' | 'error' | 'cancelled';
  ownerClientId: number | null;
}

/**
 * WidgetManager 인터페이스 (의존성 주입용)
 */
export interface WidgetManagerAdapter {
  /** 사용자 입력을 위젯 세션에 전달 */
  sendInput(sessionId: string, data: Record<string, unknown>): void;
  /** CLI로 이벤트 전송 */
  sendEvent(sessionId: string, data: unknown): void;
  /** 세션 상태 조회 */
  getSession(sessionId: string): WidgetSessionInfo | undefined;
  /** 소유권 요청 처리 (ready → running, running → cancelled) */
  claimOwnership(sessionId: string, clientId: number): { started: true } | { cancelled: true; reason: string } | null;
  /** 소유자 확인 */
  isOwner(sessionId: string, clientId: number): boolean;
  /** 특정 클라이언트가 소유한 세션 목록 조회 */
  getSessionsByOwner(clientId: number): WidgetSessionInfo[];
  /** 세션 취소 */
  cancelSession(sessionId: string): boolean;
  /** 이벤트 리스너 등록 */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(event: string, handler: (...args: any[]) => void): void;
  /** 이벤트 리스너 해제 */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  off(event: string, handler: (...args: any[]) => void): void;
}

/**
 * PendingWidget 정보 (MCP 서버에서 관리)
 */
export interface PendingWidgetInfo {
  conversationId: number;
  toolUseId: string;
  widgetSessionId: string;
}

/**
 * PylonMcpServer 인터페이스 (의존성 주입용)
 */
export interface PylonMcpServerAdapter {
  /** 대기 중인 위젯 조회 */
  getPendingWidget(conversationId: number): PendingWidgetInfo | undefined;
  /** 대화의 위젯 세션 취소 */
  cancelWidgetForConversation(conversationId: number): boolean;
  /** sessionId로 위젯 세션 취소 (inline 위젯용) */
  cancelWidgetBySessionId(sessionId: string, reason?: string): boolean;
}

/**
 * Pylon 의존성 (의존성 주입)
 */
export interface PylonDependencies {
  workspaceStore: WorkspaceStore;
  messageStore: MessageStore;
  relayClient: RelayClientAdapter;
  agentManager: AgentManagerAdapter;
  blobHandler: BlobHandlerAdapter;
  taskManager: TaskManagerAdapter;
  workerManager: WorkerManagerAdapter;
  folderManager: FolderManagerAdapter;
  logger: LoggerAdapter;
  packetLogger: PacketLoggerAdapter;

  /** 영속성 어댑터 (선택, 없으면 메모리만 사용) */
  persistence?: PersistenceAdapter;

  /** 버그 리포트 작성기 (선택) */
  bugReportWriter?: BugReportWriter;

  /** 인증 관리자 (선택, 계정 전환 기능에 필요) */
  credentialManager?: CredentialManagerAdapter;

  /** 공유 저장소 (선택, 공유 기능에 필요) */
  shareStore?: ShareStore;

  /** Widget 매니저 (선택, Widget Protocol 기능에 필요) */
  widgetManager?: WidgetManagerAdapter;

  /** MCP 서버 (선택, widget_check 핸들러에 필요) */
  mcpServer?: PylonMcpServerAdapter;

  /** 매크로 저장소 (선택, 매크로 툴바 기능에 필요) */
  macroStore?: MacroStore;
}

/**
 * 메시지 from 정보
 */
interface MessageFrom {
  deviceId: number;  // 인코딩된 deviceId (숫자)
  name?: string;
}

/**
 * 디바이스 정보
 */
interface DeviceInfo {
  deviceId: string;
  name: string;
  icon?: string;
}

// ============================================================================
// Pylon 클래스
// ============================================================================

/**
 * Pylon - Estelle 시스템의 핵심 서비스 클래스
 *
 * @description
 * Pylon은 모든 모듈을 통합하고 메시지 라우팅을 담당하는 메인 클래스입니다.
 * 의존성 주입 패턴을 사용하여 테스트 용이성을 확보합니다.
 *
 * @example
 * ```typescript
 * const pylon = new Pylon(config, dependencies);
 * await pylon.start();
 * ```
 */
export class Pylon {
  // ==========================================================================
  // Private 필드
  // ==========================================================================

  /** 설정 */
  private readonly config: PylonConfig;

  /** 의존성 */
  private readonly deps: PylonDependencies;

  /** 인증 여부 */
  private authenticated: boolean = false;

  /** 디바이스 정보 */
  private deviceInfo: DeviceInfo | null = null;

  /** 캐싱된 계정 정보 */
  private cachedAccount: PersistedAccount | null = null;

  /** 세션별 시청자: Map<conversationId, Set<encodedDeviceId>> (숫자) */
  private readonly sessionViewers: Map<number, Set<number>> = new Map();

  /** 앱별 unread 알림 전송 기록: Map<appId, Set<conversationId>> */
  private readonly appUnreadSent: Map<string, Set<number>> = new Map();

  /** 대화별 pending 파일: Map<conversationId, Map<fileId, FileInfo>> */
  private readonly pendingFiles: Map<number, Map<string, unknown>> = new Map();

  /** Claude 누적 사용량 */
  private claudeUsage = {
    totalCostUsd: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCacheReadTokens: 0,
    totalCacheCreationTokens: 0,
    sessionCount: 0,
    lastUpdated: null as string | null,
  };

  /** 워크스페이스 저장 debounce 타이머 */
  private workspaceSaveTimer: ReturnType<typeof setTimeout> | null = null;

  /** 워크스페이스 저장 debounce 시간 (ms) */
  private readonly WORKSPACE_SAVE_DEBOUNCE_MS = 3000;

  /** 에셋 서버 (HTTP) */
  private assetServer: http.Server | null = null;

  /** 에셋 서버 포트 */
  private assetServerPort: number = 0;

  /** 메시지 핸들러 맵 */
  private readonly messageHandlers: Map<string, (payload: any, from?: MessageFrom) => void>;

  // ==========================================================================
  // 생성자
  // ==========================================================================

  /**
   * Pylon 인스턴스 생성
   *
   * @param config - Pylon 설정
   * @param deps - 의존성 (테스트 시 Mock 주입)
   */
  constructor(config: PylonConfig, deps: PylonDependencies) {
    this.config = config;
    this.deps = deps;

    // 메시지 핸들러 맵 초기화 (setupCallbacks보다 먼저)
    this.messageHandlers = this.initMessageHandlers();

    // 콜백 설정
    this.setupCallbacks();
  }

  // ==========================================================================
  // Public 메서드 - 생명주기
  // ==========================================================================

  /**
   * Pylon 시작
   *
   * @description
   * 영속 데이터를 로드하고 Relay에 연결합니다.
   */
  async start(): Promise<void> {
    this.log(`[Estelle Pylon] Starting...`);
    this.log(`Device ID: ${this.config.deviceId}`);
    this.log(`Relay URL: ${this.config.relayUrl}`);

    // 영속 데이터 로드
    await this.loadPersistedData();

    // 계정 정보 캐싱
    await this.refreshAccountCache();

    // 워크스페이스 초기화: working/waiting 상태인 대화들을 idle로 리셋
    const resetConversationIds = this.deps.workspaceStore.resetActiveConversations();
    for (const conversationId of resetConversationIds) {
      this.deps.messageStore.addAborted(conversationId, 'session_ended');
      this.log(`[Startup] Added session_ended to history: ${conversationId}`);
    }

    // 리셋된 대화가 있으면 워크스페이스 저장
    if (resetConversationIds.length > 0) {
      await this.saveWorkspaceStore();
    }

    // 에셋 서버 시작
    await this.startAssetServer();

    // Relay 연결
    this.deps.relayClient.connect();
  }

  /**
   * 에셋 서버 시작
   */
  private async startAssetServer(): Promise<void> {
    const port = this.config.assetServerPort ?? 0;

    this.assetServer = http.createServer(async (req, res) => {
      const url = new URL(req.url || '/', `http://${req.headers.host}`);
      const match = url.pathname.match(/^\/widget-assets\/([^/]+)\/(.+)$/);

      if (match) {
        const [, sessionId, assetKey] = match;
        await handleAssetRequest(req, res, sessionId, assetKey);
        return;
      }

      // 알 수 없는 경로
      res.writeHead(404);
      res.end('Not found');
    });

    await new Promise<void>((resolve, reject) => {
      this.assetServer!.listen(port, () => {
        const address = this.assetServer!.address();
        if (address && typeof address === 'object') {
          this.assetServerPort = address.port;
          this.log(`[AssetServer] Started on port ${this.assetServerPort}`);
        }
        resolve();
      });
      this.assetServer!.on('error', reject);
    });
  }

  /**
   * 에셋 서버 포트 반환
   */
  getAssetServerPort(): number {
    return this.assetServerPort;
  }

  /**
   * 에셋 서버 베이스 URL 반환
   */
  getAssetServerBaseUrl(): string {
    return `http://localhost:${this.assetServerPort}`;
  }

  /**
   * 계정 정보 캐싱 갱신
   *
   * @returns 계정이 변경되었으면 true
   */
  private async refreshAccountCache(): Promise<boolean> {
    if (!this.deps.credentialManager) {
      this.cachedAccount = null;
      return false;
    }

    try {
      const info = await this.deps.credentialManager.getCurrentAccount();
      if (info) {
          // 이전에 저장된 계정과 비교
        const persistence = this.deps.persistence;
        const lastAccount = persistence?.loadLastAccount();
        const accountChanged = lastAccount !== undefined && lastAccount.current !== info.account;

        if (accountChanged) {
          this.log(`[Account] Changed: ${lastAccount.current} → ${info.account}`);
        }

        // 현재 계정 캐싱 및 저장
        const accountData: PersistedAccount = {
          current: info.account,
          subscriptionType: info.subscriptionType,
        };
        this.cachedAccount = accountData;
        if (persistence) {
          await persistence.saveLastAccount(accountData);
        }

        this.log(`[Account] Cached: ${info.account} (${info.subscriptionType})`);
        return accountChanged;
      } else {
        this.cachedAccount = null;
        this.log(`[Account] No account info found`);
        return false;
      }
    } catch (err) {
      this.cachedAccount = null;
      this.deps.logger.error(`[Account] Failed to cache account info: ${err}`);
      return false;
    }
  }

  /**
   * Pylon 종료
   *
   * @description
   * 데이터를 저장하고 모든 서비스를 정리합니다.
   */
  async stop(): Promise<void> {
    this.log('Shutting down...');

    // 모든 debounce 타이머 취소 및 즉시 저장
    await this.flushPendingSaves();

    // 워크스페이스 저장
    await this.saveWorkspaceStore();

    // Claude 세션 정리
    this.deps.agentManager.cleanup();

    // 에셋 서버 종료
    if (this.assetServer) {
      await new Promise<void>((resolve) => {
        this.assetServer!.close(() => {
          this.log('[AssetServer] Stopped');
          resolve();
        });
      });
      this.assetServer = null;
    }

    // MacroStore 종료
    this.deps.macroStore?.close();

    // Relay 연결 종료
    this.deps.relayClient.disconnect();
  }

  // ==========================================================================
  // Public 메서드 - 상태 조회
  // ==========================================================================

  /**
   * 디바이스 ID 반환
   */
  getDeviceId(): number {
    return this.config.deviceId;
  }

  /**
   * 디바이스 이름 반환
   */
  getDeviceName(): string | undefined {
    return this.config.deviceName;
  }

  /**
   * 인증 여부 반환
   */
  isAuthenticated(): boolean {
    return this.authenticated;
  }

  /**
   * 세션 시청자 수 반환
   */
  getSessionViewerCount(conversationId: number): number {
    return this.sessionViewers.get(conversationId)?.size ?? 0;
  }

  /**
   * 세션 시청자 목록 반환 (인코딩된 deviceId Set)
   */
  getSessionViewers(conversationId: number): Set<number> {
    return this.sessionViewers.get(conversationId) ?? new Set();
  }

  /**
   * 새 세션 시작 트리거 (외부에서 호출 가능)
   *
   * @description
   * MCP 도구 등에서 새 세션을 시작해야 할 때 호출합니다.
   * 기존 세션을 정리하고, 메시지 저장소를 초기화하고, 새 세션을 시작합니다.
   */
  triggerNewSession(conversationId: number): void {
    this.deps.agentManager.newSession(conversationId);
    this.deps.messageStore.clear(conversationId);
    this.sendInitialContext(conversationId);
  }

  /**
   * 초기 컨텍스트 전송 트리거 (외부에서 호출 가능)
   *
   * @description
   * MCP create_conversation 등에서 대화 생성 후 첫 쿼리를 보내야 할 때 호출합니다.
   */
  triggerInitialContext(conversationId: number): void {
    this.sendInitialContext(conversationId);
  }

  /**
   * 사용자 메시지 전송 트리거 (외부에서 호출 가능)
   *
   * @description
   * MCP create_conversation의 initialMessage 등에서 사용합니다.
   * 내부 handleClaudeSend를 호출하여 Claude에게 메시지를 전송합니다.
   */
  triggerClaudeSend(conversationId: number, message: string): void {
    this.handleClaudeSend({ conversationId, message }, undefined);
  }

  /**
   * 대화 삭제 트리거 (외부에서 호출 가능)
   *
   * @description
   * MCP delete_conversation 등에서 대화 삭제를 요청할 때 호출합니다.
   * agent 정리, widget 정리, 메시지 정리, store 삭제를 모두 수행합니다.
   */
  triggerConversationDelete(conversationId: number): boolean {
    return this.handleConversationDelete({ conversationId });
  }

  /**
   * 워크스페이스 저장 트리거 (외부에서 호출 가능)
   */
  triggerSaveWorkspaceStore(): Promise<void> {
    return this.saveWorkspaceStore();
  }

  // ==========================================================================
  // Public 메서드 - 메시지 처리
  // ==========================================================================

  /**
   * 메시지 처리 (Relay에서 호출)
   *
   * @param message - 수신된 메시지
   */
  handleMessage(message: Record<string, unknown>): void {
    const { type, payload, from } = message as {
      type: string;
      payload?: Record<string, unknown>;
      from?: MessageFrom;
    };

    // lastActiveClientId 업데이트
    if (from?.deviceId !== undefined) {
      const activeConversationId = this.deps.workspaceStore.getActiveState().activeConversationId;
      if (activeConversationId) {
        this.deps.workspaceStore.updateLastActiveClient(activeConversationId, from.deviceId);
      }
    }

    // 핸들러 디스패치
    const handler = this.messageHandlers.get(type);
    if (handler) {
      handler(payload, from);
    }
    // 알 수 없는 메시지는 무시
  }

  // ==========================================================================
  // Private 메서드 - 메시지 핸들러 맵 초기화
  // ==========================================================================

  /**
   * 메시지 핸들러 맵 초기화
   *
   * @description
   * 모든 메시지 타입별 핸들러를 맵에 등록합니다.
   * handleMessage에서 타입 기반 디스패치에 사용됩니다.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private initMessageHandlers(): Map<string, (payload: any, from?: MessageFrom) => void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handlers = new Map<string, (payload: any, from?: MessageFrom) => void>();

    // 연결 확인
    handlers.set('connected', (payload) => {
      this.log(`Connected to Relay: ${(payload as { message?: string })?.message || ''}`);
    });

    // 인증 결과
    handlers.set('auth_result', (payload) => {
      this.handleAuthResult(payload);
    });

    // 레거시: registered 응답 처리
    handlers.set('registered', () => {
      this.handleRegistered();
    });

    // 디바이스 상태 변경
    handlers.set('device_status', (payload) => {
      this.handleDeviceStatus(payload);
    });

    // 클라이언트 연결 해제
    handlers.set('client_disconnect', (payload) => {
      const deviceId = (payload as { deviceId?: number })?.deviceId;
      if (deviceId !== undefined) {
        this.unregisterSessionViewer(deviceId);
        this.handleClientDisconnect(deviceId);
      }
    });

    // 에러
    handlers.set('error', (payload) => {
      this.log(`Error from Relay: ${(payload as { error?: string })?.error}`);
    });

    // ping/pong
    handlers.set('ping', (_payload, from) => {
      if (from?.deviceId !== undefined) {
        this.send({ type: 'pong', timestamp: Date.now(), to: [from.deviceId] });
      }
    });

    // 상태 조회
    handlers.set('get_status', (_payload, from) => {
      this.handleGetStatus(from);
    });

    // 히스토리 요청
    handlers.set('history_request', (payload, from) => {
      this.handleHistoryRequest(payload, from);
    });

    // Share 히스토리 요청 (Viewer용)
    handlers.set('share_history', (payload, from) => {
      this.handleShareHistory(payload, from);
    });

    // 슬래시 명령어 목록 요청
    handlers.set('slash_commands_request', (payload, from) => {
      this.handleSlashCommandsRequest(payload, from);
    });

    // ===== 워크스페이스 관련 =====
    handlers.set('workspace_list', (_payload, from) => {
      this.handleWorkspaceList(from);
    });

    handlers.set('workspace_create', (payload, from) => {
      this.handleWorkspaceCreate(payload, from);
    });

    handlers.set('workspace_delete', (payload, from) => {
      this.handleWorkspaceDelete(payload, from);
    });

    handlers.set('workspace_update', (payload, from) => {
      this.handleWorkspaceUpdate(payload, from);
    });

    handlers.set('workspace_reorder', (payload) => {
      this.handleWorkspaceReorder(payload);
    });

    handlers.set('workspace_rename', (payload) => {
      this.handleWorkspaceRename(payload);
    });

    handlers.set('workspace_switch', (payload) => {
      this.handleWorkspaceSwitch(payload);
    });

    // ===== 대화 관련 =====
    handlers.set('conversation_create', (payload, from) => {
      this.handleConversationCreate(payload, from);
    });

    handlers.set('conversation_delete', (payload) => {
      this.handleConversationDelete(payload);
    });

    handlers.set('conversation_rename', (payload) => {
      this.handleConversationRename(payload);
    });

    handlers.set('conversation_select', (payload, from) => {
      this.handleConversationSelect(payload, from);
    });

    handlers.set('conversation_reorder', (payload) => {
      this.handleConversationReorder(payload);
    });

    // ===== 문서 연결 관련 =====
    handlers.set('link_document', (payload) => {
      this.handleLinkDocument(payload);
    });

    handlers.set('unlink_document', (payload) => {
      this.handleUnlinkDocument(payload);
    });

    // ===== Claude 관련 =====
    handlers.set('claude_send', (payload, from) => {
      this.handleClaudeSend(payload, from);
    });

    handlers.set('claude_permission', (payload) => {
      this.handleClaudePermission(payload);
    });

    handlers.set('claude_answer', (payload) => {
      this.handleClaudeAnswer(payload);
    });

    handlers.set('claude_control', (payload) => {
      this.handleClaudeControl(payload);
    });

    handlers.set('claude_set_permission_mode', (payload) => {
      this.handleClaudeSetPermissionMode(payload);
    });

    handlers.set('suggestion_request', (payload) => {
      const { conversationId } = payload as { conversationId: number };
      this.log(`[Suggestion] suggestion_request: convId=${conversationId}`);

      const conversation = this.deps.workspaceStore.getConversation(conversationId as ConversationId);
      const workingDir = this.getWorkingDirForConversation(conversationId as ConversationId);
      this.log(`[Suggestion] check: claudeSessionId=${conversation?.claudeSessionId ?? 'null'}, workingDir=${workingDir ?? 'null'}`);

      if (conversation?.claudeSessionId && workingDir) {
        this.deps.agentManager.requestSuggestion(
          conversationId,
          conversation.claudeSessionId,
          workingDir
        );
      }
    });

    // ===== Blob 관련 =====
    handlers.set('blob_start', (payload, from) => {
      const fromDeviceId = from?.deviceId ?? 0;
      this.deps.blobHandler.handleBlobStart(payload, fromDeviceId);
    });

    handlers.set('blob_chunk', (payload) => {
      this.deps.blobHandler.handleBlobChunk(payload);
    });

    handlers.set('blob_end', (payload, from) => {
      const result = this.deps.blobHandler.handleBlobEnd(payload);
      // 비동기로 썸네일 생성 후 완료 알림 (에러는 내부에서 처리)
      void this.handleBlobEndResult(result, from, payload);
    });

    handlers.set('blob_request', (payload, from) => {
      const fromDeviceId = from?.deviceId ?? 0;
      this.deps.blobHandler.handleBlobRequest(payload, fromDeviceId);
    });

    // ===== 폴더 관련 =====
    handlers.set('folder_list', (payload, from) => {
      this.handleFolderList(payload, from);
    });

    handlers.set('folder_create', (payload, from) => {
      this.handleFolderCreate(payload, from);
    });

    handlers.set('folder_rename', (payload, from) => {
      this.handleFolderRename(payload, from);
    });

    // ===== 태스크 관련 =====
    handlers.set('task_list', (payload, from) => {
      this.handleTaskList(payload, from);
    });

    handlers.set('task_get', (payload, from) => {
      this.handleTaskGet(payload, from);
    });

    handlers.set('task_status', (payload, from) => {
      this.handleTaskStatus(payload, from);
    });

    // ===== 워커 관련 =====
    handlers.set('worker_status', (payload, from) => {
      this.handleWorkerStatus(payload, from);
    });

    handlers.set('worker_start', (payload, from) => {
      this.handleWorkerStart(payload, from);
    });

    handlers.set('worker_stop', (payload, from) => {
      this.handleWorkerStop(payload, from);
    });

    // ===== 디버그 로그 =====
    handlers.set('debug_log', (payload, from) => {
      this.handleDebugLog(payload, from);
    });

    // ===== 버그 리포트 =====
    handlers.set('bug_report', (payload) => {
      this.handleBugReport(payload);
    });

    // ===== Usage 조회 =====
    handlers.set('usage_request', (_payload, from) => {
      this.handleUsageRequest(from);
    });

    // ===== 계정 전환 =====
    handlers.set('account_switch', (payload, from) => {
      this.handleAccountSwitch(payload, from);
    });

    // ===== 공유 생성 =====
    handlers.set('share_create', (payload, from) => {
      this.handleShareCreate(payload, from);
    });

    // ===== Widget 입력 =====
    handlers.set('widget_input', (payload) => {
      this.handleWidgetInput(payload);
    });

    // ===== Widget 이벤트 (Client → CLI) =====
    handlers.set('widget_event', (payload, from) => {
      this.handleWidgetEvent(payload, from);
    });

    // ===== Widget 소유권 요청 =====
    handlers.set('widget_claim', (payload, from) => {
      this.handleWidgetClaim(payload, from);
    });

    // ===== Macro =====
    handlers.set('macro_execute', (payload, from) => {
      this.handleMacroExecute(payload, from);
    });

    handlers.set('macro_create', (payload, from) => {
      this.handleMacroCreate(payload, from);
    });

    handlers.set('macro_update', (payload, from) => {
      this.handleMacroUpdate(payload, from);
    });

    handlers.set('macro_delete', (payload, from) => {
      this.handleMacroDelete(payload, from);
    });

    handlers.set('macro_assign', (payload, from) => {
      this.handleMacroAssign(payload, from);
    });

    handlers.set('macro_reorder', (payload) => {
      this.handleMacroReorder(payload);
    });

    handlers.set('macro_manage_conversation', (payload, from) => {
      this.handleMacroManageConversation(payload, from);
    });

    // ===== Widget 세션 유효성 확인 =====
    handlers.set('widget_check', (payload, from) => {
      this.handleWidgetCheck(payload, from);
    });

    return handlers;
  }

  /**
   * Widget 입력 처리
   *
   * @description
   * 클라이언트에서 Widget 버튼 클릭 등의 입력을 받아서
   * WidgetManager에 전달합니다.
   */
  private handleWidgetInput(payload?: Record<string, unknown>): void {
    if (!this.deps.widgetManager) {
      this.log('[Widget] WidgetManager not configured');
      return;
    }

    const sessionId = payload?.sessionId as string | undefined;
    const data = payload?.data as Record<string, unknown> | undefined;

    if (!sessionId || !data) {
      this.log('[Widget] Missing sessionId or data in widget_input');
      return;
    }

    this.log(`[Widget] Received input for session ${sessionId}`);
    this.deps.widgetManager.sendInput(sessionId, data);
  }

  /**
   * Widget 이벤트 처리 (Client → CLI)
   *
   * @description
   * 클라이언트에서 Widget 이벤트를 받아서
   * WidgetManager를 통해 CLI로 전달합니다.
   */
  private handleWidgetEvent(payload?: Record<string, unknown>, from?: MessageFrom): void {
    const sessionId = payload?.sessionId as string | undefined;
    const data = payload?.data as Record<string, unknown> | undefined;
    const clientId = from?.deviceId;

    if (!sessionId || data === undefined) {
      this.log('[Widget] Missing sessionId or data in widget_event');
      return;
    }

    // 소유자 검증 (inline 위젯 제외)
    if (!sessionId.startsWith('inline-') && clientId !== undefined) {
      const session = this.deps.widgetManager?.getSession(sessionId);
      if (session) {
        // running 상태면 owner 검증
        if (session.status === 'running') {
          if (session.ownerClientId !== clientId) {
            this.log(`[Widget] Event rejected: client ${clientId} is not owner of ${sessionId}`);
            return;
          }
        } else {
          // ready나 다른 상태면 이벤트 무시 (widget_claim을 통해 시작해야 함)
          this.log(`[Widget] Event ignored: session ${sessionId} is in ${session.status} state`);
          return;
        }
      }
    }

    this.log(`[Widget] Received event for session ${sessionId}`);

    // Inline 위젯 처리 (sessionId가 inline-으로 시작)
    if (sessionId.startsWith('inline-')) {
      // cancel 이벤트면 pendingWidget 종료
      if (data.type === 'cancel') {
        const cancelled = this.deps.mcpServer?.cancelWidgetBySessionId(sessionId, 'User cancelled');
        this.log(`[Widget] Inline widget cancel: ${sessionId}, result=${cancelled}`);
      }
      // inline 위젯은 CLI가 없으므로 다른 이벤트는 무시
      return;
    }

    // CLI 위젯 처리
    if (!this.deps.widgetManager) {
      this.log('[Widget] WidgetManager not configured');
      return;
    }

    // cancel 이벤트면 위젯 종료
    if (data.type === 'cancel') {
      const cancelled = this.deps.mcpServer?.cancelWidgetBySessionId(sessionId, 'User cancelled');
      this.log(`[Widget] CLI widget cancel: ${sessionId}, result=${cancelled}`);
      return;
    }

    this.deps.widgetManager.sendEvent(sessionId, data);
  }

  /**
   * Widget ready 브로드캐스트
   *
   * 위젯이 준비되었음을 모든 클라이언트에게 알립니다.
   * preferredClientId(lastActiveClient)를 포함하여 전송합니다.
   */
  broadcastWidgetReady(
    sessionId: string,
    conversationId: ConversationId,
    toolUseId: string,
  ): void {
    const preferredClientId = this.deps.workspaceStore.getLastActiveClient(conversationId);

    this.log(`[Widget] Broadcasting ready: session=${sessionId}, preferred=${preferredClientId}`);

    this.send({
      type: 'widget_ready',
      payload: {
        conversationId,
        sessionId,
        toolUseId,
        preferredClientId: preferredClientId ?? null,
      },
      broadcast: 'clients',
    });
  }

  /**
   * Widget 소유권 요청 처리
   *
   * - ready 상태: 첫 claim → owner가 되어 CLI 시작
   * - running 상태: 기존 세션 종료, MCP 도구에 cancelled 반환
   */
  private handleWidgetClaim(
    payload: Record<string, unknown> | undefined,
    from?: MessageFrom,
  ): void {
    if (!isWidgetClaimPayload(payload)) {
      this.log('[Widget] Invalid widget_claim payload');
      return;
    }

    const { sessionId } = payload;
    const clientId = from?.deviceId;

    if (clientId === undefined) {
      this.log('[Widget] Missing clientId in widget_claim');
      return;
    }

    const result = this.deps.widgetManager?.claimOwnership(sessionId, clientId);

    if (!result) {
      this.log(`[Widget] Ownership claim failed: session=${sessionId}, client=${clientId}`);
      return;
    }

    if ('started' in result && result.started) {
      this.log(`[Widget] Ownership claimed, CLI started: session=${sessionId}, owner=${clientId}`);
      // widget_render는 CLI 출력에서 발생하므로 여기서는 아무것도 전송하지 않음
    } else if ('cancelled' in result && result.cancelled) {
      this.log(`[Widget] Session cancelled by claim: session=${sessionId}, claimer=${clientId}`);
      const session = this.deps.widgetManager?.getSession(sessionId);
      const conversationId = session?.conversationId;

      // 기존 owner에게 widget_close 전송
      if (session?.ownerClientId !== null && session?.ownerClientId !== undefined) {
        this.send({
          type: 'widget_close',
          payload: {
            conversationId,
            sessionId,
            reason: 'claimed_by_other',
          },
          to: [session.ownerClientId],
        });
      }

      // claim 요청한 클라이언트(B)에게도 widget_close 전송 (세션 정리용)
      this.send({
        type: 'widget_close',
        payload: {
          conversationId,
          sessionId,
          reason: 'session_cancelled',
        },
        to: [clientId],
      });
    }
  }

  /**
   * Widget 세션 유효성 확인 처리
   *
   * @description
   * 클라이언트가 대화로 복귀했을 때 위젯 세션이 아직 유효한지 확인합니다.
   * - pending widget이 없으면 invalid
   * - sessionId가 다르면 invalid
   * - 프로세스가 죽었으면 invalid + 정리
   * - 그 외에는 valid
   */
  private handleWidgetCheck(payload: Record<string, unknown> | undefined, from?: MessageFrom): void {
    if (!isWidgetCheckPayload(payload)) {
      this.log('[Widget] Invalid widget_check payload');
      return;
    }

    const { conversationId, sessionId } = payload;

    // MCP 서버에서 pending widget 조회
    const pending = this.deps.mcpServer?.getPendingWidget(conversationId);

    // pending이 없거나 sessionId가 다르면 invalid
    if (!pending || pending.widgetSessionId !== sessionId) {
      this.sendWidgetCheckResult(conversationId, sessionId, false, from?.deviceId);
      return;
    }

    // inline widget인 경우 (프로세스 없음 → 항상 valid)
    if (pending.widgetSessionId.startsWith('inline-')) {
      this.sendWidgetCheckResult(conversationId, sessionId, true, from?.deviceId);
      return;
    }

    // WidgetManager에서 프로세스 상태 확인
    const session = this.deps.widgetManager?.getSession(pending.widgetSessionId);

    // ready (CLI 시작 대기) 또는 running (CLI 실행 중) 상태면 valid
    if (!session || (session.status !== 'running' && session.status !== 'ready')) {
      // 죽은 프로세스 - 정리
      this.deps.mcpServer?.cancelWidgetForConversation(conversationId);
      this.sendWidgetCheckResult(conversationId, sessionId, false, from?.deviceId);
      return;
    }

    // 정상
    this.sendWidgetCheckResult(conversationId, sessionId, true, from?.deviceId);
  }

  /**
   * Widget 세션 유효성 확인 결과 전송
   */
  private sendWidgetCheckResult(
    conversationId: number,
    sessionId: string,
    valid: boolean,
    targetDeviceId?: number,
  ): void {
    const message: Record<string, unknown> = {
      type: 'widget_check_result',
      payload: { conversationId, sessionId, valid },
    };

    if (targetDeviceId !== undefined) {
      message.to = [targetDeviceId];
    }

    this.send(message);
  }

  /**
   * 위젯 완료 브로드캐스트
   *
   * @description
   * 위젯 세션이 완료되면 모든 클라이언트에게 종료 화면과 결과를 브로드캐스트합니다.
   *
   * @param conversationId - 대화 ID
   * @param toolUseId - 도구 사용 ID
   * @param sessionId - 위젯 세션 ID
   * @param view - 종료 화면 (ViewNode)
   * @param result - 위젯 결과
   */
  sendWidgetComplete(
    conversationId: number,
    toolUseId: string,
    sessionId: string,
    view: ViewNode,
    result: unknown,
  ): void {
    console.log(`[Widget] sendWidgetComplete: session=${sessionId}, toolUseId=${toolUseId}`);
    this.send({
      type: 'widget_complete',
      payload: {
        conversationId,
        sessionId,
        toolUseId,
        view,
        result,
      },
      broadcast: 'clients',
    });
  }

  /**
   * 클라이언트 연결 해제 시 위젯 정리
   *
   * @description
   * 해당 클라이언트가 소유한 모든 위젯 세션을 종료하고,
   * 다른 클라이언트들에게 에러를 브로드캐스트합니다.
   *
   * @param clientId - 연결 해제된 클라이언트 ID
   */
  private handleClientDisconnect(clientId: number): void {
    const sessions = this.deps.widgetManager?.getSessionsByOwner(clientId);

    for (const session of sessions ?? []) {
      // 위젯 강제 종료
      this.deps.widgetManager?.cancelSession(session.sessionId);

      // 에러 브로드캐스트
      this.send({
        type: 'widget_error',
        payload: {
          conversationId: session.conversationId,
          sessionId: session.sessionId,
          toolUseId: session.toolUseId,
          error: 'Widget owner disconnected',
        },
        broadcast: 'clients',
      });
    }
  }

  /**
   * Claude 이벤트 전달
   *
   * @description
   * AgentManager에서 발생한 이벤트를 클라이언트에게 전달합니다.
   *
   * @param conversationId - 대화 ID
   * @param event - Claude 이벤트
   */
  sendClaudeEvent(conversationId: number, event: AgentManagerEvent): void {
    // ToolSearch 이벤트는 브로드캐스트/히스토리 저장 불필요
    const e = event as Record<string, unknown>;
    if ((event.type === 'toolInfo' || event.type === 'toolComplete' || event.type === 'toolProgress') && e.toolName === 'ToolSearch') {
      return;
    }

    // 이벤트 타입별 메시지 저장
    this.saveEventToHistory(conversationId, event);

    // init 이벤트에서 agentSessionId 저장
    if (event.type === 'init' && (event as Record<string, unknown>).session_id) {
      this.deps.workspaceStore.updateAgentSessionId(
        conversationId as ConversationId,
        (event as Record<string, unknown>).session_id as string
      );
      this.saveWorkspaceStore().catch((err) => {
        this.log(`[Persistence] Failed to save agentSessionId: ${err}`);
      });
    }

    // result 이벤트에서 사용량 누적
    if (event.type === 'result') {
      this.accumulateUsage(event);
    }

    const message = {
      type: 'claude_event',
      payload: { conversationId, event },
    };

    // 해당 세션을 시청 중인 클라이언트에게만 전송
    const viewers = this.getSessionViewers(conversationId);
    // DEBUG: viewers 로그
    this.log(`[Claude] Sending to viewers: ${JSON.stringify(Array.from(viewers))} (size=${viewers.size})`);
    if (viewers.size > 0) {
      this.send({
        ...message,
        to: Array.from(viewers),
      });
    }

    // 상태 변경은 모든 클라이언트에게 브로드캐스트
    if (event.type === 'state') {
      const state = (event as Record<string, unknown>).state as ConversationStatusValue;
      this.deps.workspaceStore.updateConversationStatus(conversationId as ConversationId, state);
      this.scheduleSaveWorkspaceStore();

      this.send({
        type: 'conversation_status',
        payload: {
          deviceId: this.config.deviceId,
          conversationId,
          status: state,
        },
        broadcast: 'clients',
      });
    }

    // 안 보고 있는 앱에게 unread 알림
    if (['textComplete', 'toolComplete', 'result', 'agentAborted'].includes(event.type)) {
      this.sendUnreadToNonViewers(conversationId, viewers);
    }
  }

  // ==========================================================================
  // Private 메서드 - 콜백 설정
  // ==========================================================================

  /**
   * 콜백 설정
   */
  private setupCallbacks(): void {
    // Relay 메시지 콜백
    this.deps.relayClient.onMessage((data) => {
      this.deps.packetLogger.logRecv('relay', data);
      this.handleMessage(data as Record<string, unknown>);
    });

    // Relay 상태 변경 콜백
    this.deps.relayClient.onStatusChange((isConnected) => {
      if (!isConnected) {
        this.authenticated = false;
        this.deviceInfo = null;
      }
    });
  }

  // ==========================================================================
  // Private 메서드 - 인증 관련
  // ==========================================================================

  /**
   * 인증 결과 처리
   */
  private handleAuthResult(payload: Record<string, unknown> | undefined): void {
    if (payload?.success) {
      this.authenticated = true;
      const device = payload.device as DeviceInfo;
      this.deviceInfo = device;
      this.log(`Authenticated as ${device?.name || this.config.deviceId}`);
      // broadcastWorkspaceList()에서 계정 상태도 함께 전송
      this.broadcastWorkspaceList();
    } else {
      this.log(`Auth failed: ${payload?.error}`);
    }
  }

  /**
   * 레거시 registered 처리
   */
  private handleRegistered(): void {
    this.authenticated = true;
    if (!this.deviceInfo) {
      this.deviceInfo = {
        deviceId: String(this.config.deviceId),
        name: `Device ${this.config.deviceId}`,
      };
    }
    this.log(`Registered as Device ${this.config.deviceId}`);
    this.broadcastWorkspaceList();
  }

  /**
   * 디바이스 상태 처리
   */
  private handleDeviceStatus(_payload: Record<string, unknown> | undefined): void {
    this.broadcastPylonStatus();
  }

  // ==========================================================================
  // Private 메서드 - 상태 조회
  // ==========================================================================

  /**
   * get_status 처리
   */
  private handleGetStatus(from: MessageFrom | undefined): void {
    if (from?.deviceId === undefined) return;
    this.send({
      type: 'status',
      to: [from.deviceId],
      payload: {
        deviceId: this.config.deviceId,
        deviceInfo: this.deviceInfo,
        authenticated: this.authenticated,
        workspaces: this.deps.workspaceStore.getAllWorkspaces(),
      },
    });
  }

  // ==========================================================================
  // Private 메서드 - 히스토리
  // ==========================================================================

  /**
   * 히스토리 요청 처리 (페이징: 100KB 제한)
   *
   * @param loadBefore - 이 인덱스 이전의 메시지를 로드 (0이면 최신부터)
   */
  private handleHistoryRequest(
    payload: Record<string, unknown> | undefined,
    from: MessageFrom | undefined
  ): void {
    const { conversationId, loadBefore = 0 } = payload || {};
    if (!conversationId) return;

    const MAX_BYTES = 100 * 1024; // 100KB
    const eid = conversationId as number;
    const totalCount = this.deps.messageStore.getCount(eid);
    const messages = this.deps.messageStore.getMessages(eid, {
      maxBytes: MAX_BYTES,
      loadBefore: loadBefore as number,
    });

    // hasMore 계산:
    // - 초기 로드 (loadBefore=0): 반환된 메시지 수 < totalCount
    // - 페이징 (loadBefore>0): loadBefore - messages.length > 0 (더 과거 메시지 있음)
    const lb = loadBefore as number;
    const hasMore = lb > 0
      ? (lb - messages.length) > 0
      : messages.length < totalCount;

    if (from?.deviceId !== undefined) {
      this.send({
        type: 'history_result',
        to: [from.deviceId],
        payload: {
          deviceId: this.config.deviceId,
          conversationId: eid,
          messages,
          loadBefore,
          totalCount,
          hasMore,
        },
      });
    }
  }

  /**
   * share_history 요청 처리 (Viewer용)
   *
   * @description
   * Viewer가 보낸 share_history 요청을 처리합니다.
   * shareId를 검증하고, 유효하면 해당 대화의 메시지 목록을 반환합니다.
   *
   * @param payload - 요청 페이로드 ({ shareId: string })
   * @param from - 발신자 정보
   */
  private handleShareHistory(
    payload: Record<string, unknown> | undefined,
    from: MessageFrom | undefined
  ): void {
    const shareId = payload?.shareId as string | undefined;
    const fromDeviceId = from?.deviceId;

    // from이 없으면 응답 불가
    if (fromDeviceId === undefined) return;

    // shareId 필수 확인
    if (!shareId || shareId.trim() === '') {
      this.send({
        type: 'share_history_result',
        to: [fromDeviceId],
        payload: {
          success: false,
          error: 'Missing shareId',
        },
      });
      return;
    }

    // shareStore가 없으면 에러
    if (!this.deps.shareStore) {
      this.send({
        type: 'share_history_result',
        to: [fromDeviceId],
        payload: {
          success: false,
          error: 'Share feature not available',
        },
      });
      return;
    }

    // shareId 검증
    const validateResult = this.deps.shareStore.validate(shareId);
    if (!validateResult.valid || validateResult.conversationId === undefined) {
      this.send({
        type: 'share_history_result',
        to: [fromDeviceId],
        payload: {
          success: false,
          error: 'Share not found',
        },
      });
      return;
    }

    const conversationId = validateResult.conversationId;

    // 공유 전용 메서드: 시간순(과거→최신) 전체 메시지 반환
    const messages = this.deps.messageStore.getSharedMessageHistory(conversationId);

    // share_history_result 응답
    this.send({
      type: 'share_history_result',
      to: [fromDeviceId],
      payload: {
        shareId,
        conversationId,
        messages,
      },
    });
  }

  /**
   * slash_commands_request 처리
   *
   * @description
   * 클라이언트가 `/` 입력 시 사용 가능한 슬래시 명령어 목록을 요청합니다.
   * .claude/skills/ 폴더에서 스킬 파일을 읽어서 반환합니다.
   *
   * @param payload - 요청 페이로드 ({ conversationId: number })
   * @param from - 발신자 정보
   */
  private handleSlashCommandsRequest(
    payload: Record<string, unknown> | undefined,
    from: MessageFrom | undefined
  ): void {
    this.log(`[slash_commands_request] from=${JSON.stringify(from)}, payload=${JSON.stringify(payload)}`);

    const fromDeviceId = from?.deviceId;
    if (fromDeviceId === undefined) return;

    const conversationId = payload?.conversationId as number | undefined;
    if (!conversationId) {
      this.send({
        type: 'slash_commands_result',
        to: [fromDeviceId],
        payload: {
          success: false,
          error: 'Missing conversationId',
          slashCommands: [],
        },
      });
      return;
    }

    // conversationId에서 workspaceId 추출하여 워크스페이스 찾기
    const decoded = decodeConversationIdFull(conversationId as ConversationId);
    this.log(`[slash_commands_request] decoded=${JSON.stringify(decoded)}`);

    const workspace = this.deps.workspaceStore.getWorkspace(decoded.workspaceId);
    const workingDir = workspace?.workingDir || '';
    this.log(`[slash_commands_request] workspace=${workspace?.name}, workingDir=${workingDir}`);

    if (!workingDir) {
      this.log(`[slash_commands_request] No workingDir, sending empty result`);
      this.send({
        type: 'slash_commands_result',
        to: [fromDeviceId],
        payload: {
          conversationId,
          success: true,
          slashCommands: [],
        },
      });
      return;
    }

    // .claude/skills 폴더에서 스킬 파일 읽기
    const slashCommands = this.readSkillsFromFolder(workingDir);
    this.log(`[slash_commands_request] slashCommands=${JSON.stringify(slashCommands)}, sending to ${fromDeviceId}`);

    this.send({
      type: 'slash_commands_result',
      to: [fromDeviceId],
      payload: {
        conversationId,
        success: true,
        slashCommands,
      },
    });
  }

  /**
   * 워크스페이스 및 글로벌 스킬 폴더에서 스킬 파일 목록 읽기
   *
   * @param workingDir - 워크스페이스 작업 디렉토리
   * @returns 슬래시 명령어 목록 (예: ['/tdd-flow', '/keybindings-help'])
   *
   * @description
   * 스킬 검색 경로:
   * 1. 워크스페이스: {workingDir}/.claude/skills/
   * 2. 글로벌: ~/.claude/skills/
   *
   * Claude Code 스킬은 두 가지 형태가 있습니다:
   * 1. .claude/skills/skill-name.md (단일 파일)
   * 2. .claude/skills/skill-name/SKILL.md (폴더 형태)
   */
  private readSkillsFromFolder(workingDir: string): string[] {
    const homeDir = os.homedir();

    // 검색할 스킬 디렉토리 목록
    const skillsDirs = [
      path.join(workingDir, '.claude', 'skills'),  // 워크스페이스 스킬
      path.join(homeDir, '.claude', 'skills'),      // 글로벌 스킬
    ];

    const skillSet = new Set<string>();

    for (const skillsDir of skillsDirs) {
      try {
        if (!fs.existsSync(skillsDir)) {
          continue;
        }

        const entries = fs.readdirSync(skillsDir, { withFileTypes: true }) as Array<{
          name: string;
          isDirectory: () => boolean;
          isFile: () => boolean;
        }>;

        for (const entry of entries) {
          if (entry.isFile() && entry.name.endsWith('.md')) {
            // 단일 .md 파일 형태: skill-name.md → /skill-name
            const skillName = entry.name.replace(/\.md$/, '');
            skillSet.add(`/${skillName}`);
          } else if (entry.isDirectory()) {
            // 폴더 형태: skill-name/SKILL.md → /skill-name
            const skillMdPath = path.join(skillsDir, entry.name, 'SKILL.md');
            if (fs.existsSync(skillMdPath)) {
              skillSet.add(`/${entry.name}`);
            }
          }
        }
      } catch (error) {
        this.log(`Error reading skills folder ${skillsDir}: ${error}`);
      }
    }

    return Array.from(skillSet).sort();
  }

  // ==========================================================================
  // Private 메서드 - 워크스페이스
  // ==========================================================================

  /**
   * workspace_list 처리
   */
  private handleWorkspaceList(from: MessageFrom | undefined): void {
    if (from?.deviceId === undefined) return;
    const workspaces = this.deps.workspaceStore.getAllWorkspaces();
    const activeState = this.deps.workspaceStore.getActiveState();

    // 매크로 조회 (broadcastWorkspaceList와 동일한 패턴)
    const workspaceIds = workspaces.map(ws => ws.workspaceId);
    const macrosByWs = this.deps.macroStore
      ? this.deps.macroStore.getMacrosByWorkspaces(workspaceIds)
      : new Map();

    const workspacesWithMacros = workspaces.map((ws) => ({
      ...ws,
      macros: macrosByWs.get(ws.workspaceId) ?? [],
    }));

    this.send({
      type: 'workspace_list_result',
      to: [from.deviceId],
      payload: {
        deviceId: this.config.deviceId,
        workspaces: workspacesWithMacros,
        activeWorkspaceId: activeState.activeWorkspaceId,
        activeConversationId: activeState.activeConversationId,
        account: this.cachedAccount,
      },
    });
  }

  /**
   * workspace_create 처리
   */
  private handleWorkspaceCreate(
    payload: Record<string, unknown> | undefined,
    from: MessageFrom | undefined
  ): void {
    const { name, workingDir } = payload || {};
    if (!name || !workingDir) return;

    const result = this.deps.workspaceStore.createWorkspace(name as string, workingDir as string);
    if (from?.deviceId !== undefined) {
      this.send({
        type: 'workspace_create_result',
        to: [from.deviceId],
        payload: {
          deviceId: this.config.deviceId,
          success: true,
          workspace: result.workspace,
          conversation: result.conversation,
        },
      });
    }
    // 글로벌 매크로를 새 워크스페이스에 전파
    if (this.deps.macroStore) {
      this.deps.macroStore.propagateGlobalMacros(result.workspace.workspaceId);
    }
    this.broadcastWorkspaceList();
    this.saveWorkspaceStore().catch((err) => {
      this.deps.logger.error(`[Pylon] Failed to save after workspace create: ${err}`);
    });
  }

  /**
   * workspace_delete 처리
   */
  private handleWorkspaceDelete(
    payload: Record<string, unknown> | undefined,
    from: MessageFrom | undefined
  ): void {
    const { workspaceId } = payload || {};
    if (!workspaceId) return;

    // 삭제 전에 모든 대화의 메시지 정리
    const workspace = this.deps.workspaceStore.getWorkspace(workspaceId as number);
    if (workspace) {
      for (const conv of workspace.conversations) {
        // Agent 세션 정리
        try {
          if (this.deps.agentManager.hasActiveSession(conv.conversationId)) {
            this.deps.agentManager.stop(conv.conversationId);
          }
        } catch (err) {
          this.deps.logger.error(`[Pylon] Failed to stop agent on workspace delete: ${err}`);
        }
        // 위젯 정리
        this.deps.mcpServer?.cancelWidgetForConversation(conv.conversationId);
        // 메시지 정리
        this.clearMessagesForConversation(conv.conversationId);
      }
    }

    const success = this.deps.workspaceStore.deleteWorkspace(workspaceId as number);
    if (from?.deviceId !== undefined) {
      this.send({
        type: 'workspace_delete_result',
        to: [from.deviceId],
        payload: { deviceId: this.config.deviceId, success, workspaceId },
      });
    }
    if (success) {
      this.broadcastWorkspaceList();
      this.saveWorkspaceStore().catch((err) => {
        this.deps.logger.error(`[Pylon] Failed to save after workspace delete: ${err}`);
      });
    }
  }

  /**
   * workspace_update 처리
   */
  private handleWorkspaceUpdate(
    payload: Record<string, unknown> | undefined,
    from: MessageFrom | undefined
  ): void {
    const { workspaceId, name, workingDir } = payload || {};
    if (!workspaceId) return;

    const success = this.deps.workspaceStore.updateWorkspace(workspaceId as number, {
      name: name as string | undefined,
      workingDir: workingDir as string | undefined,
    });

    if (from?.deviceId !== undefined) {
      this.send({
        type: 'workspace_update_result',
        to: [from.deviceId],
        payload: { deviceId: this.config.deviceId, success, workspaceId },
      });
    }

    if (success) {
      this.broadcastWorkspaceList();
      this.saveWorkspaceStore().catch((err) => {
        this.deps.logger.error(`[Pylon] Failed to save after workspace update: ${err}`);
      });
    }
  }

  /**
   * workspace_reorder 처리
   */
  private handleWorkspaceReorder(payload: Record<string, unknown> | undefined): void {
    const { workspaceIds } = payload || {};
    if (!workspaceIds || !Array.isArray(workspaceIds)) return;

    const success = this.deps.workspaceStore.reorderWorkspaces(workspaceIds as number[]);
    if (success) {
      this.broadcastWorkspaceList();
      this.saveWorkspaceStore().catch((err) => {
        this.deps.logger.error(`[Pylon] Failed to save after workspace reorder: ${err}`);
      });
    }
  }

  /**
   * conversation_reorder 처리
   */
  private handleConversationReorder(payload: Record<string, unknown> | undefined): void {
    const { workspaceId, conversationIds } = payload || {};
    if (!workspaceId || !conversationIds || !Array.isArray(conversationIds)) return;

    const success = this.deps.workspaceStore.reorderConversations(
      workspaceId as number,
      conversationIds as ConversationId[]
    );
    if (success) {
      this.broadcastWorkspaceList();
      this.saveWorkspaceStore().catch((err) => {
        this.deps.logger.error(`[Pylon] Failed to save after conversation reorder: ${err}`);
      });
    }
  }

  /**
   * workspace_rename 처리
   */
  private handleWorkspaceRename(payload: Record<string, unknown> | undefined): void {
    const { workspaceId, newName } = payload || {};
    if (!workspaceId || !newName) return;

    const success = this.deps.workspaceStore.renameWorkspace(workspaceId as number, newName as string);
    if (success) {
      this.broadcastWorkspaceList();
      this.saveWorkspaceStore().catch((err) => {
        this.deps.logger.error(`[Pylon] Failed to save after workspace rename: ${err}`);
      });
    }
  }

  /**
   * workspace_switch 처리
   */
  private handleWorkspaceSwitch(payload: Record<string, unknown> | undefined): void {
    const { workspaceId, conversationId } = payload || {};
    if (!workspaceId) return;

    this.deps.workspaceStore.setActiveWorkspace(
      workspaceId as number,
      conversationId as ConversationId | undefined
    );
    this.broadcastWorkspaceList();
    this.saveWorkspaceStore().catch((err) => {
      this.deps.logger.error(`[Pylon] Failed to save after workspace switch: ${err}`);
    });
  }

  // ==========================================================================
  // Private 메서드 - 대화
  // ==========================================================================

  /**
   * conversation_create 처리
   */
  private handleConversationCreate(
    payload: Record<string, unknown> | undefined,
    from: MessageFrom | undefined
  ): void {
    const { workspaceId, name } = payload || {};
    if (!workspaceId) return;

    const conversation = this.deps.workspaceStore.createConversation(
      workspaceId as number,
      name as string | undefined
    );

    if (from?.deviceId !== undefined) {
      this.send({
        type: 'conversation_create_result',
        to: [from.deviceId],
        payload: {
          deviceId: this.config.deviceId,
          success: !!conversation,
          workspaceId,
          conversation,
        },
      });
    }

    if (conversation) {
      // ID 재사용 대비: 기존 메시지 파일 삭제 및 캐시 클리어
      this.clearMessagesForConversation(conversation.conversationId);

      this.broadcastWorkspaceList();
      this.saveWorkspaceStore().catch((err) => {
        this.deps.logger.error(`[Pylon] Failed to save after conversation create: ${err}`);
      });

      // 세션 뷰어 등록
      if (from?.deviceId) {
        this.registerSessionViewer(from.deviceId, conversation.conversationId);
      }

      // 새 대화 생성 시 초기 컨텍스트 자동 전송
      this.sendInitialContext(conversation.conversationId);
    }
  }

  /**
   * conversation_delete 처리
   */
  private handleConversationDelete(payload: Record<string, unknown> | undefined): boolean {
    const { conversationId } = payload || {};
    if (!conversationId) return false;

    const eid = conversationId as ConversationId;

    // Agent 세션 정리 (있으면)
    try {
      if (this.deps.agentManager.hasActiveSession(eid)) {
        this.deps.agentManager.stop(eid);
      }
    } catch (err) {
      this.deps.logger.error(`[Pylon] Failed to stop agent session on delete: ${err}`);
    }

    // 위젯 정리 (있으면)
    this.deps.mcpServer?.cancelWidgetForConversation(conversationId as number);

    // 삭제 전에 메시지 정리
    this.clearMessagesForConversation(eid);

    const success = this.deps.workspaceStore.deleteConversation(eid);
    if (success) {
      this.broadcastWorkspaceList();
      this.saveWorkspaceStore().catch((err) => {
        this.deps.logger.error(`[Pylon] Failed to save after conversation delete: ${err}`);
      });
    }
    return success;
  }

  /**
   * conversation_rename 처리
   */
  private handleConversationRename(payload: Record<string, unknown> | undefined): void {
    const { conversationId, newName } = payload || {};
    if (!conversationId || !newName) return;

    const eid = conversationId as ConversationId;

    // 이전 이름 저장 (리마인더 전송용)
    const oldConversation = this.deps.workspaceStore.getConversation(eid);
    const oldName = oldConversation?.name || '';

    const success = this.deps.workspaceStore.renameConversation(eid, newName as string);
    if (success) {
      this.broadcastWorkspaceList();
      this.saveWorkspaceStore().catch((err) => {
        this.deps.logger.error(`[Pylon] Failed to save after conversation rename: ${err}`);
      });

      // 활성 세션에 리마인더 전송
      if (this.deps.agentManager.hasActiveSession(eid)) {
        const reminder = buildConversationRenamedReminder(oldName, newName as string);
        const workingDir = this.getWorkingDirForConversation(eid);
        if (workingDir) {
          this.deps.agentManager.sendMessage(eid, reminder, { workingDir });
        }
      }
    }
  }

  /**
   * link_document 처리
   */
  private handleLinkDocument(payload: Record<string, unknown> | undefined): void {
    const { conversationId, path } = payload || {};
    if (!conversationId || !path) return;

    const eid = conversationId as ConversationId;
    const docPath = path as string;

    // 문서 연결
    const success = this.deps.workspaceStore.linkDocument(eid, docPath);
    if (success) {
      this.broadcastWorkspaceList();
      this.saveWorkspaceStore().catch((err) => {
        this.deps.logger.error(`[Pylon] Failed to save after link document: ${err}`);
      });

      // 활성 세션에 리마인더 전송
      if (this.deps.agentManager.hasActiveSession(eid)) {
        const reminder = buildDocumentAddedReminder(docPath);
        const workingDir = this.getWorkingDirForConversation(eid);
        if (workingDir) {
          this.deps.agentManager.sendMessage(eid, reminder, { workingDir });
        }
      }
    }
  }

  /**
   * unlink_document 처리
   */
  private handleUnlinkDocument(payload: Record<string, unknown> | undefined): void {
    const { conversationId, path } = payload || {};
    if (!conversationId || !path) return;

    const eid = conversationId as ConversationId;
    const docPath = path as string;

    // 문서 연결 해제
    const success = this.deps.workspaceStore.unlinkDocument(eid, docPath);
    if (success) {
      this.broadcastWorkspaceList();
      this.saveWorkspaceStore().catch((err) => {
        this.deps.logger.error(`[Pylon] Failed to save after unlink document: ${err}`);
      });

      // 활성 세션에 리마인더 전송
      if (this.deps.agentManager.hasActiveSession(eid)) {
        const reminder = buildDocumentRemovedReminder(docPath);
        const workingDir = this.getWorkingDirForConversation(eid);
        if (workingDir) {
          this.deps.agentManager.sendMessage(eid, reminder, { workingDir });
        }
      }
    }
  }

  /**
   * conversationId로 workingDir 조회 (헬퍼)
   */
  private getWorkingDirForConversation(conversationId: ConversationId): string | null {
    const decoded = decodeConversationIdFull(conversationId);
    const workspace = this.deps.workspaceStore.getWorkspace(decoded.workspaceId);
    return workspace?.workingDir ?? null;
  }

  /**
   * conversation_select 처리
   *
   * 멀티 Pylon 환경에서 브로드캐스트로 수신됨:
   * - 내 대화면: active 설정 + 히스토리 전송
   * - 다른 Pylon 대화면: activeConversationId를 null로 deselect
   */
  private handleConversationSelect(
    payload: Record<string, unknown> | undefined,
    from: MessageFrom | undefined
  ): void {
    // DEBUG: from 정보 로그
    this.log(`[conversation_select] from=${JSON.stringify(from)}, payload=${JSON.stringify(payload)}`);
    const { conversationId, workspaceId } = payload || {};
    if (!conversationId) return;

    const eid = conversationId as number;
    const wsId = workspaceId as number;

    // 이 대화가 내 Pylon의 것인지 확인
    const conversation = this.deps.workspaceStore.getConversation(eid as ConversationId);
    if (!conversation) {
      // 다른 Pylon의 대화 → 내 activeConversationId를 null로 deselect
      const currentActive = this.deps.workspaceStore.getActiveState().activeConversationId;
      if (currentActive !== null) {
        this.log(`[conversation_select] Deselecting my conversation (other Pylon's conversation selected)`);
        this.deps.workspaceStore.clearActiveConversation();
        this.scheduleSaveWorkspaceStore();
      }
      // 클라이언트를 세션 시청자에서도 제거 (이벤트 스트림 구독 해제)
      if (from?.deviceId) {
        this.unregisterSessionViewer(from.deviceId);
      }
      return;
    }

    // 내 대화 → 기존 로직 실행
    // 워크스페이스와 대화 모두 active 상태로 설정
    if (wsId) {
      this.deps.workspaceStore.setActiveWorkspace(wsId);
    }
    this.deps.workspaceStore.setActiveConversation(eid as ConversationId);

    // unread 해제 및 클라이언트에 알림
    if (conversation.unread) {
      this.deps.workspaceStore.updateConversationUnread(eid as ConversationId, false);

      // 모든 클라이언트에게 unread 변경만 알림 (status는 현재 값 유지)
      this.send({
        type: 'conversation_status',
        payload: {
          deviceId: this.config.deviceId,
          conversationId: eid,
          status: conversation.status,
          unread: false,
        },
        broadcast: 'clients',
      });

      // 해당 앱의 unread 전송 기록도 초기화
      if (from?.deviceId) {
        const unreadSent = this.appUnreadSent.get(String(from.deviceId));
        if (unreadSent) {
          unreadSent.delete(eid);
        }
      }
    }

    // 저장
    this.scheduleSaveWorkspaceStore();

    // 클라이언트를 해당 세션의 시청자로 등록 (인코딩된 deviceId)
    if (from?.deviceId) {
      this.registerSessionViewer(from.deviceId, eid);

      // 활성 세션 정보
      const hasActiveSession = this.deps.agentManager.hasActiveSession(eid);
      const workStartTime = this.deps.agentManager.getSessionStartTime(eid);

      // 현재 상태 판단 (재연결 시 정확한 상태 동기화)
      // idle: 활성 세션 없음
      // permission: 활성 세션 있고 pending 이벤트 있음
      // working: 활성 세션 있고 pending 이벤트 없음
      let currentStatus: 'idle' | 'working' | 'permission' = 'idle';
      if (hasActiveSession) {
        const pendingEvent = this.deps.agentManager.getPendingEvent(eid);
        if (pendingEvent) {
          currentStatus = 'permission';
        } else {
          currentStatus = 'working';
        }
      }

      // 메시지 히스토리 전송 (페이징: 100KB 제한)
      const MAX_BYTES = 100 * 1024; // 100KB
      const totalCount = this.deps.messageStore.getCount(eid);
      const messages = this.deps.messageStore.getMessages(eid, { maxBytes: MAX_BYTES });
      const hasMore = messages.length < totalCount;

      this.send({
        type: 'history_result',
        to: [from.deviceId],
        payload: {
          deviceId: this.config.deviceId,
          conversationId: eid,
          messages,
          totalCount,
          hasMore,
          hasActiveSession,
          workStartTime,
          currentStatus,
        },
      });

      // pending 이벤트가 있으면 전송
      const pendingEvent = this.deps.agentManager.getPendingEvent(eid);
      if (pendingEvent) {
        const pe = pendingEvent as { type: string };
        if (pe.type === 'permission_request' || pe.type === 'askQuestion') {
          this.send({
            type: 'claude_event',
            payload: { conversationId: eid, event: { type: 'state', state: 'permission' } },
            to: [from.deviceId],
          });
        }
        this.send({
          type: 'claude_event',
          payload: { conversationId: eid, event: pendingEvent },
          to: [from.deviceId],
        });
      }
    }
  }

  // ==========================================================================
  // Private 메서드 - Claude
  // ==========================================================================

  /**
   * claude_send 처리
   */
  private handleClaudeSend(
    payload: Record<string, unknown> | undefined,
    from: MessageFrom | undefined
  ): void {
    const { conversationId, message: userMessage, attachedFileIds, attachments: attachmentPaths } = payload || {};
    const hasAttachments = (attachedFileIds as string[] | undefined)?.length || (attachmentPaths as string[] | undefined)?.length;
    // 메시지나 첨부파일 중 하나는 있어야 함
    if (!conversationId || (!userMessage && !hasAttachments)) return;

    const eid = conversationId as number;

    // workingDir 및 conversation 정보 가져오기
    const conversation = this.deps.workspaceStore.getConversation(eid as ConversationId) ?? null;
    const decoded = decodeConversationIdFull(eid as ConversationId);
    const workspace = this.deps.workspaceStore.getWorkspace(decoded.workspaceId);
    const workingDir = workspace?.workingDir ?? null;

    // 첨부 파일 처리
    let attachments: unknown[] | null = null;
    const pendingFilesForConv = this.pendingFiles.get(eid);
    const fileIds = attachedFileIds as string[] | undefined;
    const paths = attachmentPaths as string[] | undefined;

    // 방법 1: attachedFileIds로 pendingFiles에서 찾기
    if (fileIds && fileIds.length > 0 && pendingFilesForConv) {
      attachments = [];
      for (const fileId of fileIds) {
        const fileInfo = pendingFilesForConv.get(fileId);
        if (fileInfo) {
          attachments.push(fileInfo);
          pendingFilesForConv.delete(fileId);
        }
      }
      if (attachments.length === 0) {
        attachments = null;
      }
    }
    // 방법 2: attachments로 경로가 직접 전달된 경우
    else if (paths && paths.length > 0) {
      attachments = paths.map((path) => {
        const filename = path.split(/[/\\]/).pop() || 'unknown';
        // pendingFiles에서 경로로 thumbnail 찾기
        let thumbnail: string | undefined;
        if (pendingFilesForConv) {
          for (const fileInfo of pendingFilesForConv.values()) {
            const info = fileInfo as { path?: string; thumbnail?: string };
            if (info.path === path) {
              thumbnail = info.thumbnail;
              break;
            }
          }
        }
        return { path, filename, ...(thumbnail && { thumbnail }) };
      });
      if (attachments.length === 0) {
        attachments = null;
      }
    }

    // 사용자 메시지 (빈 문자열 허용)
    const messageText = (userMessage as string) || '';

    // 사용자 메시지 저장
    this.deps.messageStore.addUserMessage(eid, messageText, attachments as never);

    // 사용자 메시지 브로드캐스트
    const userMessageEvent = {
      type: 'claude_event',
      payload: {
        conversationId: eid,
        event: {
          type: 'userMessage',
          content: messageText,
          timestamp: Date.now(),
          ...(attachments && { attachments }),
        },
      },
    };
    this.send({ ...userMessageEvent, broadcast: 'clients' });

    // Claude에게 메시지 전송
    if (workingDir) {
      let promptToSend = messageText;

      // 첨부 파일 경로 추가 (Read 도구 사용 유도)
      // 이 지시문은 히스토리에 저장되지 않음 (promptToSend만 Claude에게 전송)
      if (attachments && attachments.length > 0) {
        const filePaths = (attachments as Array<{ path: string }>)
          .map((file) => `- ${file.path}`)
          .join('\n');
        promptToSend = `[시스템: 아래 파일들을 Read 도구로 읽을 것]\n${filePaths}${messageText ? '\n\n' + messageText : ''}`;
      }

      const agentSessionId = conversation?.claudeSessionId ?? undefined;

      // 세션 컨텍스트 빌드
      const linkedDocs = conversation?.linkedDocuments?.map((d) => d.path) || [];
      const systemPrompt = this.config.buildEnv
        ? buildSystemPrompt(this.config.buildEnv)
        : undefined;

      // autorun 문서 감지
      const autorunDoc = findAutorunDoc(linkedDocs, (p) => {
        try { return fs.readFileSync(p, 'utf-8'); }
        catch { return null; }
      });

      const systemReminder = buildInitialReminder(
        conversation?.name || '새 대화',
        linkedDocs,
        autorunDoc ? { autorunDoc } : undefined
      );

      this.deps.agentManager.sendMessage(eid, promptToSend, {
        workingDir,
        agentSessionId,
        systemPrompt,
        systemReminder,
      });
    }
  }

  /**
   * claude_permission 처리
   */
  private handleClaudePermission(payload: Record<string, unknown> | undefined): void {
    const { conversationId, toolUseId, decision } = payload || {};
    if (!conversationId || !toolUseId || !decision) return;

    this.deps.agentManager.respondPermission(
      conversationId as number,
      toolUseId as string,
      decision as 'allow' | 'deny' | 'allowAll'
    );
  }

  /**
   * claude_answer 처리
   */
  private handleClaudeAnswer(payload: Record<string, unknown> | undefined): void {
    const { conversationId, toolUseId, answer } = payload || {};
    if (!conversationId || !toolUseId) return;

    this.deps.agentManager.respondQuestion(
      conversationId as number,
      toolUseId as string,
      answer as string
    );
  }

  /**
   * claude_control 처리
   */
  private handleClaudeControl(payload: Record<string, unknown> | undefined): void {
    const { conversationId, action } = payload || {};
    if (!conversationId || !action) return;

    const eid = conversationId as number;

    switch (action) {
      case 'stop':
        this.deps.agentManager.stop(eid);
        break;
      case 'new_session':
      case 'clear':
        this.deps.agentManager.newSession(eid);
        this.deps.messageStore.clear(eid);
        // 새 세션 시작 시 초기 컨텍스트 자동 전송
        this.sendInitialContext(eid);
        break;
      case 'compact':
        this.log(`Compact not implemented yet`);
        break;
    }
  }

  /**
   * 초기 컨텍스트 전송 (대화 생성/새 세션 시)
   * @param additionalMessage - 시스템 리마인더 뒤에 추가할 메시지 (한 번에 전송)
   */
  private sendInitialContext(conversationId: number, additionalMessage?: string): void {
    const conversation = this.deps.workspaceStore.getConversation(conversationId as ConversationId);
    if (!conversation) return;

    const workingDir = this.getWorkingDirForConversation(conversationId as ConversationId);
    if (!workingDir) return;

    const linkedDocs = conversation.linkedDocuments?.map((d) => d.path) || [];

    // systemPrompt 결정: customSystemPrompt가 있으면 preset + append 형식 사용
    let systemPrompt: string | { type: 'preset'; preset: 'claude_code'; append?: string } | undefined;
    if (conversation.customSystemPrompt) {
      // customSystemPrompt가 있으면 Claude Code 기본 프롬프트에 append
      systemPrompt = {
        type: 'preset',
        preset: 'claude_code',
        append: conversation.customSystemPrompt,
      };
    } else if (this.config.buildEnv) {
      // 기존 방식: 환경 정보만 포함
      systemPrompt = buildSystemPrompt(this.config.buildEnv);
    }

    // autorun 문서 감지
    const autorunDoc = findAutorunDoc(linkedDocs, (p) => {
      try { return fs.readFileSync(p, 'utf-8'); }
      catch { return null; }
    });

    let systemReminder = buildInitialReminder(
      conversation.name || '',
      linkedDocs,
      autorunDoc ? { autorunDoc } : undefined
    );

    // 추가 메시지가 있으면 시스템 리마인더에 합쳐서 한 번에 전송
    if (additionalMessage) {
      systemReminder = systemReminder + '\n\n' + additionalMessage;
    }

    this.deps.agentManager.sendMessage(conversationId, systemReminder, {
      workingDir,
      systemPrompt,
    });
  }

  /**
   * claude_set_permission_mode 처리
   */
  private handleClaudeSetPermissionMode(payload: Record<string, unknown> | undefined): void {
    const { conversationId, mode } = payload || {};
    if (!conversationId || !mode) return;

    const success = this.deps.workspaceStore.setConversationPermissionMode(
      conversationId as ConversationId,
      mode as PermissionModeValue
    );

    // 변경 성공 시 저장
    if (success) {
      this.saveWorkspaceStore().catch((err) => {
        this.deps.logger.error(`[Persistence] Failed to save permission mode: ${err}`);
      });
    }
  }

  // ==========================================================================
  // Private 메서드 - Blob
  // ==========================================================================

  /**
   * blob_end 결과 처리
   */
  private async handleBlobEndResult(
    result: { success: boolean; path?: string; context?: unknown; mimeType?: string },
    from: MessageFrom | undefined,
    payload: Record<string, unknown> | undefined
  ): Promise<void> {
    if (!result.success) return;

    const context = result.context as { type?: string; conversationId?: number } | undefined;
    if (context?.type === 'image_upload') {
      const { conversationId } = context;
      const blobId = (payload as { blobId?: string })?.blobId;

      if (conversationId && blobId && result.path) {
        const fileId = blobId;
        const filename = result.path.split(/[/\\]/).pop() || 'unknown';
        const mimeType = result.mimeType || 'application/octet-stream';

        // 썸네일 생성 (이미지인 경우에만)
        let thumbnail: string | null = null;
        try {
          thumbnail = await generateThumbnail(result.path, mimeType);
        } catch (err) {
          console.error('[BLOB] Thumbnail generation failed:', err);
        }

        // 클라이언트에 업로드 완료 알림
        if (from?.deviceId !== undefined) {
          this.send({
            type: 'blob_upload_complete',
            to: [from.deviceId],
            payload: {
              blobId,
              fileId,
              path: result.path,
              filename,
              conversationId,
              mimeType,
              ...(thumbnail && { thumbnail }),
            },
          });
        }

        // pending 파일로 저장
        if (!this.pendingFiles.has(conversationId)) {
          this.pendingFiles.set(conversationId, new Map());
        }
        this.pendingFiles.get(conversationId)!.set(fileId, {
          fileId,
          path: result.path,
          filename,
          mimeType,
          ...(thumbnail && { thumbnail }),
        });
      }
    }
  }

  // ==========================================================================
  // Private 메서드 - 폴더
  // ==========================================================================

  /**
   * folder_list 처리
   *
   * path가 비어있거나 '__DRIVES__'이면 드라이브 목록 반환
   */
  private handleFolderList(
    payload: Record<string, unknown> | undefined,
    from: MessageFrom | undefined
  ): void {
    const { path: targetPath, deviceId: targetDeviceId } = payload || {};

    // 대상 Pylon이 아니면 무시
    if (targetDeviceId !== undefined && targetDeviceId !== this.config.deviceId) {
      return;
    }

    // 플랫폼 정보
    const platform = this.deps.folderManager.getPlatform();

    // 드라이브 목록 요청 (__DRIVES__) vs 초기 경로 요청 (빈 문자열, undefined, null)
    const isEmptyPath = targetPath === '' || targetPath === undefined || targetPath === null;

    // 빈 경로: 기본 작업 디렉토리로 시작 (새 워크스페이스 다이얼로그 초기 상태)
    if (isEmptyPath) {
      const defaultPath = this.deps.folderManager.getDefaultPath();
      const result = this.deps.folderManager.listFolders(defaultPath);
      if (from?.deviceId !== undefined) {
        this.send({
          type: 'folder_list_result',
          to: [from.deviceId],
          payload: {
            deviceId: this.config.deviceId,
            ...result,  // platform 포함
          },
        });
      }
      return;
    }

    // __DRIVES__: 드라이브/루트 목록 요청
    if (targetPath === '__DRIVES__') {
      const driveResult = this.deps.folderManager.listDrives();

      // Linux인 경우 드라이브 목록 대신 루트 '/'의 폴더 목록 반환
      if (platform === 'linux' && driveResult.drives.length === 1 && driveResult.drives[0].path === '/') {
        const rootResult = this.deps.folderManager.listFolders('/');
        if (from?.deviceId !== undefined) {
          this.send({
            type: 'folder_list_result',
            to: [from.deviceId],
            payload: {
              deviceId: this.config.deviceId,
              ...rootResult,  // platform 포함
            },
          });
        }
        return;
      }

      if (from?.deviceId !== undefined) {
        this.send({
          type: 'folder_list_result',
          to: [from.deviceId],
          payload: {
            deviceId: this.config.deviceId,
            platform,
            path: '',
            folders: driveResult.drives.map((d) => d.label),
            foldersWithChildren: driveResult.drives.map((d) => ({
              name: d.label,
              path: d.path,
              hasChildren: d.hasChildren,
              isDrive: true,
            })),
            success: driveResult.success,
            error: driveResult.error,
          },
        });
      }
      return;
    }

    const result = this.deps.folderManager.listFolders(targetPath as string);
    if (from?.deviceId !== undefined) {
      this.send({
        type: 'folder_list_result',
        to: [from.deviceId],
        payload: {
          deviceId: this.config.deviceId,
          ...result,  // platform 포함
        },
      });
    }
  }

  /**
   * folder_create 처리
   */
  private handleFolderCreate(
    payload: Record<string, unknown> | undefined,
    from: MessageFrom | undefined
  ): void {
    const { path: parentPath, name } = payload || {};
    if (!parentPath || !name) return;

    const result = this.deps.folderManager.createFolder(parentPath as string, name as string);
    if (from?.deviceId !== undefined) {
      this.send({
        type: 'folder_create_result',
        to: [from.deviceId],
        payload: {
          deviceId: this.config.deviceId,
          ...result,
        },
      });
    }
  }

  /**
   * folder_rename 처리
   */
  private handleFolderRename(
    payload: Record<string, unknown> | undefined,
    from: MessageFrom | undefined
  ): void {
    const { path: folderPath, newName } = payload || {};
    if (!folderPath || !newName) return;

    const result = this.deps.folderManager.renameFolder(folderPath as string, newName as string);
    if (from?.deviceId !== undefined) {
      this.send({
        type: 'folder_rename_result',
        to: [from.deviceId],
        payload: {
          deviceId: this.config.deviceId,
          ...result,
        },
      });
    }
  }

  // ==========================================================================
  // Private 메서드 - 태스크
  // ==========================================================================

  /**
   * task_list 처리
   */
  private handleTaskList(
    payload: Record<string, unknown> | undefined,
    from: MessageFrom | undefined
  ): void {
    const { workspaceId } = payload || {};
    const workspace = this.deps.workspaceStore.getWorkspace(workspaceId as number);
    if (!workspace) return;

    const result = this.deps.taskManager.listTasks(workspace.workingDir);
    if (from?.deviceId !== undefined) {
      this.send({
        type: 'task_list_result',
        to: [from.deviceId],
        payload: {
          deviceId: this.config.deviceId,
          workspaceId,
          ...result,
        },
      });
    }
  }

  /**
   * task_get 처리
   */
  private handleTaskGet(
    payload: Record<string, unknown> | undefined,
    from: MessageFrom | undefined
  ): void {
    const { workspaceId, taskId } = payload || {};
    const workspace = this.deps.workspaceStore.getWorkspace(workspaceId as number);
    if (!workspace || !taskId) return;

    const result = this.deps.taskManager.getTask(workspace.workingDir, taskId as string);
    if (from?.deviceId !== undefined) {
      this.send({
        type: 'task_get_result',
        to: [from.deviceId],
        payload: {
          deviceId: this.config.deviceId,
          workspaceId,
          ...result,
        },
      });
    }
  }

  /**
   * task_status 처리
   */
  private handleTaskStatus(
    payload: Record<string, unknown> | undefined,
    from: MessageFrom | undefined
  ): void {
    const { workspaceId, taskId, status, error } = payload || {};
    const workspace = this.deps.workspaceStore.getWorkspace(workspaceId as number);
    if (!workspace || !taskId || !status) return;

    const result = this.deps.taskManager.updateTaskStatus(
      workspace.workingDir,
      taskId as string,
      status as string,
      error as string | undefined
    );
    if (from?.deviceId !== undefined) {
      this.send({
        type: 'task_status_result',
        to: [from.deviceId],
        payload: {
          deviceId: this.config.deviceId,
          workspaceId,
          ...result,
        },
      });
    }

    // 태스크 목록 브로드캐스트
    this.broadcastTaskList(workspaceId as number);
  }

  // ==========================================================================
  // Private 메서드 - 워커
  // ==========================================================================

  /**
   * worker_status 처리
   */
  private handleWorkerStatus(
    payload: Record<string, unknown> | undefined,
    from: MessageFrom | undefined
  ): void {
    const { workspaceId } = payload || {};
    const workspace = this.deps.workspaceStore.getWorkspace(workspaceId as number);
    if (!workspace) return;

    const status = this.deps.workerManager.getWorkerStatus(workspaceId as number, workspace.workingDir);
    if (from?.deviceId !== undefined) {
      this.send({
        type: 'worker_status_result',
        to: [from.deviceId],
        payload: {
          deviceId: this.config.deviceId,
          ...status,
        },
      });
    }
  }

  /**
   * worker_start 처리
   */
  private handleWorkerStart(
    payload: Record<string, unknown> | undefined,
    from: MessageFrom | undefined
  ): void {
    const { workspaceId } = payload || {};
    const workspace = this.deps.workspaceStore.getWorkspace(workspaceId as number);
    if (!workspace) return;

    // 비동기 처리
    (async () => {
      const startClaudeCallback = async (_wsId: number, workingDir: string, prompt: string) => {
        // 워커용 대화 생성 또는 기존 대화 사용
        let conversation = workspace.conversations.find((c) => c.name === 'Worker');
        if (!conversation) {
          conversation = this.deps.workspaceStore.createConversation(workspaceId as number, 'Worker')!;
        }

        this.deps.workspaceStore.setActiveConversation(conversation.conversationId);
        this.deps.agentManager.sendMessage(conversation.conversationId, prompt, { workingDir });

        return {
          process: null,
          conversationId: conversation.conversationId,
        };
      };

      const result = await this.deps.workerManager.startWorker(
        workspaceId as number,
        workspace.workingDir,
        startClaudeCallback
      );

      if (from?.deviceId !== undefined) {
        this.send({
          type: 'worker_start_result',
          to: [from.deviceId],
          payload: {
            deviceId: this.config.deviceId,
            ...result,
          },
        });
      }

      if (result.success) {
        this.broadcastWorkerStatus(workspaceId as number);
        this.broadcastTaskList(workspaceId as number);
      }
    })();
  }

  /**
   * worker_stop 처리
   */
  private handleWorkerStop(
    payload: Record<string, unknown> | undefined,
    from: MessageFrom | undefined
  ): void {
    const { workspaceId } = payload || {};
    const workspace = this.deps.workspaceStore.getWorkspace(workspaceId as number);
    if (!workspace) return;

    const result = this.deps.workerManager.stopWorker(workspaceId as number, workspace.workingDir);
    if (from?.deviceId !== undefined) {
      this.send({
        type: 'worker_stop_result',
        to: [from.deviceId],
        payload: {
          deviceId: this.config.deviceId,
          ...result,
        },
      });
    }
  }

  // ==========================================================================
  // Private 메서드 - 디버그
  // ==========================================================================

  /**
   * debug_log 처리
   */
  private handleDebugLog(
    payload: Record<string, unknown> | undefined,
    from: MessageFrom | undefined
  ): void {
    const { tag, message: logMsg, extra } = payload || {};
    const fromInfo = from ? `${from.name || from.deviceId}` : 'unknown';
    const extraStr = extra ? ` | ${JSON.stringify(extra)}` : '';
    this.log(`[APP:${fromInfo}] [${tag}] ${logMsg}${extraStr}`);
  }

  /**
   * bug_report 처리
   *
   * @description
   * 버그 리포트를 bug-reports.txt 파일에 저장합니다.
   */
  private handleBugReport(payload: Record<string, unknown> | undefined): void {
    const { message, conversationId, workspaceId, timestamp } = payload || {};
    if (!message) return;

    const entry = `[${timestamp || new Date().toISOString()}]
Workspace: ${workspaceId || 'N/A'}
Conversation: ${conversationId || 'N/A'}
Message: ${message}
-----
`;

    // 로그 출력
    this.log(`[BugReport] ${message}`);

    // 파일에 저장 (bugReportWriter가 있는 경우)
    if (this.deps.bugReportWriter) {
      try {
        this.deps.bugReportWriter.append(entry);
        this.log('[BugReport] Saved to bug-reports.txt');
      } catch (err) {
        this.deps.logger.error(`[BugReport] Failed to save: ${err}`);
      }
    }
  }

  // ==========================================================================
  // Private 메서드 - 브로드캐스트
  // ==========================================================================

  /**
   * 워크스페이스 목록 브로드캐스트
   * @param options.forceSelectConversationId - 클라이언트가 강제로 전환할 대화 ID
   */
  broadcastWorkspaceList(options?: { forceSelectConversationId?: number }): void {
    const workspaces = this.deps.workspaceStore.getAllWorkspaces();
    const activeState = this.deps.workspaceStore.getActiveState();

    // 매크로 조회
    const workspaceIds = workspaces.map(ws => ws.workspaceId);
    const macrosByWs = this.deps.macroStore
      ? this.deps.macroStore.getMacrosByWorkspaces(workspaceIds)
      : new Map();

    // 각 워크스페이스에 태스크/워커/매크로 정보 추가
    const workspacesWithTasks = workspaces.map((ws) => {
      const taskResult = this.deps.taskManager.listTasks(ws.workingDir);
      const workerStatus = this.deps.workerManager.getWorkerStatus(ws.workspaceId, ws.workingDir);

      return {
        ...ws,
        tasks: taskResult.success ? taskResult.tasks : [],
        workerStatus,
        macros: macrosByWs.get(ws.workspaceId) ?? [],
      };
    });

    const payload: Record<string, unknown> = {
      deviceId: this.config.deviceId,
      deviceInfo: this.deviceInfo,
      workspaces: workspacesWithTasks,
      activeWorkspaceId: activeState.activeWorkspaceId,
      activeConversationId: activeState.activeConversationId,
      account: this.cachedAccount,
    };

    if (options?.forceSelectConversationId) {
      payload.forceSelectConversationId = options.forceSelectConversationId;
    }

    this.log(`[Broadcast] workspace_list_result account: ${JSON.stringify(this.cachedAccount)}`);

    this.send({
      type: 'workspace_list_result',
      payload,
      broadcast: 'clients',
    });

    // 워크스페이스 저장 (비동기)
    this.saveWorkspaceStore().catch((err) => {
      this.deps.logger.error(`[Persistence] Failed to save workspace store: ${err}`);
    });
  }

  /**
   * 태스크 목록 브로드캐스트
   */
  private broadcastTaskList(workspaceId: number): void {
    const workspace = this.deps.workspaceStore.getWorkspace(workspaceId);
    if (!workspace) return;

    const taskResult = this.deps.taskManager.listTasks(workspace.workingDir);
    const workerStatus = this.deps.workerManager.getWorkerStatus(workspaceId, workspace.workingDir);

    const payload = {
      deviceId: this.config.deviceId,
      workspaceId,
      tasks: taskResult.success ? taskResult.tasks : [],
      workerStatus,
    };

    this.send({
      type: 'task_list_result',
      payload,
      broadcast: 'clients',
    });
  }

  /**
   * 워커 상태 브로드캐스트
   */
  private broadcastWorkerStatus(workspaceId: number): void {
    const workspace = this.deps.workspaceStore.getWorkspace(workspaceId);
    if (!workspace) return;

    const workerStatus = this.deps.workerManager.getWorkerStatus(workspaceId, workspace.workingDir);

    const payload = {
      deviceId: this.config.deviceId,
      workspaceId,
      workerStatus,
    };

    this.send({
      type: 'worker_status_result',
      payload,
      broadcast: 'clients',
    });
  }

  /**
   * Pylon 상태 브로드캐스트
   */
  private broadcastPylonStatus(): void {
    this.send({
      type: 'pylon_status',
      broadcast: 'clients',
      payload: {
        deviceId: this.config.deviceId,
        claudeUsage: this.claudeUsage,
      },
    });
  }

  // ==========================================================================
  // Private 메서드 - 세션 뷰어
  // ==========================================================================

  /**
   * 세션 뷰어 등록
   * @param deviceId - 인코딩된 deviceId (숫자)
   * @param conversationId - 대화 ID
   */
  private registerSessionViewer(deviceId: number, conversationId: number): void {
    // 기존 시청 세션에서 제거
    for (const [existingConversationId, viewers] of this.sessionViewers) {
      if (viewers.has(deviceId)) {
        // 같은 세션을 다시 선택한 경우 - 제거하지 않고 유지
        if (existingConversationId === conversationId) {
          this.log(`Client ${deviceId} now viewing session ${conversationId}`);
          return;
        }

        viewers.delete(deviceId);
        if (viewers.size === 0) {
          this.sessionViewers.delete(existingConversationId);
          // SQLite 기반으로 전환 후 캐시 언로드 불필요 (DB에 즉시 저장됨)
          this.log(`No more viewers for session ${existingConversationId}`);
        }
        break;
      }
    }

    // 새 세션에 등록
    if (!this.sessionViewers.has(conversationId)) {
      this.sessionViewers.set(conversationId, new Set());
    }
    this.sessionViewers.get(conversationId)!.add(deviceId);

    // appUnreadSent 초기화 (문자열 키 유지 - 별도 구조)
    const deviceIdStr = String(deviceId);
    if (!this.appUnreadSent.has(deviceIdStr)) {
      this.appUnreadSent.set(deviceIdStr, new Set());
    }
    this.appUnreadSent.get(deviceIdStr)!.delete(conversationId);

    this.log(`Client ${deviceId} now viewing session ${conversationId}`);
  }

  /**
   * 세션 뷰어 해제
   * @param deviceId - 인코딩된 deviceId (숫자)
   */
  private unregisterSessionViewer(deviceId: number): void {
    for (const [conversationId, viewers] of this.sessionViewers) {
      if (viewers.has(deviceId)) {
        viewers.delete(deviceId);
        if (viewers.size === 0) {
          this.sessionViewers.delete(conversationId);
          // SQLite 기반으로 전환 후 캐시 언로드 불필요 (DB에 즉시 저장됨)
          this.log(`No more viewers for session ${conversationId}`);
        }
        this.log(`Client ${deviceId} removed from session ${conversationId} viewers`);
        break;
      }
    }

    this.appUnreadSent.delete(String(deviceId));
  }

  /**
   * 안 보고 있는 앱에게 unread 알림
   */
  private sendUnreadToNonViewers(conversationId: number, viewers: Set<number>): void {
    const unreadTargets: number[] = [];

    for (const [appIdStr, unreadSent] of this.appUnreadSent) {
      const appId = Number(appIdStr);
      if (viewers.has(appId)) continue;
      if (unreadSent.has(conversationId)) continue;

      unreadTargets.push(appId);
      unreadSent.add(conversationId);
    }

    if (unreadTargets.length > 0) {
      this.deps.workspaceStore.updateConversationUnread(conversationId as ConversationId, true);
      this.scheduleSaveWorkspaceStore();

      // unread 알림은 status를 변경하지 않고 unread 플래그만 전달
      // (status: 'unread'를 보내면 클라이언트가 status를 'unread'로 변경해버림)
      const conversation = this.deps.workspaceStore.getConversation(conversationId as ConversationId);
      this.send({
        type: 'conversation_status',
        payload: {
          deviceId: this.config.deviceId,
          conversationId,
          status: conversation?.status ?? 'idle',
          unread: true,
        },
        to: unreadTargets,
      });

      this.log(`Sent unread notification for ${conversationId} to ${unreadTargets.length} clients`);
    }
  }

  // ==========================================================================
  // Private 메서드 - 이벤트 저장
  // ==========================================================================

  /**
   * 이벤트를 메시지 히스토리에 저장
   */
  private saveEventToHistory(conversationId: number, event: AgentManagerEvent): void {
    const e = event as Record<string, unknown>;
    let shouldSave = false;

    switch (event.type) {
      case 'textComplete':
        this.deps.messageStore.addAssistantText(conversationId, e.text as string);
        shouldSave = true;
        break;

      case 'toolInfo':
        this.deps.messageStore.addToolStart(
          conversationId,
          e.toolName as string,
          e.input as Record<string, unknown>,
          e.parentToolUseId as string | null | undefined,
          e.toolUseId as string | undefined
        );
        shouldSave = true;
        break;

      case 'toolComplete':
        this.deps.messageStore.updateToolComplete(
          conversationId,
          e.toolName as string,
          e.success as boolean,
          e.result as string | undefined,
          e.error as string | undefined
        );
        shouldSave = true;
        break;

      case 'error':
        this.deps.messageStore.addError(conversationId, e.error as string);
        shouldSave = true;
        break;

      case 'result': {
        const usage = e.usage as { inputTokens?: number; outputTokens?: number; cacheReadInputTokens?: number } | undefined;
        this.deps.messageStore.addResult(conversationId, {
          durationMs: (e.duration_ms as number) || 0,
          inputTokens: usage?.inputTokens || 0,
          outputTokens: usage?.outputTokens || 0,
          cacheReadTokens: usage?.cacheReadInputTokens || 0,
        });
        shouldSave = true;
        break;
      }

      case 'agentAborted':
        this.deps.messageStore.addAborted(conversationId, (e.reason as 'user' | 'session_ended') || 'user');
        shouldSave = true;
        break;
    }

  }

  /**
   * 사용량 누적
   */
  private accumulateUsage(event: AgentManagerEvent): void {
    const e = event as Record<string, unknown>;
    if (e.total_cost_usd) {
      this.claudeUsage.totalCostUsd += e.total_cost_usd as number;
    }
    if (e.usage) {
      const usage = e.usage as Record<string, number>;
      this.claudeUsage.totalInputTokens += usage.inputTokens || 0;
      this.claudeUsage.totalOutputTokens += usage.outputTokens || 0;
      this.claudeUsage.totalCacheReadTokens += usage.cacheReadInputTokens || 0;
      this.claudeUsage.totalCacheCreationTokens += usage.cacheCreationInputTokens || 0;
    }
    this.claudeUsage.sessionCount++;
    this.claudeUsage.lastUpdated = new Date().toISOString();

    this.broadcastPylonStatus();
  }

  // ==========================================================================
  // Private 메서드 - 메시지 정리
  // ==========================================================================

  /**
   * 대화의 메시지 캐시 및 영속 파일 정리
   *
   * @description
   * 대화 삭제, 워크스페이스 삭제, ID 재사용 시 호출합니다.
   * 메모리 캐시와 영속 파일을 모두 삭제합니다.
   */
  private clearMessagesForConversation(conversationId: ConversationId): void {
    // SQLite DB에서 메시지 삭제
    this.deps.messageStore.clear(conversationId);
  }

  // ==========================================================================
  // Private 메서드 - 영속성
  // ==========================================================================

  /**
   * 영속 데이터 로드
   */
  private async loadPersistedData(): Promise<void> {
    const persistence = this.deps.persistence;
    if (!persistence) return;

    // WorkspaceStore 로드
    const workspaceData = persistence.loadWorkspaceStore();
    if (workspaceData) {
      // WorkspaceStore는 생성자에서 데이터를 받으므로 여기서는 직접 접근 불가
      // 대신 fromJSON으로 새 인스턴스 생성하거나 bin.ts에서 로드해야 함
      this.log(`[Persistence] Loaded workspace data (${workspaceData.workspaces?.length || 0} workspaces)`);
    }

    // MessageStore는 세션별로 lazy loading
    // 세션 선택 시 loadMessageSession 호출
    this.log('[Persistence] Ready for lazy message loading');
  }

  /**
   * WorkspaceStore 저장
   */
  private async saveWorkspaceStore(): Promise<void> {
    const persistence = this.deps.persistence;
    if (!persistence) return;

    try {
      const data = this.deps.workspaceStore.toJSON();
      await persistence.saveWorkspaceStore(data);
      this.log('[Persistence] Saved workspace store');
    } catch (err) {
      this.deps.logger.error(`[Persistence] Failed to save workspace store: ${err}`);
    }
  }

  /**
   * WorkspaceStore 저장 예약 (debounce)
   * status/unread 같이 자주 변경되는 항목에 사용
   */
  private scheduleSaveWorkspaceStore(): void {
    const persistence = this.deps.persistence;
    if (!persistence) return;

    // 기존 타이머 취소
    if (this.workspaceSaveTimer) {
      clearTimeout(this.workspaceSaveTimer);
    }

    // 새 타이머 설정
    this.workspaceSaveTimer = setTimeout(async () => {
      this.workspaceSaveTimer = null;
      await this.saveWorkspaceStore();
    }, this.WORKSPACE_SAVE_DEBOUNCE_MS);
  }

  /**
   * 모든 pending 저장 즉시 실행
   */
  private async flushPendingSaves(): Promise<void> {
    // 워크스페이스 타이머 취소 및 저장
    if (this.workspaceSaveTimer) {
      clearTimeout(this.workspaceSaveTimer);
      this.workspaceSaveTimer = null;
      await this.saveWorkspaceStore();
    }
  }

  // ==========================================================================
  // Private 유틸리티
  // ==========================================================================

  /**
   * 메시지 전송 (Relay)
   */
  private send(message: unknown): void {
    this.deps.packetLogger.logSend('relay', message);
    this.deps.relayClient.send(message);
  }

  /**
   * 로그 출력
   */
  private log(message: string): void {
    this.deps.logger.log(`[${new Date().toISOString()}] ${message}`);
  }

  // ==========================================================================
  // Private 메서드 - Usage 조회
  // ==========================================================================

  /**
   * usage_request 처리
   *
   * @description
   * ccusage CLI를 실행하여 Claude Code 사용량 데이터를 조회하고
   * 요약 정보를 클라이언트에게 응답합니다.
   */
  private handleUsageRequest(from: MessageFrom | undefined): void {
    // 비동기 처리
    (async () => {
      try {
        const { getUsageSummary } = await import('./utils/ccusage.js');
        const summary = await getUsageSummary();

        if (from?.deviceId !== undefined) {
          this.send({
            type: 'usage_response',
            to: [from.deviceId],
            payload: {
              deviceId: this.config.deviceId,
              success: !!summary,
              summary,
              error: summary ? undefined : 'ccusage not available',
            },
          });
        }

        if (summary) {
          this.log(`[Usage] Fetched usage: today=$${summary.todayCost.toFixed(2)}, week=$${summary.weekCost.toFixed(2)}`);
        }
      } catch (err) {
        if (from?.deviceId !== undefined) {
          this.send({
            type: 'usage_response',
            to: [from.deviceId],
            payload: {
              deviceId: this.config.deviceId,
              success: false,
              error: (err as Error).message,
            },
          });
        }
        this.deps.logger.error(`[Usage] Failed to fetch usage: ${err}`);
      }
    })();
  }

  // ==========================================================================
  // Private 메서드 - 계정 전환
  // ==========================================================================

  /**
   * account_switch 처리
   *
   * @description
   * 계정 전환 요청을 처리합니다.
   * 1. 모든 활성 Claude 세션 중단
   * 2. 인증 파일 스왑
   * 3. 새 계정 정보를 클라이언트에 전송
   */
  private handleAccountSwitch(
    payload: Record<string, unknown> | undefined,
    from: MessageFrom | undefined
  ): void {
    const { account: rawAccount } = payload || {};
    // AccountType 유효성 검증
    if (!rawAccount || (rawAccount !== 'linegames' && rawAccount !== 'personal')) {
      if (from?.deviceId !== undefined) {
        this.send({
          type: 'account_status',
          to: [from.deviceId],
          payload: {
            error: 'Invalid account type',
          },
        });
      }
      return;
    }
    const account = rawAccount as AccountType;

    // credentialManager가 없으면 에러
    if (!this.deps.credentialManager) {
      if (from?.deviceId !== undefined) {
        this.send({
          type: 'account_status',
          to: [from.deviceId],
          payload: {
            error: 'Credential manager not configured',
          },
        });
      }
      return;
    }

    // 동기적으로 cachedAccount를 즉시 클리어
    // → async 스위치 중 workspace_list 요청이 오면 stale 계정 정보 방지
    const previousCachedAccount = this.cachedAccount;
    this.cachedAccount = null;

    // 비동기 처리
    (async () => {
      try {
        this.log(`[Account] Switching to account: ${account}`);

        // 1. 모든 세션 중단
        const abortedSessions = this.deps.agentManager.abortAllSessions();
        if (abortedSessions.length > 0) {
          this.log(`[Account] Aborted ${abortedSessions.length} active sessions`);
        }

        // 2. 인증 파일 스왑
        await this.deps.credentialManager!.switchAccount(account);

        // 3. 새 계정 정보 조회 및 캐시 업데이트
        const accountInfo = await this.deps.credentialManager!.getCurrentAccount();
        if (accountInfo) {
          this.cachedAccount = {
            current: accountInfo.account,
            subscriptionType: accountInfo.subscriptionType,
          };
          // persistence에도 저장
          if (this.deps.persistence) {
            await this.deps.persistence.saveLastAccount(this.cachedAccount);
          }
        }

        // 4. 클라이언트에 상태 알림 (broadcast)
        this.send({
          type: 'account_status',
          broadcast: 'clients',
          payload: {
            current: accountInfo?.account || account,
            subscriptionType: accountInfo?.subscriptionType,
          },
        });

        // 5. 워크스페이스 목록 브로드캐스트 (새 계정 정보 포함)
        this.broadcastWorkspaceList();

        this.log(`[Account] Switched to: ${accountInfo?.account || account} (${accountInfo?.subscriptionType || 'unknown'})`);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        this.deps.logger.error(`[Account] Failed to switch account: ${errorMessage}`);

        // 실패 시 이전 캐시 복원
        this.cachedAccount = previousCachedAccount;

        if (from?.deviceId !== undefined) {
          this.send({
            type: 'account_status',
            to: [from.deviceId],
            payload: {
              error: errorMessage,
            },
          });
        }
      }
    })();
  }

  /**
   * share_create 처리
   *
   * @description
   * 대화 공유 링크 생성 요청을 처리합니다.
   */
  private handleShareCreate(
    payload: Record<string, unknown> | undefined,
    from: MessageFrom | undefined
  ): void {
    const { conversationId } = payload || {};

    // conversationId 검증
    if (conversationId === undefined || typeof conversationId !== 'number') {
      if (from?.deviceId !== undefined) {
        this.send({
          type: 'share_create_result',
          to: [from.deviceId],
          payload: {
            success: false,
            error: 'Invalid conversationId',
          },
        });
      }
      return;
    }

    // shareStore 필수
    if (!this.deps.shareStore) {
      if (from?.deviceId !== undefined) {
        this.send({
          type: 'share_create_result',
          to: [from.deviceId],
          payload: {
            success: false,
            error: 'Share feature not configured',
          },
        });
      }
      return;
    }

    // 대화 존재 확인
    const conversation = this.deps.workspaceStore.getConversation(conversationId as ConversationId);
    if (!conversation) {
      if (from?.deviceId !== undefined) {
        this.send({
          type: 'share_create_result',
          to: [from.deviceId],
          payload: {
            success: false,
            error: 'Conversation not found',
          },
        });
      }
      return;
    }

    // 공유 생성
    const shareInfo = this.deps.shareStore.create(conversationId);

    this.log(`[Share] Created share for conversation ${conversationId}: ${shareInfo.shareId}`);

    // 응답 전송
    if (from?.deviceId !== undefined) {
      this.send({
        type: 'share_create_result',
        to: [from.deviceId],
        payload: {
          success: true,
          shareId: shareInfo.shareId,
          conversationId,
        },
      });
    }

    // shareStore 변경 사항 저장
    this.saveShareStore();
  }

  /**
   * ShareStore 저장 (영속화)
   */
  private saveShareStore(): void {
    if (this.deps.persistence && this.deps.shareStore) {
      this.deps.persistence.saveShareStore(this.deps.shareStore.toJSON()).catch((err) => {
        this.log(`[Persistence] Failed to save share store: ${err}`);
      });
    }
  }

  /**
   * 현재 계정 정보를 클라이언트에 전송
   *
   * @description
   * 클라이언트 연결 시 또는 요청 시 현재 계정 정보를 전송합니다.
   */
  private async sendAccountStatus(to?: number): Promise<void> {
    if (!this.deps.credentialManager) {
      this.log('[Account] No credential manager');
      return;
    }

    try {
      const accountInfo = await this.deps.credentialManager.getCurrentAccount();
      this.log(`[Account] Got account info: ${JSON.stringify(accountInfo)}`);

      if (accountInfo) {
        const msg: Record<string, unknown> = {
          type: 'account_status',
          payload: {
            current: accountInfo.account,
            subscriptionType: accountInfo.subscriptionType,
          },
        };
        // 특정 대상이 있으면 to, 없으면 broadcast
        if (to !== undefined) {
          msg.to = [to];
        } else {
          msg.broadcast = 'clients';
        }
        this.send(msg);
        this.log(`[Account] Sent account_status: ${accountInfo.account}`);
      } else {
        this.log('[Account] No account info found');
      }
    } catch (err) {
      this.deps.logger.error(`[Account] Failed to get account status: ${err}`);
    }
  }

  // ==========================================================================
  // Private 메서드 - Macro
  // ==========================================================================

  /**
   * macro_execute 처리
   *
   * @description
   * 매크로 ID로 전체 매크로 데이터를 조회하여 macro_execute 타입으로 저장하고,
   * macroExecute 이벤트를 브로드캐스트한 뒤, Claude에게는 content만 전달합니다.
   */
  private handleMacroExecute(
    payload: Record<string, unknown> | undefined,
    from: MessageFrom | undefined
  ): void {
    if (!this.deps.macroStore) return;

    const macroId = payload?.macroId as number;
    const conversationId = payload?.conversationId as number;
    const userMessage = (payload?.userMessage as string | undefined)?.trim() || undefined;
    if (!macroId || !conversationId) return;

    // 매크로 전체 데이터 조회
    const macro = this.deps.macroStore.getMacroById(macroId);
    if (!macro) {
      if (from?.deviceId) {
        this.send({
          type: 'error',
          payload: { message: `Macro not found: ${macroId}` },
          to: [from.deviceId],
        });
      }
      return;
    }

    // 매크로 + 유저 메시지 합성
    const messageToSend = userMessage
      ? `[Macro: ${macro.name}]\n${macro.content}\n\n[User Message]\n${userMessage}`
      : macro.content;

    // 1. messageStore에 macro_execute 타입으로 저장
    this.deps.messageStore.addMacroExecuteMessage(
      conversationId,
      messageToSend,
      macro.id,
      macro.name,
      macro.icon,
      macro.color,
      userMessage,
    );

    // 2. claude_event(macroExecute) 브로드캐스트
    this.send({
      type: 'claude_event',
      payload: {
        conversationId,
        event: {
          type: 'macroExecute',
          content: macro.content,
          timestamp: Date.now(),
          macroId: macro.id,
          macroName: macro.name,
          macroIcon: macro.icon,
          macroColor: macro.color,
          userMessage,
        },
      },
      broadcast: 'clients',
    });

    // 3. Claude에게 전달 — 일반 메시지와 동일한 컨텍스트 포함
    const conversation = this.deps.workspaceStore.getConversation(conversationId as ConversationId);
    const workingDir = this.getWorkingDirForConversation(conversationId as ConversationId);
    if (workingDir) {
      const agentSessionId = conversation?.claudeSessionId ?? undefined;

      const linkedDocs = conversation?.linkedDocuments?.map((d) => d.path) || [];
      const systemPrompt = this.config.buildEnv
        ? buildSystemPrompt(this.config.buildEnv)
        : undefined;

      const autorunDoc = findAutorunDoc(linkedDocs, (p) => {
        try { return fs.readFileSync(p, 'utf-8'); }
        catch { return null; }
      });

      const systemReminder = buildInitialReminder(
        conversation?.name || '새 대화',
        linkedDocs,
        autorunDoc ? { autorunDoc } : undefined
      );

      this.deps.agentManager.sendMessage(conversationId, messageToSend, {
        workingDir,
        agentSessionId,
        systemPrompt,
        systemReminder,
      });
    }
  }

  /**
   * macro_create 처리
   *
   * @description
   * 새 매크로를 생성하고 워크스페이스에 할당합니다.
   */
  private handleMacroCreate(
    payload: Record<string, unknown> | undefined,
    from: MessageFrom | undefined
  ): void {
    if (!this.deps.macroStore) return;

    const name = payload?.name as string;
    const icon = (payload?.icon as string) ?? null;
    const color = (payload?.color as string) ?? null;
    const content = payload?.content as string;
    const workspaceIds = (payload?.workspaceIds as (number | null)[]) ?? [null];
    if (!name || !content) return;

    const macroId = this.deps.macroStore.createMacro(name, icon, color, content);

    for (const wsId of workspaceIds) {
      this.deps.macroStore.assignMacro(macroId, wsId);
    }

    // 글로벌 할당이면 모든 워크스페이스에 전파
    if (workspaceIds.includes(null)) {
      const allWsIds = this.deps.workspaceStore.getAllWorkspaces().map(ws => ws.workspaceId);
      this.deps.macroStore.propagateGlobalToAllWorkspaces(macroId, allWsIds);
    }

    if (from?.deviceId) {
      this.send({
        type: 'macro_create_result',
        payload: { macroId },
        to: [from.deviceId],
      });
    }

    const createdMacro = this.deps.macroStore.getMacroById(macroId);
    this.send({
      type: 'macro_changed',
      payload: {
        added: [{ macro: createdMacro, workspaceIds }],
      },
      broadcast: 'clients',
    });
  }

  /**
   * macro_update 처리
   *
   * @description
   * 기존 매크로의 필드를 업데이트합니다.
   */
  private handleMacroUpdate(
    payload: Record<string, unknown> | undefined,
    _from: MessageFrom | undefined
  ): void {
    if (!this.deps.macroStore) return;

    const macroId = payload?.macroId as number;
    if (!macroId) return;

    const fields: { name?: string; icon?: string; color?: string; content?: string } = {};
    if (payload?.name !== undefined) fields.name = payload.name as string;
    if (payload?.icon !== undefined) fields.icon = payload.icon as string;
    if (payload?.color !== undefined) fields.color = payload.color as string;
    if (payload?.content !== undefined) fields.content = payload.content as string;

    this.deps.macroStore.updateMacro(macroId, fields);
    const updatedMacro = this.deps.macroStore.getMacroById(macroId);
    this.send({
      type: 'macro_changed',
      payload: {
        updated: [updatedMacro],
      },
      broadcast: 'clients',
    });
  }

  /**
   * macro_delete 처리
   *
   * @description
   * 매크로를 삭제합니다.
   */
  private handleMacroDelete(
    payload: Record<string, unknown> | undefined,
    _from: MessageFrom | undefined
  ): void {
    if (!this.deps.macroStore) return;

    const macroId = payload?.macroId as number;
    if (!macroId) return;

    this.deps.macroStore.deleteMacro(macroId);
    this.send({
      type: 'macro_changed',
      payload: {
        removed: [macroId],
      },
      broadcast: 'clients',
    });
  }

  /**
   * macro_assign 처리
   *
   * @description
   * 매크로의 워크스페이스 할당/해제를 처리합니다.
   */
  private handleMacroAssign(
    payload: Record<string, unknown> | undefined,
    _from: MessageFrom | undefined
  ): void {
    if (!this.deps.macroStore) return;

    const macroId = payload?.macroId as number;
    const workspaceId = payload?.workspaceId as number | null;
    const assign = payload?.assign as boolean;
    if (!macroId || assign === undefined) return;

    if (assign) {
      this.deps.macroStore.assignMacro(macroId, workspaceId ?? null);
      // 글로벌 할당이면 모든 워크스페이스에 전파
      if (workspaceId === null || workspaceId === 0) {
        const allWsIds = this.deps.workspaceStore.getAllWorkspaces().map(ws => ws.workspaceId);
        this.deps.macroStore.propagateGlobalToAllWorkspaces(macroId, allWsIds);
      }
    } else {
      this.deps.macroStore.unassignMacro(macroId, workspaceId ?? null);
    }
    this.broadcastWorkspaceList();
  }

  /**
   * macro_reorder 처리
   */
  private handleMacroReorder(payload: Record<string, unknown> | undefined): void {
    if (!this.deps.macroStore) return;

    const { workspaceId, macroIds } = payload || {};
    if (!workspaceId || !macroIds || !Array.isArray(macroIds)) return;

    this.deps.macroStore.reorderMacros(workspaceId as number, macroIds as number[]);
    this.broadcastWorkspaceList();
  }

  /**
   * macro_manage_conversation 처리
   *
   * @description
   * 매크로 관리용 대화를 생성하고, 초기 컨텍스트와 하드코딩된 프롬프트를 전송한 뒤
   * 해당 대화로 자동 전환합니다.
   */
  private handleMacroManageConversation(
    payload: Record<string, unknown> | undefined,
    from: MessageFrom | undefined
  ): void {
    if (!this.deps.macroStore) return;

    const workspaceId = payload?.workspaceId as number;
    const macroId = payload?.macroId as number | undefined;
    if (!workspaceId) return;

    // 워크스페이스 확인
    const workspace = this.deps.workspaceStore.getWorkspace(workspaceId);
    if (!workspace) return;

    // 대화 생성
    const convName = macroId ? '매크로 수정' : '매크로 생성';
    const conversation = this.deps.workspaceStore.createConversation(workspaceId, convName);
    if (!conversation) return;

    // 기존 메시지 정리 (ID 재사용 대비)
    this.clearMessagesForConversation(conversation.conversationId);

    // 하드코딩된 프롬프트
    let prompt: string;
    if (macroId) {
      prompt = `이 워크스페이스(id: ${workspaceId}, name: ${workspace.name})에서 매크로(id: ${macroId})를 수정하거나 삭제하려고 해요.\nget_macro로 현재 상태를 확인하고, update_macro 또는 delete_macro로 처리해 주세요.`;
    } else {
      prompt = `이 워크스페이스(id: ${workspaceId}, name: ${workspace.name})에서 새 매크로를 만들려고 해요.\nlist_macros로 기존 매크로를 확인하고, create_macro로 새 매크로를 만들어 주세요.\n사용자에게 어떤 매크로를 만들고 싶은지 물어봐 주세요.`;
    }

    // 초기 컨텍스트 + 프롬프트를 합쳐서 한 번에 전송
    this.sendInitialContext(conversation.conversationId, prompt);

    // 해당 대화로 자동 전환
    this.deps.workspaceStore.setActiveConversation(conversation.conversationId as ConversationId);
    this.broadcastWorkspaceList({ forceSelectConversationId: conversation.conversationId });
    this.saveWorkspaceStore().catch(() => {});

    // 세션 뷰어 등록
    if (from?.deviceId) {
      this.registerSessionViewer(from.deviceId, conversation.conversationId);
    }
  }
}
