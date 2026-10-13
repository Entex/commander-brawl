interface SnapshotRequest {
  /** Tells a newer request's picture from an older one's. */
  readonly id: number;
  readonly from: string;
  /** How this player's video is turned on our screen, so the picture is the same way up. */
  readonly rotation: 0 | 180;
}

export type SnapshotState =
  | (SnapshotRequest & { readonly status: 'loading' })
  | (SnapshotRequest & { readonly status: 'ready'; readonly image: string })
  | (SnapshotRequest & { readonly status: 'failed'; readonly message: string });

/** A sharp picture of a card on another player's table. */
export function SnapshotView({ snapshot, onClose }: { readonly snapshot: SnapshotState; onClose(): void }) {
  return (
    <div className="overlay" role="dialog" aria-label={`From ${snapshot.from}'s camera`} onClick={onClose}>
      <div className="panel snapshot-panel" data-testid="snapshot" onClick={(event) => event.stopPropagation()}>
        <header className="panel-header">
          <h2>From {snapshot.from}'s camera</h2>
          <button onClick={onClose}>Close</button>
        </header>
        {snapshot.status === 'loading' && <p className="hint">Asking their camera for a sharp picture…</p>}
        {snapshot.status === 'failed' && <p className="status status-reconnecting">{snapshot.message}</p>}
        {snapshot.status === 'ready' && (
          <img
            className="snapshot-image"
            src={snapshot.image}
            alt="Close-up"
            style={snapshot.rotation ? { transform: `rotate(${snapshot.rotation}deg)` } : undefined}
          />
        )}
      </div>
    </div>
  );
}
