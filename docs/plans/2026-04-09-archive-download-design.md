# Archive 다운로드 기능 설계

## 목표

아카이브 뷰어에서 모든 파일과 폴더를 다운로드할 수 있게 한다.

## 현재 상태

- 뷰어에서 렌더링 못 하는 파일(PDF, ZIP 등)에만 다운로드 버튼 존재
- 마크다운, 텍스트, 이미지는 다운로드 수단 없음
- 폴더는 트리에서 펼치기/접기만 가능, 선택 불가
- 서버에 zip 생성 엔드포인트 없음

## 설계

### 1. 서버: `GET /archive/download` 엔드포인트

`archiver` 라이브러리 의존성 추가.

- **파일**: `Content-Disposition: attachment; filename="파일명"` 헤더와 함께 raw bytes 응답
- **폴더**: `archiver`로 zip 스트리밍 생성, `Content-Disposition: attachment; filename="폴더명.zip"` 응답
- 파일/폴더 구분은 서버에서 `stat`으로 판단
- 기존 `resolveSafe` 경로 검증 재사용

### 2. 클라이언트: 모든 파일에 다운로드 버튼

파일 경로 바(상단 바)에 다운로드 아이콘 버튼 추가.

- 어떤 파일 타입이든 항상 표시 (마크다운, 이미지, 텍스트 포함)
- `/archive/download?path=...` URL로 `<a download>` 연결
- 기존 `FileInfoRenderer`의 다운로드 버튼은 제거 (상단 바로 통합)

### 3. 클라이언트: 폴더 선택 + 폴더 뷰

**스토어 변경 (`archiveStore.ts`)**
- `selectedType: 'file' | 'directory' | null` 필드 추가

**트리 동작 변경 (`ArchiveTree.tsx`)**
- 폴더 클릭 → 콘텐츠 영역에 폴더 뷰 표시 + 펼치기/접기도 동시에

**폴더 뷰 (`ArchiveContent.tsx`에 `FolderRenderer` 추가)**
- 폴더 아이콘 + 경로
- 요약: 파일 N개 · 폴더 N개 · 총 크기
- ZIP 다운로드 버튼
- 파일/폴더 개수와 크기는 `list` API 응답 데이터로 계산

### 4. API 클라이언트 (`archiveApi.ts`)

- `archiveDownloadUrl(path: string): string` 헬퍼 추가
- `/archive/download?path=...` URL 생성

## 변경 파일 요약

| 파일 | 변경 |
|------|------|
| `packages/archive/package.json` | `archiver` 의존성 추가 |
| `packages/archive/src/archive-service.ts` | `download` 메서드 (stat → 파일/폴더 분기) |
| `packages/archive/src/server.ts` | `/archive/download` 라우트 추가 |
| `packages/client/src/services/archiveApi.ts` | `archiveDownloadUrl` 헬퍼 |
| `packages/client/src/stores/archiveStore.ts` | `selectedType` 필드 추가 |
| `packages/client/src/components/archive/ArchiveTree.tsx` | 폴더 클릭 시 선택 + 펼치기 |
| `packages/client/src/components/archive/ArchiveContent.tsx` | 상단 바 다운로드 버튼, `FolderRenderer` 추가, `FileInfoRenderer` 다운로드 제거 |
