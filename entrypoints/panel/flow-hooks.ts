import { useEffect, useState } from 'react';
import { getRecording, watchRecording } from '@/lib/flow/recording-store';
import type { Recording } from '@/lib/flow/types';

/** The recording of the tab this panel reviews, kept up to date as steps arrive. */
export function useRecording(tabId: number | null): Recording | null {
  const [recording, setRecording] = useState<Recording | null>(null);

  useEffect(() => {
    if (tabId === null) {
      setRecording(null);
      return;
    }
    let active = true;
    void getRecording(tabId).then((current) => {
      if (active) setRecording(current);
    });
    const unwatch = watchRecording(tabId, setRecording);
    return () => {
      active = false;
      unwatch();
    };
  }, [tabId]);

  return recording;
}

/** The current time, refreshed every `intervalMs`, for elapsed-time displays. */
export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}
