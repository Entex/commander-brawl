import { isCameraHeight } from '@commander-brawl/infrastructure/protocol';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { Icon } from '../icons/Icon';
import type { CameraState } from '../useCamera';
import { CornerPicker } from './CornerPicker';
import { VideoView } from './VideoView';

interface CameraPanelProps {
  readonly camera: CameraState;
  onClose(): void;
}

const PHONE_STATE_TEXT = {
  waiting: 'Waiting for your phone…',
  connecting: 'Phone found, starting video…',
  live: 'Phone camera is live',
  reconnecting: 'Phone connection dropped, reconnecting…',
} as const;

export function CameraPanel({ camera, onClose }: CameraPanelProps) {
  const [qr, setQr] = useState<string | null>(null);
  const [showOtherLinks, setShowOtherLinks] = useState(false);
  const [picking, setPicking] = useState(false);
  const phoneUrl = camera.phone.urls[0];
  const filming = useTrackSize(camera.rawTrack);

  useEffect(() => {
    if (!phoneUrl) return;
    void QRCode.toDataURL(phoneUrl, { margin: 1, width: 260, errorCorrectionLevel: 'M' }).then(setQr);
  }, [phoneUrl]);

  return (
    <div className="overlay" role="dialog" aria-label="Camera">
      <div className="panel camera-panel">
        <header className="panel-header">
          <h2>
            <Icon name="photo-camera" /> Your camera
          </h2>
          <button onClick={onClose}>Done</button>
        </header>

        <div className="camera-columns">
          <section className="camera-option">
            <h3>Phone (recommended)</h3>
            {phoneUrl ? (
              <>
                {qr && <img className="qr" src={qr} alt="QR code for the phone camera page" />}
                <ol className="steps">
                  <li>Connect the phone to the same Wi-Fi as this computer.</li>
                  <li>Scan the code with the phone's camera app.</li>
                  <li>
                    The browser warns that the connection isn't private. That's expected: the page comes from this
                    computer, not a website. Tap <b>Advanced → Proceed</b> (Android) or{' '}
                    <b>Show Details → visit this website</b> (iPhone).
                  </li>
                  <li>Allow the camera and point the phone at your play area.</li>
                </ol>
                <p className={`status status-${camera.phone.state}`} data-testid="phone-state">
                  {PHONE_STATE_TEXT[camera.phone.state]}
                </p>
                {camera.source !== 'phone' && camera.phone.state === 'live' && (
                  <button onClick={camera.selectPhone}>Use the phone</button>
                )}
                <button className="link" onClick={() => setShowOtherLinks((v) => !v)}>
                  {showOtherLinks ? 'Hide' : 'Show'} the link
                </button>
                {showOtherLinks && (
                  <ul className="links">
                    {camera.phone.urls.map((url) => (
                      <li key={url}>
                        <code>{url}</code>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            ) : (
              <p className="status status-reconnecting">
                This computer isn't on a local network, so a phone can't connect. Use a webcam instead.
              </p>
            )}
          </section>

          <section className="camera-option">
            <h3>Webcam</h3>
            <p className="hint">
              Any camera this computer sees, including an iPhone through Continuity Camera on a Mac.
            </p>
            <select
              aria-label="Webcam"
              value={camera.source === 'webcam' ? (camera.webcam.deviceId ?? '') : ''}
              onFocus={() => void camera.refreshDevices()}
              onChange={(event) => void camera.selectWebcam(event.target.value)}
            >
              <option value="" disabled>
                Choose a camera…
              </option>
              {camera.webcam.devices.map((device) => (
                <option key={device.deviceId} value={device.deviceId}>
                  {device.label}
                </option>
              ))}
            </select>
            {camera.webcam.error && <p className="status status-reconnecting">{camera.webcam.error}</p>}
          </section>
        </div>

        <section className="camera-resolution">
          <label className="field">
            <span>Resolution</span>
            <select
              value={camera.resolution}
              onChange={(event) => {
                const height = Number(event.target.value);
                if (isCameraHeight(height)) camera.setResolution(height);
              }}
            >
              <option value={720}>720p: easiest on the phone, the Wi-Fi and this computer</option>
              <option value={1080}>1080p (recommended)</option>
              {/* Shrinking 4K for the others takes the graphics card, as straightening does. */}
              {camera.straighten.supported && <option value={2160}>4K: the sharpest close-ups</option>}
            </select>
          </label>
          <p className="hint" data-testid="camera-resolution-hint">
            The others get at most 1080p either way: a higher resolution makes close-ups of your cards sharper. 4K warms
            a phone up and uses more of its battery.
            {filming && ` Your camera is filming at ${filming.width}×${filming.height}.`}
          </p>
        </section>

        <section className="camera-preview">
          <h3>What the others see</h3>
          {picking && camera.rawTrack ? (
            <CornerPicker
              track={camera.rawTrack}
              initial={camera.straighten.corners}
              onDone={(corners) => {
                camera.straighten.set(corners);
                setPicking(false);
              }}
              onCancel={() => setPicking(false)}
            />
          ) : camera.track ? (
            <VideoView track={camera.track} className="preview-video" testId="camera-preview" />
          ) : (
            <p className="hint">No camera yet.</p>
          )}
          {camera.straighten.supported && camera.rawTrack && !picking && (
            <div className="row straighten-row">
              {camera.straighten.corners ? (
                <>
                  {camera.straighten.error ? (
                    <span className="status status-reconnecting">
                      Couldn't straighten the view: {camera.straighten.error}
                    </span>
                  ) : (
                    <span className="hint">Straightened to your playmat. Moved the camera? Set the corners again.</span>
                  )}
                  <button onClick={() => setPicking(true)}>Change the corners</button>
                  <button onClick={() => camera.straighten.set(null)}>Don't straighten</button>
                </>
              ) : (
                <>
                  <button onClick={() => setPicking(true)}>Straighten the view</button>
                  <span className="hint">
                    For a camera that looks at the table at an angle: click the four corners of your playmat.
                  </span>
                </>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

/**
 * The size of the camera's picture as it comes, checked every half second: a phone's is only known once its video
 * arrives, and changes when it's asked for another resolution.
 */
function useTrackSize(track: MediaStreamTrack | null): { width: number; height: number } | null {
  const [size, setSize] = useState<{ track: MediaStreamTrack; width: number; height: number } | null>(null);
  useEffect(() => {
    if (!track) return;
    const read = () => {
      const { width, height } = track.getSettings();
      setSize((current) =>
        current?.track === track && current.width === width && current.height === height
          ? current
          : width && height
            ? { track, width, height }
            : null,
      );
    };
    queueMicrotask(read);
    const timer = setInterval(read, 500);
    return () => clearInterval(timer);
  }, [track]);
  return size && size.track === track ? size : null;
}
