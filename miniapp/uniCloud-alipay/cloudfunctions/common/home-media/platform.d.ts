export {};

declare global {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- HBuilderX 5.34 loads newer Node declarations with TS 5.2, losing Buffer's base.
  interface Buffer extends Uint8Array {}
}
