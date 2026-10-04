import { RipgrepLaunchFailureError } from '../shared/ripgrep-process-availability'
export async function runRelayFileListingPasses(
  options: { includeIgnored?: boolean; searchQuery?: string; maxResults?: number },
  primary: string[],
  ignoredPass: string[],
  runPass: (args: string[]) => Promise<void>,
  resultCount: () => number
): Promise<void> {
  if (options.includeIgnored === false) {
    return runPass(primary)
  }
  // An unbounded or ranked scan already gets every primary path from the broader pass.
  if (options.searchQuery !== undefined || options.maxResults === undefined) {
    return runPass(ignoredPass)
  }
  await runPass(primary)
  if (resultCount() < options.maxResults) {
    await runPass(ignoredPass)
  }
}

export function retryRelayFileListingPass(
  run: () => Promise<void>,
  isCanceled: () => boolean
): Promise<void> {
  return run().catch((error: unknown) => {
    if (!(error instanceof RipgrepLaunchFailureError) || isCanceled()) {
      throw error
    }
    return run()
  })
}
