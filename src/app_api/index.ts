// Adapted from https://github.com/reisxd/TizenTube/blob/522f83cc012d5b1c75181b651e084a3afa280323/mods/resolveCommand.js

declare global {
  interface Window {
    _yttv?: Record<string, unknown>;
  }
}

export type ResolveCommandPayload = Record<string, unknown>;

interface ResolveCommand {
  (command: ResolveCommandPayload, extra?: unknown): unknown;
}

export interface ResolveCommandHook {
  /**
   * @param next Passes the command on. This is the next hook registered for the
   *   same command key, or YouTube's original `resolveCommand` if this is the
   *   last one. Call it to decline handling the command.
   */
  (
    next: ResolveCommand,
    payload: ResolveCommandPayload,
    extra: unknown
  ): unknown;
}

/**
 * Handler for a named `customAction`.
 * @param parameters The `parameters` field of the `customAction` payload, if any.
 */
export interface CustomActionHandler {
  (parameters: unknown): void;
}

/**
 * Command keys that YouTube's own renderers use to carry an endpoint, and which
 * we therefore may find a `customAction` nested inside. A renderer will only
 * accept certain endpoint keys in certain slots, so a `customAction` has to be
 * smuggled in under whichever key that slot allows.
 */
const CUSTOM_ACTION_WRAPPERS = [
  'signalAction',
  'showEngagementPanelEndpoint',
  'playlistEditEndpoint'
] as const;

interface CustomActionPayload {
  action: string;
  parameters?: unknown;
}

function isCustomActionPayload(value: unknown): value is CustomActionPayload {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Record<string, unknown>).action === 'string'
  );
}

/**
 * Pulls a `customAction` out of a command, whether it sits at the top level or
 * inside one of the {@link CUSTOM_ACTION_WRAPPERS}.
 */
function extractCustomAction(
  command: ResolveCommandPayload
): CustomActionPayload | null {
  if (isCustomActionPayload(command.customAction)) {
    return command.customAction;
  }

  for (const wrapper of CUSTOM_ACTION_WRAPPERS) {
    const inner = command[wrapper];
    if (typeof inner !== 'object' || inner === null) continue;

    const action = (inner as Record<string, unknown>).customAction;
    if (isCustomActionPayload(action)) return action;
  }

  return null;
}

let registry: ResolveCommandRegistry | null = null;

export class ResolveCommandRegistry {
  #originalFn: ResolveCommand;
  #cmds = new Map<string, ResolveCommandHook[]>();
  #customActions = new Map<string, CustomActionHandler>();

  private resolveCommand = (
    command: Record<string, unknown>,
    extra?: unknown
  ) => {
    console.group(`[${this.constructor.name}] Resolving`);
    console.debug(`Command:`);
    console.debug(command);
    console.debug(`Extra:`);
    console.debug(extra);
    console.groupEnd();

    if (this.#handleCustomActions(command, extra)) return true;

    for (const key of Object.keys(command)) {
      const hooks = this.#cmds.get(key);
      if (!hooks?.length) continue;

      // Build the chain back-to-front so each hook's `next` is the hook
      // registered after it, terminating in YouTube's original function.
      let next = this.#originalFn;
      for (let i = hooks.length - 1; i >= 0; i--) {
        const hook = hooks[i]!;
        const downstream = next;
        next = (payload, ex) => hook(downstream, payload, ex);
      }

      return next(command, extra);
    }

    return this.#originalFn(command, extra);
  };

  #runCustomAction({ action, parameters }: CustomActionPayload) {
    const handler = this.#customActions.get(action);

    if (!handler) {
      console.warn(
        `[${ResolveCommandRegistry.name}] No handler registered for customAction "${action}"`
      );
      return;
    }

    try {
      handler(parameters);
    } catch (e) {
      console.error(
        `[${ResolveCommandRegistry.name}] customAction "${action}" threw:`,
        e
      );
    }
  }

  /**
   * @returns `true` if the command was fully consumed as a custom action and
   *   must not reach YouTube's `resolveCommand`.
   */
  #handleCustomActions(command: ResolveCommandPayload, extra?: unknown) {
    const direct = extractCustomAction(command);
    if (direct) {
      this.#runCustomAction(direct);
      return true;
    }

    // `commandExecutorCommand` batches commands; our custom ones may be mixed
    // in with genuine YouTube commands, so split them rather than consuming the
    // whole batch.
    const batch = command.commandExecutorCommand;
    if (typeof batch !== 'object' || batch === null) return false;

    const commands = (batch as Record<string, unknown>).commands;
    if (!Array.isArray(commands)) return false;

    const subCommands = commands as ResolveCommandPayload[];
    if (!subCommands.some((sub) => extractCustomAction(sub))) return false;

    for (const sub of subCommands) {
      // Recurse so nested batches and hooks apply to the non-custom commands too.
      this.resolveCommand(sub, extra);
    }

    return true;
  }

  private constructor(hookTargetName: string) {
    if (!ResolveCommandRegistry.checkHookTarget(hookTargetName)) {
      throw new Error(
        `Hook target "${hookTargetName}" not found in window._yttv`
      );
    }

    const hookTarget = window._yttv![hookTargetName] as {
      instance: { resolveCommand: ResolveCommand };
    };

    this.#originalFn = hookTarget.instance.resolveCommand.bind(
      hookTarget.instance
    );

    hookTarget.instance.resolveCommand = this.resolveCommand;

    console.debug(`[${this.constructor.name}] Hooked:`, this.#originalFn);
  }

  private static checkHookTarget(targetName: string) {
    const target = window._yttv?.[targetName];

    return !!(
      target &&
      typeof target === 'function' &&
      'instance' in target &&
      typeof target.instance === 'object' &&
      typeof (target.instance as Record<string, unknown>).resolveCommand ===
        'function'
    );
  }

  private static findHookTarget() {
    if (typeof window?._yttv !== 'object') return null;

    for (const key in window._yttv) {
      if (this.checkHookTarget(key)) {
        return key;
      }
    }

    return null;
  }

  private static async getHookTarget(): Promise<string> {
    let hook = this.findHookTarget();

    if (hook) return hook;

    return new Promise((resolve) => {
      const poll = () => {
        hook = this.findHookTarget();
        if (hook) {
          resolve(hook);
        } else {
          setTimeout(poll, 0);
        }
      };
      poll();
    });
  }

  static async getInstance() {
    if (registry) return registry;

    const key = await this.getHookTarget();

    registry = registry ?? new ResolveCommandRegistry(key);
    return registry;
  }

  /**
   * Register a hook for a command key. Multiple hooks may share a key; they run
   * in registration order and each decides whether to pass the command on via
   * its `next` argument.
   */
  setHook(command: string, fn: ResolveCommandHook) {
    const hooks = this.#cmds.get(command);
    if (hooks) {
      hooks.push(fn);
    } else {
      this.#cmds.set(command, [fn]);
    }
  }

  /** Remove a single hook, or every hook for `command` if `fn` is omitted. */
  removeHook(command: string, fn?: ResolveCommandHook) {
    if (!fn) {
      this.#cmds.delete(command);
      return;
    }

    const hooks = this.#cmds.get(command);
    if (!hooks) return;

    const idx = hooks.indexOf(fn);
    if (idx !== -1) hooks.splice(idx, 1);
    if (!hooks.length) this.#cmds.delete(command);
  }

  /**
   * Register a named action, dispatchable by sending YouTube's own renderers a
   * command of the form `{ customAction: { action: name, parameters } }` — also
   * accepted nested under {@link CUSTOM_ACTION_WRAPPERS} or inside a
   * `commandExecutorCommand` batch.
   */
  registerCustomAction(name: string, handler: CustomActionHandler) {
    if (this.#customActions.has(name)) {
      console.warn(
        `[${ResolveCommandRegistry.name}] Replacing existing customAction handler "${name}"`
      );
    }

    this.#customActions.set(name, handler);
  }

  unregisterCustomAction(name: string) {
    this.#customActions.delete(name);
  }

  dispatchCommand(payload: ResolveCommandPayload, extra?: unknown) {
    return this.#originalFn(payload, extra);
  }
}

ResolveCommandRegistry.getInstance();

/**
 * Register a named `customAction` handler once the registry is available.
 *
 * Convenience wrapper over {@link ResolveCommandRegistry.registerCustomAction}
 * for the common case of a module registering an action at import time.
 */
export async function registerCustomAction(
  name: string,
  handler: CustomActionHandler
): Promise<void> {
  const instance = await ResolveCommandRegistry.getInstance();
  instance.registerCustomAction(name, handler);
}

/**
 * Build a command that invokes a registered custom action. Hand this to any
 * renderer slot that takes a service endpoint.
 */
export function customActionCommand(
  action: string,
  parameters?: unknown
): ResolveCommandPayload {
  return {
    clickTrackingParams: null,
    customAction: parameters === undefined ? { action } : { action, parameters }
  };
}
