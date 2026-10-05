import { useEffect, type RefObject } from 'react'
import { chatFontSizeActionForEvent } from './native-chat-font-size'
import { writeNativeChatFontSize } from './native-chat-font-size-write'
import { isWebClientLocation } from '@/lib/web-client-location'
import { isMacPlatform } from './native-chat-shortcut'

export function useNativeChatFontSize(
  enabled: boolean,
  rootRef?: RefObject<HTMLDivElement | null>
): void {
  useEffect(() => {
    if (!enabled || !isWebClientLocation()) {
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
      const action = chatFontSizeActionForEvent(e, isMac)
      if (!action) {
        return
      }
      e.preventDefault()
      e.stopPropagation()
      void writeNativeChatFontSize(action)
    }
    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true })
  }, [enabled, rootRef])
}
