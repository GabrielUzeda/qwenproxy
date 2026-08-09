import { useEffect, useState } from 'react'
import { Activity, KeyRound, Layers, Server, Settings, TerminalSquare } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Login } from '@/components/login'
import { OverviewPage } from '@/pages/overview'
import { AccountsPage } from '@/pages/accounts'
import { UsersPage } from '@/pages/users'
import { SettingsPage } from '@/pages/settings'
import { MetricsPage } from '@/pages/metrics'

type View = 'overview' | 'accounts' | 'users' | 'settings' | 'metrics'

const NAV: { id: View; label: string; icon: any }[] = [
  { id: 'overview', label: 'Visão geral', icon: Activity },
  { id: 'accounts', label: 'Contas', icon: Server },
  { id: 'users', label: 'API Keys', icon: KeyRound },
  { id: 'settings', label: 'Configuração', icon: Settings },
  { id: 'metrics', label: 'Métricas', icon: TerminalSquare },
]

// Self-contained clock so its 1s tick does not re-render the whole dashboard.
function Clock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])
  return (
    <Badge variant="outline" className="font-mono text-xs">
      {now.toLocaleTimeString('pt-BR')}
    </Badge>
  )
}

export function App() {
  const [authed, setAuthed] = useState<boolean | null>(null)
  const [view, setView] = useState<View>('overview')
  const [uptime, setUptime] = useState<string>('—')

  useEffect(() => {
    fetch('/admin/api/session')
      .then((r) => r.json())
      .then((j) => {
        setAuthed(!!j.authenticated)
        if (j.uptime != null) {
          const s = j.uptime
          setUptime(s >= 86400 ? `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h` : `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`)
        }
      })
      .catch(() => setAuthed(false))
  }, [])

  if (authed === null) return null
  if (!authed) return <Login />

  return (
    <div className="flex min-h-svh">
      <aside className="sticky top-0 flex h-svh w-60 shrink-0 flex-col overflow-y-auto border-r bg-muted/20">
        <div className="flex items-center justify-center px-5 py-7">
          <img src={`${import.meta.env.BASE_URL}qwenproxy.png`} alt="QwenProxy" className="h-16 w-auto shrink-0 object-contain" />
        </div>
        <Separator />
        <nav className="flex flex-1 flex-col gap-1 p-2">
          {NAV.map((item) => {
            const Icon = item.icon
            return (
              <button
                key={item.id}
                className={cn(
                  'flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors hover:bg-accent hover:text-accent-foreground text-muted-foreground',
                  view === item.id && 'bg-accent text-accent-foreground'
                )}
                onClick={() => setView(item.id)}
              >
                <Icon className="size-4" />
                {item.label}
              </button>
            )
          })}
        </nav>
        <div className="space-y-3 border-t p-4 text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <Layers className="size-3" /> uptime {uptime}
          </div>
          <div className="flex items-center gap-2">
            <span className="relative flex size-2">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-60" />
              <span className="relative inline-flex size-2 rounded-full bg-emerald-400" />
            </span>
            online
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              fetch('/admin/api/logout', { method: 'POST' }).finally(() => window.location.replace('/admin'))
            }}
          >
            <Button type="submit" variant="outline" size="sm" className="w-full">
              Sair
            </Button>
          </form>
        </div>
      </aside>
      <main className="min-w-0 flex-1">
        <header className="sticky top-0 z-10 flex items-center justify-between border-b bg-background/90 px-6 py-3 backdrop-blur lg:px-8">
          <h1 className="text-sm font-semibold uppercase tracking-widest text-foreground">{NAV.find((n) => n.id === view)?.label}</h1>
          <div className="flex items-center gap-3">
            <Clock />
          </div>
        </header>
        <div className="p-6 lg:p-8">{view === 'overview' && <OverviewPage />}
          {view === 'accounts' && <AccountsPage />}
          {view === 'users' && <UsersPage />}
          {view === 'settings' && <SettingsPage />}
          {view === 'metrics' && <MetricsPage />}
        </div>
      </main>
    </div>
  )
}