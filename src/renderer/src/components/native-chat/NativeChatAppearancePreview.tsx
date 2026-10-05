import { Fragment, type SyntheticEvent } from 'react'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import { MessageRow } from './NativeChatMessageRow'
import { NativeChatWorkingStatus } from './NativeChatWorkingStatus'
import { NativeChatDisclosureContext } from './native-chat-disclosure-store'
import {
  NATIVE_CHAT_APPEARANCE_ROOT_CLASS,
  NATIVE_CHAT_TRANSCRIPT_OUTER_CLASS,
  NATIVE_CHAT_TRANSCRIPT_COLUMN_CLASS,
  useNativeChatAppearanceStyle
} from './native-chat-appearance-style'
import { NATIVE_CHAT_APPEARANCE_SAMPLE } from './native-chat-appearance-sample'

function blockPreviewInteraction(event: SyntheticEvent): void {
  event.preventDefault()
  event.stopPropagation()
}

function ignorePreviewAction(): void {}

export function NativeChatAppearancePreview({
  settings
}: {
  settings: GlobalSettings
}): React.JSX.Element {
  const appearanceStyle = useNativeChatAppearanceStyle(settings)
  return (
    <div className="my-3 overflow-hidden rounded-xl border border-border/50">
      <div className="border-b border-border/50 bg-background px-3 py-1.5 text-[11px] text-muted-foreground">
        {translate('settings.appearance.chat.preview', 'Preview')}
      </div>
      <div
        data-native-chat-appearance-preview
        className={cn(
          NATIVE_CHAT_APPEARANCE_ROOT_CLASS,
          'h-[380px] overflow-hidden text-chat-foreground'
        )}
        style={appearanceStyle}
        inert
        onClickCapture={blockPreviewInteraction}
        onAuxClickCapture={blockPreviewInteraction}
        onKeyDownCapture={blockPreviewInteraction}
        onContextMenuCapture={blockPreviewInteraction}
      >
        <NativeChatDisclosureContext.Provider value={null}>
          <div className={NATIVE_CHAT_TRANSCRIPT_OUTER_CLASS}>
            <div className={NATIVE_CHAT_TRANSCRIPT_COLUMN_CLASS}>
              {NATIVE_CHAT_APPEARANCE_SAMPLE.map((message, index) => (
                <Fragment key={message.id}>
                  {index === 1 ? (
                    <NativeChatWorkingStatus
                      startedAt={null}
                      workedSeconds={12}
                      expanded
                      onToggleExpanded={ignorePreviewAction}
                    />
                  ) : null}
                  <MessageRow
                    message={message}
                    expandSignal={false}
                    toolRunExpandOverride
                    onScrollMessageToTop={ignorePreviewAction}
                  />
                </Fragment>
              ))}
            </div>
          </div>
        </NativeChatDisclosureContext.Provider>
      </div>
    </div>
  )
}
