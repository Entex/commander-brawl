import {
  archiveName,
  checksumFor,
  downloadChecked,
  downloadText,
  hasReleaseSigningKey,
  installDir,
  installerError,
  installerLogs,
  installScriptName,
  isNewerVersion,
  latestRelease,
  startInstaller,
  verifyReleaseChecksums,
  type Release,
  type UpdateOptions,
} from '@commander-brawl/infrastructure/node';
import { readFileSync } from 'node:fs';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { UpdateStatus } from '../shared/api';

export interface UpdateServiceOptions extends UpdateOptions {
  /** The app's folder for its own files. */
  readonly dataDir: string;
  /** The app's program file (process.execPath), to tell where it's installed. */
  readonly executable: string;
  readonly platform: NodeJS.Platform;
  readonly arch: string;
  emit(status: UpdateStatus): void;
  /** Closes the app, so the install script can put the new version in place. */
  quit(): void;
}

/** What was being installed, kept across the restart to say afterwards whether it worked. */
interface Attempt {
  readonly version: string;
  readonly url: string;
}

/**
 * Looks for a newer version when the app starts, and updates to it when asked: downloads it, checks it, and hands
 * it to the install script, which puts it in place and starts it once the app has closed.
 */
export class UpdateService {
  private current: UpdateStatus = { state: 'none' };
  private release: Release | null = null;

  constructor(private readonly options: UpdateServiceOptions) {}

  private get folder(): string {
    return join(this.options.dataDir, 'update');
  }

  private get attemptFile(): string {
    return join(this.options.dataDir, 'update-attempt.json');
  }

  status(): UpdateStatus {
    return this.current;
  }

  /** Says how the last update went, if one was just made, then looks for a newer version. */
  async start(): Promise<void> {
    await this.reportLastAttempt();
    let release: Release | null;
    try {
      release = await latestRelease(this.options);
    } catch (error) {
      console.warn('[updates] could not look for a newer version', error);
      return;
    }
    if (!release || !isNewerVersion(release.version, this.options.appVersion)) return;
    this.release = release;
    // A failed attempt at this same version stays on screen, with its reason, and offers to try again.
    if (this.current.state === 'failed' && this.current.version === release.version) {
      this.setStatus({ ...this.current, canInstall: this.canInstall() });
      return;
    }
    this.setStatus({ state: 'available', version: release.version, url: release.url, canInstall: this.canInstall() });
  }

  /** Downloads the new version and restarts into it. */
  async install(): Promise<void> {
    const release = this.release;
    const dir = installDir(this.options.executable, this.options.platform);
    const archive = archiveName(this.options.platform, this.options.arch);
    if (!release || !dir || !archive || !this.canInstall()) {
      throw new Error("This copy of the app can't update itself.");
    }
    if (this.current.state === 'downloading' || this.current.state === 'restarting') return;
    const { version, url } = release;
    const script = installScriptName(this.options.platform);
    try {
      this.setStatus({ state: 'downloading', version, url, progress: 0 });
      const sums = await downloadText(this.file(release, 'SHA256SUMS'), this.options);
      const signature = await downloadText(this.file(release, 'SHA256SUMS.sig'), this.options);
      verifyReleaseChecksums(sums, signature, version);
      const sumOf = (name: string) => {
        const sum = checksumFor(sums, name);
        if (!sum) throw new Error(`The release has no checksum for ${name}.`);
        return sum;
      };
      await rm(this.folder, { recursive: true, force: true });
      await downloadChecked(this.file(release, script), join(this.folder, script), sumOf(script), this.options);
      let percent = 0;
      await downloadChecked(this.file(release, archive), join(this.folder, archive), sumOf(archive), {
        ...this.options,
        onProgress: (progress) => {
          // Told in whole percents: the download comes in thousands of pieces.
          if (Math.floor(progress * 100) === percent) return;
          percent = Math.floor(progress * 100);
          this.setStatus({ state: 'downloading', version, url, progress });
        },
      });
      await writeFile(this.attemptFile, JSON.stringify({ version, url } satisfies Attempt));
      await startInstaller({
        platform: this.options.platform,
        script: join(this.folder, script),
        archive: join(this.folder, archive),
        installDir: dir,
        log: join(this.folder, 'install.log'),
      });
    } catch (error) {
      console.warn('[updates] update failed', error);
      await rm(this.attemptFile, { force: true }).catch(() => undefined);
      this.setStatus({
        state: 'failed',
        version,
        url,
        message: (error as Error).message,
        canInstall: this.canInstall(),
      });
      return;
    }
    this.setStatus({ state: 'restarting', version, url });
    this.options.quit();
  }

  /**
   * In place by the install script, and able to start again after it: on Linux systems that block Chromium's
   * sandbox, the app only starts after a command run as root, which a new version would need again.
   */
  private canInstall(): boolean {
    if (!hasReleaseSigningKey()) return false;
    if (!this.release?.files.has('SHA256SUMS.sig')) return false;
    if (!installDir(this.options.executable, this.options.platform)) return false;
    if (!archiveName(this.options.platform, this.options.arch)) return false;
    return this.options.platform !== 'linux' || !sandboxRestricted();
  }

  private file(release: Release, name: string): string {
    const url = release.files.get(name);
    if (!url) throw new Error(`The release has no ${name}.`);
    return url;
  }

  /** After a restart from an update: whether the new version is the one running, and why not if it isn't. */
  private async reportLastAttempt(): Promise<void> {
    let attempt: Attempt;
    try {
      attempt = JSON.parse(await readFile(this.attemptFile, 'utf8')) as Attempt;
    } catch {
      return;
    }
    const logs = installerLogs(join(this.folder, 'install.log'));
    const log = (await Promise.all(logs.map((file) => readFile(file, 'utf8').catch(() => '')))).join('\n');
    await rm(this.attemptFile, { force: true });
    // The downloaded version is no longer needed either way. (On Windows the script may still be finishing.)
    await rm(this.folder, { recursive: true, force: true }).catch(() => undefined);
    if (typeof attempt.version !== 'string' || typeof attempt.url !== 'string') return;
    if (attempt.version === this.options.appVersion) {
      this.setStatus({ state: 'updated', version: attempt.version, url: attempt.url });
    } else {
      const reason = installerError(log) ?? "the install script didn't finish";
      this.setStatus({
        state: 'failed',
        version: attempt.version,
        url: attempt.url,
        message: reason,
        canInstall: false,
      });
    }
  }

  private setStatus(status: UpdateStatus): void {
    this.current = status;
    this.options.emit(status);
  }
}

/** Ubuntu 24.04 and newer block the sandbox Chromium uses unless it's set up as root (see install.sh). */
function sandboxRestricted(): boolean {
  try {
    return readFileSync('/proc/sys/kernel/apparmor_restrict_unprivileged_userns', 'utf8').trim() === '1';
  } catch {
    return false;
  }
}
