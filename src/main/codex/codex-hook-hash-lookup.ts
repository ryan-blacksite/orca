import { dedupeInFlightRun } from '../in-flight-run-dedupe'
import { resolveCodexCommand } from '../codex-cli/command'
import { getManagedCommand, getManagedScriptPath } from './codex-hook-definition'
import { deriveCodexHookHashes, probeCodexVersion } from './codex-hook-trust-derivation'
import {
  fingerprintCodex,
  forgetCodexHookTrust,
  memoizeCodexHookTrust,
  MISSING_CODEX_FINGERPRINT,
  readMemoizedCodexHookTrust,
  readMemoizedVersionHashes,
  readPersistedCodexHookFailure,
  readProcessCodexHookTrust,
  _internals as memoInternals,
  type CodexHookTrustAnswer
} from './codex-hook-trust-memo'

// Why bounded: a Codex launch waits only briefly, never for a cold derivation.
export const CODEX_HOOK_LAUNCH_WAIT_MS = 3_000
// Why retried soon: a timeout at a loaded boot must not cost status until a restart.
const TRANSIENT_FAILURE_RETRY_MS = 60_000

const derivations = new Map<string, Promise<CodexHookTrustAnswer>>()
const transientFailures = new Map<string, { retryAt: number; answer: CodexHookTrustAnswer }>()
// Why off by default: only the app's main process may spawn Codex; the CLI's reads the memo.
let mayAskCodex = false
let pathReady: Promise<unknown> = Promise.resolve()
let hashResolverForTesting: (() => Promise<CodexHookTrustAnswer>) | null = null
let latestAnswer: CodexHookTrustAnswer | null = null

/**
 * App start, main process only: lets lookups ask Codex once the shell PATH is
 * hydrated, and asks right then when hooks are on, so the first managed
 * launch usually finds the answer ready.
 */
export function startCodexHookHashLookup(options: {
  pathReady: Promise<unknown>
  isEnabled: () => boolean
}): void {
  mayAskCodex = true
  pathReady = options.pathReady.catch(() => {})
  void pathReady.then(() => (options.isEnabled() ? resolveCodexHookHashes() : undefined))
}

/**
 * Codex's hashes for Orca's entry from `codexPath`: from this process's memo,
 * else asked of Codex (its version first, then a throwaway `hooks/list` for a
 * new version) when `mayAsk`. Never throws; one question per binary at a time.
 */
export function lookupCodexHookHashes(
  codexPath: string,
  command: string,
  mayAsk: boolean
): Promise<CodexHookTrustAnswer> {
  const fingerprint = fingerprintCodex(codexPath)
  if (fingerprint === MISSING_CODEX_FINGERPRINT) {
    // Why transient and unremembered: a PATH still hydrating, or an install in progress, fixes it.
    return Promise.resolve({
      codexVersion: null,
      hashes: null,
      failure: `Orca could not find Codex at ${codexPath}`,
      transient: true
    })
  }
  const known = readProcessCodexHookTrust(codexPath, command, fingerprint)
  if (known) {
    return Promise.resolve(known)
  }
  if (!mayAsk) {
    return Promise.resolve(
      readMemoizedCodexHookTrust(codexPath, command, fingerprint) ?? {
        codexVersion: null,
        hashes: null,
        failure: 'Orca has not asked Codex yet'
      }
    )
  }
  const transient = transientFailures.get(fingerprint)
  if (transient && transient.retryAt > Date.now()) {
    return Promise.resolve(transient.answer)
  }
  return dedupeInFlightRun(derivations, fingerprint, () =>
    askCodexForHookHashes(codexPath, command, fingerprint)
  )
}

async function askCodexForHookHashes(
  codexPath: string,
  command: string,
  fingerprint: string
): Promise<CodexHookTrustAnswer> {
  try {
    // Why re-probe a persisted binary: a shim's bytes stay the same when the codex behind it updates.
    const probe = await probeCodexVersion(codexPath, 30_000)
    if (!probe.version) {
      // Why held back even when it exits fast: the same bytes fail the same way, and a
      // PATH hydrating at boot can fix it, so retry after the window, not on every spawn.
      return rememberTransient(fingerprint, {
        codexVersion: null,
        hashes: null,
        failure: `${codexPath} did not report its version`
      })
    }
    const failure = readPersistedCodexHookFailure(codexPath, fingerprint, probe.version)
    const answer: CodexHookTrustAnswer & { transient?: boolean } = failure
      ? { codexVersion: probe.version, hashes: null, failure }
      : (readMemoizedVersionHashes(probe.version, command) ??
        (await deriveCodexHookHashes(codexPath, command, probe.version)))
    if (answer.transient) {
      return rememberTransient(fingerprint, answer)
    }
    transientFailures.delete(fingerprint)
    memoizeCodexHookTrust(codexPath, fingerprint, command, answer)
    return answer
  } catch (error) {
    return rememberTransient(fingerprint, {
      codexVersion: null,
      hashes: null,
      failure: error instanceof Error ? error.message : String(error)
    })
  }
}

function rememberTransient(
  fingerprint: string,
  answer: CodexHookTrustAnswer
): CodexHookTrustAnswer {
  const remembered = answer.hashes ? answer : { ...answer, transient: true }
  transientFailures.set(fingerprint, {
    retryAt: Date.now() + TRANSIENT_FAILURE_RETRY_MS,
    answer: remembered
  })
  return remembered
}

/** Codex's hashes for Orca's entry from the codex on PATH; asks Codex only in the app. Never throws. */
export async function resolveCodexHookHashes(): Promise<CodexHookTrustAnswer> {
  if (!hashResolverForTesting) {
    // Why wait for PATH: before it is hydrated, the codex a pane runs may not be found yet.
    await pathReady
  }
  latestAnswer = await (hashResolverForTesting?.() ??
    lookupCodexHookHashes(
      resolveCodexCommand(),
      getManagedCommand(getManagedScriptPath()),
      mayAskCodex
    ))
  return latestAnswer
}

/** For status, without asking: this process's latest answer with hashes, else what the memo holds. */
export function readKnownCodexHookAnswer(): CodexHookTrustAnswer | null {
  if (latestAnswer?.hashes) {
    return latestAnswer
  }
  return (
    readMemoizedCodexHookTrust(resolveCodexCommand(), getManagedCommand(getManagedScriptPath())) ??
    latestAnswer
  )
}

/** The answer for a launch, waiting at most `waitMs` for one not known yet; null when none came in time. */
export async function resolveCodexHookAnswerForLaunch(
  waitMs: number
): Promise<CodexHookTrustAnswer | null> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const result = await Promise.race([
    resolveCodexHookHashes(),
    new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), waitMs)
    })
  ])
  clearTimeout(timer)
  return result
}

/** Whether Codex itself answered: only then may an answer without hashes take Orca's entry away. */
export function isDefinitiveCodexHookAnswer(answer: CodexHookTrustAnswer | null): boolean {
  return (
    answer !== null &&
    answer.codexVersion !== null &&
    (answer.hashes !== null || answer.transient !== true)
  )
}

/** Hooks turned off: the next lookup asks Codex afresh. Never throws. */
export function forgetCodexHookAnswer(): void {
  latestAnswer = null
  transientFailures.clear()
  forgetCodexHookTrust(resolveCodexCommand())
}

export const _internals = {
  resetForTesting(): void {
    derivations.clear()
    transientFailures.clear()
    mayAskCodex = false
    pathReady = Promise.resolve()
    hashResolverForTesting = null
    latestAnswer = null
    memoInternals.resetForTesting()
  },
  /** Stands in for asking a real Codex; null restores the real lookup. */
  setHashResolverForTesting(resolver: (() => Promise<CodexHookTrustAnswer>) | null): void {
    hashResolverForTesting = resolver
  }
}
