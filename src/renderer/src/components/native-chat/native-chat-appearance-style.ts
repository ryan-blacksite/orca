import './native-chat-appearance.css'
import type { CSSProperties } from 'react'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import { resolveNativeChatAppearanceSettings } from '../../../../shared/native-chat-appearance-settings'

export const NATIVE_CHAT_APPEARANCE_ROOT_CLASS = 'native-chat-appearance bg-chat-canvas'
export const NATIVE_CHAT_TRANSCRIPT_OUTER_CLASS = 'px-3 pt-10 pb-4 sm:px-4'
export const NATIVE_CHAT_TRANSCRIPT_COLUMN_CLASS =
  'mx-auto flex w-full max-w-(--chat-content-max-width) flex-col gap-5 px-[5px]'

export type NativeChatAppearanceStyle = CSSProperties & {
  '--chat-font-size': string
  '--chat-code-font-size': string
  '--chat-content-max-width': string
  '--chat-secondary-font-size': string
  '--chat-inline-code-ratio': string
  '--chat-estimated-line-height': number
  '--chat-estimated-chars-per-line': number
}

export function nativeChatAppearanceStyle(
  settings: Pick<GlobalSettings, 'nativeChatAppearance'> | null | undefined,
  measuredColumnWidthPx?: number | null
): NativeChatAppearanceStyle {
  const { fontSize, codeFontSize, width } = resolveNativeChatAppearanceSettings(
    settings?.nativeChatAppearance
  )
  const maxWidthPx = width === 'wide' ? 960 : width === 'full' ? Number.POSITIVE_INFINITY : 736
  const columnWidthPx = Math.min(
    measuredColumnWidthPx && measuredColumnWidthPx > 0
      ? measuredColumnWidthPx
      : width === 'wide'
        ? 960
        : 736,
    maxWidthPx
  )
  return {
    '--chat-font-size': `${fontSize}px`,
    '--chat-code-font-size': `${codeFontSize}px`,
    '--chat-content-max-width': width === 'full' ? 'none' : width === 'wide' ? '60rem' : '46rem',
    '--chat-secondary-font-size': `${fontSize - 2}px`,
    '--chat-inline-code-ratio': `${codeFontSize / fontSize}em`,
    '--chat-estimated-line-height': (22 * fontSize) / 14,
    '--chat-estimated-chars-per-line': Math.max(1, (((96 * columnWidthPx) / 736) * 14) / fontSize)
  }
}

export function useNativeChatAppearanceStyle(
  settings: Pick<GlobalSettings, 'nativeChatAppearance'> | null | undefined
): NativeChatAppearanceStyle {
  return nativeChatAppearanceStyle(settings)
}
