import { useMemo, useRef, useState } from 'react'
import { Activity, AlertTriangle, BarChart3, Download, Gauge, Layers, MemoryStick, Wifi, WifiOff } from 'lucide-react'
import { fmtBytes, fmtSec } from '@/lib/api'
import { useLiveOverview } from '@/hooks/use-live'
import { AreaTrend, ChartCard, LineTrend, BarTrend } from '@/components/charts'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Area, AreaChart, Cell, Pie, PieChart, ResponsiveContainer } from 'recharts'
import { toPng } from 'html-to-image'

const DONUT_COLORS = ['#34d399', '#f5b842', '#a78bfa', '#ff6b5e', '#5ee6d6']

function Sparkline({ data, color = '#34d399' }: { data: { t: number; v: number }[]; color?: string }) {
  if (!data.length) return null
  return (
    <ResponsiveContainer width="100%" height={40}>
      <AreaChart data={data.map((d) => ({ v: d.v }))} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
        <Area type="monotone" dataKey="v" stroke={color} strokeWidth={1.5} fill={color} fillOpacity={0.2} isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  )
}

function Kpi({ icon: Icon, label, value, suffix, tone, sparkData, sparkColor }: { icon: any; label: string; value: React.ReactNode; suffix?: React.ReactNode; tone?: 'ok' | 'warn' | 'bad'; sparkData?: { t: number; v: number }[]; sparkColor?: string }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
        <Icon className="size-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className={`text-2xl font-bold ${tone === 'bad' ? 'text-destructive' : tone === 'warn' ? 'text-amber-400' : tone === 'ok' ? 'text-emerald-400' : ''}`}>
          {value}
        </div>
        {suffix ? <p className="mt-1 text-xs text-muted-foreground">{suffix}</p> : null}
        {sparkData ? <Sparkline data={sparkData} color={sparkColor} /> : null}
      </CardContent>
    </Card>
  )
}

function LoadBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0
  const tone = pct >= 80 ? 'bg-red-500' : pct >= 50 ? 'bg-amber-400' : 'bg-emerald-400'
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-muted">
        <div className={`h-full ${tone} transition-all`} style={{ width: `${pct}%` }} />
      </div>
      <span className="font-mono text-xs text-muted-foreground">{value}</span>
    </div>
  )
}

function ConnBadge({ mode }: { mode: string }) {
  if (mode === 'live')
    return (
      <Badge variant="outline" className="gap-1.5 text-emerald-400">
        <Wifi className="size-3" /> tempo real
      </Badge>
    )
  return (
    <Badge variant="outline" className="gap-1.5 text-amber-400">
      <WifiOff className="size-3" /> polling 4s
    </Badge>
  )
}

export function OverviewPage() {
  const { data, mode, lastUpdate } = useLiveOverview()
  const kpiRef = useRef<HTMLDivElement>(null)
  const [compareMode, setCompareMode] = useState(false)

  const charts = useMemo(() => {
    if (!data?.series) return null
    return {
      requests: (data.series.requests || []).map((d) => ({ t: d.t, v: Math.round(d.v * 12) })),
      errors: data.series.errors || [],
      latency: data.series.latency || [],
      streams: data.series.streams ?? [],
      memory: data.series.memory || [],
      sessions: data.series.sessions || [],
    }
  }, [data])

  const busiestAccount = useMemo(() => {
    if (!data?.accounts.length) return null
    return data.accounts.reduce((max, acc) => (acc.activeLoad > max.activeLoad ? acc : max), data.accounts[0])
  }, [data])

  const loadDistribution = useMemo(() => {
    if (!data?.accounts.length) return []
    return data.accounts.map((acc) => ({ name: acc.email.split('@')[0], value: acc.activeLoad }))
  }, [data])

  const handleExportPng = async () => {
    if (!kpiRef.current) return
    try {
      const dataUrl = await toPng(kpiRef.current, { backgroundColor: '#09090b', pixelRatio: 2 })
      const link = document.createElement('a')
      link.download = `overview-kpis-${Date.now()}.png`
      link.href = dataUrl
      link.click()
    } catch (err) {
      console.error('Export failed', err)
    }
  }

  const errorTimerText = useMemo(() => {
    if (!data) return ''
    if (data.requestsErrors === 0) {
      const uptimeHours = Math.floor(data.uptime / 3600000)
      if (uptimeHours > 0) return `sem erros há ${uptimeHours}h`
      return 'sem erros'
    }
    return 'último erro recente'
  }, [data])

  return (
    <div className="flex flex-col gap-6">
      <div ref={kpiRef} className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <Kpi
          icon={Activity}
          label="Requisições"
          value={data?.requestsTotal.toLocaleString('pt-BR') ?? '…'}
          suffix={charts ? `${charts.requests[charts.requests.length - 1]?.v ?? 0} req/min agora` : '…'}
          sparkData={charts?.requests.slice(-20)}
          sparkColor="#34d399"
        />
        <Kpi
          icon={AlertTriangle}
          label="Erros"
          value={data?.requestsErrors ?? '…'}
          tone={data && data.requestsErrors ? 'bad' : 'ok'}
          suffix={data ? `${data.requestsSuccessRate.toFixed(1)}% sucesso · ${errorTimerText}` : ''}
          sparkData={charts?.errors.slice(-20)}
          sparkColor="#ff6b5e"
        />
        <Kpi
          icon={Gauge}
          label="Latência média"
          value={data ? `${data.latency?.count ? Math.round(data.latency.sum / data.latency.count) : 0}ms` : '…'}
          suffix={charts && `últ: ${charts.latency[charts.latency.length - 1]?.v ?? '—'}ms`}
          sparkData={charts?.latency.slice(-20)}
          sparkColor="#f5b842"
        />
        <Kpi
          icon={Layers}
          label="Streams ativos"
          value={data?.totalUserStreams ?? '…'}
          tone="ok"
          sparkData={charts?.streams.slice(-20)}
          sparkColor="#5ee6d6"
        />
        <Kpi
          icon={Activity}
          label="Sessões"
          value={data?.sessionCount ?? '…'}
          sparkData={charts?.sessions.slice(-20)}
          sparkColor="#f5b842"
        />
        <Kpi
          icon={MemoryStick}
          label="Memória (RSS)"
          value={data ? `${data.memory.pct.toFixed(1)}%` : '…'}
          tone={data && data.memory.pct > 85 ? 'bad' : data && data.memory.pct > 70 ? 'warn' : undefined}
          suffix={data && `${fmtBytes(data.memory.rss)} / ${fmtBytes(data.memory.systemTotal)}`}
          sparkData={charts?.memory.slice(-20)}
          sparkColor="#a78bfa"
        />
      </div>

      {charts ? (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard title="Requisições / min" icon={BarChart3} badge={<ConnBadge mode={mode} />}>
              <BarTrend data={charts.requests} color="#34d399" unit="req/min" />
            </ChartCard>
            <ChartCard title="Latência média" icon={Gauge} badge={data?.latency?.count ? <Badge variant="secondary" className="font-mono">{Math.round((data.latency?.sum ?? 0) / (data.latency?.count || 1))}ms</Badge> : undefined}>
              <LineTrend data={charts.latency} color="#f5b842" unit="ms" />
            </ChartCard>
            <ChartCard title="Streams ativos" icon={Layers} badge={<Badge variant="secondary" className="font-mono">{data?.activeStreamsMetric || 0}</Badge>}>
              <AreaTrend data={charts.streams} color="#5ee6d6" unit="streams" />
            </ChartCard>
            <ChartCard title="Memória (RSS % do sistema)" icon={MemoryStick} badge={<Badge variant="secondary" className="font-mono">{charts.memory.length ? `${charts.memory[charts.memory.length - 1]?.v ?? 0}%` : '—'}</Badge>}>
              <AreaTrend data={charts.memory} color="#a78bfa" unit="%" />
            </ChartCard>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <ChartCard title="Erros por intervalo" icon={AlertTriangle} badge={<Badge variant="secondary" className="font-mono">{charts.errors.reduce((a, b) => a + b.v, 0)} total</Badge>}>
              <BarTrend data={charts.errors} color="#ff6b5e" unit="erros" height={140} />
            </ChartCard>
            <ChartCard title="Sessões híbridas" icon={Activity} badge={<Badge variant="secondary" className="font-mono">{data?.sessionCount}</Badge>}>
              <AreaTrend data={charts.sessions} color="#f5b842" unit="sessões" height={140} />
            </ChartCard>
          </div>
        </>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-56" />
          ))}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Contas · carga</CardTitle>
              <CardDescription>Lanes configurados: {data?.lanes ?? '—'}</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>E-mail</TableHead>
                    <TableHead className="w-40">Carga</TableHead>
                    <TableHead className="text-right">Cooldown</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data && data.accounts.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={3} className="text-muted-foreground">
                        Nenhuma conta configurada
                      </TableCell>
                    </TableRow>
                  ) : (
                    data?.accounts.map((a) => (
                      <TableRow key={a.id} className={busiestAccount?.id === a.id ? 'bg-amber-500/10' : ''}>
                        <TableCell className="font-mono text-xs">
                          {a.email}
                          {busiestAccount?.id === a.id && (
                            <Badge variant="outline" className="ml-2 text-amber-400">mais carregada</Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <LoadBar value={a.activeLoad} max={Math.max(1, (data?.lanes || 4))} />
                        </TableCell>
                        <TableCell className="text-right">
                          {a.cooldown > 0 ? (
                            <Badge variant="outline" className="text-amber-400">
                              {fmtSec(a.cooldown / 1000)}
                              {a.cooldownReason ? ` · ${a.cooldownReason}` : ''}
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-emerald-400">
                              ok
                            </Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {loadDistribution.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Distribuição de carga</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-center">
                  <ResponsiveContainer width={200} height={200}>
                    <PieChart>
                      <Pie data={loadDistribution} cx="50%" cy="50%" innerRadius={60} outerRadius={80} paddingAngle={2} dataKey="value">
                        {loadDistribution.map((_, idx) => (
                          <Cell key={`cell-${idx}`} fill={DONUT_COLORS[idx % DONUT_COLORS.length]} />
                        ))}
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="mt-4 flex flex-wrap gap-2 justify-center">
                  {loadDistribution.map((item, idx) => (
                    <div key={item.name} className="flex items-center gap-1.5 text-xs">
                      <div className="size-3 rounded-sm" style={{ backgroundColor: DONUT_COLORS[idx % DONUT_COLORS.length] }} />
                      <span className="text-muted-foreground">{item.name}</span>
                      <span className="font-mono font-semibold">{item.value}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Warm pool</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {!data || Object.keys(data.warmPool).length === 0 ? (
                <p className="text-sm text-muted-foreground">Sem chats aquecidos no momento</p>
              ) : (
                Object.entries(data.warmPool).map(([k, v]) => (
                  <div key={k} className="rounded-lg border bg-muted/20 px-3 py-2">
                    <div className="font-mono text-xs text-muted-foreground">{k}</div>
                    <div className="text-lg font-bold">{v}</div>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          Última atualização: {lastUpdate ? lastUpdate.toLocaleTimeString('pt-BR') : '…'} · janela 20min · conexão: {mode}
        </span>
        <div className="flex items-center gap-2">
          <Button
            variant={compareMode ? 'default' : 'outline'}
            size="sm"
            onClick={() => setCompareMode(!compareMode)}
          >
            vs. período anterior
          </Button>
          {compareMode && <Badge variant="secondary">Comparação ativa</Badge>}
          <Button variant="outline" size="sm" onClick={handleExportPng}>
            <Download className="size-3.5 mr-1.5" />
            Exportar PNG
          </Button>
        </div>
      </div>
    </div>
  )
}
