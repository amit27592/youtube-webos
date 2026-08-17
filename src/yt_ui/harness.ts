/**
 * On-device smoke test for the `yt_ui` toolkit.
 *
 * Nothing in the app calls this. Run it from the devtools console reached via
 * `pnpm run inspect`:
 *
 * ```js
 * __ytaf_yt_ui_demo__.toast();
 * __ytaf_yt_ui_demo__.modal();
 * ```
 *
 * The modal should be navigable with the remote's arrow keys and dismissible
 * with Back; picking either row should raise a toast naming it.
 */

import { registerCustomAction } from '../app_api/index';

import { showToast } from './toast';
import { buttonItem } from './renderers';
import { overlayPanelItemListRenderer, showModal } from './modal';
import { customActionCommand } from '../app_api/index';
import { POPUP_BACK } from './types';

const DEMO_ACTION = 'YTAF_YT_UI_DEMO_PICK';

declare global {
  interface Window {
    __ytaf_yt_ui_demo__?: {
      toast: () => void;
      modal: () => void;
    };
  }
}

void registerCustomAction(DEMO_ACTION, (parameters) => {
  void showToast('yt_ui demo', `You picked: ${String(parameters)}`);
});

window.__ytaf_yt_ui_demo__ = {
  toast: () => {
    void showToast('yt_ui demo', 'Toasts work.');
  },

  modal: () => {
    void showModal(
      { title: 'yt_ui demo', subtitle: 'Two items, Back to dismiss' },
      overlayPanelItemListRenderer([
        buttonItem(
          { title: 'First item', subtitle: 'Raises a toast' },
          { icon: 'CHECK_BOX' },
          [customActionCommand(DEMO_ACTION, 'First item'), POPUP_BACK]
        ),
        buttonItem({ title: 'Second item' }, { icon: 'SETTINGS' }, [
          customActionCommand(DEMO_ACTION, 'Second item'),
          POPUP_BACK
        ])
      ]),
      { id: 'ytaf-yt-ui-demo' }
    );
  }
};
