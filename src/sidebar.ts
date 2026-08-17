// Adapted from https://github.com/reisxd/TizenTube/blob/3f28fc3d/mods/ui/customGuideAction.js

import { configRead } from './config';
import { addJsonParseHandler } from './hooks/json-parse';

/**
 * Removes entries from the sidebar (the "guide").
 *
 * Entries are matched by their `iconType`, which is what identifies them in a
 * guide response — the labels are localised, the icons aren't.
 *
 * TizenTube reloads the guide when the setting changes, through an internal
 * command executor resolved out of the minified bundle. That lookup is exactly
 * the sort of thing this port avoids; the sidebar is rebuilt from a fresh
 * response often enough that a change shows up on its own, and at worst on the
 * next launch.
 */

interface GuideEntry {
  guideEntryRenderer?: {
    icon?: { iconType?: string };
    thumbnail?: unknown;
  };
}

interface GuideSection {
  guideSectionRenderer?: { items?: GuideEntry[] };
}

function isGuideResponse(value: unknown): value is { items: GuideSection[] } {
  const record = value as { items?: unknown };

  return (
    Array.isArray(record.items) &&
    record.items.length > 0 &&
    record.items.some(
      (item) => (item as GuideSection)?.guideSectionRenderer !== undefined
    )
  );
}

addJsonParseHandler('sidebar', (value) => {
  if (typeof value !== 'object' || value === null) return;

  const disabled: readonly string[] = configRead('disabledSidebarContents');
  const hideChannels = configRead('disableChannelsOnSidebar');

  if (disabled.length === 0 && !hideChannels) return;
  if (!isGuideResponse(value)) return;

  for (const section of value.items) {
    const items = section.guideSectionRenderer?.items;
    if (!Array.isArray(items)) continue;

    // A single pass building a new array, rather than TizenTube's splice with
    // a hand-decremented index inside the loop.
    section.guideSectionRenderer!.items = items.filter((item) => {
      const entry = item.guideEntryRenderer;
      if (!entry) return true;

      // Subscribed channels are the entries with a thumbnail rather than an
      // icon; they have no stable id to list individually.
      if (hideChannels && entry.thumbnail) return false;

      const icon = entry.icon?.iconType;

      return !(icon !== undefined && disabled.includes(icon));
    });
  }
});
