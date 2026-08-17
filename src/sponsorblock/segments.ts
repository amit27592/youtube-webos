// Adapted from https://github.com/reisxd/TizenTube/blob/3f28fc3d/mods/features/sponsorblock.js

import sha256 from 'tiny-sha256';
import { configRead } from '../config';

/**
 * Segment fetching and the category table, kept apart from the player-side
 * logic so the `JSON.parse` hook that injects the manual-skip prompts can read
 * segments without pulling in the DOM overlay.
 */

export interface Segment {
  category: string;
  /** `[start, end]`, in seconds. */
  segment: [number, number];
  UUID: string;
}

export interface BarType {
  color: string;
  opacity: string;
  /** How the category is named in toasts and prompts. */
  name: string;
}

// Colours from https://github.com/ajayyy/SponsorBlock/blob/da1a535d/src/config.ts#L113-L134
export const barTypes: Record<string, BarType> = {
  sponsor: { color: '#00d400', opacity: '0.7', name: 'sponsored segment' },
  intro: { color: '#00ffff', opacity: '0.7', name: 'intro' },
  outro: { color: '#0202ed', opacity: '0.7', name: 'outro' },
  interaction: {
    color: '#cc00ff',
    opacity: '0.7',
    name: 'interaction reminder'
  },
  selfpromo: { color: '#ffff00', opacity: '0.7', name: 'self-promotion' },
  preview: { color: '#008fd6', opacity: '0.7', name: 'recap or preview' },
  filler: { color: '#7300ff', opacity: '0.9', name: 'tangents' },
  music_offtopic: { color: '#ff9900', opacity: '0.7', name: 'non-music part' },
  poi_highlight: { color: '#9b044c', opacity: '0.7', name: 'highlight' }
};

export function segmentName(category: string): string {
  return barTypes[category]?.name ?? category;
}

/**
 * A privacy-preserving mirror of the SponsorBlock API. Together with the
 * 4-character video hash below, this means neither the mirror nor the upstream
 * API learns which video is being watched.
 */
const SPONSORBLOCK_API = 'https://sponsorblock.inf.re/api';

const ALL_CATEGORIES = [
  'sponsor',
  'intro',
  'outro',
  'interaction',
  'selfpromo',
  'preview',
  'filler',
  'music_offtopic',
  'poi_highlight'
] as const;

/**
 * Categories set to skip. `poi_highlight` is deliberately absent: it marks a
 * point of interest to jump *to*, not a stretch to skip over, and is gated by
 * `enableSponsorBlockHighlight` where it is used.
 */
export function skippableCategories(): string[] {
  const enabled: [string, boolean][] = [
    ['sponsor', configRead('enableSponsorBlockSponsor')],
    ['intro', configRead('enableSponsorBlockIntro')],
    ['outro', configRead('enableSponsorBlockOutro')],
    ['interaction', configRead('enableSponsorBlockInteraction')],
    ['selfpromo', configRead('enableSponsorBlockSelfPromo')],
    ['preview', configRead('enableSponsorBlockPreview')],
    ['filler', configRead('enableSponsorBlockFiller')],
    ['music_offtopic', configRead('enableSponsorBlockMusicOfftopic')]
  ];

  return enabled.filter(([, on]) => on).map(([category]) => category);
}

/**
 * Segments by video ID, for the current session.
 *
 * The `JSON.parse` hook that injects manual-skip prompts runs while a response
 * is being parsed and cannot wait for a fetch, so it reads whatever this cache
 * holds. See `./prompts.ts` for what that means in practice.
 */
const cache = new Map<string, Segment[]>();

const inFlight = new Map<string, Promise<Segment[]>>();

export function cachedSegments(videoID: string): Segment[] | undefined {
  return cache.get(videoID);
}

function isSegment(value: unknown): value is Segment {
  const seg = value as Segment | null;

  return (
    typeof seg === 'object' &&
    seg !== null &&
    typeof seg.category === 'string' &&
    Array.isArray(seg.segment) &&
    seg.segment.length === 2 &&
    seg.segment.every((n) => typeof n === 'number')
  );
}

/**
 * Fetches the segments for a video, deduplicating concurrent calls so the
 * prefetch and the player both share one request.
 */
export function fetchSegments(videoID: string): Promise<Segment[]> {
  const cached = cache.get(videoID);
  if (cached) return Promise.resolve(cached);

  const pending = inFlight.get(videoID);
  if (pending) return pending;

  // Only the first 4 characters of the hash are sent; the API replies with
  // every video sharing that prefix and we pick ours out locally.
  const videoHash = sha256(videoID).substring(0, 4);
  const categories = encodeURIComponent(JSON.stringify(ALL_CATEGORIES));

  const request = fetch(
    `${SPONSORBLOCK_API}/skipSegments/${videoHash}?categories=${categories}`
  )
    .then((resp) => resp.json() as Promise<unknown>)
    .then((results) => {
      const match = Array.isArray(results)
        ? (results as { videoID?: string; segments?: unknown }[]).find(
            (v) => v.videoID === videoID
          )
        : undefined;

      const segments = Array.isArray(match?.segments)
        ? match.segments.filter(isSegment)
        : [];

      cache.set(videoID, segments);
      console.info(
        '[sponsorblock]',
        videoID,
        'got',
        segments.length,
        'segments'
      );

      return segments;
    })
    .catch((err) => {
      console.warn('[sponsorblock] Failed to fetch segments:', err);
      // Not cached, so a later attempt for the same video can still succeed.
      return [];
    })
    .finally(() => inFlight.delete(videoID));

  inFlight.set(videoID, request);

  return request;
}
