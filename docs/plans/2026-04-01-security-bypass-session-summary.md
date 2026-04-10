# 보안 우회 세션 요약

2026-04-01 세션에서 진행한 작업 전체 정리.

## 배경

LY Corporation에서 SSE(Secure Service Edge)를 전사 도입 예정. 도입 후 회사 PC에서 외부 WebSocket 연결이 차단될 가능성이 있어, Estelle의 Pylon ↔ Relay 연결을 유지하기 위한 대안이 필요했음.

## 1. slack-ws-tunnel 프로젝트

### 개요

WebSocket 메시지를 Slack 채널을 통해 투명하게 터널링하는 독립 라이브러리. Estelle 코드 변경 없이, 양쪽에 터널을 두고 Slack Private Channel을 경유하여 WS 메시지를 중계.

### 설계 결정

| 항목 | 결정 |
|------|------|
| 아키텍처 | listen 모드 (WS 서버) + connect 모드 (WS 클라이언트), Slack Private Channel 경유 |
| Slack 통신 | Socket Mode 양쪽 수신, chat.postMessage + message_metadata 송신 |
| 봇 구성 | 2개 (자기 메시지 필터링을 위해 분리) |
| 인코딩 | JSON → gzip → base64, 매직헤더 WST1 |
| 쓰로틀링 | 즉시 전송 + 1초 배칭 (Slack 1건/초 rate limit 대응) |
| 설정 | config.json (Slack 토큰 + mode + tunnel 포트), 런타임은 Slack 채널 커맨드 |
| 실행 | pm2 서비스 |

### 구현 모듈

| 모듈 | 역할 |
|------|------|
| `config.ts` | 설정 파일 검증 |
| `codec.ts` | gzip + base64 인코딩/디코딩 + 청크 분할/재조립 |
| `throttle.ts` | 즉시 전송 + 1초 배칭 |
| `slack-transport.ts` | Socket Mode 수신 + postMessage 송신 + bot_id 필터링 |
| `tunnel.ts` | ListenTunnel (WS 서버) + ConnectTunnel (WS 클라이언트) |
| `orchestrator.ts` | 전체 모듈 연결 + Slack 채널 커맨드 처리 |
| `index.ts` | CLI 진입점 + 시그널 핸들링 |

### Slack 채널 커맨드

| 커맨드 | 설명 |
|--------|------|
| `tunnel <ws-url> <port>` | 터널 설정 |
| `start` | 마지막 설정으로 재시작 |
| `stop` | WS 터널 중지 (Slack 유지) |
| `status` | 현재 상태 |
| `set rate <ms>` | 쓰로틀 간격 |
| `set maxsize <bytes>` | 메타데이터 크기 |
| `ping` | 봇 생존 확인 |
| `clear` | 봇 메시지 삭제 |
| `help` | 커맨드 목록 |

### 세팅 중 발생한 이슈 및 해결

| 이슈 | 원인 | 해결 |
|------|------|------|
| Invalid URL | Slack이 URL을 `<url>`로 감싸서 전달 | `stripSlackUrl()` 함수 추가 |
| metadata_too_large | Slack metadata 크기 제한 초과 | maxMetadataSize 20000→4000, envelope 오버헤드 차감 |
| 히스토리 안 보임 | 청크 재조립 미구현 | `handleSlackData`에 청크 수집/reassemble 로직 추가 |
| auto-clear가 rate 소모 | chat.delete 폭탄 | auto-clear 제거, clear 수동 커맨드만 유지 |
| 하트비트가 대역폭 소모 | Estelle RelayClient 10초마다 ping/pong | Estelle 쪽에서 옵션으로 해결 (향후) |

### 프로젝트 위치

- GitHub: https://github.com/sirgrey8209/slack-ws-tunnel (private)
- 로컬: `/home/estelle/slack-ws-tunnel/`

### Slack App 설정

- `estelle-wstc` — connect 측 (이 머신, 클라우드)
- `estelle-wstl` — listen 측 (회사 PC)
- Private Channel ID: `C0APQJX0UGL`

---

## 2. Direct Connection 기능

### 개요

C1(회사 클라이언트)과 P1(회사 Pylon)이 같은 네트워크에 있을 때, Relay를 거치지 않고 직접 WebSocket으로 통신하는 기능. Slack 터널의 레이턴시 문제를 근본적으로 해결.

### 설계 결정

| 항목 | 결정 |
|------|------|
| 접근법 | Core에 DirectRouter 추가, 양쪽(Pylon/Client)이 공유 |
| 설정 (Pylon) | environments.json의 `directPort` — 있으면 WS 서버 열림 |
| 설정 (Client) | URL 파라미터 `?direct=ws://192.168.x.x:5000` |
| 인증 | 접속 IP가 private range인지 체크 (로컬만 허용) |
| 핸드셰이크 | P1이 pylonIndex/deviceId를 C1에 전달 |
| 스플릿 라우팅 | to → 직접 대상은 직접 WS, 나머지는 Relay |
| broadcast | 직접 대상에게 직접 보내고, Relay에는 exclude 추가 |
| heartbeat | 직접 연결에는 ping 안 보냄 |
| fallback | 직접 연결 실패/끊김 → R2 경유로 자동 전환 |

### 변경된 파일 (17개, +1,021줄)

| 패키지 | 파일 | 내용 |
|--------|------|------|
| core | `network/direct-router.ts` | 스플릿 라우팅 로직 |
| core | `network/direct-router.test.ts` | 테스트 7개 |
| core | `types/message.ts` | `exclude?: number[]` 필드 |
| core | `types/message.test.ts` | 테스트 2개 |
| core | `network/index.ts` | DirectRouter export |
| relay | `router.ts` | exclude 필터링 |
| relay | `types.ts` | exclude 타입 |
| relay | `tests/router.test.ts` | exclude 테스트 |
| pylon | `network/direct-server.ts` | 직접 연결 WS 서버 |
| pylon | `network/direct-server.test.ts` | 테스트 5개 |
| pylon | `network/relay-client-v2.ts` | DirectRouter 내장 |
| pylon | `network/relay-client-v2.test.ts` | 테스트 4개 |
| pylon | `bin.ts` | directPort 설정 연결 |
| client | `services/relayServiceV2.ts` | DirectRouter 내장 |
| client | `services/relayServiceV2.test.ts` | 테스트 4개 |
| client | `services/relaySender.ts` | V2 통합 |
| client | `App.tsx` | URL ?direct 파라미터 처리 |

### 배포

v0401_2로 배포 완료. 회사 PC에 `directPort: 5000` 설정 추가 필요.

---

## 설계 문서 목록

- `docs/plans/2026-03-27-slack-ws-tunnel-design.md` — slack-ws-tunnel 설계
- `docs/plans/2026-03-27-slack-ws-tunnel-impl.md` — slack-ws-tunnel 구현 계획 (estelle2 내)
- `docs/plans/2026-03-30-direct-connection-design.md` — Direct Connection 설계
- `docs/plans/2026-03-30-direct-connection-impl.md` — Direct Connection 구현 계획

## slack-ws-tunnel 쪽 설계 문서

- `slack-ws-tunnel/docs/plans/2026-03-27-slack-ws-tunnel-design.md`
- `slack-ws-tunnel/docs/plans/2026-03-27-slack-ws-tunnel-impl.md`
