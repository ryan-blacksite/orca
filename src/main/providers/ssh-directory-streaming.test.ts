import { describe, expect, it, vi } from 'vitest'
import type { SFTPWrapper } from 'ssh2'
import { readDirectoryEntriesViaSftp, readDirViaSftp } from './ssh-filesystem-provider-sftp'

function fixture(packets: string[][]) {
  let next = 0
  const handle = Buffer.from('directory')
  const sftp = {
    opendir: vi.fn((_path, callback) => callback(null, handle)),
    readdir: vi.fn((_handle, callback) =>
      next < packets.length
        ? callback(
            null,
            packets[next++].map((filename) => ({ filename, attrs: {} }))
          )
        : callback(Object.assign(new Error('EOF'), { code: 1 }))
    ),
    close: vi.fn((_handle, callback) => callback(null))
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: The fixture implements all three handle operations used by the reader.
  return { mock: sftp, sftp: sftp as unknown as SFTPWrapper }
}

describe('SFTP directory handle ownership', () => {
  it('does not request later packets after a consumer stops', async () => {
    const { sftp, mock } = fixture([['first'], ['second']])
    for await (const entry of readDirectoryEntriesViaSftp(sftp, '/folder')) {
      expect(entry.filename).toBe('first')
      break
    }
    expect(mock.readdir).toHaveBeenCalledTimes(1)
    expect(mock.close).toHaveBeenCalledTimes(1)
  })

  it('continues through empty filtered packets until the protocol EOF error', async () => {
    const { sftp, mock } = fixture([[], ['.', '..'], ['visible']])
    expect((await readDirViaSftp(sftp, '/folder')).map((entry) => entry.filename)).toEqual([
      'visible'
    ])
    expect(mock.close).toHaveBeenCalledTimes(1)
  })

  it('rejects capacity before fetching the remaining million-entry directory', async () => {
    const name = 'x'.repeat(1000)
    const { sftp, mock } = fixture(Array.from({ length: 1000 }, () => Array(100).fill(name)))
    await expect(readDirViaSftp(sftp, '/folder')).rejects.toThrow('too large')
    expect(mock.readdir.mock.calls.length).toBeLessThan(50)
    expect(mock.close).toHaveBeenCalledTimes(1)
  })

  it('closes after cancellation between packets', async () => {
    const { sftp, mock } = fixture([['first'], ['second']])
    const controller = new AbortController()
    await expect(
      (async () => {
        for await (const _entry of readDirectoryEntriesViaSftp(sftp, '/folder', {
          signal: controller.signal
        })) {
          controller.abort(new Error('closed'))
        }
      })()
    ).rejects.toThrow('closed')
    expect(mock.close).toHaveBeenCalledTimes(1)
  })
})
