import type { GlobalSettings } from '../../../../shared/global-settings-types'

export type AppearanceChatSectionProps = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
  forceVisiblePrimary?: boolean
}

export function AppearanceChatSection(_props: AppearanceChatSectionProps): React.JSX.Element {
  return <div className="divide-y divide-border/40" />
}
