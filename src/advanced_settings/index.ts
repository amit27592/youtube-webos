import { registerCustomAction } from '../app_api/index';
import { SHOW_ACTION, showSettingsPage } from './render';
import { assertTreeIsComplete } from './tree';
import './settings-menu';

/**
 * Advanced Settings — our configuration panel, drawn with YouTube's own
 * renderers rather than as an HTML overlay.
 *
 * Reachable two ways: the green button on the remote, and an entry injected
 * into YouTube's own settings screen (see `./settings-menu.ts`).
 */

/** Green, across the remotes we've seen. Matches the map in `src/ui.js`. */
const GREEN_KEY_CODES = new Set([404, 172]);

function onKeyEvent(evt: KeyboardEvent) {
  if (!GREEN_KEY_CODES.has(evt.charCode)) return;

  // YouTube binds the colour keys itself, so swallow the event on all three
  // event types rather than only the one we act on.
  evt.preventDefault();
  evt.stopPropagation();

  if (evt.type === 'keydown') showSettingsPage({});
}

for (const type of ['keydown', 'keypress', 'keyup'] as const) {
  document.addEventListener(type, onKeyEvent, true);
}

assertTreeIsComplete();

void registerCustomAction(SHOW_ACTION, showSettingsPage);

export { SHOW_ACTION, showSettingsPage };
