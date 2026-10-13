import { PhoneSender, type CameraControls, type PhoneSenderStatus } from '@commander-brawl/infrastructure/browser';
import { PHONE_LINK_PATH } from '@commander-brawl/infrastructure/protocol';
import './style.css';

const preview = element<HTMLVideoElement>('preview');
const status = element<HTMLDivElement>('status');
const hint = element<HTMLParagraphElement>('hint');
const switchButton = element<HTMLButtonElement>('switch');
const torchButton = element<HTMLButtonElement>('torch');
const zoomRow = element<HTMLLabelElement>('zoom-row');
const zoomInput = element<HTMLInputElement>('zoom');

const STATUS_TEXT: Record<PhoneSenderStatus['kind'], string> = {
  starting: 'Starting the camera…',
  connecting: 'Connecting to your computer…',
  live: 'Live',
  reconnecting: 'Reconnecting…',
  replaced: 'Another phone took over',
  'camera-error': 'Camera problem',
};

const token = location.hash.slice(1);
let torchOn = false;

if (!token) {
  showStatus({ kind: 'camera-error', message: 'This link is incomplete. Scan the QR code in the desktop app again.' });
} else {
  const sender = new PhoneSender({
    signalingUrl: `wss://${location.host}${PHONE_LINK_PATH}?token=${encodeURIComponent(token)}`,
    onStatus: showStatus,
    onPreview: (stream) => {
      preview.srcObject = stream;
    },
    onControls: showControls,
  });
  switchButton.onclick = () => void sender.switchCamera();
  torchButton.onclick = () => void sender.setTorch(!torchOn);
  zoomInput.oninput = () => void sender.setZoom(Number(zoomInput.value));
  void sender.start();
}

function showStatus(next: PhoneSenderStatus): void {
  status.textContent = STATUS_TEXT[next.kind];
  status.dataset.kind = next.kind;
  if (next.kind === 'camera-error') hint.textContent = next.message;
  if (next.kind === 'replaced') hint.textContent = 'You can close this page.';
  if (next.kind === 'live') hint.textContent = 'Point the camera at your play area. Keep this page open.';
}

function showControls(controls: CameraControls): void {
  torchButton.hidden = controls.torch === null;
  torchOn = controls.torch === true;
  torchButton.textContent = torchOn ? 'Light off' : 'Light';
  zoomRow.hidden = controls.zoom === null;
  if (controls.zoom) {
    zoomInput.min = String(controls.zoom.min);
    zoomInput.max = String(controls.zoom.max);
    zoomInput.step = String(controls.zoom.step);
    zoomInput.value = String(controls.zoom.value);
  }
}

function element<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}
