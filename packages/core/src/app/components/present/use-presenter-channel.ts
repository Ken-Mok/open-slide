import { useEffect, useMemo, useRef, useState } from 'react';

export type PresenterState = {
  index: number;
  pageCount: number;
  blackout: 'black' | 'white' | null;
  startedAt: number; // epoch ms when present mode began
  stepIndex: number;
  stepCount: number;
};

export type PresenterCommand =
  | { type: 'state'; state: PresenterState }
  | { type: 'goto'; index: number }
  | { type: 'next' }
  | { type: 'prev' }
  | { type: 'request-state' }
  | { type: 'toggle-blackout'; mode: 'black' | 'white' }
  | { type: 'switch-slide'; slideId: string };

type Handler = (msg: PresenterCommand) => void;

type Connection = {
  send: (message: PresenterCommand) => void;
  close: () => void;
};

export type PresenterTransport = (onMessage: Handler) => Connection | null;

function connectBroadcast(slideId: string, onMessage: Handler): Connection | null {
  if (typeof BroadcastChannel === 'undefined') return null;
  const channel = new BroadcastChannel(`open-slide:presenter:${slideId}`);
  channel.addEventListener('message', (event: MessageEvent<PresenterCommand>) =>
    onMessage(event.data),
  );
  return {
    send: (message) => channel.postMessage(message),
    close: () => channel.close(),
  };
}

export function usePresenterChannel(
  slideId: string,
  onMessage?: Handler,
  transport?: PresenterTransport,
) {
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  const channelRef = useRef<Connection | null>(null);
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    const receive: Handler = (message) => onMessageRef.current?.(message);
    const channel = transport ? transport(receive) : connectBroadcast(slideId, receive);
    if (!channel) return;
    channelRef.current = channel;
    setAvailable(true);
    return () => {
      channel.close();
      if (channelRef.current === channel) channelRef.current = null;
      setAvailable(false);
    };
  }, [slideId, transport]);

  return useMemo(
    () => ({
      send(msg: PresenterCommand) {
        try {
          channelRef.current?.send(msg);
        } catch {
          // Channel may have been closed between the availability check
          // and the send (e.g. StrictMode unmount mid-flush). Treat as no-op.
        }
      },
      available,
    }),
    [available],
  );
}
