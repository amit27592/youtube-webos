// Adapted from https://github.com/reisxd/TizenTube/blob/3f28fc3d/mods/ui/ytUI.js

import { dispatch } from './dispatch';
import { simpleText, thumbnails, type Command, type Thumbnail } from './types';

export interface ToastOptions {
  thumbnails?: readonly (string | Thumbnail)[];
}

export function Toast(
  title: string,
  subtitle = '',
  options: ToastOptions = {}
): Command {
  const overlayToastRenderer: Record<string, unknown> = {
    title: simpleText(title),
    subtitle: simpleText(subtitle)
  };

  // The original assigned into `.image.thumbnails` without creating `image`
  // first, which throws whenever thumbnails are actually passed.
  if (options.thumbnails?.length) {
    overlayToastRenderer.image = thumbnails(options.thumbnails);
  }

  return {
    openPopupAction: {
      popupType: 'TOAST',
      popup: { overlayToastRenderer }
    }
  };
}

/** Shows one of YouTube's native toasts in the corner of the screen. */
export function showToast(
  title: string,
  subtitle?: string,
  options?: ToastOptions
) {
  return dispatch(Toast(title, subtitle, options));
}
