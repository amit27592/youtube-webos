// Adapted from https://github.com/reisxd/TizenTube/blob/3f28fc3d/mods/features/videoQueuing.js

import { configRead } from './config';
import { addJsonParseHandler } from './hooks/json-parse';
import {
  customActionCommand,
  registerCustomAction,
  ResolveCommandRegistry,
  type ResolveCommandPayload
} from './app_api/index';
import { getPlayerManager, PlayerMode } from './player_api';
import {
  dispatch,
  longPressData,
  MenuServiceItemRenderer,
  playMenuItem,
  savePlaylistMenuItem,
  ShelfRenderer,
  showToast,
  TileRenderer,
  watchLaterMenuItem
} from './yt_ui/index';

/**
 * A play queue: "watch this next", built from the long-press menu on any tile.
 *
 * Two divergences from TizenTube, both in the interest of there being less to
 * go wrong:
 *
 * - Their state is a global `window.queuedVideos` holding whole cloned tile
 *   payloads. This keeps a module-scoped store of just what a queue entry
 *   needs, and exports accessors instead of a mutable global.
 *
 * - Their advance-on-end logic tracks a `lastVideoId` and searches the queue
 *   by index, with three branches for the cases where the current video is in
 *   the queue, isn't but the last one was, or neither. Here a video *leaves*
 *   the queue when it starts playing, so the queue always means "what is still
 *   to come": ending a video plays the front of it, and there is no index to
 *   keep in step.
 *
 * The queue is deliberately in-memory. A queue from two days ago is worse than
 * no queue.
 */

const ADD_ACTION = 'ADD_TO_QUEUE';
const CLEAR_ACTION = 'CLEAR_QUEUE';

/** The signal YouTube's own "Next" button sends. */
const PLAY_NEXT_SIGNAL = 'PLAYER_PLAY_NEXT';

/**
 * Re-renders the current page from a fresh response, without touching
 * playback — which is how the queue shelf gets rebuilt after the queue changes
 * under it.
 */
const RELOAD_SIGNAL = 'SOFT_RELOAD_PAGE';

const SHELF_TITLE = 'Queued videos';

/** Let the player settle before navigating; matches TizenTube's delay. */
const ADVANCE_DELAY_MS = 500;

/**
 * How long one advance suppresses the next. A video ending can both raise
 * `playbackEnded` and send {@link PLAY_NEXT_SIGNAL}; without this the queue
 * would lose an entry to each.
 */
const ADVANCE_COOLDOWN_MS = 3000;

export interface QueuedVideo {
  videoId: string;
  title: string;
  /** The command that plays it — taken from the tile it was queued from. */
  onSelectCommand: unknown;
  thumbnails: { url: string }[];
}

const queue: QueuedVideo[] = [];

/** The queue, as a copy: callers get to read it, not to reorder it. */
export function queuedVideos(): QueuedVideo[] {
  return queue.slice();
}

export function clearQueue() {
  const had = queue.length > 0;
  queue.length = 0;
  console.info('[video-queue] Queue cleared');

  showToast('Video queue', 'Queue cleared');

  // The shelf is built when a page's response is parsed, so the tiles on screen
  // outlive the queue they were built from: clearing without this leaves the
  // queue looking untouched. The reload leaves playback alone.
  if (had)
    void dispatch({
      clickTrackingParams: null,
      signalAction: { signal: RELOAD_SIGNAL }
    });
}

function enqueue(video: QueuedVideo) {
  if (queue.some((v) => v.videoId === video.videoId)) {
    console.info('[video-queue] Already queued:', video.videoId);
    showToast('Video queue', `Already queued: ${video.title}`);
    return;
  }

  queue.push(video);
  console.info(
    '[video-queue] Queued',
    video.title,
    `(${queue.length} waiting)`
  );

  showToast(
    'Video queue',
    queue.length === 1 ? 'Playing next' : `${queue.length} waiting`,
    { thumbnails: video.thumbnails }
  );
}

function dequeue(videoId: string) {
  const index = queue.findIndex((v) => v.videoId === videoId);
  if (index !== -1) queue.splice(index, 1);
}

function enabled() {
  return configRead('enableVideoQueue');
}

// --- reading tiles ---------------------------------------------------------

interface Tile {
  contentId?: unknown;
  style?: unknown;
  metadata?: {
    tileMetadataRenderer?: {
      title?: { simpleText?: string };
      lines?: unknown[];
    };
  };
  header?: {
    tileHeaderRenderer?: { thumbnail?: { thumbnails?: { url: string }[] } };
  };
  onSelectCommand?: {
    watchEndpoint?: unknown;
  };
  onLongPressCommand?: {
    showMenuCommand?: { menu?: { menuRenderer?: { items?: unknown[] } } };
  };
}

function readTile(tile: Tile): QueuedVideo | null {
  const videoId = tile.contentId;
  const title = tile.metadata?.tileMetadataRenderer?.title?.simpleText;
  const thumbs = tile.header?.tileHeaderRenderer?.thumbnail?.thumbnails;

  if (typeof videoId !== 'string' || !title) return null;
  if (!tile.onSelectCommand?.watchEndpoint) return null;

  return {
    videoId,
    title,
    // The tile is about to be handed to YouTube, which is free to mutate it;
    // the queue outlives this response, so it keeps its own copy.
    onSelectCommand: JSON.parse(
      JSON.stringify(tile.onSelectCommand)
    ) as unknown,
    thumbnails: thumbs ? thumbs.slice() : []
  };
}

/** The first line of a tile's metadata, used as the long-press subtitle. */
function subtitleOf(tile: Tile): string | undefined {
  const line = (
    tile.metadata?.tileMetadataRenderer?.lines as
      | {
          lineRenderer?: {
            items?: {
              lineItemRenderer?: {
                text?: { simpleText?: string; runs?: { text?: string }[] };
              };
            }[];
          };
        }[]
      | undefined
  )?.[0]?.lineRenderer?.items?.[0]?.lineItemRenderer?.text;

  if (!line) return undefined;

  return line.simpleText ?? line.runs?.[0]?.text;
}

function addToQueueItem(video: QueuedVideo) {
  return MenuServiceItemRenderer('Add to queue', {
    clickTrackingParams: null,
    // A menu service item wants an endpoint shape; the custom action rides
    // inside one the registry unwraps.
    playlistEditEndpoint: customActionCommand(ADD_ACTION, video)
  });
}

/**
 * Adds "Add to queue" to a tile, either by appending to the menu it already has
 * or by giving it one.
 */
function addQueueEntry(tile: Tile) {
  if (tile.style !== 'TILE_STYLE_YTLR_DEFAULT') return;

  const video = readTile(tile);
  if (!video) return;

  const existing = tile.onLongPressCommand?.showMenuCommand?.menu?.menuRenderer;

  if (Array.isArray(existing?.items)) {
    // The same response can be parsed more than once.
    const already = existing.items.some(
      (item) =>
        (item as { menuServiceItemRenderer?: { serviceEndpoint?: unknown } })
          ?.menuServiceItemRenderer?.serviceEndpoint &&
        JSON.stringify(item).includes(ADD_ACTION)
    );

    if (!already) existing.items.push(addToQueueItem(video));
    return;
  }

  // No menu to extend, so build one — but only for a tile complete enough to
  // fill it out.
  if (!configRead('enableLongPress')) return;
  if (video.thumbnails.length === 0) return;

  const subtitle = subtitleOf(tile);

  tile.onLongPressCommand = longPressData(
    {
      videoId: video.videoId,
      title: video.title,
      ...(subtitle !== undefined && { subtitle }),
      thumbnails: video.thumbnails
    },
    [
      playMenuItem(tile.onSelectCommand?.watchEndpoint),
      watchLaterMenuItem(video.videoId),
      savePlaylistMenuItem(video.videoId),
      addToQueueItem(video)
    ]
  ) as NonNullable<Tile['onLongPressCommand']>;
}

// --- the shelf -------------------------------------------------------------

function queueShelf() {
  const tiles: unknown[] = queue.map((video) =>
    TileRenderer(video.title, video.onSelectCommand as never, video.thumbnails)
  );

  tiles.unshift(TileRenderer('Clear queue', customActionCommand(CLEAR_ACTION)));

  return ShelfRenderer(SHELF_TITLE, tiles);
}

// --- response patching -----------------------------------------------------

function walkTiles(value: unknown, depth: number, visit: (tile: Tile) => void) {
  if (depth > 20 || typeof value !== 'object' || value === null) return;

  if (Array.isArray(value)) {
    for (const entry of value) walkTiles(entry, depth + 1, visit);
    return;
  }

  const record = value as Record<string, unknown>;

  const tile = record.tileRenderer;
  if (tile && typeof tile === 'object') {
    visit(tile as Tile);
    return;
  }

  for (const key in record) walkTiles(record[key], depth + 1, visit);
}

addJsonParseHandler('video-queue', (value) => {
  if (!enabled()) return;
  if (typeof value !== 'object' || value === null) return;

  walkTiles(value, 0, addQueueEntry);

  if (queue.length === 0) return;

  const pivot = (
    value as {
      contents?: {
        singleColumnWatchNextResults?: {
          pivot?: { sectionListRenderer?: { contents?: unknown[] } };
        };
      };
    }
  ).contents?.singleColumnWatchNextResults?.pivot?.sectionListRenderer;

  if (!Array.isArray(pivot?.contents)) return;

  // Idempotent: the same watch-next response can be parsed twice.
  const already = pivot.contents.some(
    (entry) =>
      (
        entry as {
          shelfRenderer?: {
            shelfHeaderRenderer?: { title?: { simpleText?: string } };
          };
        }
      )?.shelfRenderer?.shelfHeaderRenderer?.title?.simpleText === SHELF_TITLE
  );

  if (!already) pivot.contents.unshift(queueShelf());
});

// --- playback --------------------------------------------------------------

let lastAdvance = 0;

/**
 * Plays the front of the queue, if there is one.
 *
 * @param delayMs Wait before navigating. Navigating the instant the player
 *   reports the end of a video lands mid-teardown.
 * @returns Whether the queue took the request. `true` with nothing dispatched
 *   means an advance is already in flight — the caller should still treat the
 *   request as handled.
 */
function advance(
  registry: ResolveCommandRegistry,
  reason: string,
  delayMs = 0
): boolean {
  const next = queue[0];
  if (!next) return false;

  const now = Date.now();
  if (now - lastAdvance < ADVANCE_COOLDOWN_MS) {
    console.debug('[video-queue] Advance already in flight, ignoring', reason);
    return true;
  }
  lastAdvance = now;

  console.info(`[video-queue] ${reason}: playing`, next.title);

  const play = () =>
    registry.dispatchCommand(next.onSelectCommand as ResolveCommandPayload);

  if (delayMs > 0) setTimeout(play, delayMs);
  else play();

  return true;
}

async function start() {
  const registry = await ResolveCommandRegistry.getInstance();
  const manager = await getPlayerManager();

  // A video that starts playing is no longer waiting to be played.
  manager.addEventListener('newVideo', (event) => {
    dequeue(event.detail);
  });

  manager.addEventListener('playbackEnded', () => {
    if (!enabled()) return;
    if (manager.playerMode !== PlayerMode.NORMAL) return;

    advance(registry, 'Video ended', ADVANCE_DELAY_MS);
  });

  // The "Next" button, which otherwise plays whatever YouTube has picked for
  // autoplay — the queue is a more specific answer to the same question.
  registry.setHook('signalAction', (next, payload, extra) => {
    const signal = (payload.signalAction as { signal?: unknown } | undefined)
      ?.signal;

    if (!enabled() || signal !== PLAY_NEXT_SIGNAL) {
      return next(payload, extra);
    }

    if (advance(registry, 'Next pressed')) return true;

    return next(payload, extra);
  });
}

void registerCustomAction(ADD_ACTION, (parameters) => {
  const video = parameters as QueuedVideo | null;
  if (!video || typeof video.videoId !== 'string') return;

  enqueue(video);
});

void registerCustomAction(CLEAR_ACTION, () => clearQueue());

void start();
