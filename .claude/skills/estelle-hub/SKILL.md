---
name: estelle-hub
description: Use when user asks about "Estelle Hub", "hub-routes", "hub-routes.json", adding projects, or project management on the Hetzner server
version: 2.0.0
---

# Estelle Hub 가이드

Estelle Hub는 Hetzner 서버에서 실행 중인 프로젝트들을 관리하는 시스템이에요.

## 프로젝트 목록 접근

- Estelle 앱 헤더의 **Grid 버튼** 클릭
- 팝업에서 프로젝트 목록 확인 및 바로가기

## 서버 환경

- **IP**: <서버 IP - 유저 환경에 맞게 설정>
- **도메인**: `<유저 도메인 - 유저 환경에 맞게 설정>` (Caddy 리버스 프록시)
- **HTTPS**: Caddy 자동 인증서 관리

## 프로젝트 추가 방법

### 1. 설정 파일

`<워크스페이스 경로 - 유저 환경에 맞게 설정>/config/hub-routes.json`

### 2. 설정 형식

```json
{
  "projects": [
    {
      "name": "Voxel Engine",
      "path": "/projects/voxel-engine",
      "port": 3003,
      "url": "https://<유저 도메인 - 유저 환경에 맞게 설정>/voxel-engine/",
      "description": "WebGPU 복셀 엔진"
    }
  ]
}
```

### 3. 필드 설명

| 필드 | 필수 | 설명 |
|------|------|------|
| `name` | ✅ | 표시될 이름 |
| `path` | ✅ | 프로젝트 디렉토리 경로 |
| `port` | ✅ | 서비스 포트 번호 |
| `url` | ❌ | HTTPS URL (지정 시 port 대신 사용) |
| `description` | ❌ | 프로젝트 설명 |

### 4. URL vs Port

- `url` 지정 시: 해당 URL로 링크 (HTTPS 가능)
- `url` 미지정 시: `http://<서버 IP - 유저 환경에 맞게 설정>:{port}`로 링크

**HTTPS가 필요한 경우** (WebGPU, 카메라 등): `url` 필드 사용 + Caddy 설정

## Caddy 리버스 프록시 설정

`/etc/caddy/Caddyfile`에 경로 추가:

```caddyfile
<유저 도메인 - 유저 환경에 맞게 설정> {
    reverse_proxy localhost:8080

    handle_path /voxel-engine/* {
        reverse_proxy localhost:3003
    }
}
```

설정 후: `sudo systemctl reload caddy`

## PM2로 프로젝트 실행

```bash
# 정적 파일 서버
pm2 start npx --name "my-app" -- serve -l tcp://0.0.0.0:3001 /path/to/dist

# Node.js 앱
pm2 start npm --name "my-app" -- start

# 저장 및 자동 시작
pm2 save
```

**중요**: 반드시 `0.0.0.0`으로 바인딩해야 외부 접근 가능!

## 문제 해결

| 증상 | 원인 | 해결 |
|------|------|------|
| ERR_CONNECTION_REFUSED | 앱 미실행 | `pm2 list`로 확인 후 실행 |
| ERR_EMPTY_RESPONSE | localhost 바인딩 | `0.0.0.0`으로 변경 |
| HTTPS 오류 | Caddy 미설정 | Caddyfile에 경로 추가 |
| 목록 안 보임 | JSON 오류 | hub-routes.json 문법 확인 |
