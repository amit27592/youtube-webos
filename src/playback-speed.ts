// Adapted from https://github.com/reisxd/TizenTube/blob/3f28fc3d/mods/ui/speedUI.js

import { configGetOption, configRead, configWrite } from './config';
import { addJsonParseHandler } from './hooks/json-parse';
import {
  registerCustomAction,
  customActionCommand,
  ResolveCommandRegistry,
  type ResolveCommandHook,
  type ResolveCommandPayload
} from './app_api/index';
import { getPlayerManager } from './player_api/manager';
import { requireElement } from './player_api/helpers';
import {
  ButtonRenderer,
  buttonItem,
  overlayPanelItemListRenderer,
  setClientSetting,
  showModal,
  POPUP_BACK
} from './yt_ui/index';

/**
 * Playback speed control.
 *
 * ON PERSISTENCE: the chosen speed is deliberately **not** carried across app
 * launches. On a TV the setting is not visible anywhere until you open the
 * picker, so a 2x rate left on from last night is a genuinely confusing thing
 * to start the day with, and it is not obvious where to undo it. TizenTube
 * persists it. The `videoSpeed` key still exists so the picker can round-trip
 * through the normal config path and the current value shows up in Advanced
 * Settings; it is just reset to 1x at startup. The *increment* preference,
 * which is a preference rather than a mode, does persist.
 */

const SHOW_ACTION = 'PLAYBACK_SPEED_SHOW';
const SET_ACTION = 'PLAYBACK_SPEED_SET';

/** YouTube's own speed entry in the playback settings popup. */
const SPEED_ICON = 'SLOW_MOTION_VIDEO';

function label(speed: number) {
  return `${speed}x`;
}

/**
 * The speeds offered.
 *
 * The bounds come from the `videoSpeed` schema entry rather than from constants
 * here: a choice outside them would be rejected on the way into config, so the
 * picker would offer a row that silently did nothing.
 */
function speedChoices(): number[] {
  const option = configGetOption('videoSpeed');
  if (option.type !== 'number') return [1];

  const increment = configRead('speedSettingsIncrement');
  const choices: number[] = [];

  for (let speed = option.min; speed <= option.max + 1e-9; speed += increment) {
    // Accumulated float error would otherwise produce 1.7500000000000002,
    // which fails the schema's range check on the way into config.
    choices.push(Math.round(speed * 100) / 100);
  }

  // 1x must always be reachable, whatever the increment lands on.
  if (!choices.includes(1)) {
    choices.push(1);
    choices.sort((a, b) => a - b);
  }

  return choices;
}

async function applySpeed(speed: number) {
  const manager = await getPlayerManager();
  const player = manager.player;

  if (typeof player.setPlaybackRate === 'function') {
    player.setPlaybackRate(speed);
    return;
  }

  // Older player builds may not expose the API method. The element is a worse
  // target -- the player replaces it between videos -- but it is better than
  // silently doing nothing, and `reapply` below covers the swap.
  console.warn('[playback-speed] Player has no setPlaybackRate; using <video>');
  const video = await requireElement('video', HTMLVideoElement);
  video.playbackRate = speed;
}

function showPicker() {
  const current = configRead('videoSpeed');

  const choices = speedChoices();
  const rows = choices.map((speed) =>
    buttonItem(
      label(speed),
      {
        secondaryIcon:
          speed === current ? 'RADIO_BUTTON_CHECKED' : 'RADIO_BUTTON_UNCHECKED'
      },
      [
        POPUP_BACK,
        setClientSetting('videoSpeed', { intValue: String(speed) }),
        customActionCommand(SET_ACTION, { speed })
      ]
    )
  );

  const selectedIndex = Math.max(choices.indexOf(current), 0);

  return showModal(
    { title: 'Playback speed' },
    overlayPanelItemListRenderer(rows, selectedIndex),
    { id: 'ytaf-playback-speed' }
  );
}

/** Adds a speed button to the player's transport controls. */
addJsonParseHandler('playback-speed-button', (value) => {
  if (typeof value !== 'object' || value === null) return;
  if (!configRead('enableSpeedControlsButton')) return;

  const actions = (
    value as {
      transportControls?: {
        transportControlsRenderer?: { promotedActions?: unknown[] };
      };
    }
  ).transportControls?.transportControlsRenderer?.promotedActions;

  if (!Array.isArray(actions)) return;

  const TYPE = 'TRANSPORT_CONTROLS_BUTTON_TYPE_SPEED';

  // YouTube may already offer one, and the same response can be parsed twice.
  if (actions.some((a) => (a as { type?: unknown } | null)?.type === TYPE)) {
    return;
  }

  actions.push({
    type: TYPE,
    button: {
      buttonRenderer: ButtonRenderer(
        'Playback speed',
        SPEED_ICON,
        customActionCommand(SHOW_ACTION)
      )
    }
  });
});

/**
 * Redirects YouTube's own speed entry, in the playback settings popup, to our
 * picker — so both routes lead to the same place rather than to two controls
 * that disagree.
 */
const popupHook: ResolveCommandHook = function (next, payload, extra) {
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

  if (Array.isArray(items)) {
    for (const item of items) {
      const renderer = (item as { compactLinkRenderer?: Record<string, any> })
        ?.compactLinkRenderer;

      if (renderer?.icon?.iconType !== SPEED_ICON) continue;

      renderer.serviceEndpoint = {
        clickTrackingParams: null,
        // A settings row accepts a signal-shaped endpoint, so the custom action
        // rides inside one the registry unwraps.
        signalAction: customActionCommand(SHOW_ACTION)
      };
    }
  }

  return next(payload as ResolveCommandPayload, extra);
};

async function start() {
  // See the note on persistence above.
  if (configRead('videoSpeed') !== 1) configWrite('videoSpeed', 1);

  const registry = await ResolveCommandRegistry.getInstance();
  registry.setHook('openPopupAction', popupHook);

  const manager = await getPlayerManager();

  // The player resets the rate for each new video, so put it back.
  const reapply = () => {
    const speed = configRead('videoSpeed');
    if (speed !== 1) void applySpeed(speed);
  };

  manager.addEventListener('newVideo', reapply);
  manager.addEventListener('playbackStart', reapply);
}

void registerCustomAction(SHOW_ACTION, () => void showPicker());

void registerCustomAction(SET_ACTION, (parameters) => {
  const speed = (parameters as { speed?: unknown } | null)?.speed;
  if (typeof speed !== 'number') return;

  void applySpeed(speed);
});

void start();
