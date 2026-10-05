import type { NativeChatAppearanceSettings } from '../../../../shared/native-chat-appearance-settings'
import { getChatContrastEntriesByKey } from './chat-appearance-search'
import { translate } from '@/i18n/i18n'
import { Slider } from '../ui/slider'
import { SearchableSetting } from './SearchableSetting'
import { SettingsRow, SettingsSwitchRow } from './SettingsFormControls'

type ChatContrastControlsProps = {
  appearance: Required<NativeChatAppearanceSettings>
  contrastDraft: number
  onContrastDraftChange: (value: number) => void
  onChange: (updates: NativeChatAppearanceSettings) => void
  forceVisiblePrimary?: boolean
}

export function AppearanceChatContrastControls({
  appearance,
  contrastDraft,
  onContrastDraftChange,
  onChange,
  forceVisiblePrimary
}: ChatContrastControlsProps): React.JSX.Element {
  const entries = getChatContrastEntriesByKey()
  const { matchTerminalInterface: matching } = appearance
  return (
    <>
      <SearchableSetting {...entries.matchTerminalInterface} forceVisible={forceVisiblePrimary}>
        <SettingsSwitchRow
          label={entries.matchTerminalInterface.title}
          description={entries.matchTerminalInterface.description}
          checked={matching}
          onChange={() => onChange({ matchTerminalInterface: !matching })}
        />
      </SearchableSetting>
      <SearchableSetting {...entries.contrast} forceVisible={forceVisiblePrimary}>
        <SettingsRow
          label={entries.contrast.title}
          description={entries.contrast.description}
          control={
            <ChatContrastSlider
              contrastDraft={contrastDraft}
              onContrastDraftChange={onContrastDraftChange}
              onChange={onChange}
            />
          }
        />
      </SearchableSetting>
    </>
  )
}

function ChatContrastSlider({
  contrastDraft,
  onContrastDraftChange,
  onChange
}: Pick<
  ChatContrastControlsProps,
  'onChange' | 'contrastDraft' | 'onContrastDraftChange'
>): React.JSX.Element {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground">
        {translate('settings.appearance.chat.softer', 'Softer')}
      </span>
      <div className="w-40">
        <Slider
          min={50}
          max={150}
          step={1}
          value={[contrastDraft]}
          thumbLabels={[translate('settings.appearance.chat.contrast', 'Contrast')]}
          onValueChange={([value]) => onContrastDraftChange(value)}
          onValueCommit={([value]) => onChange({ contrast: value })}
        />
      </div>
      <span className="text-xs text-muted-foreground">
        {translate('settings.appearance.chat.sharper', 'Sharper')}
      </span>
      <span className="w-8 text-right text-xs text-muted-foreground tabular-nums">
        {contrastDraft}
      </span>
    </div>
  )
}
