// Adapted from https://github.com/reisxd/TizenTube/blob/3f28fc3d/mods/ui/customYTSettings.js

import { customActionCommand } from '../app_api/index';
import { SettingActionRenderer, SettingsCategory } from '../yt_ui/index';
import { SHOW_ACTION } from './render';
import { addJsonParseHandler } from '../hooks/json-parse';

/**
 * Adds an "Advanced Settings" entry to the top of YouTube's own settings
 * screen, so the panel is discoverable without knowing about the green button.
 *
 * The entry is injected into the settings screen's response as it is parsed.
 */

const CATEGORY_ID = 'ytaf_advanced_settings_category';

/** The `parent_code` icon is a plain gear — close enough, and already cached. */
const ICON_URL = 'https://www.gstatic.com/ytlr/img/parent_code.png';

interface SettingsResponse {
  title?: { runs?: unknown };
  items?: unknown[];
}

/**
 * Recognises YouTube's settings screen response.
 *
 * TizenTube tests `r?.title?.runs` alone, which matches a great many unrelated
 * renderer payloads and would then `unshift` our category into whatever
 * `items` array they happen to have. We additionally require the items to
 * actually look like settings categories.
 */
function isSettingsResponse(value: unknown): value is SettingsResponse {
  if (typeof value !== 'object' || value === null) return false;

  const response = value as SettingsResponse;

  if (typeof response.title !== 'object' || response.title === null) {
    return false;
  }
  if (!response.title.runs) return false;
  if (!Array.isArray(response.items)) return false;

  return response.items.some(
    (item) =>
      typeof item === 'object' &&
      item !== null &&
      'settingCategoryCollectionRenderer' in item
  );
}

function alreadyPatched(items: unknown[]): boolean {
  return items.some((item) => {
    const category = (item as Record<string, Record<string, unknown>>)
      ?.settingCategoryCollectionRenderer;

    return category?.categoryId === CATEGORY_ID;
  });
}

export function patchSettingsScreen(response: unknown) {
  if (!isSettingsResponse(response)) return;

  const items = response.items;
  if (!items || alreadyPatched(items)) return;

  const entry = SettingActionRenderer(
    'Advanced Settings',
    'ytaf_advanced_settings_open',
    customActionCommand(SHOW_ACTION, {}),
    {
      summary: 'Ad blocking, SponsorBlock, playback and interface options',
      thumbnail: ICON_URL
    }
  );

  items.unshift(SettingsCategory(CATEGORY_ID, [entry]));
  console.info('[advanced-settings] Added entry to YouTube settings screen');
}

addJsonParseHandler('advanced-settings-menu', patchSettingsScreen);
