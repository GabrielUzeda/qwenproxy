/**
 * Admin dashboard backend: authenticated API for accounts, API keys, essential
 * settings, metrics and runtime actions.
 */

import { Hono } from 'hono'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import { streamSSE } from 'hono/streaming'
import crypto from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { config } from '../core/config.js'
import { metrics } from '../core/metrics.js'
import { cache } from '../cache/memory-cache.js'
import { addAccount, removeAccount, listAccounts, updateAccountCooldown } from '../core/accounts.js'
import { getWarmPoolStats } from '../services/warm-pool.js'
import {
  getAccountCooldownInfo,
  getAccountActiveLoad,
  getInUseAccounts,
} from '../core/account-manager.js'
import { listUsers, upsertUser, deleteUserById, getUserById } from '../core/database.js'
import { getUserActiveStreams, invalidateUserCache } from '../core/user-manager.js'
import { getSessionCount } from '../services/session-manager.js'
import { getAllSeries } from '../core/time-series.js'
import { getMemoryPressure } from '../core/memory-gate.js'
import { readEnvFile, persistEnvPatch, restartServer, SETTINGS_ALLOWLIST, SETTINGS_SECRETS, BOOLEAN_KEYS, INTEGER_KEYS } from '../core/env-settings.js'
import { renderDashboard } from './admin-dashboard.js'

export const adminApp = new Hono()

const COOKIE_NAME = 'qadmin'
const COOKIE_MAX_AGE = 7 * 24 * 60 * 60 // 7 days

function adminPassword(): string {
  // ADMIN_PASSWORD first; fall back to the proxy API key so operators with a
  // key already set do not need extra config.
  return config.adminPassword || (process.env.API_KEY || config.apiKey) || ''
}

function signSession(expiresAt: number): string {
  const payload = `${expiresAt}:${crypto.randomUUID()}`
  const sig = crypto.createHmac('sha256', `qwenproxy:${adminPassword()}`).update(payload).digest('base64url')
  return `${payload}.${sig}`
}

function verifySession(c: any): boolean {
  const token = getCookie(c, COOKIE_NAME)
  if (!token) return false
  const dot = token.lastIndexOf('.')
  if (dot === -1) return false
  const payload = token.slice(0, dot)
  const sig = token.slice(dot + 1)
  const expected = crypto.createHmac('sha256', `qwenproxy:${adminPassword()}`).update(payload).digest('base64url')
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false
  const [expiresAt] = payload.split(':')
  return Number(expiresAt) > Date.now()
}

async function adminGuard(c: any, next: any) {
  const enabled = adminPassword() !== ''
  if (!enabled) {
    return c.json({ error: 'Admin dashboard disabled. Set ADMIN_PASSWORD (or API_KEY) in .env.' }, 503)
  }
  if (!verifySession(c)) {
    return c.json({ error: 'Não autenticado' }, 401)
  }
  await next()
}

// --- Auth -------------------------------------------------------------------

adminApp.post('/api/login', async (c) => {
  const body = await c.req.json().catch(() => null)
  const password = String(body?.password || '')
  const expected = adminPassword()
  if (!expected) {
    return c.json({ error: 'Dashboard admin desabilitado. Configure ADMIN_PASSWORD no .env.' }, 503)
  }
  const a = Buffer.from(password)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return c.json({ error: 'Senha incorreta' }, 401)
  }
  const expiresAt = Date.now() + COOKIE_MAX_AGE * 1000
  setCookie(c, COOKIE_NAME, signSession(expiresAt), {
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: COOKIE_MAX_AGE,
  })
  return c.json({ ok: true, expiresAt })
})

adminApp.post('/api/logout', async (c) => {
  deleteCookie(c, COOKIE_NAME, { path: '/' })
  return c.json({ ok: true })
})

adminApp.get('/api/session', (c) => {
  const enabled = adminPassword() !== ''
  if (!enabled) return c.json({ authenticated: false, enabled: false, reason: 'ADMIN_PASSWORD not set' })
  return c.json({
    authenticated: verifySession(c),
    enabled: true,
    uptime: Math.floor(process.uptime()),
    version: '1.12.16',
  })
})

// --- Overview / metrics -----------------------------------------------------

adminApp.get('/api/overview', adminGuard, async (c) => {
  return c.json(await buildOverview())
})

async function buildOverview(): Promise<any> {
  const requestsTotal = (metrics.get('requests.total')?.value as number) || 0
  const errors = (metrics.get('requests.errors')?.value as number) || 0
  const latency = metrics.get('latency.request')?.value as any

  const users = listUsers()
  let totalUserStreams = 0
  const userList = users.map(u => {
    const streams = getUserActiveStreams(u.id)
    totalUserStreams += streams
    return { id: u.id, email: u.email, streams }
  })

  const accounts = listAccounts().map(a => ({
    id: a.id,
    email: a.email,
    cooldown: getAccountCooldownInfo(a.id)?.remainingMs ?? 0,
    cooldownReason: getAccountCooldownInfo(a.id)?.reason ?? null,
    activeLoad: getAccountActiveLoad(a.id),
  }))
  const inUse = getInUseAccounts()

  const mem = process.memoryUsage()
  const systemTotal = os.totalmem()
  const memoryPct = systemTotal > 0 ? Number(((mem.rss / systemTotal) * 100).toFixed(1)) : 0

  return {
    uptime: Math.floor(process.uptime()),
    startedAt: Math.floor(Date.now() / 1000) - Math.floor(process.uptime()),
    requestsTotal,
    requestsErrors: errors,
    requestsSuccessRate: requestsTotal > 0 ? Math.max(0, (1 - errors / requestsTotal) * 100) : 100,
    latency: latency && typeof latency === 'object' ? { sum: latency.sum, count: latency.count } : undefined,
    memory: {
      rss: mem.rss,
      heapUsed: mem.heapUsed,
      heapTotal: mem.heapTotal,
      systemTotal,
      pct: memoryPct,
    },
    cpu: { cores: os.cpus().length, load1m: os.loadavg()[0] },
    memoryPressure: getMemoryPressure(),
    series: getAllSeries(),
    cache: (await (cache as any).getStats?.()) || undefined,
    accounts,
    inUseAccounts: [...inUse],
    users: userList,
    totalUserStreams,
    activeStreamsMetric: (metrics.get('streams.active')?.value as number) || 0,
    warmPool: getWarmPoolStats(),
    sessionCount: getSessionCount(),
    guestMode: process.env.QWEN_GUEST_MODE_ONLY === 'true',
    singleAccountMode: config.accounts.singleAccountMode,
    lanes: config.accounts.lanes,
    userRateLimitRpm: config.users.defaultRateLimitRpm,
    userMaxConcurrency: config.users.defaultMaxConcurrency,
    hybridVerify: config.hybridSessions.verify,
  }
}

// --- Live stream (server-sent events) ----------------------------------------
// A single long-lived connection pushes an overview snapshot every few seconds,
// so the dashboard updates in real time with exactly ONE open request instead of
// repeated HTTP polling.

const LIVE_INTERVAL_MS = 3000

adminApp.get('/api/live', adminGuard, (c) => {
  return streamSSE(c, async (stream) => {
    const send = async () => {
      try {
        const payload = await buildOverview()
        await stream.writeSSE({ data: JSON.stringify(payload) })
      } catch { /* client gone */ }
    }

    try {
      await send()
      while (true) {
        await stream.sleep(LIVE_INTERVAL_MS)
        if (c.req.raw.signal.aborted || stream.closed) break
        await send()
      }
    } catch {
      // Client disconnected — stop the loop.
    }
  })
})

// --- Accounts ---------------------------------------------------------------

adminApp.get('/api/accounts', adminGuard, (c) => {
  const accounts = listAccounts().map(a => ({
    ...a,
    password: '***',
    cooldown: getAccountCooldownInfo(a.id)?.remainingMs ?? 0,
    cooldownReason: getAccountCooldownInfo(a.id)?.reason ?? null,
    activeLoad: getAccountActiveLoad(a.id),
  }))
  return c.json({ accounts, inUse: [...getInUseAccounts()] })
})

adminApp.post('/api/accounts', adminGuard, async (c) => {
  const body: any = await c.req.json().catch(() => null)
  const email = String(body?.email || '').trim()
  const password = String(body?.password || '')
  if (!email || !password) return c.json({ error: 'email e password são obrigatórios' }, 400)
  try {
    const account = addAccount(email, password)
    return c.json({ ok: true, account: { ...account, password: '***' } })
  } catch (err: any) {
    return c.json({ error: err.message }, 400)
  }
})

adminApp.delete('/api/accounts/:id', adminGuard, (c) => {
  const id = c.req.param('id')
  const removed = removeAccount(id)
  return c.json({ ok: removed })
})

adminApp.post('/api/accounts/:id/clear-cooldown', adminGuard, (c) => {
  updateAccountCooldown(c.req.param('id'), 0, null)
  return c.json({ ok: true })
})

adminApp.post('/api/accounts/:id/refresh', adminGuard, async (c) => {
  try {
    const { getQwenHeaders } = await import('../services/playwright.js')
    const { headers } = await getQwenHeaders(true, c.req.param('id'))
    return c.json({ ok: true, cookie: Boolean(headers?.cookie), bxUa: Boolean(headers?.['bx-ua']) })
  } catch (err: any) {
    return c.json({ error: err.message }, 400)
  }
})

// --- Users / API keys -------------------------------------------------------

adminApp.get('/api/users', adminGuard, (c) => {
  const userInfo = listUsers().map(u => ({
    id: u.id,
    email: u.email,
    apiKey: u.api_key,
    rateLimitRpm: u.rate_limit_rpm || config.users.defaultRateLimitRpm,
    maxConcurrency: u.max_concurrency || config.users.defaultMaxConcurrency,
    activeStreams: getUserActiveStreams(u.id),
  }))
  return c.json(userInfo)
})

adminApp.post('/api/users', adminGuard, async (c) => {
  const body: any = await c.req.json().catch(() => null)
  const apiKey = String(body?.apiKey || '').trim()
  const id = String(body?.id || '').trim() || `user-${crypto.randomUUID().slice(0, 8)}`
  if (!apiKey) return c.json({ error: 'apiKey é obrigatório' }, 400)
  try {
    upsertUser({
      id,
      email: body?.email || id,
      apiKey,
      rateLimitRpm: Number(body?.rateLimitRpm) || config.users.defaultRateLimitRpm,
      maxConcurrency: Number(body?.maxConcurrency) || config.users.defaultMaxConcurrency,
    })
    invalidateUserCache()
    return c.json({ ok: true, id })
  } catch (err: any) {
    return c.json({ error: err.message }, 400)
  }
})

adminApp.put('/api/users/:id', adminGuard, async (c) => {
  const id = c.req.param('id')
  const body: any = await c.req.json().catch(() => null)
  if (!id) return c.json({ error: 'id é obrigatório' }, 400)
  try {
    const existing = getUserById(id)
    upsertUser({
      id,
      email: body?.email ?? existing?.email ?? id,
      apiKey: body?.apiKey ?? existing?.api_key,
      rateLimitRpm: Number(body?.rateLimitRpm) || config.users.defaultRateLimitRpm,
      maxConcurrency: Number(body?.maxConcurrency) || config.users.defaultMaxConcurrency,
    })
    invalidateUserCache()
    return c.json({ ok: true })
  } catch (err: any) {
    return c.json({ error: err.message }, 400)
  }
})

adminApp.delete('/api/users/:id', adminGuard, (c) => {
  deleteUserById(c.req.param('id'))
  invalidateUserCache()
  return c.json({ ok: true })
})

// --- Settings ---------------------------------------------------------------

adminApp.get('/api/settings', adminGuard, (c) => {
  const env = readEnvFile()
  const safe: Record<string, string> = {}
  const types: Record<string, string> = {}
  for (const key of SETTINGS_ALLOWLIST) {
    if (BOOLEAN_KEYS.has(key)) types[key] = 'bool'
    else if (INTEGER_KEYS.has(key)) types[key] = 'int'
    else types[key] = 'string'
  }
  for (const key of Object.keys(env)) {
    if (SETTINGS_ALLOWLIST.has(key)) safe[key] = env[key]
    else if (SETTINGS_SECRETS.has(key)) safe[key] = env[key] ? '••••••••' : ''
  }
  return c.json({
    settings: safe,
    types,
    allowlist: [...SETTINGS_ALLOWLIST],
    locked: [...SETTINGS_SECRETS],
    effective: {
      warmPoolSize: config.warmPool.size,
      lanes: config.accounts.lanes,
      singleAccountMode: config.accounts.singleAccountMode,
      hybridVerify: config.hybridSessions.verify,
      userRateLimitRpm: config.users.defaultRateLimitRpm,
      userMaxConcurrency: config.users.defaultMaxConcurrency,
    },
  })
})

adminApp.post('/api/settings', adminGuard, async (c) => {
  const body: any = await c.req.json().catch(() => null)
  if (!body || typeof body !== 'object') return c.json({ error: 'patch inválido' }, 400)
  try {
    const applied = persistEnvPatch(body)
    return c.json({ ok: true, applied, restartRequired: applied.length > 0 })
  } catch (err: any) {
    return c.json({ error: err.message }, 400)
  }
})

adminApp.post('/api/restart', adminGuard, (c) => {
  restartServer()
  return c.json({ ok: true, restarting: true })
})

// --- Raw Prometheus metrics -------------------------------------------------

adminApp.get('/api/metrics', adminGuard, (c) => {
  return c.text(metrics.formatPrometheus(), { headers: { 'Content-Type': 'text/plain; version=0.0.4' } })
})

// --- SPA (React + shadcn build) ---------------------------------------------

const WEB_DIST = path.resolve('web', 'dist')

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
}

function distFileSafe(rel: string): string | null {
  const resolved = path.normalize(path.join(WEB_DIST, rel))
  if (!resolved.startsWith(WEB_DIST + path.sep) && resolved !== WEB_DIST) return null
  try {
    if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) return resolved
  } catch { /* ignore */ }
  return null
}

adminApp.get('/assets/*', (c) => {
  const rel = c.req.path.replace(/^\/admin\/?/, '')
  const file = distFileSafe(rel)
  if (!file) return c.notFound()
  const ext = path.extname(file).toLowerCase()
  return c.body(fs.readFileSync(file), 200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': 'public, max-age=31536000, immutable',
  })
})

adminApp.get('*', (c) => {
  // API-only paths should not fall through to the SPA.
  if (c.req.path.startsWith('/api')) return c.notFound()
  const rel = c.req.path.replace(/^\/admin\/?/, '') || 'index.html'
  // Serve real files from the built app (index.html, public/ assets, etc.);
  // unknown paths fall back to index.html for SPA routing.
  const file = distFileSafe(rel) || distFileSafe('index.html')
  if (!file) {
    // Legacy inline dashboard (built web/ not present).
    if (verifySession(c)) return c.html(renderDashboard(false))
    return c.html(renderDashboard(true))
  }
  const ext = path.extname(file).toLowerCase()
  if (ext === '.html' || rel === 'index.html') {
    return c.html(fs.readFileSync(file, 'utf-8'))
  }
  return c.body(fs.readFileSync(file), 200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': 'public, max-age=31536000, immutable',
  })
})