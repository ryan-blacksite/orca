// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatAppearanceSettings } from '../../../../shared/native-chat-appearance-settings'

const mocks = vi.hoisted(() => {
  const settings: { nativeChatAppearance?: NativeChatAppearanceSettings } = {}
  const updateSettings = vi.fn(async (updates: typeof settings) => {
    Object.assign(settings, updates)
  })
  return { settings, updateSettings }
})
vi.mock('../../store', () => ({ useAppStore: { getState: () => mocks } }))
import { useNativeChatFontScale } from './use-native-chat-font-scale'
import { isMacPlatform } from './native-chat-shortcut'

function key(key: string, target: EventTarget = window): void {
  target.dispatchEvent(
    new KeyboardEvent('keydown', {
      key,
      bubbles: true,
      cancelable: true,
      metaKey: isMacPlatform(),
      ctrlKey: !isMacPlatform()
    })
  )
}
afterEach(() => {
  cleanup()
  delete mocks.settings.nativeChatAppearance
  mocks.updateSettings.mockClear()
})

describe('persisted chat font-size shortcuts', () => {
  it('serializes quick repeats against the latest stored size, clamps, and resets only text size', async () => {
    mocks.settings.nativeChatAppearance = { fontSize: 19, codeFontSize: 16, width: 'wide' }
    renderHook(() => useNativeChatFontScale(true))
    act(() => {
      key('+')
      key('+')
      key('-')
    })
    await waitFor(() => expect(mocks.updateSettings).toHaveBeenCalledTimes(3))
    expect(mocks.settings.nativeChatAppearance).toEqual({
      fontSize: 19,
      codeFontSize: 16,
      width: 'wide'
    })
    act(() => key('0'))
    await waitFor(() =>
      expect(mocks.settings.nativeChatAppearance).toEqual({ codeFontSize: 16, width: 'wide' })
    )
  })
  it('writes an absent object on reset and ignores inactive panes', async () => {
    const { rerender } = renderHook(({ enabled }) => useNativeChatFontScale(enabled), {
      initialProps: { enabled: false }
    })
    key('+')
    expect(mocks.updateSettings).not.toHaveBeenCalled()
    rerender({ enabled: true })
    key('-')
    await waitFor(() => expect(mocks.settings.nativeChatAppearance).toEqual({ fontSize: 13 }))
    key('0')
    await waitFor(() => expect(mocks.settings.nativeChatAppearance).toBeUndefined())
  })
  it('only handles keys originating in its chat root', async () => {
    const root = document.createElement('div')
    const input = document.createElement('input')
    root.append(input)
    document.body.append(root)
    renderHook(() => useNativeChatFontScale(true, { current: root }))
    key('+')
    expect(mocks.updateSettings).not.toHaveBeenCalled()
    key('+', input)
    await waitFor(() => expect(mocks.settings.nativeChatAppearance).toEqual({ fontSize: 15 }))
    root.remove()
  })
})
