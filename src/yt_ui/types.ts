// Adapted from https://github.com/reisxd/TizenTube/blob/3f28fc3d/mods/ui/ytUI.js

import type { ResolveCommandPayload } from '../app_api/index';

/**
 * Shared shapes for YouTube's renderer payloads.
 *
 * These are typed only as far as we construct them. YouTube's real schema is
 * far larger and undocumented, so anything we pass through untouched stays
 * loosely typed rather than being guessed at.
 */

/** A command accepted by `resolveCommand`. */
export type Command = ResolveCommandPayload;

export interface Thumbnail {
  url: string;
  width?: number;
  height?: number;
}

export interface ThumbnailSet {
  thumbnails: Thumbnail[];
}

/** YouTube's two interchangeable text shapes. */
export interface SimpleText {
  simpleText: string;
}

export interface TextRuns {
  runs: { text: string }[];
}

export function simpleText(text: string): SimpleText {
  return { simpleText: text };
}

export function textRuns(text: string): TextRuns {
  return { runs: [{ text }] };
}

export function thumbnails(
  urls: readonly (string | Thumbnail)[]
): ThumbnailSet {
  return {
    thumbnails: urls.map((t) => (typeof t === 'string' ? { url: t } : t))
  };
}

/**
 * Wraps commands so a renderer slot that accepts a single service endpoint can
 * run several of them.
 */
export function commandExecutor(commands: readonly Command[]): Command {
  return { commandExecutorCommand: { commands: [...commands] } };
}

/** Dismisses the topmost popup. */
export const POPUP_BACK: Command = {
  signalAction: { signal: 'POPUP_BACK' }
};
