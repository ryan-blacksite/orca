import { expect, it } from 'vitest'
import { searchRuntimeFilePaths, listRuntimeFiles } from './runtime-file-client'
import {
  installRuntimeFileClientEnvironment,
  runtimeEnvironmentCall,
  fsListFiles
} from './runtime-file-client-test-harness'
installRuntimeFileClientEnvironment()

it('finds the last file beyond 25,000 entries through a version-one inventory fallback', async () => {
  const files = Array.from({ length: 25_001 }, (_, i) => ({
    relativePath: `src/file-${i}.ts`,
    basename: `file-${i}.ts`,
    kind: 'text'
  }))
  files.push({ relativePath: 'apps/late/.env', basename: '.env', kind: 'text' })
  runtimeEnvironmentCall.mockImplementation(({ method }) =>
    Promise.resolve({
      id: 'compat',
      ok: true,
      _meta: { runtimeId: 'host' },
      result:
        method === 'files.searchPaths'
          ? { files: [], truncated: false, quickOpenSearchVersion: 1 }
          : {
              worktree: 'id:large-legacy',
              rootPath: '/host/repo',
              files: files.map((file) => ({
                ...file,
                basename: file.relativePath.split('/').at(-1) ?? '',
                kind: 'text'
              })),
              totalCount: files.length,
              truncated: false
            }
    })
  )
  await expect(
    searchRuntimeFilePaths(
      {
        settings: { activeRuntimeEnvironmentId: 'env-1' },
        worktreeId: 'large-legacy',
        worktreePath: '/host/repo'
      },
      { query: '.env late' }
    )
  ).resolves.toEqual({ files: ['apps/late/.env'], truncated: false })
  expect(runtimeEnvironmentCall.mock.calls.map(([request]) => request.method)).toEqual([
    'files.searchPaths',
    'files.list'
  ])
  expect(runtimeEnvironmentCall.mock.calls[1][0].params).toEqual({ worktree: 'id:large-legacy' })
  expect(fsListFiles).not.toHaveBeenCalled()
})

it('accepts a future compatible search version rather than falling back on exact-version inequality', async () => {
  runtimeEnvironmentCall.mockResolvedValue({
    id: 'compat',
    ok: true,
    _meta: { runtimeId: 'host' },
    result: {
      files: [{ relativePath: 'apps/late/.env' }],
      truncated: false,
      quickOpenSearchVersion: 4
    }
  })
  await expect(
    searchRuntimeFilePaths(
      {
        settings: { activeRuntimeEnvironmentId: 'env-1' },
        worktreeId: 'future-host',
        worktreePath: '/host/repo'
      },
      { query: '.env late' }
    )
  ).resolves.toEqual({ files: ['apps/late/.env'], truncated: false })
  expect(runtimeEnvironmentCall).toHaveBeenCalledOnce()
})

it('validates default-policy recent paths on a version-two host through complete legacy inventory', async () => {
  runtimeEnvironmentCall.mockImplementation(({ method }) =>
    Promise.resolve({
      id: 'compat',
      ok: true,
      _meta: { runtimeId: 'host' },
      result:
        method === 'files.searchPaths'
          ? { files: [], truncated: false, quickOpenSearchVersion: 2 }
          : {
              worktree: 'id:recent-legacy',
              rootPath: '/host/repo',
              files: [{ relativePath: 'src/recent.ts', basename: 'recent.ts', kind: 'text' }],
              totalCount: 1,
              truncated: false
            }
    })
  )
  await expect(
    listRuntimeFiles(
      {
        settings: { activeRuntimeEnvironmentId: 'env-1' },
        worktreeId: 'recent-legacy',
        worktreePath: '/host/repo'
      },
      { rootPath: '/host/repo', candidatePaths: ['src/recent.ts', 'src/deleted.ts'], maxResults: 2 }
    )
  ).resolves.toEqual(['src/recent.ts'])
  expect(runtimeEnvironmentCall.mock.calls.map(([request]) => request.method)).toEqual([
    'files.searchPaths',
    'files.list'
  ])
  expect(fsListFiles).not.toHaveBeenCalled()
})

it('sends bounded candidates only after a compatible host advertises their semantics', async () => {
  runtimeEnvironmentCall.mockImplementation(({ method }) =>
    Promise.resolve({
      id: 'compat',
      ok: true,
      _meta: { runtimeId: 'host' },
      result:
        method === 'files.searchPaths'
          ? { files: [], truncated: false, quickOpenSearchVersion: 3 }
          : ['src/recent.ts']
    })
  )
  await expect(
    listRuntimeFiles(
      {
        settings: { activeRuntimeEnvironmentId: 'env-1' },
        worktreeId: 'recent-new',
        worktreePath: '/host/repo'
      },
      { rootPath: '/host/repo', candidatePaths: ['src/recent.ts'], maxResults: 1 }
    )
  ).resolves.toEqual(['src/recent.ts'])
  expect(runtimeEnvironmentCall.mock.calls[1][0]).toMatchObject({
    method: 'files.listAll',
    params: { worktree: 'id:recent-new', candidatePaths: ['src/recent.ts'], maxResults: 1 }
  })
})

it('refuses to infer recent eligibility from a truncated old-host inventory', async () => {
  runtimeEnvironmentCall.mockImplementation(({ method }) =>
    Promise.resolve({
      id: 'compat',
      ok: true,
      _meta: { runtimeId: 'host' },
      result:
        method === 'files.searchPaths'
          ? { files: [], truncated: false, quickOpenSearchVersion: 2 }
          : {
              worktree: 'id:recent-truncated',
              rootPath: '/host/repo',
              files: [],
              totalCount: 1,
              truncated: true
            }
    })
  )
  await expect(
    listRuntimeFiles(
      {
        settings: { activeRuntimeEnvironmentId: 'env-1' },
        worktreeId: 'recent-truncated',
        worktreePath: '/host/repo'
      },
      { rootPath: '/host/repo', candidatePaths: ['src/recent.ts'], maxResults: 1 }
    )
  ).rejects.toThrow('inventory limit')
  expect(fsListFiles).not.toHaveBeenCalled()
})
