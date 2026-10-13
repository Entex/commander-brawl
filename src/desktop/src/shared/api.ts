import type {
  GameRecord,
  GameView,
  ImportedDeck,
  LoggedEvent,
  NameMatch,
  SignalingEvent,
} from '@commander-brawl/application';
import type { Card, DeckAnalysis, DeckList, GameAction, Ruling } from '@commander-brawl/domain';
import type { DesktopToPhone, PhoneToDesktop } from '@commander-brawl/infrastructure/protocol';

/** How friends outside your home can reach the table you host. */
export type Reachability =
  | { readonly kind: 'internet'; readonly address: string; readonly port: number }
  | { readonly kind: 'blocked'; readonly reason: string; readonly port: number };

export interface HostInfo {
  readonly invite: string;
  readonly reachability: Reachability;
  /** A resumed table couldn't get its old port back, so friends need the new invite. */
  readonly portChanged: boolean;
}

/** A table this app was hosting when it closed, which can be resumed. */
export interface SavedTableSummary {
  readonly savedAt: number;
  readonly playerName: string;
  /** The other players at the table. */
  readonly players: readonly string[];
}

export interface IceServerConfig {
  readonly urls: string | string[];
  readonly username?: string;
  readonly credential?: string;
}

export interface RendererConfig {
  readonly version: string;
  /** null means "use the defaults"; an empty list means "local network only" (used by tests). */
  readonly iceServers: IceServerConfig[] | null;
}

export type PhoneLinkEvent =
  | { readonly type: 'connected' }
  | { readonly type: 'disconnected' }
  | { readonly type: 'message'; readonly message: PhoneToDesktop };

export interface PhoneLinkInfo {
  /** One link per local network address of this computer; the first is the best guess. */
  readonly urls: readonly string[];
  readonly connected: boolean;
}

/** The card data on this computer. */
export type CardDataStatus =
  | { readonly state: 'missing' }
  | { readonly state: 'downloading'; readonly progress: number }
  | { readonly state: 'ready'; readonly count: number; readonly updatedAt: string }
  /** The download failed. Older cards may still be there (count > 0). */
  | { readonly state: 'error'; readonly message: string; readonly count: number };

export interface CardDetails {
  readonly card: Card;
  readonly rulings: readonly Ruling[];
}

export interface SavedDeck extends DeckList {
  readonly id: string;
  readonly savedAt: number;
}

/** What the preload script exposes to the UI as `window.brawl`. */
export interface DesktopApi {
  config(): Promise<RendererConfig>;
  table: {
    host(name: string): Promise<HostInfo>;
    savedTable(): Promise<SavedTableSummary | null>;
    resume(): Promise<HostInfo>;
    discardSavedTable(): Promise<void>;
    join(invite: string, name: string): Promise<void>;
    leave(): Promise<void>;
    send(to: string, data: unknown): void;
    /** Events that describe the current state, for when the UI starts listening late. */
    snapshot(): Promise<SignalingEvent[]>;
    onEvent(listener: (event: SignalingEvent) => void): () => void;
  };
  game: {
    /** The current game, or null when you're not at a table. */
    view(): Promise<GameView | null>;
    submit(event: GameAction): void;
    onView(listener: (view: GameView) => void): () => void;
    /** The whole log, oldest first. */
    log(): Promise<readonly LoggedEvent[]>;
    /** Asks where to save the text, then saves it. False if the player cancelled. */
    saveLog(text: string): Promise<boolean>;
    /** The same, for a game's recap. */
    saveRecap(text: string): Promise<boolean>;
  };
  cards: {
    status(): Promise<CardDataStatus>;
    onStatus(listener: (status: CardDataStatus) => void): () => void;
    search(query: string): Promise<readonly Card[]>;
    /** The cards with these names, null where there's no such card. */
    byNames(names: readonly string[]): Promise<readonly (Card | null)[]>;
    /** The cards with these ids (as in deck lists), null where there's no such card. */
    byIds(ids: readonly string[]): Promise<readonly (Card | null)[]>;
    /** Every plane and phenomenon (Planechase), or every scheme (Archenemy). */
    variantCards(variant: 'planechase' | 'archenemy'): Promise<readonly Card[]>;
    /** The cards whose names best match text read off a card in a camera picture, best first. */
    closest(texts: readonly string[]): Promise<readonly NameMatch[]>;
    details(id: string): Promise<CardDetails | null>;
    refresh(): Promise<void>;
  };
  decks: {
    list(): Promise<readonly SavedDeck[]>;
    /** A Moxfield or Archidekt link, or a pasted deck list. */
    import(source: string): Promise<ImportedDeck>;
    save(deck: DeckList, id: string | null): Promise<SavedDeck>;
    /** Checks the deck for bracket concerns: Game Changers, combos, land denial, extra turns. */
    analyze(deck: DeckList): Promise<DeckAnalysis>;
    remove(id: string): Promise<void>;
  };
  clips: {
    /** Asks where to save the video (a WebM file), then saves it. False if the player cancelled. */
    save(video: Uint8Array): Promise<boolean>;
  };
  history: {
    /** Finished games kept on this computer, oldest first. */
    list(): Promise<readonly GameRecord[]>;
    /** Asks where to save the history as a file, then saves it. False if the player cancelled. */
    export(): Promise<boolean>;
    /** Asks for a history file (a friend's export) and adds its games. How many were new; null if cancelled. */
    import(): Promise<number | null>;
  };
  phone: {
    info(): Promise<PhoneLinkInfo>;
    send(message: DesktopToPhone): void;
    onEvent(listener: (event: PhoneLinkEvent) => void): () => void;
  };
}

export const Channels = {
  config: 'config',
  tableHost: 'table:host',
  tableSaved: 'table:saved',
  tableResume: 'table:resume',
  tableDiscardSaved: 'table:discard-saved',
  tableJoin: 'table:join',
  tableLeave: 'table:leave',
  tableSend: 'table:send',
  tableSnapshot: 'table:snapshot',
  tableEvent: 'table:event',
  gameView: 'game:view',
  gameSubmit: 'game:submit',
  gameUpdate: 'game:update',
  gameLog: 'game:log',
  gameSaveLog: 'game:save-log',
  gameSaveRecap: 'game:save-recap',
  cardsStatus: 'cards:status',
  cardsStatusUpdate: 'cards:status-update',
  cardsSearch: 'cards:search',
  cardsByNames: 'cards:by-names',
  cardsByIds: 'cards:by-ids',
  cardsClosest: 'cards:closest',
  cardsVariant: 'cards:variant',
  clipsSave: 'clips:save',
  historyList: 'history:list',
  historyExport: 'history:export',
  historyImport: 'history:import',
  cardsDetails: 'cards:details',
  cardsRefresh: 'cards:refresh',
  decksList: 'decks:list',
  decksImport: 'decks:import',
  decksSave: 'decks:save',
  decksAnalyze: 'decks:analyze',
  decksRemove: 'decks:remove',
  phoneInfo: 'phone:info',
  phoneSend: 'phone:send',
  phoneEvent: 'phone:event',
} as const;
