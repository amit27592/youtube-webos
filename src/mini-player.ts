// Adapted from https://github.com/reisxd/TizenTube/blob/3f28fc3d/mods/features/pictureInPicture.js

import {
  customActionCommand,
  registerCustomAction,
  ResolveCommandRegistry,
  type ResolveCommandHook,
  type ResolveCommandPayload
} from './app_api/index';
import { configRead } from './config';
import { addJsonParseHandler } from './hooks/json-parse';
import {
  ButtonRenderer,
  buttonItem,
  dispatch,
  showToast,
  POPUP_BACK
} from './yt_ui/index';

/**
 * Mini Player — keep the current video playing in the corner of the screen
 * while you browse for the next one.
 *
 * This is in-app only. It is deliberately *not* called picture-in-picture:
 * webOS has no OS-level PiP for us to drive, and calling it that would promise
 * a video that survives leaving the app.
 *
 * How it works, which is the same trick TizenTube uses:
 *
 * 1. Leave the watch page (`HISTORY_BACK`). YouTube tears the player down.
 * 2. When it does, force `ytlr-player` back to visible with a transparent
 *    background and lift `ytlr-player-container` above the browse UI.
 * 3. Ask `PlayerService` to load the same video again at the timestamp we left
 *    off at, and shrink the `<video>` element into the bottom-right corner.
 *
 * Step 3 only stays put because `PlaybackPreviewService` — the thing that plays
 * a preview behind the home screen — is neutered while the mini player is up.
 * Otherwise the first shelf you land on would take the player away from us.
 *
 * FRAGILITY: `PlayerService` and `PlaybackPreviewService` are looked up by name
 * inside YouTube's own module registry, which is the most breakable dependency
 * in this app. Every use of them is behind {@link findServices}, and if the
 * lookup fails the feature turns itself off: no button, no menu entry, and the
 * key binding falls through to YouTube. Nothing else is affected.
 */

const ENTER_ACTION = 'MINI_PLAYER_ENTER';

const PLAYER_SELECTOR = 'ytlr-player';
const CONTAINER_SELECTOR = 'ytlr-player-container';

const WATCH_PAGE_CLASS = 'WEB_PAGE_TYPE_WATCH';

/** Yellow, across the remotes we've seen. Matches the map in `src/ui.js`. */
const YELLOW_KEY_CODES = new Set([405, 170]);

/** YouTube's own icon for a shrunken player. */
const MINI_PLAYER_ICON = 'SCREEN_SWITCH';

/** YouTube's speed entry, which is how we recognise the playback settings popup. */
const SPEED_ICON = 'SLOW_MOTION_VIDEO';

/** How much smaller than the screen the mini video is, in each dimension. */
const MINI_SCALE = 3.5;

/** Offset of the mini video's top-left corner, as a percentage of the screen. */
const MINI_INSET = 68;

/** Above the browse UI, below YouTube's own popups. */
const MINI_Z_INDEX = '10';

/** Let an open popup or the control overlay close before we navigate. */
const HISTORY_BACK_DELAY_MS = 100;

/**
 * When to re-assert the corner geometry, in milliseconds from leaving the watch
 * page. The last two straddle {@link RELOAD_DELAY_MS}, which is when YouTube
 * lays the player out again.
 */
const RESTYLE_DELAYS_MS = [500, 1500, 3000];

/** Give the teardown time to finish before asking for the video back. */
const RELOAD_DELAY_MS = 1000;

/** If the player never goes away, don't sit half-entered forever. */
const ENTER_TIMEOUT_MS = 8000;

const RESOLVE_INTERVAL_MS = 250;
const RESOLVE_ATTEMPTS = 60;

/** How long one press of the yellow button stays "the same press". */
const TOGGLE_COOLDOWN_MS = 600;

// --- YouTube's services ----------------------------------------------------

interface WatchEndpoint {
  videoId?: string;
  startTimeSeconds?: number;
}

interface PlaybackConfig {
  clickTrackingParams?: unknown;
  commandMetadata?: unknown;
  watchEndpoint?: WatchEndpoint;
}

interface PlayerService {
  /** The config the currently-loaded video was started from. */
  loadedPlaybackConfig?: PlaybackConfig;
  loadVideo(config: PlaybackConfig): unknown;
  getCurrentTime?(): number;
}

/**
 * Drives the video preview behind the browse UI.
 *
 * The method that tears a preview down is `stop` in the build TizenTube was
 * written against and `end` in the one webOS is served; both are declared
 * optional and whichever exists gets wrapped.
 */
interface PlaybackPreviewService {
  start(...args: unknown[]): unknown;
  stop?(...args: unknown[]): unknown;
  end?(...args: unknown[]): unknown;
}

interface Services {
  player: PlayerService;
  preview: PlaybackPreviewService;
}

function isPlayerService(value: unknown): value is PlayerService {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as PlayerService).loadVideo === 'function'
  );
}

function isPreviewService(value: unknown): value is PlaybackPreviewService {
  if (typeof value !== 'object' || value === null) return false;

  const service = value as PlaybackPreviewService;
  return (
    typeof service.start === 'function' &&
    (typeof service.stop === 'function' || typeof service.end === 'function')
  );
}

/**
 * Unwraps a registry entry.
 *
 * The registry hands back the service itself in some builds and a
 * `{ type: 'mapping', value }` descriptor in others, so both are accepted.
 */
function serviceOf(entry: unknown): unknown {
  if (typeof entry !== 'object' || entry === null) return entry;

  const descriptor = entry as { type?: unknown; value?: unknown };
  return descriptor.type === 'mapping' ? descriptor.value : entry;
}

/**
 * Finds YouTube's service registry and pulls the two services out of it.
 *
 * Every step is checked rather than assumed: this reads undocumented internals
 * of a bundle that is rebuilt without warning, so "not there" has to be an
 * ordinary outcome rather than an exception.
 */
function findServices(): Services | null {
  const yttv = window._yttv;
  if (typeof yttv !== 'object' || yttv === null) return null;

  for (const key in yttv) {
    const mappings = (yttv[key] as { mappings?: unknown } | null | undefined)
      ?.mappings;

    if (
      typeof mappings !== 'object' ||
      mappings === null ||
      typeof (mappings as Map<string, unknown>).get !== 'function'
    ) {
      continue;
    }

    const registry = mappings as Map<string, unknown>;
    const player = serviceOf(registry.get('PlayerService'));
    const preview = serviceOf(registry.get('PlaybackPreviewService'));

    if (!isPlayerService(player)) continue;
    if (!isPreviewService(preview)) continue;

    return { player, preview };
  }

  return null;
}

let services: Services | null = null;

function resolveServices(): Promise<Services | null> {
  return new Promise((resolve) => {
    let attempts = 0;

    const poll = () => {
      const found = findServices();
      if (found) {
        resolve(found);
        return;
      }

      if (++attempts >= RESOLVE_ATTEMPTS) {
        resolve(null);
        return;
      }

      setTimeout(poll, RESOLVE_INTERVAL_MS);
    };

    poll();
  });
}

/**
 * Stops the browse-page preview from taking the player away from us.
 *
 * Patched once, for the life of the app: both wrappers are transparent while
 * the mini player is off, so there is nothing to undo.
 */
function patchPreviewService({ preview }: Services) {
  for (const name of ['start', 'stop', 'end'] as const) {
    const original = preview[name];
    if (typeof original !== 'function') continue;

    preview[name] = function (this: unknown, ...args: unknown[]) {
      if (state !== 'off') return undefined;
      return original.apply(this, args);
    };
  }
}

// --- state -----------------------------------------------------------------

/**
 * `entering` covers the gap between leaving the watch page and the video
 * actually coming back, which is a second or so of the player not existing.
 * The preview service has to be held off for all of it, so it counts as "on"
 * everywhere except when deciding what the yellow button does.
 */
type State = 'off' | 'entering' | 'on';

let state: State = 'off';

/** Inline styles as they were before we started moving things around. */
let savedStyles: { element: HTMLElement; cssText: string }[] = [];

/** The elements the current session is moving around. */
let entered: Elements | null = null;

/** Where playback had got to when the mini player was asked for. */
let resumeAt = 0;

let enterTimer: number | undefined;

/** When the yellow button was last acted on — see {@link onKeyEvent}. */
let lastToggleAt = 0;

function onWatchPage() {
  return document.body.classList.contains(WATCH_PAGE_CLASS);
}

/**
 * Both halves of the transition run off the body's page-type class.
 *
 * While `entering`, losing it means the watch page has gone and the corner
 * video can be set up. Once `on`, gaining it again means the user has opened a
 * video for themselves, which takes the player back — so we get out of the way.
 *
 * TizenTube watches `ytlr-player` for a class YouTube no longer sets on webOS,
 * which is why this looks at the page rather than the player.
 */
const pageObserver = new MutationObserver(() => {
  if (state === 'entering' && !onWatchPage()) {
    onWatchPageLeft();
  } else if (state === 'on' && onWatchPage()) {
    console.info('[mini-player] Watch page opened; handing the player back');
    reset();
  }
});

function saveStyle(element: HTMLElement) {
  savedStyles.push({ element, cssText: element.style.cssText });
}

/** Puts every element we touched back the way we found it. */
function reset() {
  clearTimeout(enterTimer);
  pageObserver.disconnect();
  videoObserver.disconnect();

  for (const { element, cssText } of savedStyles) {
    element.style.cssText = cssText;
  }

  savedStyles = [];
  entered = null;
  state = 'off';
}

// --- entering and leaving --------------------------------------------------

interface Elements {
  video: HTMLVideoElement;
  player: HTMLElement;
  container: HTMLElement;
}

function findElements(): Elements | null {
  const video = document.querySelector('video');
  const player = document.querySelector(PLAYER_SELECTOR);
  const container = document.querySelector(CONTAINER_SELECTOR);

  if (
    !(video instanceof HTMLVideoElement) ||
    !(player instanceof HTMLElement) ||
    !(container instanceof HTMLElement)
  ) {
    return null;
  }

  return { video, player, container };
}

/** Whether the yellow button should enter the mini player right now. */
function canEnter(): boolean {
  return (
    configRead('enableMiniPlayer') &&
    services !== null &&
    state === 'off' &&
    onWatchPage() &&
    findElements() !== null
  );
}

/** Where the video has got to, by whichever route is available. */
function currentTime(): number {
  const fromService = services?.player.getCurrentTime?.();
  if (typeof fromService === 'number' && Number.isFinite(fromService)) {
    return Math.floor(fromService);
  }

  const video = document.querySelector('video');
  return video instanceof HTMLVideoElement ? Math.floor(video.currentTime) : 0;
}

/**
 * Applies the corner geometry, writing only what isn't already right.
 *
 * The read-before-write matters twice over: {@link videoObserver} re-runs this
 * on every style change, so an unconditional write would loop forever, and some
 * webOS builds report a mutation even for an assignment that changes nothing
 * (the same trap `src/screensaver-fix.ts` documents).
 *
 * `right`/`bottom` are pinned to `auto` rather than clearing `inset`, because
 * `inset` serialises back as a shorthand that never compares equal.
 */
function shrink({ video, player, container }: Elements) {
  const size = (100 / MINI_SCALE).toFixed(2);

  const geometry: [string, string][] = [
    ['width', `${size}vw`],
    ['height', `${size}vh`],
    ['top', `${MINI_INSET}vh`],
    ['left', `${MINI_INSET}vw`],
    ['right', 'auto'],
    ['bottom', 'auto']
  ];

  for (const [property, value] of geometry) {
    if (video.style.getPropertyValue(property) !== value) {
      video.style.setProperty(property, value);
    }
  }

  if (container.style.zIndex !== MINI_Z_INDEX) {
    container.style.setProperty('z-index', MINI_Z_INDEX);
  }

  if (player.style.display !== 'block') {
    player.style.setProperty('display', 'block');
  }

  // The player's own backdrop would otherwise black out the browse page behind
  // the corner video.
  if (player.style.backgroundColor !== 'transparent') {
    player.style.setProperty('background-color', 'transparent');
  }
}

/**
 * Keeps the corner video where we put it.
 *
 * YouTube lays the player out again a moment after `loadVideo`, and swaps the
 * `<video>` element outright when it changes quality, so the geometry has to be
 * defended rather than set once.
 */
function maintain() {
  if (state === 'off' || !entered) return;

  const video = document.querySelector('video');
  if (video instanceof HTMLVideoElement && video !== entered.video) {
    console.info('[mini-player] Video element replaced; following it');
    saveStyle(video);
    entered.video = video;
    videoObserver.disconnect();
    videoObserver.observe(video, {
      attributes: true,
      attributeFilter: ['style']
    });
  }

  shrink(entered);
}

const videoObserver = new MutationObserver(maintain);

function enterMiniPlayer() {
  if (!configRead('enableMiniPlayer')) return;
  if (state !== 'off') return;

  if (!services) {
    console.warn('[mini-player] YouTube services unavailable; ignoring');
    return;
  }

  const elements = findElements();
  if (!elements) {
    console.warn(
      '[mini-player] Player elements not found; staying full screen'
    );
    return;
  }

  entered = elements;
  resumeAt = currentTime();

  for (const element of [elements.video, elements.player, elements.container]) {
    saveStyle(element);
  }

  // Held from here rather than from when the corner video appears, so that a
  // preview cannot start during the second the player spends being rebuilt.
  state = 'entering';

  pageObserver.observe(document.body, {
    attributes: true,
    attributeFilter: ['class']
  });

  enterTimer = window.setTimeout(() => {
    if (state !== 'entering') return;
    console.warn('[mini-player] Never left the watch page; giving up');
    reset();
  }, ENTER_TIMEOUT_MS);

  // A settings popup or the control overlay may be on screen; let it take the
  // first back before we use one to leave the page.
  setTimeout(() => {
    void dispatch({ signalAction: { signal: 'HISTORY_BACK' } });
  }, HISTORY_BACK_DELAY_MS);
}

/** Second half of entering: the watch page is gone, so claim the player. */
function onWatchPageLeft() {
  const elements = entered;
  if (!elements) {
    reset();
    return;
  }

  videoObserver.observe(elements.video, {
    attributes: true,
    attributeFilter: ['style']
  });

  maintain();

  // The observer catches restyling of the element we know about; these cover
  // the browse page settling and the reload swapping the element for a new one.
  for (const delay of RESTYLE_DELAYS_MS) setTimeout(maintain, delay);

  setTimeout(() => {
    if (state !== 'entering') return;

    const config = services?.player.loadedPlaybackConfig;
    if (!config?.watchEndpoint) {
      console.warn('[mini-player] No playback config to resume from');
      reset();
      return;
    }

    // Usually a no-op — the video is still loaded and simply keeps playing —
    // but it is what puts playback back if the teardown did stop it.
    config.watchEndpoint.startTimeSeconds = resumeAt;
    services?.player.loadVideo(config);

    clearTimeout(enterTimer);
    state = 'on';

    void showToast(
      'Mini player',
      'Press the yellow button to go back to full screen'
    );
  }, RELOAD_DELAY_MS);
}

/** Returns to the full-screen player, at the point the mini player reached. */
function exitMiniPlayer() {
  if (state === 'off') return;

  const startTimeSeconds = currentTime();
  const config = services?.player.loadedPlaybackConfig;

  reset();

  if (!config?.watchEndpoint) {
    console.warn('[mini-player] No playback config to return to');
    return;
  }

  // Resume where the corner video got to, not where it was opened.
  config.watchEndpoint.startTimeSeconds = startTimeSeconds;

  const command: Record<string, unknown> = {
    clickTrackingParams: config.clickTrackingParams ?? null,
    watchEndpoint: config.watchEndpoint
  };

  // Absent on webOS's build; passed through where it exists.
  if (config.commandMetadata !== undefined) {
    command.commandMetadata = config.commandMetadata;
  }

  void dispatch(command);
}

// --- ways in ---------------------------------------------------------------

/** Adds a mini-player button to the player's transport controls. */
addJsonParseHandler('mini-player-button', (value) => {
  if (typeof value !== 'object' || value === null) return;
  if (!configRead('enableMiniPlayer')) return;
  if (!services) return;

  const actions = (
    value as {
      transportControls?: {
        transportControlsRenderer?: { promotedActions?: unknown[] };
      };
    }
  ).transportControls?.transportControlsRenderer?.promotedActions;

  if (!Array.isArray(actions)) return;

  const TYPE = 'TRANSPORT_CONTROLS_BUTTON_TYPE_PIP';

  // The same response can be parsed more than once.
  if (actions.some((a) => (a as { type?: unknown } | null)?.type === TYPE)) {
    return;
  }

  actions.push({
    type: TYPE,
    button: {
      buttonRenderer: ButtonRenderer(
        'Mini player',
        MINI_PLAYER_ICON,
        customActionCommand(ENTER_ACTION)
      )
    }
  });
});

/**
 * Adds a mini-player entry to YouTube's own playback settings popup — the one
 * behind the gear in the player controls.
 */
const popupHook: ResolveCommandHook = function (next, payload, extra) {
  if (!configRead('enableMiniPlayer') || !services) {
    return next(payload as ResolveCommandPayload, extra);
  }

  const items = (
    payload as {
      openPopupAction?: {
        popup?: {
          overlaySectionRenderer?: {
            overlay?: {
              overlayTwoPanelRenderer?: {
                actionPanel?: {
                  overlayPanelRenderer?: {
                    content?: {
                      overlayPanelItemListRenderer?: { items?: unknown[] };
                    };
                  };
                };
              };
            };
          };
        };
      };
    }
  ).openPopupAction?.popup?.overlaySectionRenderer?.overlay
    ?.overlayTwoPanelRenderer?.actionPanel?.overlayPanelRenderer?.content
    ?.overlayPanelItemListRenderer?.items;

  // Identified by the speed row rather than by a popup id, matching how
  // `src/playback-speed.ts` finds the same popup.
  const speedIndex = Array.isArray(items)
    ? items.findIndex(
        (item) =>
          (item as { compactLinkRenderer?: { icon?: { iconType?: string } } })
            ?.compactLinkRenderer?.icon?.iconType === SPEED_ICON
      )
    : -1;

  if (Array.isArray(items) && speedIndex !== -1) {
    const already = items.some(
      (item) =>
        (item as { compactLinkRenderer?: { icon?: { iconType?: string } } })
          ?.compactLinkRenderer?.icon?.iconType === MINI_PLAYER_ICON
    );

    if (!already) {
      items.splice(
        speedIndex + 1,
        0,
        buttonItem({ title: 'Mini player' }, { icon: MINI_PLAYER_ICON }, [
          // Close the popup first: entering uses a back of its own to leave the
          // watch page, and the popup would otherwise swallow it.
          POPUP_BACK,
          customActionCommand(ENTER_ACTION)
        ])
      );
    }
  }

  return next(payload as ResolveCommandPayload, extra);
};

/**
 * The yellow button toggles the mini player: it shrinks the video on the watch
 * page, and restores it from anywhere else. Green and blue are already taken —
 * see `src/advanced_settings/index.ts` and `src/ui.js`.
 */
function onKeyEvent(evt: KeyboardEvent) {
  if (!YELLOW_KEY_CODES.has(evt.charCode)) return;
  if (!configRead('enableMiniPlayer')) return;

  // Nothing to toggle: leave the key to YouTube rather than swallowing it.
  if (state === 'off' && !canEnter()) return;

  evt.preventDefault();
  evt.stopPropagation();

  if (evt.type !== 'keydown') return;

  // One press of yellow arrives as two keydowns, under both of the codes in
  // YELLOW_KEY_CODES. Acting on each would toggle twice and land back where it
  // started, so a press only counts once. Held keys repeat, too.
  const now = Date.now();
  if (now - lastToggleAt < TOGGLE_COOLDOWN_MS) return;
  lastToggleAt = now;

  if (state === 'off') {
    enterMiniPlayer();
  } else {
    exitMiniPlayer();
  }
}

for (const type of ['keydown', 'keypress', 'keyup'] as const) {
  document.addEventListener(type, onKeyEvent, true);
}

// Leaving the page with the preview service still muzzled would be a bad way to
// hand the app back to webOS.
window.addEventListener('pagehide', () => {
  if (state === 'off') return;

  const video = document.querySelector('video');
  if (video instanceof HTMLVideoElement) video.pause();

  reset();
});

async function start() {
  services = await resolveServices();

  if (!services) {
    console.warn(
      '[mini-player] PlayerService/PlaybackPreviewService not found; the mini player is unavailable'
    );
    return;
  }

  patchPreviewService(services);

  const registry = await ResolveCommandRegistry.getInstance();
  registry.setHook('openPopupAction', popupHook);
}

void registerCustomAction(ENTER_ACTION, () => enterMiniPlayer());

void start();
