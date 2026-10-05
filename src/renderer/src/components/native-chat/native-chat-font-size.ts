import {
  normalizeNativeChatAppearanceSettings,
  resolveNativeChatAppearanceSettings,
  type NativeChatAppearanceSettings
} from '../../../../shared/native-chat-appearance-settings'

export function chatFontSizeForAction(
  appearance: NativeChatAppearanceSettings | undefined,
  action: Exclude<ChatFontSizeAction, null>
): NativeChatAppearanceSettings | undefined {
  const { fontSize } = resolveNativeChatAppearanceSettings(appearance)
  return normalizeNativeChatAppearanceSettings({
    ...appearance,
    fontSize: action === 'reset' ? undefined : fontSize + (action === 'increase' ? 1 : -1)
  })
}

export type ChatFontSizeAction = 'increase' | 'decrease' | 'reset' | null

// Shift permits the + and _ variants on keyboard layouts that require it.
export function chatFontSizeActionForEvent(
  e: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey'>,
  isMac: boolean
): ChatFontSizeAction {
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
