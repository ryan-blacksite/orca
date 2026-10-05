// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getDefaultSettings } from '../../../../shared/constants'
import { AppearanceChatSection } from './AppearanceChatSection'
import { getAppearancePaneSearchEntries } from './appearance-search'
import { matchesSettingsSearch } from './settings-search'

vi.mock('../../store', () => ({
  useAppStore: (selector: (state: { settingsSearchQuery: string }) => unknown) =>
    selector({ settingsSearchQuery: '' })
}))
afterEach(cleanup)

describe('chat appearance settings card', () => {
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
