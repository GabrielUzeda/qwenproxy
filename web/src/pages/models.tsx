import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Search, Box, Cpu, BarChart3 } from 'lucide-react'
import { api, type ModelInfo } from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

function formatContextWindow(n: number): string {
  if (n >= 1000000) return `${n / 1000000}M`
  if (n >= 1000) return `${Math.round(n / 1000)}K`
  return String(n)
}

export function ModelsPage() {
  const [models, setModels] = useState<ModelInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  const load = useCallback(async () => {
    try {
      const data = await api.models()
      setModels(data)
      setLoading(false)
    } catch (err: any) {
      toast.error(err?.message || 'Falha ao carregar modelos')
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    const interval = setInterval(load, 30000)
    return () => clearInterval(interval)
  }, [load])

  const filtered = useMemo(() => {
    const term = search.toLowerCase()
    return models
      .filter((m) => m.id.toLowerCase().includes(term))
      .sort((a, b) => b.requestCount - a.requestCount)
  }, [models, search])

  const totalModels = models.length
  const totalRequests = models.reduce((sum, m) => sum + m.requestCount, 0)
  const mostUsed = models.length > 0 ? [...models].sort((a, b) => b.requestCount - a.requestCount)[0] : null

  if (loading) {
    return (
      <div className="flex flex-col gap-6">
        <div className="grid gap-4 sm:grid-cols-3">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Models</CardTitle>
              <Box className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-8 w-20" />
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Requests</CardTitle>
              <Cpu className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-8 w-20" />
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Most Used Model</CardTitle>
              <BarChart3 className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-8 w-32" />
            </CardContent>
          </Card>
        </div>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Model Registry</CardTitle>
            <Skeleton className="h-4 w-48" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-64 w-full" />
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Models</CardTitle>
            <Box className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalModels}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Requests</CardTitle>
            <Cpu className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalRequests.toLocaleString()}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Most Used Model</CardTitle>
            <BarChart3 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-lg font-semibold truncate">{mostUsed?.id || '—'}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Model Registry</CardTitle>
          <CardDescription>
            {totalModels} model(s) registered · {totalRequests.toLocaleString()} total request(s)
          </CardDescription>
          <div className="relative mt-4">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search models..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
        </CardHeader>
        <CardContent>
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Box className="h-12 w-12 text-muted-foreground mb-4" />
              <p className="text-lg font-medium text-muted-foreground">
                {models.length === 0 ? 'No model usage recorded yet' : 'No models match your search'}
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Model ID</TableHead>
                  <TableHead>Context Window</TableHead>
                  <TableHead className="text-right">Request Count</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="font-mono text-sm">{m.id}</TableCell>
                    <TableCell>{formatContextWindow(m.contextWindow)}</TableCell>
                    <TableCell className="text-right">
                      <Badge variant="secondary">{m.requestCount.toLocaleString()}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
