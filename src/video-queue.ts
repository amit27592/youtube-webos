// Adapted from https://github.com/reisxd/TizenTube/blob/3f28fc3d/mods/features/videoQueuing.js

import { configRead } from './config';
import { addJsonParseHandler } from './hooks/json-parse';
import {
  customActionCommand,
  registerCustomAction,
  ResolveCommandRegistry
} from './app_api/index';
import { getPlayerManager, PlayerMode } from './player_api';
import {
  longPressData,
  MenuServiceItemRenderer,
  playMenuItem,
  savePlaylistMenuItem,
  ShelfRenderer,
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

/** Let the player settle before navigating; matches TizenTube's delay. */
const ADVANCE_DELAY_MS = 500;

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
  queue.length = 0;
  console.info('[video-queue] Queue cleared');
}

function enqueue(video: QueuedVideo) {
  if (queue.some((v) => v.videoId === video.videoId)) {
    console.info('[video-queue] Already queued:', video.videoId);
    return;
  }

  queue.push(video);
  console.info(
    '[video-queue] Queued',
    video.title,
    `(${queue.length} waiting)`
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

  return ShelfRenderer('Queued videos', tiles);
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
      )?.shelfRenderer?.shelfHeaderRenderer?.title?.simpleText ===
      'Queued videos'
  );

  if (!already) pivot.contents.unshift(queueShelf());
});

// --- playback --------------------------------------------------------------

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

    const next = queue[0];
    if (!next) return;

    console.info('[video-queue] Advancing to', next.title);

    // Navigating the instant the player reports the end lands mid-teardown.
    setTimeout(() => {
      registry.dispatchCommand(next.onSelectCommand as Record<string, unknown>);
    }, ADVANCE_DELAY_MS);
  });
}

void registerCustomAction(ADD_ACTION, (parameters) => {
  const video = parameters as QueuedVideo | null;
  if (!video || typeof video.videoId !== 'string') return;

  enqueue(video);
});

void registerCustomAction(CLEAR_ACTION, () => clearQueue());

void start();
