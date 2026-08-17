// Adapted from https://github.com/reisxd/TizenTube/blob/3f28fc3d/mods/ui/ui.js

import { configAddChangeListener, configRead } from './config';
import { getPlayerManager } from './player_api';
import type { PlayerManager } from './player_api';

/**
 * Dims the interface after a spell of inactivity, unless something is playing.
 *
 * Aimed at OLED panels, where a paused menu left up for an hour is a real
 * concern. Any key press brings it back to full brightness.
 *
 * NOT a screensaver, and unrelated to `src/screensaver-fix.ts`, which keeps
 * webOS's own screensaver from cutting in over a correctly-sized video. This
 * only changes opacity; webOS's timer is untouched, and dimming never happens
 * while a video is playing, which is the case that fix exists for.
 *
 * TizenTube runs this from inside the key handler of their options panel, so
 * it is entangled with a UI we don't have. Here it is its own module with its
 * own listener.
 */

const CONTAINER_ID = 'container';

let manager: PlayerManager | null = null;
let timer: number | undefined;
let dimmed = false;

// Resolves once there is a player; until then nothing is playing anyway.
void getPlayerManager().then((m) => {
  manager = m;

  // Coming back from a pause should undim without waiting for a key press.
  m.addEventListener('playbackStart', undim);
});

function container(): HTMLElement | null {
  return document.getElementById(CONTAINER_ID);
}

function isPlaying(): boolean {
  try {
    return manager?.player.getPlayerStateObject().isPlaying ?? false;
  } catch {
    return false;
  }
}

function undim() {
  if (dimmed) {
    // `!important` because YouTube sets opacity inline on this element.
    container()?.style.setProperty('opacity', '1', 'important');
    dimmed = false;
  }

  schedule();
}

function dim() {
  if (isPlaying()) {
    // Try again later rather than giving up: playback will end eventually.
    schedule();
    return;
  }

  const opacity = 1 - configRead('dimmingOpacity');
  container()?.style.setProperty('opacity', String(opacity), 'important');
  dimmed = true;
}

function schedule() {
  clearTimeout(timer);

  if (!configRead('enableScreenDimming')) return;

  timer = window.setTimeout(dim, configRead('dimmingTimeout') * 1000);
}

function onKey() {
  undim();
}

document.addEventListener('keydown', onKey, true);

configAddChangeListener('enableScreenDimming', (evt) => {
  if (evt.detail.newValue) {
    schedule();
  } else {
    clearTimeout(timer);
    undim();
  }
});

configAddChangeListener('dimmingTimeout', schedule);
configAddChangeListener('dimmingOpacity', () => {
  if (dimmed) dim();
});

schedule();
