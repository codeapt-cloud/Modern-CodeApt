/**
 * Ambient module declarations for the untyped ESM avatar libraries (Step 37).
 * met4citizen's TalkingHead + HeadTTS ship no `.d.ts`; we consume them behind a
 * narrow, hand-written structural interface in talkinghead-controller.ts, so `any`
 * here is intentional and contained to the lazy controller.
 */
declare module "@met4citizen/talkinghead" {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export const TalkingHead: any;
}
declare module "@met4citizen/headtts" {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export const HeadTTS: any;
}
