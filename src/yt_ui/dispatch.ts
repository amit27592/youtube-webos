import { ResolveCommandRegistry } from '../app_api/index';

import type { Command } from './types';

/**
 * Hands a command to YouTube's own `resolveCommand`.
 *
 * Everything in this module builds native renderer payloads and pushes them
 * through here, so panels get YouTube's real spatial navigation, styling and
 * back-button handling for free.
 */
export async function dispatch(command: Command, extra?: unknown) {
  const registry = await ResolveCommandRegistry.getInstance();
  return registry.dispatchCommand(command, extra);
}
