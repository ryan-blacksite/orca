import { useEffect, type RefObject } from 'react'
import { useAppStore } from '../../store'
import {
  chatFontScaleActionForEvent,
  chatFontSizeForAction,
  type ChatFontScaleAction
} from './native-chat-font-scale'
import { isMacPlatform } from './native-chat-shortcut'

// Serialize quick key repeats so each step reads the preceding persisted value.
let fontSizeWrite = Promise.resolve()
function writeFontSize(action: Exclude<ChatFontScaleAction, null>): void {
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
}
const increase = (): void => writeFontSize('increase')
const decrease = (): void => writeFontSize('decrease')
const reset = (): void => writeFontSize('reset')

export function useNativeChatFontScale(
  enabled: boolean,
  rootRef?: RefObject<HTMLDivElement | null>
): void {
  useEffect(() => {
    if (!enabled) {
      return
    }
    const isMac = isMacPlatform()
    const onKeyDown = (e: KeyboardEvent): void => {
      if (
        rootRef?.current &&
        (!(e.target instanceof Node) || !rootRef.current.contains(e.target))
      ) {
        return
      }
      const action = chatFontScaleActionForEvent(e, isMac)
      if (!action) {
        return
      }
      // Why: capture-phase + preventDefault so the chord changes chat text size instead
      // of the host (Electron) page zoom, and only while chat is active.
      e.preventDefault()
      e.stopPropagation()
      if (action === 'increase') {
        increase()
      } else if (action === 'decrease') {
        decrease()
      } else {
        reset()
      }
    }
    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true })
  }, [enabled, rootRef])
}
