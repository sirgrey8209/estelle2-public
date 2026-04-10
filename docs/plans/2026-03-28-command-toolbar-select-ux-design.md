# Command Toolbar Select UX

## 목적

커맨드 툴바를 컴팩트하게 변경. 평소에는 아이콘만 표시하고, 선택 후 실행하는 2단계 인터랙션으로 오작동 방지.

## 상태 모델

- `selectedId`: `number | 'add' | null` — 동시에 하나만 선택 가능
- `longPressProgress`: `number` (0~1) — 롱프레스 게이지 애니메이션용

## 버튼 외형

| 상태 | 일반 버튼 | 추가 버튼 |
|------|----------|----------|
| 비선택 | 아이콘만 | + 아이콘만 |
| 선택됨 | 아이콘 + 이름 + 아웃라인 | + 아이콘 + "커맨드 추가" + 아웃라인 |
| 롱프레스 중 | 선택 상태 + 게이지 채워짐 | 해당 없음 |

## 인터랙션

| 동작 | 비선택 버튼 | 선택된 버튼 | 추가 버튼 |
|------|-----------|-----------|----------|
| 클릭 | 선택 (다른 건 해제) | 실행 | 선택 / 생성 대화 |
| 롱프레스 | 무시 | 게이지 표시 → 완료 시 편집 | 없음 |
| 바깥 클릭 | — | 선택 해제 | 선택 해제 |

## 롱프레스 게이지

- 선택된 일반 버튼에서만 동작
- 500ms 동안 게이지 0→100% 채워짐
- 도중에 손 떼면 게이지 리셋, 실행 안 함
- 완료 시 편집 세션(commandManageConversation) 열림
- 구현: requestAnimationFrame으로 progress 업데이트, 버튼 배경 width% 방식

## 구현 범위

`CommandToolbar.tsx` 단일 파일 수정:
- `useState`로 `selectedId` 관리
- `useState` + `requestAnimationFrame`으로 `longPressProgress` 관리
- 클릭 핸들러: 선택/실행 분기
- 선택 버튼 아웃라인: `ring` 계열 클래스
- 바깥 클릭 감지: 툴바 `ref` + `useEffect`로 `mousedown` 리스너
