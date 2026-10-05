import type { AgentHookInstallState, AgentHookInstallStatus } from '../../shared/agent-hook-types'
import { readHooksJson } from '../agent-hooks/installer-utils'
import {
  computeTrustKey,
  getCodexExplicitHomeHookSourcePath,
  readHookTrustEntries,
  type CodexHookTrustState
} from './config-toml-trust'
import {
  CODEX_EVENTS,
  CODEX_EVENT_LABEL,
  getCodexConfigTomlPath,
  getConfigPath,
  getManagedCommand,
  getManagedScriptPath
} from './codex-hook-definition'
import type { CodexHookTrustAnswer } from './codex-hook-trust-memo'
import { isDefinitiveCodexHookAnswer } from './codex-hook-hash-lookup'

/**
 * Codex hook status for a managed home, read from its files: Orca's entry in
 * each event Codex lists, and that entry's approval holding Codex's own hash.
 * Without Codex's answer, the reason it is missing.
 */
export function readCodexHookHomeStatus(
  runtimeHomePath: string,
  answer: CodexHookTrustAnswer | null
): AgentHookInstallStatus {
  const configPath = getConfigPath(runtimeHomePath)
  const command = getManagedCommand(getManagedScriptPath())
  const status = (
    state: AgentHookInstallState,
    managedHooksPresent: boolean,
    detail: string | null
  ): AgentHookInstallStatus => ({ agent: 'codex', state, configPath, managedHooksPresent, detail })
  const config = readHooksJson(configPath)
  if (!config) {
    return status('error', false, 'Could not parse Codex hooks.json')
  }
  const slots = new Map(
    CODEX_EVENTS.flatMap((eventName) => {
      const definitions = Array.isArray(config.hooks?.[eventName]) ? config.hooks![eventName]! : []
      const slot = definitions.flatMap((definition, groupIndex) =>
        (definition.hooks ?? []).flatMap((hook, handlerIndex) =>
          hook.command === command ? [{ groupIndex, handlerIndex }] : []
        )
      )[0]
      return slot ? [[eventName, slot] as const] : []
    })
  )
  if (!answer?.hashes) {
    const reason = answer?.failure ?? 'Orca has not asked Codex yet'
    if (slots.size === 0) {
      return status('not_installed', false, reason)
    }
    if (isDefinitiveCodexHookAnswer(answer)) {
      return status('partial', true, `Orca's hook entry is installed, but ${reason}`)
    }
    // Why not an error: until Codex answers, the approval is the home's earlier one or Orca's own hash.
    return readsApprovedSlots(runtimeHomePath, slots, command)
      ? status('installed', true, `Approved by Orca; not yet confirmed by Codex (${reason})`)
      : status('partial', true, `Orca's hook entry is not approved yet (${reason})`)
  }
  // Why: an unreadable config.toml is distinct from an absent one (an empty map).
  let trustStates: ReadonlyMap<string, CodexHookTrustState>
  let trustReadError: string | null = null
  try {
    trustStates = readHookTrustEntries(getCodexConfigTomlPath(runtimeHomePath))
  } catch (error) {
    trustStates = new Map()
    trustReadError = error instanceof Error ? error.message : String(error)
  }
  const sourcePath = getCodexExplicitHomeHookSourcePath(configPath)
  const listedEvents = CODEX_EVENTS.filter(
    (eventName) => answer.hashes[CODEX_EVENT_LABEL[eventName]] !== undefined
  )
  const missing: string[] = []
  const unapproved: string[] = []
  for (const eventName of listedEvents) {
    const label = CODEX_EVENT_LABEL[eventName]
    const hash = answer.hashes[label]
    const slot = slots.get(eventName)
    if (!slot) {
      missing.push(eventName)
      continue
    }
    // Why null passes: that Codex lists the entry with no hash, so it runs unapproved.
    if (hash === null) {
      continue
    }
    const state = trustStates.get(
      computeTrustKey({ sourcePath, eventLabel: label, command, ...slot })
    )
    if (trustReadError === null && (state?.trustedHash !== hash || state?.enabled === false)) {
      unapproved.push(eventName)
    }
  }
  if (missing.length === listedEvents.length) {
    return status(
      'not_installed',
      false,
      trustReadError && `Trust entries unverifiable: ${trustReadError}`
    )
  }
  const parts = [
    missing.length > 0 ? `Managed hook missing for events: ${missing.join(', ')}` : null,
    trustReadError !== null
      ? `Trust entries unverifiable: ${trustReadError}`
      : unapproved.length > 0
        ? `Approval missing, stale or disabled for events: ${unapproved.join(', ')}`
        : null
  ].filter((part): part is string => part !== null)
  return parts.length === 0
    ? status('installed', true, null)
    : status('partial', true, parts.join('; '))
}

function readsApprovedSlots(
  runtimeHomePath: string,
  slots: ReadonlyMap<string, { groupIndex: number; handlerIndex: number }>,
  command: string
): boolean {
  let trustStates: ReadonlyMap<string, CodexHookTrustState>
  try {
    trustStates = readHookTrustEntries(getCodexConfigTomlPath(runtimeHomePath))
  } catch {
    return false
  }
  const sourcePath = getCodexExplicitHomeHookSourcePath(getConfigPath(runtimeHomePath))
  return [...slots].every(([eventName, slot]) => {
    const state = trustStates.get(
      computeTrustKey({
        sourcePath,
        eventLabel: CODEX_EVENT_LABEL[eventName],
        command,
        ...slot
      })
    )
    return Boolean(state?.trustedHash) && state?.enabled !== false
  })
}
