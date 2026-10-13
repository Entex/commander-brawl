import { lanAddresses, loadOrCreateIdentity } from '@commander-brawl/infrastructure/node';
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  session,
  shell,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
} from 'electron';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Channels, type RendererConfig } from '../shared/api';
import { PhoneLinkService } from './phoneLinkService';
import { TableService } from './tableService';

// Settings for development and tests. Players never need these.
const env = {
  userDataDir: process.env.CB_USER_DATA_DIR,
  rendererUrl: process.env.CB_RENDERER_URL,
  phonePort: Number(process.env.CB_PHONE_PORT ?? 47800),
  tablePort: Number(process.env.CB_TABLE_PORT ?? 47801),
  useUpnp: process.env.CB_UPNP !== 'off',
  localOnly: process.env.CB_LOCAL_ONLY === '1',
  /** Save files here without asking, for tests. */
  saveDir: process.env.CB_SAVE_DIR,
};

if (env.userDataDir) app.setPath('userData', env.userDataDir);

// Chromium normally hides this computer's local addresses from WebRTC. Video links are only set up
// with players at our own table, and phones on the Wi-Fi need the real address to connect reliably.
app.commandLine.appendSwitch('disable-features', 'WebRtcHideLocalIpsWithMdns');

let mainWindow: BrowserWindow | null = null;
let cleanup: (() => Promise<void>) | null = null;

void start();

async function start(): Promise<void> {
  await app.whenReady();
  const dataDir = app.getPath('userData');
  const identity = await loadOrCreateIdentity(join(dataDir, 'tls'), lanAddresses());

  const phone = await PhoneLinkService.start({
    identity,
    dataDir,
    staticDir: join(__dirname, 'phone'),
    preferredPort: env.phonePort,
    emit: (event) => mainWindow?.webContents.send(Channels.phoneEvent, event),
  });
  const table = new TableService({
    identity,
    preferredPort: env.tablePort,
    useUpnp: env.useUpnp,
    tableDir: join(dataDir, 'hosted-table'),
    emit: (event) => mainWindow?.webContents.send(Channels.tableEvent, event),
    emitGame: (view) => mainWindow?.webContents.send(Channels.gameUpdate, view),
  });
  cleanup = async () => {
    await Promise.all([table.shutdown(), phone.close()]);
  };

  registerIpc(table, phone);
  restrictPermissions();
  mainWindow = createWindow();
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'Commander Brawl',
    backgroundColor: '#101217',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null;
  });
  if (env.rendererUrl) {
    void window.loadURL(env.rendererUrl);
  } else {
    void window.loadFile(join(__dirname, 'renderer', 'index.html'));
  }
  return window;
}

function registerIpc(table: TableService, phone: PhoneLinkService): void {
  const config: RendererConfig = { version: app.getVersion(), iceServers: env.localOnly ? [] : null };
  handle(Channels.config, () => config);
  handle(Channels.tableHost, (name) => table.host(requireString(name)));
  handle(Channels.tableSaved, () => table.savedTable());
  handle(Channels.tableResume, () => table.resume());
  handle(Channels.tableDiscardSaved, () => table.discardSavedTable());
  handle(Channels.tableJoin, (invite, name) => table.join(requireString(invite), requireString(name)));
  handle(Channels.tableLeave, () => table.leave());
  handle(Channels.tableSnapshot, () => table.snapshot());
  handle(Channels.gameView, () => table.gameView());
  handle(Channels.gameLog, () => table.gameLog());
  handle(Channels.gameSaveLog, (text) => saveText(requireString(text)));
  handle(Channels.phoneInfo, () => phone.info());
  on(Channels.tableSend, (to, data) => {
    if (typeof to === 'string') table.send(to, data);
  });
  on(Channels.gameSubmit, (event) => table.submitGameEvent(event));
  on(Channels.phoneSend, (message) => phone.send(message as never));
}

function handle(channel: string, handler: (...args: unknown[]) => unknown): void {
  ipcMain.handle(channel, (event: IpcMainInvokeEvent, ...args: unknown[]) => {
    if (event.sender !== mainWindow?.webContents) throw new Error('Unknown sender');
    return handler(...args);
  });
}

function on(channel: string, listener: (...args: unknown[]) => void): void {
  ipcMain.on(channel, (event: IpcMainEvent, ...args: unknown[]) => {
    if (event.sender === mainWindow?.webContents) listener(...args);
  });
}

async function saveText(text: string): Promise<boolean> {
  const name = `commander-brawl-log-${new Date().toISOString().slice(0, 10)}.txt`;
  let path: string | undefined;
  if (env.saveDir) {
    path = join(env.saveDir, name);
  } else if (mainWindow) {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Save the game log',
      defaultPath: join(app.getPath('documents'), name),
      filters: [{ name: 'Text', extensions: ['txt'] }],
    });
    path = result.canceled ? undefined : result.filePath;
  }
  if (!path) return false;
  await writeFile(path, text, 'utf8');
  return true;
}

function requireString(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Expected text');
  return value;
}

/** The UI may use the camera and write to the clipboard. Nothing else. */
function restrictPermissions(): void {
  const allowed = new Set(['media', 'clipboard-sanitized-write']);
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const videoOnly = !('mediaTypes' in details) || (details.mediaTypes ?? []).every((type) => type === 'video');
    callback(webContents === mainWindow?.webContents && allowed.has(permission) && videoOnly);
  });
  session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
    return webContents === mainWindow?.webContents && allowed.has(permission);
  });
}

app.on('window-all-closed', () => app.quit());

let cleanedUp = false;
app.on('will-quit', (event) => {
  if (cleanedUp || !cleanup) return;
  event.preventDefault();
  void cleanup()
    .catch((error: unknown) => console.error('[app] cleanup failed', error))
    .finally(() => {
      cleanedUp = true;
      // Wait until Electron has finished handling this quit attempt. If the cleanup was quick, quitting
      // again right away would be ignored as part of the attempt we just cancelled, and the app would hang.
      setTimeout(() => app.quit(), 0);
    });
});
