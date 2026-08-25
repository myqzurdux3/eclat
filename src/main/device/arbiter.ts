import type { SourceId } from '../../shared/types'

export type { SourceId }

/** Durée pendant laquelle une peinture manuelle garde la main. */
export const MANUAL_HOLD_MS = 3000

/** Plus le rang est bas, plus la source est prioritaire. */
const RANK: Record<Exclude<SourceId, 'manual'>, number> = {
  screen: 1,
  audio: 2,
}

export interface ArbiterOptions {
  now?: () => number
  manualHoldMs?: number
}

/**
 * Décide quelle source a le droit d'écrire. Ne touche jamais au réseau :
 * `stream.ts` reste le seul writer de la socket.
 *
 * Le mode combiné écran + audio n'apparaît pas ici : la spec en fait un
 * producteur unique lisant deux entrées, pas deux writers concurrents.
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

  /** Signale une peinture manuelle : prend la main pour `manualHoldMs`. */
  touchManual(): void {
    this.manualUntil = this.now() + this.manualHoldMs
  }

  /** Source autorisée à écrire, ou `null` si le device garde son effet. */
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
