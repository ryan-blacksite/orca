// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getDefaultSettings } from '../../../../shared/constants'
import { ChatSettingsSection } from './ChatSettingsSection'
import { ActiveSettingsSectionProvider } from './SettingsSection'
import { getChatAppearanceSearchEntries } from './chat-appearance-search'
import { buildSettingsNavigationMetadata } from '@/hooks/useSettingsNavigationMetadata'
import { buildCmdJSettingsResults } from '../cmd-j/palette-results'
import { isSettingsNavigationTarget } from '@/lib/settings-navigation-types'
import { getSettingsSectionId, getSettingsScrollTarget } from './settings-navigation-foundations'

const state = vi.hoisted(() => ({ settingsSearchQuery: '' }))
vi.mock('../../store', () => ({
  useAppStore: (selector: (value: typeof state) => unknown) => selector(state)
}))

afterEach(cleanup)
beforeEach(() => {
  state.settingsSearchQuery = ''
})

function renderChat(enabled: boolean | undefined) {
  const updateSettings = vi.fn()
  const settings = { ...getDefaultSettings('/tmp'), experimentalStructuredNativeChat: enabled }
  const element = (active = 'chat') => (
    <ActiveSettingsSectionProvider value={active}>
      <ChatSettingsSection
        settings={settings}
        updateSettings={updateSettings}
        searchEntries={getChatAppearanceSearchEntries()}
        isMounted
      />
    </ActiveSettingsSectionProvider>
  )
  return { ...render(element()), element, updateSettings }
}

describe('Chat settings page', () => {
  it.each([false, undefined])('is absent with structured chat set to %s', (enabled) => {
    const { container } = renderChat(enabled)
    expect(container.querySelector('#chat')).toBeNull()
    expect(container.querySelector('[data-native-chat-appearance-preview]')).toBeNull()
  })

  it('renders the existing controls under Appearance and writes the same settings', () => {
    const { container, updateSettings } = renderChat(true)
    expect(screen.getByRole('heading', { name: 'Chat', level: 2 })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Appearance', level: 3 })).toBeTruthy()
    expect(container.querySelector('[data-native-chat-appearance-preview]')).toBeTruthy()
    expect(container.querySelector('button[aria-controls="appearance-section-chat"]')).toBeNull()
    expect(screen.getByRole('switch', { name: 'Match terminal interface' })).toBeTruthy()
    expect(screen.getByRole('slider', { name: 'Contrast' })).toBeTruthy()
    expect(screen.getByRole('spinbutton', { name: 'Text size' }).getAttribute('value')).toBe('14')
    expect(screen.getByRole('spinbutton', { name: 'Code text size' }).getAttribute('value')).toBe(
      '12'
    )
    expect(screen.getByRole('radio', { name: 'Comfortable' })).toBeTruthy()
    fireEvent.click(screen.getByRole('radio', { name: 'Wide' }))
    expect(updateSettings).toHaveBeenLastCalledWith({ nativeChatAppearance: { width: 'wide' } })
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }))
    expect(updateSettings).toHaveBeenLastCalledWith({ nativeChatAppearance: undefined })
  })

  it('unmounts the page when the opt-in is disabled while it is selected', () => {
    const { container, rerender } = renderChat(true)
    rerender(
      <ActiveSettingsSectionProvider value="chat">
        <ChatSettingsSection
          settings={{ ...getDefaultSettings('/tmp'), experimentalStructuredNativeChat: false }}
          updateSettings={vi.fn()}
          searchEntries={[]}
          isMounted
        />
      </ActiveSettingsSectionProvider>
    )
    expect(container.querySelector('#chat')).toBeNull()
  })

  it.each(['Chat', 'Appearance'])('shows every row for the %s heading search', (query) => {
    state.settingsSearchQuery = query
    renderChat(true)
    expect(screen.getByRole('spinbutton', { name: 'Text size' })).toBeTruthy()
    expect(screen.getByRole('spinbutton', { name: 'Code text size' })).toBeTruthy()
    expect(screen.getByRole('switch', { name: 'Match terminal interface' })).toBeTruthy()
    expect(screen.getByRole('slider', { name: 'Contrast' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Reset' })).toBeTruthy()
  })

  it('indexes Appearance and Preview on Chat without adding ambiguous palette rows', () => {
    const sections = buildSettingsNavigationMetadata({
      isMac: true,
      isWindows: false,
      isWebClient: false,
      experimentalStructuredNativeChat: true,
      repos: []
    })
    const results = buildCmdJSettingsResults(sections)
    expect(results.filter((entry) => entry.title === 'Appearance')).toHaveLength(1)
    const chatResults = results.filter((entry) => entry.sectionId === 'chat')
    expect(chatResults.map((entry) => entry.title)).not.toContain('Appearance')
    expect(chatResults.map((entry) => entry.title)).not.toContain('Preview')
    expect(chatResults.find((entry) => !entry.targetSectionId)?.configKeywords).toEqual(
      expect.arrayContaining(['appearance', 'preview'])
    )
  })

  it('searches a moved row and resolves its deep link within the Chat page', () => {
    state.settingsSearchQuery = 'Code text size'
    const { container, element, rerender } = renderChat(true)
    expect(screen.queryByRole('spinbutton', { name: 'Text size' })).toBeNull()
    expect(screen.getByRole('spinbutton', { name: 'Code text size' })).toBeTruthy()
    const sections = buildSettingsNavigationMetadata({
      isMac: true,
      isWindows: false,
      isWebClient: false,
      experimentalStructuredNativeChat: true,
      repos: []
    })
    const result = buildCmdJSettingsResults(sections).find(
      (entry) => entry.sectionId === 'chat' && entry.title === 'Code text size'
    )
    expect(result?.targetSectionId).toBe('chat-code-text-size')
    const target = { pane: 'chat', repoId: null, sectionId: result?.targetSectionId } as const
    expect(isSettingsNavigationTarget(target)).toBe(true)
    expect(getSettingsSectionId(target.pane, target.repoId, new Map())).toBe('chat')
    expect(getSettingsScrollTarget(target.sectionId ?? '', container)?.querySelector('input')).toBe(
      screen.getByRole('spinbutton', { name: 'Code text size' })
    )
    rerender(element('appearance'))
    expect(container.querySelector('#chat')).toBeNull()
    state.settingsSearchQuery = ''
    rerender(element())
    expect(
      container.querySelector('#chat-preview [data-native-chat-appearance-preview]')
    ).toBeTruthy()
    for (const entry of getChatAppearanceSearchEntries().filter((entry) => entry.targetSectionId)) {
      expect(getSettingsScrollTarget(entry.targetSectionId ?? '', container)).toBeTruthy()
    }
  })
})
