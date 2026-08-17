// Adapted from https://github.com/reisxd/TizenTube/blob/3f28fc3d/mods/features/adblock.js

import sha256 from 'tiny-sha256';
import { configRead } from './config';
import { addJsonParseHandler } from './hooks/json-parse';
import { addResponseInterceptor } from './hooks/fetch';

/**
 * DeArrow: community-submitted titles and thumbnails in place of clickbait.
 * https://dearrow.ajay.app/
 *
 * THE ORDERING PROBLEM, AND HOW THIS SOLVES IT
 *
 * Branding has to be applied while a browse response is being parsed, because
 * that parsed object is what YouTube renders from — but the branding itself
 * needs a network round trip, and `JSON.parse` cannot wait.
 *
 * TizenTube fires one `fetch` per tile from inside the parse hook and mutates
 * the renderer in the `.then()`, long after the object has been handed to the
 * app. That only shows up if YouTube happens not to have read the title yet,
 * which is a race it usually loses; it also re-requests every tile on every
 * response and never caches.
 *
 * Instead we warm the cache *before* the app sees the response, using the
 * awaited interceptor in `./hooks/fetch.ts`: video IDs are pulled out of the
 * raw body with a regex (cheap — no second full parse), branding is fetched for
 * the ones we don't have, and only then is the response released to the app.
 * By the time `JSON.parse` runs, the parse hook can apply branding
 * synchronously and the first paint is already correct.
 *
 * That trade is real: browse requests wait on DeArrow. It is bounded by
 * {@link FETCH_BUDGET_MS}, and past that the response goes through unbranded
 * with the fetch left to populate the cache for next time. The feature is
 * off by default, so nobody pays for it who hasn't asked.
 */

/** The same privacy mirror `sponsorblock/segments.ts` uses. */
const DEARROW_API = 'https://sponsorblock.inf.re/api';
const THUMBNAIL_API = 'https://dearrow-thumb.ajay.app/api/v1/getThumbnail';

/**
 * How long a browse response may be held while branding is fetched. Past this,
 * stock titles are shown rather than making the user stare at a blank screen.
 */
const FETCH_BUDGET_MS = 1200;

/** Video IDs to look up in one go, so a shelf is one request and not thirty. */
const MAX_IDS_PER_RESPONSE = 60;

interface BrandingTitle {
  title: string;
  votes: number;
  locked?: boolean;
}

interface BrandingThumbnail {
  timestamp?: number | null;
  votes: number;
  locked?: boolean;
}

interface Branding {
  title?: string;
  thumbnailTime?: number;
}

/**
 * Branding by video ID. `null` records a video the API knows nothing about, so
 * we don't ask again for it this session.
 */
const cache = new Map<string, Branding | null>();

/** Hash prefixes already requested, keyed to their in-flight or settled fetch. */
const prefixRequests = new Map<string, Promise<boolean>>();

function enabled() {
  return configRead('enableDeArrow');
}

/** Picks the entry the community voted up, matching DeArrow's own precedence. */
function bestOf<T extends { votes: number; locked?: boolean }>(
  entries: T[]
): T | undefined {
  const locked = entries.filter((e) => e.locked);
  const pool = locked.length > 0 ? locked : entries;

  return pool.reduce<T | undefined>(
    (max, entry) =>
      max === undefined || entry.votes > max.votes ? entry : max,
    undefined
  );
}

function readBranding(value: unknown): Branding | null {
  if (typeof value !== 'object' || value === null) return null;

  const record = value as {
    titles?: BrandingTitle[];
    thumbnails?: BrandingThumbnail[];
  };

  const branding: Branding = {};

  const title = Array.isArray(record.titles)
    ? bestOf(record.titles.filter((t) => typeof t?.title === 'string'))
    : undefined;

  if (title) {
    // DeArrow marks words that should not be auto-capitalised with a leading
    // '>'. The marker is not meant to be displayed.
    branding.title = title.title.replace(/(^|\s)>(\S)/g, '$1$2');
  }

  const thumbnail = Array.isArray(record.thumbnails)
    ? bestOf(record.thumbnails.filter((t) => typeof t?.timestamp === 'number'))
    : undefined;

  if (thumbnail && typeof thumbnail.timestamp === 'number') {
    branding.thumbnailTime = thumbnail.timestamp;
  }

  return branding.title === undefined && branding.thumbnailTime === undefined
    ? null
    : branding;
}

/**
 * Fetches every video sharing a 4-character hash prefix.
 *
 * Only the prefix is sent, so neither the mirror nor the upstream API learns
 * which video was asked about — and one request covers many videos at once,
 * which is also why this is gentler on the API than a request per tile.
 */
function fetchPrefix(prefix: string): Promise<boolean> {
  const pending = prefixRequests.get(prefix);
  if (pending) return pending;

  const request = fetch(`${DEARROW_API}/branding/${prefix}`)
    .then((resp) => {
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      return resp.json() as Promise<Record<string, unknown>>;
    })
    .then((results) => {
      if (typeof results !== 'object' || results === null) return false;

      for (const [videoID, value] of Object.entries(results)) {
        cache.set(videoID, readBranding(value));
      }

      return true;
    })
    .catch((err: unknown) => {
      console.warn('[dearrow] Failed to fetch branding for', prefix, err);
      // Dropped from the map, so a later response can retry the prefix.
      prefixRequests.delete(prefix);
      return false;
    });

  prefixRequests.set(prefix, request);

  return request;
}

/**
 * Marks videos as having no branding, so a hit and a miss are distinguishable
 * and a video the API doesn't know about isn't asked about again.
 *
 * Only ever called for prefixes that came back successfully: recording a miss
 * for a video whose request *failed* would cache the failure permanently and
 * defeat the retry above.
 */
function recordMisses(videoIDs: string[]) {
  for (const videoID of videoIDs) {
    if (!cache.has(videoID)) cache.set(videoID, null);
  }
}

// A tile's video ID appears as `contentId` and again in its watch endpoint;
// either way it is an 11-character YouTube ID.
const CONTENT_ID = /"contentId"\s*:\s*"([A-Za-z0-9_-]{11})"/g;

function videoIDsIn(body: string): string[] {
  const found = new Set<string>();

  let match: RegExpExecArray | null;
  CONTENT_ID.lastIndex = 0;

  while ((match = CONTENT_ID.exec(body)) !== null) {
    if (match[1]) found.add(match[1]);
    if (found.size >= MAX_IDS_PER_RESPONSE) break;
  }

  return Array.from(found);
}

/**
 * Holds a browse response until branding for the videos it mentions is cached.
 *
 * See the ordering note at the top of the file for why this waits rather than
 * backfilling afterwards.
 */
addResponseInterceptor('dearrow', async (res, url) => {
  if (!enabled()) return;

  // Our own request, and anything that plainly isn't a browse payload.
  if (!url.pathname.includes('/youtubei/')) return;

  let body: string;
  try {
    body = await res.clone().text();
  } catch (e) {
    console.warn('[dearrow] Could not read response body:', e);
    return;
  }

  const unknown = videoIDsIn(body).filter((id) => !cache.has(id));
  if (unknown.length === 0) return;

  const prefixOf = new Map(
    unknown.map((id) => [id, sha256(id).substring(0, 4)])
  );
  const prefixes = Array.from(new Set(prefixOf.values()));

  const fetches = Promise.all(
    prefixes.map((prefix) =>
      fetchPrefix(prefix).then((ok) => [prefix, ok] as const)
    )
  ).then((outcomes) => {
    const succeeded = new Set(
      outcomes.filter(([, ok]) => ok).map(([prefix]) => prefix)
    );

    recordMisses(unknown.filter((id) => succeeded.has(prefixOf.get(id)!)));
  });

  // Whichever comes first: the branding, or the budget running out.
  await Promise.race([
    fetches,
    new Promise<void>((resolve) => setTimeout(resolve, FETCH_BUDGET_MS))
  ]);
});

interface TileRenderer {
  contentId?: unknown;
  metadata?: { tileMetadataRenderer?: { title?: { simpleText?: string } } };
  header?: {
    tileHeaderRenderer?: {
      thumbnail?: {
        thumbnails?: { url: string; width: number; height: number }[];
      };
    };
  };
}

function applyToTile(tile: TileRenderer) {
  const videoID = tile.contentId;
  if (typeof videoID !== 'string') return;

  const branding = cache.get(videoID);
  if (!branding) return;

  const title = tile.metadata?.tileMetadataRenderer?.title;
  if (branding.title !== undefined && title) {
    title.simpleText = branding.title;
  }

  const thumbnail = tile.header?.tileHeaderRenderer?.thumbnail;
  if (
    branding.thumbnailTime !== undefined &&
    thumbnail &&
    configRead('enableDeArrowThumbnails')
  ) {
    // Not an `i.ytimg.com` URL, so `thumbnail-quality.ts` leaves it alone
    // rather than rewriting it back to a stock thumbnail.
    thumbnail.thumbnails = [
      {
        url: `${THUMBNAIL_API}?videoID=${encodeURIComponent(videoID)}&time=${branding.thumbnailTime}`,
        width: 1280,
        height: 720
      }
    ];
  }
}

/**
 * Walks a parsed response for tiles.
 *
 * TizenTube enumerates each container shape it knows about — section lists,
 * their continuations, horizontal list continuations, the per-tab secondary nav
 * sections, the watch-page pivot — and misses any it hasn't met. A tile is a
 * tile wherever it turns up, so we recurse and act on `tileRenderer` itself.
 */
function walk(value: unknown, depth: number) {
  // Tiles on the home screen sit about a dozen levels down; the limit is only
  // there to stop a pathological payload from running away with the frame.
  if (depth > 20 || typeof value !== 'object' || value === null) return;

  if (Array.isArray(value)) {
    for (const entry of value) walk(entry, depth + 1);
    return;
  }

  const record = value as Record<string, unknown>;

  const tile = record.tileRenderer;
  if (tile && typeof tile === 'object') {
    applyToTile(tile as TileRenderer);
    return;
  }

  for (const key in record) walk(record[key], depth + 1);
}

addJsonParseHandler('dearrow', (value) => {
  if (!enabled()) return;
  if (typeof value !== 'object' || value === null) return;

  walk(value, 0);
});
