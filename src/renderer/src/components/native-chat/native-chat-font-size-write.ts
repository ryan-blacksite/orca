import { useAppStore } from '../../store'
import { chatFontSizeForAction, type ChatFontSizeAction } from './native-chat-font-size'

// Serialize quick key repeats so each step reads the preceding persisted value.
let fontSizeWrite = Promise.resolve()
export function writeNativeChatFontSize(action: Exclude<ChatFontSizeAction, null>): Promise<void> {
  fontSizeWrite = fontSizeWrite
    .then(async () => {
      const { settings, updateSettings } = useAppStore.getState()
      if (!settings) {
        return
      }
      await updateSettings({
        nativeChatAppearance: chatFontSizeForAction(settings.nativeChatAppearance, action)
      })
    })
    .catch((error) => console.error('Failed to update chat text size:', error))
  return fontSizeWrite
}
