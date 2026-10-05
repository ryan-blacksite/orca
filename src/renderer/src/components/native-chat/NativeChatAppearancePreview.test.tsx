// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getDefaultSettings } from '../../../../shared/constants'
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

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function previewRoot(container: HTMLElement): HTMLElement {
  const root = container.querySelector<HTMLElement>('[data-native-chat-appearance-preview]')
  if (!root) {
    throw new Error('Expected the chat appearance preview')
  }
  return root
}

describe('NativeChatAppearancePreview', () => {
  it('renders real message, tool and code rows without a session or renderer bridge', () => {
    vi.stubGlobal('api', undefined)
    const { container } = render(
      <NativeChatAppearancePreview settings={getDefaultSettings('/tmp')} />
    )

    expect(screen.getByText('Preview')).toBeInTheDocument()
    expect(screen.getByText(/exit right after it starts on Windows/)).toBeInTheDocument()
    expect(screen.getByText('Worked for 12s')).toBeInTheDocument()
    expect(container.querySelector('[data-native-chat-tool-run-state="settled"]')).not.toBeNull()
    expect(screen.getByText('package.json')).toBeInTheDocument()
    expect(container.querySelector('[data-native-chat-code-content]')).toHaveTextContent(
      'node --env-file=.env.development scripts/dev.mjs'
    )
    expect(screen.getByText(/No other script uses the old form/)).toBeInTheDocument()
    expect(previewRoot(container)).toHaveClass('h-[380px]', 'overflow-hidden')
    expect(previewRoot(container)).toHaveClass(NATIVE_CHAT_APPEARANCE_ROOT_CLASS)
    const outer = previewRoot(container).firstElementChild
    expect(outer).toHaveClass(NATIVE_CHAT_TRANSCRIPT_OUTER_CLASS)
    expect(outer?.firstElementChild).toHaveClass(NATIVE_CHAT_TRANSCRIPT_COLUMN_CLASS)
    expect(screen.getByText('Worked for 12s').closest('button')).toHaveAttribute(
      'aria-expanded',
      'true'
    )
    const code = container.querySelector('[data-native-chat-code-content]')
    const tools = container.querySelector('[data-native-chat-tool-run-state]')
    expect(
      code && tools && code.compareDocumentPosition(tools) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  })

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
