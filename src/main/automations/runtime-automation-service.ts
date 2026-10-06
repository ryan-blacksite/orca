/**
 * The AutomationService a runtime host executes schedules with. Shared by Electron startup and
 * orcad so both hosts dispatch through the same headless path.
 */
import type { ClaudeUsageStore } from '../claude-usage/store'
import type { CodexUsageStore } from '../codex-usage/store'
import type { Store } from '../persistence'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import { AutomationService } from './service'
import {
  getTuiAgentDetectCommands,
  isTuiAgent,
  TUI_AGENT_CONFIG
} from '../../shared/tui-agent-config'
import { buildHeadlessAutomationWorktreeCreateArgs } from './headless-workspace-create'
import { createRuntimeAutomationRunTerminalObserver } from './runtime-terminal-run-observer'

const MAX_REMEMBERED_LAUNCHES = 256

export function createRuntimeAutomationService(input: {
  store: Store
  runtime: OrcaRuntimeService
  claudeUsage?: ClaudeUsageStore
  codexUsage?: CodexUsageStore
  /** A server process: it executes remote_host_service-owned schedules and dispatches headlessly. */
  headless: boolean
}): AutomationService {
  const { store, runtime, claudeUsage, codexUsage } = input
  // The handle each headless launch returned, so its watcher never depends on a pane-key lookup.
  const launchedHandles = new Map<string, string>()
  const observer = createRuntimeAutomationRunTerminalObserver(runtime, {
    getAgentStatusRowsForPane: (paneKey) => runtime.getAgentStatusRowsForPane(paneKey),
    agentCommandsForRun: (run) =>
      automationAgentCommands(
        store.listAutomations().find((entry) => entry.id === run.automationId)?.agentId
      )
  })
  const service = new AutomationService(store, {
    claudeUsage,
    codexUsage,
    terminalObserver: {
      ...observer,
      resolveRunTerminal: (run) =>
        observer.resolveRunTerminal(run) ??
        (run.terminalPaneKey ? (launchedHandles.get(run.terminalPaneKey) ?? null) : null)
    },
    onAutomationsChanged: (payload) => runtime.notifyAutomationsChanged(payload),
    allowRemoteHostScheduling: input.headless,
    headlessDispatcher: input.headless
      ? async ({ automation, run, target }) => {
          let terminalHandle: string
          let terminalSessionId: string | null = null
          let terminalPaneKey: string | null = null
          let terminalPtyId: string | null = null
          let workspaceId: string
          let workspaceDisplayName: string | null = null
          if (automation.workspaceMode === 'new_per_run') {
            const created = await runtime.createManagedWorktree(
              buildHeadlessAutomationWorktreeCreateArgs({ automation, run, repo: target.repo })
            )
            terminalHandle = created.startupTerminal?.handle ?? ''
            terminalSessionId = created.startupTerminal?.tabId ?? null
            terminalPaneKey = created.startupTerminal?.paneKey ?? null
            terminalPtyId = created.startupTerminal?.ptyId ?? null
            workspaceId = created.worktree.id
            workspaceDisplayName = created.worktree.displayName ?? null
            if (!terminalHandle) {
              throw new Error(
                created.warning ||
                  'Automation workspace was created, but no agent terminal started.'
              )
            }
          } else {
            if (!automation.workspaceId) {
              throw new Error('The target workspace is no longer available.')
            }
            const terminal = await runtime.launchAgentTerminal(`id:${automation.workspaceId}`, {
              agent: automation.agentId,
              prompt: automation.prompt,
              title: run.title
            })
            terminalHandle = terminal.handle
            terminalSessionId = terminal.tabId ?? null
            terminalPaneKey = terminal.paneKey ?? null
            terminalPtyId = terminal.ptyId ?? null
            workspaceId = terminal.worktreeId
            const worktree = await runtime.showManagedWorktree(`id:${workspaceId}`)
            workspaceDisplayName = worktree.displayName ?? null
          }
          if (terminalPaneKey) {
            launchedHandles.set(terminalPaneKey, terminalHandle)
            if (launchedHandles.size > MAX_REMEMBERED_LAUNCHES) {
              launchedHandles.delete(launchedHandles.keys().next().value ?? '')
            }
          }
          // No completion: the run's watcher observes it, retrying wait timeouts until it settles.
          return {
            workspaceId,
            workspaceDisplayName,
            terminalSessionId,
            terminalPaneKey,
            terminalPtyId
          }
        }
      : undefined
  })
  runtime.setAutomationService(service)
  return service
}

function automationAgentCommands(agentId: string | undefined): string[] {
  if (!isTuiAgent(agentId)) {
    return []
  }
  const config = TUI_AGENT_CONFIG[agentId]
  return [...getTuiAgentDetectCommands(config), config.launchCmd]
}
