import { useRef, useState } from 'react'
import { Copy, MessageSquare, Send, Square, Trash2 } from 'lucide-react'
import { api } from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'

export function PlaygroundPage() {
  const [model, setModel] = useState('qwen-plus')
  const [systemPrompt, setSystemPrompt] = useState('')
  const [userMessage, setUserMessage] = useState('')
  const [stream, setStream] = useState(true)
  const [thinking, setThinking] = useState(false)
  const [loading, setLoading] = useState(false)
  const [response, setResponse] = useState('')
  const [thinkingContent, setThinkingContent] = useState('')
  const abortRef = useRef<AbortController | null>(null)

  async function handleSend() {
    if (!userMessage.trim()) return

    setLoading(true)
    setResponse('')
    setThinkingContent('')

    const messages: Array<{ role: string; content: string }> = []
    if (systemPrompt.trim()) {
      messages.push({ role: 'system', content: systemPrompt.trim() })
    }
    messages.push({ role: 'user', content: userMessage.trim() })

    const payload: Parameters<typeof api.testChat>[0] = {
      model,
      messages,
      stream,
    }
    if (thinking) {
      payload.thinking = { type: 'enabled' }
    }

    const controller = new AbortController()
    abortRef.current = controller

    try {
      const res = await api.testChat(payload)
      if (!res.ok) {
        const err = await res.text()
        setResponse(`Error ${res.status}: ${err}`)
        setLoading(false)
        return
      }

      if (stream) {
        const reader = res.body?.getReader()
        if (!reader) {
          setResponse('No response body')
          setLoading(false)
          return
        }

        const decoder = new TextDecoder()
        let buffer = ''

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6)
              if (data === '[DONE]') continue

              try {
                const json = JSON.parse(data)
                const delta = json.choices?.[0]?.delta
                if (delta?.content) {
                  setResponse((prev) => prev + delta.content)
                }
                if (delta?.reasoning_content) {
                  setThinkingContent((prev) => prev + delta.reasoning_content)
                }
              } catch {
                /* skip malformed chunks */
              }
            }
          }
        }
      } else {
        const json = await res.json()
        const message = json.choices?.[0]?.message
        if (message?.content) {
          setResponse(message.content)
        }
        if (message?.reasoning_content) {
          setThinkingContent(message.reasoning_content)
        }
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        setResponse(`Error: ${err.message}`)
      }
    } finally {
      setLoading(false)
      abortRef.current = null
    }
  }

  function handleStop() {
    abortRef.current?.abort()
  }

  function handleClear() {
    setResponse('')
    setThinkingContent('')
    setUserMessage('')
  }

  async function handleCopy() {
    if (response) {
      await navigator.clipboard.writeText(response)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <MessageSquare className="size-4" />
            API Playground
          </CardTitle>
          <CardDescription>Test the /v1/chat/completions endpoint</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="model">Model</Label>
              <Input
                id="model"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="qwen-plus"
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="system-prompt">System Prompt (optional)</Label>
              <textarea
                id="system-prompt"
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                placeholder="You are a helpful assistant..."
                rows={3}
                className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 resize-none"
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="user-message">User Message</Label>
              <textarea
                id="user-message"
                value={userMessage}
                onChange={(e) => setUserMessage(e.target.value)}
                placeholder="Enter your message..."
                rows={4}
                className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 resize-none"
              />
            </div>

            <div className="flex flex-wrap items-center gap-6">
              <div className="flex items-center gap-2">
                <Switch id="stream" checked={stream} onCheckedChange={setStream} />
                <Label htmlFor="stream" className="cursor-pointer">
                  Stream
                </Label>
              </div>

              <div className="flex items-center gap-2">
                <Switch id="thinking" checked={thinking} onCheckedChange={setThinking} />
                <Label htmlFor="thinking" className="cursor-pointer">
                  Thinking
                </Label>
              </div>
            </div>

            <div className="flex gap-2">
              {loading ? (
                <Button variant="destructive" onClick={handleStop}>
                  <Square className="size-4" />
                  Stop
                </Button>
              ) : (
                <Button onClick={handleSend} disabled={!userMessage.trim()}>
                  <Send className="size-4" />
                  Send
                </Button>
              )}
              <Button variant="outline" onClick={handleClear}>
                <Trash2 className="size-4" />
                Clear
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {(response || thinkingContent) && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Response</CardTitle>
              <div className="flex items-center gap-2">
                {thinkingContent && <Badge variant="secondary">Thinking</Badge>}
                <Button variant="ghost" size="sm" onClick={handleCopy}>
                  <Copy className="size-4" />
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {thinkingContent && (
                <div>
                  <Label className="text-xs text-muted-foreground mb-2 block">Thinking</Label>
                  <div className="max-h-96 overflow-auto rounded-md bg-zinc-950 p-4 text-sm font-mono text-zinc-50">
                    <pre className="whitespace-pre-wrap break-words">{thinkingContent}</pre>
                  </div>
                </div>
              )}
              <div>
                {thinkingContent && (
                  <Label className="text-xs text-muted-foreground mb-2 block">Response</Label>
                )}
                <div className="max-h-96 overflow-auto rounded-md bg-zinc-950 p-4 text-sm font-mono text-zinc-50">
                  <pre className="whitespace-pre-wrap break-words">{response}</pre>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
