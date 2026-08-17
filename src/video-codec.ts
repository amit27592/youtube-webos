// Adapted from https://github.com/reisxd/TizenTube/blob/3f28fc3d/mods/features/adblock.js

import { configRead } from './config';
import { addJsonParseHandler } from './hooks/json-parse';

/**
 * Restricts playback to a chosen video codec.
 *
 * The player picks a format from `streamingData.adaptiveFormats`; dropping the
 * formats we don't want from the response before it sees them is the whole
 * mechanism. Older LG panels decode AV1 in software, so a video that only
 * stutters because YouTube chose AV1 plays fine once VP9 or AVC is pinned.
 *
 * TizenTube does this inline in their adblock file. It has nothing to do with
 * ads, so here it is its own module on the shared `JSON.parse` hook.
 */

interface AdaptiveFormat {
  mimeType?: unknown;
}

function isVideoFormat(format: AdaptiveFormat): boolean {
  return (
    typeof format.mimeType === 'string' && !format.mimeType.startsWith('audio/')
  );
}

function matchesCodec(format: AdaptiveFormat, codec: string): boolean {
  return typeof format.mimeType === 'string' && format.mimeType.includes(codec);
}

addJsonParseHandler('video-codec', (value) => {
  if (typeof value !== 'object' || value === null) return;

  const codec = configRead('videoPreferredCodec');
  if (codec === 'any') return;

  const streamingData = (
    value as { streamingData?: { adaptiveFormats?: unknown } }
  ).streamingData;

  const formats = streamingData?.adaptiveFormats;
  if (!Array.isArray(formats)) return;

  const kept = (formats as AdaptiveFormat[]).filter(
    (format) => !isVideoFormat(format) || matchesCodec(format, codec)
  );

  // If nothing was served in the preferred codec, filtering would leave the
  // player with audio and no video at all. Better to play the video YouTube
  // offered than to break it.
  if (!kept.some(isVideoFormat)) {
    console.info('[video-codec] No', codec, 'formats offered; leaving as-is');
    return;
  }

  if (kept.length !== formats.length) {
    console.debug(
      '[video-codec] Kept',
      kept.length,
      'of',
      formats.length,
      'formats for',
      codec
    );
    streamingData!.adaptiveFormats = kept;
  }
});
