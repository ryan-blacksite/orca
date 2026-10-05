import { quickOpenRecentCandidateSet } from '../../../shared/quick-open-recent-candidates'
import { listRuntimeFiles } from '@/runtime/runtime-file-client'
import type { RuntimeFileOperationArgs } from '@/runtime/runtime-file-client-types'

type EligibleRecentResult = { key: string; paths: string[]; error?: string }
export type QuickOpenRecentCache = { current: EligibleRecentResult | null }

export async function mergeQuickOpenRecentCandidates(args: {
  result: { files: string[]; truncated: boolean }
  candidatePaths: string[]
  cache: QuickOpenRecentCache
  key: string
  context: RuntimeFileOperationArgs
  options: Parameters<typeof listRuntimeFiles>[1]
  cancelled: () => boolean
}): Promise<{ files: string[]; truncated: boolean; recentError?: string } | undefined> {
  if (args.cancelled()) {
    return
  }
  const candidates = [...quickOpenRecentCandidateSet(args.candidatePaths)]
  const available = new Set(args.result.files)
  if (!args.result.truncated || candidates.every((path) => available.has(path))) {
    return args.result
  }
  if (args.cache.current?.key !== args.key) {
    try {
      const paths = await listRuntimeFiles(args.context, {
        ...args.options,
        candidatePaths: candidates,
        maxResults: candidates.length
      })
      if (args.cancelled()) {
        return
      }
      const requested = new Set(candidates)
      args.cache.current = { key: args.key, paths: paths.filter((path) => requested.has(path)) }
    } catch (error) {
      if (args.cancelled()) {
        return
      }
      const detail = error instanceof Error ? error.message : String(error)
      args.cache.current = {
        key: args.key,
        paths: [],
        error: `Recent files could not be checked: ${detail}`
      }
    }
  }
  const eligible = args.cache.current
  return {
    ...args.result,
    files: [...new Set([...args.result.files, ...(eligible?.paths ?? [])])],
    recentError: eligible?.error
  }
}
