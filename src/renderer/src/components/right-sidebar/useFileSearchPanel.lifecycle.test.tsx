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
const initialView: { view: 'files' | 'search' } = { view: 'search' }
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
    initialProps: initialView
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

it.each(['search', 'files', 'unmounted'] as const)(
  'invalidates completed results across same-ID root changes while %s',
  async (view) => {
    search.mockResolvedValue(empty)
    useAppStore.getState().updateFileSearchState('folder:a', { query: 'needle' })
    let hook = renderHook(({ view }: { view: 'search' | 'files' }) => useFileSearchPanel(view), {
      initialProps: initialView
    })
    await act(async () => vi.advanceTimersByTimeAsync(300))
    expect(search).toHaveBeenCalledTimes(1)
    if (view === 'unmounted') {
      hook.unmount()
    } else {
      hook.rerender({ view })
    }
    await act(async () =>
      useAppStore.setState({
        folderWorkspaces: [makeFolderWorkspace({ id: 'a', folderPath: '/replacement' })]
      })
    )
    if (view === 'files') {
      expect(useAppStore.getState().fileSearchStateByWorktree['folder:a'].results).toBeNull()
      hook.rerender({ view: 'search' })
    } else if (view === 'unmounted') {
      hook = renderHook(({ view }: { view: 'search' | 'files' }) => useFileSearchPanel(view), {
        initialProps: initialView
      })
    }
    await act(async () => vi.advanceTimersByTimeAsync(300))
    expect(search).toHaveBeenCalledTimes(2)
    expect(search.mock.calls[1][1].rootPath).toBe('/replacement')
    expect(useAppStore.getState().fileSearchStateByWorktree['folder:a'].resultOwner?.rootPath).toBe(
      '/replacement'
    )
    hook.unmount()
  }
)

it('invalidates completed results and errors when the execution owner changes at the same root', async () => {
  search.mockResolvedValue(empty)
  useAppStore.getState().updateFileSearchState('folder:a', { query: 'needle' })
  const hook = renderHook(() => useFileSearchPanel('search'))
  await act(async () => vi.advanceTimersByTimeAsync(300))
  await act(async () =>
    useAppStore.setState({
      folderWorkspaces: [
        makeFolderWorkspace({ id: 'a', folderPath: '/a', executionHostId: 'runtime:remote-a' })
      ]
    })
  )
  await act(async () => vi.advanceTimersByTimeAsync(300))
  expect(search).toHaveBeenCalledTimes(2)
  expect(search.mock.calls[1][0].settings.activeRuntimeEnvironmentId).toBe('remote-a')
  expect(
    useAppStore.getState().fileSearchStateByWorktree['folder:a'].resultOwner?.executionHostId
  ).toBe('runtime:remote-a')
  hook.unmount()
})
