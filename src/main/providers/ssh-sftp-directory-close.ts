import type { SFTPWrapper } from 'ssh2'

const SFTP_DIRECTORY_CLOSE_TIMEOUT_MS = 5_000

export function closeSftpDirectoryHandle(sftp: SFTPWrapper, handle: Buffer): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (acknowledged: boolean): void => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      resolve(acknowledged)
    }
    const timer = setTimeout(() => finish(false), SFTP_DIRECTORY_CLOSE_TIMEOUT_MS)
    try {
      sftp.close(handle, (error) => finish(!error))
    } catch {
      finish(false)
    }
  })
}
