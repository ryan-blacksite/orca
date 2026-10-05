import { describe, expect, it } from 'vitest'
import { nativeChatAppearanceStyle } from './native-chat-appearance-style'

describe('chat root appearance style', () => {
  it('provides default text, independent code size, and comfortable width', () => {
    expect(nativeChatAppearanceStyle(undefined)).toMatchObject({
      '--chat-font-size': '14px',
      '--chat-code-font-size': '12px',
      '--chat-content-max-width': '46rem',
      '--text-sm': '14px',
      '--text-xs': '12px'
    })
  })
  it('clamps sizes on read and derives the column width', () => {
    expect(
      nativeChatAppearanceStyle({
        nativeChatAppearance: { fontSize: 25, codeFontSize: 1, width: 'wide' }
      })
    ).toMatchObject({
      '--chat-font-size': '20px',
      '--chat-code-font-size': '10px',
      '--chat-content-max-width': '60rem'
    })
    expect(
      nativeChatAppearanceStyle({ nativeChatAppearance: { width: 'full' } })[
        '--chat-content-max-width'
      ]
    ).toBe('none')
  })
})
