import { useEffect, useRef, type MouseEvent } from 'react';

interface VideoViewProps {
  readonly track: MediaStreamTrack | null;
  readonly rotation?: 0 | 180;
  readonly className?: string;
  readonly testId?: string;
  readonly title?: string | undefined;
  readonly onClick?: ((event: MouseEvent<HTMLVideoElement>) => void) | undefined;
}

export function VideoView({ track, rotation = 0, className, testId, title, onClick }: VideoViewProps) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    video.srcObject = track ? new MediaStream([track]) : null;
  }, [track]);

  return (
    <video
      ref={ref}
      className={className}
      data-testid={testId}
      title={title}
      onClick={onClick}
      autoPlay
      playsInline
      muted
      style={rotation ? { transform: `rotate(${rotation}deg)` } : undefined}
    />
  );
}
