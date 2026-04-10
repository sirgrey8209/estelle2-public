# 교육 공공데이터 뷰어 설계

## 목적

제8회 교육 공공데이터 AI활용대회 참가를 위해, 활용 가능한 교육 공공데이터를 한 곳에서 탐색할 수 있는 데이터 뷰어를 만든다. 모든 주요 데이터 소스를 통합하여 데이터셋 목록을 보고, 각 데이터셋의 실제 데이터를 TOP 100 테이블로 미리 볼 수 있어야 한다.

## 아키텍처

### 프로젝트 정보

- 경로: `/home/estelle/edu-data-viewer`
- 기술 스택: Vite + React + TypeScript + Tailwind CSS (프론트), Fastify (백엔드)
- 포트: 3008
- URL: `https://estelle-hub.mooo.com/edu-data-viewer/`
- 서빙: PM2 + Caddy 리버스 프록시

### 왜 동적 서버가 필요한가

- 공공데이터 API들은 CORS를 허용하지 않으므로 서버에서 프록시해야 함
- API 키를 서버에서 관리해야 함
- CSV/SHP 등 정적 데이터 파일 서빙 필요

### 디렉토리 구조

```
edu-data-viewer/
├── client/                  # React 프론트엔드
│   ├── src/
│   │   ├── components/
│   │   │   ├── App.tsx
│   │   │   ├── Sidebar.tsx        # 소스 필터 사이드바
│   │   │   ├── DatasetList.tsx    # 데이터셋 카드 목록
│   │   │   ├── DatasetCard.tsx    # 개별 데이터셋 카드
│   │   │   ├── DataPreview.tsx    # TOP 100 테이블 미리보기
│   │   │   ├── SearchBar.tsx      # 통합 검색
│   │   │   └── Pagination.tsx     # 페이지네이션
│   │   ├── hooks/
│   │   │   ├── useDatasets.ts     # 데이터셋 목록 fetch
│   │   │   └── usePreview.ts      # 데이터 미리보기 fetch
│   │   ├── types/
│   │   │   └── index.ts           # 공통 타입
│   │   └── main.tsx
│   └── index.html
├── server/
│   ├── index.ts                   # Fastify 서버 엔트리
│   ├── config.ts                  # API 키 등 설정
│   └── sources/                   # 소스별 라우트
│       ├── data-go-kr.ts          # 공공데이터포털 프록시
│       ├── neis.ts                # 나이스 API 프록시
│       ├── schoolinfo.ts          # 학교알리미 프록시
│       ├── academyinfo.ts         # 대학알리미 프록시
│       ├── childinfo.ts           # 어린이집/유치원 프록시
│       └── static-files.ts        # CSV/SHP 정적 파일 서빙
├── static-data/                   # 다운로드한 정적 데이터
│   ├── kess/                      # 교육통계 CSV
│   └── schoolzone/                # 학구도 CSV/SHP
├── package.json
├── tsconfig.json
├── vite.config.ts
└── ecosystem.config.cjs           # PM2 설정
```

## 데이터 소스 통합

### 통합 데이터셋 타입

```typescript
interface Dataset {
  id: string
  source: Source
  name: string
  description: string
  type: 'api' | 'file' | 'info-only'
  format?: string           // JSON, XML, CSV, SHP 등
  keywords?: string[]
  organization?: string     // 제공 기관
  previewEndpoint?: string  // 서버의 미리보기 API 경로
}

type Source =
  | 'data-go-kr'
  | 'neis'
  | 'schoolinfo'
  | 'kess'
  | 'academyinfo'
  | 'schoolzone'
  | 'childinfo'
  | 'krivet'
  | 'edmgr'
```

### 소스별 처리 방식

| 소스 | 목록 조회 | 데이터 미리보기 (TOP 100) |
|------|---------|----------------------|
| data.go.kr | 카탈로그 API로 실시간 조회 | 개별 API 호출 or 파일 다운로드 |
| open.neis.go.kr | 24개 API 목록 하드코딩 | API 호출로 샘플 데이터 표시 |
| schoolinfo.go.kr | API 목록 하드코딩 | API 호출로 샘플 데이터 표시 |
| kess.kedi.re.kr | CSV 파일 목록 하드코딩 | 다운로드한 CSV 파싱 후 표시 |
| academyinfo.go.kr | data.go.kr 경유 | API 호출로 샘플 데이터 표시 |
| schoolzone.emac.kr | 파일 목록 하드코딩 | CSV 파싱 후 표시 |
| childinfo.go.kr | API 목록 하드코딩 | API 호출로 샘플 데이터 표시 |
| krivet.re.kr | 메타정보 하드코딩 | 승인 필요 - 미리보기 불가 표시 |
| edmgr.kr | 메타정보 하드코딩 | 신청 필요 - 미리보기 불가 표시 |

## UI 설계

### 레이아웃

```
┌──────────────────────────────────────────────────┐
│  교육 공공데이터 뷰어              [검색 입력창]    │
├───────────┬──────────────────────────────────────┤
│           │                                      │
│ 소스 필터  │  데이터셋 목록 (카드)                  │
│           │                                      │
│ □ 전체    │  클릭 시 → 하단에 TOP 100 테이블 확장   │
│ □ data.   │                                      │
│   go.kr   │                                      │
│ □ NEIS    │                                      │
│ □ 학교    │                                      │
│   알리미   │                                      │
│ □ 교육통계 │                                      │
│ □ 대학    │                                      │
│   알리미   │                                      │
│ □ 학구도  │                                      │
│ □ 어린이집 │                                      │
│           │                                      │
│ 타입 필터  │                                      │
│ □ API     │                                      │
│ □ 파일    │                                      │
│ □ 기타    │                                      │
├───────────┴──────────────────────────────────────┤
│  총 N개 데이터셋                                   │
└──────────────────────────────────────────────────┘
```

### 데이터 미리보기 (TOP 100 테이블)

데이터셋 카드를 클릭하면 카드 아래에 테이블이 확장됨:
- API: 서버가 해당 API를 호출하여 최대 100건 반환
- CSV: 서버가 파일을 파싱하여 첫 100행 반환
- info-only: "이 데이터는 직접 신청이 필요합니다" 안내 표시

테이블은 가로 스크롤 가능, 컬럼 헤더 표시.

## 서버 API 설계

### 엔드포인트

```
GET /api/datasets                    # 전체 데이터셋 목록
    ?source=neis                     # 소스 필터
    ?type=api                        # 타입 필터
    ?q=급식                           # 검색어
    ?page=1&limit=20                 # 페이지네이션

GET /api/preview/:source/:datasetId  # 데이터 미리보기 (TOP 100)
```

### API 키 관리

`.env` 파일에서 관리:
```
DATA_GO_KR_API_KEY=...
NEIS_API_KEY=...
SCHOOLINFO_API_KEY=...
```
