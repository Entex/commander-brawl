import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { Channels, type DesktopApi } from '../shared/api';

function listen<T>(channel: string, listener: (payload: T) => void): () => void {
  const handler = (_event: IpcRendererEvent, payload: T) => listener(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.off(channel, handler);
}

const api: DesktopApi = {
  config: () => ipcRenderer.invoke(Channels.config),
  table: {
    host: (name) => ipcRenderer.invoke(Channels.tableHost, name),
    join: (invite, name) => ipcRenderer.invoke(Channels.tableJoin, invite, name),
    leave: () => ipcRenderer.invoke(Channels.tableLeave),
    send: (to, data) => ipcRenderer.send(Channels.tableSend, to, data),
    snapshot: () => ipcRenderer.invoke(Channels.tableSnapshot),
    onEvent: (listener) => listen(Channels.tableEvent, listener),
  },
  game: {
    view: () => ipcRenderer.invoke(Channels.gameView),
    submit: (event) => ipcRenderer.send(Channels.gameSubmit, event),
    onView: (listener) => listen(Channels.gameUpdate, listener),
    log: () => ipcRenderer.invoke(Channels.gameLog),
    saveLog: (text) => ipcRenderer.invoke(Channels.gameSaveLog, text),
  },
  phone: {
    info: () => ipcRenderer.invoke(Channels.phoneInfo),
    send: (message) => ipcRenderer.send(Channels.phoneSend, message),
    onEvent: (listener) => listen(Channels.phoneEvent, listener),
  },
};

contextBridge.exposeInMainWorld('brawl', api);
