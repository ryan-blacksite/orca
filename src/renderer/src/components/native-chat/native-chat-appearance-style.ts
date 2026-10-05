import type { CSSProperties } from 'react'
import type { GlobalSettings } from '../../../../shared/global-settings-types'

export type NativeChatAppearanceStyle = CSSProperties & {
  '--chat-font-size': string
  '--chat-code-font-size': string
  '--chat-content-max-width': string
}

export function nativeChatAppearanceStyle(_settings: GlobalSettings): NativeChatAppearanceStyle {
  return {
    '--chat-font-size': '14px',
    '--chat-code-font-size': '12px',
    '--chat-content-max-width': '46rem'
  }
}
