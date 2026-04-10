# Macro User Message & Execution Guard Design

## Summary

매크로 실행 시 입력창의 텍스트를 함께 전송하는 기능과, 응답 중 매크로 실행을 차단하는 기능.

## Requirements

1. 매크로 버튼 클릭 시 입력창 텍스트를 유저 메시지로 함께 전송
2. Claude 응답 중(`status === 'working'`)에는 매크로 실행 차단
3. 하위호환 유지 — userMessage가 없으면 기존 동작 그대로

## Design

### Feature 1: Macro + User Message

#### Message Format

userMessage가 있을 때 Claude에 전달되는 메시지:

```
[Macro: 매크로이름]
(매크로 content)

[User Message]
(유저 입력 텍스트)
```

userMessage가 없으면 기존처럼 `macro.content`만 전달.

#### Data Flow

```
MacroToolbar 클릭
  → InputBar에서 텍스트 가져오기 + 비우기
  → executeMacro(macroId, conversationId, userMessage?)
  → Pylon handleMacroExecute
    → macro.content + userMessage 합성
    → agentManager.sendMessage(합성 메시지)
    → messageStore에 userMessage 포함 저장
    → claude_event 브로드캐스트에 userMessage 포함
```

#### Changes by Layer

| Layer | File | Change |
|-------|------|--------|
| core types | `store-message.ts` | `MacroExecuteMessage`에 `userMessage?: string` 필드 추가 |
| client | `relaySender.ts` | `executeMacro`에 `userMessage` 파라미터 추가 |
| client | `MacroToolbar.tsx` | 실행 시 InputBar 텍스트 가져오기 + 전송 후 비우기 |
| client | `InputBar.tsx` | MacroToolbar에 `getText`/`clearText` 콜백 전달 |
| pylon | `pylon.ts` | `handleMacroExecute`에서 userMessage 수신 → 포맷 합성 |
| pylon | `message-store.ts` | `addMacroExecuteMessage`에 userMessage 파라미터 추가 |

#### Storage

`MacroExecuteMessage` 인터페이스에 `userMessage?: string` 추가. DB의 기존 content 컬럼에는 합성된 전체 텍스트, userMessage 필드에 원본 유저 메시지를 별도 보관하여 UI에서 분리 렌더링 가능.

### Feature 2: Macro Execution Guard

#### Changes

| Layer | File | Change |
|-------|------|--------|
| client | `InputBar.tsx` | MacroToolbar에 `disabled={isWorking}` 전달 |
| client | `MacroToolbar.tsx` | `disabled` prop 수신 → 버튼 비활성화 + 클릭 무시 |

#### UI Behavior

- `disabled=true` 시 매크로 버튼에 `opacity-50 pointer-events-none` 적용
- 클릭 이벤트 무시 (선택 및 실행 모두)
