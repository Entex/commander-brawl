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
    savedTable: () => ipcRenderer.invoke(Channels.tableSaved),
    resume: () => ipcRenderer.invoke(Channels.tableResume),
    discardSavedTable: () => ipcRenderer.invoke(Channels.tableDiscardSaved),
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
  cards: {
    status: () => ipcRenderer.invoke(Channels.cardsStatus),
    onStatus: (listener) => listen(Channels.cardsStatusUpdate, listener),
    search: (query) => ipcRenderer.invoke(Channels.cardsSearch, query),
    byNames: (names) => ipcRenderer.invoke(Channels.cardsByNames, names),
    byIds: (ids) => ipcRenderer.invoke(Channels.cardsByIds, ids),
    closest: (texts) => ipcRenderer.invoke(Channels.cardsClosest, texts),
    details: (id) => ipcRenderer.invoke(Channels.cardsDetails, id),
    refresh: () => ipcRenderer.invoke(Channels.cardsRefresh),
  },
  decks: {
    list: () => ipcRenderer.invoke(Channels.decksList),
    import: (source) => ipcRenderer.invoke(Channels.decksImport, source),
    save: (deck, id) => ipcRenderer.invoke(Channels.decksSave, deck, id),
    analyze: (deck) => ipcRenderer.invoke(Channels.decksAnalyze, deck),
    remove: (id) => ipcRenderer.invoke(Channels.decksRemove, id),
  },
  phone: {
    info: () => ipcRenderer.invoke(Channels.phoneInfo),
    send: (message) => ipcRenderer.send(Channels.phoneSend, message),
    onEvent: (listener) => listen(Channels.phoneEvent, listener),
  },
};

contextBridge.exposeInMainWorld('brawl', api);
