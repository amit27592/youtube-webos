/**
 * Builders for YouTube's own renderer payloads.
 *
 * Panels built here are rendered by YouTube itself, so they inherit its real
 * spatial navigation, focus styling and back-button behaviour rather than
 * approximating them, as a hand-rolled HTML overlay has to.
 *
 * Adapted from https://github.com/reisxd/TizenTube/blob/3f28fc3d/mods/ui/ytUI.js
 * `QrCodeRenderer` is deliberately not ported — it exists to drive an updater
 * flow we don't have, and pulls in a QR-code dependency.
 */

export * from './types';
export * from './dispatch';
export * from './toast';
export * from './modal';
export * from './renderers';
