// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getDefaultSettings } from '../../../../shared/constants'
import { i18n } from '@/i18n/i18n'
import { buildFontFamily } from '@/lib/monospace-font-family'
import { cn } from '@/lib/utils'
import { resolveConfiguredTerminalColors } from '../../../../shared/terminal-theme-selection'
import { resetSystemPrefersDarkSubscriptionForTests } from '../terminal-pane/use-system-prefers-dark'
import es from '@/i18n/locales/es.json'
import fr from '@/i18n/locales/fr.json'
import ja from '@/i18n/locales/ja.json'
import ko from '@/i18n/locales/ko.json'
import zh from '@/i18n/locales/zh.json'
import { NativeChatAppearancePreview } from './NativeChatAppearancePreview'
import { NativeChatDisclosureContext } from './native-chat-disclosure-store'
import {
  NATIVE_CHAT_APPEARANCE_ROOT_CLASS,
  NATIVE_CHAT_TRANSCRIPT_OUTER_CLASS,
  NATIVE_CHAT_TRANSCRIPT_COLUMN_CLASS
} from './native-chat-appearance-style'

const surroundingDisclosureStore = { read: vi.fn(), write: vi.fn() }

vi.mock('@/store', () => ({
  useAppStore: () => {
    throw new Error('The preview must not subscribe to application or session state')
  }
}))

afterEach(async () => {
  cleanup()
  resetSystemPrefersDarkSubscriptionForTests()
  vi.unstubAllGlobals()
  await i18n.changeLanguage('en')
})

function previewRoot(container: HTMLElement): HTMLElement {
  const root = container.querySelector<HTMLElement>('[data-native-chat-appearance-preview]')
  if (!root) {
    throw new Error('Expected the chat appearance preview')
  }
  return root
}

describe('NativeChatAppearancePreview', () => {
  it.each(Object.entries({ es, fr, ja, ko, zh }))(
    'updates the mounted sample prose to %s while preserving literal code and file names',
    async (locale, catalog) => {
      const { container } = render(
        <NativeChatAppearancePreview settings={getDefaultSettings('/tmp')} />
      )
      await act(async () => {
        await i18n.changeLanguage(locale)
      })
      const sample = catalog.settings.appearance.chat.previewSample
      for (const prose of Object.values(sample)) {
        expect(container).toHaveTextContent(prose.replace(/`|\*\*/g, ''))
      }
      expect(container).not.toHaveTextContent('Use Node instead of Unix-only syntax.')
      expect(container).toHaveTextContent('NODE_ENV=')
      expect(container).toHaveTextContent('scripts/')
      expect(container).toHaveTextContent('package.json')
      expect(container.querySelector('[data-native-chat-code-content]')).toHaveTextContent(
        'node --env-file=.env.development scripts/dev.mjs'
      )
    }
  )

  it.each([14, 17])(
    'renders the complete sample without reserved user metadata at %spx',
    (fontSize) => {
      vi.stubGlobal('api', undefined)
      const { container } = render(
        <NativeChatAppearancePreview
          settings={{ ...getDefaultSettings('/tmp'), nativeChatAppearance: { fontSize } }}
        />
      )
      expect(container.querySelector('#chat-preview')).toBeNull()

      expect(screen.getByText('Preview')).toBeInTheDocument()
      expect(screen.getByText(/exit right after it starts on Windows/)).toBeInTheDocument()
      expect(screen.getByText('Worked for 12s')).toBeInTheDocument()
      expect(container.querySelector('[data-native-chat-tool-run-state="settled"]')).not.toBeNull()
      expect(screen.getByText('package.json')).toBeInTheDocument()
      expect(container.querySelector('[data-native-chat-code-content]')).toHaveTextContent(
        'node --env-file=.env.development scripts/dev.mjs'
      )
      expect(screen.getByText(/Then run/)).toHaveTextContent('Then run pnpm dev again.')
      expect(previewRoot(container)).toHaveClass('h-[440px]', 'overflow-hidden')
      expect(previewRoot(container)).toHaveClass(NATIVE_CHAT_APPEARANCE_ROOT_CLASS)
      const outer = previewRoot(container).firstElementChild
      expect(outer).toHaveClass(cn(NATIVE_CHAT_TRANSCRIPT_OUTER_CLASS, 'py-3'))
      expect(outer?.firstElementChild).toHaveClass(cn(NATIVE_CHAT_TRANSCRIPT_COLUMN_CLASS, 'gap-2'))
      const userBubble = screen.getByText(/exit right after it starts on Windows/).closest('.group')
      expect(userBubble?.querySelector('time, button')).toBeNull()
      expect(userBubble?.children).toHaveLength(1)
      expect(screen.getByText('Worked for 12s').closest('button')).toHaveAttribute(
        'aria-expanded',
        'true'
      )
      const code = container.querySelector('[data-native-chat-code-content]')
      const tools = container.querySelector('[data-native-chat-tool-run-state]')
      expect(tools).toHaveTextContent('Searched 1 pattern, read 1 file')
      expect(tools).toHaveAttribute('aria-expanded', 'true')
      expect(tools?.nextElementSibling?.querySelectorAll('button')).toHaveLength(2)
      const intro = screen.getByText('Unix-only').closest('p')
      expect(
        intro && tools && intro.compareDocumentPosition(tools) & Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy()
      expect(
        code && tools && tools.compareDocumentPosition(code) & Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy()
    }
  )

  it('updates the shared chat styling when text size, code size and width change', () => {
    const settings = getDefaultSettings('/tmp')
    const { container, rerender } = render(<NativeChatAppearancePreview settings={settings} />)
    const root = previewRoot(container)
    expect(root.style.getPropertyValue('--chat-font-size')).toBe('14px')
    expect(root.style.getPropertyValue('--chat-code-font-size')).toBe('12px')
    expect(root.style.getPropertyValue('--chat-content-max-width')).toBe('46rem')

    rerender(
      <NativeChatAppearancePreview
        settings={{
          ...settings,
          nativeChatAppearance: { fontSize: 18, codeFontSize: 16, width: 'wide' }
        }}
      />
    )
    expect(root.style.getPropertyValue('--chat-font-size')).toBe('18px')
    expect(root.style.getPropertyValue('--chat-code-font-size')).toBe('16px')
    expect(root.style.getPropertyValue('--chat-content-max-width')).toBe('60rem')

    rerender(
      <NativeChatAppearancePreview
        settings={{ ...settings, nativeChatAppearance: { width: 'full' } }}
      />
    )
    expect(root.style.getPropertyValue('--chat-content-max-width')).toBe('none')
  })

  it('reflects contrast and live terminal colors and fonts, then removes matching overrides', () => {
    const settings = { ...getDefaultSettings('/tmp'), theme: 'dark' as const }
    const { container, rerender } = render(<NativeChatAppearancePreview settings={settings} />)
    const root = previewRoot(container)
    expect(root.style.getPropertyValue('--chat-foreground-mix')).toBe('78%')

    rerender(
      <NativeChatAppearancePreview
        settings={{
          ...settings,
          terminalFontFamily: 'Menlo',
          terminalColorOverrides: { background: '#122033', foreground: '#ddeeff' },
          nativeChatAppearance: { contrast: 150, matchTerminalInterface: true }
        }}
      />
    )
    expect(root.style.getPropertyValue('--chat-foreground-mix')).toBe('100%')
    expect(root.style.getPropertyValue('--chat-source-background')).toBe('#122033')
    expect(root.style.getPropertyValue('--chat-source-foreground')).toBe('#ddeeff')
    expect(root.style.getPropertyValue('--chat-font-family')).toBe(buildFontFamily('Menlo'))

    rerender(
      <NativeChatAppearancePreview
        settings={{
          ...settings,
          terminalFontFamily: 'Consolas',
          terminalColorOverrides: { background: '#ffffff', foreground: '#000000' },
          nativeChatAppearance: { contrast: 50, matchTerminalInterface: true }
        }}
      />
    )
    expect(root.style.getPropertyValue('--chat-foreground-mix')).toBe('64%')
    expect(root.style.getPropertyValue('--chat-source-background')).toBe('#ffffff')
    expect(root.style.getPropertyValue('--chat-source-foreground')).toBe('#000000')
    expect(root.style.getPropertyValue('--chat-font-family')).toBe(buildFontFamily('Consolas'))
    expect(root.style.getPropertyValue('--chat-code-font-family')).toBe(buildFontFamily('Consolas'))

    rerender(
      <NativeChatAppearancePreview
        settings={{
          ...settings,
          nativeChatAppearance: { contrast: 50, matchTerminalInterface: false }
        }}
      />
    )
    expect(root.style.getPropertyValue('--chat-foreground-mix')).toBe('56%')
    expect(root.style.getPropertyValue('--chat-source-background')).toBe('')
    expect(root.style.getPropertyValue('--chat-source-foreground')).toBe('')
    expect(root.style.getPropertyValue('--chat-font-family')).toBe('')
  })

  it('follows system light and dark changes through the shared hook without a settings rerender', () => {
    const media = Object.assign(new EventTarget(), {
      matches: true,
      media: '(prefers-color-scheme: dark)',
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn()
    })
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => media)
    )
    const settings = {
      ...getDefaultSettings('/tmp'),
      theme: 'system' as const,
      terminalUseSeparateLightTheme: true,
      terminalThemeLight: 'Builtin Tango Light',
      nativeChatAppearance: { matchTerminalInterface: true }
    }
    const { container } = render(<NativeChatAppearancePreview settings={settings} />)
    const root = previewRoot(container)
    const darkBackground = root.style.getPropertyValue('--chat-source-background')
    expect(darkBackground).toBe(resolveConfiguredTerminalColors(settings, true).background)

    act(() => {
      media.matches = false
      media.dispatchEvent(Object.assign(new Event('change'), { matches: false }))
    })
    expect(root.style.getPropertyValue('--chat-source-background')).toBe(
      resolveConfiguredTerminalColors(settings, false).background
    )
    expect(root.style.getPropertyValue('--chat-source-background')).not.toBe(darkBackground)
    expect(root.style.getPropertyValue('--chat-foreground-mix')).toBe('82%')

    act(() => {
      media.matches = true
      media.dispatchEvent(Object.assign(new Event('change'), { matches: true }))
    })
    expect(root.style.getPropertyValue('--chat-source-background')).toBe(darkBackground)
  })

  it('blocks sample controls without IPC or reads and writes to a surrounding session disclosure store', () => {
    const ipc = vi.fn(() => {
      throw new Error('The preview must not call IPC')
    })
    vi.stubGlobal('api', new Proxy({}, { get: ipc }))
    const { container } = render(
      <NativeChatDisclosureContext.Provider value={surroundingDisclosureStore}>
        <NativeChatAppearancePreview settings={getDefaultSettings('/tmp')} />
      </NativeChatDisclosureContext.Provider>
    )
    const root = previewRoot(container)
    expect(root).toHaveAttribute('inert')
    expect(root.querySelector('a')).toBeNull()
    for (const button of root.querySelectorAll('button')) {
      fireEvent.click(button)
      fireEvent.keyDown(button, { key: 'Enter' })
      fireEvent.contextMenu(button)
      fireEvent(button, new MouseEvent('auxclick', { bubbles: true }))
    }
    expect(root.querySelector('[data-native-chat-tool-run-state]')).toHaveAttribute(
      'aria-expanded',
      'true'
    )
    expect(ipc).not.toHaveBeenCalled()
    expect(surroundingDisclosureStore.read).not.toHaveBeenCalled()
    expect(surroundingDisclosureStore.write).not.toHaveBeenCalled()
  })
})
