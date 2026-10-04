import type { IFilesystemProvider } from './types'
import { markdownDocumentsFromRelativePaths } from '../../shared/markdown-document-paths'
import { MarkdownDocumentListingCapacityError } from '../../shared/markdown-document-listing-limits'

export async function listFilesystemMarkdownDocuments(
  provider: IFilesystemProvider,
  rootPath: string
) {
  if (provider.listMarkdownDocuments) {
    return provider.listMarkdownDocuments(rootPath)
  }
  const paths = await provider.listFiles(rootPath, { maxResults: 20_001 })
  if (paths.length >= 20_001) {
    throw new MarkdownDocumentListingCapacityError()
  }
  return markdownDocumentsFromRelativePaths(rootPath, paths)
}
