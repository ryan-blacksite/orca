import { detectLanguage } from '@/lib/language-detect'
import { joinPath, getRelativePathInsideRoot } from '@/lib/path'
import { useAppStore } from '@/store'
import { isMissingRuntimePathError, statRuntimePath } from '@/runtime/runtime-file-client'
import { getActiveRuntimeTarget, callRuntimeRpc } from '@/runtime/runtime-rpc-client'
import { toRuntimeWorktreeSelector } from '@/runtime/runtime-worktree-selector'
import type { RuntimeTerminalPathResolution } from '../../../shared/runtime-file-contracts'
import { resolveWslRepoWorktreeBasePath } from '../../../shared/wsl-paths'
import {
  isQuickOpenAbsolutePath,
  type QuickOpenQueryTarget
} from '../../../shared/quick-open-query-target'
import { scheduleEditorLineReveal } from '@/store/slices/editor/focus/editor-focus-reveal'
import {
  captureFileExplorerOperationGuard,
  getFileExplorerOperationOwner
} from './right-sidebar/file-explorer-operation-owner'

export async function openQuickOpenFile(
  selectedPath: string,
  worktreeId: string,
  root: string,
  navigation: QuickOpenQueryTarget,
  rawQuery?: string
): Promise<void> {
  const guard = captureFileExplorerOperationGuard(
    worktreeId,
    getFileExplorerOperationOwner(worktreeId)
  )
  const route = guard.route
  const target = getActiveRuntimeTarget(route.settings)
  const resolvePastedPath = (path: string): string =>
    target.kind !== 'environment' &&
    !route.connectionId &&
    window.api.platform?.get().platform === 'win32'
      ? resolveWslRepoWorktreeBasePath(root, path)
      : path
  const isAbsolute = isQuickOpenAbsolutePath(selectedPath)
  let filePath = isAbsolute ? resolvePastedPath(selectedPath) : joinPath(root, selectedPath)
  let relativePath = getRelativePathInsideRoot(filePath, root) ?? filePath
  const context = { ...route, worktreeId, worktreePath: root }
  let literalSelected = false
  if (isAbsolute && rawQuery && rawQuery.trim() !== selectedPath && target.kind !== 'environment') {
    try {
      const literalPath = resolvePastedPath(rawQuery.trim())
      if (!route.connectionId) {
        await window.api.fs.authorizeExternalPath({ targetPath: literalPath })
        guard.assertCurrent()
      }
      const literalStats = await statRuntimePath(context, literalPath)
      guard.assertCurrent()
      if (literalStats.isDirectory) {
        throw new Error('Choose a file rather than a directory.')
      }
      filePath = literalPath
      relativePath = getRelativePathInsideRoot(filePath, root) ?? filePath
      literalSelected = true
    } catch (error) {
      if (!isMissingRuntimePathError(error)) {
        throw error
      }
    }
  }
  if (target.kind === 'environment' && isAbsolute) {
    let literal: RuntimeTerminalPathResolution | undefined
    if (rawQuery && rawQuery.trim() !== selectedPath) {
      literal = await callRuntimeRpc<RuntimeTerminalPathResolution>(
        target,
        'files.resolveTerminalPath',
        {
          worktree: toRuntimeWorktreeSelector(worktreeId),
          pathText: rawQuery.trim()
        }
      )
      guard.assertCurrent()
      literalSelected = literal.exists
    }
    const resolved =
      literalSelected && literal
        ? literal
        : await callRuntimeRpc<RuntimeTerminalPathResolution>(target, 'files.resolveTerminalPath', {
            worktree: toRuntimeWorktreeSelector(worktreeId),
            pathText: filePath
          })
    guard.assertCurrent()
    if (!resolved.exists || resolved.isDirectory || !resolved.absolutePath) {
      throw new Error('The host could not open this file path.')
    }
    if (resolved.relativePath === null) {
      throw new Error(
        'This host cannot open a pasted path outside the workspace. Add its folder as a workspace first.'
      )
    }
    filePath = resolved.absolutePath
    relativePath = resolved.relativePath
  } else {
    if (
      !route.connectionId &&
      (isAbsolute || useAppStore.getState().settings?.followSymlinkedDirectories)
    ) {
      await window.api.fs.authorizeExternalPath({ targetPath: filePath })
      guard.assertCurrent()
    }
    const stats = await statRuntimePath(context, filePath)
    guard.assertCurrent()
    if (stats.isDirectory) {
      throw new Error('Choose a file rather than a directory.')
    }
  }
  const store = useAppStore.getState()
  const fileId = store.openFile({
    filePath,
    relativePath,
    worktreeId,
    runtimeEnvironmentId: route.settings.activeRuntimeEnvironmentId,
    ...(route.connectionId && getRelativePathInsideRoot(filePath, root) === null
      ? { externalSshTargetId: route.connectionId }
      : {}),
    language: detectLanguage(filePath),
    mode: 'edit'
  })
  if (!literalSelected && navigation.line !== undefined) {
    if (detectLanguage(filePath) === 'markdown') {
      useAppStore.getState().setMarkdownViewMode(fileId, 'source')
    }
    scheduleEditorLineReveal(
      useAppStore.getState,
      filePath,
      navigation.line,
      navigation.column,
      fileId
    )
  }
}
