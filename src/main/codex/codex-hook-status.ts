import { existsSync, readFileSync } from 'node:fs'
import type { AgentHookInstallState, AgentHookInstallStatus } from '../../shared/agent-hook-types'
import { readHooksJson, type HooksConfig } from '../agent-hooks/installer-utils'
import {
  assertLoadableHookTrustConfig,
  computeTrustKey,
  getCodexExplicitHomeHookSourcePath,
  isCodexConfigTomlRefusedError,
  readHookTrustEntries,
  upsertHookTrustEntriesInContent,
  type CodexHookTrustState,
  type CodexTrustEntry
} from './config-toml-trust'
import {
  buildCodexManagedHook,
  CODEX_EVENTS,
  CODEX_EVENT_LABEL,
  getCodexConfigTomlPath,
  getConfigPath,
  getManagedCommand,
  getManagedScriptPath
} from './codex-hook-definition'
import type { CodexHookTrustAnswer } from './codex-hook-trust-memo'
import { isDefinitiveCodexHookAnswer, readKnownCodexHookAnswer } from './codex-hook-hash-lookup'
import { resolveCodexHookStatusHome } from './codex-hook-reconcile'
import {
  getRealHomeConfigTomlPath,
  getRealHomeHookKeySourcePaths,
  getRealHomeHooksJsonPath,
  readRealHomeHooksFileShapeProblem
} from './codex-real-home-hooks-json'

type CodexHookStatusHome = {
  hooksJsonPath: string
  tomlPath: string
  /** Every path Codex may key this home's entries by. */
  keySourcePaths: readonly string[]
}

type Slot = { groupIndex: number; handlerIndex: number }

/**
 * Status for `runtimeHomePath`, or for the home the next native pane gets when
 * none is named (~/.codex outside the app), against what Codex last answered.
 */
export function readCurrentCodexHookStatus(runtimeHomePath?: string): AgentHookInstallStatus {
  const answer = readKnownCodexHookAnswer()
  if (runtimeHomePath !== undefined) {
    return readCodexHookHomeStatus(runtimeHomePath, answer)
  }
  const home = resolveCodexHookStatusHome()
  if (home.kind === 'unknown') {
    return {
      agent: 'codex',
      state: 'error',
      configPath: getRealHomeHooksJsonPath(),
      managedHooksPresent: false,
      detail: "The selected Codex account's home is not available yet"
    }
  }
  if (home.kind === 'real') {
    return readRealHomeCodexHookStatus(answer)
  }
  const status = readCodexHookHomeStatus(home.path, answer)
  const problem = home.realHomeSelected ? readRealHomeHooksFileShapeProblem() : null
  // Why say it: panes moved to Orca's own Codex home because ~/.codex could not take the hook.
  return problem
    ? {
        ...status,
        detail: [`${problem}; Orca's panes use Orca's own Codex home`, status.detail]
          .filter(Boolean)
          .join('; ')
      }
    : status
}

/** Status for a managed home, read from its files. */
export function readCodexHookHomeStatus(
  runtimeHomePath: string,
  answer: CodexHookTrustAnswer | null
): AgentHookInstallStatus {
  const hooksJsonPath = getConfigPath(runtimeHomePath)
  return readHomeStatus(
    {
      hooksJsonPath,
      tomlPath: getCodexConfigTomlPath(runtimeHomePath),
      keySourcePaths: [getCodexExplicitHomeHookSourcePath(hooksJsonPath)]
    },
    answer
  )
}

/** Status for ~/.codex, under either spelling Codex keys it by. */
export function readRealHomeCodexHookStatus(
  answer: CodexHookTrustAnswer | null
): AgentHookInstallStatus {
  const home: CodexHookStatusHome = {
    hooksJsonPath: getRealHomeHooksJsonPath(),
    tomlPath: getRealHomeConfigTomlPath(),
    keySourcePaths: getRealHomeHookKeySourcePaths()
  }
  const status = readHomeStatus(home, answer)
  if (status.state === 'installed' || status.state === 'error') {
    return status
  }
  const inline = describeInlineApprovals(home, answer)
  // Why no re-route for it: Orca's own home mirrors the same inline approvals and fails the same way.
  return inline ? { ...status, detail: inline } : status
}

/**
 * Codex hook status for one home, read from its files: Orca's entry in each
 * event Codex lists, and that entry's approval holding Codex's own hash under
 * any spelling Codex may key the file by. Without Codex's answer, the reason.
 */
function readHomeStatus(
  home: CodexHookStatusHome,
  answer: CodexHookTrustAnswer | null
): AgentHookInstallStatus {
  const configPath = home.hooksJsonPath
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
  const slots = readOrcaSlots(config.hooks, command)
  if (!answer?.hashes) {
    const reason = answer?.failure ?? 'Orca has not asked Codex yet'
    if (slots.size === 0) {
      return status('not_installed', false, reason)
    }
    if (isDefinitiveCodexHookAnswer(answer)) {
      return status('partial', true, `Orca's hook entry is installed, but ${reason}`)
    }
    // Why not an error: until Codex answers, the approval is the home's earlier one or Orca's own hash.
    return readsApprovedSlots(home, slots, command)
      ? status('installed', true, `Approved by Orca; not yet confirmed by Codex (${reason})`)
      : status('partial', true, `Orca's hook entry is not approved yet (${reason})`)
  }
  // Why: an unreadable config.toml is distinct from an absent one (an empty map).
  let trustStates: ReadonlyMap<string, CodexHookTrustState>
  let trustReadError: string | null = null
  try {
    trustStates = readHookTrustEntries(home.tomlPath)
  } catch (error) {
    trustStates = new Map()
    trustReadError = error instanceof Error ? error.message : String(error)
  }
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
    const approved = home.keySourcePaths.some((sourcePath) => {
      const state = trustStates.get(
        computeTrustKey({ sourcePath, eventLabel: label, command, ...slot })
      )
      return state !== undefined && state.trustedHash === hash && state.enabled !== false
    })
    if (trustReadError === null && !approved) {
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

function readOrcaSlots(
  hooks: HooksConfig['hooks'],
  command: string
): Map<(typeof CODEX_EVENTS)[number], Slot> {
  return new Map(
    CODEX_EVENTS.flatMap((eventName) => {
      const definitions = Array.isArray(hooks?.[eventName]) ? hooks[eventName] : []
      const slot = definitions.flatMap((definition, groupIndex) =>
        (definition.hooks ?? []).flatMap((hook, handlerIndex) =>
          hook.command === command ? [{ groupIndex, handlerIndex }] : []
        )
      )[0]
      return slot ? [[eventName, slot] as const] : []
    })
  )
}

function readsApprovedSlots(
  home: CodexHookStatusHome,
  slots: ReadonlyMap<(typeof CODEX_EVENTS)[number], Slot>,
  command: string
): boolean {
  let trustStates: ReadonlyMap<string, CodexHookTrustState>
  try {
    trustStates = readHookTrustEntries(home.tomlPath)
  } catch {
    return false
  }
  return [...slots].every(([eventName, slot]) =>
    home.keySourcePaths.some((sourcePath) => {
      const state = trustStates.get(
        computeTrustKey({ sourcePath, eventLabel: CODEX_EVENT_LABEL[eventName], command, ...slot })
      )
      return Boolean(state?.trustedHash) && state?.enabled !== false
    })
  )
}

/**
 * Why Orca's approvals are missing, when it is config.toml's inline approvals:
 * adding Orca's own there would leave a file Codex cannot load. Read now.
 */
function describeInlineApprovals(
  home: CodexHookStatusHome,
  answer: CodexHookTrustAnswer | null
): string | null {
  if (!existsSync(home.tomlPath)) {
    return null
  }
  const command = getManagedCommand(getManagedScriptPath())
  const hooks = readHooksJson(home.hooksJsonPath)?.hooks
  const slots = readOrcaSlots(hooks, command)
  const probes: CodexTrustEntry[] = CODEX_EVENTS.flatMap((eventName) => {
    const label = CODEX_EVENT_LABEL[eventName]
    const hash = answer?.hashes ? answer.hashes[label] : 'probe'
    const definitions = hooks?.[eventName]
    const slot = slots.get(eventName) ?? {
      groupIndex: Array.isArray(definitions) ? definitions.length : 0,
      handlerIndex: 0
    }
    return typeof hash === 'string'
      ? [
          {
            sourcePath: home.keySourcePaths[0]!,
            eventLabel: label,
            command,
            timeoutSec: buildCodexManagedHook(command, eventName).timeout,
            trustedHash: hash,
            enabled: true,
            ...slot
          }
        ]
      : []
  })
  try {
    const previous = readFileSync(home.tomlPath, 'utf-8')
    assertLoadableHookTrustConfig(
      home.tomlPath,
      previous,
      upsertHookTrustEntriesInContent(previous, probes)
    )
    return null
  } catch (error) {
    return isCodexConfigTomlRefusedError(error)
      ? `${home.tomlPath} keeps hook approvals inline, so Orca cannot add its own there; Orca shows no status for ~/.codex until they are tables`
      : null
  }
}
