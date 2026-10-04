import type { DirEntry } from '../../shared/filesystem-entry-types'
import type { SshChannelMultiplexer } from '../ssh/ssh-channel-multiplexer'
import { requestGitStreamable } from '../ssh/ssh-git-response-stream-reader'
import { isMethodNotFoundError } from '../ssh/ssh-filesystem-stream-reader'
import { validateDirectoryListing } from '../../shared/directory-listing-budget'
import { readSftpDirectory } from './ssh-sftp-filesystem-provider'
import type { SftpFactory } from './ssh-filesystem-download'

export function readSshDirectoryWithSftpFallback(
  mux: SshChannelMultiplexer,
  dirPath: string,
  createSftp?: SftpFactory
): Promise<DirEntry[]> {
  return readSshDirectoryBounded(
    mux,
    dirPath,
    createSftp
      ? async () => {
          const sftp = await createSftp()
          try {
            return await readSftpDirectory(sftp, dirPath)
          } finally {
            sftp.end()
          }
        }
      : undefined
  )
}

export async function readSshDirectoryBounded(
  mux: SshChannelMultiplexer,
  dirPath: string,
  fallback?: () => Promise<DirEntry[]>
) {
  try {
    return validateDirectoryListing(
      await requestGitStreamable(
        mux,
        'fs.readDirBounded',
        { dirPath },
        { maxResponseBytes: 16 * 1024 * 1024 }
      )
    )
  } catch (error) {
    if (isMethodNotFoundError(error)) {
      if (fallback) {
        return fallback()
      }
      throw new Error('Directory listing requires an updated SSH relay. Reconnect and retry.')
    }
    throw error
  }
}
