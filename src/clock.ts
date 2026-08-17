// Adapted from https://github.com/reisxd/TizenTube/blob/3f28fc3d/mods/ui/clock.js

import { configAddChangeListener, configRead, type ConfigKey } from './config';
import './clock.css';
import { requireElement } from './player_api/helpers';

/**
 * An on-screen clock.
 *
 * Grown from this repo's own `watch.js` rather than replaced by TizenTube's
 * version, which formats the time by hand and leaves the clock sitting over
 * the player. Kept from ours: `Intl` formatting in the user's locale, a tick
 * once a minute instead of once a second, and hiding itself while the player
 * is focused. Taken from theirs: the 12/24-hour and show-seconds options.
 *
 * Showing seconds is the one case that has to tick every second, so the
 * interval follows the setting.
 */

const PLAYER_SELECTOR = 'ytlr-watch-default';

class Clock {
  #element: HTMLDivElement;
  #timer: number | undefined;
  #tickTimeout: number | undefined;
  #attrChanges: MutationObserver | undefined;

  constructor() {
    this.#element = document.createElement('div');
    this.#element.className = 'webOs-watch';
    document.body.appendChild(this.#element);

    this.start();
    void this.#followPlayer();
  }

  #formatter() {
    const hour12 = configRead('clock12Hour');
    const seconds = configRead('clockShowSeconds');

    return new Intl.DateTimeFormat(navigator.language, {
      hour: 'numeric',
      minute: 'numeric',
      ...(seconds && { second: 'numeric' }),
      hour12
    });
  }

  /** (Re)starts the tick, aligned to the next second or minute boundary. */
  start() {
    this.stop();

    const formatter = this.#formatter();
    const perSecond = configRead('clockShowSeconds');
    const period = perSecond ? 1000 : 60000;

    const setTime = () => {
      this.#element.innerText = formatter.format(new Date());
    };

    setTime();

    const now = new Date();
    const untilBoundary = perSecond
      ? 1000 - now.getMilliseconds()
      : (60 - now.getSeconds()) * 1000 - now.getMilliseconds();

    this.#tickTimeout = window.setTimeout(() => {
      setTime();
      this.#timer = window.setInterval(setTime, period);
    }, untilBoundary);
  }

  stop() {
    clearTimeout(this.#tickTimeout);
    clearInterval(this.#timer);
  }

  /** Hidden while the player has focus, so it never sits over the video. */
  #changeVisibility(player: Element) {
    const focused = player.getAttribute('hybridnavfocusable') === 'true';
    this.#element.style.display = focused ? 'none' : 'block';
  }

  async #followPlayer() {
    const player = await requireElement(PLAYER_SELECTOR, HTMLElement);

    this.#changeVisibility(player);

    this.#attrChanges = new MutationObserver(() => {
      this.#changeVisibility(player);
    });

    this.#attrChanges.observe(player, {
      attributes: true,
      attributeFilter: ['hybridnavfocusable']
    });
  }

  destroy() {
    this.stop();
    this.#element.remove();
    this.#attrChanges?.disconnect();
  }
}

let instance: Clock | null = null;

function toggleClock(show: boolean) {
  if (show) {
    instance ??= new Clock();
  } else {
    instance?.destroy();
    instance = null;
  }
}

toggleClock(configRead('enableClock'));

configAddChangeListener('enableClock', (evt) => {
  toggleClock(evt.detail.newValue);
});

// Both change how the time is written, and one of them changes how often it
// needs rewriting.
for (const key of ['clock12Hour', 'clockShowSeconds'] satisfies ConfigKey[]) {
  configAddChangeListener(key, () => instance?.start());
}
