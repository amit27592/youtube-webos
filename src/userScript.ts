import 'whatwg-fetch';
import './domrect-polyfill';

import { handleLaunch } from './utils';

document.addEventListener(
  'webOSRelaunch',
  (evt) => {
    console.info('RELAUNCH:', evt, window.launchParams);
    handleLaunch(evt.detail);
  },
  true
);

import './app_api/index';
// Must come before `lang-settings-fix`: both hook `setClientSettingEndpoint`,
// and hooks run in registration order.
import './app_api/client-settings';
import './enable-features';
// Registers `window.__ytaf_yt_ui_demo__` for verifying the renderer toolkit
// on-device. Remove once a real feature consumes `yt_ui`.
import './yt_ui/harness';
import './adblock';
import './hooks/json-stringify';
import './shorts.js';
import './sponsorblock.js';
import './ui.js';
import './font-fix.css';
import './thumbnail-quality';
import './screensaver-fix';
import './yt-fixes.css';
import './watch.js';
import './video-quality';
import './lang-settings-fix';
import './remove-endscreen';
import './hooks';
import './block-webos-cast';
import './auto-account-select';
