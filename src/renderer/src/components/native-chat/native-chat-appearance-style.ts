import './native-chat-appearance.css'
import type { CSSProperties } from 'react'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import { resolveNativeChatAppearanceSettings } from '../../../../shared/native-chat-appearance-settings'

export type NativeChatAppearanceStyle = CSSProperties & {
  '--chat-font-size': string
  '--chat-code-font-size': string
  '--chat-content-max-width': string
  '--text-sm': string
  '--text-xs': string
}

export function nativeChatAppearanceStyle(
  settings: Pick<GlobalSettings, 'nativeChatAppearance'> | null | undefined
): NativeChatAppearanceStyle {
  const { fontSize, codeFontSize, width } = resolveNativeChatAppearanceSettings(
    settings?.nativeChatAppearance
  )
  return {
    fontSize: `${fontSize}px`,
    '--chat-font-size': `${fontSize}px`,
    '--chat-code-font-size': `${codeFontSize}px`,
    '--chat-content-max-width': width === 'full' ? 'none' : width === 'wide' ? '60rem' : '46rem',
    '--text-sm': `${fontSize}px`,
    '--text-xs': `${fontSize - 2}px`
  }
}
