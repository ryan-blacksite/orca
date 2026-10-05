export type NativeChatAppearanceSettings = {
  /** Chat text size in px, 12–20; absent = 14. */
  fontSize?: number
  /** Code text size in px, 10–18; absent = 12. */
  codeFontSize?: number
  /** Transcript and composer width; absent = comfortable (46rem). */
  width?: 'comfortable' | 'wide' | 'full'
}

export type NativeChatGlobalSettings = {
  nativeChatAppearance?: NativeChatAppearanceSettings
}
