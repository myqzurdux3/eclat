export interface RateGovernorOptions {
  /** Cadence visée, plafonnée à 30 Hz par la spec. */
  targetHz?: number
  /** Cadence plancher, sous laquelle on ne descend jamais. */
  minHz?: number
  now?: () => number
  /** Au-delà de ce rapport intervalle réel / intervalle visé, ça dérive. */
  driftRatio?: number
  /** Nombre d'intervalles consécutifs avant de réagir. */
  patience?: number
}

const STEP_HZ = 5

/**
 * Régule la cadence d'émission.
 *
 * Au-delà de 25-30 Hz les panneaux droppent des trames de façon visible. Le
 * régulateur plafonne donc la cadence, et la baisse si les envois réels
 * traînent — c'est la boucle appelante qui dérive, pas le réseau, et
 * insister ne ferait qu'aggraver le retard.
 */
export class RateGovernor {
  private readonly targetHz: number
  private readonly minHz: number
  private readonly now: () => number
  private readonly driftRatio: number
  private readonly patience: number

  private currentHz: number
  private lastSentAt: number | null = null
  private drifting = 0
  private healthy = 0

  constructor(options: RateGovernorOptions = {}) {
    this.targetHz = options.targetHz ?? 30
    this.minHz = options.minHz ?? 10
    this.now = options.now ?? Date.now
    this.driftRatio = options.driftRatio ?? 1.25
    this.patience = options.patience ?? 3
    this.currentHz = this.targetHz
  }

  get hz(): number {
    return this.currentHz
  }

  get intervalMs(): number {
    return 1000 / this.currentHz
  }

  /** Vrai si l'intervalle minimal est écoulé depuis le dernier envoi. */
  shouldSend(): boolean {
    if (this.lastSentAt === null) return true
    return this.now() - this.lastSentAt >= this.intervalMs
  }

  /** À appeler juste après un envoi effectif. */
  recordSent(): void {
    const at = this.now()

    if (this.lastSentAt !== null) {
      const elapsed = at - this.lastSentAt
      if (elapsed > this.intervalMs * this.driftRatio) {
        this.drifting += 1
        this.healthy = 0
      } else {
        this.healthy += 1
        this.drifting = 0
      }

      if (this.drifting >= this.patience) {
        this.currentHz = Math.max(this.minHz, this.currentHz - STEP_HZ)
        this.drifting = 0
      } else if (this.healthy >= this.patience * 4) {
        this.currentHz = Math.min(this.targetHz, this.currentHz + STEP_HZ)
        this.healthy = 0
      }
    }

    this.lastSentAt = at
  }
}
