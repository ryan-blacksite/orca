import { describe, it, expect } from 'vitest'
import { chatFontSizeActionForEvent, chatFontSizeForAction } from './native-chat-font-size'

type Combo = Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey'>

function combo(overrides: Partial<Combo>): Combo {
  return { key: '=', metaKey: false, ctrlKey: false, ...overrides }
}

describe('chatFontSizeForAction', () => {
  it('steps by one pixel and clamps at both limits', () => {
    expect(chatFontSizeForAction(undefined, 'increase')).toEqual({ fontSize: 15 })
    expect(chatFontSizeForAction({ fontSize: 20 }, 'increase')).toEqual({ fontSize: 20 })
    expect(chatFontSizeForAction({ fontSize: 12 }, 'decrease')).toEqual({ fontSize: 12 })
    expect(chatFontSizeForAction({ fontSize: 15 }, 'decrease')).toBeUndefined()
  })
  it('reset removes only text size and preserves code size and width', () => {
    expect(
      chatFontSizeForAction({ fontSize: 18, codeFontSize: 16, width: 'wide' }, 'reset')
    ).toEqual({ codeFontSize: 16, width: 'wide' })
    expect(chatFontSizeForAction({ fontSize: 18 }, 'reset')).toBeUndefined()
  })
})

describe('chatFontSizeActionForEvent', () => {
  it('maps Cmd+= to increase on Mac', () => {
    expect(chatFontSizeActionForEvent(combo({ key: '=', metaKey: true }), true)).toBe('increase')
  })

  it('maps Cmd++ (shifted equals) to increase on Mac', () => {
    expect(chatFontSizeActionForEvent(combo({ key: '+', metaKey: true }), true)).toBe('increase')
  })

  it('maps Cmd+- to decrease on Mac', () => {
    expect(chatFontSizeActionForEvent(combo({ key: '-', metaKey: true }), true)).toBe('decrease')
  })

  it('maps Cmd+0 to reset on Mac', () => {
    expect(chatFontSizeActionForEvent(combo({ key: '0', metaKey: true }), true)).toBe('reset')
  })

  it('maps Ctrl+= to increase on Windows/Linux', () => {
    expect(chatFontSizeActionForEvent(combo({ key: '=', ctrlKey: true }), false)).toBe('increase')
  })

  it('ignores the wrong primary modifier on Mac', () => {
    expect(chatFontSizeActionForEvent(combo({ key: '=', ctrlKey: true }), true)).toBeNull()
  })

  it('ignores Cmd+Ctrl chords', () => {
    expect(
      chatFontSizeActionForEvent(combo({ key: '=', metaKey: true, ctrlKey: true }), true)
    ).toBeNull()
  })

  it('returns null for an unrelated key', () => {
    expect(chatFontSizeActionForEvent(combo({ key: 'a', metaKey: true }), true)).toBeNull()
  })

  it('returns null without a primary modifier', () => {
    expect(chatFontSizeActionForEvent(combo({ key: '=' }), true)).toBeNull()
  })
})
