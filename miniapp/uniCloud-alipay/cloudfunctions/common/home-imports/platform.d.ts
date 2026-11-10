export {};

declare global {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- HBuilderX 5.34 uses TS 5.2 with newer Node declarations, losing Buffer's base.
  interface Buffer extends Uint8Array {}
}
