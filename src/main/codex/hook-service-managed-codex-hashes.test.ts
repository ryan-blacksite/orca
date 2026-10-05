import { describe, expect, it, vi } from 'vitest'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import type * as Os from 'node:os'
import { join } from 'node:path'
import { parse as parseToml } from 'smol-toml'
import type * as InstallerUtils from '../agent-hooks/installer-utils'
import { isCodexManagedCommand, setupCodexHookHomes } from './hook-service-test-harness'

const { getPathMock, homedirMock, hooks } = vi.hoisted(() => {
  const hooks: { beforeHooksJsonWrite: (() => void) | null } = { beforeHooksJsonWrite: null }
  return {
    getPathMock: vi.fn<(name: string) => string>(),
    homedirMock: vi.fn<() => string>(),
    hooks
  }
})

vi.mock('electron', () => ({ app: { getPath: getPathMock } }))
vi.mock('os', async (importOriginal) => ({
  ...(await importOriginal<typeof Os>()),
  homedir: homedirMock
}))
vi.mock('../agent-hooks/installer-utils', async (importOriginal) => {
  const actual = await importOriginal<typeof InstallerUtils>()
  return {
    ...actual,
    writeHooksJson: (...args: Parameters<typeof actual.writeHooksJson>) => {
      hooks.beforeHooksJsonWrite?.()
      return actual.writeHooksJson(...args)
    }
  }
})

import { CodexHookService } from './hook-service'
import { _internals as lookupInternals } from './codex-hook-hash-lookup'
import { fingerprintCodex, memoizeCodexHookTrust } from './codex-hook-trust-memo'
import type { CodexHookTrustAnswer } from './codex-hook-trust-memo'
import {
  computeTrustKey,
  getCodexExplicitHomeHookSourcePath,
  computeTrustedHash,
  readHookTrustEntries,
  upsertHookTrustEntries,
  type CodexEventLabel
} from './config-toml-trust'
import { getManagedCommand, getManagedScriptPath } from './codex-hook-definition'

// Why this file: a managed CODEX_HOME's approval for Orca's entry is Codex's
// own hash, not one Orca computes, and is written before the entry.

const homes = setupCodexHookHomes(homedirMock, getPathMock)

const CODEX_HASHES = {
  session_start: 'sha256:codex-session_start',
  user_prompt_submit: 'sha256:codex-user_prompt_submit',
  pre_tool_use: 'sha256:codex-pre_tool_use',
  permission_request: 'sha256:codex-permission_request',
  post_tool_use: 'sha256:codex-post_tool_use',
  stop: 'sha256:codex-stop'
}

function managedHome(): string {
  return join(homes.userDataDir, 'codex-runtime-home', 'home')
}

function managedKey(eventLabel: CodexEventLabel, groupIndex: number): string {
  return computeTrustKey({
    sourcePath: getCodexExplicitHomeHookSourcePath(join(managedHome(), 'hooks.json')),
    eventLabel,
    groupIndex,
    handlerIndex: 0,
    command: getManagedCommand(getManagedScriptPath())
  })
}

function seedSystemUserStopHook(): void {
  const systemHome = join(homes.tmpHome, '.codex')
  mkdirSync(systemHome, { recursive: true })
  writeFileSync(
    join(systemHome, 'hooks.json'),
    JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'user-stop.sh' }] }] } })
  )
  upsertHookTrustEntries(join(systemHome, 'config.toml'), [
    {
      sourcePath: join(systemHome, 'hooks.json'),
      eventLabel: 'stop',
      groupIndex: 0,
      handlerIndex: 0,
      command: 'user-stop.sh'
    }
  ])
}

function useAnswer(answer: CodexHookTrustAnswer): void {
  lookupInternals.setHashResolverForTesting(async () => answer)
}

function useCodexHashes(): void {
  useAnswer({ codexVersion: 'codex-cli 0.131.0', hashes: CODEX_HASHES, failure: null })
}

const command = (): string => getManagedCommand(getManagedScriptPath())

describe('managed-home Codex hook approval', () => {
  it("approves Orca's entry with Codex's hash, enabled, only in the events Codex lists", async () => {
    seedSystemUserStopHook()
    useCodexHashes()

    expect((await new CodexHookService().install()).state).toBe('installed')

    const runtimeHooks = JSON.parse(readFileSync(join(managedHome(), 'hooks.json'), 'utf-8')).hooks
    expect(Object.keys(runtimeHooks).sort()).toEqual(
      [
        'PermissionRequest',
        'PostToolUse',
        'PreToolUse',
        'SessionStart',
        'Stop',
        'UserPromptSubmit'
      ].sort()
    )
    expect(isCodexManagedCommand(runtimeHooks.Stop[0].hooks[0].command)).toBe(true)
    expect(runtimeHooks.Stop[1].hooks[0].command).toBe('user-stop.sh')
    const trust = readHookTrustEntries(join(managedHome(), 'config.toml'))
    expect(trust.get(managedKey('stop', 0))).toEqual({
      trustedHash: 'sha256:codex-stop',
      enabled: true
    })
    expect(trust.get(managedKey('subagent_start', 0))).toBeUndefined()
    // Why: the mirrored user hook moved behind Orca's group, and its approval with it.
    expect(
      trust.get(
        computeTrustKey({
          sourcePath: getCodexExplicitHomeHookSourcePath(join(managedHome(), 'hooks.json')),
          eventLabel: 'stop',
          groupIndex: 1,
          handlerIndex: 0,
          command: 'user-stop.sh'
        })
      )?.trustedHash
    ).toBeDefined()
  })

  it('writes the approval before the entry, and takes it back if the entry write fails', async () => {
    useCodexHashes()
    const approvedAtWrite: (string | undefined)[] = []
    hooks.beforeHooksJsonWrite = () => {
      approvedAtWrite.push(
        readHookTrustEntries(join(managedHome(), 'config.toml')).get(managedKey('stop', 0))
          ?.trustedHash
      )
      throw new Error('disk full')
    }
    try {
      expect((await new CodexHookService().install()).state).toBe('error')
    } finally {
      hooks.beforeHooksJsonWrite = null
    }

    expect(approvedAtWrite).toEqual(['sha256:codex-stop'])
    expect(
      readHookTrustEntries(join(managedHome(), 'config.toml')).get(managedKey('stop', 0))
    ).toBe(undefined)
  })

  it("keeps only the user's hooks, and says to update Codex, when Codex has no hooks/list", async () => {
    seedSystemUserStopHook()
    useCodexHashes()
    const service = new CodexHookService()
    expect((await service.install()).state).toBe('installed')
    useAnswer({
      codexVersion: 'codex-cli 0.127.0',
      hashes: null,
      failure: 'Codex 0.127.0 is too old for Orca status; update Codex'
    })

    const status = await service.install()

    const runtimeHooks = JSON.parse(readFileSync(join(managedHome(), 'hooks.json'), 'utf-8')).hooks
    expect(runtimeHooks.Stop).toEqual([{ hooks: [{ type: 'command', command: 'user-stop.sh' }] }])
    // Why: the user's hook moved back to group 0, so only its own approval is at that key.
    expect(
      readHookTrustEntries(join(managedHome(), 'config.toml')).get(managedKey('stop', 0))
        ?.trustedHash
    ).not.toBe('sha256:codex-stop')
    expect(
      readHookTrustEntries(join(managedHome(), 'config.toml')).get(managedKey('session_start', 0))
    ).toBeUndefined()
    expect(status).toMatchObject({
      state: 'not_installed',
      detail: expect.stringContaining('update Codex')
    })
  })

  it('writes the entry with no approval in each listed event when Codex 0.128 has no approvals', async () => {
    seedSystemUserStopHook()
    useAnswer({
      codexVersion: 'codex-cli 0.128.0',
      hashes: { stop: null, session_start: null },
      failure: null
    })

    expect((await new CodexHookService().install()).state).toBe('installed')

    const runtimeHooks = JSON.parse(readFileSync(join(managedHome(), 'hooks.json'), 'utf-8')).hooks
    expect(Object.keys(runtimeHooks).sort()).toEqual(['SessionStart', 'Stop'])
    expect(isCodexManagedCommand(runtimeHooks.Stop[0].hooks[0].command)).toBe(true)
    expect(runtimeHooks.Stop[1].hooks[0].command).toBe('user-stop.sh')
    expect(
      readHookTrustEntries(join(managedHome(), 'config.toml')).get(managedKey('stop', 0))
    ).toBeUndefined()
  })

  it("leaves a user hook's approval in place in an event Codex does not list Orca's entry for", async () => {
    const systemHome = join(homes.tmpHome, '.codex')
    mkdirSync(systemHome, { recursive: true })
    writeFileSync(
      join(systemHome, 'hooks.json'),
      JSON.stringify({
        hooks: { Interrupt: [{ hooks: [{ type: 'command', command: 'user-interrupt.sh' }] }] }
      })
    )
    const userInterrupt = {
      eventLabel: 'interrupt' as const,
      groupIndex: 0,
      handlerIndex: 0,
      command: 'user-interrupt.sh'
    }
    upsertHookTrustEntries(join(systemHome, 'config.toml'), [
      { ...userInterrupt, sourcePath: join(systemHome, 'hooks.json') }
    ])
    // Why: a Codex before 0.150 does not know Interrupt, so Orca's entry does not lead that event.
    useAnswer({ codexVersion: 'codex-cli 0.149.0', hashes: CODEX_HASHES, failure: null })

    expect((await new CodexHookService().install()).state).toBe('installed')

    const runtimeHooks = JSON.parse(readFileSync(join(managedHome(), 'hooks.json'), 'utf-8')).hooks
    expect(runtimeHooks.Interrupt).toEqual([
      { hooks: [{ type: 'command', command: 'user-interrupt.sh' }] }
    ])
    const sourcePath = getCodexExplicitHomeHookSourcePath(join(managedHome(), 'hooks.json'))
    expect(
      readHookTrustEntries(join(managedHome(), 'config.toml')).get(
        computeTrustKey({ ...userInterrupt, sourcePath })
      )?.trustedHash
    ).toBeDefined()
  })

  it("keeps a managed home's approved entry while Codex is not found", async () => {
    useCodexHashes()
    const service = new CodexHookService()
    expect((await service.install()).state).toBe('installed')
    const before = readFileSync(join(managedHome(), 'hooks.json'), 'utf-8')
    // Why: before the shell PATH is hydrated, the codex a pane runs may not be found yet.
    useAnswer({
      codexVersion: null,
      hashes: null,
      failure: 'Orca could not find Codex at codex',
      transient: true
    })

    const status = await service.install()

    expect(readFileSync(join(managedHome(), 'hooks.json'), 'utf-8')).toBe(before)
    expect(
      readHookTrustEntries(join(managedHome(), 'config.toml')).get(managedKey('stop', 0))
        ?.trustedHash
    ).toBe('sha256:codex-stop')
    expect(status).toMatchObject({
      state: 'partial',
      detail: expect.stringContaining('could not find Codex')
    })
  })

  it("leaves user trust byte-untouched while approving Orca's entries", async () => {
    mkdirSync(managedHome(), { recursive: true })
    const userBlock = [
      '[hooks.state."/home/user/.codex/hooks.json:stop:3:1"]',
      'enabled = false',
      'trusted_hash = "sha256:user-owned-hash"'
    ].join('\n')
    writeFileSync(join(managedHome(), 'config.toml'), `${userBlock}\n`)
    useCodexHashes()

    expect((await new CodexHookService().install()).state).toBe('installed')
    expect(readFileSync(join(managedHome(), 'config.toml'), 'utf-8')).toContain(userBlock)
  })

  it("turning hooks off removes an approval from an older Codex version's hash", async () => {
    const codexPath = join(homes.userDataDir, 'codex')
    writeFileSync(codexPath, 'codex 0.150.1')
    memoizeCodexHookTrust(codexPath, fingerprintCodex(codexPath), command(), {
      codexVersion: 'codex-cli 0.150.1',
      hashes: CODEX_HASHES,
      failure: null
    })
    useCodexHashes()
    expect((await new CodexHookService().install()).state).toBe('installed')
    // Why: Codex updated since; the current binary's version hashes the entry differently.
    writeFileSync(codexPath, 'codex 0.160.0')
    memoizeCodexHookTrust(codexPath, fingerprintCodex(codexPath), command(), {
      codexVersion: 'codex-cli 0.160.0',
      hashes: { stop: 'sha256:codex-0.160-stop' },
      failure: null
    })

    await new CodexHookService().remove()

    const trust = readHookTrustEntries(join(managedHome(), 'config.toml'))
    expect(trust.get(managedKey('stop', 0))).toBeUndefined()
    expect(trust.get(managedKey('session_start', 0))).toBeUndefined()
  })

  it('reports why there is no status when Orca has not asked Codex yet', () => {
    lookupInternals.resetForTesting()

    expect(new CodexHookService().getStatus()).toMatchObject({
      state: 'not_installed',
      detail: 'Orca has not asked Codex yet'
    })
  })

  it("keeps a managed home's approved entry when Codex's answer comes after the launch's wait", async () => {
    useCodexHashes()
    const service = new CodexHookService()
    expect((await service.install()).state).toBe('installed')
    const before = readFileSync(join(managedHome(), 'hooks.json'), 'utf-8')
    // Why: a Codex update makes the answer for the new binary slower than the launch may wait.
    lookupInternals.resetForTesting()
    lookupInternals.setHashResolverForTesting(
      () =>
        new Promise((resolve) => {
          setTimeout(
            () =>
              resolve({ codexVersion: 'codex-cli 0.160.0', hashes: CODEX_HASHES, failure: null }),
            200
          )
        })
    )

    await service.install(undefined, 10)

    expect(readFileSync(join(managedHome(), 'hooks.json'), 'utf-8')).toBe(before)
    expect(
      readHookTrustEntries(join(managedHome(), 'config.toml')).get(managedKey('stop', 0))
    ).toEqual({ trustedHash: 'sha256:codex-stop', enabled: true })
  })

  it("keeps the managed config.toml loadable when hooks are off and the user's approvals are inline", async () => {
    const systemHome = join(homes.tmpHome, '.codex')
    mkdirSync(systemHome, { recursive: true })
    const userHook = { type: 'command', command: 'user-stop.sh' }
    writeFileSync(
      join(systemHome, 'hooks.json'),
      JSON.stringify({ hooks: { Stop: [{ hooks: [userHook] }] } })
    )
    const userKey = computeTrustKey({
      sourcePath: join(systemHome, 'hooks.json'),
      eventLabel: 'stop',
      groupIndex: 0,
      handlerIndex: 0,
      command: 'user-stop.sh'
    })
    const userHash = computeTrustedHash({
      sourcePath: join(systemHome, 'hooks.json'),
      eventLabel: 'stop',
      groupIndex: 0,
      handlerIndex: 0,
      command: 'user-stop.sh'
    })
    writeFileSync(
      join(systemHome, 'config.toml'),
      `model = "m"\n[hooks]\nstate = { ${JSON.stringify(userKey)} = { trusted_hash = "${userHash}" } }\n`
    )

    await new CodexHookService().refreshRuntimeUserHooks()

    expect(() => parseToml(readFileSync(join(managedHome(), 'config.toml'), 'utf-8'))).not.toThrow()
  })

  it("keeps a managed home's approved entry when Codex's answer timed out", async () => {
    useCodexHashes()
    const service = new CodexHookService()
    expect((await service.install()).state).toBe('installed')
    const before = readFileSync(join(managedHome(), 'hooks.json'), 'utf-8')
    lookupInternals.resetForTesting()
    lookupInternals.setHashResolverForTesting(async () => ({
      codexVersion: null,
      hashes: null,
      failure: 'Codex app-server timed out',
      transient: true
    }))

    await service.install(undefined, 3_000)

    expect(readFileSync(join(managedHome(), 'hooks.json'), 'utf-8')).toBe(before)
    expect(
      readHookTrustEntries(join(managedHome(), 'config.toml')).get(managedKey('stop', 0))
        ?.trustedHash
    ).toBe('sha256:codex-stop')
  })
})
