/**
 * Starting a managed orcad that is installed and activated but not running, most often one
 * that stopped itself after idling. A stopped server is just "not running": it is neither a
 * failure nor evidence about terminals, which the daemon owns and which outlive orcad.
 */
import type { ServeReadiness } from '../server/serve-readiness'
import { readOrcadActivationRecord } from './orcad-activation-record-store'
import { randomUUID } from 'node:crypto'
import {
  orcadActivationFenceExists,
  orcadActivationTransactionRoot,
  releaseOrcadActivationFence,
  withOrcadActivationLock
} from './orcad-activation-lock'
import {
  readBoundedOrcadRemoteRecord,
  writeAtomicOrcadRemoteRecord
} from './orcad-remote-record-file'
import { RELAY_INSTALL_LOCK_NAME } from './ssh-relay-install-lock'
import { joinRemotePath } from './ssh-remote-platform'

const WAKE_OWNER_FILENAME = '.orca-wake-owner'
import { readOrcadActivationTransaction } from './orcad-activation-transaction-store'
import { isUnconfirmedSshCommandTermination } from './ssh-relay-deploy-helpers'
import {
  ensureOrcadSlotServing,
  orcadSlotDir,
  resolveOrcadSlotIdentity,
  slotLiveness,
  type OrcadSlotOptions
} from './orcad-recovery-slot'

export type OrcadManagedWake =
  | { outcome: 'serving' | 'not-activated' | 'unverifiable' }
  /** An update, rollback or recovery holds the host; it owns which slot serves. */
  | { outcome: 'fenced' }
  | { outcome: 'started'; readiness: ServeReadiness }

/** Launches the active slot only on proven exit; a live or unprovable process is left alone. */
export async function wakeStoppedManagedOrcad(
  options: OrcadSlotOptions,
  onStarting: () => void = () => {}
): Promise<OrcadManagedWake> {
  const before = await readOrcadActivationRecord(options)
  if (!before.active) {
    return { outcome: 'not-activated' }
  }
  const liveness = await slotLiveness(options, orcadSlotDir(options, before.active))
  if (liveness !== 'DEAD') {
    return { outcome: liveness === 'LIVE' ? 'serving' : 'unverifiable' }
  }
  const host = wakeHostKey(options)
  if (!(await orcadActivationFenceExists(options))) {
    // The fence this client left is gone by some other route; any later one belongs to another run.
    interruptedWakes.delete(host)
  } else if (!(await releaseOwnInterruptedWakeFence(options, host))) {
    return { outcome: 'fenced' }
  }
  return withOrcadActivationLock(
    options,
    async (): Promise<OrcadManagedWake> => {
      // Re-read under the fence: another client may have activated or started a slot meanwhile.
      const active = (await readOrcadActivationRecord(options)).active
      if (!active) {
        return { outcome: 'not-activated' }
      }
      const identity = await resolveOrcadSlotIdentity(options, active)
      // Marks this fence as this wake's, so only that exact fence is ever released later.
      const token = randomUUID()
      await writeAtomicOrcadRemoteRecord(options, wakeOwnerPath(options), token)
      interruptedWakes.set(host, token)
      onStarting()
      try {
        const readiness = await ensureOrcadSlotServing(options, identity)
        interruptedWakes.delete(host)
        return { outcome: 'started', readiness }
      } catch (error) {
        // A lost connection keeps the fence on the host; anything else releases it.
        if (!isUnconfirmedSshCommandTermination(error)) {
          interruptedWakes.delete(host)
        }
        throw error
      }
    },
    () => ({ outcome: 'fenced' })
  )
}

// The owner token of a fence this client's own wake may have left when its connection dropped.
const interruptedWakes = new Map<string, string>()

function wakeOwnerPath(options: OrcadSlotOptions): string {
  return joinRemotePath(
    options.host,
    orcadActivationTransactionRoot(options.host, options.remoteHome),
    RELAY_INSTALL_LOCK_NAME,
    WAKE_OWNER_FILENAME
  )
}

function wakeHostKey(options: OrcadSlotOptions): string {
  return `${options.conn.getTarget().id}\0${options.remoteHome}`
}

/**
 * Releases only the fence carrying this client's own interrupted wake token and no journal; the
 * slot was just proven exited and orcad's instance lock bars a double start.
 */
async function releaseOwnInterruptedWakeFence(
  options: OrcadSlotOptions,
  host: string
): Promise<boolean> {
  const token = interruptedWakes.get(host)
  if (!token || (await readOrcadActivationTransaction(options))) {
    return false
  }
  const owner = await readBoundedOrcadRemoteRecord(options, wakeOwnerPath(options), 64)
  if (owner.state !== 'present' || owner.raw.trim() !== token) {
    interruptedWakes.delete(host)
    return false
  }
  await releaseOrcadActivationFence(options)
  interruptedWakes.delete(host)
  return true
}
