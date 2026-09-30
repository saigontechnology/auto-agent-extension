import { useCallback, useEffect, useRef, useState } from 'react';
import { type Browser, browser } from 'wxt/browser';
import { type ContentToPanel, PANEL_PORT, type PanelToContent } from '@/lib/messages';

/**
 * Accepts the side panel's connection. The page UI is only active while a panel is
 * connected, so closing the panel hides pins and turns picking off.
 */
export function usePanelPort(onMessage: (message: PanelToContent) => void) {
  const [port, setPort] = useState<Browser.runtime.Port | null>(null);
  const handler = useRef(onMessage);
  handler.current = onMessage;

  useEffect(() => {
    const onConnect = (incoming: Browser.runtime.Port) => {
      if (incoming.name !== PANEL_PORT) return;
      incoming.onMessage.addListener((message) => handler.current(message as PanelToContent));
      incoming.onDisconnect.addListener(() => {
        setPort((current) => (current === incoming ? null : current));
      });
      setPort(incoming);
    };
    browser.runtime.onConnect.addListener(onConnect);
    // Tell an already-open side panel that this page is ready to be connected to.
    const announce = () => {
      browser.runtime.sendMessage({ type: 'content-ready' }).catch(() => undefined);
    };
    announce();
    // A page restored from the back/forward cache keeps this script but has lost its port.
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) announce();
    };
    window.addEventListener('pageshow', onPageShow);
    return () => {
      browser.runtime.onConnect.removeListener(onConnect);
      window.removeEventListener('pageshow', onPageShow);
    };
  }, []);

  const post = useCallback(
    (message: ContentToPanel) => {
      try {
        port?.postMessage(message);
      } catch {
        // The panel closed between render and post; onDisconnect will clear the port.
      }
    },
    [port],
  );

  return { connected: port !== null, post };
}
