/**
 * Memory-pressure gate. Uses RSS against the configured watchdog thresholds to
 * decide whether the proxy should throttle concurrency (adaptive serialization)
 * before RAM becomes a problem — the cheap, safe way to "shrink lanes" without
 * tearing down Playwright contexts.
 */

import os from 'os'
import { config } from './config.js'

export type MemoryPressure = 'none' | 'high' | 'critical'

export function getMemoryPressure(): MemoryPressure {
  const mem = process.memoryUsage()
  const total = os.totalmem()
  if (total <= 0) return 'none'
  const pct = (mem.rss / total) * 100
  if (pct > config.watchdog.ram.criticalThreshold) return 'critical'
  if (pct > config.watchdog.ram.warningThreshold) return 'high'
  return 'none'
}

/** % of system RAM used by this process (RSS). */
export function getMemoryUsagePct(): number {
  const mem = process.memoryUsage()
  const total = os.totalmem()
  return total > 0 ? Number(((mem.rss / total) * 100).toFixed(1)) : 0
}