import { Fragment, type SyntheticEvent } from 'react'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import { translate } from '@/i18n/i18n'
import { MessageRow } from './NativeChatMessageRow'
import { NativeChatWorkingStatus } from './NativeChatWorkingStatus'
import { NativeChatDisclosureContext } from './native-chat-disclosure-store'
import { nativeChatAppearanceStyle } from './native-chat-appearance-style'
import { NATIVE_CHAT_APPEARANCE_SAMPLE } from './native-chat-appearance-sample'

function blockPreviewInteraction(event: SyntheticEvent): void {
  event.preventDefault()
  event.stopPropagation()
}

function ignoreScroll(): void {}

export function NativeChatAppearancePreview({
  settings
}: {
  settings: GlobalSettings
}): React.JSX.Element {
  return (
    <div className="my-3 overflow-hidden rounded-xl border border-border/50">
      <div className="border-b border-border/50 bg-background px-3 py-1.5 text-[11px] text-muted-foreground">
        {translate('settings.appearance.chat.preview', 'Preview')}
      </div>
      <div
        data-native-chat-appearance-preview
        className="native-chat-appearance h-[380px] overflow-hidden bg-chat-canvas text-chat-foreground"
        style={nativeChatAppearanceStyle(settings)}
        inert
        onClickCapture={blockPreviewInteraction}
        onAuxClickCapture={blockPreviewInteraction}
        onKeyDownCapture={blockPreviewInteraction}
        onContextMenuCapture={blockPreviewInteraction}
      >
        <NativeChatDisclosureContext.Provider value={null}>
          <div className="mx-auto flex w-full max-w-[var(--chat-content-max-width)] flex-col gap-5 p-4">
            {NATIVE_CHAT_APPEARANCE_SAMPLE.map((message, index) => (
              <Fragment key={message.id}>
                {index === 1 ? (
                  <NativeChatWorkingStatus
                    startedAt={null}
                    workedSeconds={12}
                    onToggleExpanded={ignoreScroll}
                  />
                ) : null}
                <MessageRow
                  message={message}
                  expandSignal={false}
                  toolRunExpandOverride
                  onScrollMessageToTop={ignoreScroll}
                />
              </Fragment>
            ))}
          </div>
        </NativeChatDisclosureContext.Provider>
      </div>
    </div>
  )
}
