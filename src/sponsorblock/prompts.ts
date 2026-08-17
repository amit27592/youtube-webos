// Adapted from https://github.com/reisxd/TizenTube/blob/3f28fc3d/mods/features/adblock.js
// (the `timelyActionRenderers` and `promotedActions` injection)

import { configRead } from '../config';
import { addJsonParseHandler } from '../hooks/json-parse';
import { registerCustomAction, customActionCommand } from '../app_api/index';
import { ButtonRenderer, timelyAction } from '../yt_ui/index';
import { cachedSegments, segmentName, skippableCategories } from './segments';
import { currentHandler } from './current';

/**
 * On-screen prompts for the categories the user chose not to skip
 * automatically, plus the "skip to highlight" button.
 *
 * Both are native renderers injected into the player response as it is parsed:
 * a `timelyActionRenderer` shows a button over the player for exactly the span
 * of its segment, which is precisely the shape a manual skip prompt needs.
 *
 * NOTE ON TIMING: this runs while a response is being parsed and cannot wait
 * for the segment fetch, so it can only inject segments already known. That is
 * why `./index.ts` starts the fetch on `hashchange` — the video ID is known
 * there before YouTube requests the player response, which gives the fetch a
 * head start rather than leaving it to lose the race every time. On a cold
 * first play with a slow network the prompts may still miss their response;
 * they appear on the next one. Auto-skip does not depend on this path at all.
 *
 * TizenTube's version has no head start, and additionally never acts on manual
 * categories in its skip loop, so a manual category there does nothing at all.
 */

const SKIP_ACTION = 'SPONSORBLOCK_SKIP';

function skipCommand(time: number) {
  return {
    clickTrackingParams: null,
    // A `timelyActionRenderer` button only accepts a navigation-shaped
    // endpoint, so the custom action rides inside one the registry unwraps.
    showEngagementPanelEndpoint: customActionCommand(SKIP_ACTION, { time })
  };
}

/** Categories that are enabled for skipping *and* set to ask first. */
function manualCategories(): string[] {
  const manual: readonly string[] = configRead('sponsorBlockManualSkips');
  return skippableCategories().filter((category) => manual.includes(category));
}

function currentVideoID(): string | null {
  const hash = location.hash.substring(1);
  if (!hash) return null;

  try {
    return new URL(hash, location.href).searchParams.get('v');
  } catch {
    return null;
  }
}

interface PlayerOverlays {
  playerOverlays?: {
    playerOverlayRenderer?: { timelyActionRenderers?: unknown[] };
  };
  transportControls?: {
    transportControlsRenderer?: { promotedActions?: unknown[] };
  };
}

function injectPrompts(value: unknown) {
  if (typeof value !== 'object' || value === null) return;

  const response = value as PlayerOverlays;
  const overlay = response.playerOverlays?.playerOverlayRenderer;
  const controls = response.transportControls?.transportControlsRenderer;

  if (!overlay && !controls?.promotedActions) return;

  const videoID = currentVideoID();
  const segments = videoID ? cachedSegments(videoID) : undefined;

  if (overlay) {
    const categories =
      configRead('enableSponsorBlock') && segments ? manualCategories() : [];

    // Always assign, so prompts left over from a previous video are cleared.
    overlay.timelyActionRenderers = (segments ?? [])
      .filter((segment) => categories.includes(segment.category))
      .map((segment) => {
        const [start, end] = segment.segment;

        return timelyAction(
          `Skip ${segmentName(segment.category)}`,
          'SKIP_NEXT',
          skipCommand(end),
          start * 1000,
          (end - start) * 1000
        );
      });
  }

  if (
    controls?.promotedActions &&
    segments &&
    configRead('enableSponsorBlock') &&
    configRead('enableSponsorBlockHighlight')
  ) {
    const highlight = segments.find((seg) => seg.category === 'poi_highlight');

    if (highlight) {
      controls.promotedActions.push({
        type: 'TRANSPORT_CONTROLS_BUTTON_TYPE_SPONSORBLOCK_HIGHLIGHT',
        button: {
          buttonRenderer: ButtonRenderer(
            'Skip to highlight',
            'SKIP_NEXT',
            skipCommand(highlight.segment[0])
          )
        }
      });
    }
  }
}

addJsonParseHandler('sponsorblock-prompts', injectPrompts);

void registerCustomAction(SKIP_ACTION, (parameters) => {
  const time = (parameters as { time?: unknown } | null)?.time;
  if (typeof time !== 'number') return;

  currentHandler()?.skipTo(time);
});
