// Adapted from https://github.com/reisxd/TizenTube/blob/3f28fc3d/mods/features/preferredVideoQuality.js

import { configAddChangeListener, configRead } from './config';
import { getPlayerManager, PlayerMode } from './player_api';
import type { EventMapOf, PlayerManager } from './player_api';
import { showNotification } from './ui';

/**
 * Pins playback to a preferred resolution.
 *
 * Replaces the old `forceHighResVideo` boolean, which could only ask for the
 * maximum. TizenTube polls for `.html5-video-player`, attaches its own
 * `onStateChange` listener and tracks `#hasAppliedQuality` to avoid re-applying
 * within a video; the player manager gives us `newVideo` and `playbackStart`
 * directly, so all of that bookkeeping goes away.
 *
 * One behavioural divergence: when the preferred resolution is not on offer,
 * TizenTube falls back to `highres` — so asking for 1080p on a 4K video gets
 * you 4K, the opposite of what you asked for. We fall back to the best quality
 * *below* the target instead, and only use the lowest available if even that
 * doesn't exist.
 */

const playerManager = await getPlayerManager();

type EventMap = EventMapOf<PlayerManager>;
type QualityData = ReturnType<
  PlayerManager['player']['getAvailableQualityData']
>;

/** The numeric height in a quality label: `2160p60` and `2160p` are both 2160. */
function heightOf(label: string): number {
  return parseInt(label, 10) || 0;
}

function preferredHeight(): number {
  const preference = configRead('preferredVideoQuality');
  return preference === 'auto' ? 0 : heightOf(preference);
}

function getMaxQualityLabel(player: PlayerManager['player']) {
  return player.getAvailableQualityData()[0]?.qualityLabel;
}

/**
 * The quality id to request for a target height.
 *
 * `getAvailableQualityData()` is ordered best-first, so the first entry at or
 * below the target is the closest match that doesn't exceed it.
 */
function resolveQuality(
  available: QualityData,
  target: number
): string | undefined {
  const match =
    available.find((q) => heightOf(q.qualityLabel) <= target) ??
    available[available.length - 1];

  return match?.quality;
}

function notifyPlaybackQuality(this: PlayerManager) {
  const player = this.player;

  const selected = player.getPlaybackQualityLabel();
  const max = getMaxQualityLabel(player);

  showNotification(`${selected} selected (Max ${max})`, 3000);

  this.removeEventListener('playbackStart', notifyPlaybackQuality);
}

/** Applies the preference to the video that is already playing. */
function applyQuality(manager: PlayerManager) {
  const target = preferredHeight();
  if (target === 0) return;

  const player = manager.player;
  const available = player.getAvailableQualityData();

  if (available.length === 0) {
    console.warn(
      '[video-quality] No quality data yet; leaving it to the player'
    );
    return;
  }

  const quality = resolveQuality(available, target);
  if (!quality) return;

  const prevQuality = player.getPlaybackQualityLabel();
  console.debug('[video-quality] setting playback quality to', quality);
  player.setPlaybackQualityRange(quality, quality);

  if (prevQuality === player.getPlaybackQualityLabel()) {
    notifyPlaybackQuality.call(manager);
    return;
  }

  let timeoutToken: number | undefined;

  // No reliable event for quality change, so poll for it
  const intervalToken = window.setInterval(() => {
    const currQuality = player.getPlaybackQualityLabel();
    if (currQuality !== prevQuality) {
      notifyPlaybackQuality.call(manager);
      clearInterval(intervalToken);
      clearTimeout(timeoutToken);
    }
  }, 100);

  timeoutToken = window.setTimeout(() => {
    console.warn('[video-quality] timed out waiting for quality change');
    clearInterval(intervalToken);
    notifyPlaybackQuality.call(manager);
  }, 3000);
}

function setPlaybackQuality(this: PlayerManager, _: unknown) {
  if (this.playerMode === PlayerMode.PREVIEW) return;

  this.removeEventListener('playbackStart', setPlaybackQuality);
  applyQuality(this);
}

function handleNewVideo(this: PlayerManager, _: EventMap['newVideo']) {
  if (preferredHeight() === 0) return;

  this.removeEventListener('playbackStart', setPlaybackQuality);
  this.addEventListener('playbackStart', setPlaybackQuality);
}

playerManager.addEventListener('newVideo', handleNewVideo);

// Changing the preference from the settings panel mid-video should take effect
// on that video, not only on the next one.
configAddChangeListener('preferredVideoQuality', () => {
  if (playerManager.playerMode === PlayerMode.PREVIEW) return;
  applyQuality(playerManager);
});
