# 파일런 탭에서 워크스페이스 드래그 순서 변경

## 문제

파일런 탭에서 워크스페이스 순서를 드래그로 변경할 수 없음.

- 즐겨찾기 탭: 파일런 아이콘에 `dragHandleProps`가 연결되어 드래그 가능
- 파일런 탭: 별(Star) 버튼이 표시되지만 `dragHandleProps`가 연결되지 않아 드래그 불가

## 해결

`WorkspaceHeader` 컴포넌트에서 파일런 탭의 별 버튼에 `dragHandleProps`를 연결한다.

### 변경 파일

`packages/client/src/components/sidebar/WorkspaceSidebar.tsx` - `WorkspaceHeader` 컴포넌트

### 변경 내용

별 버튼(`showPylonIcon === false`)에 즐겨찾기 탭의 파일런 아이콘과 동일한 드래그 핸들 패턴 적용:

- `dragHandleProps.attributes` / `dragHandleProps.listeners` 연결
- `stopPropagation()`으로 부모의 롱프레스 이벤트와 충돌 방지
- `cursor-grab` / `active:cursor-grabbing` 시각적 힌트 추가

### UX 동작

| 제스처 | 동작 |
|--------|------|
| 별 클릭 (이동 없음) | 즐겨찾기 토글 |
| 별에서 8px 이상 드래그 | 워크스페이스 순서 변경 |
| 헤더 영역 롱프레스 | 워크스페이스 편집 다이얼로그 |

`PointerSensor`의 `distance: 8` 제약으로 클릭과 드래그가 자연스럽게 구분됨.
