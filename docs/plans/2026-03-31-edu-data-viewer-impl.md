# 교육 공공데이터 뷰어 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 교육 공공데이터를 한 곳에서 탐색하고, 각 데이터셋의 실제 데이터를 TOP 100 테이블로 미리 볼 수 있는 웹 애플리케이션을 만든다.

**Architecture:** Fastify 백엔드가 공공데이터 API들을 프록시하고 CSV 파일을 서빙한다. React 프론트엔드가 통합된 UI로 데이터셋 목록과 미리보기를 표시한다. Estelle Hub에 등록하여 Caddy 리버스 프록시를 통해 HTTPS로 서빙한다.

**Tech Stack:** Vite + React + TypeScript + Tailwind CSS (프론트), Fastify + tsx (백엔드), PM2 (프로세스 관리), Caddy (리버스 프록시)

---

## Phase 1: 프로젝트 스캐폴딩

### Task 1: 프로젝트 초기화

**Files:**
- Create: `/home/estelle/edu-data-viewer/package.json`
- Create: `/home/estelle/edu-data-viewer/tsconfig.json`
- Create: `/home/estelle/edu-data-viewer/tsconfig.server.json`
- Create: `/home/estelle/edu-data-viewer/vite.config.ts`
- Create: `/home/estelle/edu-data-viewer/.env`
- Create: `/home/estelle/edu-data-viewer/.gitignore`

**Step 1: 디렉토리 생성 및 npm init**

```bash
mkdir -p /home/estelle/edu-data-viewer
cd /home/estelle/edu-data-viewer
npm init -y
```

**Step 2: 의존성 설치**

```bash
cd /home/estelle/edu-data-viewer
npm install fastify @fastify/static @fastify/cors dotenv csv-parse
npm install -D vite @vitejs/plugin-react typescript tsx tailwindcss @tailwindcss/vite @types/node
npm install react react-dom
npm install -D @types/react @types/react-dom
```

**Step 3: tsconfig.json 작성**

`tsconfig.json` (클라이언트용):
```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": ".",
    "baseUrl": ".",
    "paths": {
      "@/*": ["client/src/*"]
    }
  },
  "include": ["client/src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

`tsconfig.server.json` (서버용):
```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist/server",
    "rootDir": "server"
  },
  "include": ["server/**/*"],
  "exclude": ["node_modules"]
}
```

**Step 4: vite.config.ts 작성**

```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  root: 'client',
  base: '/edu-data-viewer/',
  resolve: {
    alias: { '@': path.resolve(__dirname, 'client/src') }
  },
  build: {
    outDir: '../dist/client',
    emptyOutDir: true
  },
  server: {
    proxy: {
      '/edu-data-viewer/api': {
        target: 'http://localhost:3008',
        rewrite: (path) => path.replace(/^\/edu-data-viewer/, '')
      }
    }
  }
})
```

**Step 5: .env 파일 작성**

```
DATA_GO_KR_API_KEY=data-portal-test-key
NEIS_API_KEY=
PORT=3008
```

**Step 6: .gitignore 작성**

```
node_modules/
dist/
.env
static-data/
```

**Step 7: package.json scripts 추가**

```json
{
  "type": "module",
  "scripts": {
    "dev:client": "vite --config vite.config.ts",
    "dev:server": "tsx watch server/index.ts",
    "build:client": "vite build --config vite.config.ts",
    "build": "npm run build:client",
    "start": "tsx server/index.ts"
  }
}
```

**Step 8: Commit**

```bash
cd /home/estelle/edu-data-viewer && git init
git add -A && git commit -m "chore: initial project scaffolding"
```

---

## Phase 2: 백엔드 서버

### Task 2: Fastify 서버 기본 구조

**Files:**
- Create: `server/index.ts`
- Create: `server/config.ts`

**Step 1: config.ts 작성**

```typescript
import dotenv from 'dotenv'
dotenv.config()

export const config = {
  port: parseInt(process.env.PORT || '3008'),
  basePath: '/edu-data-viewer',
  dataGoKr: {
    apiKey: process.env.DATA_GO_KR_API_KEY || 'data-portal-test-key',
    catalogBase: 'https://api.odcloud.kr/api/15077093/v1'
  },
  neis: {
    apiKey: process.env.NEIS_API_KEY || '',
    base: 'https://open.neis.go.kr/hub'
  }
}
```

**Step 2: server/index.ts 작성**

기본 Fastify 서버 + 정적 파일 서빙:

```typescript
import Fastify from 'fastify'
import fastifyStatic from '@fastify/static'
import fastifyCors from '@fastify/cors'
import path from 'path'
import { fileURLToPath } from 'url'
import { config } from './config.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const app = Fastify({ logger: true })

await app.register(fastifyCors)

// API routes will be registered here

// Static client files
await app.register(fastifyStatic, {
  root: path.join(__dirname, '..', 'dist', 'client'),
  prefix: config.basePath + '/',
  decorateReply: false
})

// SPA fallback
app.setNotFoundHandler((req, reply) => {
  if (req.url.startsWith(config.basePath) && !req.url.includes('/api/')) {
    return reply.sendFile('index.html', path.join(__dirname, '..', 'dist', 'client'))
  }
  reply.code(404).send({ error: 'Not found' })
})

await app.listen({ port: config.port, host: '0.0.0.0' })
console.log(`Server running on http://0.0.0.0:${config.port}`)
```

**Step 3: 서버 실행 확인**

```bash
cd /home/estelle/edu-data-viewer
mkdir -p dist/client && echo "<h1>test</h1>" > dist/client/index.html
npx tsx server/index.ts
# 다른 터미널에서: curl http://localhost:3008/edu-data-viewer/
```

**Step 4: Commit**

```bash
git add server/ && git commit -m "feat: fastify server with static file serving"
```

### Task 3: data.go.kr 카탈로그 API 프록시

**Files:**
- Create: `server/sources/data-go-kr.ts`
- Modify: `server/index.ts` (라우트 등록)

**Step 1: data-go-kr.ts 작성**

```typescript
import { FastifyInstance } from 'fastify'
import { config } from '../config.js'

const CATALOG_BASE = config.dataGoKr.catalogBase
const API_KEY = config.dataGoKr.apiKey

// 교육부 + 산하기관 목록 (PDF 붙임 참조)
const EDU_ORGANIZATIONS = [
  '교육부',
  '서울특별시교육청', '경기도교육청', '인천광역시교육청',
  '강원특별자치도교육청', '충청북도교육청', '충청남도교육청',
  '대전광역시교육청', '세종특별자치시교육청', '경상북도교육청',
  '경상남도교육청', '대구광역시교육청', '울산광역시교육청',
  '부산광역시교육청', '전북특별자치도교육청', '전라남도교육청',
  '광주광역시교육청', '제주특별자치도교육청',
  '국사편찬위원회', '국립특수교육원', '교원소청심사위원회',
  '학술원사무국', '중앙교육연수원', '국립국제교육원',
  '한국교직원공제회', '한국대학교육협의회', '한국사학진흥재단',
  '한국연구재단', '한국학중앙연구원', '한국장학재단',
  '국가평생교육진흥원', '한국전문대학교육협의회', '동북아역사재단',
  '사립학교교직원연금공단', '유네스코한국위원회', '한국고전번역원',
  '한국교육학술정보원', '한국과학창의재단', '한국교육개발원'
]

export async function registerDataGoKr(app: FastifyInstance) {
  // 데이터셋 목록 (통합)
  app.get('/api/data-go-kr/datasets', async (req, reply) => {
    const { page = '1', perPage = '20', q, org } = req.query as Record<string, string>

    const params = new URLSearchParams({
      page,
      perPage,
      serviceKey: API_KEY,
      returnType: 'JSON'
    })

    if (q) params.append('cond[title::LIKE]', q)
    if (org) params.append('cond[org_nm::EQ]', org)

    const url = `${CATALOG_BASE}/dataset?${params}`
    const res = await fetch(url)
    const data = await res.json()
    return data
  })

  // 오픈API 목록
  app.get('/api/data-go-kr/open-apis', async (req, reply) => {
    const { page = '1', perPage = '20', q, org } = req.query as Record<string, string>

    const params = new URLSearchParams({
      page,
      perPage,
      serviceKey: API_KEY,
      returnType: 'JSON'
    })

    if (q) params.append('cond[list_title::LIKE]', q)
    if (org) params.append('cond[org_nm::EQ]', org)

    const url = `${CATALOG_BASE}/open-data-list?${params}`
    const res = await fetch(url)
    const data = await res.json()
    return data
  })

  // 파일데이터 목록
  app.get('/api/data-go-kr/file-data', async (req, reply) => {
    const { page = '1', perPage = '20', q, org } = req.query as Record<string, string>

    const params = new URLSearchParams({
      page,
      perPage,
      serviceKey: API_KEY,
      returnType: 'JSON'
    })

    if (q) params.append('cond[list_title::LIKE]', q)
    if (org) params.append('cond[org_nm::EQ]', org)

    const url = `${CATALOG_BASE}/file-data-list?${params}`
    const res = await fetch(url)
    const data = await res.json()
    return data
  })

  // 기관 목록 제공
  app.get('/api/data-go-kr/organizations', async () => {
    return { organizations: EDU_ORGANIZATIONS }
  })
}
```

**Step 2: server/index.ts에 라우트 등록 추가**

```typescript
import { registerDataGoKr } from './sources/data-go-kr.js'
// ... (기존 코드 후, static 등록 전에)
await registerDataGoKr(app)
```

**Step 3: 테스트 호출**

```bash
curl "http://localhost:3008/api/data-go-kr/datasets?perPage=3" | jq .
curl "http://localhost:3008/api/data-go-kr/organizations" | jq .
```

**Step 4: Commit**

```bash
git add server/ && git commit -m "feat: data.go.kr catalog API proxy"
```

### Task 4: NEIS API 프록시

**Files:**
- Create: `server/sources/neis.ts`
- Modify: `server/index.ts`

**Step 1: neis.ts 작성**

NEIS는 12개 엔드포인트가 고정이므로, 메타정보를 하드코딩하고 프록시도 제공:

```typescript
import { FastifyInstance } from 'fastify'
import { config } from '../config.js'

const NEIS_BASE = config.neis.base

export interface NeisEndpoint {
  id: string
  name: string
  endpoint: string
  description: string
  requiredParams: string[]
  optionalParams: string[]
  defaultParams?: Record<string, string>  // 미리보기용 기본 파라미터
}

export const NEIS_ENDPOINTS: NeisEndpoint[] = [
  {
    id: 'schoolInfo',
    name: '학교기본정보',
    endpoint: 'schoolInfo',
    description: '전국 초중고 학교 기본정보 (학교명, 소재지, 주소, 설립구분 등)',
    requiredParams: [],
    optionalParams: ['ATPT_OFCDC_SC_CODE', 'SD_SCHUL_CODE', 'SCHUL_NM', 'SCHUL_KND_SC_NM', 'LCTN_SC_NM', 'FOND_SC_NM'],
    defaultParams: { SCHUL_KND_SC_NM: '고등학교', LCTN_SC_NM: '서울특별시' }
  },
  {
    id: 'mealServiceDietInfo',
    name: '급식식단정보',
    endpoint: 'mealServiceDietInfo',
    description: '학교별 급식 식단 정보 (요리명, 원산지, 칼로리, 영양정보)',
    requiredParams: ['ATPT_OFCDC_SC_CODE', 'SD_SCHUL_CODE'],
    optionalParams: ['MMEAL_SC_CODE', 'MLSV_YMD', 'MLSV_FROM_YMD', 'MLSV_TO_YMD'],
    defaultParams: { ATPT_OFCDC_SC_CODE: 'B10', SD_SCHUL_CODE: '7010536' }
  },
  {
    id: 'SchoolSchedule',
    name: '학사일정',
    endpoint: 'SchoolSchedule',
    description: '학교 학사일정 (행사, 휴업일 등)',
    requiredParams: ['ATPT_OFCDC_SC_CODE', 'SD_SCHUL_CODE'],
    optionalParams: ['AA_YMD', 'AA_FROM_YMD', 'AA_TO_YMD'],
    defaultParams: { ATPT_OFCDC_SC_CODE: 'B10', SD_SCHUL_CODE: '7010536' }
  },
  {
    id: 'classInfo',
    name: '학급정보',
    endpoint: 'classInfo',
    description: '학교별 학급(반) 정보',
    requiredParams: ['ATPT_OFCDC_SC_CODE', 'SD_SCHUL_CODE'],
    optionalParams: ['AY', 'GRADE'],
    defaultParams: { ATPT_OFCDC_SC_CODE: 'B10', SD_SCHUL_CODE: '7010536' }
  },
  {
    id: 'schoolMajorinfo',
    name: '학교학과정보',
    endpoint: 'schoolMajorinfo',
    description: '고등학교/특수학교 학과 정보',
    requiredParams: ['ATPT_OFCDC_SC_CODE', 'SD_SCHUL_CODE'],
    optionalParams: ['DGHT_CRSE_SC_NM', 'ORD_SC_NM'],
    defaultParams: { ATPT_OFCDC_SC_CODE: 'B10', SD_SCHUL_CODE: '7010536' }
  },
  {
    id: 'schulAflcoinfo',
    name: '학교계열정보',
    endpoint: 'schulAflcoinfo',
    description: '고등학교 계열(인문, 자연 등) 정보',
    requiredParams: ['ATPT_OFCDC_SC_CODE', 'SD_SCHUL_CODE'],
    optionalParams: ['DGHT_CRSE_SC_NM'],
    defaultParams: { ATPT_OFCDC_SC_CODE: 'B10', SD_SCHUL_CODE: '7010536' }
  },
  {
    id: 'tiClrminfo',
    name: '시간표강의실정보',
    endpoint: 'tiClrminfo',
    description: '강의실별 시간표 정보',
    requiredParams: ['ATPT_OFCDC_SC_CODE', 'SD_SCHUL_CODE'],
    optionalParams: ['AY', 'GRADE', 'SEM'],
    defaultParams: { ATPT_OFCDC_SC_CODE: 'B10', SD_SCHUL_CODE: '7010536' }
  },
  {
    id: 'elsTimetable',
    name: '초등학교 시간표',
    endpoint: 'elsTimetable',
    description: '초등학교 학급별 시간표',
    requiredParams: ['ATPT_OFCDC_SC_CODE', 'SD_SCHUL_CODE'],
    optionalParams: ['AY', 'SEM', 'ALL_TI_YMD', 'GRADE', 'CLASS_NM', 'PERIO'],
    defaultParams: { ATPT_OFCDC_SC_CODE: 'B10', SD_SCHUL_CODE: '7011569' }
  },
  {
    id: 'misTimetable',
    name: '중학교 시간표',
    endpoint: 'misTimetable',
    description: '중학교 학급별 시간표',
    requiredParams: ['ATPT_OFCDC_SC_CODE', 'SD_SCHUL_CODE'],
    optionalParams: ['AY', 'SEM', 'ALL_TI_YMD', 'GRADE', 'CLASS_NM', 'PERIO'],
    defaultParams: { ATPT_OFCDC_SC_CODE: 'B10', SD_SCHUL_CODE: '7081317' }
  },
  {
    id: 'hisTimetable',
    name: '고등학교 시간표',
    endpoint: 'hisTimetable',
    description: '고등학교 학급별 시간표',
    requiredParams: ['ATPT_OFCDC_SC_CODE', 'SD_SCHUL_CODE'],
    optionalParams: ['AY', 'SEM', 'ALL_TI_YMD', 'GRADE', 'CLASS_NM', 'PERIO'],
    defaultParams: { ATPT_OFCDC_SC_CODE: 'B10', SD_SCHUL_CODE: '7010536' }
  },
  {
    id: 'spsTimetable',
    name: '특수학교 시간표',
    endpoint: 'spsTimetable',
    description: '특수학교 학급별 시간표',
    requiredParams: ['ATPT_OFCDC_SC_CODE', 'SD_SCHUL_CODE'],
    optionalParams: ['AY', 'SEM', 'ALL_TI_YMD', 'GRADE', 'CLASS_NM', 'PERIO'],
    defaultParams: { ATPT_OFCDC_SC_CODE: 'B10', SD_SCHUL_CODE: '7011074' }
  },
  {
    id: 'acaInsTiInfo',
    name: '학원교습소정보',
    endpoint: 'acaInsTiInfo',
    description: '학원 및 교습소 등록 정보 (학원명, 소재지, 교습과목 등)',
    requiredParams: ['ATPT_OFCDC_SC_CODE'],
    optionalParams: ['ADMST_ZONE_NM'],
    defaultParams: { ATPT_OFCDC_SC_CODE: 'B10' }
  }
]

export async function registerNeis(app: FastifyInstance) {
  // NEIS 데이터셋 목록
  app.get('/api/neis/datasets', async () => {
    return {
      data: NEIS_ENDPOINTS.map(ep => ({
        id: `neis-${ep.id}`,
        source: 'neis',
        name: ep.name,
        description: ep.description,
        type: 'api',
        format: 'JSON',
        organization: '교육부(나이스)',
        requiredParams: ep.requiredParams,
        optionalParams: ep.optionalParams
      })),
      totalCount: NEIS_ENDPOINTS.length
    }
  })

  // NEIS 데이터 미리보기 (프록시)
  app.get('/api/neis/preview/:endpointId', async (req, reply) => {
    const { endpointId } = req.params as { endpointId: string }
    const queryParams = req.query as Record<string, string>

    const endpoint = NEIS_ENDPOINTS.find(ep => ep.id === endpointId)
    if (!endpoint) {
      return reply.code(404).send({ error: 'Endpoint not found' })
    }

    const params = new URLSearchParams({
      Type: 'json',
      pIndex: '1',
      pSize: '100',
      ...(config.neis.apiKey ? { KEY: config.neis.apiKey } : {}),
      ...endpoint.defaultParams,
      ...queryParams
    })

    const url = `${NEIS_BASE}/${endpoint.endpoint}?${params}`
    const res = await fetch(url)
    const data = await res.json()

    // NEIS 응답 구조 정규화
    const rootKey = Object.keys(data).find(k => k !== 'RESULT')
    if (!rootKey || !data[rootKey]) {
      return { columns: [], rows: [], totalCount: 0, error: data.RESULT?.MESSAGE }
    }

    const head = data[rootKey][0]?.head
    const rows = data[rootKey][1]?.row || []
    const totalCount = head?.[0]?.list_total_count || 0
    const columns = rows.length > 0 ? Object.keys(rows[0]) : []

    return { columns, rows, totalCount }
  })
}
```

**Step 2: server/index.ts에 등록**

```typescript
import { registerNeis } from './sources/neis.js'
await registerNeis(app)
```

**Step 3: 테스트**

```bash
curl "http://localhost:3008/api/neis/datasets" | jq '.data | length'
curl "http://localhost:3008/api/neis/preview/schoolInfo" | jq '.rows | length'
```

**Step 4: Commit**

```bash
git add server/ && git commit -m "feat: NEIS Open API proxy with 12 endpoints"
```

### Task 5: 정적 데이터 소스 (KESS, 학구도 등)

**Files:**
- Create: `server/sources/static-sources.ts`
- Create: `server/sources/hardcoded-sources.ts`
- Modify: `server/index.ts`

**Step 1: hardcoded-sources.ts 작성**

학교알리미, 교육통계, 학구도, 어린이집, KRIVET, EDMGR 등 메타정보를 하드코딩:

```typescript
import { FastifyInstance } from 'fastify'

interface StaticDataset {
  id: string
  source: string
  name: string
  description: string
  type: 'api' | 'file' | 'info-only'
  format?: string
  organization: string
  keywords?: string[]
}

const SCHOOLINFO_DATASETS: StaticDataset[] = [
  { id: 'schoolinfo-basic', source: 'schoolinfo', name: '학교 기본정보 공시', description: '전국 초중고 학교의 기본정보 (학생수, 교원수 등) 정보공시 데이터', type: 'api', format: 'JSON', organization: '학교알리미', keywords: ['학교', '공시', '학생수', '교원수'] },
  { id: 'schoolinfo-finance', source: 'schoolinfo', name: '학교 재정 공시', description: '학교 예결산 현황, 재정 정보 공시 데이터', type: 'api', format: 'JSON', organization: '학교알리미', keywords: ['재정', '예산', '결산'] },
  { id: 'schoolinfo-health', source: 'schoolinfo', name: '학교 보건/복지 공시', description: '급식, 건강, 복지 관련 정보 공시 데이터', type: 'api', format: 'JSON', organization: '학교알리미', keywords: ['급식', '건강', '보건'] }
]

const KESS_DATASETS: StaticDataset[] = [
  { id: 'kess-school-stats', source: 'kess', name: '학교별 교육통계 (2008~2025)', description: '전국 학교별 학생수, 교원수, 학급수 등 기본 통계 (반기별)', type: 'file', format: 'CSV', organization: '한국교육개발원', keywords: ['학교통계', '학생수', '교원수'] },
  { id: 'kess-major-stats', source: 'kess', name: '학과별 교육통계 (2008~2025)', description: '대학 학과별 입학정원, 재적학생, 졸업자, 외국인학생 등', type: 'file', format: 'CSV', organization: '한국교육개발원', keywords: ['대학', '학과', '입학', '졸업'] },
  { id: 'kess-yearbook', source: 'kess', name: '교육통계연보', description: '연도별 교육통계 종합 연보 데이터', type: 'file', format: 'CSV', organization: '한국교육개발원', keywords: ['연보', '종합통계'] }
]

const ACADEMYINFO_DATASETS: StaticDataset[] = [
  { id: 'academy-basic', source: 'academyinfo', name: '대학 기본정보', description: '전국 대학교 기본정보 (설립년도, 소재지, 학생수 등)', type: 'api', format: 'JSON', organization: '한국대학교육협의회', keywords: ['대학', '기본정보'] },
  { id: 'academy-student', source: 'academyinfo', name: '대학정보공시 학생현황', description: '입학정원, 경쟁률, 등록금, 취업률, 장학금, 기숙사 등', type: 'api', format: 'JSON', organization: '한국대학교육협의회', keywords: ['대학', '입학', '취업률', '등록금'] },
  { id: 'academy-major', source: 'academyinfo', name: '대학 학과정보', description: '대학별 학과 목록 및 상세 정보', type: 'api', format: 'JSON', organization: '한국대학교육협의회', keywords: ['대학', '학과'] },
  { id: 'academy-industry', source: 'academyinfo', name: '산학협력 현황', description: '대학 산학협력 관련 통계', type: 'api', format: 'JSON', organization: '한국대학교육협의회', keywords: ['산학협력'] }
]

const SCHOOLZONE_DATASETS: StaticDataset[] = [
  { id: 'schoolzone-elementary', source: 'schoolzone', name: '초등학교 통학구역', description: '초등학교 통학구역(학구) 경계 데이터 (GIS)', type: 'file', format: 'SHP/CSV', organization: '한국교육시설안전원', keywords: ['학구도', '통학구역', '초등학교'] },
  { id: 'schoolzone-middle', source: 'schoolzone', name: '중학교 학구/통학구역', description: '중학교 학구 및 통학구역 경계 데이터 (GIS)', type: 'file', format: 'SHP/CSV', organization: '한국교육시설안전원', keywords: ['학구도', '통학구역', '중학교'] },
  { id: 'schoolzone-high', source: 'schoolzone', name: '고등학교 학교군', description: '고등학교 학교군 경계 데이터 (GIS)', type: 'file', format: 'SHP/CSV', organization: '한국교육시설안전원', keywords: ['학교군', '고등학교'] },
  { id: 'schoolzone-location', source: 'schoolzone', name: '학교 위치 데이터', description: '전국 초중학교 위치 좌표 (CSV)', type: 'file', format: 'CSV', organization: '한국교육시설안전원', keywords: ['학교위치', '좌표', 'GIS'] }
]

const CHILDINFO_DATASETS: StaticDataset[] = [
  { id: 'childinfo-daycare', source: 'childinfo', name: '어린이집 기본정보', description: '전국 어린이집 기본정보 (보육과정, 운영시간, 보육교사 등)', type: 'api', format: 'JSON', organization: '보건복지부', keywords: ['어린이집', '보육'] },
  { id: 'childinfo-kindergarten', source: 'childinfo', name: '유치원 정보공시', description: '전국 유치원 정보공시 데이터 (원아수, 교원수, 교육과정 등)', type: 'api', format: 'JSON', organization: '교육부', keywords: ['유치원', '교육과정'] }
]

const KRIVET_DATASETS: StaticDataset[] = [
  { id: 'krivet-keep1', source: 'krivet', name: '한국교육고용패널 I (KEEP I)', description: '2004~2015 중3 2,000명 + 고3 4,000명 추적조사 데이터. 고등학교 생활, 대학 입학, 취업, 직업의식 등', type: 'info-only', format: 'SPSS/STATA', organization: '한국직업능력연구원', keywords: ['패널', '교육고용', '추적조사'] },
  { id: 'krivet-keep2', source: 'krivet', name: '한국교육고용패널 II (KEEP II)', description: '2016~ 학교-노동시장 이행과정 추적조사 데이터', type: 'info-only', format: 'SPSS/STATA', organization: '한국직업능력연구원', keywords: ['패널', '노동시장', '이행'] }
]

const EDMGR_DATASETS: StaticDataset[] = [
  { id: 'edmgr-edss', source: 'edmgr', name: 'EDSS 에듀데이터서비스', description: '초중등교육통계, 고등교육통계, 학술연구 데이터. 신청/승인 방식.', type: 'info-only', format: 'CSV/Excel', organization: '한국교육학술정보원', keywords: ['교육통계', 'EDSS'] },
  { id: 'edmgr-datamap', source: 'edmgr', name: '교육데이터맵', description: '15개 이상 기관의 교육데이터를 시각적으로 탐색하는 통합 카탈로그', type: 'info-only', format: '웹', organization: '한국교육학술정보원', keywords: ['데이터맵', '카탈로그'] }
]

const ALL_STATIC_DATASETS = [
  ...SCHOOLINFO_DATASETS,
  ...KESS_DATASETS,
  ...ACADEMYINFO_DATASETS,
  ...SCHOOLZONE_DATASETS,
  ...CHILDINFO_DATASETS,
  ...KRIVET_DATASETS,
  ...EDMGR_DATASETS
]

export async function registerHardcodedSources(app: FastifyInstance) {
  app.get('/api/static/datasets', async (req) => {
    const { source, q } = req.query as Record<string, string>
    let results = ALL_STATIC_DATASETS

    if (source) {
      results = results.filter(d => d.source === source)
    }
    if (q) {
      const lower = q.toLowerCase()
      results = results.filter(d =>
        d.name.toLowerCase().includes(lower) ||
        d.description.toLowerCase().includes(lower) ||
        d.keywords?.some(k => k.toLowerCase().includes(lower))
      )
    }

    return { data: results, totalCount: results.length }
  })
}
```

**Step 2: server/index.ts에 등록**

```typescript
import { registerHardcodedSources } from './sources/hardcoded-sources.js'
await registerHardcodedSources(app)
```

**Step 3: 테스트**

```bash
curl "http://localhost:3008/api/static/datasets" | jq '.totalCount'
curl "http://localhost:3008/api/static/datasets?source=kess" | jq '.data'
```

**Step 4: Commit**

```bash
git add server/ && git commit -m "feat: hardcoded metadata for 9 education data sources"
```

### Task 6: 통합 데이터셋 API

**Files:**
- Create: `server/sources/unified.ts`
- Modify: `server/index.ts`

하나의 `/api/datasets` 엔드포인트에서 모든 소스를 통합 조회:

**Step 1: unified.ts 작성**

```typescript
import { FastifyInstance } from 'fastify'
import { config } from '../config.js'
import { NEIS_ENDPOINTS } from './neis.js'

export async function registerUnified(app: FastifyInstance) {
  app.get('/api/datasets', async (req) => {
    const { source, type, q, page = '1', limit = '50' } = req.query as Record<string, string>
    const pageNum = parseInt(page)
    const limitNum = parseInt(limit)

    const allDatasets: any[] = []

    // 1. NEIS (항상 로드 - 소수)
    if (!source || source === 'neis') {
      NEIS_ENDPOINTS.forEach(ep => {
        allDatasets.push({
          id: `neis-${ep.id}`,
          source: 'neis',
          name: ep.name,
          description: ep.description,
          type: 'api',
          format: 'JSON',
          organization: '교육부(나이스)',
          keywords: [],
          previewEndpoint: `/api/neis/preview/${ep.id}`
        })
      })
    }

    // 2. 하드코딩 소스들
    if (!source || !['neis', 'data-go-kr'].includes(source)) {
      const staticRes = await fetch(`http://localhost:${config.port}/api/static/datasets?${new URLSearchParams(source ? { source } : {})}`)
      const staticData = await staticRes.json() as any
      allDatasets.push(...(staticData.data || []))
    }

    // 3. data.go.kr (API가 있으면 로드)
    if (!source || source === 'data-go-kr') {
      try {
        const params = new URLSearchParams({ page: '1', perPage: '100', serviceKey: config.dataGoKr.apiKey })
        if (q) params.append('cond[title::LIKE]', q)

        const res = await fetch(`${config.dataGoKr.catalogBase}/dataset?${params}`)
        const data = await res.json() as any
        if (data.data) {
          data.data.forEach((d: any) => {
            allDatasets.push({
              id: `dgk-${d.id}`,
              source: 'data-go-kr',
              name: d.title,
              description: d.desc || '',
              type: d.list_type === 'openapi' ? 'api' : 'file',
              format: d.ext || '',
              organization: d.org_nm || '',
              keywords: d.keywords ? d.keywords.split(',').map((k: string) => k.trim()) : []
            })
          })
        }
      } catch (e) {
        // data.go.kr 실패해도 나머지는 표시
      }
    }

    // 필터
    let filtered = allDatasets
    if (type) filtered = filtered.filter(d => d.type === type)
    if (q && source !== 'data-go-kr') {
      const lower = q.toLowerCase()
      filtered = filtered.filter(d =>
        d.name.toLowerCase().includes(lower) ||
        d.description.toLowerCase().includes(lower)
      )
    }

    // 페이지네이션
    const total = filtered.length
    const start = (pageNum - 1) * limitNum
    const paged = filtered.slice(start, start + limitNum)

    return { data: paged, totalCount: total, page: pageNum, limit: limitNum }
  })
}
```

**Step 2: server/index.ts에 등록**

```typescript
import { registerUnified } from './sources/unified.js'
await registerUnified(app)
```

**Step 3: 테스트**

```bash
curl "http://localhost:3008/api/datasets" | jq '.totalCount'
curl "http://localhost:3008/api/datasets?source=neis" | jq '.data | length'
curl "http://localhost:3008/api/datasets?q=급식" | jq '.data[].name'
```

**Step 4: Commit**

```bash
git add server/ && git commit -m "feat: unified dataset listing API across all sources"
```

---

## Phase 3: 프론트엔드

### Task 7: React 앱 기본 구조 + Tailwind

**Files:**
- Create: `client/index.html`
- Create: `client/src/main.tsx`
- Create: `client/src/main.css`
- Create: `client/src/App.tsx`
- Create: `client/src/types/index.ts`

**Step 1: client/index.html**

```html
<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>교육 공공데이터 뷰어</title>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/src/main.tsx"></script>
</body>
</html>
```

**Step 2: client/src/main.css**

```css
@import "tailwindcss";
```

**Step 3: client/src/types/index.ts**

```typescript
export interface Dataset {
  id: string
  source: Source
  name: string
  description: string
  type: 'api' | 'file' | 'info-only'
  format?: string
  keywords?: string[]
  organization?: string
  previewEndpoint?: string
}

export type Source =
  | 'data-go-kr' | 'neis' | 'schoolinfo' | 'kess'
  | 'academyinfo' | 'schoolzone' | 'childinfo'
  | 'krivet' | 'edmgr'

export const SOURCE_LABELS: Record<Source, string> = {
  'data-go-kr': '공공데이터포털',
  'neis': 'NEIS (나이스)',
  'schoolinfo': '학교알리미',
  'kess': '교육통계서비스',
  'academyinfo': '대학알리미',
  'schoolzone': '학구도',
  'childinfo': '어린이집/유치원',
  'krivet': '교육고용패널',
  'edmgr': '교육데이터플랫폼'
}

export interface PreviewData {
  columns: string[]
  rows: Record<string, any>[]
  totalCount: number
  error?: string
}

export interface DatasetListResponse {
  data: Dataset[]
  totalCount: number
  page: number
  limit: number
}
```

**Step 4: client/src/main.tsx**

```tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'
import './main.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
```

**Step 5: client/src/App.tsx** (최소 뼈대)

```tsx
export function App() {
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b px-6 py-4">
        <h1 className="text-xl font-bold text-gray-900">교육 공공데이터 뷰어</h1>
      </header>
      <main className="p-6">
        <p className="text-gray-500">Loading...</p>
      </main>
    </div>
  )
}
```

**Step 6: 빌드 및 확인**

```bash
cd /home/estelle/edu-data-viewer
npm run build:client
npx tsx server/index.ts
# 브라우저에서 http://localhost:3008/edu-data-viewer/ 확인
```

**Step 7: Commit**

```bash
git add client/ && git commit -m "feat: react app scaffolding with tailwind"
```

### Task 8: API fetch hooks

**Files:**
- Create: `client/src/hooks/useDatasets.ts`
- Create: `client/src/hooks/usePreview.ts`
- Create: `client/src/lib/api.ts`

**Step 1: client/src/lib/api.ts**

```typescript
const BASE = import.meta.env.DEV ? '/edu-data-viewer' : '/edu-data-viewer'

export async function fetchApi<T>(path: string, params?: Record<string, string>): Promise<T> {
  const url = new URL(`${BASE}${path}`, window.location.origin)
  if (params) {
    Object.entries(params).forEach(([k, v]) => {
      if (v) url.searchParams.set(k, v)
    })
  }
  const res = await fetch(url.toString())
  if (!res.ok) throw new Error(`API error: ${res.status}`)
  return res.json()
}
```

**Step 2: client/src/hooks/useDatasets.ts**

```typescript
import { useState, useEffect } from 'react'
import { fetchApi } from '../lib/api'
import type { Dataset, DatasetListResponse, Source } from '../types'

interface UseDatasets {
  datasets: Dataset[]
  totalCount: number
  loading: boolean
  error: string | null
}

export function useDatasets(filters: {
  source?: Source | null
  type?: string | null
  q?: string
  page?: number
  limit?: number
}): UseDatasets {
  const [state, setState] = useState<UseDatasets>({
    datasets: [], totalCount: 0, loading: true, error: null
  })

  useEffect(() => {
    setState(s => ({ ...s, loading: true, error: null }))

    const params: Record<string, string> = {}
    if (filters.source) params.source = filters.source
    if (filters.type) params.type = filters.type
    if (filters.q) params.q = filters.q
    if (filters.page) params.page = String(filters.page)
    if (filters.limit) params.limit = String(filters.limit)

    fetchApi<DatasetListResponse>('/api/datasets', params)
      .then(res => setState({ datasets: res.data, totalCount: res.totalCount, loading: false, error: null }))
      .catch(err => setState({ datasets: [], totalCount: 0, loading: false, error: err.message }))
  }, [filters.source, filters.type, filters.q, filters.page, filters.limit])

  return state
}
```

**Step 3: client/src/hooks/usePreview.ts**

```typescript
import { useState, useCallback } from 'react'
import { fetchApi } from '../lib/api'
import type { PreviewData } from '../types'

export function usePreview() {
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<PreviewData | null>(null)
  const [error, setError] = useState<string | null>(null)

  const loadPreview = useCallback(async (endpoint: string) => {
    setLoading(true)
    setError(null)
    try {
      const result = await fetchApi<PreviewData>(endpoint)
      setData(result)
    } catch (err: any) {
      setError(err.message)
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [])

  const clearPreview = useCallback(() => {
    setData(null)
    setError(null)
  }, [])

  return { data, loading, error, loadPreview, clearPreview }
}
```

**Step 4: Commit**

```bash
git add client/ && git commit -m "feat: API fetch hooks for datasets and preview"
```

### Task 9: 사이드바 + 검색바 + 데이터셋 목록

**Files:**
- Create: `client/src/components/Sidebar.tsx`
- Create: `client/src/components/SearchBar.tsx`
- Create: `client/src/components/DatasetList.tsx`
- Create: `client/src/components/DatasetCard.tsx`
- Modify: `client/src/App.tsx`

**Step 1: Sidebar.tsx**

소스 필터 + 타입 필터 사이드바. 체크박스/라디오 스타일로 선택.

**Step 2: SearchBar.tsx**

검색어 입력 → 디바운스 300ms → 상위로 전달.

**Step 3: DatasetCard.tsx**

카드 UI: 이름, 설명, 소스 뱃지, 타입 뱃지, 키워드 태그. 클릭 시 `onSelect` 호출.

**Step 4: DatasetList.tsx**

`useDatasets` 훅으로 목록 fetch → DatasetCard 렌더링. 로딩/에러/빈 상태 처리.

**Step 5: App.tsx 조립**

사이드바 + 검색바 + 목록 + 상태 관리.

**Step 6: 빌드 & 확인**

```bash
npm run build:client && npx tsx server/index.ts
```

**Step 7: Commit**

```bash
git add client/ && git commit -m "feat: sidebar filters, search, dataset list UI"
```

### Task 10: 데이터 미리보기 테이블

**Files:**
- Create: `client/src/components/DataPreview.tsx`
- Modify: `client/src/components/DatasetCard.tsx` (클릭 시 미리보기 확장)

**Step 1: DataPreview.tsx**

가로 스크롤 가능한 테이블 컴포넌트. `columns`와 `rows` 받아서 렌더링.
- 로딩 스피너
- 에러 표시
- info-only 안내 메시지 ("이 데이터는 직접 신청이 필요합니다")
- 컬럼 헤더 고정
- 100행 제한 표시

**Step 2: DatasetCard에 확장 토글 통합**

카드 클릭 시 하단에 DataPreview가 확장. `usePreview` 훅으로 데이터 로드.

**Step 3: 빌드 & 확인**

NEIS schoolInfo 미리보기가 테이블로 표시되는지 확인.

**Step 4: Commit**

```bash
git add client/ && git commit -m "feat: TOP 100 data preview table with expand/collapse"
```

### Task 11: 페이지네이션

**Files:**
- Create: `client/src/components/Pagination.tsx`
- Modify: `client/src/App.tsx`

간단한 이전/다음 + 페이지 번호 표시.

**Commit:**

```bash
git add client/ && git commit -m "feat: pagination for dataset list"
```

---

## Phase 4: 배포

### Task 12: PM2 + Caddy 설정

**Files:**
- Create: `ecosystem.config.cjs`
- Modify: `/etc/caddy/Caddyfile`
- Modify: `/home/estelle/estelle2/config/hub-routes.json`

**Step 1: ecosystem.config.cjs**

```javascript
module.exports = {
  apps: [{
    name: 'edu-data-viewer',
    script: 'npx',
    args: 'tsx server/index.ts',
    cwd: '/home/estelle/edu-data-viewer',
    env: {
      PORT: 3008,
      NODE_ENV: 'production'
    }
  }]
}
```

**Step 2: 빌드 & PM2 시작**

```bash
cd /home/estelle/edu-data-viewer
npm run build
pm2 start ecosystem.config.cjs
pm2 save
```

**Step 3: Caddyfile에 추가**

```caddyfile
handle /edu-data-viewer/* {
    reverse_proxy localhost:3008
}
```

```bash
sudo systemctl reload caddy
```

**Step 4: hub-routes.json에 추가**

```json
{
  "name": "교육 공공데이터 뷰어",
  "path": "/home/estelle/edu-data-viewer",
  "port": 3008,
  "url": "https://estelle-hub.mooo.com/edu-data-viewer/",
  "description": "교육 공공데이터 탐색 및 미리보기"
}
```

**Step 5: 접속 확인**

```bash
curl -I https://estelle-hub.mooo.com/edu-data-viewer/
```

**Step 6: Commit**

```bash
git add ecosystem.config.cjs && git commit -m "feat: PM2 config and deployment setup"
```

---

## Phase 5: API 키 등록 및 데이터 보강

### Task 13: API 키 발급 및 등록

주인님에게 확인 필요:
- data.go.kr 회원가입 → API 활용신청 (카탈로그 API: 15077093)
- open.neis.go.kr 소셜 로그인 → 인증키 신청
- 발급받은 키를 `.env`에 등록

### Task 14: 정적 데이터 다운로드

- kess.kedi.re.kr에서 CSV 파일 수동 다운로드 → `static-data/kess/`
- schoolzone.emac.kr에서 CSV 파일 다운로드 → `static-data/schoolzone/`
- CSV 미리보기 라우트 추가 (`server/sources/static-files.ts`)

---

## Summary

| Phase | Tasks | 설명 |
|-------|-------|------|
| 1 | Task 1 | 프로젝트 스캐폴딩 |
| 2 | Task 2~6 | 백엔드 (Fastify 서버 + API 프록시) |
| 3 | Task 7~11 | 프론트엔드 (React UI) |
| 4 | Task 12 | 배포 (PM2 + Caddy + Hub) |
| 5 | Task 13~14 | API 키 + 정적 데이터 보강 |
