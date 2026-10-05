import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type * as CodexCommand from '../codex-cli/command'
import type * as TrustDerivation from './codex-hook-trust-derivation'

const mocks = vi.hoisted(() => ({
  codexPath: '',
  probeCodexVersion: vi.fn(),
  deriveCodexHookHashes: vi.fn()
}))

vi.mock('../codex-cli/command', async (importOriginal) => ({
  ...(await importOriginal<typeof CodexCommand>()),
  resolveCodexCommand: () => mocks.codexPath
}))
vi.mock('./codex-hook-trust-derivation', async (importOriginal) => ({
  ...(await importOriginal<typeof TrustDerivation>()),
  probeCodexVersion: mocks.probeCodexVersion,
  deriveCodexHookHashes: mocks.deriveCodexHookHashes
}))

import {
  _internals,
  forgetCodexHookAnswer,
  readKnownCodexHookAnswer,
  resolveCodexHookAnswerForLaunch,
  resolveCodexHookHashes,
  startCodexHookHashLookup
} from './codex-hook-hash-lookup'
import { _internals as memoInternals, getCodexHookTrustMemoPath } from './codex-hook-trust-memo'
import { getManagedCommand, getManagedScriptPath } from './codex-hook-definition'

// Why this file: finding Codex's hash spawns Codex, so the lookup must ask at
// most once per binary at a time, hold a failure back for a while, and never
// ask outside the app.

let userData: string
const command = (): string => getManagedCommand(getManagedScriptPath())
const HASHES = { stop: 'sha256:stop' }

function allowAsking(): void {
  startCodexHookHashLookup({ pathReady: Promise.resolve(), isEnabled: () => false })
}

beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'orca-codex-hash-lookup-'))
  vi.stubEnv('ORCA_USER_DATA_PATH', userData)
  mocks.codexPath = join(userData, 'codex')
  writeFileSync(mocks.codexPath, 'codex 0.150.1')
  mocks.probeCodexVersion.mockResolvedValue({ version: 'codex-cli 0.150.1', timedOut: false })
  mocks.deriveCodexHookHashes.mockResolvedValue({
    codexVersion: 'codex-cli 0.150.1',
    hashes: HASHES,
    failure: null,
    transient: false
  })
  _internals.resetForTesting()
})

afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllEnvs()
  rmSync(userData, { recursive: true, force: true })
})

describe('what a lookup may spawn', () => {
  it('never asks Codex outside the app, reading only what the app learned', async () => {
    const answer = await resolveCodexHookHashes()

    expect(answer.failure).toBe('Orca has not asked Codex yet')
    expect(mocks.probeCodexVersion).not.toHaveBeenCalled()

    allowAsking()
    await resolveCodexHookHashes()
    // Why: a new process, as the CLI's is: it reads the file the app wrote.
    _internals.resetForTesting()
    expect((await resolveCodexHookHashes()).hashes).toEqual(HASHES)
    expect(mocks.probeCodexVersion).toHaveBeenCalledTimes(1)
  })

  it('asks once for concurrent callers, and holds a timed-out probe back for a while', async () => {
    allowAsking()
    mocks.probeCodexVersion.mockResolvedValue({ version: null, timedOut: true })

    await Promise.all([resolveCodexHookHashes(), resolveCodexHookHashes()])
    const held = await resolveCodexHookHashes()

    expect(mocks.probeCodexVersion).toHaveBeenCalledTimes(1)
    expect(held).toMatchObject({ hashes: null, transient: true })
  })

  it('spawns a fast-failing `codex --version` once for a burst of lookups', async () => {
    allowAsking()
    mocks.probeCodexVersion.mockResolvedValue({ version: null, timedOut: false })

    for (let lookup = 0; lookup < 5; lookup += 1) {
      await resolveCodexHookHashes()
    }

    expect(mocks.probeCodexVersion).toHaveBeenCalledTimes(1)
  })

  it('re-probes a persisted binary once per process, so a shim retarget gets the new version', async () => {
    allowAsking()
    await resolveCodexHookHashes()
    await resolveCodexHookHashes()
    expect(mocks.probeCodexVersion).toHaveBeenCalledTimes(1)
    // Why: a new process, the same shim bytes, a different codex behind them.
    _internals.resetForTesting()
    allowAsking()
    mocks.probeCodexVersion.mockResolvedValue({ version: 'codex-cli 0.160.0', timedOut: false })

    await resolveCodexHookHashes()

    expect(mocks.probeCodexVersion).toHaveBeenCalledTimes(2)
    expect(mocks.deriveCodexHookHashes).toHaveBeenLastCalledWith(
      mocks.codexPath,
      command(),
      'codex-cli 0.160.0'
    )
  })

  it("reuses a saved version's hashes for a new binary of that version, with no hooks/list", async () => {
    allowAsking()
    await resolveCodexHookHashes()
    writeFileSync(mocks.codexPath, 'codex 0.150.1, reinstalled')

    expect((await resolveCodexHookHashes()).hashes).toEqual(HASHES)
    expect(mocks.probeCodexVersion).toHaveBeenCalledTimes(2)
    expect(mocks.deriveCodexHookHashes).toHaveBeenCalledTimes(1)
  })

  it('keeps an in-process answer when the memo file cannot be saved', async () => {
    writeFileSync(getCodexHookTrustMemoPath(), '{}')
    chmodSync(userData, 0o500)
    try {
      allowAsking()
      await resolveCodexHookHashes()
      await resolveCodexHookHashes()
    } finally {
      chmodSync(userData, 0o700)
    }

    expect(mocks.probeCodexVersion).toHaveBeenCalledTimes(1)
  })

  it('treats a codex not found as temporary, and asks as soon as it appears', async () => {
    allowAsking()
    rmSync(mocks.codexPath)

    const missing = await resolveCodexHookHashes()

    expect(missing).toMatchObject({ codexVersion: null, hashes: null, transient: true })
    expect(missing.failure).toContain('could not find Codex')
    writeFileSync(mocks.codexPath, 'codex 0.150.1')
    expect((await resolveCodexHookHashes()).hashes).toEqual(HASHES)
    expect(mocks.probeCodexVersion).toHaveBeenCalledTimes(1)
  })

  it('asks Codex afresh after hooks are turned off', async () => {
    allowAsking()
    await resolveCodexHookHashes()

    forgetCodexHookAnswer()
    memoInternals.resetForTesting()
    await resolveCodexHookHashes()

    expect(mocks.deriveCodexHookHashes).toHaveBeenCalledTimes(2)
    expect(readKnownCodexHookAnswer()?.hashes).toEqual(HASHES)
  })
})

describe('when a lookup runs', () => {
  it('lets a launch go ahead without an answer that is still on its way', async () => {
    allowAsking()
    mocks.probeCodexVersion.mockImplementation(() => new Promise(() => {}))

    await expect(resolveCodexHookAnswerForLaunch(10)).resolves.toBeNull()
  })

  it('warms the answer at app start only once the shell PATH is hydrated', async () => {
    let hydrate: () => void = () => {}
    const pathReady = new Promise<void>((resolve) => {
      hydrate = resolve
    })

    startCodexHookHashLookup({ pathReady, isEnabled: () => true })
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(mocks.probeCodexVersion).not.toHaveBeenCalled()

    hydrate()
    await vi.waitFor(() => expect(readKnownCodexHookAnswer()?.hashes).toEqual(HASHES))
    expect(mocks.probeCodexVersion).toHaveBeenCalledTimes(1)
  })

  it('does not warm the answer while hooks are off', async () => {
    startCodexHookHashLookup({ pathReady: Promise.resolve(), isEnabled: () => false })
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(mocks.probeCodexVersion).not.toHaveBeenCalled()
  })

  it('makes a launch before PATH hydration wait for it, then ask', async () => {
    let hydrate: () => void = () => {}
    startCodexHookHashLookup({
      pathReady: new Promise<void>((resolve) => {
        hydrate = resolve
      }),
      isEnabled: () => false
    })

    const launch = resolveCodexHookAnswerForLaunch(5_000)
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(mocks.probeCodexVersion).not.toHaveBeenCalled()
    hydrate()

    expect((await launch)?.hashes).toEqual(HASHES)
  })
})
