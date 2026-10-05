import {
  normalizeNativeChatAppearanceSettings,
  resolveNativeChatAppearanceSettings,
  type NativeChatAppearanceSettings
} from '../../../../shared/native-chat-appearance-settings'
import { translate } from '@/i18n/i18n'
import { Button } from '../ui/button'
import { SearchableSetting } from './SearchableSetting'
import { NumberField, SettingsRow, SettingsSegmentedControl } from './SettingsFormControls'
import { getChatAppearanceSearchEntries, getChatWidthOptions } from './chat-appearance-search'
import type { GlobalSettings } from '../../../../shared/global-settings-types'

export type AppearanceChatSectionProps = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
  forceVisiblePrimary?: boolean
}

export function AppearanceChatSection({
  settings,
  updateSettings,
  forceVisiblePrimary = false
}: AppearanceChatSectionProps): React.JSX.Element {
  const appearance = resolveNativeChatAppearanceSettings(settings.nativeChatAppearance)
  const entries = getChatAppearanceSearchEntries()
  const update = (updates: NativeChatAppearanceSettings): void => {
    updateSettings({
      nativeChatAppearance: normalizeNativeChatAppearanceSettings({
        ...settings.nativeChatAppearance,
        ...updates
      })
    })
  }
  return (
    <div className="divide-y divide-border/40">
      {entries.slice(0, 2).map((entry, index) => (
        <SearchableSetting key={entry.title} {...entry} forceVisible={forceVisiblePrimary}>
          <NumberField
            label={entry.title}
            description={`${entry.description} ${
              index === 0
                ? translate('settings.appearance.chat.defaultTextSize', 'Default: 14px')
                : translate('settings.appearance.chat.defaultCodeTextSize', 'Default: 12px')
            }`}
            value={index === 0 ? appearance.fontSize : appearance.codeFontSize}
            min={index === 0 ? 12 : 10}
            max={index === 0 ? 20 : 18}
            integer
            suffix={translate('settings.appearance.chat.pixels', 'px')}
            onChange={(value) =>
              update(index === 0 ? { fontSize: value } : { codeFontSize: value })
            }
          />
        </SearchableSetting>
      ))}
      <SearchableSetting {...entries[2]} forceVisible={forceVisiblePrimary}>
        <SettingsRow
          label={entries[2].title}
          description={entries[2].description}
          control={
            <SettingsSegmentedControl
              value={appearance.width}
              onChange={(width) => update({ width })}
              options={getChatWidthOptions()}
              ariaLabel={entries[2].title}
            />
          }
        />
      </SearchableSetting>
      <SearchableSetting {...entries[3]} forceVisible={forceVisiblePrimary}>
        <SettingsRow
          label={entries[3].title}
          description={entries[3].description}
          control={
            <Button
              variant="outline"
              size="sm"
              onClick={() => updateSettings({ nativeChatAppearance: undefined })}
            >
              {translate('settings.appearance.chat.reset', 'Reset')}
            </Button>
          }
        />
      </SearchableSetting>
    </div>
  )
}
