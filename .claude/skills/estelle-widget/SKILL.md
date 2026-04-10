---
name: estelle-widget
description: Use when building interactive widgets with run_widget or run_widget_inline MCP tools, implementing widget CLI protocols, or troubleshooting widget rendering issues in Estelle
---

# Estelle Widget Protocol

## Overview

Widget Protocol은 Claude를 거치지 않고 복잡한 유저 인터랙션을 처리하는 프레임워크.

**두 가지 방식:**
1. `run_widget` - CLI 프로세스 기반 (게임, 복잡한 로직)
2. `run_widget_inline` - CLI 없이 HTML+JS 직접 실행 (간단한 UI)

---

## 디자인 제약

**위젯 크기:**
- 가로: 340px 고정
- 세로: 자유 (위젯에서 필요한 대로)

- 모든 위젯은 340px 가로폭 기준으로 디자인해야 함
- 모바일/데스크톱 모두 동일한 폭 적용

---

## run_widget_inline (권장)

CLI 프로세스 없이 HTML과 JS를 직접 Client에서 실행. 간단한 인터랙션에 적합.

### 사용법

```typescript
mcp__estelle-mcp__run_widget_inline({
  html: "<div id='app'>Hello</div>",  // HTML 템플릿 (필수)
  code: "/* JS 코드 */",               // JavaScript (선택)
  height: 200                          // 초기 높이 픽셀 (선택)
})
```

### JS에서 사용 가능한 API

`api` 객체가 주입됨:

```javascript
// 이벤트 전송 (Pylon으로)
api.sendEvent({ type: 'user_action', value: 42 });

// 위젯 종료 (cancel 이벤트)
api.sendEvent({ type: 'cancel' });

// 에셋 URL (run_widget에서만 사용)
api.getAssetUrl('image1');

// 버블 컨텍스트
api.bubble.getSize();
api.bubble.requestHeight(300);

// 입력 이벤트
api.input.onKey((e) => { /* 키보드 */ });
api.input.onTouch((e) => { /* 터치 */ });

// cleanup 함수 반환 (선택)
return () => { /* 정리 로직 */ };
```

### 예시: 클릭 카운터

```typescript
mcp__estelle-mcp__run_widget_inline({
  html: `
    <div style="padding: 20px; font-family: sans-serif;">
      <h3>클릭 테스트</h3>
      <button id="btn" style="padding: 10px 20px;">클릭!</button>
      <p id="count">클릭: 0</p>
    </div>
  `,
  code: `
    let count = 0;
    document.getElementById('btn').onclick = () => {
      count++;
      document.getElementById('count').textContent = '클릭: ' + count;

      // 10번 클릭하면 자동 종료
      if (count >= 10) {
        api.sendEvent({ type: 'cancel' });
      }
    };
  `,
  height: 150
})
```

### 위젯 종료 방법

1. **X 버튼** - 유저가 위젯 헤더의 X 버튼 클릭
2. **코드에서 종료** - `api.sendEvent({ type: 'cancel' })`

---

## run_widget (CLI 기반)

CLI 프로세스와 Client 간 양방향 통신으로 복잡한 위젯 구현.

### Architecture

```
Claude ──MCP──▶ Pylon ──spawn──▶ CLI (위젯 프로젝트)
                  │                 │
                  │◀── stdout ──────┤ (JSON Lines)
                  │──── stdin ─────▶│
                  │
                  │◀── WebSocket ──▶ Client (Browser)
                                      │
                                      ├── JS 코드 실행
                                      ├── 렌더링/게임루프
                                      └── 유저 입력 처리
```

### 사용법

```typescript
mcp__estelle-mcp__run_widget({
  command: "pnpm dev",      // 실행할 CLI 명령어
  cwd: "/path/to/widget",   // 위젯 프로젝트 절대 경로
  args: ["--option"]        // CLI 인자 (선택)
})
```

### Widget Ownership Model (v0306_4+)

여러 클라이언트가 동일 대화에 접속해 있을 때, 위젯 이벤트 중복을 방지하기 위한 소유권 모델.

**핵심 개념:**
- **소유자(Owner)**: 위젯과 상호작용할 수 있는 유일한 클라이언트
- **핸드셰이크**: 위젯 시작 시 lastActiveClient에게 먼저 소유권 제안
- **Claim**: 다른 클라이언트가 "실행" 버튼 클릭 시 선착순 소유권 획득

**메시지 흐름:**

```
1. 위젯 시작
   Pylon ──widget_handshake──▶ lastActiveClient (3초 타임아웃)

2. 핸드셰이크 응답
   Client ──widget_handshake_ack──▶ Pylon
   - visible: true → 소유권 부여
   - visible: false / 타임아웃 → pending 상태

3. Pending 상태에서 Claim
   다른 Client ──widget_claim──▶ Pylon (선착순)
   Pylon ──widget_claimed──▶ 모든 Clients

4. 이벤트 필터링
   - widget_input, widget_cancel: 소유자만 처리
   - widget_complete, widget_error: 모든 클라이언트에 브로드캐스트

5. 소유자 연결 해제
   Pylon → 위젯 강제 종료 + widget_error 브로드캐스트
```

**관련 메시지 타입:**

| 메시지 | 방향 | 설명 |
|--------|------|------|
| `widget_handshake` | Pylon→Client | 소유권 제안 (타임아웃 포함) |
| `widget_handshake_ack` | Client→Pylon | 핸드셰이크 응답 |
| `widget_pending` | Pylon→Clients | 위젯이 pending 상태임을 알림 |
| `widget_claim` | Client→Pylon | 소유권 요청 |
| `widget_claimed` | Pylon→Clients | 소유권 확정 알림 |
| `widget_complete` | Pylon→Clients | 위젯 완료 (브로드캐스트) |
| `widget_error` | Pylon→Clients | 위젯 에러 (브로드캐스트) |

### CLI 메시지 프로토콜

| 방향 | 타입 | 설명 |
|------|------|------|
| CLI→Pylon | `render` | 뷰 렌더링 |
| CLI→Pylon | `event` | 클라이언트에 이벤트 전송 |
| CLI→Pylon | `complete` | 세션 완료 + 결과 반환 |
| CLI→Pylon | `error` | 에러 발생 |
| Pylon→CLI | `event` | 클라이언트 이벤트 |
| Pylon→CLI | `cancel` | 유저가 X 버튼 클릭 |

### render 메시지 (ScriptViewNode)

```json
{
  "type": "render",
  "view": {
    "type": "script",
    "code": "// 실행할 JS 코드",
    "html": "<div id='app'></div>",
    "assets": {
      "image1": "./assets/image.png"
    },
    "height": 400
  }
}
```

### complete 메시지

```json
{
  "type": "complete",
  "result": { "status": "success", "data": {...} }
}
```

### CLI 예시 (TypeScript)

```typescript
import * as readline from 'readline';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

function render(view: object) {
  console.log(JSON.stringify({ type: 'render', view }));
}

function complete(result: unknown) {
  console.log(JSON.stringify({ type: 'complete', result }));
  process.exit(0);
}

rl.on('line', (line) => {
  const msg = JSON.parse(line);
  if (msg.type === 'event') {
    // 클라이언트 이벤트 처리
  } else if (msg.type === 'cancel') {
    process.exit(0);
  }
});

render({
  type: 'script',
  code: `api.sendEvent({ type: 'ready' });`,
  html: '<div>Hello Widget!</div>'
});
```

---

## 디버깅 체크리스트

### 공통

1. **위젯이 렌더링 안 됨**
   - Pylon 로그: `pm2 logs estelle-pylon | grep -i widget`
   - `_handleRunWidget` 또는 `_handleRunWidgetInline` 로그 확인

2. **X 버튼 안 됨**
   - `deps.mcpServer` 주입 확인 (bin.ts)
   - `cancelWidgetBySessionId` 로그 확인

3. **이벤트 안 전달됨**
   - Relay 로그: `pm2 logs estelle-relay | grep widget_event`
   - sessionId 일치 확인

### run_widget_inline 전용

1. **JS 에러**
   - 브라우저 콘솔에서 에러 확인
   - `api` 객체 사용 확인 (widget 아님!)

### run_widget 전용

1. **CLI 출력 파싱 실패**
   - JSON Lines 형식 확인 (한 줄에 하나의 JSON)

2. **에셋 로딩 실패**
   - 경로가 cwd 기준 상대경로인지 확인
   - `api.getAssetUrl()` 사용 확인

---

## 관련 파일

| 파일 | 역할 |
|------|------|
| `packages/core/src/types/widget.ts` | 타입 정의 (소유권 Payload 포함) |
| `packages/core/src/constants/message-type.ts` | 메시지 타입 상수 |
| `packages/pylon/src/mcp/tools/run-widget.ts` | run_widget MCP 도구 |
| `packages/pylon/src/mcp/tools/run-widget-inline.ts` | run_widget_inline MCP 도구 |
| `packages/pylon/src/managers/widget-manager.ts` | CLI 세션 관리 + 소유권 로직 |
| `packages/pylon/src/servers/pylon-mcp-server.ts` | MCP 핸들러 |
| `packages/pylon/src/pylon.ts` | 핸드셰이크/Claim 핸들러 |
| `packages/client/src/components/widget/` | Client 렌더러 |

---

## 보유 위젯

### quiver (이미지 생성)

AI 이미지 생성 위젯 (Hugging Face FLUX.1-schnell)

**호출 방법:**
```typescript
mcp__estelle-mcp__run_widget({
  command: "node",
  args: ["dist/index.js", "프롬프트"],
  cwd: "<워크스페이스 경로 - 유저 환경에 맞게 설정>/widget/quiver"
})
```

**기능:**
- 텍스트 프롬프트로 이미지 생성
- 자동 파일 저장 (`uploads/images/hf-{timestamp}.png`)
- 위젯 UI로 추가 이미지 생성 가능

**필요 환경변수:**
- `HF_TOKEN`: Hugging Face API 토큰 (https://huggingface.co/settings/tokens)

**가격:**
- 월 $0.10 무료 크레딧
- 이미지당 약 $0.0012 (FLUX.1-schnell 기준)
