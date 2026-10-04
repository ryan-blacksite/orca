import { expect, it } from 'vitest'
import { searchRuntimeFilePaths } from './runtime-file-client'
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
          : { files, totalCount: files.length, truncated: false }
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
      quickOpenSearchVersion: 3
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
