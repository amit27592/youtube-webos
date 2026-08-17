import { configGetDesc, configGetKeys, type ConfigKey } from '../config';

/**
 * The Advanced Settings tree.
 *
 * Structure only — {@link ./render.ts} turns it into renderer payloads, and the
 * typed config schema supplies each option's control type, values and label. A
 * node therefore names a config key rather than restating how to edit it.
 *
 * Deliberately not a port of TizenTube's tree: ours has different keys, and
 * theirs carries its whole subtree inline in every renderer payload where we
 * pass a path instead.
 */

export interface SettingsGroup {
  kind: 'group';
  title: string;
  subtitle?: string;
  /** A YouTube `iconType`. */
  icon?: string;
  children: SettingsNode[];
}

export interface SettingsOption {
  kind: 'option';
  key: ConfigKey;
  /** Overrides {@link configGetDesc}, for labels that read better in context. */
  title?: string;
  subtitle?: string;
  icon?: string;
}

export type SettingsNode = SettingsGroup | SettingsOption;

function option(
  key: ConfigKey,
  extra: Omit<SettingsOption, 'kind' | 'key'> = {}
): SettingsOption {
  return { kind: 'option', key, ...extra };
}

export const settingsTree: SettingsGroup = {
  kind: 'group',
  title: 'Advanced Settings',
  subtitle: 'youtube-webos',
  children: [
    {
      kind: 'group',
      title: 'Ad blocking',
      icon: 'DOLLAR_SIGN',
      children: [
        option('enableAdBlock', { icon: 'DOLLAR_SIGN' }),
        option('enablePaidPromotionOverlay', { icon: 'MONEY_HAND' }),
        option('enableSigninReminder', { icon: 'ACCOUNT_CIRCLE' })
      ]
    },
    {
      kind: 'group',
      title: 'SponsorBlock',
      subtitle: 'https://sponsor.ajay.app/',
      icon: 'MONEY_HAND',
      children: [
        option('enableSponsorBlock', {
          title: 'Enable SponsorBlock',
          icon: 'MONEY_HAND'
        }),
        {
          kind: 'group',
          title: 'Segments to skip',
          icon: 'PLAYLIST_PLAY',
          children: [
            option('enableSponsorBlockSponsor', { title: 'Sponsor' }),
            option('enableSponsorBlockIntro', {
              title: 'Intro / intermission'
            }),
            option('enableSponsorBlockOutro', { title: 'Endcards / credits' }),
            option('enableSponsorBlockInteraction', {
              title: 'Interaction reminder'
            }),
            option('enableSponsorBlockSelfPromo', {
              title: 'Unpaid / self promotion'
            }),
            option('enableSponsorBlockMusicOfftopic', {
              title: 'Non-music section'
            }),
            option('enableSponsorBlockPreview', {
              title: 'Preview / recap'
            })
          ]
        }
      ]
    },
    {
      kind: 'group',
      title: 'Playback',
      icon: 'PLAY_ARROW',
      children: [
        option('enablePreviews', { icon: 'VOLUME_UP' }),
        option('forceHighResVideo', { icon: 'HD' }),
        option('removeEndscreen', { icon: 'CLOSE' }),
        option('removeShorts', { icon: 'SHORTS' })
      ]
    },
    {
      kind: 'group',
      title: 'Interface',
      icon: 'SETTINGS',
      children: [
        option('enableFixedUI', { icon: 'SPARKLE' }),
        option('upgradeThumbnails', { icon: 'PHOTO_CAMERA' }),
        option('hideLogo', { icon: 'YOUTUBE_LOGO' }),
        option('showWatch', { icon: 'CLOCK' })
      ]
    },
    {
      kind: 'group',
      title: 'webOS',
      icon: 'TV',
      children: [option('autoAccountSelect', { icon: 'ACCOUNT_CIRCLE' })]
    }
  ]
};

/** The label shown for an option node. */
export function optionTitle(node: SettingsOption): string {
  return node.title ?? configGetDesc(node.key);
}

/**
 * Resolves a path of child indices to a node. Returns `null` for a path that
 * doesn't lead anywhere — a stale renderer payload can outlive a tree change.
 */
export function nodeAtPath(path: readonly number[]): SettingsNode | null {
  let node: SettingsNode = settingsTree;

  for (const index of path) {
    if (node.kind !== 'group') return null;
    const child: SettingsNode | undefined = node.children[index];
    if (!child) return null;
    node = child;
  }

  return node;
}

/**
 * Every config key reachable from the tree.
 *
 * Only used by {@link assertTreeIsComplete}, which is why it lives here rather
 * than being computed where it's needed.
 */
function reachableKeys(
  node: SettingsNode,
  into: Set<ConfigKey>
): Set<ConfigKey> {
  if (node.kind === 'option') {
    into.add(node.key);
  } else {
    for (const child of node.children) reachableKeys(child, into);
  }

  return into;
}

/**
 * Warns about config keys the tree doesn't expose.
 *
 * A key with no way to reach it is invisible to users, and adding a key while
 * forgetting the tree is the easy mistake to make. This can't be a type error:
 * the schema is the source of truth for what keys exist, and the tree is free
 * to group them however it likes.
 */
export function assertTreeIsComplete() {
  const reachable = reachableKeys(settingsTree, new Set());
  const missing = configGetKeys().filter((key) => !reachable.has(key));

  if (missing.length > 0) {
    console.warn(
      '[advanced-settings] Config keys missing from the settings tree:',
      missing.join(', ')
    );
  }
}
