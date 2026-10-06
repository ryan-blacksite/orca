// @vitest-environment happy-dom
import type { ComponentProps } from 'react'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Slider } from '../ui/slider'
import { createGlobalSettingsFixture } from '../../../../shared/global-settings-test-fixture'
import { nativeChatAppearanceStyle } from '../native-chat/native-chat-appearance-style'
import { AppearanceChatSection } from './AppearanceChatSection'

const mock = vi.hoisted(
  (): { state: { settingsSearchQuery: string; settings: GlobalSettings | null } } => ({
    state: { settingsSearchQuery: '', settings: null }
  })
)
vi.mock('../../store', () => ({
  useAppStore: Object.assign(
    (selector: (state: typeof mock.state) => unknown) => selector(mock.state),
    { getState: () => mock.state }
  )
}))
vi.mock('../ui/slider', () => ({
  Slider: ({ value, onValueChange, onValueCommit }: ComponentProps<typeof Slider>) => (
    <input
      aria-label="Contrast"
      type="range"
      min={50}
      max={150}
      value={value?.[0]}
      onChange={(event) => onValueChange?.([Number(event.target.value)])}
      onPointerUp={(event) => onValueCommit?.([Number(event.currentTarget.value)])}
    />
  )
}))
afterEach(() => {
  cleanup()
  mock.state.settings = null
})

function persistInMock(settings: GlobalSettings) {
  mock.state.settings = settings
  return vi.fn(async (updates: Partial<GlobalSettings>) => {
    const current = mock.state.settings
    if (current) {
      mock.state.settings = { ...current, ...updates }
    }
  })
}

describe('contrast drag persistence', () => {
  it('updates the displayed draft during dragging and saves once on commit', async () => {
    const settings = createGlobalSettingsFixture()
    const updateSettings = persistInMock(settings)
    const { container, rerender } = render(
      <AppearanceChatSection settings={settings} updateSettings={updateSettings} />
    )
    const slider = screen.getByRole('slider', { name: 'Contrast' })
    const preview = container.querySelector<HTMLElement>('[data-native-chat-appearance-preview]')
    expect(preview).not.toBeNull()
    for (const value of [110, 120, 130]) {
      await act(async () => {
        fireEvent.change(slider, { target: { value } })
      })
      expect(screen.getByText(String(value))).toBeTruthy()
      expect(preview?.style.getPropertyValue('--chat-foreground-mix')).toBe(
        nativeChatAppearanceStyle({ ...settings, nativeChatAppearance: { contrast: value } })[
          '--chat-foreground-mix'
        ]
      )
      expect(updateSettings).not.toHaveBeenCalled()
      expect(settings.nativeChatAppearance).toBeUndefined()
    }
    fireEvent.pointerUp(slider)
    await waitFor(() => {
      expect(updateSettings).toHaveBeenCalledExactlyOnceWith({
        nativeChatAppearance: { contrast: 130 }
      })
      expect(mock.state.settings?.nativeChatAppearance?.contrast).toBe(130)
    })
    const mix = preview?.style.getPropertyValue('--chat-foreground-mix')
    rerender(
      <AppearanceChatSection
        settings={mock.state.settings ?? settings}
        updateSettings={updateSettings}
      />
    )
    expect(preview?.style.getPropertyValue('--chat-foreground-mix')).toBe(mix)
    expect(screen.getByRole('slider')).toBe(slider)
  })

  it('resets the draft when settings are changed externally', () => {
    const settings = createGlobalSettingsFixture()
    const updateSettings = persistInMock(settings)
    const { container, rerender } = render(
      <AppearanceChatSection settings={settings} updateSettings={updateSettings} />
    )
    fireEvent.change(screen.getByRole('slider'), { target: { value: 130 } })
    rerender(
      <AppearanceChatSection
        settings={{ ...settings, nativeChatAppearance: { contrast: 80 } }}
        updateSettings={updateSettings}
      />
    )
    expect(screen.getByRole('slider').getAttribute('value')).toBe('80')
    expect(screen.getByText('80')).toBeTruthy()
    expect(
      container
        .querySelector<HTMLElement>('[data-native-chat-appearance-preview]')
        ?.style.getPropertyValue('--chat-foreground-mix')
    ).toBe(
      nativeChatAppearanceStyle({ ...settings, nativeChatAppearance: { contrast: 80 } })[
        '--chat-foreground-mix'
      ]
    )
    expect(updateSettings).not.toHaveBeenCalled()
  })

  it('clears an uncommitted draft on reset without rewriting the saved default', async () => {
    const settings = createGlobalSettingsFixture()
    const updateSettings = persistInMock(settings)
    const { container } = render(
      <AppearanceChatSection settings={settings} updateSettings={updateSettings} />
    )
    const preview = container.querySelector<HTMLElement>('[data-native-chat-appearance-preview]')
    const initialMix = preview?.style.getPropertyValue('--chat-foreground-mix')
    fireEvent.change(screen.getByRole('slider'), { target: { value: 130 } })
    expect(preview?.style.getPropertyValue('--chat-foreground-mix')).not.toBe(initialMix)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Reset' }))
    })
    expect(screen.getByRole('slider').getAttribute('value')).toBe('100')
    expect(preview?.style.getPropertyValue('--chat-foreground-mix')).toBe(initialMix)
    expect(updateSettings).not.toHaveBeenCalled()
  })
})
