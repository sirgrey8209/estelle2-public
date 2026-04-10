# Direct Connection Design

C1(회사 클라이언트)과 P1(회사 Pylon)이 같은 네트워크에 있을 때, Relay를 거치지 않고 직접 WebSocket 연결로 통신하는 기능.

## 배경

현재 C1 → R2 → (slack tunnel) → P1 경로는 Slack 쓰로틀링(1건/초) + 터널 레이턴시로 느림. 같은 네트워크에 있는 C1-P1 간에는 직접 연결이 가능하므로, 이 경로를 최적화 경로로 활용하고 나머지는 기존 Relay 경유를 유지.

## 목표 구조

```
C1 (회사 브라우저)
 ├── ws 직접 → P1 (로컬, 빠름)
 └── ws → R2 → P2 (클라우드, 기존대로)

Cm (모바일)
 └── ws → R2 → P1 (slack tunnel, 기존대로)
              → P2 (직접, 기존대로)
```

- C1은 P1과 직접 연결 + R2와 기존 연결, 두 개를 동시에 유지
- P1은 C1 직접 연결 수락 + R2(slack tunnel) 기존 연결, 두 개를 동시에 유지
- 직접 연결은 순수한 최적화 경로. 없어도 R2로 전부 동작

## 설정

### Pylon (environments.json)

`directPort`가 있으면 직접 연결용 WS 서버를 열고, 없으면 기존대로 동작.

```json
"pylon": {
  "pylonIndex": "1",
  "relayUrl": "ws://localhost:4000",
  "directPort": 5000
}
```

P2에는 `directPort`를 설정하지 않으므로 직접 연결 서버를 열지 않음.

### Client (URL 파라미터)

```
일반 접속:  https://estelle.example.com
직접 연결: https://estelle.example.com?direct=ws://192.168.1.100:5000
```

서버 설정에 흔적이 남지 않음. 브라우저 URL에서만 관리.

## Core 공통 모듈

### DirectRouter (core/src/network/direct-router.ts)

C1(RelayServiceV2)과 P1(RelayClientV2) 양쪽이 공유하는 스플릿 라우팅 로직.

```typescript
interface DirectRouter {
  addDirect(deviceId: number, ws: WebSocket): void
  removeDirect(deviceId: number): void
  hasDirect(deviceId: number): boolean

  splitTargets(msg: Message): {
    directTargets: Map<number, WebSocket>
    relayMessage: Message | null  // to에서 direct 대상 제거, exclude 추가
  }
}
```

`splitTargets` 동작:
- `to: [P1, P2]` → P1은 directTargets, relayMessage는 `to: [P2]`
- `broadcast: 'all'` → 직접 연결 대상은 directTargets, relayMessage는 `broadcast: 'all', exclude: [직접 대상들]`
- 직접 대상이 전부면 relayMessage는 null (Relay에 안 보냄)

### Message 타입 확장 (core/src/types/message.ts)

```typescript
interface Message<T = unknown> {
  type: string;
  payload: T;
  timestamp: number;
  from?: DeviceId | null;
  to?: number[] | null;
  broadcast?: string;
  exclude?: number[];     // 추가: Relay가 이 deviceId들에는 보내지 않음
  requestId?: string | null;
}
```

## Relay 변경 (router.ts)

`exclude` 필드 처리 추가. targetClientIds에서 exclude에 있는 deviceId를 제거.

변경 최소화 — exclude 필터링 한 줄 추가 수준.

## Pylon 변경

### DirectServer (pylon/src/network/direct-server.ts)

`directPort`가 설정되어 있으면 시작되는 WS 서버.

- 접속 시 IP가 private range(192.168.x.x, 10.x.x.x, 127.x.x.x)인지 체크
- 통과하면 핸드셰이크: P1이 `{ type: 'direct_auth', pylonIndex, deviceId }` 전송
- 이후 일반 메시지 교환
- heartbeat/ping 없음 (로컬 네트워크이므로 불필요)
- 끊기면 DirectRouter에서 해당 deviceId 제거

### RelayClientV2 (pylon/src/network/relay-client-v2.ts)

기존 RelayClient를 대체. DirectRouter를 내장.

```
send(msg):
  → DirectRouter.splitTargets(msg)
  → directTargets에 있는 대상은 직접 WS로 전송
  → relayMessage가 있으면 기존 Relay 연결로 전송
```

`directPort` 미설정 시 DirectRouter에 직접 연결이 없으므로 기존 RelayClient와 동일 동작.

### bin.ts 변경

`directPort` 설정 읽기 → DirectServer 시작 → RelayClientV2에 DirectRouter 연결.

## Client 변경

### RelayServiceV2 (client/src/services/relayServiceV2.ts)

기존 RelayService를 대체. DirectRouter를 내장.

```
시작:
  1. R2에 접속 (기존대로)
  2. URL에 ?direct=ws://... 있으면:
     → 해당 주소로 WS 접속 시도
     → 성공 → 핸드셰이크에서 pylonIndex/deviceId 수신
     → DirectRouter에 등록
     → 실패 → R2만 사용 (로그만 남김)

send(msg):
  → DirectRouter.splitTargets(msg)
  → directTargets 있으면 직접 전송
  → relayMessage 있으면 R2로 전송

receive:
  → direct WS에서 온 메시지 + R2에서 온 메시지 → 동일한 메시지 핸들러로 전달
```

### Fallback

- 직접 연결 실패 → R2만 사용 (기존 동작)
- 직접 연결 중간에 끊김 → DirectRouter에서 제거 → 해당 Pylon 메시지는 자동으로 R2 경유
- 옵션: 주기적 재접속 시도

## 데이터 흐름 예시

### C1 → P1 메시지 (직접 연결 있음)

```
C1: send({ type: 'claude_send', to: [P1_id] })
→ splitTargets: P1이 direct에 있음
→ directWs.send(msg) → P1 직접 수신
→ relayMessage: null (Relay에 안 보냄)
```

### C1 broadcast (P1 직접 + P2 Relay)

```
C1: send({ broadcast: 'pylons' })
→ splitTargets: P1이 direct에 있음
→ directWs.send(msg) → P1 직접 수신
→ relayMessage: { broadcast: 'pylons', exclude: [P1_id] } → R2 → P2
```

### P1 응답 (C1 직접 + Cm Relay)

```
P1: send({ broadcast: 'clients' })
→ splitTargets: C1이 direct에 있음
→ directWs.send(msg) → C1 직접 수신
→ relayMessage: { broadcast: 'clients', exclude: [C1_id] } → R2 → Cm
```

## 컴포넌트별 변경 요약

| 패키지 | 파일 | 변경 |
|--------|------|------|
| core | `network/direct-router.ts` | 새 파일. 스플릿 라우팅 로직 |
| core | `types/message.ts` | `exclude?: number[]` 필드 추가 |
| relay | `router.ts` | targetClientIds에서 exclude 제거 |
| pylon | `network/direct-server.ts` | 새 파일. 직접 연결 WS 서버 |
| pylon | `network/relay-client-v2.ts` | 새 파일. DirectRouter 내장 RelayClient |
| pylon | `bin.ts` | directPort 읽기, DirectServer 시작 |
| client | `services/relayServiceV2.ts` | 새 파일. DirectRouter 내장 RelayService |
| client | URL 파라미터 파싱 | `?direct=ws://...` 처리 |

## 기존 동작 영향

- `directPort` 미설정 + `?direct` 미사용 → 기존과 완전 동일
- 모든 변경은 옵트인. 설정하지 않으면 아무 영향 없음
