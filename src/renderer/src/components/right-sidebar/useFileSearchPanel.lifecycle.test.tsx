// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useAppStore } from '@/store'
import { makeFolderWorkspace } from '@/store/slices/worktrees-slice-test-fixtures'
import { useFileSearchPanel } from './useFileSearchPanel'
import type { SearchResult } from '../../../../shared/code-search-types'

const { search } = vi.hoisted(() => ({ search: vi.fn() }))
vi.mock('@/runtime/runtime-file-client', () => ({ searchRuntimeFiles: search }))
const initial = useAppStore.getInitialState()
const empty: SearchResult = { files: [], totalMatches: 0, truncated: false }

beforeEach(() => {
  vi.useFakeTimers()
  search.mockReset()
  useAppStore.setState(
    {
      ...initial,
      folderWorkspaces: [
        makeFolderWorkspace({ id: 'a', folderPath: '/a' }),
        makeFolderWorkspace({ id: 'b', folderPath: '/b' })
      ],
      activeWorktreeId: 'folder:a'
    },
    true
  )
})
afterEach(() => {
  useAppStore.setState(initial, true)
  vi.useRealTimers()
})

it('aborts on view hide, resumes the saved query, keeps completed results and cancels across workspace switches and unmount', async () => {
  const signals: AbortSignal[] = []
  const completions: ((value: SearchResult) => void)[] = []
  search.mockImplementation((_context, _options, signal: AbortSignal) => {
    signals.push(signal)
    return new Promise<SearchResult>((resolve) => completions.push(resolve))
  })
  useAppStore.getState().updateFileSearchState('folder:a', { query: 'needle' })
  const hook = renderHook(({ view }: { view: 'files' | 'search' }) => useFileSearchPanel(view), {
    initialProps: { view: 'search' }
  })
  await act(async () => vi.advanceTimersByTimeAsync(300))
  expect(signals).toHaveLength(1)
  hook.rerender({ view: 'files' })
  expect(signals[0].aborted).toBe(true)
  expect(useAppStore.getState().fileSearchStateByWorktree['folder:a'].results).toBeNull()
  hook.rerender({ view: 'search' })
  await act(async () => vi.advanceTimersByTimeAsync(300))
  expect(signals).toHaveLength(2)
  await act(async () => completions[1](empty))
  hook.rerender({ view: 'files' })
  hook.rerender({ view: 'search' })
  await act(async () => vi.advanceTimersByTimeAsync(300))
  expect(signals).toHaveLength(2)
  expect(useAppStore.getState().fileSearchStateByWorktree['folder:a'].results).toEqual(empty)
  await act(async () => {
    useAppStore.getState().updateFileSearchState('folder:b', { query: 'other' })
    useAppStore.setState({ activeWorktreeId: 'folder:b' })
  })
  await act(async () => vi.advanceTimersByTimeAsync(300))
  expect(signals).toHaveLength(3)
  await act(async () => useAppStore.setState({ activeWorktreeId: 'folder:a' }))
  expect(signals[2].aborted).toBe(true)
  expect(useAppStore.getState().fileSearchStateByWorktree['folder:b'].loading).toBe(false)
  hook.unmount()
})
