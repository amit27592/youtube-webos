// Adapted from https://github.com/reisxd/TizenTube/blob/3f28fc3d/mods/ui/ytUI.js

import { dispatch } from './dispatch';
import {
  POPUP_BACK,
  simpleText,
  thumbnails,
  type Command,
  type Thumbnail
} from './types';

export interface PanelHeader {
  title: string;
  subtitle?: string;
  thumbnails?: readonly (string | Thumbnail)[];
}

/**
 * The header bar of an overlay panel. Pass a bare string for a title-only
 * header.
 */
export function OverlayPanelHeaderRenderer(header: PanelHeader | string) {
  const {
    title,
    subtitle,
    thumbnails: thumbs
  } = typeof header === 'string' ? { title: header } : header;

  const renderer: Record<string, unknown> = { title: simpleText(title) };

  if (subtitle) renderer.subtitle = simpleText(subtitle);

  if (thumbs?.length) {
    renderer.image = thumbnails(thumbs);
    renderer.style = 'OVERLAY_PANEL_HEADER_STYLE_VIDEO_THUMBNAIL';
  }

  return { overlayPanelHeaderRenderer: renderer };
}

export interface ModalOptions {
  /**
   * Identifies the popup. Required to later update it in place.
   */
  id?: string;
  /**
   * Replace the contents of the popup with this `id` rather than stacking a new
   * one on top. This is how a settings tree navigates between levels without
   * growing the back stack.
   */
  update?: boolean;
}

/** Builds the command that opens a modal overlay panel. */
export function Modal(
  header: PanelHeader | string,
  content: unknown,
  options: ModalOptions = {}
): Command {
  const openPopupAction: Record<string, unknown> = {
    popupType: 'MODAL',
    popup: {
      overlaySectionRenderer: {
        overlay: {
          overlayTwoPanelRenderer: {
            actionPanel: {
              overlayPanelRenderer: {
                header: OverlayPanelHeaderRenderer(header),
                content
              }
            },
            backButton: {
              buttonRenderer: {
                accessibilityData: {
                  accessibilityData: { label: 'Back' }
                },
                command: POPUP_BACK
              }
            }
          }
        },
        dismissalCommand: POPUP_BACK
      }
    }
  };

  if (options.id !== undefined) openPopupAction.uniqueId = options.id;

  if (options.update) {
    openPopupAction.shouldMatchUniqueId = true;
    openPopupAction.updateAction = true;
  }

  return { openPopupAction };
}

export function showModal(
  header: PanelHeader | string,
  content: unknown,
  options?: ModalOptions
) {
  return dispatch(Modal(header, content, options));
}

/** Closes the topmost popup. */
export function closePopup() {
  return dispatch(POPUP_BACK);
}

/** A vertical list of selectable items — the body of most modals. */
export function overlayPanelItemListRenderer(
  items: readonly unknown[],
  selectedIndex = 0
) {
  return {
    overlayPanelItemListRenderer: { items: [...items], selectedIndex }
  };
}

export function scrollPaneItemListRenderer(items: readonly unknown[]) {
  return { scrollPaneItemListRenderer: { items: [...items] } };
}

export function scrollPaneRenderer(items: readonly unknown[]) {
  return { scrollPaneRenderer: { content: scrollPaneItemListRenderer(items) } };
}

/** A single centred line of text — used for empty states. */
export function overlayMessageRenderer(text: string) {
  return { overlayMessageRenderer: { title: simpleText(text) } };
}
