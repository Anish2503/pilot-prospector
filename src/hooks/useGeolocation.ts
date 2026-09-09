import { useCallback, useEffect, useRef, useState } from 'react';
import type { Coordinates, GeolocationState } from '@/types';

const STORAGE_KEY = 'pp.lastPosition.v1';

/** A saved position older than this is not worth trusting for sorting. */
const STALE_AFTER_MS = 30 * 60 * 1000;

interface Stored {
  latitude: number;
  longitude: number;
  accuracy?: number;
  capturedAt: number;
}

function readStored(): Stored | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Stored;
    if (typeof parsed?.latitude !== 'number' || typeof parsed?.longitude !== 'number') return null;
    if (Date.now() - parsed.capturedAt > STALE_AFTER_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Reads the phone's location, once, when asked.
 *
 * Deliberately NOT a live tracker: we call the browser only when the BDM opens
 * their list or taps Refresh. Nobody is followed around all day, and the
 * battery is left alone.
 */
export function useGeolocation() {
  const [state, setState] = useState<GeolocationState>(() => {
    const stored = readStored();
    if (stored) {
      return {
        status: 'granted',
        position: {
          latitude: stored.latitude,
          longitude: stored.longitude,
          accuracy: stored.accuracy,
        },
        capturedAt: stored.capturedAt,
      };
    }
    return { status: 'idle' };
  });

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const request = useCallback((options?: { highAccuracy?: boolean }) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setState({
        status: 'unavailable',
        message: 'This browser cannot provide your location.',
      });
      return;
    }

    // A page served over plain http (other than localhost) is blocked by the
    // browser from reading location at all - worth saying so plainly.
    if (
      typeof window !== 'undefined' &&
      !window.isSecureContext &&
      window.location.hostname !== 'localhost'
    ) {
      setState({
        status: 'unavailable',
        message:
          'Location needs a secure (https) connection. Open the app using its https link.',
      });
      return;
    }

    setState({ status: 'requesting' });

    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (!mounted.current) return;

        const coordinates: Coordinates = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
        };
        const capturedAt = Date.now();

        setState({ status: 'granted', position: coordinates, capturedAt });

        try {
          localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify({ ...coordinates, capturedAt } satisfies Stored),
          );
        } catch {
          // Private browsing can block storage; sorting still works this session.
        }
      },
      (error) => {
        if (!mounted.current) return;

        if (error.code === error.PERMISSION_DENIED) {
          setState({ status: 'denied' });
        } else if (error.code === error.TIMEOUT) {
          setState({
            status: 'unavailable',
            message: 'Finding your location took too long. Try again, ideally outdoors.',
          });
        } else {
          setState({
            status: 'unavailable',
            message: 'Your location could not be determined right now.',
          });
        }
      },
      {
        enableHighAccuracy: options?.highAccuracy ?? true,
        timeout: 15_000,
        // A fix from the last minute is fine and returns instantly.
        maximumAge: 60_000,
      },
    );
  }, []);

  const clear = useCallback(() => {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    setState({ status: 'idle' });
  }, []);

  const position = state.status === 'granted' ? state.position : null;
  const capturedAt = state.status === 'granted' ? state.capturedAt : null;

  /** True when the saved fix is old enough to be worth refreshing. */
  const isStale = capturedAt !== null && Date.now() - capturedAt > 5 * 60 * 1000;

  return { state, position, capturedAt, isStale, request, clear };
}
