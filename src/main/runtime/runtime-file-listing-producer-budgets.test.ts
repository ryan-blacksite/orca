import { describe, expect, it, vi } from 'vitest'
import { getSshFilesystemProviderMock } from './orca-runtime-files-mock-registry'
import {
  createRuntimeFileCommands,
  useRuntimeFileCommandsLifecycle
} from './orca-runtime-files-test-harness'
const { localList } = vi.hoisted(() => ({ localList: vi.fn() }))
vi.mock('../ipc/filesystem-list-files', () => ({ listQuickOpenFiles: localList }))
vi.mock(
  '../providers/ssh-filesystem-dispatch',
  async () => (await import('./orca-runtime-files-mock-registry')).sshFilesystemDispatchMock
)

function inventory(count: number) {
  const paths = Array.from({ length: count }, (_, index) => `src/file-${index}.ts`)
  return vi.fn(async (_root: string, options?: { maxResults?: number }) =>
    paths.slice(0, options?.maxResults)
  )
}

describe('runtime producer listing budgets', () => {
  useRuntimeFileCommandsLifecycle()
  it.each([5000, 5001, 5002])(
    'passes the mobile sentinel budget on SSH for %i paths',
    async (count) => {
      const listFiles = inventory(count)
      getSshFilesystemProviderMock.mockReturnValue({ listFiles })
      const { commands } = createRuntimeFileCommands({ hostId: 'ssh:host' })
      const result = await commands.listMobileFiles('id:wt-1')
      expect(listFiles).toHaveBeenCalledWith('/repo', { maxResults: 5001, signal: undefined })
      expect(result.files).toHaveLength(5000)
      expect(result.totalCount).toBe(Math.min(count, 5001))
      expect(result.truncated).toBe(count > 5000)
    }
  )

  it('passes the same sentinel budget before local enumeration', async () => {
    localList.mockImplementation(async (_root, _store, _excluded, _signal, maxResults) =>
      Array.from({ length: Math.min(5002, maxResults) }, (_, i) => `file-${i}.txt`)
    )
    const { commands } = createRuntimeFileCommands()
    const result = await commands.listMobileFiles('id:wt-1')
    expect(localList.mock.calls[0][4]).toBe(5001)
    expect(result.totalCount).toBe(5001)
    expect(result.truncated).toBe(true)
  })

  it('bounds an unqualified large runtime inventory and reports failure rather than silently hiding paths', async () => {
    const listFiles = inventory(159027)
    getSshFilesystemProviderMock.mockReturnValue({ listFiles })
    const { commands } = createRuntimeFileCommands({ hostId: 'ssh:host' })
    await expect(commands.listRuntimeFiles('id:wt-1')).rejects.toThrow('capacity')
    expect(listFiles.mock.calls[0][1]?.maxResults).toBe(20001)
    expect((await listFiles.mock.results[0].value).length).toBe(20001)
  })

  it('requests Markdown from its semantic producer, without retaining unrelated paths', async () => {
    const listFiles = vi.fn()
    const listMarkdownDocuments = vi.fn().mockResolvedValue([])
    getSshFilesystemProviderMock.mockReturnValue({ listFiles, listMarkdownDocuments })
    const { commands } = createRuntimeFileCommands({ hostId: 'ssh:host' })
    await commands.listRuntimeMarkdownDocuments('id:wt-1')
    expect(listMarkdownDocuments).toHaveBeenCalledWith('/repo')
    expect(listFiles).not.toHaveBeenCalled()
  })
})
