# Code Quality Cleanup (Stage 1 & 2) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 코드 리뷰에서 발견된 Stage 1 (즉시 수정 - dead code, 미사용 import, deprecated 정리) 및 Stage 2 (타입/안전성 개선 - 이름 충돌, 중복 추출, 보안 강화) 이슈를 수정한다.

**Architecture:** 4개 패키지(core, relay, pylon, client)에 걸친 리팩토링. 의존성 순서는 core → relay/pylon/client. core 변경이 다른 패키지에 영향을 주므로 core부터 진행한다. 각 Task는 독립적이며, 같은 패키지 내에서도 서로 다른 파일을 건드린다.

**Tech Stack:** TypeScript, pnpm monorepo, vitest

---

## Stage 1: 즉시 수정 (Dead Code, 미사용 Import, Deprecated 정리)

### Task 1: client - 존재하지 않는 모듈 export 제거

**Files:**
- Modify: `packages/client/src/components/index.ts`

**Step 1: 수정**

`packages/client/src/components/index.ts`에서 존재하지 않는 `deploy`, `task` export를 제거한다:

```typescript
// 제거할 라인 (12-13):
export * from './deploy';
export * from './task';
```

수정 후 파일:
```typescript
/**
 * @file components/index.ts
 * @description 컴포넌트 모듈 진입점
 */

export * from './common';
export * from './sidebar';
export * from './chat';
export * from './requests';
export * from './settings';
export * from './viewers';
```

**Step 2: 빌드 확인**

Run: `cd /home/estelle/estelle2 && pnpm --filter @estelle/client typecheck`
Expected: 빌드 성공

**Step 3: 커밋**

```bash
git add packages/client/src/components/index.ts
git commit -m "fix(client): remove non-existent deploy/task module exports"
```

---

### Task 2: relay - 미사용 import 제거 (3개 파일)

**Files:**
- Modify: `packages/relay/src/message-handler.ts` (line 25, 27, 614)
- Modify: `packages/relay/src/router.ts` (line 19)
- Modify: `packages/relay/src/device-status.ts` (line 16)

**Step 1: message-handler.ts 수정**

1) Line 25: `log` 제거 — `getDeviceInfo, parseDeviceId`만 남긴다:
```typescript
// Before:
import { getDeviceInfo, parseDeviceId, log } from './utils.js';
// After:
import { getDeviceInfo, parseDeviceId } from './utils.js';
```

2) Line 27: `ClientIndexAllocator` import 전체 삭제:
```typescript
// 삭제:
import { ClientIndexAllocator } from './device-id-validation.js';
```

3) Line 614: mid-file import를 파일 상단으로 이동 — Line 28 근처에 추가:
```typescript
// 파일 상단 import 그룹에 추가:
import type { GoogleUserInfo } from './google-auth.js';
```
그리고 Line 614의 원래 위치에서 삭제.

**Step 2: router.ts 수정**

Line 19: `parseDeviceId` import 삭제:
```typescript
// 삭제:
import { parseDeviceId } from './utils.js';
```

**Step 3: device-status.ts 수정**

Line 16: `broadcastAll` import 삭제:
```typescript
// 삭제:
import { broadcastAll } from './router.js';
```

**Step 4: 빌드 확인**

Run: `cd /home/estelle/estelle2 && pnpm --filter @estelle/relay typecheck`
Expected: 빌드 성공

**Step 5: 커밋**

```bash
git add packages/relay/src/message-handler.ts packages/relay/src/router.ts packages/relay/src/device-status.ts
git commit -m "fix(relay): remove unused imports (log, ClientIndexAllocator, parseDeviceId, broadcastAll)"
```

---

### Task 3: pylon - 레거시 state.ts export 제거 + @deprecated 추가

**Files:**
- Modify: `packages/pylon/src/index.ts` (line 20-21)
- Modify: `packages/pylon/src/state.ts` (line 1에 @deprecated 추가)

**Step 1: index.ts에서 state.js export 제거**

```typescript
// 삭제 (line 20-21):
// 레거시 상태 클래스 (deprecated)
export * from './state.js';
```

**Step 2: state.ts 파일 상단에 @deprecated JSDoc 추가**

```typescript
/**
 * @file state.ts
 * @deprecated 이 모듈은 더 이상 사용되지 않습니다.
 * Pylon 클래스와 WorkspaceStore/MessageStore로 대체되었습니다.
 * 참조하는 외부 코드가 없으므로 추후 제거 예정입니다.
 */
```

**Step 3: 빌드 확인**

Run: `cd /home/estelle/estelle2 && pnpm --filter @estelle/pylon typecheck`
Expected: 빌드 성공 (state.ts의 타입을 외부에서 사용하는 곳이 없으므로)

**Step 4: 커밋**

```bash
git add packages/pylon/src/index.ts packages/pylon/src/state.ts
git commit -m "fix(pylon): remove legacy state.ts from public API, add @deprecated"
```

---

### Task 4: pylon - deprecated 메시지 세션 메서드 호출 제거

**Files:**
- Modify: `packages/pylon/src/pylon.ts`

이 작업은 이미 SQLite로 전환된 deprecated 메서드들의 **호출부**와 **관련 인프라**를 제거한다.

**제거 대상 호출부:**
- Line 451: `this.loadAllMessageSessions();`
- Line 1562: `this.loadMessageSession(eid);`
- Line 2250: `this.loadMessageSession(eid);`
- Line 2386: `this.scheduleSaveMessages(eid);`
- Line 3303: `this.scheduleSaveMessages(conversationId);`
- Line 3838: `this.scheduleSaveMessages(conversationId);`

**제거 대상 메서드 정의:**
- `scheduleSaveMessages()` (line 3407-3424) — 빈 `saveMessageSession`을 호출하는 debounce 타이머
- `saveMessageSession()` (line 3432-3435) — 빈 메서드
- `loadAllMessageSessions()` (line 3464-3468) — 로그만 출력
- `loadMessageSession()` (line 3476-3479) — 빈 메서드

**제거 대상 필드:**
- `messageSaveTimers` (line 393): `Map<number, ReturnType<typeof setTimeout>>`
- `MESSAGE_SAVE_DEBOUNCE_MS` (line 396): 상수

**`flushPendingSaves()` 수정** (line 3440-3456):
메시지 타이머 관련 코드 블록 제거 (line 3448-3452의 messageSaveTimers clear 부분)

**Step 1: 호출부 제거**

각 호출부를 찾아서 해당 라인을 삭제한다. 주변 주석도 함께 정리한다:
- Line 449-451: 주석 `// 모든 대화의 메시지 세션 로딩` + `this.loadAllMessageSessions()` 3줄 삭제
- Line 1561-1562: 주석 `// メッセージセッションをロード` + `this.loadMessageSession(eid)` 2줄 삭제
- Line 2249-2250: 주석 `// 메시지 세션 로드` + `this.loadMessageSession(eid)` 2줄 삭제
- Line 2386: `this.scheduleSaveMessages(eid)` 1줄 삭제
- Line 3301-3303: `if (shouldSave)` 블록 3줄 삭제
- Line 3838: `this.scheduleSaveMessages(conversationId)` 1줄 삭제

**Step 2: 메서드 정의 + 필드 제거**

- `messageSaveTimers` 필드 삭제 (line 393)
- `MESSAGE_SAVE_DEBOUNCE_MS` 상수 삭제 (line 396)
- `scheduleSaveMessages` 메서드 전체 삭제 (line 3404-3424)
- `saveMessageSession` 메서드 전체 삭제 (line 3426-3435)
- `loadAllMessageSessions` 메서드 전체 삭제 (line 3458-3468)
- `loadMessageSession` 메서드 전체 삭제 (line 3470-3479)

**Step 3: `flushPendingSaves` 수정**

```typescript
// Before (일부):
// 메시지 타이머 취소 (SQLite 전환 후 더 이상 사용되지 않음)
for (const [, timer] of this.messageSaveTimers) {
  clearTimeout(timer);
}
this.messageSaveTimers.clear();

// SQLite 기반으로 전환되어 dirty 세션 저장 불필요
// 메시지는 추가 시 즉시 DB에 저장됨
```

위 블록(line 3448-3455)을 삭제하여 워크스페이스 저장만 남긴다.

**Step 4: 빌드 확인**

Run: `cd /home/estelle/estelle2 && pnpm --filter @estelle/pylon typecheck`
Expected: 빌드 성공

**Step 5: 테스트 실행**

Run: `cd /home/estelle/estelle2 && pnpm --filter @estelle/pylon test`
Expected: 모든 테스트 통과

**Step 6: 커밋**

```bash
git add packages/pylon/src/pylon.ts
git commit -m "fix(pylon): remove deprecated message session methods and related infrastructure

SQLite migration is complete - loadAllMessageSessions, loadMessageSession,
saveMessageSession, scheduleSaveMessages were all no-ops."
```

---

### Task 5: client - dead code 제거 (requestFolderRename)

**Files:**
- Modify: `packages/client/src/services/relaySender.ts` (line 364-370)

**Step 1: 수정**

`requestFolderRename` 함수를 삭제한다 (line 364-370):

```typescript
// 삭제:
export function requestFolderRename(deviceId: number, path: string, newName: string): boolean {
  return sendMessage({
    type: MessageType.FOLDER_RENAME,
    payload: { deviceId, path, newName },
    to: [deviceId],
  });
}
```

**Step 2: 빌드 확인**

Run: `cd /home/estelle/estelle2 && pnpm --filter @estelle/client typecheck`
Expected: 빌드 성공

**Step 3: 커밋**

```bash
git add packages/client/src/services/relaySender.ts
git commit -m "fix(client): remove unused requestFolderRename function"
```

---

## Stage 2: 타입/안전성 개선

### Task 6: core - Attachment 이름 충돌 해결

**Files:**
- Modify: `packages/core/src/types/blob.ts` (line 49: `Attachment` → `BlobAttachment`)
- Modify: `packages/core/src/types/blob.ts` (line 347 근처: `isAttachment` → `isBlobAttachment`)
- Modify: `packages/core/src/types/claude-control.ts` (line 10: import 변경)
- Modify: `packages/core/src/types/index.ts` (line 18-36: 별칭 제거, 직접 export)
- Test: 기존 테스트가 통과하는지 확인

**전략:** blob.ts의 `Attachment`를 소스 레벨에서 `BlobAttachment`로 이름 변경한다. 이렇게 하면 types/index.ts에서 별칭 처리가 불필요해지고, store-message.ts의 `Attachment`와 충돌이 없어진다.

**Step 1: blob.ts 수정**

1) `export interface Attachment` → `export interface BlobAttachment` (line 49)
2) JSDoc과 예제 코드에서 `Attachment` 참조를 `BlobAttachment`로 변경
3) `export function isAttachment` → `export function isBlobAttachment` (해당 함수명)
4) 파일 내부에서 `Attachment` 참조를 `BlobAttachment`로 변경 (BlobStartPayload 등에서 사용)

**Step 2: claude-control.ts 수정**

```typescript
// Before (line 10):
import type { Attachment } from './blob.js';
// After:
import type { BlobAttachment } from './blob.js';
```

파일 내에서 `Attachment` 타입 참조를 `BlobAttachment`로 변경.

**Step 3: types/index.ts 수정**

별칭이 불필요해지므로 blob.js export를 `export *`로 단순화:

```typescript
// Before (line 18-36):
// blob.js - Attachment는 BlobAttachment로 별칭
export {
  type Attachment as BlobAttachment,
  ...
  isAttachment as isBlobAttachment,
  ...
} from './blob.js';

// After:
// blob.js - Blob 전송 관련 타입
export * from './blob.js';
```

store-message.ts는 이미 `export *`이므로 `Attachment`는 store-message.ts의 것이 된다. `BlobAttachment`는 blob.ts에서 직접 나오므로 이름 충돌 없음.

**Step 4: 빌드 확인**

Run: `cd /home/estelle/estelle2 && pnpm --filter @estelle/core typecheck`
Expected: 빌드 성공

Run: `cd /home/estelle/estelle2 && pnpm typecheck`
Expected: 전체 빌드 성공 (다른 패키지에서 `BlobAttachment`로 import하는 곳이 이미 types/index.ts를 통해 `BlobAttachment`로 사용 중)

**Step 5: 테스트 실행**

Run: `cd /home/estelle/estelle2 && pnpm --filter @estelle/core test`
Expected: 모든 테스트 통과

**Step 6: 커밋**

```bash
git add packages/core/src/types/blob.ts packages/core/src/types/claude-control.ts packages/core/src/types/index.ts
git commit -m "refactor(core): rename blob Attachment to BlobAttachment at source level

Resolves name collision with store-message.ts Attachment.
Simplifies types/index.ts by removing alias workaround."
```

---

### Task 7: core - isObject 헬퍼를 공통 유틸리티로 추출

**Files:**
- Create: `packages/core/src/utils/type-guards.ts`
- Modify: `packages/core/src/utils/index.ts`
- Modify: `packages/core/src/types/blob.ts` (line 347-349: isObject 제거, import 추가)
- Modify: `packages/core/src/types/store-message.ts` (line 429-431: isObject 제거, import 추가)
- Modify: `packages/core/src/types/claude-control.ts` (line 288-290: isObject 제거, import 추가)
- Modify: `packages/core/src/types/claude-event.ts` (line 346-348: isObject 제거, import 추가)
- Modify: `packages/core/src/types/widget.ts` (line 205-207: isObject 제거, import 추가)
- Modify: `packages/core/src/helpers/message-type-guards.ts` (line 41-43: isObject 제거, import 추가)

**Step 1: 공통 유틸 파일 생성**

`packages/core/src/utils/type-guards.ts`:
```typescript
/**
 * @file type-guards.ts
 * @description 공통 타입 가드 유틸리티
 */

/**
 * 값이 객체이고 null이 아닌지 확인하는 헬퍼 함수
 *
 * @param value - 확인할 값
 * @returns 객체이고 null이 아니면 true
 */
export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
```

**Step 2: utils/index.ts에 export 추가**

```typescript
export * from './type-guards.js';
```

**Step 3: 6개 파일에서 로컬 isObject 제거 + import 추가**

각 파일에서:
1. 로컬 `function isObject(...)` 정의를 삭제
2. 파일 상단에 `import { isObject } from '../utils/type-guards.js';` 추가
   - `helpers/message-type-guards.ts`는 `import { isObject } from '../utils/type-guards.js';`
   - `types/*.ts`는 `import { isObject } from '../utils/type-guards.js';`

**Step 4: 빌드 확인**

Run: `cd /home/estelle/estelle2 && pnpm --filter @estelle/core typecheck`
Expected: 빌드 성공

**Step 5: 테스트 실행**

Run: `cd /home/estelle/estelle2 && pnpm --filter @estelle/core test`
Expected: 모든 테스트 통과

**Step 6: 커밋**

```bash
git add packages/core/src/utils/type-guards.ts packages/core/src/utils/index.ts \
  packages/core/src/types/blob.ts packages/core/src/types/store-message.ts \
  packages/core/src/types/claude-control.ts packages/core/src/types/claude-event.ts \
  packages/core/src/types/widget.ts packages/core/src/helpers/message-type-guards.ts
git commit -m "refactor(core): extract isObject to shared utils/type-guards.ts

Removes 6 duplicate isObject definitions across types/ and helpers/."
```

---

### Task 8: core - PermissionModeType을 PermissionModeValue로 통합

**Files:**
- Modify: `packages/core/src/types/claude-control.ts` (line 244: PermissionModeType 제거, import 추가)

**Step 1: claude-control.ts 수정**

1) `PermissionModeValue`를 import:
```typescript
import { type PermissionModeValue } from '../constants/permission-mode.js';
```

2) `PermissionModeType` 정의(line 244)를 제거하고, alias로 대체:
```typescript
/**
 * @deprecated PermissionModeValue를 사용하세요
 */
export type PermissionModeType = PermissionModeValue;
```

이렇게 하면 기존에 `PermissionModeType`을 사용하는 코드가 깨지지 않으면서, 단일 소스로 통합된다.

**Step 2: 빌드 확인**

Run: `cd /home/estelle/estelle2 && pnpm typecheck`
Expected: 전체 빌드 성공

**Step 3: 커밋**

```bash
git add packages/core/src/types/claude-control.ts
git commit -m "refactor(core): unify PermissionModeType as alias to PermissionModeValue

PermissionModeType was a duplicate literal union. Now it's derived from
the canonical PermissionMode constant via PermissionModeValue."
```

---

### Task 9: core - Character/CharacterInfo 중복 통합

**Files:**
- Modify: `packages/core/src/constants/characters.ts` (CharacterInfo 제거, Character import)
- Modify: `packages/core/src/types/device.ts` (변경 없음 - Character가 canonical)

**전략:** `Character`(types/device.ts)를 정식 타입으로 유지하고, `CharacterInfo`(constants/characters.ts)를 `Character`로 교체한다.

**Step 1: characters.ts 수정**

```typescript
// Before (line 15-22):
export interface CharacterInfo {
  name: string;
  icon: string;
  description: string;
}

// After:
import type { Character } from '../types/device.js';

/**
 * @deprecated Character 타입을 사용하세요
 */
export type CharacterInfo = Character;
```

`Characters` 상수의 `satisfies Record<string, CharacterInfo>`는 `satisfies Record<string, Character>`로 변경:
```typescript
} as const satisfies Record<string, Character>;
```

**Step 2: 빌드 확인**

Run: `cd /home/estelle/estelle2 && pnpm --filter @estelle/core typecheck`
Expected: 빌드 성공

**Step 3: 테스트 실행**

Run: `cd /home/estelle/estelle2 && pnpm --filter @estelle/core test`
Expected: 모든 테스트 통과

**Step 4: 커밋**

```bash
git add packages/core/src/constants/characters.ts
git commit -m "refactor(core): unify CharacterInfo as alias to Character type

Character (types/device.ts) is the canonical type.
CharacterInfo is now a deprecated alias."
```

---

### Task 10: relay - static.ts 디렉토리 트래버설 방지 강화

**Files:**
- Modify: `packages/relay/src/static.ts` (line 88-94)

**Step 1: 수정**

기존 정규식 기반 방어를 `path.resolve` + `startsWith` 검증으로 강화:

```typescript
// Before (line 88-94):
let pathname = url.pathname;

// 보안: 디렉토리 트래버설 방지
pathname = path.normalize(pathname).replace(/^(\.\.(\/|\\|$))+/, '');

// 파일 경로 결정
let filePath = path.join(staticDir, pathname);

// After:
let pathname = url.pathname;

// 보안: 디렉토리 트래버설 방지
pathname = path.normalize(pathname).replace(/^(\.\.(\/|\\|$))+/, '');

// 파일 경로 결정
let filePath = path.join(staticDir, pathname);

// 보안: 최종 경로가 staticDir 하위인지 검증
const resolvedFilePath = path.resolve(filePath);
const resolvedStaticDir = path.resolve(staticDir);
if (!resolvedFilePath.startsWith(resolvedStaticDir + path.sep) && resolvedFilePath !== resolvedStaticDir) {
  return false;
}
```

**Step 2: __filename 변수 정리 (bonus)**

```typescript
// Before (line 15-16):
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// After:
const __dirname = path.dirname(fileURLToPath(import.meta.url));
```

**Step 3: 빌드 확인**

Run: `cd /home/estelle/estelle2 && pnpm --filter @estelle/relay typecheck`
Expected: 빌드 성공

**Step 4: 테스트 실행**

Run: `cd /home/estelle/estelle2 && pnpm --filter @estelle/relay test`
Expected: 모든 테스트 통과

**Step 5: 커밋**

```bash
git add packages/relay/src/static.ts
git commit -m "fix(relay): strengthen directory traversal prevention in static file server

Add path.resolve + startsWith check after path.join to ensure
resolved file path is always under staticDir."
```

---

## 완료 후 최종 검증

**Run:**
```bash
cd /home/estelle/estelle2
pnpm typecheck
pnpm test
```

Expected: 전체 빌드 및 테스트 통과
