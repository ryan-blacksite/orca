import type { SshChannelMultiplexer } from '../ssh/ssh-channel-multiplexer'
import type { IFilesystemProvider } from './types'
import { requestGitStreamable } from '../ssh/ssh-git-response-stream-reader'

export async function listSshFiles(
  mux: SshChannelMultiplexer,
  rootPath: string,
  options?: Parameters<IFilesystemProvider['listFiles']>[1]
): Promise<string[]> {
  const params: Record<string, unknown> = { rootPath }
  if (options?.excludePaths && options.excludePaths.length > 0) {
    params.excludePaths = options.excludePaths
  }
  if (options?.maxResults !== undefined) {
    params.maxResults = options.maxResults
  }
  if (options?.searchQuery !== undefined) {
    params.searchQuery = options.searchQuery
  }
  // Why #7721: the signal lets a workspace switch send rpc.cancel so the
  // relay aborts the full-tree scan instead of stacking abandoned scans
  // that starve interactive fs.readDir/fs.stat on the shared SSH channel.
  // Why streamable: a monorepo listing serializes past the relay's 1 MiB control lane, and the
  // lane it demotes to is refused under unrelated producer load. Opting in moves it to the bulk
  // lane in chunks; an old relay ignores the flag and answers plainly, which the reader detects
  // by the sentinel marker being absent.
  const result = await requestGitStreamable(mux, 'fs.listFiles', params, {
    signal: options?.signal,
    ...(options?.maxResults !== undefined ? { maxResponseBytes: 16 * 1024 * 1024 } : {})
  })
  if (!Array.isArray(result) || result.some((path) => typeof path !== 'string')) {
    throw new Error('Invalid remote file listing')
  }
  if (options?.maxResults !== undefined && result.length > options.maxResults) {
    throw new Error('Remote file listing exceeds the requested capacity')
  }
  return result
}
