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

  useEffect(() => {
    void api.config().then(setConfig);
  }, []);

  if (!config) return null;

  const leave = () => {
    void api.table.leave();
    setScreen({ kind: 'start' });
  };

  return (
    <>
      {screen.kind === 'start' ? (
        <StartScreen
          version={config.version}
          camera={camera}
          onOpenCamera={() => setCameraOpen(true)}
          onHosted={(host) => setScreen({ kind: 'table', host })}
          onJoined={() => setScreen({ kind: 'table', host: null })}
        />
      ) : (
        <TableScreen
          config={config}
          host={screen.host}
          camera={camera}
          onOpenCamera={() => setCameraOpen(true)}
          onLeave={leave}
        />
      )}
      {cameraOpen && <CameraPanel camera={camera} onClose={() => setCameraOpen(false)} />}
    </>
  );
}
