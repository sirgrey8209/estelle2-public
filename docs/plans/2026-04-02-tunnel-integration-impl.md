# Tunnel Integration 구현 계획

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** slack-ws-tunnel 프로젝트를 estelle2 모노레포의 `packages/tunnel/`로 이동하고, updater가 별도 PM2 프로세스로 관리하도록 한다.

**Architecture:** 터널 소스를 모노레포 패키지로 이동, tsconfig/package.json을 모노레포 컨벤션에 맞추고, executor.ts가 빌드/복사/PM2 시작을 처리. 기존 터널 코드는 그대로 유지하고 진입점만 config.json 파일 경로 기반으로 동작.

**Tech Stack:** TypeScript, @slack/bolt, ws, pnpm workspace, PM2

---

### Task 1: packages/tunnel/ 패키지 생성

**Files:**
- Create: `packages/tunnel/package.json`
- Create: `packages/tunnel/tsconfig.json`
- Create: `packages/tunnel/vitest.config.ts`

**Step 1: package.json 작성**

```json
{
  "name": "@estelle/tunnel",
  "version": "0.0.1",
  "type": "module",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "start": "node dist/index.js"
  },
  "dependencies": {
    "@slack/bolt": "^4.6.0",
    "ws": "^8.20.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "@types/ws": "^8.18.1",
    "typescript": "^5.3.0",
    "vitest": "^2.0.0"
  }
}
```

**Step 2: tsconfig.json 작성**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"],
  "exclude": ["src/**/*.test.ts"]
}
```

**Step 3: vitest.config.ts 작성**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
  },
});
```

---

### Task 2: 터널 소스 코드 복사

**Files:**
- Create: `packages/tunnel/src/index.ts` (from `/home/estelle/slack-ws-tunnel/src/index.ts`)
- Create: `packages/tunnel/src/orchestrator.ts`
- Create: `packages/tunnel/src/slack-transport.ts`
- Create: `packages/tunnel/src/tunnel.ts`
- Create: `packages/tunnel/src/codec.ts`
- Create: `packages/tunnel/src/throttle.ts`
- Create: `packages/tunnel/src/config.ts`
- Create: `packages/tunnel/src/codec.test.ts`
- Create: `packages/tunnel/src/config.test.ts`
- Create: `packages/tunnel/src/throttle.test.ts`
- Create: `packages/tunnel/src/slack-transport.test.ts`
- Create: `packages/tunnel/src/tunnel.test.ts`
- Create: `packages/tunnel/src/integration.test.ts`

**Step 1: 소스 파일 복사**

```bash
cp /home/estelle/slack-ws-tunnel/src/*.ts /home/estelle/estelle2/packages/tunnel/src/
```

**Step 2: import 경로 확인**

기존 코드는 `./config.js`, `./orchestrator.js` 등 상대경로 + `.js` 확장자 사용. tsconfig.base.json이 `NodeNext` moduleResolution이므로 그대로 호환됨. 변경 불필요.

**Step 3: 빌드 확인**

```bash
pnpm install
pnpm --filter @estelle/tunnel build
```

Expected: 빌드 성공, `packages/tunnel/dist/` 생성

**Step 4: 테스트 확인**

```bash
pnpm --filter @estelle/tunnel test
```

Expected: 기존 테스트 모두 통과

**Step 5: 커밋**

```bash
git add packages/tunnel/
git commit -m "feat: move slack-ws-tunnel into monorepo as @estelle/tunnel"
```

---

### Task 3: environments.office.json 업데이트

**Files:**
- Modify: `config/environments.office.json`

**Step 1: tunnel 섹션 추가**

최종 파일:

```json
{
  "envId": 0,
  "relay": {
    "port": 8080,
    "url": "ws://YOUR_SERVER_IP:8080"
  },
  "pylon": {
    "pylonIndex": "1",
    "relayUrl": "ws://localhost:4000",
    "pm2Name": "estelle-pylon",
    "configDir": "~/.claude-release",
    "credentialsBackupDir": "~/.claude-credentials/release",
    "mcpPort": 9876,
    "dataDir": "./release-data/data",
    "defaultWorkingDir": "C:\\WorkSpace",
    "directPort": 5000
  },
  "tunnel": {
    "enabled": true,
    "mode": "listen",
    "pm2Name": "estelle-tunnel",
    "slack": {
      "botToken": "REDACTED",
      "appToken": "REDACTED",
      "channelId": "C0APQJX0UGL"
    },
    "listenPort": 4000,
    "connectPort": 8080
  }
}
```

---

### Task 4: environments.cloud.json 업데이트

**Files:**
- Modify: `config/environments.cloud.json`

**Step 1: tunnel 섹션 추가**

최종 파일:

```json
{
  "envId": 0,
  "relay": {
    "port": 8080,
    "url": "ws://YOUR_SERVER_IP:8080",
    "pm2Name": "estelle-relay"
  },
  "pylon": {
    "pylonIndex": "3",
    "relayUrl": "ws://localhost:8080",
    "pm2Name": "estelle-pylon",
    "configDir": "~/.claude",
    "credentialsBackupDir": "~/.claude-credentials",
    "mcpPort": 9876,
    "dataDir": "./release-data",
    "defaultWorkingDir": "/home/estelle"
  },
  "tunnel": {
    "enabled": true,
    "mode": "connect",
    "pm2Name": "estelle-tunnel",
    "slack": {
      "botToken": "REDACTED",
      "appToken": "REDACTED",
      "channelId": "C0APQJX0UGL"
    },
    "listenPort": 4000,
    "connectPort": 8080
  }
}
```

**Step 2: 커밋**

```bash
git add config/environments.office.json config/environments.cloud.json
git commit -m "feat: add tunnel config to environment files"
```

---

### Task 5: executor.ts — 터널 빌드 아티팩트 복사

**Files:**
- Modify: `packages/updater/src/executor.ts`

**Step 1: Step 6 (Copy build artifacts) 영역에 터널 복사 추가**

`pylon/dist` 복사 후, relay 복사 전에 추가:

```typescript
    // Copy tunnel/dist (if tunnel package exists)
    const tunnelDistSrc = path.join(pkgDir, 'tunnel', 'dist');
    if (fs.existsSync(tunnelDistSrc)) {
      const tunnelDistDest = path.join(releaseDir, 'tunnel', 'dist');
      fs.mkdirSync(tunnelDistDest, { recursive: true });
      fs.cpSync(tunnelDistSrc, tunnelDistDest, { recursive: true });
      log(`  tunnel/dist → release/tunnel/dist`);

      // Copy tunnel/node_modules (has @slack/bolt dependency)
      const tunnelNodeModulesSrc = path.join(pkgDir, 'tunnel', 'node_modules');
      if (fs.existsSync(tunnelNodeModulesSrc)) {
        const tunnelNodeModulesDest = path.join(releaseDir, 'tunnel', 'node_modules');
        fs.mkdirSync(tunnelNodeModulesDest, { recursive: true });
        fs.cpSync(tunnelNodeModulesSrc, tunnelNodeModulesDest, { recursive: true });
        log(`  tunnel/node_modules → release/tunnel/node_modules`);
      }

      // Copy tunnel/package.json (for node module resolution)
      const tunnelPkgSrc = path.join(pkgDir, 'tunnel', 'package.json');
      fs.cpSync(tunnelPkgSrc, path.join(releaseDir, 'tunnel', 'package.json'));
    }
```

**Step 2: stale @estelle 제거 목록에 tunnel 추가**

변경 전:
```typescript
    for (const pkg of ['pylon', 'relay']) {
```

변경 후:
```typescript
    for (const pkg of ['pylon', 'relay', 'tunnel']) {
```

---

### Task 6: executor.ts — 터널 config.json 생성 및 PM2 프로세스 추가

**Files:**
- Modify: `packages/updater/src/executor.ts`

**Step 1: tunnel PM2 앱 추가 (apps 배열 구성 영역, pylon push 후)**

pylon `apps.push(...)` 블록 이후, relay `if (isMaster && ...)` 블록 이전에 추가:

```typescript
    // Tunnel PM2 process (if tunnel.enabled in env config)
    if (envConfig?.tunnel?.enabled) {
      const tunnelConfig = envConfig.tunnel as Record<string, any>;
      const tunnelPm2Name = tunnelConfig.pm2Name || 'estelle-tunnel';

      // Generate config.json for tunnel
      const tunnelReleaseDir = path.join(releaseDir, 'tunnel');
      fs.mkdirSync(tunnelReleaseDir, { recursive: true });

      const tunnelConfigJson = {
        mode: tunnelConfig.mode,
        slack: tunnelConfig.slack,
        tunnel: {
          connectPort: tunnelConfig.connectPort,
          listenPort: tunnelConfig.listenPort,
        },
      };
      const tunnelConfigPath = path.join(tunnelReleaseDir, 'config.json');
      fs.writeFileSync(tunnelConfigPath, JSON.stringify(tunnelConfigJson, null, 2));
      log(`  Tunnel config written: ${tunnelConfigPath}`);

      apps.push({
        name: tunnelPm2Name,
        script: 'dist/index.js',
        cwd: tunnelReleaseDir,
        env: {
          CONFIG_PATH: tunnelConfigPath,
        },
      });
    }
```

**Step 2: 빌드 확인**

```bash
pnpm --filter @estelle/updater build
```

Expected: 빌드 성공

**Step 3: 커밋**

```bash
git add packages/updater/src/executor.ts
git commit -m "feat(updater): add tunnel build/deploy/PM2 support"
```

---

### Task 7: executor.ts 주석 업데이트

**Files:**
- Modify: `packages/updater/src/executor.ts`

**Step 1: 파일 상단 주석에 터널 언급 추가**

변경 전:
```typescript
/** Master restarts Relay + Pylon, Agent restarts Pylon only */
isMaster?: boolean;
```

변경 후:
```typescript
/** Master restarts Relay + Pylon + Tunnel(connect), Agent restarts Pylon + Tunnel(listen) */
isMaster?: boolean;
```

**Step 2: 커밋**

```bash
git add packages/updater/src/executor.ts
git commit -m "docs(updater): update comment to reflect tunnel process"
```

---

### Task 8: pylon bin.ts — directPort 전달 추가

**Files:**
- Modify: `packages/updater/src/executor.ts`

**Step 1: ESTELLE_ENV_CONFIG에 directPort 포함**

executor.ts에서 pylon env config 생성 부분에 `directPort` 추가:

변경 전:
```typescript
      pylonEnv.ESTELLE_ENV_CONFIG = JSON.stringify({
        envId: envConfig.envId,
        pylon: {
          pylonIndex: (envConfig.pylon as any).pylonIndex,
          relayUrl: (envConfig.pylon as any).relayUrl,
          configDir: expandPath((envConfig.pylon as any).configDir),
          credentialsBackupDir: expandPath((envConfig.pylon as any).credentialsBackupDir),
          dataDir: path.resolve(repoRoot, (envConfig.pylon as any).dataDir),
          mcpPort: (envConfig.pylon as any).mcpPort,
          defaultWorkingDir: expandPath((envConfig.pylon as any).defaultWorkingDir),
        },
      });
```

변경 후:
```typescript
      pylonEnv.ESTELLE_ENV_CONFIG = JSON.stringify({
        envId: envConfig.envId,
        pylon: {
          pylonIndex: (envConfig.pylon as any).pylonIndex,
          relayUrl: (envConfig.pylon as any).relayUrl,
          configDir: expandPath((envConfig.pylon as any).configDir),
          credentialsBackupDir: expandPath((envConfig.pylon as any).credentialsBackupDir),
          dataDir: path.resolve(repoRoot, (envConfig.pylon as any).dataDir),
          mcpPort: (envConfig.pylon as any).mcpPort,
          defaultWorkingDir: expandPath((envConfig.pylon as any).defaultWorkingDir),
          directPort: (envConfig.pylon as any).directPort,
        },
      });
```

**Step 2: 빌드 확인**

```bash
pnpm --filter @estelle/updater build
```

**Step 3: 커밋**

```bash
git add packages/updater/src/executor.ts
git commit -m "feat(updater): pass directPort to pylon via ESTELLE_ENV_CONFIG"
```

---

### Task 9: 전체 빌드 및 검증

**Step 1: 전체 빌드**

```bash
pnpm build
```

Expected: 모든 패키지 빌드 성공 (core, tunnel, relay, pylon, updater)

**Step 2: 전체 테스트**

```bash
pnpm test
```

Expected: 모든 테스트 통과

**Step 3: 타입체크**

```bash
pnpm typecheck
```

Expected: 에러 없음

**Step 4: 최종 커밋**

모든 변경 사항이 이미 커밋된 상태인지 확인:

```bash
git status
```

Expected: clean working tree
