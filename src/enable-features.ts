// Adapted from https://github.com/reisxd/TizenTube/blob/3f28fc3d/mods/features/enableFeatures.js
// and https://github.com/reisxd/TizenTube/blob/3f28fc3d/mods/ui/ui.js (`enableFixedUI`)

import { ResolveCommandRegistry } from './app_api/index';
import { configRead, configAddChangeListener } from './config';

/**
 * YouTube profiles the device at startup and switches features off when it
 * decides the hardware is too weak. LG TVs get classified as low-end even when
 * they aren't, so this flips the relevant switches back on.
 */

interface TectonicConfig {
  featureSwitches?: Record<string, unknown>;
  clientData?: Record<string, unknown>;
}

declare global {
  interface Window {
    tectonicConfig?: TectonicConfig;
  }
}

const PREVIEWS_FLAG = 'ENABLE_PREVIEWS_WITH_SOUND';

/**
 * Finds YouTube's feature-flag `Map` inside `window._yttv`.
 *
 * There is no stable name for it, so it's identified by the flag it carries.
 */
function findFlagMap(): Map<string, unknown> | null {
  if (typeof window._yttv !== 'object' || window._yttv === null) return null;

  for (const value of Object.values(window._yttv)) {
    if (value instanceof Map && value.has(PREVIEWS_FLAG)) {
      return value as Map<string, unknown>;
    }
  }

  return null;
}

let flagMap: Map<string, unknown> | null = null;

function applyPreviews() {
  if (!flagMap) return;

  const value = configRead('enablePreviews');
  flagMap.set(PREVIEWS_FLAG, value);
  console.info(`[enable-features] Set ${PREVIEWS_FLAG} =`, value);
}

/**
 * The UI-quality switches.
 *
 * We already pass `env_forceFullAnimation=1` on the app URL (see
 * `src/utils.js`), which covers `clientData.legacyApplicationQuality`, and
 * `src/ui.js` already strips the `app-quality-root` body class that TizenTube
 * removes with a `MutationObserver`. Neither of those touches
 * `featureSwitches`, so these four remain ours to set.
 *
 * Each override logs the value it replaced — if a switch turns out to already
 * hold the desired value on device, it can be dropped from this list.
 */
const FEATURE_SWITCH_OVERRIDES: Record<string, boolean> = {
  isLimitedMemory: false,
  enableAnimations: true,
  enableOnScrollLinearAnimation: true,
  enableListAnimations: true
};

const LEGACY_APPLICATION_QUALITY = 'full-animation';

function applyFixedUI() {
  if (!configRead('enableFixedUI')) return;

  const tectonicConfig = window.tectonicConfig;

  if (!tectonicConfig) {
    console.warn('[enable-features] window.tectonicConfig is not available');
    return;
  }

  const { featureSwitches, clientData } = tectonicConfig;

  if (featureSwitches) {
    for (const [key, desired] of Object.entries(FEATURE_SWITCH_OVERRIDES)) {
      const previous = featureSwitches[key];

      if (previous === desired) {
        console.debug(
          `[enable-features] featureSwitches.${key} already`,
          desired
        );
        continue;
      }

      featureSwitches[key] = desired;
      console.info(
        `[enable-features] featureSwitches.${key}:`,
        previous,
        '->',
        desired
      );
    }
  } else {
    console.warn('[enable-features] tectonicConfig.featureSwitches is missing');
  }

  // Redundant with `env_forceFullAnimation=1` in the app URL as far as we know,
  // but harmless and cheap insurance if that flag ever stops being honoured.
  if (clientData && clientData.legacyApplicationQuality !== undefined) {
    const previous = clientData.legacyApplicationQuality;

    if (previous !== LEGACY_APPLICATION_QUALITY) {
      clientData.legacyApplicationQuality = LEGACY_APPLICATION_QUALITY;
      console.info(
        '[enable-features] clientData.legacyApplicationQuality:',
        previous,
        '->',
        LEGACY_APPLICATION_QUALITY
      );
    }
  }
}

/**
 * Resolves once the YouTube bundle has published its feature-flag map.
 *
 * The registry's own readiness is a good proxy for "`_yttv` is populated", but
 * the flag map may land slightly later, so fall back to a bounded poll rather
 * than spinning forever if YouTube renames the flag.
 */
async function waitForFlagMap(
  timeoutMs = 30_000
): Promise<Map<string, unknown> | null> {
  await ResolveCommandRegistry.getInstance();

  const deadline = Date.now() + timeoutMs;

  return new Promise((resolve) => {
    const poll = () => {
      const found = findFlagMap();

      if (found) {
        resolve(found);
      } else if (Date.now() > deadline) {
        console.warn(
          `[enable-features] Gave up looking for the ${PREVIEWS_FLAG} flag map`
        );
        resolve(null);
      } else {
        setTimeout(poll, 250);
      }
    };

    poll();
  });
}

applyFixedUI();
window.addEventListener('load', applyFixedUI);
configAddChangeListener('enableFixedUI', applyFixedUI);

// Deliberately not top-level `await`: this can wait tens of seconds, and every
// module imported after this one in `userScript.ts` would wait with it.
void (async () => {
  flagMap = await waitForFlagMap();
  applyPreviews();
})();

configAddChangeListener('enablePreviews', applyPreviews);
