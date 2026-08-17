// Additional renderer coverage adapted from
// https://github.com/reisxd/TizenTube/blob/3f28fc3d/mods/features/adblock.js

import { configRead } from './config';
import { addJsonParseHandler } from './hooks/json-parse';

/**
 * This is a minimal reimplementation of the following uBlock Origin rule:
 * https://github.com/uBlockOrigin/uAssets/blob/master/filters/filters.txt
 *
 * NOTE ON `delete` vs assigning empty values: TizenTube assigns
 * (`adPlacements = []`, `playerAds = false`, `adSlots = []`) where we delete.
 * Both defeat the truthiness checks YouTube TV actually performs. `delete`
 * additionally defeats `'adPlacements' in response` and `Object.keys` checks;
 * assignment is the safer option only if YouTube ever dereferences the field
 * unguarded. We have no evidence it does, and `delete` is what has been
 * shipping, so we keep it.
 *
 * The parse result is freshly constructed by `JSON.parse`, so mutating it here
 * cannot hit the frozen-object problem that `22e227e` fixed for the
 * `JSON.stringify` hook — no cloning is needed or wanted on this path.
 */

type Renderer = Record<string, unknown>;

function asRecord(value: unknown): Renderer | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Renderer)
    : null;
}

/** Walks a chain of object keys, bailing out on anything that isn't an object. */
function path(root: unknown, ...keys: string[]): unknown {
  let current: unknown = root;

  for (const key of keys) {
    const record = asRecord(current);
    if (!record) return undefined;
    current = record[key];
  }

  return current;
}

function hasRenderer(item: unknown, name: string): boolean {
  return !!asRecord(item)?.[name];
}

/**
 * Strips ad and nag entries from one `sectionListRenderer`-shaped container
 * (anything with a `contents` array of shelf-level renderers).
 *
 * `adSlotRenderer` shows up at two depths:
 * - `contents[*].adSlotRenderer`
 * - `contents[*].shelfRenderer.content.horizontalListRenderer.items[*].adSlotRenderer`
 */
function cleanSectionContents(container: unknown): void {
  const record = asRecord(container);
  if (!record || !Array.isArray(record.contents)) return;

  let contents = record.contents as unknown[];

  if (configRead('enableAdBlock')) {
    // The full-width ad card at the top of the home screen.
    contents = contents.filter(
      (elm) => !hasRenderer(elm, 'tvMastheadRenderer')
    );
    contents = contents.filter((elm) => !hasRenderer(elm, 'adSlotRenderer'));
  }

  if (!configRead('enableSigninReminder')) {
    // "Sign in to see your subscriptions" nags. `feedNudgeRenderer` appears on
    // browse surfaces, `alertWithActionsRenderer` on the watch page.
    contents = contents.filter(
      (elm) =>
        !hasRenderer(elm, 'feedNudgeRenderer') &&
        !hasRenderer(elm, 'alertWithActionsRenderer')
    );
  }

  record.contents = contents;

  if (!configRead('enableAdBlock')) return;

  for (const entry of contents) {
    const horizontalListRenderer = asRecord(
      path(entry, 'shelfRenderer', 'content', 'horizontalListRenderer')
    );

    // Not every shelf is a horizontal list, hence the guard — the original
    // implementation dereferenced this unconditionally.
    if (horizontalListRenderer) removeAdSlotItems(horizontalListRenderer);
  }
}

/** Strips `adSlotRenderer` tiles from a container with an `items` array. */
function removeAdSlotItems(container: unknown): void {
  const record = asRecord(container);
  if (!record || !Array.isArray(record.items)) return;

  record.items = (record.items as unknown[]).filter(
    (item) => !hasRenderer(item, 'adSlotRenderer')
  );
}

/**
 * Every response path that carries a shelf list. The last four are coverage we
 * previously lacked: continuations (infinite scroll), the per-tab content of
 * the secondary nav (Subscriptions, Explore, …), and the watch page's related
 * videos — all of which serve `adSlotRenderer` tiles.
 */
function cleanAllSections(r: unknown): void {
  cleanSectionContents(
    path(
      r,
      'contents',
      'tvBrowseRenderer',
      'content',
      'tvSurfaceContentRenderer',
      'content',
      'sectionListRenderer'
    )
  );

  cleanSectionContents(path(r, 'contents', 'sectionListRenderer'));

  cleanSectionContents(
    path(r, 'continuationContents', 'sectionListContinuation')
  );

  cleanSectionContents(
    path(
      r,
      'contents',
      'singleColumnWatchNextResults',
      'pivot',
      'sectionListRenderer'
    )
  );

  if (configRead('enableAdBlock')) {
    removeAdSlotItems(
      path(r, 'continuationContents', 'horizontalListContinuation')
    );
  }

  const sections = path(
    r,
    'contents',
    'tvBrowseRenderer',
    'content',
    'tvSecondaryNavRenderer',
    'sections'
  );

  if (!Array.isArray(sections)) return;

  for (const section of sections) {
    const tabs = path(section, 'tvSecondaryNavSectionRenderer', 'tabs');
    if (!Array.isArray(tabs)) continue;

    for (const tab of tabs) {
      cleanSectionContents(
        path(
          tab,
          'tabRenderer',
          'content',
          'tvSurfaceContentRenderer',
          'content',
          'sectionListRenderer'
        )
      );
    }
  }
}

function processResponse(r: unknown): void {
  const response = asRecord(r);
  if (!response) return;

  if (configRead('enableAdBlock')) {
    if (response.adPlacements) {
      delete response.adPlacements;
      console.info('[adblock] Removed adPlacements');
    }

    if (Array.isArray(response.adSlots)) {
      delete response.adSlots;
      console.info('[adblock] Removed adSlots');
    }

    if (response.playerAds) {
      delete response.playerAds;
      console.info('[adblock] Removed playerAds');
    }

    // Shorts ads.
    if (Array.isArray(response.entries)) {
      response.entries = (response.entries as unknown[]).filter(
        (elm) =>
          !path(elm, 'command', 'reelWatchEndpoint', 'adClientParams', 'isAd')
      );
    }
  }

  // The "Includes paid promotion" banner. Not an ad served by YouTube, so it is
  // gated on its own key rather than on `enableAdBlock`.
  if (
    response.paidContentOverlay &&
    !configRead('enablePaidPromotionOverlay')
  ) {
    response.paidContentOverlay = null;
    console.info('[adblock] Removed paidContentOverlay');
  }

  cleanAllSections(response);
}

addJsonParseHandler('adblock', processResponse);
