// Adapted from https://github.com/reisxd/TizenTube/blob/3f28fc3d/mods/features/sponsorblock.js

import { configRead } from '../config';
import { showToast } from '../yt_ui/index';
import { SegmentOverlay } from './overlay';
import {
  fetchSegments,
  segmentName,
  skippableCategories,
  type Segment
} from './segments';

/**
 * Skipping for one video.
 *
 * Skips are scheduled off `timeupdate` rather than run from a ticking timer:
 * one timeout is armed for the next segment, and rescheduled whenever playback
 * position changes underneath it.
 */

/**
 * How long after a skip a return to the same segment counts as YouTube fighting
 * us rather than the user seeking back deliberately.
 */
const SKIP_LOOP_WINDOW_MS = 1000;

/** Look-back so a `timeupdate` firing just past a boundary still skips. */
const LOOKBACK_SECONDS = 0.3;

interface SkipRecord {
  count: number;
  firstSkipped: number;
  lastSkipped: number;
  hasShownToast: boolean;
}

export class SponsorBlockHandler {
  readonly videoID: string;

  #video: HTMLVideoElement;
  #segments: Segment[] = [];
  #overlay: SegmentOverlay | null = null;
  #skippable: string[] = [];
  #manual: string[] = [];
  #skipped = new Map<string, SkipRecord>();
  #nextSkipTimeout: ReturnType<typeof setTimeout> | null = null;
  #active = true;

  constructor(videoID: string, video: HTMLVideoElement) {
    this.videoID = videoID;
    this.#video = video;
  }

  get segments(): readonly Segment[] {
    return this.#segments;
  }

  async init() {
    const segments = await fetchSegments(this.videoID);
    if (!this.#active) return;

    if (segments.length === 0) {
      console.info('[sponsorblock]', this.videoID, 'no segments');
      return;
    }

    this.#segments = segments;
    this.#skippable = skippableCategories();
    this.#manual = configRead('sponsorBlockManualSkips');

    this.#video.addEventListener('play', this.#onTimeUpdate);
    this.#video.addEventListener('pause', this.#onTimeUpdate);
    this.#video.addEventListener('timeupdate', this.#onTimeUpdate);
    this.#video.addEventListener('durationchange', this.#onDurationChange);

    this.#buildOverlay();
    this.#scheduleSkip();
  }

  #buildOverlay() {
    if (this.#overlay || !(this.#video.duration > 0)) return;

    this.#overlay = new SegmentOverlay(this.#segments, this.#video.duration);
    this.#overlay.build();
  }

  #onDurationChange = () => this.#buildOverlay();

  #onTimeUpdate = () => {
    this.#overlay?.reposition();
    this.#scheduleSkip();
  };

  /** Seeks past a segment, keeping clear of the very end of the video. */
  #seekPast(end: number) {
    const duration = this.#video.duration;

    // Landing exactly on the end triggers the endscreen and autoplay, so stop
    // just short of it.
    this.#video.currentTime = duration - end < 1 ? end - 1 : end;
  }

  /** Performs a skip requested from a manual-skip prompt. */
  skipTo(time: number) {
    if (!Number.isFinite(time)) return;
    this.#seekPast(time);
  }

  #scheduleSkip() {
    if (this.#nextSkipTimeout !== null) {
      clearTimeout(this.#nextSkipTimeout);
      this.#nextSkipTimeout = null;
    }

    if (!this.#active || this.#video.paused) return;

    const now = this.#video.currentTime;

    // A `timeupdate` can land just after a boundary that a previously scheduled
    // skip was aimed at, so look slightly backwards; a segment already under
    // way then skips immediately (at a negative delay).
    const upcoming = this.#segments
      .filter(
        (seg) =>
          seg.segment[0] > now - LOOKBACK_SECONDS &&
          seg.segment[1] > now - LOOKBACK_SECONDS
      )
      .sort((a, b) => a.segment[0] - b.segment[0]);

    const segment = upcoming[0];
    if (!segment) return;

    const [start] = segment.segment;

    this.#nextSkipTimeout = setTimeout(
      () => this.#runSkip(segment),
      (start - now) * 1000
    );
  }

  #runSkip(segment: Segment) {
    if (!this.#active || this.#video.paused) return;

    if (!this.#skippable.includes(segment.category)) return;

    // Manual categories are surfaced as an on-screen prompt instead; see
    // `./prompts.ts`.
    if (this.#manual.includes(segment.category)) return;

    const name = segmentName(segment.category);
    const previous = this.#skipped.get(segment.UUID);

    if (previous) {
      previous.count++;
      previous.lastSkipped = Date.now();

      // Landing back in a segment we just skipped means something is putting
      // playback back — YouTube restoring a saved position, most often. Skipping
      // again would loop, so stand down and say so once.
      if (previous.lastSkipped - previous.firstSkipped < SKIP_LOOP_WINDOW_MS) {
        if (!previous.hasShownToast && configRead('enableSponsorBlockToasts')) {
          void showToast(
            'SponsorBlock',
            `Not skipping ${name} (skipped ${previous.count} times)`
          );
          previous.hasShownToast = true;
        }
        return;
      }
    } else {
      this.#skipped.set(segment.UUID, {
        count: 1,
        firstSkipped: Date.now(),
        lastSkipped: Date.now(),
        hasShownToast: false
      });
    }

    console.info('[sponsorblock]', this.videoID, 'skipping', segment);

    if (configRead('enableSponsorBlockToasts')) {
      void showToast('SponsorBlock', `Skipping ${name}`);
    }

    this.#seekPast(segment.segment[1]);
    this.#scheduleSkip();
  }

  destroy() {
    console.info('[sponsorblock]', this.videoID, 'destroying');

    this.#active = false;

    if (this.#nextSkipTimeout !== null) {
      clearTimeout(this.#nextSkipTimeout);
      this.#nextSkipTimeout = null;
    }

    this.#overlay?.destroy();
    this.#overlay = null;

    this.#video.removeEventListener('play', this.#onTimeUpdate);
    this.#video.removeEventListener('pause', this.#onTimeUpdate);
    this.#video.removeEventListener('timeupdate', this.#onTimeUpdate);
    this.#video.removeEventListener('durationchange', this.#onDurationChange);

    this.#skipped.clear();
  }
}
