// Adapted from https://github.com/reisxd/TizenTube/blob/3f28fc3d/mods/ui/ytUI.js

import {
  commandExecutor,
  simpleText,
  textRuns,
  thumbnails,
  type Command,
  type Thumbnail
} from './types';

/**
 * Writes a client setting. Our own settings ride this command too — see
 * `src/app_api/client-settings.ts`, which routes settings named after one of
 * our config keys into the config store.
 *
 * `arrayValue` toggles membership rather than replacing the list, matching how
 * YouTube's own multi-select renderers report a change.
 */
export function setClientSetting(
  item: string,
  value:
    | { boolValue: boolean }
    | { stringValue: string }
    | { intValue: string }
    | { arrayValue: string }
): Command {
  return {
    setClientSettingEndpoint: {
      settingDatas: [{ clientSettingEnum: { item }, ...value }]
    }
  };
}

export interface ItemLabel {
  title: string;
  subtitle?: string;
}

export interface ItemIcons {
  /** A YouTube `iconType`, e.g. `SETTINGS`, `SKIP_NEXT`, `CHECK_BOX`. */
  icon?: string;
  secondaryIcon?: string;
}

/**
 * A row in an {@link overlayPanelItemListRenderer}. Running several commands
 * from one row (e.g. "apply the setting, then close the panel") is the common
 * case, so commands are always wrapped in a `commandExecutorCommand`.
 */
export function buttonItem(
  label: ItemLabel | string,
  icons: ItemIcons = {},
  commands: readonly Command[] = []
) {
  const { title, subtitle } =
    typeof label === 'string' ? { title: label } : label;

  const compactLinkRenderer: Record<string, unknown> = {
    title: simpleText(title),
    serviceEndpoint: commandExecutor(commands)
  };

  if (subtitle) compactLinkRenderer.subtitle = simpleText(subtitle);
  if (icons.icon) compactLinkRenderer.icon = { iconType: icons.icon };
  if (icons.secondaryIcon) {
    compactLinkRenderer.secondaryIcon = { iconType: icons.secondaryIcon };
  }

  return { compactLinkRenderer };
}

/**
 * A button that appears over the player between two timestamps — YouTube uses
 * these for "Skip intro". Times are milliseconds from the start of the video.
 */
export function timelyAction(
  text: string,
  icon: string,
  command: Command,
  triggerTimeMs: number,
  timeoutMs: number
) {
  return {
    timelyActionRenderer: {
      actionButtons: [
        {
          buttonRenderer: {
            isDisabled: false,
            text: textRuns(text),
            icon: { iconType: icon },
            trackingParams: null,
            command
          }
        }
      ],
      triggerTimeMs,
      timeoutMs,
      type: ''
    }
  };
}

/** An entry in a long-press / overflow menu that runs a service endpoint. */
export function MenuServiceItemRenderer(
  text: string,
  serviceEndpoint: Command
) {
  return {
    menuServiceItemRenderer: {
      text: textRuns(text),
      serviceEndpoint,
      trackingParams: null
    }
  };
}

/** An entry in a long-press / overflow menu that navigates somewhere. */
export function MenuNavigationItemRenderer(
  text: string,
  navigationEndpoint: Command
) {
  return {
    menuNavigationItemRenderer: {
      text: textRuns(text),
      navigationEndpoint,
      trackingParams: null
    }
  };
}

export interface LongPressTarget {
  videoId: string;
  title: string;
  subtitle?: string;
  thumbnails: readonly (string | Thumbnail)[];
}

/**
 * The menu shown when a tile is long-pressed.
 *
 * Unlike the original, the menu entries are supplied by the caller rather than
 * hardcoded — the useful set differs per feature. See
 * {@link playMenuItem} and friends for the standard ones.
 */
export function longPressData(
  target: LongPressTarget,
  items: readonly unknown[]
) {
  return {
    clickTrackingParams: null,
    showMenuCommand: {
      contentId: target.videoId,
      thumbnail: thumbnails(target.thumbnails),
      title: simpleText(target.title),
      subtitle: simpleText(target.subtitle ?? ''),
      menu: {
        menuRenderer: {
          items: [...items],
          trackingParams: null,
          accessibility: {
            accessibilityData: { label: 'Video options' }
          }
        }
      }
    }
  };
}

export function playMenuItem(watchEndpoint: unknown) {
  return MenuNavigationItemRenderer('Play', {
    clickTrackingParams: null,
    watchEndpoint
  });
}

export function watchLaterMenuItem(videoId: string) {
  return MenuServiceItemRenderer('Save to Watch Later', {
    clickTrackingParams: null,
    playlistEditEndpoint: {
      playlistId: 'WL',
      actions: [{ addedVideoId: videoId, action: 'ACTION_ADD_VIDEO' }]
    }
  });
}

export function savePlaylistMenuItem(videoId: string) {
  return MenuNavigationItemRenderer('Save to Playlist', {
    clickTrackingParams: null,
    addToPlaylistEndpoint: { videoId }
  });
}

/** A group of rows in YouTube's own settings screen. */
export function SettingsCategory(
  categoryId: string,
  items: readonly unknown[],
  title?: string
) {
  const settingCategoryCollectionRenderer: Record<string, unknown> = {
    items: [...items],
    categoryId,
    focused: false,
    trackingParams: 'null'
  };

  if (title) settingCategoryCollectionRenderer.title = textRuns(title);

  return { settingCategoryCollectionRenderer };
}

export interface SettingActionOptions {
  summary?: string;
  thumbnail?: string;
}

/** A single row in YouTube's own settings screen. */
export function SettingActionRenderer(
  title: string,
  itemId: string,
  serviceEndpoint: Command,
  options: SettingActionOptions = {}
) {
  const settingActionRenderer: Record<string, unknown> = {
    title: textRuns(title),
    serviceEndpoint,
    trackingParams: 'null',
    actionLabel: textRuns(title),
    itemId
  };

  if (options.summary) {
    settingActionRenderer.summary = textRuns(options.summary);
  }

  if (options.thumbnail) {
    settingActionRenderer.thumbnail = thumbnails([options.thumbnail]);
  }

  return { settingActionRenderer };
}

/** A horizontal row of tiles, as used on the home and watch screens. */
export function ShelfRenderer(
  title: string,
  items: readonly unknown[],
  selectedIndex = 0
) {
  return {
    shelfRenderer: {
      shelfHeaderRenderer: { title: simpleText(title) },
      tvhtml5ShelfRendererType: 'TVHTML5_SHELF_RENDERER_TYPE_GRID',
      content: {
        horizontalListRenderer: {
          items: [...items],
          selectedIndex,
          visibleItemCount: 3
        }
      }
    }
  };
}

/**
 * A single card within a {@link ShelfRenderer}.
 *
 * The original takes no thumbnail, which leaves a card that is all text. Any
 * tile built from a real video has one to hand, so it is accepted here.
 */
export function TileRenderer(
  title: string,
  onSelectCommand: Command,
  thumbs?: readonly (string | Thumbnail)[]
) {
  const tileRenderer: Record<string, unknown> = {
    contentType: 'TILE_CONTENT_TYPE_VIDEO',
    metadata: {
      tileMetadataRenderer: { title: simpleText(title) }
    },
    onSelectCommand,
    style: 'TILE_STYLE_YTLR_DEFAULT'
  };

  if (thumbs && thumbs.length > 0) {
    tileRenderer.header = {
      tileHeaderRenderer: { thumbnail: thumbnails(thumbs) }
    };
  }

  return { tileRenderer };
}

/**
 * The inner payload of a `buttonRenderer` — note this is *not* wrapped in
 * `{ buttonRenderer: ... }`, matching how YouTube's player-control slots expect
 * it.
 */
export function ButtonRenderer(
  text: string,
  iconType: string,
  command: Command,
  isDisabled = false
) {
  return {
    isDisabled,
    text: textRuns(text),
    icon: { iconType },
    command,
    trackingParams: null
  };
}
