# 설정창 계정 변경 라우팅 수정 및 Hub 링크 추가

## 개요

세팅창의 계정 변경 기능을 office Pylon 전용으로 변경하고, Hub 페이지로 이동하는 링크를 추가한다.

## 요구사항

1. **계정 변경 라우팅 수정**: 현재 모든 Pylon에게 브로드캐스트되는 계정 변경 요청을 office Pylon(pylonId = 1) 전용으로 변경
2. **Hub 링크 추가**: 계정 섹션 하단에 Hub 페이지(`http://YOUR_SERVER_IP:8080/hub`)를 외부 브라우저로 여는 버튼 추가

## 설계

### 1. 계정 변경 라우팅 수정

**파일**: `packages/client/src/services/relaySender.ts`

```typescript
// Before
export function requestAccountSwitch(account: AccountType): boolean {
  return sendMessage({
    type: MessageType.ACCOUNT_SWITCH,
    payload: { account },
    broadcast: 'pylons',
  });
}

// After
export function requestAccountSwitch(account: AccountType): boolean {
  return sendMessage({
    type: MessageType.ACCOUNT_SWITCH,
    payload: { account },
    to: [1],  // office Pylon 전용
  });
}
```

### 2. Hub 링크 버튼 추가

**파일**: `packages/client/src/components/settings/AccountSection.tsx`

계정 카드 하단(경고 메시지 아래)에 Hub 링크 버튼 추가:

```tsx
<Button
  variant="outline"
  size="sm"
  className="w-full mt-3"
  onClick={() => window.open('http://YOUR_SERVER_IP:8080/hub', '_blank')}
>
  🌐 Hub 열기
</Button>
```

## 변경 파일

| 파일 | 변경 내용 |
|------|----------|
| `packages/client/src/services/relaySender.ts` | `broadcast: 'pylons'` → `to: [1]` |
| `packages/client/src/components/settings/AccountSection.tsx` | Hub 링크 버튼 추가 |

## 기술 결정

- **PWA 호환성**: Vite 웹 앱이므로 `window.open`으로 외부 링크 열기 가능 (Expo/React Native의 `Linking.openURL` 불필요)
- **pylonId 하드코딩**: office Pylon은 항상 pylonId = 1로 고정되어 있으므로 하드코딩 사용
