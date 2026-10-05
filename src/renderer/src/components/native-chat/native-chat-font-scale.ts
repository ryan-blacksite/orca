import {
  normalizeNativeChatAppearanceSettings,
  resolveNativeChatAppearanceSettings,
  type NativeChatAppearanceSettings
} from '../../../../shared/native-chat-appearance-settings'

export function chatFontSizeForAction(
  appearance: NativeChatAppearanceSettings | undefined,
  action: Exclude<ChatFontScaleAction, null>
): NativeChatAppearanceSettings | undefined {
  const { fontSize } = resolveNativeChatAppearanceSettings(appearance)
  return normalizeNativeChatAppearanceSettings({
    ...appearance,
    fontSize: action === 'reset' ? undefined : fontSize + (action === 'increase' ? 1 : -1)
  })
}

export type ChatFontScaleAction = 'increase' | 'decrease' | 'reset' | null

/** Map a keydown to a font-scale action when it's the Cmd/Ctrl +/-/0 chord.
 *  Primary modifier follows AGENTS.md (metaKey on Mac, ctrlKey elsewhere) and
 *  must be the only primary modifier so it can't collide with Cmd+Ctrl chords.
 *  Shift/Alt are ignored on purpose: `+` is Shift+`=` on many layouts. Pure so
 *  it can be unit-tested without a DOM. */
export function chatFontScaleActionForEvent(
  e: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey'>,
  isMac: boolean
): ChatFontScaleAction {
  const primary = isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey
  if (!primary) {
    return null
  }
  switch (e.key) {
    case '=':
    case '+':
      return 'increase'
    case '-':
    case '_':
      return 'decrease'
    case '0':
      return 'reset'
    default:
      return null
  }
}
