import { useEffect, useRef, useState } from 'react';
import type { FlowType, Screen } from './types';

export interface NavState {
  screen: Screen;
  flow: FlowType | null;
  selectedId: string | null;
  count: number;
}

export function homeNavState(): NavState {
  return { screen: 'home', flow: null, selectedId: null, count: 0 };
}

// How long the "Press Back Again to Exit" confirmation stays live.
const EXIT_CONFIRM_MS = 1800;

/**
 * Syncs the app's screen (home / preferences / choices / room) with real
 * browser/native history, so:
 *
 *  - The Android hardware back button and the iOS swipe-back gesture step
 *    back through the screens one at a time, instead of leaving the app.
 *  - Pressing back again once you're already on Home shows a "Press Back
 *    Again to Exit" prompt (via `showToast`) instead of exiting outright;
 *    a second back press inside a short window actually exits, and if no
 *    second press comes the guard silently re-arms for next time.
 *
 * Usage:
 *  - Call `navigate(nextState)` for every FORWARD transition (opening a
 *    screen deeper into the app) instead of setting screen/flow state
 *    directly.
 *  - Wire your in-app "Back" button (if you have one) to the returned
 *    `goBack()` so it goes through the exact same path as the hardware
 *    back button.
 */
export function useBackNavigation(showToast: (message: string) => void) {
  const [screen, setScreen] = useState<Screen>('home');
  const [flow, setFlow] = useState<FlowType | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [count, setCount] = useState(0);

  // Mirror `screen` in a ref so the popstate handler (registered once, on
  // mount) always sees the current screen rather than a stale closure.
  const screenRef = useRef(screen);
  useEffect(() => {
    screenRef.current = screen;
  }, [screen]);

  // Pending "re-arm the exit guard" timer.
  const exitGuardTimerRef = useRef<number | null>(null);
  function clearExitGuardTimer() {
    if (exitGuardTimerRef.current !== null) {
      window.clearTimeout(exitGuardTimerRef.current);
      exitGuardTimerRef.current = null;
    }
  }

  const initializedHistoryRef = useRef(false);

  useEffect(() => {
    if (!initializedHistoryRef.current) {
      initializedHistoryRef.current = true;
      window.history.replaceState(homeNavState(), '');
      // Guard entry: lets the first back press once you're at Home show a
      // confirm prompt instead of exiting immediately.
      window.history.pushState(homeNavState(), '');
    }

    function onPopState(event: PopStateEvent) {
      const state = (event.state as NavState | null) ?? homeNavState();

      if (screenRef.current === 'home' && state.screen === 'home') {
        if (exitGuardTimerRef.current !== null) {
          // Second press inside the confirmation window: let it through —
          // don't re-arm the guard, so the app actually exits.
          clearExitGuardTimer();
          showToast('');
          return;
        }
        showToast('Press Back Again to Exit');
        exitGuardTimerRef.current = window.setTimeout(() => {
          exitGuardTimerRef.current = null;
          window.history.pushState(homeNavState(), '');
        }, EXIT_CONFIRM_MS);
        return;
      }

      clearExitGuardTimer();
      setScreen(state.screen);
      setFlow(state.flow);
      setSelectedId(state.selectedId);
      setCount(state.count);
    }

    window.addEventListener('popstate', onPopState);
    return () => {
      window.removeEventListener('popstate', onPopState);
      clearExitGuardTimer();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function navigate(next: NavState) {
    clearExitGuardTimer();
    setScreen(next.screen);
    setFlow(next.flow);
    setSelectedId(next.selectedId);
    setCount(next.count);
    window.history.pushState(next, '');
  }

  function goBack() {
    // Drive navigation through the real back action — the popstate
    // handler above restores the previous screen's state. This is what
    // makes the hardware/gesture back button and an in-app Back button
    // behave identically.
    window.history.back();
  }

  return { screen, flow, selectedId, count, setCount, navigate, goBack };
}
