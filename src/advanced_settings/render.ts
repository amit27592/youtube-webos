// Adapted from https://github.com/reisxd/TizenTube/blob/3f28fc3d/mods/ui/settings.js

import {
  configGetOption,
  configRead,
  type ConfigKey,
  type ConfigOption
} from '../config';
import { customActionCommand } from '../app_api/index';
import {
  buttonItem,
  overlayPanelItemListRenderer,
  setClientSetting,
  showModal,
  type Command
} from '../yt_ui/index';
import {
  nodeAtPath,
  optionTitle,
  settingsTree,
  type SettingsNode,
  type SettingsOption
} from './tree';

/**
 * Renders the Advanced Settings tree into YouTube's native overlay panels.
 *
 * Adapted from TizenTube's `optionShow()`, with one structural change: a page
 * is addressed by its **path** — the list of child indices that reaches it —
 * rather than by embedding the subtree it should display into every renderer
 * payload that can open it. Paths keep the payloads small and, more usefully,
 * mean a page re-rendered after a toggle is rebuilt from current config rather
 * than from a snapshot taken when its parent was drawn.
 */

/** The custom action that opens a settings page. */
export const SHOW_ACTION = 'ADVANCED_SETTINGS_SHOW';

export interface ShowParameters {
  /** Child indices from the root. `[]` is the top-level page. */
  path?: number[];
  /** Which row to focus. */
  selectedIndex?: number;
  /**
   * Replace the current page rather than stacking a new one. Set when
   * re-rendering a page in place after a value changed, so the Back stack does
   * not grow by one for every toggle.
   */
  update?: boolean;
}

const ICON_CHECKED = 'CHECK_BOX';
const ICON_UNCHECKED = 'CHECK_BOX_OUTLINE_BLANK';
const ICON_RADIO_ON = 'RADIO_BUTTON_CHECKED';
const ICON_RADIO_OFF = 'RADIO_BUTTON_UNCHECKED';
const ICON_SUBMENU = 'CHEVRON_RIGHT';

/**
 * A popup id per page, so `update` replaces the page it was rendered from
 * rather than whichever popup happens to be on top.
 */
function popupId(path: readonly number[]): string {
  return `ytaf-advanced-settings-${path.join('-')}`;
}

function showCommand(params: ShowParameters): Command {
  return customActionCommand(SHOW_ACTION, params);
}

/** Applies a value, then redraws the page the row lives on. */
function applyAndRedraw(
  write: Command,
  path: readonly number[],
  selectedIndex: number
): Command[] {
  return [write, showCommand({ path: [...path], selectedIndex, update: true })];
}

/**
 * The values a `number` option can be set to.
 *
 * A TV remote has no text entry, so a stepper is a list of discrete values.
 * Accumulated float error would produce values like `1.7500000000000002`, which
 * would then fail schema validation, so each step is rounded to the precision
 * implied by `step`.
 */
function numberSteps(option: {
  min: number;
  max: number;
  step: number;
}): number[] {
  const { min, max, step } = option;

  if (!(step > 0) || max < min) {
    console.warn('[advanced-settings] Nonsensical number option:', option);
    return [min];
  }

  const decimals = (String(step).split('.')[1] ?? '').length;
  const count = Math.floor((max - min) / step);
  const values: number[] = [];

  for (let i = 0; i <= count; i++) {
    values.push(Number((min + i * step).toFixed(decimals)));
  }

  return values;
}

/** The current value of an option, as shown in a row's subtitle. */
function valueSummary(
  key: ConfigKey,
  option: ConfigOption
): string | undefined {
  switch (option.type) {
    case 'boolean':
      return undefined;
    case 'number':
      return String(configRead(key));
    case 'enum': {
      const current = configRead(key) as unknown as string;
      return option.values.find((v) => v.value === current)?.label ?? current;
    }
    case 'multi': {
      const current = configRead(key) as unknown as string[];
      if (current.length === 0) return 'None';
      return option.values
        .filter((v) => current.includes(v.value))
        .map((v) => v.label)
        .join(', ');
    }
  }
}

/** One row for a child of a group page. */
function rowForNode(
  node: SettingsNode,
  path: readonly number[],
  index: number
) {
  const childPath = [...path, index];

  if (node.kind === 'group') {
    return buttonItem(
      { title: node.title, ...(node.subtitle && { subtitle: node.subtitle }) },
      { ...(node.icon && { icon: node.icon }), secondaryIcon: ICON_SUBMENU },
      [showCommand({ path: childPath })]
    );
  }

  const option = configGetOption(node.key);
  const title = optionTitle(node);

  // A boolean toggles in place; everything else needs a page of its own to pick
  // a value on.
  if (option.type === 'boolean') {
    const current = configRead(node.key) as unknown as boolean;

    return buttonItem(
      { title, ...(node.subtitle && { subtitle: node.subtitle }) },
      {
        ...(node.icon && { icon: node.icon }),
        secondaryIcon: current ? ICON_CHECKED : ICON_UNCHECKED
      },
      applyAndRedraw(
        setClientSetting(node.key, { boolValue: !current }),
        path,
        index
      )
    );
  }

  const subtitle = node.subtitle ?? valueSummary(node.key, option);

  return buttonItem(
    { title, ...(subtitle && { subtitle }) },
    { ...(node.icon && { icon: node.icon }), secondaryIcon: ICON_SUBMENU },
    [showCommand({ path: childPath })]
  );
}

function renderGroup(
  node: Extract<SettingsNode, { kind: 'group' }>,
  path: readonly number[],
  params: ShowParameters
) {
  const rows = node.children.map((child, index) =>
    rowForNode(child, path, index)
  );

  return showModal(
    { title: node.title, ...(node.subtitle && { subtitle: node.subtitle }) },
    overlayPanelItemListRenderer(rows, params.selectedIndex ?? 0),
    { id: popupId(path), ...(params.update && { update: true }) }
  );
}

/**
 * The value picker for a non-boolean option. `enum` and `number` are
 * single-choice (radio); `multi` toggles each entry independently.
 */
function renderOptionPage(
  node: SettingsOption,
  path: readonly number[],
  params: ShowParameters
) {
  const option = configGetOption(node.key);
  const title = optionTitle(node);

  let rows: unknown[];

  switch (option.type) {
    case 'boolean':
      // Booleans are edited from their parent page and never get one of their
      // own; reaching here means the tree and this switch disagree.
      console.warn(
        '[advanced-settings] No value page for boolean key',
        node.key
      );
      return;

    case 'enum': {
      const current = configRead(node.key) as unknown as string;
      rows = option.values.map((value, index) =>
        buttonItem(
          value.label,
          {
            secondaryIcon:
              value.value === current ? ICON_RADIO_ON : ICON_RADIO_OFF
          },
          applyAndRedraw(
            setClientSetting(node.key, { stringValue: value.value }),
            path,
            index
          )
        )
      );
      break;
    }

    case 'number': {
      const current = configRead(node.key) as unknown as number;
      rows = numberSteps(option).map((value, index) =>
        buttonItem(
          String(value),
          { secondaryIcon: value === current ? ICON_RADIO_ON : ICON_RADIO_OFF },
          applyAndRedraw(
            // `intValue` is the only numeric field YouTube's settings commands
            // carry, and it travels as a string. Our client-settings bridge
            // coerces it back, so fractional steps survive the round trip.
            setClientSetting(node.key, { intValue: String(value) }),
            path,
            index
          )
        )
      );
      break;
    }

    case 'multi': {
      const current = configRead(node.key) as unknown as string[];
      rows = option.values.map((value, index) =>
        buttonItem(
          value.label,
          {
            secondaryIcon: current.includes(value.value)
              ? ICON_CHECKED
              : ICON_UNCHECKED
          },
          applyAndRedraw(
            setClientSetting(node.key, { arrayValue: value.value }),
            path,
            index
          )
        )
      );
      break;
    }
  }

  return showModal(
    { title, ...(node.subtitle && { subtitle: node.subtitle }) },
    overlayPanelItemListRenderer(rows, params.selectedIndex ?? 0),
    { id: popupId(path), ...(params.update && { update: true }) }
  );
}

/** Handles the {@link SHOW_ACTION} custom action. */
export function showSettingsPage(parameters: unknown) {
  const params: ShowParameters =
    typeof parameters === 'object' && parameters !== null
      ? (parameters as ShowParameters)
      : {};

  const path = Array.isArray(params.path) ? params.path : [];
  const node = nodeAtPath(path);

  if (!node) {
    console.warn(
      '[advanced-settings] No node at path',
      path,
      '- falling back to the root page.'
    );
    void renderGroup(settingsTree, [], {});
    return;
  }

  void (node.kind === 'group'
    ? renderGroup(node, path, params)
    : renderOptionPage(node, path, params));
}
