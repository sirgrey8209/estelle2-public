// packages/updater/src/executor.ts
/**
 * Git pull + build + PM2 restart executor
 *
 * Update flow:
 * 1. git fetch + checkout + pull
 * 2. pnpm install
 * 3. pnpm build
 * 4. Copy dist to release/
 * 5. Read version + environment config
 * 6. PM2 delete/start via ecosystem file
 * 7. pm2 save
 */
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

const isWindows = process.platform === 'win32';

/** Default timeout for spawned commands (5 minutes) */
const DEFAULT_COMMAND_TIMEOUT = 5 * 60 * 1000;

export interface ExecuteOptions {
  branch: string;
  repoRoot: string;
  onLog: (message: string) => void;
  /** Master restarts Relay + Pylon + Tunnel(connect), Agent restarts Pylon + Tunnel(listen) */
  isMaster?: boolean;
  /** Environment config file for this machine (e.g., 'environments.office.json') */
  environmentFile?: string;
}

export interface ExecuteResult {
  success: boolean;
  version?: string;
  error?: string;
}

/** Expand ~ to home directory */
function expandPath(p: string): string {
  if (p.startsWith('~/')) {
    return path.join(process.env.HOME || process.env.USERPROFILE || '', p.slice(2));
  }
  return p;
}

/** Local log function - writes to both callback and local file */
function createLogger(repoRoot: string, onLog: (msg: string) => void) {
  const logDir = path.join(repoRoot, 'release-data', 'logs');
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
  const logFile = path.join(logDir, `update-${Date.now()}.log`);
  const stream = fs.createWriteStream(logFile, { flags: 'a' });

  const log = (msg: string) => {
    const timestamp = new Date().toISOString();
    const line = `[${timestamp}] ${msg}`;
    stream.write(line + '\n');
    onLog(msg); // Also send to master
  };

  const close = () => stream.end();

  log(`Log file: ${logFile}`);
  return { log, close, logFile };
}

function runCommand(
  cmd: string,
  args: string[],
  cwd: string,
  onLog: (msg: string) => void,
  timeout: number = DEFAULT_COMMAND_TIMEOUT
): Promise<{ success: boolean; output?: string; error?: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, shell: true, windowsHide: true });
    let output = '';
    let resolved = false;

    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        child.kill('SIGTERM');
        setTimeout(() => child.kill('SIGKILL'), 5000);
        onLog(`[TIMEOUT] Command timed out after ${timeout}ms: ${cmd} ${args.join(' ')}`);
        resolve({ success: false, error: `Command timed out after ${timeout}ms` });
      }
    }, timeout);

    child.stdout?.on('data', (data) => {
      const text = data.toString();
      output += text;
      onLog(text.trim());
    });

    child.stderr?.on('data', (data) => {
      const text = data.toString();
      output += text;
      onLog(text.trim());
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (!resolved) {
        resolved = true;
        if (code === 0) {
          resolve({ success: true, output });
        } else {
          resolve({ success: false, error: `Exit code: ${code}`, output });
        }
      }
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      if (!resolved) {
        resolved = true;
        resolve({ success: false, error: err.message });
      }
    });
  });
}

/**
 * 릴리스 디렉토리를 백업한다.
 * @returns 백업 경로 (없으면 null)
 */
function backupRelease(repoRoot: string, log: (msg: string) => void): string | null {
  const releaseDir = path.join(repoRoot, 'release');
  const backupDir = path.join(repoRoot, 'release.rollback');

  if (!fs.existsSync(releaseDir)) {
    return null;
  }

  // 기존 백업 제거
  if (fs.existsSync(backupDir)) {
    fs.rmSync(backupDir, { recursive: true, force: true });
  }

  fs.cpSync(releaseDir, backupDir, { recursive: true });
  log(`  Backed up release/ → release.rollback/`);
  return backupDir;
}

/**
 * 롤백: 백업에서 릴리스 디렉토리를 복원한다.
 */
function rollbackRelease(repoRoot: string, log: (msg: string) => void): boolean {
  const releaseDir = path.join(repoRoot, 'release');
  const backupDir = path.join(repoRoot, 'release.rollback');

  if (!fs.existsSync(backupDir)) {
    log(`  ✗ No backup found at release.rollback/`);
    return false;
  }

  if (fs.existsSync(releaseDir)) {
    fs.rmSync(releaseDir, { recursive: true, force: true });
  }

  fs.renameSync(backupDir, releaseDir);
  log(`  Rolled back release.rollback/ → release/`);
  return true;
}

export async function executeUpdate(options: ExecuteOptions): Promise<ExecuteResult> {
  const { branch, repoRoot, onLog, isMaster = false, environmentFile } = options;
  const { log, close } = createLogger(repoRoot, onLog);

  try {
    const role = isMaster ? 'Master' : 'Agent';
    log(`=== Update started (${role}) ===`);

    // Step 1: git fetch
    log(`[1/9] git fetch origin...`);
    const fetchResult = await runCommand('git', ['fetch', 'origin'], repoRoot, log);
    if (!fetchResult.success) {
      log(`✗ git fetch failed: ${fetchResult.error}`);
      return { success: false, error: `git fetch failed: ${fetchResult.error}` };
    }

    // Step 2: git checkout
    log(`[2/9] git checkout ${branch}...`);
    const checkoutResult = await runCommand('git', ['checkout', branch], repoRoot, log);
    if (!checkoutResult.success) {
      log(`✗ git checkout failed: ${checkoutResult.error}`);
      return { success: false, error: `git checkout failed: ${checkoutResult.error}` };
    }

    // Step 3: git pull
    log(`[3/9] git pull origin ${branch}...`);
    const pullResult = await runCommand('git', ['pull', 'origin', branch], repoRoot, log);
    if (!pullResult.success) {
      log(`✗ git pull failed: ${pullResult.error}`);
      return { success: false, error: `git pull failed: ${pullResult.error}` };
    }

    // Step 4: pnpm install (for new dependencies)
    log(`[4/9] pnpm install...`);
    const installResult = await runCommand('pnpm', ['install'], repoRoot, log);
    if (!installResult.success) {
      log(`✗ pnpm install failed: ${installResult.error}`);
      return { success: false, error: `pnpm install failed: ${installResult.error}` };
    }

    // Step 5: pnpm build
    log(`[5/9] pnpm build...`);
    const buildResult = await runCommand('pnpm', ['build'], repoRoot, log);
    if (!buildResult.success) {
      log(`✗ pnpm build failed: ${buildResult.error}`);
      return { success: false, error: `pnpm build failed: ${buildResult.error}` };
    }

    // Backup current release before overwriting
    log(`[BACKUP] Backing up current release...`);
    const backupPath = backupRelease(repoRoot, log);

    // Step 6: Copy build artifacts to release/
    log(`[6/9] Copying build artifacts to release/...`);
    const releaseDir = path.join(repoRoot, 'release');
    const pkgDir = path.join(repoRoot, 'packages');

    // Copy core/dist (required by relay and pylon via workspace symlinks)
    const coreDistSrc = path.join(pkgDir, 'core', 'dist');
    const coreDistDest = path.join(releaseDir, 'core', 'dist');
    fs.mkdirSync(coreDistDest, { recursive: true });
    fs.cpSync(coreDistSrc, coreDistDest, { recursive: true });
    log(`  core/dist → release/core/dist`);

    // Copy updater/dist (required by pylon via workspace symlinks)
    const updaterDistSrc = path.join(pkgDir, 'updater', 'dist');
    const updaterDistDest = path.join(releaseDir, 'updater', 'dist');
    fs.mkdirSync(updaterDistDest, { recursive: true });
    fs.cpSync(updaterDistSrc, updaterDistDest, { recursive: true });
    log(`  updater/dist → release/updater/dist`);

    // Always copy pylon/dist
    const pylonDistSrc = path.join(pkgDir, 'pylon', 'dist');
    const pylonDistDest = path.join(releaseDir, 'pylon', 'dist');
    fs.mkdirSync(pylonDistDest, { recursive: true });
    fs.cpSync(pylonDistSrc, pylonDistDest, { recursive: true });
    log(`  pylon/dist → release/pylon/dist`);

    // Copy tunnel/dist (if tunnel package exists)
    const tunnelDistSrc = path.join(pkgDir, 'tunnel', 'dist');
    if (fs.existsSync(tunnelDistSrc)) {
      const tunnelDistDest = path.join(releaseDir, 'tunnel', 'dist');
      fs.mkdirSync(tunnelDistDest, { recursive: true });
      fs.cpSync(tunnelDistSrc, tunnelDistDest, { recursive: true });
      log(`  tunnel/dist → release/tunnel/dist`);

      // Copy tunnel/node_modules (has @slack/bolt dependency)
      const tunnelNodeModulesSrc = path.join(pkgDir, 'tunnel', 'node_modules');
      if (fs.existsSync(tunnelNodeModulesSrc)) {
        const tunnelNodeModulesDest = path.join(releaseDir, 'tunnel', 'node_modules');
        fs.mkdirSync(tunnelNodeModulesDest, { recursive: true });
        fs.cpSync(tunnelNodeModulesSrc, tunnelNodeModulesDest, { recursive: true });
        log(`  tunnel/node_modules → release/tunnel/node_modules`);
      }

      // Copy tunnel/package.json (for node module resolution)
      const tunnelPkgSrc = path.join(pkgDir, 'tunnel', 'package.json');
      fs.cpSync(tunnelPkgSrc, path.join(releaseDir, 'tunnel', 'package.json'));
    }

    // Copy archive/dist (if archive package exists)
    const archiveDistSrc = path.join(pkgDir, 'archive', 'dist');
    if (fs.existsSync(archiveDistSrc)) {
      const archiveDistDest = path.join(releaseDir, 'archive', 'dist');
      fs.mkdirSync(archiveDistDest, { recursive: true });
      fs.cpSync(archiveDistSrc, archiveDistDest, { recursive: true });
      log(`  archive/dist → release/archive/dist`);

      // Copy archive/node_modules (has archiver dependency)
      const archiveNodeModulesSrc = path.join(pkgDir, 'archive', 'node_modules');
      if (fs.existsSync(archiveNodeModulesSrc)) {
        const archiveNodeModulesDest = path.join(releaseDir, 'archive', 'node_modules');
        fs.mkdirSync(archiveNodeModulesDest, { recursive: true });
        fs.cpSync(archiveNodeModulesSrc, archiveNodeModulesDest, { recursive: true });
        log(`  archive/node_modules → release/archive/node_modules`);
      }

      // Copy archive/package.json (for node module resolution)
      const archivePkgSrc = path.join(pkgDir, 'archive', 'package.json');
      fs.cpSync(archivePkgSrc, path.join(releaseDir, 'archive', 'package.json'));
    }

    if (isMaster) {
      // Copy relay/dist
      const relayDistSrc = path.join(pkgDir, 'relay', 'dist');
      const relayDistDest = path.join(releaseDir, 'relay', 'dist');
      fs.mkdirSync(relayDistDest, { recursive: true });
      fs.cpSync(relayDistSrc, relayDistDest, { recursive: true });
      log(`  relay/dist → release/relay/dist`);

      // Copy relay/public
      const relayPublicSrc = path.join(pkgDir, 'relay', 'public');
      const relayPublicDest = path.join(releaseDir, 'relay', 'public');
      fs.mkdirSync(relayPublicDest, { recursive: true });
      fs.cpSync(relayPublicSrc, relayPublicDest, { recursive: true });
      log(`  relay/public → release/relay/public`);
    }

    // Remove stale @estelle copies in release/*/node_modules/
    // (Windows creates physical copies instead of symlinks, which become outdated)
    for (const pkg of ['pylon', 'relay', 'tunnel', 'archive']) {
      const staleEstelleDir = path.join(releaseDir, pkg, 'node_modules', '@estelle');
      if (fs.existsSync(staleEstelleDir)) {
        fs.rmSync(staleEstelleDir, { recursive: true, force: true });
        log(`  Removed stale ${pkg}/node_modules/@estelle`);
      }
    }

    // Ensure @estelle workspace deps in release/node_modules/ as fallback
    // (pnpm workspace symlinks through release/*/node_modules can be unreliable)
    const releaseEstelleDir = path.join(releaseDir, 'node_modules', '@estelle');
    for (const dep of ['core', 'updater']) {
      const depDest = path.join(releaseEstelleDir, dep);
      fs.rmSync(depDest, { recursive: true, force: true });
      fs.mkdirSync(depDest, { recursive: true });
      fs.cpSync(path.join(pkgDir, dep, 'package.json'), path.join(depDest, 'package.json'));
      fs.cpSync(path.join(pkgDir, dep, 'dist'), path.join(depDest, 'dist'), { recursive: true });
    }
    log(`  @estelle/{core,updater} → release/node_modules/`);

    // Read version from config/version.json
    const versionPath = path.join(repoRoot, 'config', 'version.json');
    let version = 'dev';
    try {
      const versionJson = JSON.parse(fs.readFileSync(versionPath, 'utf-8'));
      version = versionJson.version;
      log(`  Version: ${version}`);
    } catch {
      log('  Warning: could not read config/version.json, using "dev"');
    }

    // Load environment config
    let envConfig: Record<string, any> | null = null;
    if (environmentFile) {
      const envPath = path.join(repoRoot, 'config', environmentFile);
      try {
        envConfig = JSON.parse(fs.readFileSync(envPath, 'utf-8'));
        log(`  Environment: ${environmentFile}`);
      } catch {
        log(`  Warning: could not read ${environmentFile}`);
      }
    }

    // Step 7: PM2 services
    log(`[7/9] PM2 services...`);

    // Build ecosystem config
    const apps: Array<Record<string, unknown>> = [];

    const pylonPm2Name = envConfig?.pylon?.pm2Name || 'estelle-pylon';
    const pylonEnv: Record<string, string> = {
      ESTELLE_VERSION: version,
    };

    if (envConfig) {
      pylonEnv.ESTELLE_ENV_CONFIG = JSON.stringify({
        envId: envConfig.envId,
        pylon: {
          pylonIndex: (envConfig.pylon as any).pylonIndex,
          relayUrl: (envConfig.pylon as any).relayUrl,
          configDir: expandPath((envConfig.pylon as any).configDir),
          credentialsBackupDir: expandPath((envConfig.pylon as any).credentialsBackupDir),
          dataDir: path.resolve(repoRoot, (envConfig.pylon as any).dataDir),
          mcpPort: (envConfig.pylon as any).mcpPort,
          defaultWorkingDir: expandPath((envConfig.pylon as any).defaultWorkingDir),
          directPort: (envConfig.pylon as any).directPort,
        },
      });
    }

    apps.push({
      name: pylonPm2Name,
      script: 'dist/bin.js',
      cwd: path.join(repoRoot, 'release', 'pylon'),
      env: pylonEnv,
    });

    // Tunnel PM2 process (if tunnel.enabled in env config)
    if (envConfig?.tunnel?.enabled) {
      const tunnelConfig = envConfig.tunnel as Record<string, any>;
      const tunnelPm2Name = tunnelConfig.pm2Name || 'estelle-tunnel';

      // Generate config.json for tunnel
      const tunnelReleaseDir = path.join(releaseDir, 'tunnel');
      fs.mkdirSync(tunnelReleaseDir, { recursive: true });

      const tunnelConfigJson = {
        mode: tunnelConfig.mode,
        slack: tunnelConfig.slack,
        tunnel: {
          connectPort: tunnelConfig.connectPort,
          listenPort: tunnelConfig.listenPort,
        },
      };
      const tunnelConfigPath = path.join(tunnelReleaseDir, 'config.json');
      fs.writeFileSync(tunnelConfigPath, JSON.stringify(tunnelConfigJson, null, 2));
      log(`  Tunnel config written: ${tunnelConfigPath}`);

      apps.push({
        name: tunnelPm2Name,
        script: 'dist/index.js',
        cwd: tunnelReleaseDir,
        env: {
          CONFIG_PATH: tunnelConfigPath,
        },
      });
    }

    // Archive PM2 process (if archive.enabled in env config)
    if (envConfig?.archive?.enabled) {
      const archiveConfig = envConfig.archive as Record<string, any>;
      const archivePm2Name = archiveConfig.pm2Name || 'estelle-archive';

      apps.push({
        name: archivePm2Name,
        script: 'dist/bin.js',
        cwd: path.join(repoRoot, 'release', 'archive'),
        env: {
          ARCHIVE_PORT: String(archiveConfig.port || 3009),
          ARCHIVE_ROOT: expandPath(archiveConfig.root || '/home/estelle/archive'),
        },
      });
    }

    if (isMaster && envConfig?.relay) {
      const relayPm2Name = (envConfig.relay as any).pm2Name;
      if (relayPm2Name) {
        const relayPort = (envConfig.relay as any).port || 8080;
        apps.unshift({
          name: relayPm2Name,
          script: 'dist/bin.js',
          cwd: path.join(repoRoot, 'release', 'relay'),
          env: {
            PORT: String(relayPort),
            STATIC_DIR: path.join(repoRoot, 'release', 'relay', 'public'),
          },
        });
      }
    }

    // Delete existing processes (ignore failures - may not exist)
    for (const app of apps) {
      log(`  Stopping ${app.name}...`);
      await runCommand('pm2', ['delete', app.name as string], repoRoot, log);
    }

    // Write ecosystem file and start
    const ecosystemPath = path.join(repoRoot, 'release', 'ecosystem.config.cjs');
    const ecosystemContent = `module.exports = ${JSON.stringify({ apps }, null, 2)};`;
    fs.writeFileSync(ecosystemPath, ecosystemContent);
    log(`  Starting services via ecosystem config...`);

    const startResult = await runCommand('pm2', ['start', ecosystemPath], repoRoot, log);
    if (!startResult.success) {
      log(`✗ pm2 start failed: ${startResult.error}`);
      // 롤백 시도
      if (backupPath) {
        log(`Attempting rollback...`);
        const rolled = rollbackRelease(repoRoot, log);
        if (rolled) {
          log(`Restarting previous version...`);
          await runCommand('pm2', ['start', ecosystemPath], repoRoot, log);
        }
      }
      return { success: false, error: `pm2 start failed: ${startResult.error}` };
    }

    // Step 8: pm2 save
    log(`[8/9] pm2 save...`);
    await runCommand('pm2', ['save'], repoRoot, log);

    log(`✓ Update complete (${version})`);

    // Step 9: Restart updater itself (self-update)
    // All deployment steps are done, so it's safe to restart.
    // PM2 will restart the process with the new code.
    log(`[9/9] Restarting updater...`);
    await runCommand('pm2', ['restart', 'estelle-updater', '--update-env'], repoRoot, log);
    return { success: true, version };
  } finally {
    close();
  }
}
