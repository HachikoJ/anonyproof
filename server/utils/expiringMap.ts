export interface CleanupTimer {
  unref?: () => unknown
  close: () => void
}

export interface ExpiringMapOptions<V> {
  maxEntries: number
  expiresAt: (value: V) => number
  onCapacity?: 'reject' | 'evict-oldest'
  now?: () => number
  cleanupIntervalMs?: number
  scheduleCleanup?: (callback: () => void, intervalMs: number) => CleanupTimer
}

export class ExpiringMapCapacityError extends Error {
  readonly code = 'EXPIRING_MAP_CAPACITY'

  constructor() {
    super('Temporary state capacity reached')
    this.name = 'ExpiringMapCapacityError'
  }
}

function scheduleCleanup(callback: () => void, intervalMs: number): CleanupTimer {
  const timer = setInterval(callback, intervalMs)
  return {
    unref: () => timer.unref(),
    close: () => clearInterval(timer),
  }
}

/** Process-local TTL storage. Eviction order is the oldest successful set. */
export class ExpiringMap<K, V> {
  private readonly entries = new Map<K, { value: V; expiresAt: number }>()
  private readonly now: () => number
  private readonly timer: CleanupTimer
  private closed = false

  constructor(private readonly options: ExpiringMapOptions<V>) {
    const intervalMs = options.cleanupIntervalMs ?? 60_000
    if (!Number.isInteger(options.maxEntries) || options.maxEntries < 1) {
      throw new RangeError('maxEntries must be a positive integer')
    }
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
      throw new RangeError('cleanupIntervalMs must be positive and finite')
    }
    this.now = options.now ?? Date.now
    this.timer = (options.scheduleCleanup ?? scheduleCleanup)(() => this.cleanup(), intervalMs)
    this.timer.unref?.()
  }

  /** Includes expired entries awaiting the next scheduled sweep. */
  get size(): number {
    return this.entries.size
  }

  get(key: K): V | undefined {
    const entry = this.entries.get(key)
    if (!entry) return undefined
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key)
      return undefined
    }
    return entry.value
  }

  set(key: K, value: V): this {
    const expiresAt = this.options.expiresAt(value)
    if (!Number.isFinite(expiresAt)) {
      throw new RangeError('Entry expiry must be finite')
    }
    if (expiresAt <= this.now()) {
      this.entries.delete(key)
      return this
    }
    if (!this.entries.has(key) && this.entries.size >= this.options.maxEntries) {
      this.cleanup()
      if (this.entries.size >= this.options.maxEntries) {
        if (this.options.onCapacity !== 'evict-oldest') {
          throw new ExpiringMapCapacityError()
        }
        // Capacity is positive and the map is nonempty here. Preserve K=undefined.
        const oldest = this.entries.keys().next()
        if (!oldest.done) this.entries.delete(oldest.value)
      }
    }
    this.entries.delete(key)
    this.entries.set(key, { value, expiresAt })
    return this
  }

  delete(key: K): boolean {
    return this.entries.delete(key)
  }

  cleanup(): number {
    const now = this.now()
    let removed = 0
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) {
        this.entries.delete(key)
        removed++
      }
    }
    return removed
  }

  /** Stop automatic sweeping; safe to call repeatedly during process shutdown. */
  close(): void {
    if (this.closed) return
    this.closed = true
    this.timer.close()
  }
}
