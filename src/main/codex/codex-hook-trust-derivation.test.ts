import { afterEach, describe, expect, it, vi } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type * as AppServerSession from './codex-app-server-session'

const mocks = vi.hoisted(() => ({
  runCodexAppServerSession: vi.fn(),
  runProcess: vi.fn()
}))

vi.mock('./codex-app-server-session', async (importOriginal) => ({
  ...(await importOriginal<typeof AppServerSession>()),
  runCodexAppServerSession: mocks.runCodexAppServerSession
}))
vi.mock('../../shared/child-process/run-process', () => ({ runProcess: mocks.runProcess }))

import { CodexAppServerUnsupportedError } from './codex-app-server-session'
import { deriveCodexHookHashes, readCodexHookHashes } from './codex-hook-trust-derivation'
import { CODEX_EVENTS, CODEX_EVENT_LABEL } from './codex-hook-definition'

const COMMAND = '/home/u/.orca/agent-hooks/codex-hook.sh'
const LABELS = CODEX_EVENTS.map((eventName) => CODEX_EVENT_LABEL[eventName])

type Scratch = { home: string; project: string }
type ListedHook = Record<string, unknown>

/** A hooks/list entry as Codex 0.129+ reports it. */
function listed(sourcePath: string, label: string, groupIndex = 0, hash = `sha256:${label}`) {
  return {
    key: `${sourcePath}:${label}:${groupIndex}:0`,
    eventName: label,
    handlerType: 'command',
    command: COMMAND,
    sourcePath,
    source: 'user',
    displayOrder: 0,
    enabled: true,
    currentHash: hash,
    trustStatus: 'untrusted'
  }
}

/** Codex 0.128's shape: listed, with no hash and no approval status. */
function listedWithoutApprovals(sourcePath: string, label: string, groupIndex = 0): ListedHook {
  return {
    key: `${sourcePath}:${label}:${groupIndex}:0`,
    eventName: label,
    command: COMMAND,
    sourcePath,
    displayOrder: 0
  }
}

/** Every copy of Orca's scratch entry Codex lists: group 0, after the dummy group, and the project's. */
function everyCopy(scratch: Scratch, hashFor: (label: string, copy: number) => string) {
  const home = join(scratch.home, 'hooks.json')
  const project = join(scratch.project, '.codex', 'hooks.json')
  return LABELS.flatMap((label) => [
    listed(home, label, 0, hashFor(label, 0)),
    listed(home, label, 2, hashFor(label, 1)),
    listed(project, label, 0, hashFor(label, 2))
  ])
}

/** Stands in for Codex's app-server, answering hooks/list from what `respond` lists. */
function answerHooksList(respond: (scratch: Scratch) => ListedHook[]): Scratch[] {
  const scratches: Scratch[] = []
  mocks.runCodexAppServerSession.mockImplementation(
    async (
      invocation: { env?: Record<string, string> },
      body: (rpc: unknown) => Promise<unknown>
    ) => {
      const home = invocation.env!.CODEX_HOME!
      let project = ''
      await body({
        request: async (method: string, params: { cwds: string[] }) => {
          expect(method).toBe('hooks/list')
          project = params.cwds[0]!
        }
      })
      const scratch = { home, project }
      scratches.push(scratch)
      expect(readFileSync(join(home, 'config.toml'), 'utf-8')).toContain('trust_level = "trusted"')
      return { data: [{ cwd: project, hooks: respond(scratch) }] }
    }
  )
  return scratches
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('deriveCodexHookHashes', () => {
  it("asks Codex in a throwaway home and trusted project holding Orca's entry, then removes both", async () => {
    const scratches = answerHooksList((scratch) => {
      const home = JSON.parse(readFileSync(join(scratch.home, 'hooks.json'), 'utf-8'))
      expect(Object.keys(home.hooks).sort()).toEqual([...CODEX_EVENTS].sort())
      expect(home.hooks.Stop).toEqual([
        { hooks: [{ type: 'command', command: COMMAND, timeout: 10 }] },
        { hooks: [{ type: 'command', command: 'exit 0' }] },
        { hooks: [{ type: 'command', command: COMMAND, timeout: 10 }] }
      ])
      const project = JSON.parse(
        readFileSync(join(scratch.project, '.codex', 'hooks.json'), 'utf-8')
      )
      expect(project.hooks.Stop).toEqual([
        { hooks: [{ type: 'command', command: COMMAND, timeout: 10 }] }
      ])
      return everyCopy(scratch, (label) => `sha256:${label}`)
    })

    const derived = await deriveCodexHookHashes('/bin/codex', COMMAND, 'codex-cli 0.150.1')

    expect(derived).toMatchObject({ codexVersion: 'codex-cli 0.150.1', failure: null })
    expect(derived.hashes?.stop).toBe('sha256:stop')
    expect(derived.hashes?.interrupt).toBe('sha256:interrupt')
    expect(mocks.runCodexAppServerSession).toHaveBeenCalledTimes(1)
    expect(existsSync(scratches[0]!.home)).toBe(false)
    expect(existsSync(scratches[0]!.project)).toBe(false)
    expect(mocks.runProcess).not.toHaveBeenCalled()
  })

  it('confirms a hash that differs by position with a second throwaway home before refusing', async () => {
    const scratches = answerHooksList((scratch) =>
      everyCopy(scratch, (label, copy) => (copy === 1 ? 'sha256:moved' : `sha256:${label}`))
    )

    const derived = await deriveCodexHookHashes('/bin/codex', COMMAND, 'codex-cli 0.170.0')

    expect(scratches).toHaveLength(2)
    expect(scratches[0]!.home).not.toBe(scratches[1]!.home)
    expect(derived).toEqual({
      codexVersion: 'codex-cli 0.170.0',
      hashes: null,
      failure:
        "Codex 0.170.0 hashes Orca's status hook differently by its file or position, so Orca does not approve it",
      transient: false
    })
  })

  it('takes the hashes when the second throwaway home agrees', async () => {
    let calls = 0
    answerHooksList((scratch) => {
      calls += 1
      return everyCopy(scratch, (label, copy) =>
        calls === 1 && copy === 2 ? 'sha256:project' : `sha256:${label}`
      )
    })

    const derived = await deriveCodexHookHashes('/bin/codex', COMMAND, 'codex-cli 0.160.1')

    expect(calls).toBe(2)
    expect(derived.hashes?.stop).toBe('sha256:stop')
  })

  it('answers that Codex 0.128 needs no approval when it lists the entry with no hash', async () => {
    answerHooksList((scratch) => {
      const home = join(scratch.home, 'hooks.json')
      // Why: Codex 0.128 does not know Interrupt, so it never lists it.
      return LABELS.filter((label) => label !== 'interrupt').flatMap((label) => [
        listedWithoutApprovals(home, label, 0),
        listedWithoutApprovals(home, label, 2),
        listedWithoutApprovals(join(scratch.project, '.codex', 'hooks.json'), label, 0)
      ])
    })

    const derived = await deriveCodexHookHashes('/bin/codex', COMMAND, 'codex-cli 0.128.0')

    expect(derived.failure).toBeNull()
    expect(derived.hashes).toEqual(
      Object.fromEntries(
        LABELS.filter((label) => label !== 'interrupt').map((label) => [label, null])
      )
    )
  })

  it('tells the user to update Codex, and is not retried soon, when it has no hooks/list', async () => {
    mocks.runCodexAppServerSession.mockRejectedValue(
      new CodexAppServerUnsupportedError('method not found: hooks/list')
    )

    const derived = await deriveCodexHookHashes('/bin/codex', COMMAND, 'codex-cli 0.127.0')

    expect(derived).toEqual({
      codexVersion: 'codex-cli 0.127.0',
      hashes: null,
      failure: 'Codex 0.127.0 is too old for Orca status; update Codex',
      transient: false
    })
  })

  it('reports a version probe that timed out as worth asking again', async () => {
    mocks.runProcess.mockResolvedValue({ code: null, stdout: '', stderr: '', timedOut: true })

    const derived = await deriveCodexHookHashes('/bin/codex', COMMAND)

    expect(derived).toMatchObject({ hashes: null, transient: true })
    expect(mocks.runCodexAppServerSession).not.toHaveBeenCalled()
  })

  it('gives `codex --version` a throwaway CODEX_HOME of its own', async () => {
    let versionHome = ''
    mocks.runProcess.mockImplementation(async (spec: { env: Record<string, string> }) => {
      versionHome = spec.env.CODEX_HOME!
      expect(existsSync(versionHome)).toBe(true)
      return { code: 0, stdout: 'codex-cli 0.150.1\n', stderr: '', timedOut: false }
    })
    answerHooksList((scratch) => everyCopy(scratch, (label) => `sha256:${label}`))

    const derived = await deriveCodexHookHashes('/bin/codex', COMMAND)

    expect(derived.codexVersion).toBe('codex-cli 0.150.1')
    expect(existsSync(versionHome)).toBe(false)
    expect(mocks.runCodexAppServerSession.mock.calls[0]![0].env.CODEX_HOME).not.toBe(versionHome)
  })
})

describe('readCodexHookHashes', () => {
  const scratch = {
    homeHooksPath: '/s/home/hooks.json',
    projectHooksPath: '/s/p/.codex/hooks.json'
  }

  it('takes only the scratch home group-0 entry for exactly this command', () => {
    const hashes = readCodexHookHashes(
      {
        ...scratch,
        listings: [
          listed('/s/home/hooks.json', 'stop'),
          // Why: a hook from another source with the same command must not count.
          listed('/real/home/hooks.json', 'session_start'),
          { ...listed('/s/home/hooks.json', 'pre_tool_use'), command: '/other/codex-hook.sh' },
          listed('/s/home/hooks.json', 'post_tool_use', 1)
        ].map((hook) => ({ ...hook, trustStatus: 'untrusted', enabled: true }))
      },
      COMMAND
    )

    expect(hashes).toEqual({ stop: 'sha256:stop' })
  })

  it("drops hash-less events when Codex hashes Orca's entry in others", () => {
    const hashes = readCodexHookHashes(
      {
        ...scratch,
        listings: [
          { ...listed('/s/home/hooks.json', 'stop'), enabled: true },
          {
            key: '/s/home/hooks.json:session_start:0:0',
            command: COMMAND,
            currentHash: null,
            trustStatus: null,
            enabled: null
          }
        ]
      },
      COMMAND
    )

    expect(hashes).toEqual({ stop: 'sha256:stop' })
  })

  it('is null when Codex lists none of them', () => {
    expect(readCodexHookHashes({ ...scratch, listings: [] }, COMMAND)).toBeNull()
  })
})
