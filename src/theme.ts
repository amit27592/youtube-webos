// Adapted from https://github.com/reisxd/TizenTube/blob/3f28fc3d/mods/ui/theme.js

import { configAddChangeListener, configRead } from './config';

/**
 * Recolours the app background and the sidebar's focus highlight.
 *
 * TizenTube stores free-form colour strings, set from `<input type="color">`
 * pickers in their options panel. There is no colour picker on a TV remote, so
 * the values here are a short list of named colours instead — which also means
 * a stored value can't inject arbitrary CSS.
 *
 * Their `updateStyle` appends to `style[nonce]` — YouTube's own stylesheet —
 * when one exists, growing it every time a colour changes and mixing our rules
 * into theirs. This owns one `<style>` element and rewrites it.
 */

const COLORS: Record<string, string> = {
  default: '',
  black: '#000000',
  grey: '#212121',
  navy: '#0f1626',
  maroon: '#1e0f14',
  forest: '#0f1a12'
};

const style = document.createElement('style');
style.id = 'ytaf-theme';

function colorFor(key: 'routeColor' | 'focusContainerColor'): string | null {
  const value = configRead(key);
  const color = COLORS[value];

  return color ? color : null;
}

function updateStyle() {
  const rules: string[] = [];

  const focus = colorFor('focusContainerColor');
  if (focus) {
    rules.push(
      `ytlr-guide-response yt-focus-container { background-color: ${focus}; }`
    );
  }

  const route = colorFor('routeColor');
  if (route) {
    // `#container` carries an inline background, hence the override.
    rules.push(`#container { background-color: ${route} !important; }`);
  }

  style.textContent = rules.join('\n');
}

document.head.appendChild(style);
updateStyle();

configAddChangeListener('routeColor', updateStyle);
configAddChangeListener('focusContainerColor', updateStyle);
