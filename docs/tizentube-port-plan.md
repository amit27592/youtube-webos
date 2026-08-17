# TizenTube Feature Port Plan

Porting selected features from [reisxd/TizenTube](https://github.com/reisxd/TizenTube) into `youtube-webos`.

## Context

TizenTube is a **downstream fork of this repository**, adapted for Samsung Tizen TVs via TizenBrew. Its `mods/package.json` credits `"Reis Can, YouTube WebOs contributors"` and is licensed **GPL-3.0-only** — identical to ours, so porting is license-clean. `mods/spatial-navigation-polyfill.js` and `mods/domrect-polyfill.js` are byte-identical to ours apart from an added `export {}` marker.

The fork grew a substantial feature set we never had. This plan pulls those features back, adapted to webOS.

Precedent already exists in this repo: [src/app_api/index.ts](../src/app_api/index.ts) and [src/lang-settings-fix.ts](../src/lang-settings-fix.ts) both carry `// Adapted from https://github.com/reisxd/TizenTube/...` headers.

## Reference clone

```
reference/tizentube/          # gitignored
  mods/                       # the userscript — everything we care about
  service/                    # Tizen DIAL service — IGNORE
  standalone/                 # TizenBrew standalone shell — IGNORE
```

Pinned at commit `3f28fc3d5e9412cf236763923d9b3a839ab5d4aa` (2026-07-28). To refresh:

```bash
git -C reference/tizentube pull
```

To re-clone from scratch:

```bash
git clone https://github.com/reisxd/TizenTube.git reference/tizentube
```

---

## Global ground rules

Every phase prompt below assumes these. Repeat them into any agent context.

### Do

- **Use our infrastructure, not theirs.** We already have better versions of several things TizenTube open-codes:
  | Instead of TizenTube's | Use ours |
  |---|---|
  | `mods/resolveCommand.js` `patchResolveCommand()` | `ResolveCommandRegistry` in [src/app_api/index.ts](../src/app_api/index.ts) |
  | `setTimeout(() => poll(), 250)` player polling | `getPlayer()` / `requireElement()` in [src/player_api/helpers.ts](../src/player_api/helpers.ts) |
  | ad-hoc `onStateChange` listeners | `getPlayerManager()` in [src/player_api/manager.ts](../src/player_api/manager.ts) |
  | raw `JSON.parse` monkey-patching | the hook layer in [src/hooks/](../src/hooks/) |
  | `mods/config.js` flat object | the typed `Map` schema in [src/config.js](../src/config.js) |
- **Write new modules in TypeScript.** Ported JS must at minimum pass `pnpm run lint:all`.
- **Verify compat after every phase:** `pnpm run build && pnpm run test:compat`.
- **Attribute.** Head every ported file with `// Adapted from https://github.com/reisxd/TizenTube/blob/3f28fc3d/mods/<path>`.

### Don't

- **No i18next.** TizenTube's `mods/ui/settings.js` is saturated with `t('...')` calls backed by 30 locale files. We ship English strings inline. Strip every `t()` call and inline the English value from `reference/tizentube/mods/translations/resources/en.json`. (Revisit i18n as a separate project — i18next is a real bundle-size and ES5-compat commitment.)
- **No `window.h5vcc.*`.** Cobalt/Tizen-only. Anything gated on it is dead code here.
- **No `localhost:8099` proxying.** `mods/features/standaloneUserscript.js` and `mods/features/userAgentSpoofing.js` exist because TizenBrew has no UA control. We handle this in [assets/appinfo.json](../assets/appinfo.json) via `vendorExtension.userAgent` + `allowCrossDomain`. Never port them.
- **No `mods/utils/ASTParser.js`.** Pulls esprima + estraverse into the bundle to pattern-match minified YT code. Wrong trade for a TV bundle.
- **Don't touch** `reference/tizentube/service/` or `reference/tizentube/standalone/`.
- **Don't break** the webOS-specific modules TizenTube has no equivalent for: [src/screensaver-fix.ts](../src/screensaver-fix.ts), [src/block-webos-cast.ts](../src/block-webos-cast.ts), [src/lang-settings-fix.ts](../src/lang-settings-fix.ts), [src/auto-account-select.ts](../src/auto-account-select.ts), [src/font-fix.css](../src/font-fix.css), [src/yt-fixes.css](../src/yt-fixes.css), and the LG voice/ThinQ + DIAL + deeplink launch handling in [src/utils.js](../src/utils.js).

---

## Phase numbering

**Phase numbers are execution order.** Your Tier 1 / Tier 2 grouping is preserved as a label on each heading, but it does not drive sequence — dependencies and risk do. Two consequences worth stating up front:

- Tier 2's `enableFeatures` runs first because it is 18 lines and depends on nothing.
- Tier 2's Mini Player runs last because it is the most likely thing here to break.

Phases landing **before** Advanced Settings (Phase 4) still add their config keys to the schema. The settings tree is generated from that schema, so those keys surface automatically once Phase 4 lands. Until then defaults apply and toggling requires devtools — acceptable for the two phases affected.

---

## Phase 0 — Baseline

Prerequisite for everything else. Land as one PR.

### 0a. Drop webOS 1–3

TizenTube compiles to `Chrome 47`. Our floor is `Safari 7`. Dropping webOS 1–3 puts the floor at **Chrome 53 (webOS 4)**, which clears TizenTube's baseline with headroom.

> **Prompt**
>
> In [.browserslistrc](../.browserslistrc), remove the `safari 7`, `safari 8`, and `chrome 38` lines so the floor becomes `chrome 53 # webOS 4.x`. Keep the comment style. Then:
>
> - Run `pnpm run build && pnpm run test:compat` and confirm it passes.
> - Check whether [babel.config.js](../babel.config.js), [src/domrect-polyfill.js](../src/domrect-polyfill.js), or the `whatwg-fetch` / `core-js-pure` dependencies in [package.json](../package.json) exist solely for the dropped targets. Report what could now be removed, but do not remove anything yet — bundle-size cleanup is a separate change.
> - Update the compatibility statement in [README.md](../README.md) and add a `CHANGELOG.md` entry noting webOS 1–3 are no longer supported.

### 0b. Config schema with types

TizenTube's settings UI is generated from a declarative tree. Ours can't be until config entries carry a type. [src/config.js](../src/config.js) currently stores `Map<key, { default, desc }>` — every entry is implicitly boolean.

> **Prompt**
>
> Rework [src/config.js](../src/config.js) so each entry declares a `type`. Convert the file to TypeScript (`src/config.ts`) with a discriminated union:
>
> - `{ type: 'boolean', default: boolean, desc: string }`
> - `{ type: 'enum', default: string, values: { value: string, label: string }[], desc: string }`
> - `{ type: 'number', default: number, min: number, max: number, step: number, desc: string }`
> - `{ type: 'multi', default: string[], values: { value: string, label: string }[], desc: string }` (for SponsorBlock manual-skip category lists)
>
> All existing keys become `type: 'boolean'` with their current defaults — no behavior change. Export a typed `configRead`/`configWrite` so `configRead('enableAdBlock')` narrows to `boolean`.
>
> Existing users have data under the `ytaf-configuration` localStorage key. Write a migration that reads the old shape and preserves values. Note that TizenTube uses **the same key** with a different schema (shared heritage) — harmless in practice since the apps never coexist, but the migration must not assume our shape.
>
> Keep `configAddChangeListener` / `configGetDesc` working — [src/ui.js](../src/ui.js) depends on them and is not being removed in this phase.

### 0c. Extend the resolveCommand registry

`ResolveCommandRegistry` in [src/app_api/index.ts](../src/app_api/index.ts) dispatches hooks by top-level command key. The settings UI needs two more capabilities that TizenTube's `mods/resolveCommand.js` has.

> **Prompt**
>
> Read `reference/tizentube/mods/resolveCommand.js` — specifically `patchResolveCommand()` (lines ~29–110) and its handling of `setClientSettingEndpoint` and `customAction`.
>
> Extend `ResolveCommandRegistry` in [src/app_api/index.ts](../src/app_api/index.ts) to support:
>
> 1. **`setClientSettingEndpoint` interception** — when YouTube's own settings UI writes a client setting whose `clientSettingEnum.item` matches one of our config keys, route it to `configWrite` instead. Handle their `intValue` / `stringValue` / `boolValue` / `arrayValue` variants (`arrayValue` toggles membership in a list). Preserve the existing `I18N_LANGUAGE` behavior in [src/lang-settings-fix.ts](../src/lang-settings-fix.ts) — do not duplicate it.
> 2. **`customAction` dispatch** — a registry of named actions (`{ customAction: { action: 'ADVANCED_SETTINGS_SHOW', parameters: [] } }`), also reachable via `signalAction.customAction`. Export a `registerCustomAction(name, handler)` API.
>
> Keep it typed. Do not copy their `for (const key in window._yttv)` scan — our `findHookTarget()` already does this correctly with validation.

---

---

## Phase 1 — enableFeatures · _Tier 2_

**TizenTube source:** `reference/tizentube/mods/features/enableFeatures.js` (18 lines)

YouTube gates features off when it detects a low-end TV. This flips them back on.

> **Prompt**
>
> Port `reference/tizentube/mods/features/enableFeatures.js` to `src/enable-features.ts`.
>
> Their implementation scans `Object.values(window._yttv)` for a `Map` containing the key `ENABLE_PREVIEWS_WITH_SOUND` and sets it from config. Also look at `mods/ui/ui.js` lines ~38–46, where `enableFixedUI` sets `window.tectonicConfig.featureSwitches.isLimitedMemory = false`, `legacyApplicationQuality = 'full-animation'`, and the three animation switches — plus the `MutationObserver` at the end of that file that strips the `app-quality-root` body class.
>
> Note that our [assets/appinfo.json](../assets/appinfo.json) already sets `"support360Content": true` and [src/utils.js](../src/utils.js) already passes `env_forceFullAnimation=1`. **Determine what these `tectonicConfig` overrides add on top of what we already do** before porting them — there may be nothing left to do, in which case say so.
>
> Their default for `enableFixedUI` is `(window.h5vcc && window.h5vcc.tizentube) ? false : true` — on webOS that reduces to `true`, so hardcode it.
>
> Config keys: `enablePreviews` (boolean, default true), `enableFixedUI` (boolean, default true) — the latter only if the audit shows it does something for us.
>
> Acceptance: previews play with sound; animation quality is not degraded; report on-device whether performance regresses on older webOS 4/5 hardware, since these switches exist because YouTube thinks the hardware can't handle them.

---

## Phase 2 — Adblock validation · _Tier 1_

Not a port. Our [src/adblock.js](../src/adblock.js) is 90 lines; theirs is 443. Most of the delta is _other features_ they bolted into the same `JSON.parse` hook (DeArrow, queuing, settings injection, thumbnail upgrading) — but some is genuine ad-blocking coverage we lack.

> **Prompt**
>
> Audit `reference/tizentube/mods/features/adblock.js` against [src/adblock.js](../src/adblock.js) and report — **do not implement anything outside ad blocking**; DeArrow is Phase 9, queuing is Phase 10, settings injection is Phase 4.
>
> Specifically compare:
>
> - Their handling of `adPlacements` / `playerAds` / `adSlots`. They **assign empty values** (`r.adPlacements = []`, `r.playerAds = false`, `r.adSlots = []`); we **delete the keys**. Determine which is more robust against YouTube's ad-presence checks and whether the difference is load-bearing.
> - `paidContentOverlay` removal (gated on `enablePaidPromotionOverlay`) — we have no equivalent.
> - `feedNudgeRenderer` and `alertWithActionsRenderer` sign-in-reminder filtering (gated on `enableSigninReminder`) — we have no equivalent.
> - Their `removeAdSlotRenderer` coverage vs [src/adblock.js:73-90](../src/adblock.js#L73-L90). Note any renderer paths they filter that we miss.
> - `r.entries` / `reelWatchEndpoint.adClientParams.isAd` Shorts ad filtering — confirm ours at [src/adblock.js:60-64](../src/adblock.js#L60-L64) is equivalent.
>
> Then implement only the confirmed ad-blocking gaps, adding config keys `enablePaidPromotionOverlay` and `enableSigninReminder` where behavior should be optional.
>
> Also check the recent breakage history — commits `822f20d` ("fix: broken adblock and shorts filter") and `22e227e` ("fix: clone in `stringify` hook to work around frozen objects") — and confirm the ported additions don't reintroduce the frozen-object problem that `22e227e` fixed.
>
> Acceptance: ads blocked on home, search, watch, and Shorts; no regression against the cases fixed in `822f20d` and `22e227e`.

---

---

## Phase 3 — YT renderer toolkit · _Tier 1_

Foundation for Phases 2–5 and 10–12. No user-visible change on its own.

**TizenTube source:** `reference/tizentube/mods/ui/ytUI.js` (459 lines)

This is the highest-leverage file in the whole port. It constructs YouTube's own native renderer payloads and pushes them through `resolveCommand`, so panels look and behave exactly like YouTube's — including real spatial navigation, which our hand-rolled HTML overlay only approximates.

Exported builders: `showToast`, `Modal` / `showModal`, `OverlayPanelHeaderRenderer`, `overlayPanelItemListRenderer`, `buttonItem`, `timelyAction`, `longPressData`, `MenuServiceItemRenderer`, `MenuNavigationItemRenderer`, `SettingsCategory`, `SettingActionRenderer`, `scrollPaneRenderer`, `scrollPaneItemListRenderer`, `overlayMessageRenderer`, `ShelfRenderer`, `TileRenderer`, `QrCodeRenderer`, `ButtonRenderer`.

> **Prompt**
>
> Port `reference/tizentube/mods/ui/ytUI.js` to a new `src/yt_ui/` module, in TypeScript.
>
> - One file per concern is fine (`toast.ts`, `modal.ts`, `renderers.ts`, `index.ts`) — do not reproduce their single-file layout if splitting reads better.
> - Type the renderer payloads. They are plain JSON shapes; define interfaces for the ones we use rather than `Record<string, unknown>` everywhere. Partial typing is acceptable — YouTube's renderer schema is large and undocumented — but the arguments each builder takes must be fully typed.
> - Replace their bare `resolveCommand(cmd)` calls with `ResolveCommandRegistry.getInstance()` + `dispatchCommand()`.
> - Strip every `t()` call; accept plain strings as arguments instead. Callers supply English text.
> - **Skip `QrCodeRenderer`** unless a later phase needs it — it drags in the `qrcode-npm` dependency.
> - Write a scratch harness (a module you can temporarily add to [src/userScript.ts](../src/userScript.ts)) that renders a toast and a two-item modal, so the toolkit is verifiable on-device before any feature depends on it.
>
> Acceptance: a toast and a modal render on a real webOS device (or via `pnpm run inspect`), navigable with the remote, dismissible with Back.

---

---

## Phase 4 — Advanced Settings · _Tier 1_

**Name the feature "Advanced Settings"** everywhere: panel title, the entry injected into YouTube's settings menu, config descriptions, changelog.

**TizenTube source:**

- `reference/tizentube/mods/ui/settings.js` (1051 lines) — the declarative settings tree and its renderer
- `reference/tizentube/mods/ui/customYTSettings.js` (28 lines) — injects the entry into YouTube's own settings screen
- `reference/tizentube/mods/ui/customUI.js` (188 lines) — supporting UI glue

**Our current UI:** [src/ui.js](../src/ui.js) (385 lines) — a hand-built HTML overlay on the green button, using `spatial-navigation-polyfill.js` with `keyMode = 'NONE'` and manual arrow-key `navigate()` calls.

> **Prompt**
>
> Build an **Advanced Settings** panel rendered with native YouTube renderers, replacing the HTML overlay in [src/ui.js](../src/ui.js).
>
> **Read first:** `reference/tizentube/mods/ui/settings.js`. Note the shape — `modernUI()` returns a declarative array of `{ name, icon, value, type, options }` nodes, where `value` is a config key, `options` is either a nested array (submenu) or a modal-content object, and `optionShow()` (line ~899) recursively renders a node into `showModal(...)` + `overlayPanelItemListRenderer(buttons)`. Selections dispatch back through `resolveCommand`.
>
> **Build:**
>
> 1. `src/advanced_settings/tree.ts` — the settings tree for **our** config keys, generated from the typed schema landed in Phase 0b. Do not copy TizenTube's tree; ours has different keys. Every current key in [src/config.js](../src/config.js) must appear, grouped sensibly (Ad blocking / SponsorBlock / Playback / Interface / webOS).
> 2. `src/advanced_settings/render.ts` — the recursive renderer, adapted from their `optionShow()`, built on the Phase 3 `src/yt_ui/` toolkit. Must handle every config type from Phase 0b: boolean toggle, enum picker, number stepper, multi-select.
> 3. `src/advanced_settings/index.ts` — registers a `customAction` named `ADVANCED_SETTINGS_SHOW` via the Phase 0c registry, and binds the **green button (keyCode 404 / 172)** to it.
> 4. Menu injection — adapt `reference/tizentube/mods/ui/customYTSettings.js`. It hooks the `JSON.parse` response for YouTube's settings screen and `unshift`s a `SettingsCategory` containing a `SettingActionRenderer`. Wire this through our [src/hooks/json-stringify.ts](../src/hooks/json-stringify.ts) sibling (a new `src/hooks/json-parse.ts` if one doesn't exist) rather than patching `JSON.parse` directly a second time. Title the entry **"Advanced Settings"**.
>
> **Then retire the old UI:** once parity is confirmed on-device, delete [src/ui.js](../src/ui.js) and [src/ui.css](../src/ui.css), and remove them from [src/userScript.ts](../src/userScript.ts). Check whether [src/spatial-navigation-polyfill.js](../src/spatial-navigation-polyfill.js) (1762 lines) still has consumers — if `src/ui.js` was the only one, removing it is a large bundle win. Report before deleting.
>
> **Do not port** from their tree: the "Support TizenTube" panel, social-media links, the updater entry, or anything reading `window.h5vcc`.
>
> Acceptance: green button opens Advanced Settings; YouTube's own settings screen shows an "Advanced Settings" entry that opens the same panel; every config key is reachable and round-trips to localStorage; Back exits cleanly at every depth.

---

---

## Phase 5 — SponsorBlock replacement · _Tier 1_

**Replace our implementation wholesale**, per your call.

**TizenTube source:** `reference/tizentube/mods/features/sponsorblock.js` (437 lines)
**Ours:** [src/sponsorblock.js](../src/sponsorblock.js) (405 lines)

What theirs adds: `filler` and `poi_highlight` categories, a **manual-skip mode** (`sponsorBlockManualSkips` — prompt instead of auto-skip, per category), skip toasts (`enableSponsorBlockToasts`), and segment-overlay positioning that handles both the old and new YouTube TV player layouts.

> **Prompt**
>
> Replace [src/sponsorblock.js](../src/sponsorblock.js) with a port of `reference/tizentube/mods/features/sponsorblock.js`, as `src/sponsorblock.ts`.
>
> **Read both files first** and diff the behavior — ours is the ancestor, so much of the structure will be familiar. Their `SponsorBlockHandler` class (line ~56) is the core.
>
> **Adapt:**
>
> - Their `attachVideo()` polls with `setTimeout(..., 100)` until `document.querySelector('video')` exists, and their video lifecycle is driven by ad-hoc listeners. Replace both with `getPlayerManager()` from [src/player_api/manager.ts](../src/player_api/manager.ts) — subscribe to its `newVideo` and `playbackStart` events. This is a real improvement over the fork, not a shortcut.
> - Their `scheduleSkipHandler` reads `div[idomkey="slider"]` geometry and branches on the presence of `div[idomkey="Metadata-Section"]` to detect old-vs-new UI. Keep this — it is what makes the segment overlay land correctly. Verify both branches on webOS.
> - Toasts go through the Phase 3 `showToast`.
> - Manual-skip prompts go through the Phase 3 modal/`timelyAction` builders.
> - Keep `tiny-sha256` for the 4-char video-hash privacy prefix — we already depend on it.
> - Strip `t()`; inline English segment names from `reference/tizentube/mods/translations/resources/en.json` under `sponsorblock.segments.*`.
>
> **New config keys** (add to the Phase 0b schema): `enableSponsorBlockFiller` (boolean, default false), `enableSponsorBlockHighlight` (boolean, default true), `enableSponsorBlockToasts` (boolean, default true), `sponsorBlockManualSkips` (multi, default `['intro','outro','filler']`). Surface all of them in the Phase 4 settings tree.
>
> Acceptance: segments fetch and skip on a known-sponsored video; the overlay bar aligns with the scrubber in both player layouts; manual-skip categories prompt rather than skip; toasts respect their config key; disabling SponsorBlock disables everything cleanly.

---

---

## Phase 6 — Chapters display · _Tier 1_

**TizenTube source:** `reference/tizentube/mods/ui/chapters.js` (136 lines). No equivalent here.

Parses chapter timestamps out of the video description and injects native `marker` renderers into the player scrubber, with thumbnails and `onActive` seek commands.

> **Prompt**
>
> Port `reference/tizentube/mods/ui/chapters.js` to `src/chapters.ts`.
>
> - `parseTimestamps()` handles only `M:SS` / `MM:SS` (its regex is `/^\d+:\d{2}/`). **Extend it to handle `H:MM:SS`** — long videos are exactly where chapters matter most. Add unit-style verification of the parser if you can do so without adding a test framework; otherwise verify manually against a long video with hour-mark chapters.
> - `marker()` builds thumbnails from `https://i.ytimg.com/vi/${videoID}/hqdefault.jpg`. Coordinate with [src/thumbnail-quality.ts](../src/thumbnail-quality.ts) so this doesn't fight our existing thumbnail upgrading.
> - Their integration point is inside `mods/features/adblock.js` (the `JSON.parse` hook). Wire ours through the hook layer in [src/hooks/](../src/hooks/) instead — do not add chapter logic to [src/adblock.js](../src/adblock.js).
> - Add config key `enableChapters` (boolean, default true) and surface it under Playback in Advanced Settings.
>
> Acceptance: a video with description chapters shows markers on the scrubber; selecting one seeks; a video without chapters is unaffected.

---

---

## Phase 7 — Playback speed + UI · _Tier 1_

**TizenTube source:** `reference/tizentube/mods/ui/speedUI.js` (117 lines). No equivalent here.
Related config: `videoSpeed`, `speedSettingsIncrement`, `enableSpeedControlsButton`.

> **Prompt**
>
> Port `reference/tizentube/mods/ui/speedUI.js` to `src/playback-speed.ts`.
>
> - Their `speedSettings()` builds a speed picker modal and is invoked from `mods/resolveCommand.js`. Rebuild it on the Phase 3 toolkit and register it as a `customAction` via the Phase 0c registry.
> - Add a speed button to the player controls. See how TizenTube injects player buttons via `ButtonRenderer` in `mods/ui/ytUI.js` (line ~423) and where `enableSpeedControlsButton` is consumed.
> - Apply speed via the player API in [src/player_api/](../src/player_api/) — add a typed `setPlaybackRate` to [src/player_api/yt-api.ts](../src/player_api/yt-api.ts) rather than reaching for `document.querySelector('video').playbackRate` directly, so it survives player swaps.
> - Config keys: `videoSpeed` (number, default 1, range 0.25–3), `speedSettingsIncrement` (number, default 0.25), `enableSpeedControlsButton` (boolean, default true).
> - **Decide and document** whether speed persists across videos. TizenTube persists it in config. Persisting a 2× rate across a session is a footgun on a TV where the setting isn't visible; prefer resetting to 1× on app launch while persisting the _increment_ preference. Flag the choice in the PR.
>
> Acceptance: speed button appears in player controls; picker adjusts rate in real time; audio pitch correction behaves acceptably on webOS at 1.5× and 2×.

---

---

## Phase 8 — Preferred video quality · _Tier 2_

**TizenTube source:** `reference/tizentube/mods/features/preferredVideoQuality.js` (101 lines)
**Ours:** [src/video-quality.ts](../src/video-quality.ts) (71 lines) — currently only a `forceHighResVideo` boolean.

> **Prompt**
>
> Extend [src/video-quality.ts](../src/video-quality.ts) with a preferred-quality selector, adapting `reference/tizentube/mods/features/preferredVideoQuality.js`.
>
> - Their `PreferredQualityHandler` class polls for `.html5-video-player`, listens to `onStateChange`, and re-applies quality per video via `#hasAppliedQuality` tracking. Replace the polling and the listener with `getPlayerManager()`'s `newVideo` event — the per-video reset logic becomes unnecessary.
> - Config: replace or supplement `forceHighResVideo` with `preferredVideoQuality` (enum: `auto` / `2160p` / `1440p` / `1080p` / `720p` / `480p` / `360p`, default `auto`). If replacing, migrate `forceHighResVideo: true` → `preferredVideoQuality: '2160p'` in the Phase 0b migration.
> - Also consider `videoPreferredCodec` (enum: `any` / `av01` / `vp9` / `avc1`, default `any`). Their implementation lives in `mods/features/adblock.js` (~line 47) and filters `streamingData.adaptiveFormats` by `mimeType`, preserving all `audio/` formats. **This one is genuinely useful on webOS** — older LG panels handle AV1 poorly and forcing VP9 or AVC can fix stutter. Port it into our hook layer, not into [src/adblock.js](../src/adblock.js).
>
> Acceptance: setting a quality pins it across videos; `auto` behaves as stock; codec forcing measurably changes the format served (verify via stats-for-nerds).

---

## Phase 9 — DeArrow · _Tier 2_

**TizenTube source:** `reference/tizentube/mods/features/adblock.js` — `deArrowify()`, invoked from `processShelves()` (~line 112 onward)

Replaces clickbait titles and thumbnails using the [DeArrow](https://dearrow.ajay.app/) API. Implemented entirely inside the `JSON.parse` hook — no DOM manipulation, which is why it works well on TV.

> **Prompt**
>
> Port DeArrow support to `src/dearrow.ts`.
>
> **Read** `reference/tizentube/mods/features/adblock.js` and trace `deArrowify()` and `processShelves()` — note every response path they apply it to: `contents.sectionListRenderer.contents`, `continuationContents.sectionListContinuation.contents`, `continuationContents.horizontalListContinuation.items`, the per-tab `tvSecondaryNavRenderer` sections, and `singleColumnWatchNextResults.pivot.sectionListRenderer`.
>
> **Adapt:**
>
> - Wire through our [src/hooks/](../src/hooks/) layer. **Do not add this to [src/adblock.js](../src/adblock.js)** — keeping their file conflated is one of the things we're not copying.
> - The DeArrow API is a network call inside a synchronous `JSON.parse` hook. Study how they resolve that ordering problem and reproduce it correctly — this is the hard part of the phase. If they use a cache-and-backfill approach, keep it; if they block, find a better way.
> - Respect the DeArrow API's rate limits and use the privacy-preserving hashed-prefix endpoint if available, matching how [src/sponsorblock.js](../src/sponsorblock.js) already hashes video IDs.
> - Config keys: `enableDeArrow` (boolean, default **false** — this changes what users see, so opt-in on our side even though TizenTube defaults it on), `enableDeArrowThumbnails` (boolean, default false).
>
> Acceptance: with the feature on, known-clickbait videos show community titles on home and search; thumbnails swap when the thumbnail key is on; network failure degrades silently to stock titles.

---

## Phase 10 — Video queueing · _Tier 2_

**TizenTube source:** `reference/tizentube/mods/features/videoQueuing.js` (54 lines) plus the `ShelfRenderer`/`TileRenderer` queue shelf injected in `mods/features/adblock.js`

> **Prompt**
>
> Port video queueing to `src/video-queue.ts`.
>
> - Their state lives in a global `window.queuedVideos = { videos: [], lastVideoId: null }`. **Use a proper module-scoped store** with a typed interface instead; other modules read it, so export accessors rather than a mutable global.
> - Their advance-on-end logic listens for `onStateChange` and checks `playerStateObject.isEnded`. Use `getPlayerManager()` instead.
> - The queue is surfaced two ways: (a) a "Queued Videos" `ShelfRenderer` with a "Clear Queue" tile, unshifted into `singleColumnWatchNextResults.pivot.sectionListRenderer` — see `mods/features/adblock.js`; (b) an "Add to queue" entry in the long-press menu via `longPressData` / `MenuServiceItemRenderer` in `mods/ui/ytUI.js`. Port both, through our hook layer.
> - Custom actions `CLEAR_QUEUE` and the queue-add action register via the Phase 0c registry.
> - Decide whether the queue persists across app restarts. TizenTube's does not (it's in-memory). Keep it in-memory — a stale queue from days ago is worse than no queue.
> - Config key: `enableLongPress` (boolean, default true) if the long-press menu doesn't already work here.
>
> Acceptance: long-press on a tile offers "Add to queue"; queued videos appear as a shelf on the watch page; playback advances through the queue; Clear Queue empties it.

---

## Phase 11 — Small UI adds · _Tier 2_

Independent, low-risk, each a small standalone change. Land as separate commits.

| Feature                  | TizenTube source                               | Notes                                                                                                                       |
| ------------------------ | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Clock                    | `mods/ui/clock.js` (62 lines)                  | Supersedes our `showWatch` config key and [src/watch.js](../src/watch.js). Adds 12/24-hour and show-seconds options.        |
| Theme colors             | `mods/ui/theme.js` (25 lines)                  | Sets `focusContainerColor` and `routeColor` via injected CSS. Trivial — 25 lines.                                           |
| Disable "Who's watching" | `mods/ui/disableWhosWatching.js` (47 lines)    | Coordinate with our [src/auto-account-select.ts](../src/auto-account-select.ts); overlapping concerns.                      |
| Screen dimming           | `mods/ui/ui.js` (in `eventHandler`, ~line 137) | Idle-dim the UI while paused. Coordinate with [src/screensaver-fix.ts](../src/screensaver-fix.ts) — these interact.         |
| Hide watched videos      | `mods/features/adblock.js` — `hideVideo()`     | Config: `enableHideWatchedVideos`, `hideWatchedVideosThreshold` (default 80%), `hideWatchedVideosPages`.                    |
| HQ thumbnails            | `mods/features/adblock.js` — `hqify()`         | Compare against our existing [src/thumbnail-quality.ts](../src/thumbnail-quality.ts) first — we may already do this better. |
| Sidebar customization    | `mods/ui/customGuideAction.js` (34 lines)      | Config: `disabledSidebarContents`, `disableChannelsOnSidebar`.                                                              |

> **Prompt (per feature)**
>
> Port `<feature>` from `reference/tizentube/<source>` into `src/<name>.ts`, following the global ground rules. Strip `t()` calls and inline English strings. Add its config keys to the Phase 0b schema and surface them in the Phase 4 Advanced Settings tree under Interface. Check the "Notes" column above for the module it interacts with, and verify no regression there.

---

---

## Phase 12 — Mini Player · _Tier 2_

**TizenTube source:** `reference/tizentube/mods/features/pictureInPicture.js` (197 lines)

> **Scope: in-app Mini Player only. No system-wide PiP.**

TizenTube's implementation is already in-app, not OS-level: it patches `PlaybackPreviewService.start/stop` off `window._yttv` and manipulates `ytlr-player` / `ytlr-player-container` z-index and display via `MutationObserver`. That matches the scope you want, so nothing needs stripping — but the naming does.

> **Prompt**
>
> Port `reference/tizentube/mods/features/pictureInPicture.js` to `src/mini-player.ts`.
>
> - **Name it "Mini Player" throughout** — module, config keys, settings labels, changelog. Do not use "PiP" or "Picture-in-Picture" in user-facing strings; it implies an OS-level feature we are not building.
> - Their `pipLoad()` resolves `PlayerService` and `PlaybackPreviewService` from `Object.values(window._yttv).find(a => a && a.mappings)`. Wrap this lookup defensively — it is the most fragile YT-internals dependency in the entire plan and will break when YouTube reshuffles its bundle. Fail closed: if the services aren't found, the feature disables itself silently and everything else keeps working.
> - Their fullscreen-restore path (`pipToFullscreen`) is triggered from `mods/ui/ui.js` on the Right key when the search box has focus. **Design our own key binding** rather than copying that — theirs is a workaround for TizenBrew's key handling. Pick something discoverable and document it in [README.md](../README.md).
> - Config keys: `enableMiniPlayer` (boolean, default false). Skip their `enableMPButton` / `enableSwapMPWithPIP` — those exist because they ship both a mini player and Cobalt PiP.
> - Verify interaction with [src/screensaver-fix.ts](../src/screensaver-fix.ts) and [src/block-webos-cast.ts](../src/block-webos-cast.ts).
>
> Acceptance: video continues playing in a corner while browsing; returning to fullscreen preserves playback position; exiting the app while mini-playing does not leave audio running; feature self-disables cleanly if YT internals move.

---

## Explicitly not porting

|                                         | Why                                                                                                            |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `mods/features/autoFrameRate.js`        | Calls `window.h5vcc.tizentube.SetFrameRate` — Cobalt-only, does not exist on webOS WAM.                        |
| `mods/features/standaloneUserscript.js` | Proxies all traffic through `localhost:8099`; requires TizenBrew's service. We use `appinfo.json` UA spoofing. |
| `mods/features/userAgentSpoofing.js`    | Same — handled by `vendorExtension.userAgent`.                                                                 |
| `mods/features/updater.js`              | Superseded by the IPK + webOS Homebrew Channel.                                                                |
| `mods/utils/ASTParser.js`               | esprima + estraverse in the bundle to parse minified YT code. Wrong trade.                                     |
| `service/`, `standalone/`               | TizenBrew/DIAL infrastructure; superseded by [src/utils.js](../src/utils.js) launch handling.                  |
| i18n (`mods/translations/`)             | Deferred. i18next + 30 locales is a separate project with real bundle-size implications.                       |
| `QrCodeRenderer`                        | Drags in `qrcode-npm` for a feature we have no use for.                                                        |

---

## Dependency graph

Phase numbers already encode a valid execution order. This shows what actually constrains that order, so you can parallelize where it's safe.

```
Phase 0  Baseline ─────────────────────────────────────── blocks everything
   │
   ├── Phase 1  enableFeatures ......... needs only 0b
   ├── Phase 2  Adblock validation ..... needs only the hook layer
   │
   └── Phase 3  yt_ui toolkit ─────────── blocks 4, 5, 6, 7, 10, 11, 12
          │
          ├── Phase 4  Advanced Settings ... surfaces config for every later phase
          ├── Phase 5  SponsorBlock ........ needs 3 (toasts, manual-skip prompts)
          ├── Phase 6  Chapters ............ needs 3 (marker renderers)
          └── Phase 7  Playback speed ...... needs 3 (picker modal, player button)

   Phase 8   Preferred quality ... needs 0b only — can run any time after Phase 0
   Phase 9   DeArrow ............. after Phase 2; shares the hook layer
   Phase 10  Video queueing ...... needs 3 (long-press menu, shelf renderers)
   Phase 11  Small UI adds ....... after Phase 4 so the keys have a home
   Phase 12  Mini Player ......... last; highest breakage risk
```

**Safe to run in parallel:** Phases 1, 2, and 8 are mutually independent and depend only on Phase 0. Phase 3 can start alongside them.

**Why the ordering is what it is:**

| Decision                       | Reason                                                                                                                                                                                     |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| enableFeatures first           | 18 lines, zero dependencies, immediate visible improvement. Cheapest possible confidence that the Phase 0 config rework is sound.                                                          |
| Adblock validation early       | It's the app's core promise and the thing most recently broken (`822f20d`, `22e227e`). Validate before piling features onto the same hook.                                                 |
| yt_ui before Advanced Settings | Settings is the toolkit's first consumer, not its foundation. Building the panel first would mean writing the toolkit twice.                                                               |
| SponsorBlock after yt_ui       | Manual-skip prompts and toasts are toolkit consumers. _(This corrects my earlier verbal recommendation, which had SponsorBlock second — it can't be.)_                                     |
| Mini Player last               | Its `Object.values(window._yttv).find(a => a && a.mappings)` service lookup is the most fragile dependency in the plan. Land it when nothing else is in flight, so a break is unambiguous. |

Each phase is independently shippable. Verify on real hardware between phases — several of these depend on YouTube TV internals that behave differently on webOS than on Tizen, and a device check is the only thing that catches it.
