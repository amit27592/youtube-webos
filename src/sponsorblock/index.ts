import { configRead } from '../config';
import { getPlayerManager, PlayerMode } from '../player_api/manager';
import { requireElement } from '../player_api/helpers';
import { SponsorBlockHandler } from './handler';
import { currentHandler, setCurrentHandler } from './current';
import { fetchSegments } from './segments';
import './prompts';

/**
 * SponsorBlock — https://sponsor.ajay.app/
 *
 * The handler's lifecycle is driven by the player manager's `newVideo` event
 * rather than by `hashchange` plus a `setTimeout` poll for the `<video>`
 * element. That means we learn about a new video from the player itself, and
 * `playerMode` tells us whether it is a real watch-page video or a home-screen
 * preview — the case the old `hashchange` path had to detect by inspecting the
 * URL path.
 */

function teardown() {
  const handler = currentHandler();
  if (!handler) return;

  try {
    handler.destroy();
  } catch (err) {
    console.warn('[sponsorblock] destroy() failed:', err);
  }

  setCurrentHandler(null);
}

/**
 * Starts the segment fetch as soon as the video ID appears in the URL.
 *
 * This is earlier than `newVideo`, which needs the player to have loaded, and
 * earlier than YouTube's own player request. The result is only cached — the
 * handler below awaits the same in-flight request — but the head start is what
 * gives the manual-skip prompts in `./prompts.ts` a chance to be injected into
 * the player response that follows.
 */
window.addEventListener('hashchange', () => {
  if (!configRead('enableSponsorBlock')) return;

  let videoID: string | null = null;
  try {
    const url = new URL(location.hash.substring(1), location.href);
    if (url.pathname !== '/watch') return;
    videoID = url.searchParams.get('v');
  } catch {
    return;
  }

  if (videoID) void fetchSegments(videoID);
});

async function start() {
  const manager = await getPlayerManager();
  const video = await requireElement('video', HTMLVideoElement);

  manager.addEventListener('newVideo', (event) => {
    const videoID = event.detail;

    if (currentHandler()?.videoID === videoID) return;

    teardown();

    if (manager.playerMode !== PlayerMode.NORMAL) {
      // A home-screen preview or a Short. Neither has a progress bar to draw
      // on, and skipping inside a preview would be actively wrong.
      return;
    }

    if (!configRead('enableSponsorBlock')) {
      console.info('[sponsorblock] disabled, not loading');
      return;
    }

    const handler = new SponsorBlockHandler(videoID, video);
    setCurrentHandler(handler);
    void handler.init();
  });
}

void start();
