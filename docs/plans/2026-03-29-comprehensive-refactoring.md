# Comprehensive Codebase Refactoring Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 전체 프로젝트 코드 리뷰에서 발견된 보안, 안정성, dead code, DRY 위반, 아키텍처 이슈를 체계적으로 수정하여 코드 건강도를 6.7/10 → 8.5/10 이상으로 끌어올린다.

**Architecture:** 5개 패키지(core, relay, pylon, client, updater)에 걸친 리팩토링. 의존성 순서 core → relay/pylon → client. 4개 Phase로 나누어 Phase 1(보안/안정성)부터 순차 진행. 각 Task는 독립적이며, 같은 Phase 내에서는 병렬 실행 가능.

**Tech Stack:** TypeScript, pnpm monorepo, vitest, Node.js, WebSocket(ws), PM2, SQLite

---

## Phase 1: Security & Stability (Critical)

### Task 1: relay — google-auth.ts에 프로덕션 가드 추가

**Files:**
- Modify: `packages/relay/src/google-auth.ts:63-78, 120-160`

**배경:** `verifyGoogleToken`이 하드코딩된 `TEST_TOKEN_MAP`만 사용하여 `'valid-google-id-token'` 문자열로 인증 우회가 가능한 상태.

**Step 1: 프로덕션 가드 코드 작성**

`packages/relay/src/google-auth.ts` 파일 상단에 환경 체크를 추가하고, `verifyGoogleToken` 함수에 가드를 넣는다:

```typescript
// 파일 상단 (import 아래)에 추가:
/** 테스트 환경 여부 */
const IS_TEST_ENV = process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';
```

`verifyGoogleToken` 함수 (line 120) 시작 부분, 입력 검증 후에 가드 추가:

```typescript
export async function verifyGoogleToken(
  idToken: string,
  clientId: string
): Promise<GoogleUserInfo> {
  // 입력 검증
  if (isEmpty(idToken)) {
    throw new Error(ERROR_EMPTY_TOKEN);
  }

  if (isEmpty(clientId)) {
    throw new Error(ERROR_EMPTY_CLIENT_ID);
  }

  // ⚠️ 프로덕션 가드: 테스트 환경이 아니면 테스트 토큰 사용 불가
  if (!IS_TEST_ENV) {
    throw new Error(
      'Google OAuth is not configured for production. ' +
      'Implement real verification with google-auth-library.'
    );
  }

  // 이하 기존 테스트 토큰 로직 유지...
```

**Step 2: 빌드 확인**

Run: `cd /home/estelle/estelle2 && pnpm --filter @estelle/relay typecheck`
Expected: 빌드 성공

**Step 3: 테스트 실행**

Run: `cd /home/estelle/estelle2 && pnpm --filter @estelle/relay test`
Expected: 기존 테스트 모두 통과 (테스트 환경에서는 IS_TEST_ENV=true)

**Step 4: 커밋**

```bash
git add packages/relay/src/google-auth.ts
git commit -m "fix(relay): add production guard to google-auth test stub

verifyGoogleToken now throws in non-test environments.
The hardcoded TEST_TOKEN_MAP was accessible in production,
allowing auth bypass with 'valid-google-id-token' string."
```

---

### Task 2: relay — WebSocket maxPayload 설정 + 인증 타임아웃

**Files:**
- Modify: `packages/relay/src/server.ts:554, 562, 199-207`
- Modify: `packages/relay/src/constants.ts`

**Step 1: constants.ts에 상수 추가**

`packages/relay/src/constants.ts`에 추가:

```typescript
/** WebSocket 최대 메시지 크기 (1MB) */
export const WS_MAX_PAYLOAD = 1 * 1024 * 1024;

/** 미인증 클라이언트 연결 타임아웃 (30초) */
export const AUTH_TIMEOUT_MS = 30_000;
```

**Step 2: WebSocketServer 생성 시 maxPayload 설정**

`packages/relay/src/server.ts`에서 `constants.ts` import 추가:

```typescript
import { WS_MAX_PAYLOAD, AUTH_TIMEOUT_MS } from './constants.js';
```

line 554 수정:
```typescript
// Before:
wss = new WebSocketServer({ server: httpServer });
// After:
wss = new WebSocketServer({ server: httpServer, maxPayload: WS_MAX_PAYLOAD });
```

line 562 수정:
```typescript
// Before:
wss = new WebSocketServer({ port });
// After:
wss = new WebSocketServer({ port, maxPayload: WS_MAX_PAYLOAD });
```

**Step 3: 인증 타임아웃 추가**

`packages/relay/src/server.ts`의 연결 핸들러 (line 199-207 부근), `state.clients.set(clientId, client)` 직후에 추가:

```typescript
  state.clients.set(clientId, client);

  // 인증 타임아웃: 30초 이내 인증하지 않으면 연결 종료
  const authTimer = setTimeout(() => {
    const c = state.clients.get(clientId);
    if (c && !c.authenticated) {
      log(`[AUTH TIMEOUT] Client ${clientId} disconnected (no auth within ${AUTH_TIMEOUT_MS}ms)`);
      ws.close(4001, 'Authentication timeout');
    }
  }, AUTH_TIMEOUT_MS);

  ws.on('close', () => {
    clearTimeout(authTimer);
    // ... 기존 close 핸들러 로직
  });
```

주의: 기존 `ws.on('close', ...)` 핸들러가 이미 있으므로, `authTimer` 클리어 로직을 기존 close 핸들러 내부에 추가한다.

**Step 4: 빌드 확인**

Run: `cd /home/estelle/estelle2 && pnpm --filter @estelle/relay typecheck`
Expected: 빌드 성공

**Step 5: 테스트 실행**

Run: `cd /home/estelle/estelle2 && pnpm --filter @estelle/relay test`
Expected: 모든 테스트 통과

**Step 6: 커밋**

```bash
git add packages/relay/src/server.ts packages/relay/src/constants.ts
git commit -m "fix(relay): add WebSocket maxPayload limit and auth timeout

- Set maxPayload to 1MB to prevent memory-based DoS
- Auto-disconnect unauthenticated clients after 30 seconds
- Prevents resource exhaustion from zombie connections"
```

---

### Task 3: updater — runCommand에 타임아웃 추가

**Files:**
- Modify: `packages/updater/src/executor.ts:66-100`

**Step 1: 테스트 작성**

`packages/updater/src/executor.test.ts`에 타임아웃 테스트 추가:

```typescript
it('should timeout long-running commands', async () => {
  const logs: string[] = [];
  const result = await executeUpdate({
    repoRoot: tmpDir,
    branch: 'main',
    target: 'all',
    environmentFile: 'test',
    onLog: (msg) => logs.push(msg),
    commandTimeout: 100, // 100ms timeout for testing
  });
  // 실제 테스트에서는 sleep 커맨드가 타임아웃되는지 확인
});
```

**Step 2: runCommand 함수에 timeout 파라미터 추가**

`packages/updater/src/executor.ts` line 66-100 수정:

```typescript
/** 기본 명령어 타임아웃 (5분) */
const DEFAULT_COMMAND_TIMEOUT = 5 * 60 * 1000;

function runCommand(
  cmd: string,
  args: string[],
  cwd: string,
  onLog: (msg: string) => void,
  timeout: number = DEFAULT_COMMAND_TIMEOUT
): Promise<{ success: boolean; output?: string; error?: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, shell: true, windowsHide: true });
    let output = '';
    let resolved = false;

    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        child.kill('SIGTERM');
        // SIGTERM 후 5초 내 종료하지 않으면 SIGKILL
        setTimeout(() => child.kill('SIGKILL'), 5000);
        onLog(`[TIMEOUT] Command timed out after ${timeout}ms: ${cmd} ${args.join(' ')}`);
        resolve({ success: false, error: `Command timed out after ${timeout}ms` });
      }
    }, timeout);

    child.stdout?.on('data', (data) => {
      const text = data.toString();
      output += text;
      onLog(text.trim());
    });

    child.stderr?.on('data', (data) => {
      const text = data.toString();
      output += text;
      onLog(text.trim());
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (!resolved) {
        resolved = true;
        if (code === 0) {
          resolve({ success: true, output });
        } else {
          resolve({ success: false, error: `Exit code: ${code}`, output });
        }
      }
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      if (!resolved) {
        resolved = true;
        resolve({ success: false, error: err.message });
      }
    });
  });
}
```

**Step 3: 빌드 확인**

Run: `cd /home/estelle/estelle2 && pnpm --filter @estelle/updater typecheck`
Expected: 빌드 성공

**Step 4: 테스트 실행**

Run: `cd /home/estelle/estelle2 && pnpm --filter @estelle/updater test`
Expected: 모든 테스트 통과

**Step 5: 커밋**

```bash
git add packages/updater/src/executor.ts packages/updater/src/executor.test.ts
git commit -m "fix(updater): add command timeout to runCommand

Default 5-minute timeout per command prevents indefinite hangs
during git fetch, pnpm install, or build steps.
Uses SIGTERM with SIGKILL fallback after 5s grace period."
```

---

### Task 4: updater — 릴리스 롤백 메커니즘 추가

**Files:**
- Modify: `packages/updater/src/executor.ts:150-296`

**Step 1: 백업/롤백 함수 추가**

`packages/updater/src/executor.ts`에 helper 함수 추가:

```typescript
/**
 * 릴리스 디렉토리를 백업한다.
 * @returns 백업 경로 (없으면 null)
 */
function backupRelease(repoRoot: string, log: (msg: string) => void): string | null {
  const releaseDir = path.join(repoRoot, 'release');
  const backupDir = path.join(repoRoot, 'release.rollback');

  if (!fs.existsSync(releaseDir)) {
    return null;
  }

  // 기존 백업 제거
  if (fs.existsSync(backupDir)) {
    fs.rmSync(backupDir, { recursive: true, force: true });
  }

  fs.cpSync(releaseDir, backupDir, { recursive: true });
  log(`  Backed up release/ → release.rollback/`);
  return backupDir;
}

/**
 * 롤백: 백업에서 릴리스 디렉토리를 복원한다.
 */
function rollbackRelease(repoRoot: string, log: (msg: string) => void): boolean {
  const releaseDir = path.join(repoRoot, 'release');
  const backupDir = path.join(repoRoot, 'release.rollback');

  if (!fs.existsSync(backupDir)) {
    log(`  ✗ No backup found at release.rollback/`);
    return false;
  }

  // 현재 (실패한) 릴리스 제거
  if (fs.existsSync(releaseDir)) {
    fs.rmSync(releaseDir, { recursive: true, force: true });
  }

  fs.renameSync(backupDir, releaseDir);
  log(`  Rolled back release.rollback/ → release/`);
  return true;
}
```

**Step 2: executeUpdate에 백업/롤백 로직 삽입**

Step 6 (릴리스 복사) 직전에 백업:

```typescript
    // Step 5.5: Backup current release
    log(`[5.5/8] Backing up current release...`);
    const backupPath = backupRelease(repoRoot, log);
```

Step 7 (PM2 start) 실패 시 롤백:

```typescript
    const startResult = await runCommand('pm2', ['start', ecosystemPath], repoRoot, log);
    if (!startResult.success) {
      log(`✗ pm2 start failed: ${startResult.error}`);
      // 롤백 시도
      if (backupPath) {
        log(`Attempting rollback...`);
        const rolled = rollbackRelease(repoRoot, log);
        if (rolled) {
          log(`Restarting previous version...`);
          await runCommand('pm2', ['start', ecosystemPath], repoRoot, log);
        }
      }
      return { success: false, error: `pm2 start failed: ${startResult.error}` };
    }
```

**Step 3: 빌드 확인**

Run: `cd /home/estelle/estelle2 && pnpm --filter @estelle/updater typecheck`
Expected: 빌드 성공

**Step 4: 테스트 실행**

Run: `cd /home/estelle/estelle2 && pnpm --filter @estelle/updater test`
Expected: 모든 테스트 통과

**Step 5: 커밋**

```bash
git add packages/updater/src/executor.ts
git commit -m "feat(updater): add release rollback mechanism

Backup release/ to release.rollback/ before copying new artifacts.
On PM2 start failure, automatically restore previous release and
attempt restart. Prevents dead state from failed deployments."
```

---

### Task 5: updater — 에이전트 재연결 메모리 누수 수정

**Files:**
- Modify: `packages/updater/src/agent.ts:105-107`

**Step 1: 수정**

재귀적 `startAgent` 호출을 루프 기반 재연결로 변경:

```typescript
// Before (line 105-107):
ws.on('close', () => {
  log(`[Agent] Disconnected from master, reconnecting in 5s...`);
  setTimeout(() => startAgent(options), 5000);
});

// After:
ws.on('close', () => {
  log(`[Agent] Disconnected from master, reconnecting in 5s...`);
  // 기존 이벤트 리스너 정리
  ws.removeAllListeners();
  setTimeout(() => startAgent(options), 5000);
});
```

**Step 2: 빌드 확인**

Run: `cd /home/estelle/estelle2 && pnpm --filter @estelle/updater typecheck`
Expected: 빌드 성공

**Step 3: 테스트 실행**

Run: `cd /home/estelle/estelle2 && pnpm --filter @estelle/updater test`
Expected: 모든 테스트 통과

**Step 4: 커밋**

```bash
git add packages/updater/src/agent.ts
git commit -m "fix(updater): clean up WebSocket listeners on reconnect

Previous recursive startAgent() accumulated event listeners on
each reconnection attempt, causing memory leak during prolonged
master outages."
```

---

## Phase 2: Dead Code Cleanup

### Task 6: pylon — state.ts + state.test.ts 삭제

**Files:**
- Delete: `packages/pylon/src/state.ts` (149줄)
- Delete: `packages/pylon/tests/state.test.ts`

**Step 1: 삭제 전 의존성 확인**

`state.ts`는 `index.ts`에서 이미 제거됨 (이전 cleanup에서 완료). 다른 곳에서 import하는지 확인:

Run: `cd /home/estelle/estelle2 && grep -r "from.*state" packages/pylon/src/ --include="*.ts" | grep -v node_modules | grep -v ".test."`
Expected: `state.ts`를 직접 import하는 소스 파일 없음

**Step 2: 파일 삭제**

```bash
rm packages/pylon/src/state.ts
rm packages/pylon/tests/state.test.ts
```

**Step 3: 빌드 + 테스트 확인**

Run: `cd /home/estelle/estelle2 && pnpm --filter @estelle/pylon typecheck && pnpm --filter @estelle/pylon test`
Expected: 모든 통과

**Step 4: 커밋**

```bash
git add -A packages/pylon/src/state.ts packages/pylon/tests/state.test.ts
git commit -m "refactor(pylon): delete deprecated state.ts and its tests

This module was fully replaced by Pylon class + WorkspaceStore +
MessageStore. It was already removed from public API in previous
cleanup. 149 lines of dead code removed."
```

---

### Task 7: core — 낡은 테스트 파일 교체

**Files:**
- Delete: `packages/core/tests/types/device.test.ts`
- Rename: `packages/core/tests/types/device-v2.test.ts` → `packages/core/tests/types/device.test.ts`
- Delete: `packages/core/tests/types/auth.test.ts`
- Rename: `packages/core/tests/types/auth-v2.test.ts` → `packages/core/tests/types/auth.test.ts`

**Step 1: 파일 교체**

```bash
cd /home/estelle/estelle2
rm packages/core/tests/types/device.test.ts
mv packages/core/tests/types/device-v2.test.ts packages/core/tests/types/device.test.ts
rm packages/core/tests/types/auth.test.ts
mv packages/core/tests/types/auth-v2.test.ts packages/core/tests/types/auth.test.ts
```

**Step 2: 파일 내부 description 업데이트**

`device.test.ts` 상단 주석 변경:
```typescript
// Before:
* @file device-v2.test.ts
* @description DeviceType v2 타입 테스트 (mobile, relay 제거)
// After:
* @file device.test.ts
* @description Device 관련 타입 테스트
```

`auth.test.ts` 상단 주석 변경:
```typescript
// Before:
* @file auth-v2.test.ts
* @description AuthPayload v2 타입 테스트 (deviceId: number로 통일)
// After:
* @file auth.test.ts
* @description 인증 관련 타입 테스트
```

**Step 3: 테스트 실행**

Run: `cd /home/estelle/estelle2 && pnpm --filter @estelle/core test`
Expected: 모든 테스트 통과

**Step 4: 커밋**

```bash
git add -A packages/core/tests/types/
git commit -m "refactor(core): replace stale device/auth tests with v2 versions

Old tests referenced removed DeviceType values ('mobile', 'relay')
and string-based deviceId. v2 tests match current types.
Renamed v2 files back to canonical names."
```

---

### Task 8: relay — dead code 제거 (미사용 함수들)

**Files:**
- Modify: `packages/relay/src/message-handler.ts`
- Modify: `packages/relay/src/router.ts`

**대상 함수:**
- `handleAuthViewer` (async 버전, line 653 부근) — `handleMessage`에서 호출되지 않음
- `handleAuthWithGoogle` (line 1079 부근) — `handleMessage`에서 호출되지 않음
- `createAppAuthSuccessActions` (line 787 부근) — `handleAuthWithGoogle`에서만 호출
- `routeByDefault` (router.ts line 472-484) — 미사용

**Step 1: message-handler.ts에서 제거**

1. `handleAuthViewer` 함수 전체 삭제 (약 50줄)
2. `createAppAuthSuccessActions` 함수 전체 삭제 (약 75줄)
3. `handleAuthWithGoogle` 함수 전체 삭제 (약 55줄)
4. 이들이 사용하는 타입(`ViewerAuthDependencies`, `GoogleAuthDependencies` 등)도 함께 삭제
5. export 목록에서 제거

**Step 2: router.ts에서 제거**

`routeByDefault` 함수 삭제 (line 472-484, 약 13줄). export 목록에서도 제거.

**Step 3: 빌드 확인**

Run: `cd /home/estelle/estelle2 && pnpm --filter @estelle/relay typecheck`
Expected: 빌드 성공

**Step 4: 관련 테스트 정리**

`packages/relay/tests/viewer-auth.test.ts`에서 `handleAuthViewer` 테스트 제거 (이 함수가 없으므로).
`packages/relay/tests/google-auth.test.ts`는 `verifyGoogleToken` 테스트이므로 유지.
`packages/relay/tests/router.test.ts`에서 `routeByDefault` 테스트 제거.

**Step 5: 테스트 실행**

Run: `cd /home/estelle/estelle2 && pnpm --filter @estelle/relay test`
Expected: 모든 테스트 통과

**Step 6: 커밋**

```bash
git add packages/relay/src/message-handler.ts packages/relay/src/router.ts \
  packages/relay/tests/viewer-auth.test.ts packages/relay/tests/router.test.ts
git commit -m "refactor(relay): remove dead code (handleAuthWithGoogle, handleAuthViewer, routeByDefault)

These functions were exported but never called from handleMessage.
- handleAuthViewer: async DI version, superseded by sync handleViewerAuth
- handleAuthWithGoogle: Google OAuth integration never wired into message flow
- createAppAuthSuccessActions: only used by handleAuthWithGoogle
- routeByDefault: never called from routeMessage"
```

---

### Task 9: relay — 디버그 로깅 제거

**Files:**
- Modify: `packages/relay/src/server.ts:253-255`

**Step 1: 수정**

```typescript
// 삭제 (line 253-255):
if (data.type === 'widget_render' || data.type === 'widget_close' || data.type === 'widget_event') {
  log(`[DEBUG] ${data.type} to=${JSON.stringify(data.to)} broadcast=${JSON.stringify(data.broadcast)}`);
}
```

**Step 2: 빌드 확인**

Run: `cd /home/estelle/estelle2 && pnpm --filter @estelle/relay typecheck`
Expected: 빌드 성공

**Step 3: 커밋**

```bash
git add packages/relay/src/server.ts
git commit -m "fix(relay): remove debug logging for widget messages"
```

---

### Task 10: client — 미사용 RelayService 클래스 제거

**Files:**
- Modify: `packages/client/src/services/relayService.ts` (414줄 → 타입만 남기기)
- Modify: `packages/client/src/services/index.ts` (export 정리)

**Step 1: relayService.ts에서 클래스 제거, 타입만 유지**

`RelayService` 클래스 전체를 삭제하고, 다른 파일에서 사용되는 타입(`RelayConfig`, `RelayMessage` 등)만 남긴다.

다른 파일에서 실제 사용되는 export를 먼저 확인:

Run: `cd /home/estelle/estelle2 && grep -r "from.*relayService" packages/client/src/ --include="*.ts" --include="*.tsx" | grep -v test | grep -v ".test."`

사용되는 타입만 남기고 클래스 구현부 전체를 제거한다.

**Step 2: services/index.ts 정리**

`RelayService` 클래스 export를 제거하고 타입 export만 유지.

**Step 3: 빌드 확인**

Run: `cd /home/estelle/estelle2 && pnpm --filter @estelle/client typecheck`
Expected: 빌드 성공

**Step 4: 커밋**

```bash
git add packages/client/src/services/relayService.ts packages/client/src/services/index.ts
git commit -m "refactor(client): remove unused RelayService class (414 lines)

App.tsx creates raw WebSocket connections directly. relaySender.ts
provides the actual message sending functions. RelayService class
was never instantiated outside of tests. Type exports preserved."
```

---

## Phase 3: DRY Consolidation

### Task 11: pylon — normalizePath 공유 유틸 추출

**Files:**
- Create: `packages/pylon/src/utils/path.ts`
- Modify: `packages/pylon/src/utils/index.ts`
- Modify: `packages/pylon/src/stores/workspace-store.ts:82-86, 692-700`
- Modify: `packages/pylon/src/handlers/blob-handler.ts:46, 53-59`
- Modify: `packages/pylon/src/managers/folder-manager.ts:266-274`

**Step 1: 공유 유틸 파일 생성**

`packages/pylon/src/utils/path.ts`:
```typescript
/**
 * @file path.ts
 * @description 플랫폼별 경로 유틸리티
 */

import os from 'os';

/** Windows 플랫폼 여부 */
export const IS_WINDOWS = os.platform() === 'win32';

/** 플랫폼에 맞는 경로 구분자 */
export const PATH_SEP = IS_WINDOWS ? '\\' : '/';

/** 플랫폼 타입 */
export type PlatformType = 'windows' | 'linux';

/**
 * 경로 구분자를 플랫폼에 맞게 정규화
 *
 * @param inputPath - 정규화할 경로
 * @param platform - 대상 플랫폼 (기본: 현재 OS)
 * @returns 정규화된 경로
 */
export function normalizePath(inputPath: string, platform?: PlatformType): string {
  const isWin = platform ? platform === 'windows' : IS_WINDOWS;
  const trimmed = inputPath.trim();
  if (isWin) {
    return trimmed.replace(/\//g, '\\');
  } else {
    return trimmed.replace(/\\/g, '/');
  }
}
```

**Step 2: utils/index.ts에 export 추가**

```typescript
export * from './path.js';
```

**Step 3: 3개 파일에서 로컬 구현 제거 + import 추가**

각 파일에서:
- 로컬 `normalizePath` 함수 삭제
- 로컬 `IS_WINDOWS`, `PATH_SEP` 상수 삭제 (있는 경우)
- `import { normalizePath, IS_WINDOWS, PATH_SEP } from '../utils/path.js';` 추가

`workspace-store.ts`:
- line 82-86: `IS_WINDOWS`, `PATH_SEP` 상수 삭제
- line 692-700: `normalizePath` private 메서드 삭제
- 메서드 호출 `this.normalizePath(...)` → `normalizePath(...)` 변경
- import 추가: `import { normalizePath, IS_WINDOWS, PATH_SEP } from '../utils/path.js';`

`blob-handler.ts`:
- line 46: `IS_WINDOWS` 상수 삭제
- line 53-59: `normalizePath` 함수 삭제
- import 추가: `import { normalizePath, IS_WINDOWS } from '../utils/path.js';`

`folder-manager.ts`:
- line 266-274: `normalizePath` private 메서드 삭제
- `this.normalizePath(...)` → `normalizePath(..., this.platform)` 변경
- line 46: `PlatformType` 로컬 정의 삭제
- import 추가: `import { normalizePath, type PlatformType } from '../utils/path.js';`

**Step 4: 빌드 확인**

Run: `cd /home/estelle/estelle2 && pnpm --filter @estelle/pylon typecheck`
Expected: 빌드 성공

**Step 5: 테스트 실행**

Run: `cd /home/estelle/estelle2 && pnpm --filter @estelle/pylon test`
Expected: 모든 테스트 통과

**Step 6: 커밋**

```bash
git add packages/pylon/src/utils/path.ts packages/pylon/src/utils/index.ts \
  packages/pylon/src/stores/workspace-store.ts \
  packages/pylon/src/handlers/blob-handler.ts \
  packages/pylon/src/managers/folder-manager.ts
git commit -m "refactor(pylon): extract normalizePath to shared utils/path.ts

Removes 3 duplicate normalizePath implementations and 2 duplicate
IS_WINDOWS/PATH_SEP constant definitions. Consolidates PlatformType."
```

---

### Task 12: pylon — MIME_TYPES 공유 유틸 추출

**Files:**
- Create: `packages/pylon/src/utils/mime.ts`
- Modify: `packages/pylon/src/utils/index.ts`
- Modify: `packages/pylon/src/handlers/blob-handler.ts:211-232`
- Modify: `packages/pylon/src/handlers/widget-asset-handler.ts:12-24`
- Modify: `packages/pylon/src/servers/pylon-mcp-server.ts:39-85`

**Step 1: 공유 유틸 파일 생성**

`packages/pylon/src/utils/mime.ts`:
```typescript
/**
 * @file mime.ts
 * @description MIME 타입 유틸리티
 */

/**
 * 확장자별 MIME 타입 매핑
 * pylon-mcp-server.ts의 가장 완전한 버전을 기준으로 통합
 */
export const MIME_TYPES: Record<string, string> = {
  // 이미지
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',

  // 오디오
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',

  // 마크다운
  '.md': 'text/markdown',
  '.markdown': 'text/markdown',

  // 텍스트
  '.txt': 'text/plain',
  '.log': 'text/plain',
  '.csv': 'text/csv',

  // 데이터 포맷
  '.json': 'application/json',
  '.xml': 'text/xml',
  '.yaml': 'text/yaml',
  '.yml': 'text/yaml',

  // 웹
  '.html': 'text/html',
  '.css': 'text/css',

  // 프로그래밍 언어
  '.js': 'text/javascript',
  '.ts': 'text/typescript',
  '.dart': 'text/x-dart',
  '.py': 'text/x-python',
  '.java': 'text/x-java',
  '.c': 'text/x-c',
  '.cpp': 'text/x-c++',
  '.h': 'text/x-c',
  '.go': 'text/x-go',
  '.rs': 'text/x-rust',

  // 스크립트
  '.sh': 'text/x-shellscript',
  '.bat': 'text/x-batch',
  '.ps1': 'text/x-powershell',
};

/**
 * 확장자로 MIME 타입을 조회
 * @param ext - 파일 확장자 (예: '.png')
 * @param fallback - 매칭 없을 때 기본값 (기본: 'application/octet-stream')
 */
export function getMimeType(ext: string, fallback = 'application/octet-stream'): string {
  return MIME_TYPES[ext.toLowerCase()] ?? fallback;
}
```

**Step 2: 3개 파일에서 로컬 MIME_TYPES 제거 + import 추가**

각 파일에서 로컬 `MIME_TYPES` 정의를 삭제하고:
```typescript
import { MIME_TYPES, getMimeType } from '../utils/mime.js';
```

MIME 타입 조회 시 `MIME_TYPES[ext]` 또는 `getMimeType(ext)` 사용.

**Step 3: 빌드 + 테스트 확인**

Run: `cd /home/estelle/estelle2 && pnpm --filter @estelle/pylon typecheck && pnpm --filter @estelle/pylon test`
Expected: 모든 통과

**Step 4: 커밋**

```bash
git add packages/pylon/src/utils/mime.ts packages/pylon/src/utils/index.ts \
  packages/pylon/src/handlers/blob-handler.ts \
  packages/pylon/src/handlers/widget-asset-handler.ts \
  packages/pylon/src/servers/pylon-mcp-server.ts
git commit -m "refactor(pylon): extract MIME_TYPES to shared utils/mime.ts

Consolidates 3 duplicate MIME type maps. Uses the most complete set
from pylon-mcp-server.ts as canonical source. Adds getMimeType() helper."
```

---

### Task 13: client — generateId 공유 유틸 추출

**Files:**
- Create: `packages/client/src/utils/id.ts`
- Modify: `packages/client/src/utils/index.ts`
- Modify: `packages/client/src/stores/conversationStore.ts:229-231`
- Modify: `packages/client/src/hooks/useMessageRouter.ts:961-963`
- Modify: `packages/client/src/services/blobService.ts:77-83`
- Modify: `packages/client/src/utils/fileUtils.ts:18-22`

**Step 1: 공유 유틸 파일 생성**

`packages/client/src/utils/id.ts`:
```typescript
/**
 * @file id.ts
 * @description ID 생성 유틸리티
 */

/**
 * 고유 메시지 ID 생성
 * @param prefix - ID 접두사 (기본: 'msg')
 * @returns 고유 ID 문자열
 */
export function generateId(prefix = 'msg'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}

/**
 * UUID v4 생성 (파일 전송용)
 * @returns UUID 문자열
 */
export function generateUUID(): string {
  // 브라우저 crypto API 사용 가능하면 활용
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // 폴백: Math.random 기반
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * 파일 ID 생성
 * @returns 파일 ID 문자열
 */
export function generateFileId(): string {
  return generateId('file');
}
```

**Step 2: 4개 파일에서 로컬 구현 제거 + import 추가**

`conversationStore.ts`:
- line 229-231: `generateId` 함수 삭제
- import 추가: `import { generateId } from '../utils/id';`

`useMessageRouter.ts`:
- line 961-963: `generateId` 함수 삭제
- import 추가: `import { generateId } from '../utils/id';`

`blobService.ts`:
- line 77-83: `generateUUID` 함수 삭제
- import 추가: `import { generateUUID } from '../utils/id';`

`fileUtils.ts`:
- line 18-22: `generateFileId` 함수 삭제
- import 추가: `import { generateFileId } from './id';`

**Step 3: deprecated `substr` → `substring` 수정**

`id.ts`에서 이미 `substring`을 사용하므로, 기존 호출부에서 `substr`을 쓰던 곳이 자동으로 해결됨.

**Step 4: 빌드 + 테스트 확인**

Run: `cd /home/estelle/estelle2 && pnpm --filter @estelle/client typecheck && pnpm --filter @estelle/client test`
Expected: 모든 통과

**Step 5: 커밋**

```bash
git add packages/client/src/utils/id.ts packages/client/src/utils/index.ts \
  packages/client/src/stores/conversationStore.ts \
  packages/client/src/hooks/useMessageRouter.ts \
  packages/client/src/services/blobService.ts \
  packages/client/src/utils/fileUtils.ts
git commit -m "refactor(client): extract ID generation to shared utils/id.ts

Consolidates 5 duplicate ID generation implementations.
- generateId(prefix): replaces 2 identical msg-* generators
- generateUUID(): uses crypto.randomUUID() with Math.random fallback
- generateFileId(): delegates to generateId('file')
Also fixes deprecated substr() usage."
```

---

### Task 14: pylon — 중복 타입 정의 통합

**Files:**
- Modify: `packages/pylon/src/pylon.ts:103, 174` (SystemPromptPreset, PlatformType 삭제)
- Modify: `packages/pylon/src/agent/agent-manager.ts:61` (SystemPromptPreset export)

**Step 1: SystemPromptPreset 통합**

`agent-manager.ts`의 `SystemPromptPreset` 정의를 export로 변경 (이미 export일 수 있음):
```typescript
export interface SystemPromptPreset {
  // 기존 필드 유지
}
```

`pylon.ts`에서:
- line 103 부근의 `SystemPromptPreset` 정의 삭제
- import 추가: `import type { SystemPromptPreset } from './agent/agent-manager.js';`

**Step 2: PlatformType 통합**

Task 11에서 `PlatformType`을 `utils/path.ts`로 이동했으므로, `pylon.ts`의 로컬 정의를 삭제하고 import:
```typescript
import type { PlatformType } from './utils/path.js';
```

**Step 3: 빌드 + 테스트 확인**

Run: `cd /home/estelle/estelle2 && pnpm --filter @estelle/pylon typecheck && pnpm --filter @estelle/pylon test`
Expected: 모든 통과

**Step 4: 커밋**

```bash
git add packages/pylon/src/pylon.ts packages/pylon/src/agent/agent-manager.ts
git commit -m "refactor(pylon): consolidate duplicate type definitions

SystemPromptPreset: canonical source is agent-manager.ts
PlatformType: canonical source is utils/path.ts"
```

---

### Task 15: core — isCommandExecuteMessage 시그니처 통일

**Files:**
- Modify: `packages/core/src/types/store-message.ts:593-595`

**Step 1: 함수 시그니처를 `unknown`으로 변경**

```typescript
// Before (line 593-595):
export function isCommandExecuteMessage(msg: StoreMessage): msg is CommandExecuteMessage {
  return msg.role === 'user' && msg.type === 'command_execute';
}

// After:
export function isCommandExecuteMessage(value: unknown): value is CommandExecuteMessage {
  return (
    isObject(value) &&
    'role' in value && value.role === 'user' &&
    'type' in value && value.type === 'command_execute' &&
    'id' in value && typeof value.id === 'string' &&
    'timestamp' in value && typeof value.timestamp === 'number' &&
    'commandId' in value && typeof value.commandId === 'string'
  );
}
```

그리고 `isStoreMessage` 함수 내의 inline 체크를 `isCommandExecuteMessage(value)`로 교체.

**Step 2: 빌드 확인**

Run: `cd /home/estelle/estelle2 && pnpm --filter @estelle/core typecheck`
Expected: 빌드 성공

**Step 3: 테스트 실행**

Run: `cd /home/estelle/estelle2 && pnpm --filter @estelle/core test`
Expected: 모든 테스트 통과

**Step 4: 커밋**

```bash
git add packages/core/src/types/store-message.ts
git commit -m "refactor(core): unify isCommandExecuteMessage to accept unknown

All other StoreMessage type guards accept unknown. This one was
the exception, accepting StoreMessage instead. Now consistent
and usable within isStoreMessage() dispatcher."
```

---

### Task 16: core — createMessage type 파라미터 타입 강화

**Files:**
- Modify: `packages/core/src/helpers/create-message.ts:81`

**Step 1: 수정**

```typescript
// Before (line 81):
export function createMessage<T>(
  type: string,
  payload: T,
  options?: CreateMessageOptions
): Message<T> {

// After:
import type { MessageTypeValue } from '../constants/message-type.js';

export function createMessage<T>(
  type: MessageTypeValue | (string & {}),
  payload: T,
  options?: CreateMessageOptions
): Message<T> {
```

`(string & {})` 트릭을 사용하면 `MessageTypeValue` 자동완성을 제공하면서도 임의 문자열을 허용하여 후방 호환성을 유지한다.

**Step 2: 빌드 확인**

Run: `cd /home/estelle/estelle2 && pnpm typecheck`
Expected: 전체 빌드 성공

**Step 3: 커밋**

```bash
git add packages/core/src/helpers/create-message.ts
git commit -m "refactor(core): tighten createMessage type parameter

Provides MessageTypeValue autocomplete while maintaining backward
compatibility via (string & {}) intersection trick."
```

---

### Task 17: core — ErrorPayload을 types/로 이동

**Files:**
- Create: `packages/core/src/types/error.ts`
- Modify: `packages/core/src/types/index.ts`
- Modify: `packages/core/src/helpers/message-type-guards.ts:345-352`

**Step 1: types/error.ts 생성**

```typescript
/**
 * @file error.ts
 * @description 에러 관련 타입 정의
 */

/**
 * 에러 페이로드 인터페이스
 */
export interface ErrorPayload {
  /** 에러 코드 */
  code: string;
  /** 에러 메시지 */
  message: string;
  /** 추가 데이터 (선택적) */
  data?: unknown;
}
```

**Step 2: types/index.ts에 export 추가**

```typescript
export * from './error.js';
```

**Step 3: message-type-guards.ts에서 제거 + import**

line 345-352의 `ErrorPayload` interface 삭제. 대신:
```typescript
import type { ErrorPayload } from '../types/error.js';
// re-export for backward compatibility
export type { ErrorPayload };
```

**Step 4: 빌드 + 테스트 확인**

Run: `cd /home/estelle/estelle2 && pnpm --filter @estelle/core typecheck && pnpm --filter @estelle/core test`
Expected: 모든 통과

**Step 5: 커밋**

```bash
git add packages/core/src/types/error.ts packages/core/src/types/index.ts \
  packages/core/src/helpers/message-type-guards.ts
git commit -m "refactor(core): move ErrorPayload from helpers to types/error.ts

ErrorPayload is a type, not a helper. Re-exported from message-type-guards.ts
for backward compatibility."
```

---

## Phase 4: Architecture Improvements

### Task 18: pylon — handleMessage를 핸들러 맵으로 리팩토링

**Files:**
- Modify: `packages/pylon/src/pylon.ts:693-1051`

**배경:** 현재 `handleMessage`는 38개의 `if (type === ...)` 체인으로 이루어진 359줄짜리 메서드. 핸들러 맵 패턴으로 전환.

**Step 1: 핸들러 맵 타입 + 필드 정의**

`pylon.ts`의 `Pylon` 클래스에 추가:

```typescript
/** 메시지 타입별 핸들러 맵 */
private readonly messageHandlers: Map<string, (payload: Record<string, unknown> | undefined, from?: MessageFrom) => void>;
```

**Step 2: 핸들러 맵 초기화 메서드 생성**

```typescript
/**
 * 메시지 핸들러 맵 초기화
 */
private initMessageHandlers(): Map<string, (payload: Record<string, unknown> | undefined, from?: MessageFrom) => void> {
  const handlers = new Map<string, (payload: any, from?: MessageFrom) => void>();

  // 연결
  handlers.set('connected', (payload) => {
    this.log(`Connected to Relay: ${payload?.message || ''}`);
  });

  // 워크스페이스
  handlers.set('workspace_list', () => this.sendWorkspaceList());
  handlers.set('workspace_create', (p) => this.handleWorkspaceCreate(p));
  handlers.set('workspace_delete', (p) => this.handleWorkspaceDelete(p));
  // ... 나머지 38개 핸들러 등록

  // Claude
  handlers.set('claude_send', (p, f) => this.handleClaudeSend(p, f));
  handlers.set('claude_stop', (p) => this.handleClaudeStop(p));
  handlers.set('claude_control', (p) => this.handleClaudeControl(p));
  handlers.set('permission_response', (p) => this.handlePermissionResponse(p));

  // Widget
  handlers.set('widget_input', (p, f) => this.handleWidgetInput(p, f));
  handlers.set('widget_event', (p, f) => this.handleWidgetEvent(p, f));
  handlers.set('widget_claim', (p, f) => this.handleWidgetClaim(p, f));
  handlers.set('widget_check', (p, f) => this.handleWidgetCheck(p, f));

  return handlers;
}
```

**Step 3: handleMessage 리팩토링**

```typescript
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
```

**Step 4: 생성자에서 초기화**

```typescript
constructor(deps: PylonDependencies) {
  // ... 기존 초기화
  this.messageHandlers = this.initMessageHandlers();
}
```

**Step 5: 빌드 확인**

Run: `cd /home/estelle/estelle2 && pnpm --filter @estelle/pylon typecheck`
Expected: 빌드 성공

**Step 6: 테스트 실행**

Run: `cd /home/estelle/estelle2 && pnpm --filter @estelle/pylon test`
Expected: 모든 테스트 통과 (기능 변경 없음, 리팩토링만)

**Step 7: 커밋**

```bash
git add packages/pylon/src/pylon.ts
git commit -m "refactor(pylon): replace 38-case if/else chain with handler map

handleMessage reduced from 359 lines to ~20 lines.
Message handlers registered in initMessageHandlers() map.
No behavioral changes - pure structural refactor."
```

---

### Task 19: client — uploadStore와 imageUploadStore 통합

**Files:**
- Modify: `packages/client/src/stores/imageUploadStore.ts` (통합 대상)
- Delete: `packages/client/src/stores/uploadStore.ts`
- Modify: `packages/client/src/stores/index.ts`
- Modify: 참조하는 컴포넌트/훅 파일들

**배경:** 두 스토어가 `UploadInfo`, `startUpload`, `updateProgress`, `completeUpload` 패턴을 중복 구현. `imageUploadStore`가 이미지 첨부 + 큐 관리를 담당하고, `uploadStore`가 blob 전송 진행을 추적. 통합하여 단일 스토어에서 전체 업로드 라이프사이클을 관리.

**Step 1: imageUploadStore에 blob 전송 추적 필드 추가**

기존 `UploadInfo`(imageUploadStore)에 `sentChunks`와 `serverPath` 필드 추가:

```typescript
export interface UploadInfo {
  blobId: string;
  filename: string;
  totalChunks: number;
  processedChunks: number;
  sentChunks: number;       // blob 전송 진행 (추가)
  status: 'uploading' | 'completed' | 'failed';
  error?: string;
  fileId?: string;
  serverPath?: string;      // 서버 경로 (추가)
}
```

**Step 2: uploadStore의 메서드를 imageUploadStore로 이관**

`updateSentProgress`, `completeBlobUpload` 등의 메서드를 imageUploadStore에 추가.

**Step 3: uploadStore 참조 코드 마이그레이션**

`useUploadStore` → `useImageUploadStore`로 변경. 각 컴포넌트/훅에서 import 경로 업데이트.

**Step 4: uploadStore.ts 삭제**

**Step 5: 빌드 + 테스트 확인**

Run: `cd /home/estelle/estelle2 && pnpm --filter @estelle/client typecheck && pnpm --filter @estelle/client test`
Expected: 모든 통과

**Step 6: 커밋**

```bash
git add -A packages/client/src/stores/
git commit -m "refactor(client): merge uploadStore into imageUploadStore

Eliminates dual upload tracking that caused state synchronization
issues. Single store now manages the full upload lifecycle:
attachment selection → blob transfer progress → completion."
```

---

### Task 20: core — generateShareId를 crypto.getRandomValues로 강화

**Files:**
- Modify: `packages/core/src/types/share.ts:88-98`

**Step 1: 수정**

```typescript
// Before (line 88-98):
export function generateShareId(): string {
  let result = '';
  const charsetLength = BASE62_CHARS.length;
  for (let i = 0; i < SHARE_ID_LENGTH; i++) {
    const randomIndex = Math.floor(Math.random() * charsetLength);
    result += BASE62_CHARS[randomIndex];
  }
  return result;
}

// After:
export function generateShareId(): string {
  const charsetLength = BASE62_CHARS.length;

  // crypto API 사용 가능하면 활용 (브라우저 + Node.js 18+)
  if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.getRandomValues) {
    const randomValues = new Uint32Array(SHARE_ID_LENGTH);
    globalThis.crypto.getRandomValues(randomValues);
    return Array.from(randomValues, (v) => BASE62_CHARS[v % charsetLength]).join('');
  }

  // 폴백 (테스트 환경 등)
  let result = '';
  for (let i = 0; i < SHARE_ID_LENGTH; i++) {
    const randomIndex = Math.floor(Math.random() * charsetLength);
    result += BASE62_CHARS[randomIndex];
  }
  return result;
}
```

**Step 2: 빌드 + 테스트 확인**

Run: `cd /home/estelle/estelle2 && pnpm --filter @estelle/core typecheck && pnpm --filter @estelle/core test`
Expected: 모든 통과

**Step 3: 커밋**

```bash
git add packages/core/src/types/share.ts
git commit -m "fix(core): use crypto.getRandomValues in generateShareId

Share IDs in URLs grant access to conversations. Math.random()
is not cryptographically secure. Now uses crypto.getRandomValues
with Math.random fallback for environments without crypto API."
```

---

## 완료 후 최종 검증

```bash
cd /home/estelle/estelle2
pnpm typecheck     # 전체 타입 체크
pnpm test          # 전체 테스트
```

Expected: 모든 통과

---

## 예상 효과

| 지표 | Before | After |
|------|--------|-------|
| 전체 건강도 | 6.7/10 | 8.5+/10 |
| Critical 이슈 | 9개 | 0개 |
| Dead code (줄) | ~1,200줄 | ~0줄 |
| DRY 위반 | 15+곳 | 0곳 |
| handleMessage 줄수 | 359줄 | ~20줄 |
| 보안 취약점 | 3개 | 0개 |

## 미래 과제 (이번 계획 범위 밖)

- `conversationStore` Map 복제 성능 최적화 (immer 또는 ref 기반 버퍼링)
- `client/useMessageRouter.ts` console.log → debugStore 전환 (20곳)
- `pylon/src/pylon.ts` 파일 분리 (핸들러 모듈별 분리)
- `client` CustomEvent → Zustand 스토어 전환
- `pylon` console.log 115곳 → 로거 어댑터 전환
- `updater` 자기 업데이트 시 PM2 프로세스 보호 메커니즘
- `core` `claude-utils.ts` 테스트 추가
