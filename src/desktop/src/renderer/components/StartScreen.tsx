import { useState } from 'react';
import type { HostInfo } from '../../shared/api';
import { api, errorMessage } from '../api';
import type { CameraState } from '../useCamera';
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
  const [busy, setBusy] = useState<'host' | 'join' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (kind: 'host' | 'join') => {
    setBusy(kind);
    setError(null);
    localStorage.setItem(NAME_KEY, name);
    try {
      if (kind === 'host') {
        onHosted(await api.table.host(name));
      } else {
        await api.table.join(invite, name);
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
        <h1>Commander Brawl</h1>

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
          <button onClick={onOpenCamera}>Set up camera</button>
        </div>

        <div className="start-actions">
          <section>
            <h2>Host a table</h2>
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
          <section>
            <h2>Join a table</h2>
            <textarea
              value={invite}
              rows={3}
              placeholder="Paste the invite code from the host"
              onChange={(event) => setInvite(event.target.value)}
              data-testid="invite-input"
            />
            <button
              className="primary"
              disabled={busy !== null || !name.trim() || !invite.trim()}
              onClick={() => void run('join')}
              data-testid="join"
            >
              {busy === 'join' ? 'Joining…' : 'Join'}
            </button>
          </section>
        </div>

        {error && <p className="status status-reconnecting">{error}</p>}
        <footer className="hint">Version {version}</footer>
      </div>
    </div>
  );
}
