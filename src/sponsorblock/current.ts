import type { SponsorBlockHandler } from './handler';

/**
 * The handler for the video currently playing, if any.
 *
 * Kept in its own module so `./prompts.ts` can reach it without importing
 * `./index.ts`, which imports `./prompts.ts` in turn.
 */

let handler: SponsorBlockHandler | null = null;

export function currentHandler(): SponsorBlockHandler | null {
  return handler;
}

export function setCurrentHandler(next: SponsorBlockHandler | null) {
  handler = next;
}
