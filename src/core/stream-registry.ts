import { metrics } from './metrics.js'

export interface StreamRegistryEntry {
  abortController: AbortController;
  accountId: string;
  uiSessionId: string;
  targetResponseId: string;
  headers: Record<string, string>;
  stopToken: string;
  createdAt: number;
}

const activeStreams = new Map<string, StreamRegistryEntry>();

export function registerStream(
  key: string,
  entry: Omit<StreamRegistryEntry, 'createdAt'> & { createdAt?: number },
): void {
  activeStreams.set(key, { ...entry, createdAt: entry.createdAt ?? Date.now() })
  metrics.gauge('streams.active', activeStreams.size)
}

export function getStreamRegistry(): Map<string, StreamRegistryEntry> {
  return activeStreams
}

export function getStream(key: string): StreamRegistryEntry | undefined {
  return activeStreams.get(key)
}

export function removeStream(key: string): void {
  activeStreams.delete(key)
  metrics.gauge('streams.active', activeStreams.size)
}

export function abortStream(key: string): boolean {
  const entry = activeStreams.get(key)
  if (entry) {
    entry.abortController.abort()
    activeStreams.delete(key)
    metrics.gauge('streams.active', activeStreams.size)
    return true
  }
  return false
}