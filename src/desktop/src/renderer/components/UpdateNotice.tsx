import { useEffect, useState } from 'react';
import type { UpdateStatus } from '../../shared/api';
import { api, errorMessage } from '../api';
import { Icon } from '../icons/Icon';

/** A newer version, on the start screen: what's new, and updating to it in one click. Then how it went. */
export function UpdateNotice({ version }: { readonly version: string }) {
  const status = useUpdateStatus();
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (status.state === 'none' || dismissed === `${status.state} ${status.version}`) return null;

  const whatsNew = (
    <a href={status.url} target="_blank" rel="noreferrer">
      What's new
    </a>
  );
  const dismiss = (label: string) => (
    <button onClick={() => setDismissed(`${status.state} ${status.version}`)}>{label}</button>
  );
  const install = () => {
    setError(null);
    api.updates.install().catch((caught: unknown) => setError(errorMessage(caught)));
  };

  let body;
  switch (status.state) {
    case 'available':
      body = (
        <>
          <h2>
            <Icon name="cycle" /> Commander Brawl {status.version} is out
          </h2>
          <p className="hint">
            You have {version}.{' '}
            {status.canInstall
              ? 'Updating takes a minute: the app downloads the new version, closes, and opens again.'
              : "This copy of the app can't update itself, so get the new version from the release page."}{' '}
            {whatsNew}
          </p>
          <div className="row">
            {status.canInstall ? (
              <button className="primary" onClick={install}>
                Update and restart
              </button>
            ) : (
              <button className="primary" onClick={() => window.open(status.url)}>
                Release page
              </button>
            )}
            {dismiss('Not now')}
          </div>
        </>
      );
      break;
    case 'downloading':
      body = (
        <>
          <h2>
            <Icon name="cycle" /> Downloading Commander Brawl {status.version}… {Math.round(status.progress * 100)}%
          </h2>
          <progress value={status.progress} max={1} />
        </>
      );
      break;
    case 'restarting':
      body = (
        <h2>
          <Icon name="cycle" /> Installing Commander Brawl {status.version}. The app closes and opens again in a moment.
        </h2>
      );
      break;
    case 'failed':
      body = (
        <>
          <h2>
            <Icon name="hazard-sign" /> Updating to {status.version} didn't work
          </h2>
          <p className="hint">
            {status.message} {whatsNew}
          </p>
          <div className="row">
            {status.canInstall && (
              <button className="primary" onClick={install}>
                Try again
              </button>
            )}
            {dismiss('Dismiss')}
          </div>
        </>
      );
      break;
    case 'updated':
      body = (
        <>
          <h2>
            <Icon name="cycle" /> Updated to Commander Brawl {status.version}
          </h2>
          <p className="hint">{whatsNew}</p>
          <div className="row">{dismiss('OK')}</div>
        </>
      );
      break;
  }

  return (
    <section className="update-notice" data-testid="update-notice">
      {body}
      {error && <p className="status status-reconnecting">{error}</p>}
    </section>
  );
}

function useUpdateStatus(): UpdateStatus {
  const [status, setStatus] = useState<UpdateStatus>({ state: 'none' });
  useEffect(() => {
    let active = true;
    // A change that arrives first is newer than the answer to asking.
    let changed = false;
    const off = api.updates.onStatus((next) => {
      changed = true;
      setStatus(next);
    });
    void api.updates.status().then((initial) => {
      if (active && !changed) setStatus(initial);
    });
    return () => {
      active = false;
      off();
    };
  }, []);
  return status;
}
