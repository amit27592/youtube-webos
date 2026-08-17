const CONFIG_KEY = 'ytaf-configuration';

export interface ConfigEnumValue {
  value: string;
  label: string;
}

export interface BooleanConfigOption {
  type: 'boolean';
  default: boolean;
  desc: string;
}

export interface EnumConfigOption {
  type: 'enum';
  default: string;
  values: readonly ConfigEnumValue[];
  desc: string;
}

export interface NumberConfigOption {
  type: 'number';
  default: number;
  min: number;
  max: number;
  step: number;
  desc: string;
}

export interface MultiConfigOption {
  type: 'multi';
  default: readonly string[];
  values: readonly ConfigEnumValue[];
  desc: string;
}

export type ConfigOption =
  | BooleanConfigOption
  | EnumConfigOption
  | NumberConfigOption
  | MultiConfigOption;

/**
 * The config schema.
 *
 * `as const` is load-bearing: it preserves the literal `type` tags and the
 * `values[].value` literals, which is what lets {@link configRead} narrow a
 * key to its concrete value type.
 */
const configOptions = {
  enableAdBlock: {
    type: 'boolean',
    default: true,
    desc: 'Enable ad blocking'
  },
  upgradeThumbnails: {
    type: 'boolean',
    default: false,
    desc: 'Upgrade thumbnail quality'
  },
  removeShorts: {
    type: 'boolean',
    default: false,
    desc: 'Remove Shorts from subscriptions'
  },
  enableSponsorBlock: {
    type: 'boolean',
    default: true,
    desc: 'Enable SponsorBlock'
  },
  enableSponsorBlockSponsor: {
    type: 'boolean',
    default: true,
    desc: 'Skip sponsor segments'
  },
  enableSponsorBlockIntro: {
    type: 'boolean',
    default: true,
    desc: 'Skip intro segments'
  },
  enableSponsorBlockOutro: {
    type: 'boolean',
    default: true,
    desc: 'Skip outro segments'
  },
  enableSponsorBlockInteraction: {
    type: 'boolean',
    default: true,
    desc: 'Skip interaction reminder segments'
  },
  enableSponsorBlockSelfPromo: {
    type: 'boolean',
    default: true,
    desc: 'Skip self promotion segments'
  },
  enableSponsorBlockMusicOfftopic: {
    type: 'boolean',
    default: true,
    desc: 'Skip non-music segments in music videos'
  },
  enableSponsorBlockPreview: {
    type: 'boolean',
    default: false,
    desc: 'Skip recaps and previews'
  },
  enableSponsorBlockFiller: {
    type: 'boolean',
    default: false,
    desc: 'Skip tangents and filler'
  },
  enableSponsorBlockHighlight: {
    type: 'boolean',
    default: true,
    desc: 'Offer to skip to the highlight'
  },
  enableSponsorBlockToasts: {
    type: 'boolean',
    default: true,
    desc: 'Announce skips on screen'
  },
  /**
   * Categories that prompt instead of skipping automatically. Only has an
   * effect for categories that are enabled for skipping at all.
   */
  sponsorBlockManualSkips: {
    type: 'multi',
    default: ['intro', 'outro', 'filler'],
    values: [
      { value: 'sponsor', label: 'Sponsor' },
      { value: 'intro', label: 'Intro / intermission' },
      { value: 'outro', label: 'Endcards / credits' },
      { value: 'interaction', label: 'Interaction reminder' },
      { value: 'selfpromo', label: 'Unpaid / self promotion' },
      { value: 'music_offtopic', label: 'Non-music section' },
      { value: 'preview', label: 'Preview / recap' },
      { value: 'filler', label: 'Tangents / filler' }
    ],
    desc: 'Ask before skipping'
  },
  /**
   * Off by default, unlike TizenTube. It changes what titles you see, and it
   * adds a network round trip to browse requests — see `src/dearrow.ts`.
   */
  enableDeArrow: {
    type: 'boolean',
    default: false,
    desc: 'Replace clickbait titles (DeArrow)'
  },
  enableDeArrowThumbnails: {
    type: 'boolean',
    default: false,
    desc: 'Replace thumbnails too (DeArrow)'
  },
  enableVideoQueue: {
    type: 'boolean',
    default: true,
    desc: 'Queue videos from the long-press menu'
  },
  /**
   * Only governs building a long-press menu for tiles that don't already have
   * one; tiles that do get the queue entry appended regardless.
   */
  enableLongPress: {
    type: 'boolean',
    default: true,
    desc: 'Add a long-press menu to tiles without one'
  },
  hideLogo: {
    type: 'boolean',
    default: false,
    desc: 'Hide YouTube logo'
  },
  /**
   * A short list rather than TizenTube's free-form colour strings: a remote has
   * no colour picker, and a fixed list can't inject CSS. See `src/theme.ts`.
   */
  routeColor: {
    type: 'enum',
    default: 'default',
    values: [
      { value: 'default', label: 'Default' },
      { value: 'black', label: 'Black' },
      { value: 'grey', label: 'Dark grey' },
      { value: 'navy', label: 'Navy' },
      { value: 'maroon', label: 'Maroon' },
      { value: 'forest', label: 'Forest' }
    ],
    desc: 'Background colour'
  },
  focusContainerColor: {
    type: 'enum',
    default: 'default',
    values: [
      { value: 'default', label: 'Default' },
      { value: 'black', label: 'Black' },
      { value: 'grey', label: 'Dark grey' },
      { value: 'navy', label: 'Navy' },
      { value: 'maroon', label: 'Maroon' },
      { value: 'forest', label: 'Forest' }
    ],
    desc: 'Sidebar highlight colour'
  },
  enableClock: {
    type: 'boolean',
    default: false,
    desc: 'Display time in UI'
  },
  clock12Hour: {
    type: 'boolean',
    default: false,
    desc: 'Use a 12-hour clock'
  },
  clockShowSeconds: {
    type: 'boolean',
    default: false,
    desc: 'Show seconds on the clock'
  },
  preferredVideoQuality: {
    type: 'enum',
    default: 'auto',
    values: [
      { value: 'auto', label: 'Auto' },
      { value: '2160p', label: '2160p (4K)' },
      { value: '1440p', label: '1440p' },
      { value: '1080p', label: '1080p' },
      { value: '720p', label: '720p' },
      { value: '480p', label: '480p' },
      { value: '360p', label: '360p' }
    ],
    desc: 'Preferred video quality'
  },
  /**
   * Older LG panels decode AV1 poorly; pinning VP9 or AVC can turn a stuttering
   * video into a smooth one. Audio formats are never filtered.
   */
  videoPreferredCodec: {
    type: 'enum',
    default: 'any',
    values: [
      { value: 'any', label: 'Any' },
      { value: 'av01', label: 'AV1' },
      { value: 'vp9', label: 'VP9' },
      { value: 'avc1', label: 'H.264 (AVC)' }
    ],
    desc: 'Preferred video codec'
  },
  /**
   * Reset to 1 on every launch — see the note in `src/playback-speed.ts`. The
   * key exists so the picker can round-trip through config and the current
   * speed is visible in Advanced Settings.
   */
  videoSpeed: {
    type: 'number',
    default: 1,
    min: 0.25,
    max: 3,
    step: 0.25,
    desc: 'Playback speed'
  },
  speedSettingsIncrement: {
    type: 'number',
    default: 0.25,
    min: 0.05,
    max: 0.5,
    step: 0.05,
    desc: 'Playback speed step'
  },
  enableSpeedControlsButton: {
    type: 'boolean',
    default: true,
    desc: 'Show a speed button in the player'
  },
  enableChapters: {
    type: 'boolean',
    default: true,
    desc: 'Show chapter markers from the description'
  },
  removeEndscreen: {
    type: 'boolean',
    default: false,
    desc: 'Remove end screens from video'
  },
  autoAccountSelect: {
    type: 'boolean',
    default: false,
    desc: 'Bypass initial account selection on startup'
  },

  // Phase 1 — enableFeatures
  enablePreviews: {
    type: 'boolean',
    default: true,
    desc: 'Play video previews with sound'
  },
  enableFixedUI: {
    type: 'boolean',
    default: true,
    desc: 'Restore full UI animation quality'
  },

  // Phase 2 — adblock coverage
  enablePaidPromotionOverlay: {
    type: 'boolean',
    default: false,
    desc: 'Show "paid promotion" overlay'
  },
  enableSigninReminder: {
    type: 'boolean',
    default: false,
    desc: 'Show sign-in reminders'
  }
} as const satisfies Record<string, ConfigOption>;

export type ConfigKey = keyof typeof configOptions;

type OptionOf<K extends ConfigKey> = (typeof configOptions)[K];

/** The value type a given config key holds. */
export type ConfigValue<K extends ConfigKey> =
  OptionOf<K> extends { type: 'boolean' }
    ? boolean
    : OptionOf<K> extends { type: 'number' }
      ? number
      : OptionOf<K> extends {
            type: 'enum';
            values: readonly { value: infer V extends string }[];
          }
        ? V
        : OptionOf<K> extends {
              type: 'multi';
              values: readonly { value: infer V extends string }[];
            }
          ? V[]
          : never;

type ConfigValues = { [K in ConfigKey]: ConfigValue<K> };

export interface ConfigChangeDetail<K extends ConfigKey = ConfigKey> {
  key: K;
  newValue: ConfigValue<K>;
  oldValue: ConfigValue<K>;
}

export type ConfigChangeListener<K extends ConfigKey> = (
  evt: CustomEvent<ConfigChangeDetail<K>>
) => void;

function configExists(key: string): key is ConfigKey {
  return Object.prototype.hasOwnProperty.call(configOptions, key);
}

/** Narrows an arbitrary string to a known config key. */
export function configHasKey(key: string): key is ConfigKey {
  return configExists(key);
}

// Multi-value defaults are declared as readonly tuples, which `ConfigValues`
// widens to mutable arrays; each key gets its own copy so a caller cannot
// mutate the schema's literal through a read.
const defaultConfig = Object.fromEntries(
  Object.entries(configOptions).map(([k, v]) => [
    k,
    Array.isArray(v.default) ? [...v.default] : v.default
  ])
) as unknown as ConfigValues;

const configFrags = Object.fromEntries(
  Object.keys(configOptions).map((k) => [k, new DocumentFragment()])
) as Record<ConfigKey, DocumentFragment>;

/**
 * Checks a stored value against its declared type.
 *
 * The `ytaf-configuration` key is shared heritage with TizenTube, which stores
 * a *different* schema under the same name. So a stored blob may legitimately
 * contain keys we don't know, or known keys holding values of the wrong type.
 * Anything that doesn't validate is dropped and the default applies.
 */
function validateValue(option: ConfigOption, value: unknown): boolean {
  switch (option.type) {
    case 'boolean':
      return typeof value === 'boolean';
    case 'number':
      return (
        typeof value === 'number' &&
        Number.isFinite(value) &&
        value >= option.min &&
        value <= option.max
      );
    case 'enum':
      return option.values.some((v) => v.value === value);
    case 'multi':
      return (
        Array.isArray(value) &&
        value.every((entry) => option.values.some((v) => v.value === entry))
      );
  }
}

/**
 * Config keys that have been renamed. Maps an obsolete key to a function that
 * folds its stored value into the current schema.
 */
const renames: {
  from: string;
  apply: (oldValue: unknown, into: Partial<ConfigValues>) => void;
}[] = [
  {
    // `forceHighResVideo` was a boolean meaning "always pick the top quality
    // on offer", which is what `2160p` now does: the resolver falls back to the
    // best available below the target, so a target above what a video has still
    // ends up at its maximum. `false` maps to `auto`, the default, so it is
    // left alone rather than written out.
    from: 'forceHighResVideo',
    apply: (oldValue, into) => {
      if (oldValue === true) into.preferredVideoQuality = '2160p';
    }
  },
  {
    // Renamed with the clock rewrite; same meaning.
    from: 'showWatch',
    apply: (oldValue, into) => {
      if (typeof oldValue === 'boolean') into.enableClock = oldValue;
    }
  }
];

function migrateStoredConfig(raw: unknown): Partial<ConfigValues> {
  const migrated: Partial<ConfigValues> = {};

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    console.warn('[config] Stored config is not an object; ignoring it.');
    return migrated;
  }

  const stored = raw as Record<string, unknown>;

  for (const { from, apply } of renames) {
    if (from in stored) {
      apply(stored[from], migrated);
      console.info('[config] Migrated obsolete key', from);
    }
  }

  for (const [key, value] of Object.entries(stored)) {
    if (!configExists(key)) {
      // Either an obsolete key of ours or a TizenTube key. Neither is ours to keep.
      continue;
    }

    if (!validateValue(configOptions[key], value)) {
      console.warn(
        '[config] Dropping stored value for',
        key,
        '- does not match declared type:',
        value
      );
      continue;
    }

    (migrated as Record<string, unknown>)[key] = value;
  }

  return migrated;
}

function loadStoredConfig(): Partial<ConfigValues> {
  const storage = window.localStorage.getItem(CONFIG_KEY);

  if (storage === null) {
    console.info('[config] Config not set; using defaults.');
    return {};
  }

  try {
    return migrateStoredConfig(JSON.parse(storage));
  } catch (err) {
    console.warn('[config] Error parsing stored config:', err);
    return {};
  }
}

const localConfig: Partial<ConfigValues> = loadStoredConfig();

export function configGetDesc(key: ConfigKey): string {
  if (!configExists(key)) {
    throw new Error('tried to get desc for unknown config key: ' + key);
  }

  return configOptions[key].desc;
}

/**
 * The schema entry for a key.
 *
 * Deliberately returns the widened {@link ConfigOption} union rather than the
 * key's exact entry: callers switch on `.type` at runtime, and narrowing here
 * would make branches for types no key currently uses look unreachable.
 */
export function configGetOption(key: ConfigKey): ConfigOption {
  if (!configExists(key)) {
    throw new Error('tried to get option for unknown config key: ' + key);
  }

  return configOptions[key];
}

/** Every config key, in declaration order. */
export function configGetKeys(): ConfigKey[] {
  return Object.keys(configOptions) as ConfigKey[];
}

export function configRead<K extends ConfigKey>(key: K): ConfigValue<K> {
  if (!configExists(key)) {
    throw new Error('tried to read unknown config key: ' + key);
  }

  const value = localConfig[key];

  return value === undefined ? defaultConfig[key] : value;
}

export function configWrite<K extends ConfigKey>(
  key: K,
  value: ConfigValue<K>
): void {
  if (!configExists(key)) {
    throw new Error('tried to write unknown config key: ' + key);
  }

  if (!validateValue(configOptions[key], value)) {
    throw new Error(
      `tried to write invalid value for config key ${key}: ${JSON.stringify(value)}`
    );
  }

  const oldValue = configRead(key);

  console.info('[config] Changing key', key, 'from', oldValue, 'to', value);
  // TS can't prove `ConfigValue<K>` and `ConfigValues[K]` are the same type
  // while `K` is still generic, even though they are by construction.
  (localConfig as Record<ConfigKey, unknown>)[key] = value;
  window.localStorage.setItem(CONFIG_KEY, JSON.stringify(localConfig));

  configFrags[key].dispatchEvent(
    new CustomEvent<ConfigChangeDetail<K>>('ytafConfigChange', {
      detail: { key, newValue: value, oldValue }
    })
  );
}

/**
 * Add a listener for changes in the value of a specified config option.
 */
export function configAddChangeListener<K extends ConfigKey>(
  key: K,
  callback: ConfigChangeListener<K>
): void {
  configFrags[key].addEventListener(
    'ytafConfigChange',
    callback as EventListener
  );
}

/**
 * Remove a listener for changes in the value of a specified config option.
 */
export function configRemoveChangeListener<K extends ConfigKey>(
  key: K,
  callback: ConfigChangeListener<K>
): void {
  configFrags[key].removeEventListener(
    'ytafConfigChange',
    callback as EventListener
  );
}
