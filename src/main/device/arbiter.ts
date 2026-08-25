import type { SourceId } from '../../shared/types'

export type { SourceId }

/** How long a manual stroke keeps control. */
export const MANUAL_HOLD_MS = 3000

/** The lower the rank, the higher the priority. */
const RANK: Record<Exclude<SourceId, 'manual'>, number> = {
  screen: 1,
  audio: 2,
}

export interface ArbiterOptions {
  now?: () => number
  manualHoldMs?: number
}

/**
 * Decides which source may write. Never touches the network: `stream.ts`
 * remains the only writer of the socket.
 *
 * The combined screen + audio mode does not appear here: the spec makes it a
 * single producer reading two inputs, not two competing writers.
 */
export class SourceArbiter {
  private readonly now: () => number
  private readonly manualHoldMs: number
  private readonly active = new Set<Exclude<SourceId, 'manual'>>()
  private manualUntil = 0

  constructor(options: ArbiterOptions = {}) {
    this.now = options.now ?? Date.now
    this.manualHoldMs = options.manualHoldMs ?? MANUAL_HOLD_MS
  }

  activate(source: SourceId): void {
    if (source === 'manual') {
      this.touchManual()
      return
    }
    this.active.add(source)
  }

  deactivate(source: SourceId): void {
    if (source === 'manual') {
      this.manualUntil = 0
      return
    }
    this.active.delete(source)
  }

  /** Signals a manual stroke: takes control for `manualHoldMs`. */
  touchManual(): void {
    this.manualUntil = this.now() + this.manualHoldMs
  }

  /** The source allowed to write, or `null` if the device keeps its effect. */
  current(): SourceId | null {
    if (this.now() < this.manualUntil) return 'manual'

    let elected: Exclude<SourceId, 'manual'> | null = null
    for (const source of this.active) {
      if (elected === null || RANK[source] < RANK[elected]) elected = source
    }
    return elected
  }

  accepts(source: SourceId): boolean {
    return this.current() === source
  }

  reset(): void {
    this.active.clear()
    this.manualUntil = 0
  }
}
