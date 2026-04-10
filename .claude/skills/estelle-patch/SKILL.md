---
name: estelle-patch
description: Use when deploying code changes to Estelle machines - bumps version, triggers git pull and build via estelle-updater WebSocket system
---

# estelle-patch

Trigger Estelle deployment across all machines (Linux/Windows) via estelle-updater.

## Prerequisites

1. All changes committed (but not pushed yet - version bump will be included)
2. `estelle-updater` running on PM2 (`pm2 logs estelle-updater`)
3. Agents connected (check logs for `Agent connected`)

## Patch Procedure

### 1. Bump Version

```bash
cd <워크스페이스 경로 - 유저 환경에 맞게 설정>
npx tsx scripts/bump-version.ts
```

This updates `config/version.json` with a new version like `v0303_5` (date_counter format).

### 2. Rebuild Client

```bash
cd packages/client
pnpm build
```

This embeds the new version into the client bundle.

### 3. Commit & Push

```bash
cd <워크스페이스 경로 - 유저 환경에 맞게 설정>
git add config/version.json packages/relay/public/
git commit -m "chore: bump version to $(cat config/version.json | jq -r .version)"
git push origin master
```

### 4. Verify Updater Status

```bash
pm2 logs estelle-updater --nostream --lines 5
```

Confirm: `Server ready` and `Agent connected` messages present.

### 5. Trigger Update

**CLI (from master server):**
```bash
cd <워크스페이스 경로 - 유저 환경에 맞게 설정>
npx tsx packages/updater/src/cli.ts trigger all master
```

**Targets:**
- `all` - all machines including self
- `<서버 IP - 유저 환경에 맞게 설정>` - Cloud (Hetzner) only
- `<사무실 IP - 유저 환경에 맞게 설정>` - Office (Windows) only

**Branch:** usually `master`

### 6. Monitor

```bash
pm2 logs estelle-updater --lines 50
```

Watch for:
- `[1/9] git fetch origin...`
- `[2/9] git checkout master...`
- `[3/9] git pull origin master...`
- `[4/9] pnpm install...`
- `[5/9] pnpm build...`
- `[6/9] Copying build artifacts to release/...`
- `[7/9] PM2 services...`
- `[8/9] pm2 save...`
- `[9/9] Restarting updater...`
- `Update complete (vMMDD_N)`

### 7. Verify

```bash
pm2 status
```

Confirm `estelle-relay` and `estelle-pylon` are `online`.

## Quick One-Liner (after all changes committed)

```bash
cd <워크스페이스 경로 - 유저 환경에 맞게 설정> && \
npx tsx scripts/bump-version.ts && \
cd packages/client && pnpm build && \
cd ../.. && \
git add config/version.json packages/relay/public/ && \
git commit -m "chore: bump version to $(cat config/version.json | jq -r .version)" && \
git push origin master && \
npx tsx packages/updater/src/cli.ts trigger all master
```

## What Happens

```
bump-version.ts  -> Updates config/version.json (counter +1)
pnpm build       -> Embeds version in client bundle
git push         -> Push to remote
trigger          -> Master broadcasts update command (with environmentFile per machine)
               -> Each machine: git pull -> pnpm install -> pnpm build
               -> Copy artifacts to release/
               -> Read config/version.json for ESTELLE_VERSION
               -> Read config/{environmentFile} for ESTELLE_ENV_CONFIG
               -> pm2 delete + start via ecosystem config (with env vars)
               -> pm2 save
```

## Version Format

- `vMMDD_N` where:
  - `MM` = month (01-12)
  - `DD` = day (01-31)
  - `N` = daily counter (resets each day)
- Example: `v0303_5` = March 3rd, 5th build of the day

## Machine Config

`config/updater.json`의 `machines` 매핑으로 각 머신의 환경 파일을 관리:
```json
{
  "machines": {
    "<사무실 IP - 유저 환경에 맞게 설정>": { "environmentFile": "environments.office.json" },
    "<서버 IP - 유저 환경에 맞게 설정>": { "environmentFile": "environments.cloud.json" }
  }
}
```

환경 파일은 `config/environments.office.json`, `config/environments.cloud.json`으로 git에서 공유.

## Troubleshooting

| Problem | Fix |
|---------|-----|
| No agents connected | Check `config/updater.json` machines, check Windows updater is running |
| Pylon not starting | `pm2 logs estelle-pylon --lines 20` |
| Port 9900 not open | `sudo ufw allow 9900/tcp` then `pm2 restart estelle-updater` |
| Windows rejected | Add public IP to `config/updater.json` machines, restart updater |
| Version still "dev" | Check config/version.json exists, check environmentFile in updater.json |
| EINVAL on copy | Symlink issue resolved - pylon node_modules core copy removed |
