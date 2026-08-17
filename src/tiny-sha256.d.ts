/**
 * `tiny-sha256` ships no types. Only the default export is used, to build the
 * 4-character video hash SponsorBlock queries are made with.
 */
declare module 'tiny-sha256' {
  export default function sha256(message: string): string;
}
