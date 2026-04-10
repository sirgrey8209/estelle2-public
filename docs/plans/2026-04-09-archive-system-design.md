# Archive System Design

## Overview

에스텔 클라우드 서버에 문서 저장소(Archive)를 두고, 연결된 두 PC에서 MCP 도구와 웹 UI를 통해 접근하는 시스템.

## 배경

- 클라우드 허브(Hetzner)에 두 대의 사무실 PC가 연결되어 있음
- PC 간 자료 공유가 필요하나, 현재 파일 공유 체계가 없음
- 클라우드를 단일 소스로 두고 문서를 중앙 관리하고자 함

## 요구사항

- 마크다운 중심, 이미지/zip 등 바이너리도 지원
- MCP 도구로 읽기/쓰기/검색 가능
- 웹 UI에서 열람 가능 (허브 UI 통합)
- 쓰기는 MCP를 통해서만 (에스텔 대화를 통한 간접 업로드)

## 설계

### 1. 저장소

- 경로: `/home/estelle/archive/`
- 디렉토리 기반 분류 (자유 생성 가능)
- 파일 종류 제한 없음 (md, 이미지, zip 등)
- 별도 인덱스/DB 없이 파일시스템이 진실의 원천

### 2. HTTP API

클라우드 서버에서 동작하는 아카이브 전용 HTTP 서버. 원격 Pylon의 MCP 도구와 웹 UI가 모두 이 API를 사용한다.

| 엔드포인트 | 메서드 | 설명 |
|-----------|--------|------|
| `/archive/list` | GET | 디렉토리 트리 조회. `path` (기본 `/`), `depth` (기본 1, 최대 3) |
| `/archive/read` | GET | 파일 내용 반환. 텍스트는 UTF-8, 바이너리는 원본 |
| `/archive/write` | POST | 파일 생성/수정. body에 내용, 중간 디렉토리 자동 생성 |
| `/archive/glob` | GET | 파일명 패턴 검색. `pattern` 파라미터 |
| `/archive/grep` | GET | 텍스트 내용 검색. `query`, `path`(선택) 파라미터 |

- 모든 경로는 `/home/estelle/archive/` 기준 상대경로
- path traversal 차단 (`..` 등 상위 디렉토리 탈출 방지)

### 3. MCP 도구

기존 `estelle-mcp`에 5개 도구 추가. 로컬/원격에 따라 구현이 분기된다.

| 도구 | 설명 | 로컬 Pylon | 원격 Pylon |
|------|------|-----------|-----------|
| `archive_write` | 파일 생성/수정 | fs 직접 쓰기 | HTTP POST |
| `archive_read` | 파일 읽기 | fs 직접 읽기 | HTTP GET |
| `archive_list` | 디렉토리 조회 (depth 제한) | fs readdir | HTTP GET |
| `archive_glob` | 파일명 패턴 검색 | glob 라이브러리 | HTTP GET |
| `archive_grep` | 내용 텍스트 검색 | grep/ripgrep | HTTP GET |

- 로컬 여부 판별: 환경변수 또는 config에서 master/slave 구분
- 모든 경로는 archive 루트 기준 상대경로, 상위 탈출 차단

### 4. 허브 UI 통합

별도 웹앱이 아닌, 기존 허브 UI 내에 통합한다.

**진입:**
- `AppHeader`에 아카이브 버튼 추가 (기존 프로젝트/설정 버튼 옆)
- 클릭 시 `ChatArea` 대신 `ArchiveViewer` 컴포넌트로 전환

**ArchiveViewer 컴포넌트 (VSCode 느낌):**
- 좌측 패널: 디렉토리 트리 (펼치기/접기)
- 우측 메인: 파일 내용 표시
  - `.md` → 마크다운 렌더링
  - 이미지 → 미리보기
  - 기타 → 다운로드 링크 + 파일 정보 (크기, 수정일 등)
- 데이터 소스: HTTP API 직접 호출

## 기존 시스템과의 관계

- `link_doc` / `list_docs` / `unlink_doc`: 기존 그대로 유지, 별도 시스템
- BLOB 프로토콜: 건드리지 않음
- Relay/Pylon 통신: 변경 없음
