import type {
  PresenterCommand,
  PresenterTransport,
} from '../components/present/use-presenter-channel';

const popupFeatures = 'popup,width=1280,height=800';

function targetOrigin(): string {
  return location.protocol === 'file:' ? '*' : location.origin;
}

export function createStandalonePresenter(slideId: string) {
  const session = crypto.getRandomValues(new Uint32Array(4)).join('-');
  const url = `#/s/${encodeURIComponent(slideId)}/presenter?session=${session}`;
  const origin = targetOrigin();
  let popup: Window | null = null;

  const transport: PresenterTransport = (onMessage) => {
    let port: MessagePort | undefined;

    // Some browsers isolate local files from BroadcastChannel. Transfer a
    // dedicated port so state stays private even if the popup later navigates.
    const connect = (event: MessageEvent) => {
      const [incoming] = event.ports;
      if (!popup || event.source !== popup || event.data !== session || !incoming) return;
      if (origin !== '*' && event.origin !== origin) return;
      port?.close();
      port = incoming;
      port.onmessage = (message: MessageEvent<PresenterCommand>) => onMessage(message.data);
    };
    window.addEventListener('message', connect);
    return {
      send: (message) => port?.postMessage(message),
      close: () => {
        window.removeEventListener('message', connect);
        port?.close();
      },
    };
  };

  return {
    open() {
      if (popup && !popup.closed) {
        popup.focus();
      } else {
        popup = window.open(url, `open-slide-presenter-${session}`, popupFeatures);
      }
    },
    transport,
  };
}

export function connectToProjection(session: string | null): PresenterTransport {
  return (onMessage) => {
    if (!session || !window.opener) return null;
    const { port1, port2 } = new MessageChannel();
    port1.onmessage = (message: MessageEvent<PresenterCommand>) => onMessage(message.data);
    window.opener.postMessage(session, targetOrigin(), [port2]);
    return {
      send: (message) => port1.postMessage(message),
      close: () => port1.close(),
    };
  };
}
