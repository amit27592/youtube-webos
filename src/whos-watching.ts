// Adapted from https://github.com/reisxd/TizenTube/blob/3f28fc3d/mods/ui/disableWhosWatching.js

import { configAddChangeListener, configRead } from './config';

/**
 * Suppresses the "Who's watching?" screen shown at startup.
 *
 * YouTube decides whether to show it from a set of "recurring actions" kept in
 * local storage, each with a `lastFired` timestamp. Dating those forward means
 * the app decides for itself not to show the screen — no interception, and
 * nothing to go wrong mid-navigation.
 *
 * Related but not the same as `src/auto-account-select.ts`, which answers the
 * account selector *after* it appears. Turning this off stops the screen being
 * raised at all; the two are safe to use together and neither needs the other.
 *
 * Not ported: TizenTube's `permanentlyEnableWhoIsWatchingMenu`, which re-dates
 * the same keys on a 60-second interval forever to force the screen back on.
 * Wanting the stock screen is what leaving this on already does.
 */

const STORAGE_KEY = 'yt.leanback.default::recurring_actions';

/**
 * The startup prompts. Which of these exist depends on how many accounts are
 * signed in, so each is optional.
 */
const ACTIONS = [
  'startup-screen-account-selector-with-guest',
  'whos_watching_fullscreen_zero_accounts',
  'startup-screen-signed-out-welcome-back'
];

/** Long enough that the app won't reconsider within a session. */
const SUPPRESS_DAYS = 7;

interface RecurringActions {
  data?: { data?: Record<string, { lastFired?: number } | undefined> };
}

/**
 * Dates the startup prompts forward to suppress them, or back to let them fire
 * again. There is no "unset" — YouTube owns these timestamps — so restoring
 * means putting them far enough in the past that the app treats them as due.
 */
function setLastFired(days: number) {
  const stored = window.localStorage.getItem(STORAGE_KEY);

  // Absent on a first run, before YouTube has written it. Nothing to suppress
  // yet, and the next launch will have it.
  if (!stored) return;

  let parsed: RecurringActions;
  try {
    parsed = JSON.parse(stored) as RecurringActions;
  } catch (e) {
    console.warn('[whos-watching] Could not parse recurring actions:', e);
    return;
  }

  const actions = parsed.data?.data;
  if (!actions || typeof actions !== 'object') return;

  const when = Date.now() + days * 24 * 60 * 60 * 1000;
  let changed = false;

  for (const name of ACTIONS) {
    const action = actions[name];
    if (!action) continue;

    action.lastFired = when;
    changed = true;
  }

  if (!changed) return;

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
    console.info(
      '[whos-watching] Startup prompts',
      days > 0 ? 'suppressed' : 'restored'
    );
  } catch (e) {
    console.warn('[whos-watching] Could not write recurring actions:', e);
  }
}

function apply(show: boolean) {
  setLastFired(show ? -SUPPRESS_DAYS : SUPPRESS_DAYS);
}

if (!configRead('enableWhosWatching')) apply(false);

configAddChangeListener('enableWhosWatching', (evt) => {
  apply(evt.detail.newValue);
});
