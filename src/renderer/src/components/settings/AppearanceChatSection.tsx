import { useState } from 'react'
import {
  normalizeNativeChatAppearanceSettings,
  resetNativeChatAppearanceSettings,
  resolveNativeChatAppearanceSettings,
  type NativeChatAppearanceSettings
} from '../../../../shared/native-chat-appearance-settings'
import { useAppStore } from '../../store'
import { formatPrimaryShortcutLabel } from '@/hooks/useShortcutLabel'
import { translate } from '@/i18n/i18n'
import { AppearanceChatContrastControls } from './AppearanceChatContrastControls'
import { Button } from '../ui/button'
import { SearchableSetting } from './SearchableSetting'
import { NumberField, SettingsRow, SettingsSegmentedControl } from './SettingsFormControls'
import { getChatAppearanceEntriesByKey, getChatWidthOptions } from './chat-appearance-search'
import { writeNativeChatAppearance } from '../native-chat/native-chat-appearance-write'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import { NativeChatAppearancePreview } from '../native-chat/NativeChatAppearancePreview'

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
  const [contrastDraft, setContrastDraft] = useState({
    savedContrast: appearance.contrast,
    value: appearance.contrast
  })
  // Reconcile external changes without remounting the focused slider thumb.
  if (contrastDraft.savedContrast !== appearance.contrast) {
    setContrastDraft({ savedContrast: appearance.contrast, value: appearance.contrast })
  }
  const previewSettings =
    contrastDraft.value === appearance.contrast
      ? settings
      : {
          ...settings,
          nativeChatAppearance: {
            ...settings.nativeChatAppearance,
            contrast: contrastDraft.value
          }
        }
  const keybindings = useAppStore((state) => state.keybindings)
  const increase = formatPrimaryShortcutLabel('zoom.in', keybindings)
  const decrease = formatPrimaryShortcutLabel('zoom.out', keybindings)
  const entries = getChatAppearanceEntriesByKey({ increase, decrease })
  const update = (updates: NativeChatAppearanceSettings): void => {
    void writeNativeChatAppearance(
      (current) => normalizeNativeChatAppearanceSettings({ ...current, ...updates }),
      updateSettings
    )
  }
  return (
    <div className="divide-y divide-border/40">
      <NativeChatAppearancePreview settings={previewSettings} />
      <AppearanceChatContrastControls
        appearance={appearance}
        contrastDraft={contrastDraft.value}
        onContrastDraftChange={(value) =>
          setContrastDraft({ savedContrast: appearance.contrast, value })
        }
        onChange={update}
        forceVisiblePrimary={forceVisiblePrimary}
      />
      <SearchableSetting {...entries.textSize} forceVisible={forceVisiblePrimary}>
        <NumberField
          label={entries.textSize.title}
          description={entries.textSize.description}
          value={appearance.fontSize}
          defaultValue={14}
          min={12}
          max={20}
          integer
          suffix={translate('settings.appearance.chat.pixels', 'px')}
          onChange={(fontSize) => update({ fontSize })}
        />
      </SearchableSetting>
      <SearchableSetting {...entries.codeTextSize} forceVisible={forceVisiblePrimary}>
        <NumberField
          label={entries.codeTextSize.title}
          description={entries.codeTextSize.description}
          value={appearance.codeFontSize}
          defaultValue={12}
          min={10}
          max={18}
          integer
          suffix={translate('settings.appearance.chat.pixels', 'px')}
          onChange={(codeFontSize) => update({ codeFontSize })}
        />
      </SearchableSetting>
      <SearchableSetting {...entries.width} forceVisible={forceVisiblePrimary}>
        <SettingsRow
          label={entries.width.title}
          description={entries.width.description}
          control={
            <SettingsSegmentedControl
              value={appearance.width}
              onChange={(width) => update({ width })}
              options={getChatWidthOptions()}
              ariaLabel={entries.width.title}
            />
          }
        />
      </SearchableSetting>
      <SearchableSetting {...entries.reset} forceVisible={forceVisiblePrimary}>
        <SettingsRow
          label={entries.reset.title}
          description={entries.reset.description}
          control={
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setContrastDraft({ savedContrast: appearance.contrast, value: appearance.contrast })
                void writeNativeChatAppearance(resetNativeChatAppearanceSettings, updateSettings)
              }}
            >
              {translate('settings.appearance.chat.reset', 'Reset')}
            </Button>
          }
        />
      </SearchableSetting>
    </div>
  )
}
