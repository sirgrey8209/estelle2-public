# Tunnel Integration 설계

slack-ws-tunnel 프로젝트를 estelle2 모노레포로 통합.

## 배경

SSE 도입 시 회사 PC에서 외부 WebSocket이 차단될 수 있어, Slack 채널을 경유한 WS 터널링이 필요. 현재 별도 레포(slack-ws-tunnel)로 관리 중인 터널을 estelle2 모노레포에 통합하여 배포/관리를 일원화한다.

## 결정 사항

| 항목 | 결정 |
|------|------|
| 통합 방식 | 모노레포 내 별도 패키지, 별도 PM2 프로세스 |
| 패키지 위치 | `packages/tunnel/` |
| 프로세스 관리 | estelle-updater가 PM2로 관리 |
| 설정 위치 | environments.*.json의 `tunnel` 섹션 |
| 봇 토큰 | config 파일에 직접 포함 (레포 private) |

## 설정 구조

### environments.office.json

```json
{
  "envId": 0,
  "pylon": {
    "pylonIndex": "1",
    "relayUrl": "ws://localhost:4000",
    "directPort": 5000,
    ...
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

### environments.cloud.json

```json
{
  "envId": 0,
  "pylon": {
    "relayUrl": "ws://localhost:8080",
    ...
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

## PM2 프로세스 구성

### Master (클라우드)
- estelle-relay
- estelle-pylon
- estelle-tunnel (connect 모드)

### Agent (오피스)
- estelle-pylon
- estelle-tunnel (listen 모드)

## 변경 범위

### 1. packages/tunnel/ (신규)

slack-ws-tunnel 소스를 이동:
- `src/index.ts` — 진입점 (환경변수 TUNNEL_CONFIG에서 설정 로드)
- `src/orchestrator.ts` — 모듈 조율
- `src/slack-transport.ts` — Slack Socket Mode 통신
- `src/tunnel.ts` — ListenTunnel / ConnectTunnel
- `src/codec.ts` — gzip + base64 인코딩
- `src/throttle.ts` — 1초 rate limit 배칭
- `src/config.ts` — 설정 검증
- 테스트 파일들

package.json: @slack/bolt, ws 의존성 포함.

### 2. config/environments.office.json

- `pylon.relayUrl`: `ws://localhost:4000` (터널 경유)
- `pylon.directPort`: 5000
- `tunnel` 섹션 추가 (listen 모드)

### 3. config/environments.cloud.json

- `tunnel` 섹션 추가 (connect 모드)

### 4. packages/updater/src/executor.ts

- 빌드: `packages/tunnel/dist` → `release/tunnel/dist` 복사
- 의존성: `release/tunnel/node_modules` 복사
- config: 환경 설정에서 tunnel config.json 생성 → `release/tunnel/config.json`
- PM2: `tunnel.enabled`이면 ecosystem.config.cjs에 터널 프로세스 추가
- 환경변수: CONFIG_PATH로 config.json 경로 전달

### 5. 기타

- `pnpm-workspace.yaml` — tunnel 패키지 등록
- `package.json` (루트) — build 스크립트에 tunnel 포함

## 터널 진입점 변경

기존: CONFIG_PATH 환경변수로 파일 경로 지정
유지: executor가 `release/tunnel/config.json` 생성, CONFIG_PATH로 전달

## 설계 문서

- 원본 설계: `docs/plans/2026-03-27-slack-ws-tunnel-design.md`
- 원본 구현: `docs/plans/2026-03-27-slack-ws-tunnel-impl.md`
