// Adapted from https://github.com/reisxd/TizenTube/blob/3f28fc3d/mods/resolveCommand.js

import {
  configHasKey,
  configRead,
  configWrite,
  configGetOption,
  type ConfigKey
} from '../config';

import { ResolveCommandRegistry, type ResolveCommandHook } from './index';

/**
 * Routes `setClientSettingEndpoint` commands whose setting name is one of our
 * config keys into {@link configWrite}, so our settings can be driven by
 * YouTube's own native settings renderers.
 *
 * YouTube's own client settings use `SCREAMING_SNAKE_CASE` enum names and ours
 * are camelCase config keys, so the two namespaces can't collide. Anything we
 * don't recognise — including `I18N_LANGUAGE`, handled by
 * `src/lang-settings-fix.ts` — is passed on untouched.
 */

interface SettingData {
  clientSettingEnum?: { item?: unknown };
  intValue?: unknown;
  stringValue?: unknown;
  boolValue?: unknown;
  arrayValue?: unknown;
}

const VALUE_FIELDS = [
  'intValue',
  'stringValue',
  'boolValue',
  'arrayValue'
] as const;

type ValueField = (typeof VALUE_FIELDS)[number];

function findValueField(setting: SettingData): ValueField | null {
  return VALUE_FIELDS.find((field) => field in setting) ?? null;
}

/**
 * Applies one setting to config.
 * @returns whether the setting was ours to handle.
 */
function applySetting(setting: SettingData): boolean {
  const item = setting.clientSettingEnum?.item;

  if (typeof item !== 'string' || !configHasKey(item)) return false;

  const field = findValueField(setting);
  if (!field) {
    console.warn(
      '[client-settings] No recognised value field for config key',
      item,
      setting
    );
    return false;
  }

  const raw = setting[field];
  const option = configGetOption(item);

  try {
    if (field === 'arrayValue') {
      writeArrayToggle(item, raw);
      return true;
    }

    // `intValue` arrives as a string on the wire.
    const value = field === 'intValue' ? Number(raw) : raw;

    if (option.type === 'multi') {
      console.warn(
        '[client-settings] Refusing to write scalar to multi-value key',
        item
      );
      return false;
    }

    configWrite(item, value as never);
    return true;
  } catch (e) {
    console.error('[client-settings] Failed to write config key', item, e);
    return false;
  }
}

/**
 * `arrayValue` toggles membership rather than replacing the list — that's how
 * YouTube's multi-select renderers report a change.
 */
function writeArrayToggle(key: ConfigKey, raw: unknown) {
  const option = configGetOption(key);

  if (option.type !== 'multi') {
    throw new Error(`config key ${key} is not a multi-value key`);
  }

  const entry = String(raw);
  const current = configRead(key) as unknown as string[];

  const next = current.includes(entry)
    ? current.filter((v) => v !== entry)
    : [...current, entry];

  configWrite(key, next as never);
}

const hook: ResolveCommandHook = function (next, payload, extra) {
  const endpoint = payload.setClientSettingEndpoint;

  if (typeof endpoint !== 'object' || endpoint === null) {
    return next(payload, extra);
  }

  const settingDatas = (endpoint as Record<string, unknown>).settingDatas;
  if (!Array.isArray(settingDatas)) return next(payload, extra);

  let handledAny = false;
  for (const setting of settingDatas as SettingData[]) {
    if (applySetting(setting)) handledAny = true;
  }

  // If any setting was ours, the command was for us — YouTube has no idea what
  // these setting names mean and would log an error.
  if (handledAny) return true;

  return next(payload, extra);
};

const registry = await ResolveCommandRegistry.getInstance();
registry.setHook('setClientSettingEndpoint', hook);
