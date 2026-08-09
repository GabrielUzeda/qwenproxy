import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Download, RotateCcw, Save } from 'lucide-react'
import { api, type SettingsData } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'

export function SettingsPage() {
  const [data, setData] = useState<SettingsData | null>(null)
  const [values, setValues] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    try {
      const d = await api.settings()
      setData(d)
      setValues({ ...d.settings })
    } catch (err: any) {
      toast.error(err?.message || 'Falha ao carregar configuração')
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  function setValue(key: string, v: string) {
    setValues((prev) => ({ ...prev, [key]: v }))
  }

  if (!data) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-16" />
        ))}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Configuração essencial</CardTitle>
          <CardDescription>Variáveis do `.env` — requerem restart para aplicar</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {data.allowlist.map((key) => {
              const type = data.types?.[key] || 'string'
              const value = values[key] ?? ''
              return (
                <div key={key} className="grid gap-2">
                  <Label htmlFor={`cfg-${key}`} className="font-mono text-xs">
                    {key}
                  </Label>
                  {type === 'bool' ? (
                    <div className="flex h-9 items-center gap-3 rounded-md border px-3">
                      <Switch id={`cfg-${key}`} checked={value === 'true'} onCheckedChange={(c) => setValue(key, c ? 'true' : 'false')} />
                      <span className="text-sm text-muted-foreground">{value === 'true' ? 'true' : 'false'}</span>
                    </div>
                  ) : (
                    <Input id={`cfg-${key}`} type={type === 'int' ? 'number' : 'text'} value={value} onChange={(e) => setValue(key, e.target.value)} />
                  )}
                </div>
              )
            })}
          </div>
          <Separator className="my-6" />
          <div className="flex flex-wrap items-center gap-3">
            <Button
              disabled={saving}
              onClick={async () => {
                setSaving(true)
                try {
                  const patch: Record<string, string> = {}
                  for (const key of data.allowlist) {
                    const v = values[key] ?? ''
                    if (v !== '') patch[key] = v
                  }
                  const res = await api.saveSettings(patch)
                  toast.success(res.restartRequired ? 'Salvo. Reinicie o servidor para aplicar.' : 'Salvo')
                  load()
                } catch (err: any) {
                  toast.error(err?.message || 'Falha ao salvar')
                } finally {
                  setSaving(false)
                }
              }}
            >
              <Save /> Salvar
            </Button>
            <Button
              variant="outline"
              disabled={saving}
              onClick={() => setValues({ ...data.settings })}
            >
              <RotateCcw /> Descartar
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Ações</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3">
            <Button
              variant="destructive"
              onClick={() => {
                if (!confirm('Reiniciar o servidor agora?')) return
                fetch('/admin/api/restart', { method: 'POST' })
                  .then(() => toast.success('Reiniciando…'))
                  .catch((e) => toast.error(e.message))
                setTimeout(() => window.location.reload(), 1500)
              }}
            >
              Reiniciar servidor
            </Button>
            <Button
              variant="outline"
              onClick={async () => {
                const text = await api.metrics()
                const a = document.createElement('a')
                a.href = `data:text/plain;charset=utf-8,${encodeURIComponent(text)}`
                a.download = 'metrics.txt'
                a.click()
              }}
            >
              <Download /> Baixar métricas
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}