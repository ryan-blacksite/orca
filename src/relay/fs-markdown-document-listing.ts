import { spawnProcess } from '../shared/child-process/run-process'
import {
  collectMarkdownDocuments,
  MARKDOWN_DOCUMENT_LISTING_ARGS
} from '../shared/node-markdown-document-listing'
import { resolveRelayRipgrepCommand } from './relay-bundled-ripgrep'
import { expandTilde } from './context'

export function listRelayMarkdownDocuments(rootPath: string, signal?: AbortSignal) {
  signal?.throwIfAborted()
  const command = resolveRelayRipgrepCommand()
  if (!command) {
    throw new Error('Markdown discovery requires ripgrep on the SSH host.')
  }
  const expandedRoot = expandTilde(rootPath)
  const child = spawnProcess({
    program: command,
    args: MARKDOWN_DOCUMENT_LISTING_ARGS,
    cwd: expandedRoot,
    stdio: ['ignore', 'pipe', 'pipe']
  })
  return collectMarkdownDocuments(child, expandedRoot, false, signal)
}
