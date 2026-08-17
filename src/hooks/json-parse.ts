/**
 * A single, shared `JSON.parse` patch.
 *
 * YouTube TV ships its whole UI as JSON renderer payloads, so several of our
 * features want to inspect or rewrite parse results. Each one patching
 * `JSON.parse` for itself would make the order they run in depend on module
 * import order, and would multiply the cost paid by every unrelated
 * `JSON.parse` call in the app. Register a handler here instead.
 *
 * Handlers are called in registration order and may mutate the value in place.
 * A handler that throws is logged and skipped: this runs inside *every*
 * `JSON.parse` the app makes, so a bad response shape must never be able to
 * take the app down with it.
 */

export type JsonParseHandler = (value: unknown) => void;

const handlers: { name: string; handler: JsonParseHandler }[] = [];

export function addJsonParseHandler(name: string, handler: JsonParseHandler) {
  handlers.push({ name, handler });
}

const origParse = JSON.parse;

JSON.parse = function (this: unknown, ...args: [string, ...unknown[]]) {
  const value = origParse.apply(this, args as Parameters<typeof JSON.parse>);

  for (const { name, handler } of handlers) {
    try {
      handler(value);
    } catch (e) {
      console.error(`[json-parse] Handler "${name}" threw:`, e);
    }
  }

  return value;
};
