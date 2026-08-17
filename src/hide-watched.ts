// Adapted from https://github.com/reisxd/TizenTube/blob/3f28fc3d/mods/features/adblock.js

import { configRead } from './config';
import { addJsonParseHandler } from './hooks/json-parse';

/**
 * Drops videos you've already watched from shelves.
 *
 * A watched tile carries a `thumbnailOverlayResumePlaybackRenderer` with the
 * percentage watched, so this needs nothing beyond the response itself.
 *
 * Which pages it applies to is a setting, because "hide what I've seen" is
 * right on a subscriptions feed and wrong on a channel page where it would
 * make a series look like it has holes in it.
 */

/** Where the current page name comes from, since responses don't carry one. */
function currentPage(): string {
  const hash = location.hash.substring(1);

  if (hash === '' || hash === '/') return 'home';
  if (hash.startsWith('/search')) return 'search';

  // e.g. `#/channel?c=FEsubscriptions` -> `subscriptions`
  const param = hash.split('?')[1]?.split('&')[0]?.split('=')[1];
  if (!param) return '';

  return param.replace('FE', '').replace('topics_', '');
}

interface ResumeOverlay {
  thumbnailOverlayResumePlaybackRenderer?: {
    percentDurationWatched?: number;
  };
}

interface Tile {
  tileRenderer?: {
    header?: {
      tileHeaderRenderer?: { thumbnailOverlays?: ResumeOverlay[] };
    };
  };
}

/** How far through a tile's video the viewer got, or `null` if never started. */
function percentWatched(item: Tile): number | null {
  const overlays =
    item.tileRenderer?.header?.tileHeaderRenderer?.thumbnailOverlays;

  if (!Array.isArray(overlays)) return null;

  const resume = overlays.find(
    (o) => o?.thumbnailOverlayResumePlaybackRenderer
  )?.thumbnailOverlayResumePlaybackRenderer;

  if (!resume) return null;

  return resume.percentDurationWatched ?? 0;
}

function shouldHide(item: unknown): boolean {
  const watched = percentWatched(item as Tile);
  if (watched === null) return false;

  return watched > configRead('hideWatchedVideosThreshold');
}

/**
 * Filters the item lists a shelf can hold.
 *
 * TizenTube calls their filter from each container shape they enumerate;
 * this walks for `horizontalListRenderer` instead, so a shelf in a payload
 * shape nobody has met yet is covered too.
 */
function filterLists(value: unknown, depth: number) {
  if (depth > 20 || typeof value !== 'object' || value === null) return;

  if (Array.isArray(value)) {
    for (const entry of value) filterLists(entry, depth + 1);
    return;
  }

  const record = value as Record<string, unknown>;

  const list = record.horizontalListRenderer as
    | { items?: unknown[] }
    | undefined;

  if (list && Array.isArray(list.items)) {
    const kept = list.items.filter((item) => !shouldHide(item));

    // An empty shelf renders as a title with nothing under it, which looks
    // broken; leave one behind rather than produce that.
    if (kept.length > 0) list.items = kept;
    return;
  }

  for (const key in record) filterLists(record[key], depth + 1);
}

addJsonParseHandler('hide-watched', (value) => {
  if (typeof value !== 'object' || value === null) return;

  if (!configRead('enableHideWatchedVideos')) return;

  const pages: readonly string[] = configRead('hideWatchedVideosPages');
  if (pages.length === 0) return;
  if (!pages.includes(currentPage())) return;

  filterLists(value, 0);
});
