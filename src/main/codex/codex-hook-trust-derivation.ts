import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runProcess } from '../../shared/child-process/run-process'
import { withCliRuntimeOnPath } from '../codex-cli/command'
import { CODEX_SHORT_LIVED_PROBE_APP_SERVER_ARGS } from '../codex-cli/codex-read-only-app-server-args'
import { collectListedHooks, type CodexListedHook } from './codex-app-server-client'
import {
  isCodexAppServerUnsupportedError,
  runCodexAppServerSession
} from './codex-app-server-session'
import { buildCodexManagedHook, CODEX_EVENTS, CODEX_EVENT_LABEL } from './codex-hook-definition'
import {
  normalizeHookTrustKeyForLookup,
  upsertProjectTrustLevelInContent,
  type CodexEventLabel
} from './config-toml-trust'

/**
 * Codex's hash per event it lists Orca's entry in; null for a listed event on a
 * Codex with no hook approvals (before 0.129). An unlisted event gets no entry.
 */
export type CodexHookHashes = Readonly<Partial<Record<CodexEventLabel, string | null>>>

export type CodexHookTrustDerivation =
  | { codexVersion: string; hashes: CodexHookHashes; failure: null; transient: false }
  | { codexVersion: string | null; hashes: null; failure: string; transient: boolean }

const VERSION_TIMEOUT_MS = 5_000
// Why longer off the launch path: macOS assesses a new codex on its first run, measured at 10-12 s.
const DERIVE_VERSION_TIMEOUT_MS = 30_000
// Why: an app-server start with a cold sqlite takes ~4 s; this bounds a hung binary.
const DERIVE_TIMEOUT_MS = 30_000
// Why a second group: the copy after it shows whether Codex's hash depends on position.
const SCRATCH_DUMMY_HOOK = { type: 'command', command: 'exit 0' }
const SCRATCH_ORCA_GROUP_INDEXES = [0, 2] as const

export type CodexHookScratchListing = {
  listings: CodexListedHook[]
  homeHooksPath: string
  projectHooksPath: string
}

/**
 * Asks one Codex binary for its hash of Orca's entry in each event, from a
 * throwaway CODEX_HOME. The same entry is listed at group 0, after another
 * group, and from a trusted project folder; Codex must hash all three alike,
 * so the answer holds for every home. Never throws; never reads or writes a real home.
 */
export async function deriveCodexHookHashes(
  codexPath: string,
  hookCommand: string,
  knownVersion?: string
): Promise<CodexHookTrustDerivation> {
  let codexVersion: string | null = knownVersion ?? null
  const failed = (failure: string, transient = false): CodexHookTrustDerivation => ({
    codexVersion,
    hashes: null,
    failure,
    transient
  })
  try {
    if (!codexVersion) {
      const probe = await probeCodexVersion(codexPath, DERIVE_VERSION_TIMEOUT_MS)
      codexVersion = probe.version
      if (!codexVersion) {
        return failed(`${codexPath} did not report its version`, probe.timedOut)
      }
    }
    let hashes = readCodexHookHashes(
      await listScratchHomeHooks(codexPath, hookCommand),
      hookCommand
    )
    if (hashes === 'inconsistent') {
      // Why once more: the copies come from different config layers, so confirm before refusing.
      hashes = readCodexHookHashes(await listScratchHomeHooks(codexPath, hookCommand), hookCommand)
    }
    if (hashes === 'inconsistent') {
      return failed(
        `${describeCodexVersion(codexVersion)} hashes Orca's status hook differently by its file or position, so Orca does not approve it`
      )
    }
    if (!hashes) {
      return failed(`${describeCodexVersion(codexVersion)} did not recognize Orca's status hook`)
    }
    return { codexVersion, hashes, failure: null, transient: false }
  } catch (error) {
    if (isCodexAppServerUnsupportedError(error)) {
      return failed(
        `${codexVersion ? describeCodexVersion(codexVersion) : codexPath} is too old for Orca status; update Codex`
      )
    }
    console.warn('[codex-hook-trust] could not derive Codex hook hashes:', error)
    return failed(error instanceof Error ? error.message : String(error), isTransient(error))
  }
}

// Why only these: a codex without the app-server, or one that exits early, would fail the same way every time.
function isTransient(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'CodexAppServerTimeoutError' ||
      ('syscall' in error && typeof error.syscall === 'string'))
  )
}

/** Orca's entry in every event: alone in group 0 and, with `positionCopy`, again after a dummy group. */
export function buildScratchHooksJson(hookCommand: string, positionCopy: boolean): string {
  const hooks = Object.fromEntries(
    CODEX_EVENTS.map((eventName) => {
      const orca = { hooks: [buildCodexManagedHook(hookCommand, eventName)] }
      return [eventName, positionCopy ? [orca, { hooks: [SCRATCH_DUMMY_HOOK] }, orca] : [orca]]
    })
  )
  return `${JSON.stringify({ hooks }, null, 2)}\n`
}

/** `hooks/list` for `codexHome`, or the default home when it is null; it changes no hook or config file. */
export async function listCodexHooks(
  codexPath: string,
  codexHome: string | null,
  cwd: string
): Promise<CodexListedHook[]> {
  const result = await runCodexAppServerSession(
    {
      command: codexPath,
      // Why the probe args: plugin startup can leave marketplace clones behind a short session.
      args: [...CODEX_SHORT_LIVED_PROBE_APP_SERVER_ARGS],
      cliPath: codexPath,
      ...(codexHome ? { env: { CODEX_HOME: codexHome } } : { envToDelete: ['CODEX_HOME'] }),
      timeoutMs: DERIVE_TIMEOUT_MS
    },
    (rpc) => rpc.request('hooks/list', { cwds: [cwd] })
  )
  return collectListedHooks(result)
}

async function listScratchHomeHooks(
  codexPath: string,
  hookCommand: string
): Promise<CodexHookScratchListing> {
  const root = await mkdtemp(join(tmpdir(), 'orca-codex-hook-trust-'))
  try {
    // Why resolved: Codex keys hooks and project trust by the real path (macOS /var is /private/var).
    const resolvedRoot = await realpath(root)
    const scratchHome = join(resolvedRoot, 'home')
    const project = join(resolvedRoot, 'project')
    await mkdir(join(project, '.codex'), { recursive: true })
    await mkdir(scratchHome)
    await writeFile(join(scratchHome, 'hooks.json'), buildScratchHooksJson(hookCommand, true))
    await writeFile(
      join(project, '.codex', 'hooks.json'),
      buildScratchHooksJson(hookCommand, false)
    )
    await writeFile(
      join(scratchHome, 'config.toml'),
      upsertProjectTrustLevelInContent('', project, 'trusted')
    )
    return {
      listings: await listCodexHooks(codexPath, scratchHome, project),
      homeHooksPath: join(scratchHome, 'hooks.json'),
      projectHooksPath: join(project, '.codex', 'hooks.json')
    }
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 3 }).catch(() => {})
  }
}

/**
 * Codex's hash per event it lists Orca's scratch entry at group 0 for;
 * 'inconsistent' when a copy elsewhere hashes differently, null when none is
 * listed. Only the scratch files count, never a hook from another source.
 */
export function readCodexHookHashes(
  scratch: CodexHookScratchListing,
  hookCommand: string
): CodexHookHashes | 'inconsistent' | null {
  const byKey = new Map(
    scratch.listings
      .filter((listing) => listing.command === hookCommand)
      .map((listing) => [normalizeHookTrustKeyForLookup(listing.key), listing])
  )
  const listed = (sourcePath: string, label: CodexEventLabel, groupIndex: number) =>
    byKey.get(normalizeHookTrustKeyForLookup(`${sourcePath}:${label}:${groupIndex}:0`))
  const hashes: Partial<Record<CodexEventLabel, string | null>> = {}
  for (const eventName of CODEX_EVENTS) {
    const label = CODEX_EVENT_LABEL[eventName]
    const primary = listed(scratch.homeHooksPath, label, SCRATCH_ORCA_GROUP_INDEXES[0])
    if (!primary) {
      continue
    }
    const copies = [
      listed(scratch.homeHooksPath, label, SCRATCH_ORCA_GROUP_INDEXES[1]),
      listed(scratch.projectHooksPath, label, 0)
    ]
    if (copies.some((copy) => copy && copy.currentHash !== primary.currentHash)) {
      return 'inconsistent'
    }
    hashes[label] = primary.currentHash
  }
  const labels = Object.keys(hashes)
  if (labels.length === 0) {
    return null
  }
  // Why drop hash-less events when others have one: on a Codex with approvals they would wait for review.
  return Object.values(hashes).some((hash) => hash !== null)
    ? Object.fromEntries(Object.entries(hashes).filter(([, hash]) => hash !== null))
    : hashes
}

/** "Codex 0.150.1" for `codex --version`'s "codex-cli 0.150.1"; other output as it is. */
export function describeCodexVersion(codexVersion: string): string {
  return codexVersion.replace(/^codex-cli\s+/, 'Codex ')
}

export async function probeCodexVersion(
  codexCommand: string,
  timeoutMs = VERSION_TIMEOUT_MS
): Promise<{ version: string | null; timedOut: boolean }> {
  // Why a throwaway home: even `--version` leaves a tmp/arg0 folder in its CODEX_HOME.
  const scratchHome = await mkdtemp(join(tmpdir(), 'orca-codex-version-'))
  try {
    const result = await runProcess({
      program: codexCommand,
      args: ['--version'],
      env: withCliRuntimeOnPath(codexCommand, { ...process.env, CODEX_HOME: scratchHome }),
      timeoutMs
    })
    const version = result.code === 0 ? result.stdout.trim() : ''
    return { version: version || null, timedOut: result.timedOut === true }
  } finally {
    await rm(scratchHome, { recursive: true, force: true, maxRetries: 3 }).catch(() => {})
  }
}
