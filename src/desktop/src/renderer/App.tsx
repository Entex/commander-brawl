import { useEffect, useState } from 'react';
import type { HostInfo, RendererConfig } from '../shared/api';
import { api } from './api';
import { CameraPanel } from './components/CameraPanel';
import { StartScreen } from './components/StartScreen';
import { TableScreen } from './components/TableScreen';
import { useCamera } from './useCamera';

type Screen = { readonly kind: 'start' } | { readonly kind: 'table'; readonly host: HostInfo | null };

export function App() {
  const [config, setConfig] = useState<RendererConfig | null>(null);
  const [screen, setScreen] = useState<Screen>({ kind: 'start' });
  const [cameraOpen, setCameraOpen] = useState(false);
  const camera = useCamera();
  // The start screen's invite, which an invite link fills in: the one that opened the app, or one opened later.
  const [invite, setInvite] = useState('');
  // One opened while at a table, to offer leaving it for.
  const [otherTable, setOtherTable] = useState(false);

  useEffect(() => {
    void api.config().then(setConfig);
    let active = true;
    const off = api.invites.onOpened((code) => {
      setInvite(code);
      setOtherTable(true);
    });
    void api.invites.take().then((taken) => {
      if (active && taken) setInvite(taken);
    });
    return () => {
      active = false;
      off();
    };
  }, []);

  if (!config) return null;

  const toTable = (host: HostInfo | null) => {
    setOtherTable(false);
    setScreen({ kind: 'table', host });
  };
  const leave = () => {
    void api.table.leave();
    setOtherTable(false);
    setScreen({ kind: 'start' });
  };

  return (
    <>
      {screen.kind === 'start' ? (
        <StartScreen
          version={config.version}
          camera={camera}
          invite={invite}
          onInviteChange={setInvite}
          onOpenCamera={() => setCameraOpen(true)}
          onHosted={toTable}
          onJoined={() => toTable(null)}
        />
      ) : (
        <>
          <TableScreen
            config={config}
            host={screen.host}
            camera={camera}
            onOpenCamera={() => setCameraOpen(true)}
            onLeave={leave}
          />
          {otherTable && (
            <div className="banner invite-banner" role="alert" data-testid="invite-banner">
              You opened an invite to another table. Leave this one to join it?
              <button onClick={leave}>Leave and join</button>
              <button onClick={() => setOtherTable(false)}>Stay</button>
            </div>
          )}
        </>
      )}
      {cameraOpen && <CameraPanel camera={camera} onClose={() => setCameraOpen(false)} />}
    </>
  );
}
