import type {
  GameRecord,
  GameView,
  ImportedDeck,
  LoggedEvent,
  NameMatch,
  SignalingEvent,
} from '@commander-brawl/application';
import type { Card, DeckAnalysis, DeckList, GameAction, Printing, Ruling } from '@commander-brawl/domain';
import type { DesktopToPhone, PhoneToDesktop } from '@commander-brawl/infrastructure/protocol';

/** How friends outside your home can reach the table you host. */
export type Reachability =
  | { readonly kind: 'internet'; readonly address: string; readonly port: number }
  /**
   * The router didn't open the port itself (`reason`: why), and it couldn't be checked from here whether it's
   * forwarded by hand (to `localAddress`). The invite has the public `address` in case it is.
   */
  | {
      readonly kind: 'forward';
      readonly reason: string;
      readonly address: string;
      readonly localAddress: string | null;
      readonly port: number;
    }
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
  /** Ask a player who has no deck chosen for it when a game starts. */
  readonly askForDeck: boolean;
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

/** A newer version of the app, and updating to it. */
export type UpdateStatus =
  | { readonly state: 'none' }
  | {
      readonly state: 'available';
      readonly version: string;
      /** The release's page, which says what's new. */
      readonly url: string;
      /** Installed with the install script, so it can update itself. Otherwise it's downloaded by hand. */
      readonly canInstall: boolean;
    }
  | { readonly state: 'downloading'; readonly version: string; readonly url: string; readonly progress: number }
  /** The install script has taken over: the app closes and the new version starts. */
  | { readonly state: 'restarting'; readonly version: string; readonly url: string }
  | {
      readonly state: 'failed';
      readonly version: string;
      readonly url: string;
      readonly message: string;
      /** Whether trying again from inside the app is possible. */
      readonly canInstall: boolean;
    }
  /** The app was just updated to this version. */
  | { readonly state: 'updated'; readonly version: string; readonly url: string };

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
    /** Joins to watch: no seat, no camera, nothing to change. */
    watch(invite: string, name: string): Promise<void>;
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
    /** The tokens these cards make (a deck's), as their own cards. */
    tokens(ids: readonly string[]): Promise<readonly Card[]>;
    /** The pictures of these printings (as Card.image is), null where it can't be had. Asks Scryfall. */
    printings(printings: readonly Printing[]): Promise<readonly (string | null)[]>;
    /** Every artwork of these cards (as Card.image is), by card: their other printings. Asks Scryfall. */
    artworks(ids: readonly string[]): Promise<Readonly<Record<string, readonly string[]>>>;
    /** Every plane and phenomenon (Planechase), or every scheme (Archenemy). */
    variantCards(variant: 'planechase' | 'archenemy'): Promise<readonly Card[]>;
    /** The cards whose names best match text read off a card in a camera picture, best first. */
    closest(texts: readonly string[]): Promise<readonly NameMatch[]>;
    details(id: string): Promise<CardDetails | null>;
    refresh(): Promise<void>;
  };
  decks: {
    list(): Promise<readonly SavedDeck[]>;
    /** A deck site's link (Moxfield, Archidekt…), or a pasted deck list. */
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
  invites: {
    /** An invite link that opened the app, once: the next call gives null. */
    take(): Promise<string | null>;
    /** An invite link opened while the app is running. */
    onOpened(listener: (code: string) => void): () => void;
  };
  updates: {
    status(): Promise<UpdateStatus>;
    onStatus(listener: (status: UpdateStatus) => void): () => void;
    /** Downloads the new version and restarts into it. */
    install(): Promise<void>;
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
  tableWatch: 'table:watch',
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
  cardsTokens: 'cards:tokens',
  cardsPrintings: 'cards:printings',
  cardsArtworks: 'cards:artworks',
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
  invitesTake: 'invites:take',
  invitesOpened: 'invites:opened',
  updatesStatus: 'updates:status',
  updatesStatusUpdate: 'updates:status-update',
  updatesInstall: 'updates:install',
  phoneInfo: 'phone:info',
  phoneSend: 'phone:send',
  phoneEvent: 'phone:event',
} as const;
