// @vitest-environment happy-dom
import type { KeybindingOverrides } from '../../../../shared/keybindings'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getDefaultSettings } from '../../../../shared/constants'
import { AppearanceChatSection } from './AppearanceChatSection'
import { getChatAppearanceEntriesByKey } from './chat-appearance-search'
import { getAppearancePaneSearchEntries } from './appearance-search'
import { matchesSettingsSearch } from './settings-search'

const mocks = vi.hoisted(
  (): {
    state: { settingsSearchQuery: string; keybindings?: KeybindingOverrides }
    platform: NodeJS.Platform
  } => ({ state: { settingsSearchQuery: '' }, platform: 'linux' })
)

vi.mock('@/lib/shortcut-platform', () => ({ getShortcutPlatform: () => mocks.platform }))

vi.mock('../../store', () => ({
  useAppStore: (selector: (state: typeof mocks.state) => unknown) => selector(mocks.state)
}))
afterEach(() => {
  cleanup()
  mocks.state.keybindings = undefined
  mocks.platform = 'linux'
})

describe('chat appearance settings card', () => {
  it.each([
    { platform: 'darwin', increase: '⌘=', decrease: '⌘-' },
    { platform: 'win32', increase: 'Ctrl+=', decrease: 'Ctrl+-' },
    { platform: 'linux', increase: 'Ctrl+=', decrease: 'Ctrl+-' }
  ] as const)(
    'shows only the primary default zoom shortcuts on $platform',
    ({ platform, increase, decrease }) => {
      mocks.platform = platform
      render(
        <AppearanceChatSection settings={getDefaultSettings('/tmp')} updateSettings={vi.fn()} />
      )
      const description = `Messages, tool activity and the message box. ${increase} / ${decrease} in a chat change this too.`
      expect(screen.getByText(description)).toBeTruthy()
      expect(getChatAppearanceEntriesByKey().textSize.description).toBe(description)
    }
  )

  it.each([
    { platform: 'darwin', prefix: '⌘' },
    { platform: 'win32', prefix: 'Ctrl+' },
    { platform: 'linux', prefix: 'Ctrl+' }
  ] as const)(
    'shows only the first zoom bindings on $platform and updates after rebinding',
    ({ platform, prefix }) => {
      mocks.platform = platform
      mocks.state.keybindings = {
        'zoom.in': ['Mod+Y', 'Mod+Shift+Y'],
        'zoom.out': ['Mod+U', 'Mod+Alt+U']
      }
      const card = (
        <AppearanceChatSection settings={getDefaultSettings('/tmp')} updateSettings={vi.fn()} />
      )
      const { rerender } = render(card)
      expect(
        screen.getByText(
          `Messages, tool activity and the message box. ${prefix}Y / ${prefix}U in a chat change this too.`
        )
      ).toBeTruthy()
      mocks.state.keybindings = {
        'zoom.in': ['Mod+I', 'Mod+Shift+I'],
        'zoom.out': ['Mod+O', 'Mod+Alt+O']
      }
      rerender(
        <AppearanceChatSection settings={getDefaultSettings('/tmp')} updateSettings={vi.fn()} />
      )
      expect(
        screen.getByText(
          `Messages, tool activity and the message box. ${prefix}I / ${prefix}O in a chat change this too.`
        )
      ).toBeTruthy()
    }
  )

  it('uses derived defaults and writes overrides through the existing controls', () => {
    const updateSettings = vi.fn()
    render(
      <AppearanceChatSection
        settings={getDefaultSettings('/tmp')}
        updateSettings={updateSettings}
      />
    )
    const text = screen.getByRole('spinbutton', { name: 'Text size' })
    expect(text.getAttribute('value')).toBe('14')
    fireEvent.change(text, { target: { value: '30' } })
    fireEvent.blur(text)
    expect(updateSettings).toHaveBeenLastCalledWith({ nativeChatAppearance: { fontSize: 20 } })
    const code = screen.getByRole('spinbutton', { name: 'Code text size' })
    fireEvent.change(code, { target: { value: '16' } })
    fireEvent.keyDown(code, { key: 'Enter' })
    expect(updateSettings).toHaveBeenLastCalledWith({ nativeChatAppearance: { codeFontSize: 16 } })
    fireEvent.click(screen.getByRole('radio', { name: 'Full' }))
    expect(updateSettings).toHaveBeenLastCalledWith({ nativeChatAppearance: { width: 'full' } })
  })
  it('removes defaults while preserving other choices, and reset removes the entire object', () => {
    const updateSettings = vi.fn()
    const settings = {
      ...getDefaultSettings('/tmp'),
      nativeChatAppearance: { fontSize: 18, codeFontSize: 16, width: 'wide' as const }
    }
    render(<AppearanceChatSection settings={settings} updateSettings={updateSettings} />)
    const text = screen.getByRole('spinbutton', { name: 'Text size' })
    fireEvent.change(text, { target: { value: '14' } })
    fireEvent.blur(text)
    expect(updateSettings).toHaveBeenLastCalledWith({
      nativeChatAppearance: { codeFontSize: 16, width: 'wide' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }))
    expect(updateSettings).toHaveBeenLastCalledWith({ nativeChatAppearance: undefined })
  })
  it('indexes each row and width choice in Appearance settings search', () => {
    const entries = getAppearancePaneSearchEntries()
    for (const query of [
      'Chat',
      'Code text size',
      'tool output',
      'Comfortable',
      'Wide',
      'Full',
      'Reset chat appearance'
    ]) {
      expect(matchesSettingsSearch(query, entries), query).toBe(true)
    }
  })
})
