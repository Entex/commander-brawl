import { useEffect, useState } from 'react';
import type { HostInfo, SavedTableSummary } from '../../shared/api';
import { api, errorMessage } from '../api';
import { Icon } from '../icons/Icon';
import type { CameraState } from '../useCamera';
import { DecksPanel } from './DecksPanel';
import { HistoryPanel } from './HistoryPanel';
import { VideoView } from './VideoView';

interface StartScreenProps {
  readonly version: string;
  readonly camera: CameraState;
  onOpenCamera(): void;
  onHosted(info: HostInfo): void;
  onJoined(): void;
}

const NAME_KEY = 'cb.name';

export function StartScreen({ version, camera, onOpenCamera, onHosted, onJoined }: StartScreenProps) {
  const [name, setName] = useState(() => localStorage.getItem(NAME_KEY) ?? '');
  const [invite, setInvite] = useState('');
  const [busy, setBusy] = useState<'host' | 'join' | 'watch' | 'resume' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const saved = useSavedTable();
  const [decksOpen, setDecksOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  const run = async (kind: 'host' | 'join' | 'watch' | 'resume') => {
    setBusy(kind);
    setError(null);
    if (kind !== 'resume') localStorage.setItem(NAME_KEY, name);
    try {
      if (kind === 'resume') {
        onHosted(await api.table.resume());
      } else if (kind === 'host') {
        onHosted(await api.table.host(name));
      } else {
        await (kind === 'watch' ? api.table.watch(invite, name) : api.table.join(invite, name));
        onJoined();
      }
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="start-screen">
      <div className="panel start-panel">
        <header className="start-title">
          <Icon name="crossed-sabres" className="start-logo" />
          <div>
            <h1>Commander Brawl</h1>
            <p className="hint">Commander with friends, over cameras. No accounts, no servers.</p>
          </div>
        </header>

        {saved.table && (
          <section className="resume" data-testid="resume">
            <h2>
              <Icon name="castle" /> Resume your table?
            </h2>
            <p className="hint">
              You were hosting{saved.table.players.length > 0 ? ` ${listNames(saved.table.players)}` : ' a table'} when
              the app closed (last change at {formatSavedAt(saved.table.savedAt)}). Their apps keep trying to reconnect,
              so they'll come straight back.
            </p>
            <div className="row">
              <button className="primary" disabled={busy !== null} onClick={() => void run('resume')}>
                {busy === 'resume' ? 'Opening the table…' : 'Resume table'}
              </button>
              <button disabled={busy !== null} onClick={() => void saved.discard()}>
                Discard
              </button>
            </div>
          </section>
        )}

        <label className="field">
          <span>Your name</span>
          <input
            value={name}
            maxLength={24}
            placeholder="e.g. Robin"
            onChange={(event) => setName(event.target.value)}
            data-testid="name"
          />
        </label>

        <div className="start-camera">
          {camera.track ? (
            <VideoView track={camera.track} className="preview-video" />
          ) : (
            <p className="hint">No camera yet. Set it up now or once you're at the table.</p>
          )}
          <button onClick={onOpenCamera}>
            <Icon name="photo-camera" /> Set up camera
          </button>
          <button onClick={() => setDecksOpen(true)}>
            <Icon name="card-draw" /> Decks
          </button>
          <button onClick={() => setHistoryOpen(true)}>
            <Icon name="tied-scroll" /> History
          </button>
        </div>

        <div className="start-actions">
          <section className="start-choice">
            <h2>
              <Icon name="castle" /> Host a table
            </h2>
            <p className="hint">You'll get an invite code to share with your friends.</p>
            <button
              className="primary"
              disabled={busy !== null || !name.trim()}
              onClick={() => void run('host')}
              data-testid="host"
            >
              {busy === 'host' ? 'Opening the table…' : 'Host'}
            </button>
          </section>
          <section className="start-choice">
            <h2>
              <Icon name="open-gate" /> Join a table
            </h2>
            <textarea
              value={invite}
              rows={3}
              placeholder="Paste the invite code from the host"
              onChange={(event) => setInvite(event.target.value)}
              data-testid="invite-input"
            />
            <div className="start-buttons">
              <button
                className="primary"
                disabled={busy !== null || !name.trim() || !invite.trim()}
                onClick={() => void run('join')}
                data-testid="join"
              >
                {busy === 'join' ? 'Joining…' : 'Join'}
              </button>
              <button
                disabled={busy !== null || !name.trim() || !invite.trim()}
                onClick={() => void run('watch')}
                title="Watch the game without taking a seat: you see everything and change nothing"
                data-testid="watch"
              >
                <Icon name="spyglass" /> {busy === 'watch' ? 'Joining…' : 'Watch'}
              </button>
            </div>
          </section>
        </div>

        {error && <p className="status status-reconnecting">{error}</p>}
        <footer className="hint">
          Version {version} · Icons from{' '}
          <a href="https://game-icons.net" target="_blank" rel="noreferrer">
            game-icons.net
          </a>{' '}
          (CC BY 3.0)
          <br />
          {/* The notice Wizards of the Coast's Fan Content Policy asks for, word for word. */}
          Commander Brawl is unofficial Fan Content permitted under the{' '}
          <a href="https://company.wizards.com/en/legal/fancontentpolicy" target="_blank" rel="noreferrer">
            Fan Content Policy
          </a>
          . Not approved/endorsed by Wizards. Portions of the materials used are property of Wizards of the Coast.
          ©Wizards of the Coast LLC.
        </footer>
      </div>
      {decksOpen && <DecksPanel seat={null} playing={null} onClose={() => setDecksOpen(false)} />}
      {historyOpen && <HistoryPanel onClose={() => setHistoryOpen(false)} />}
    </div>
  );
}

function useSavedTable(): { table: SavedTableSummary | null; discard(): Promise<void> } {
  const [table, setTable] = useState<SavedTableSummary | null>(null);
  useEffect(() => {
    let active = true;
    void api.table.savedTable().then((found) => {
      if (active) setTable(found);
    });
    return () => {
      active = false;
    };
  }, []);
  return {
    table,
    discard: async () => {
      await api.table.discardSavedTable();
      setTable(null);
    },
  };
}

function listNames(names: readonly string[]): string {
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
  return `with ${list}`;
}

function formatSavedAt(at: number): string {
  const date = new Date(at);
  const today = new Date().toDateString() === date.toDateString();
  return today
    ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });
}
