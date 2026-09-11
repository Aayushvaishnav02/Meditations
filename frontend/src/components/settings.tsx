import { useEffect, useState } from "react"
import { Bot, CheckCircle2, Gauge, RefreshCw, RotateCcw, Save, Search, Sun, Moon, XCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import {
  useAppPrefs,
  useAISettings,
  useResetAISettings,
  useReindex,
  useSaveAISettings,
  useSaveAppPrefs,
  useSearchStatus,
  useTestAI,
} from "@/hooks/api"
import { useUi } from "@/stores/ui"
import { cn } from "cn"

function Card({ title, icon: Icon, children }: { title: string; icon: typeof Bot; children: React.ReactNode }) {
  return (
    <div className="glass rounded-2xl p-5">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <Icon className="size-4 text-primary" />
        {title}
      </h2>
      <div className="mt-4">{children}</div>
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-muted-foreground/80">{hint}</span>}
    </label>
  )
}

function AISettingsCard() {
  const ai = useAISettings(true)
  const save = useSaveAISettings()
  const reset = useResetAISettings()
  const test = useTestAI()

  const [provider, setProvider] = useState("openai_compatible")
  const [modelName, setModelName] = useState("")
  const [baseUrl, setBaseUrl] = useState("")
  const [apiKey, setApiKey] = useState("") // never prefilled; empty means "unchanged"

  useEffect(() => {
    if (!ai.data) return
    setProvider(ai.data.provider)
    setModelName(ai.data.model_name)
    setBaseUrl(ai.data.base_url ?? "")
  }, [ai.data])

  return (
    <Card title="AI provider" icon={Bot}>
      <div className="grid gap-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Provider">
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              className="h-9 w-full rounded-md border border-[var(--glass-border)] bg-[var(--glass-bg)] px-2 text-sm outline-none focus:border-primary/50"
            >
              <option value="openai_compatible">OpenAI-compatible (Ollama, OpenRouter, Groq, OpenAI…)</option>
              <option value="anthropic">Anthropic</option>
            </select>
          </Field>
          <Field label="Model name" hint="e.g. llama3.2:3b, qwen2.5:7b, gpt-4o-mini, claude-3-5-sonnet-latest">
            <Input value={modelName} onChange={(e) => setModelName(e.target.value)} className="h-9" />
          </Field>
        </div>
        <Field label="Base URL" hint="Leave empty for the provider default (api.openai.com / api.anthropic.com)">
          <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="http://localhost:11434/v1" className="h-9" />
        </Field>
        <Field
          label="API key"
          hint={
            ai.data?.api_key_set
              ? "A key is configured — type a new one to replace it. It is never displayed."
              : "No key configured yet."
          }
        >
          <Input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={ai.data?.api_key_set ? "•••••••• (unchanged)" : "sk-… or 'ollama' for local"}
            className="h-9"
          />
        </Field>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            disabled={save.isPending}
            onClick={() =>
              save.mutate({
                provider,
                model_name: modelName,
                base_url: baseUrl === "" ? null : baseUrl,
                ...(apiKey.trim() ? { api_key: apiKey.trim() } : {}),
              })
            }
          >
            <Save /> Save
          </Button>
          <Button variant="outline" size="sm" disabled={test.isPending} onClick={() => test.mutate()}>
            {test.isPending ? <RefreshCw className="animate-spin" /> : null}
            Test connection
          </Button>
          <Button variant="ghost" size="sm" disabled={reset.isPending} onClick={() => reset.mutate()}>
            <RotateCcw /> Reset to defaults
          </Button>
        </div>

        {test.data && (
          <div
            className={cn(
              "flex items-start gap-2 rounded-lg border px-3 py-2 text-xs",
              test.data.ok ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" : "border-red-500/30 bg-red-500/10 text-red-300",
            )}
          >
            {test.data.ok ? <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" /> : <XCircle className="mt-0.5 size-3.5 shrink-0" />}
            <div>
              {test.data.ok ? (
                <>
                  Connected — model <span className="font-medium">{test.data.model}</span> replied “{test.data.reply}” in{" "}
                  {test.data.latency_ms} ms.
                </>
              ) : (
                <>
                  Failed: <span className="font-medium">{test.data.error}</span>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </Card>
  )
}

function PrefsCard() {
  const prefs = useAppPrefs(true)
  const save = useSaveAppPrefs()
  const [target, setTarget] = useState("4")

  useEffect(() => {
    if (prefs.data) setTarget(String(prefs.data.target_deep_work_hours))
  }, [prefs.data])

  return (
    <Card title="Preferences" icon={Gauge}>
      <Field label="Daily deep-work target (hours)" hint="Used by the deterministic daily score (plan §3.4). 0.5–16.">
        <Input
          type="number"
          min="0.5"
          max="16"
          step="0.5"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          onBlur={() => {
            const n = Number.parseFloat(target)
            if (!Number.isNaN(n) && n > 0 && n <= 16) save.mutate({ target_deep_work_hours: n })
          }}
          className="h-9 w-28"
        />
      </Field>
    </Card>
  )
}

function SearchCard() {
  const status = useSearchStatus(true)
  const reindex = useReindex()
  return (
    <Card title="Search index" icon={Search}>
      <div className="flex items-center gap-2 text-sm">
        <Badge variant="outline">FTS5 keyword: on</Badge>
        <Badge variant="outline">{status.data?.semantic ? "Semantic (local embeddings): on" : "Semantic: off"}</Badge>
        <span className="text-xs text-muted-foreground">{status.data?.indexed_docs ?? "…"} documents indexed</span>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Rebuild after importing data or enabling the embedding model. Journals are indexed automatically as you write.
      </p>
      <Button variant="outline" size="sm" className="mt-3" disabled={reindex.isPending} onClick={() => reindex.mutate()}>
        <RefreshCw className={cn(reindex.isPending && "animate-spin")} /> Rebuild index
      </Button>
    </Card>
  )
}

function AppearanceCard() {
  const theme = useUi((s) => s.theme)
  const setTheme = useUi((s) => s.setTheme)
  return (
    <Card title="Appearance" icon={theme === "dark" ? Moon : Sun}>
      <div className="glass flex items-center gap-0.5 rounded-lg p-0.5">
        {(["dark", "light"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTheme(t)}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs transition-colors",
              theme === t ? "bg-primary/20 text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t === "dark" ? <Moon className="size-3.5" /> : <Sun className="size-3.5" />}
            {t === "dark" ? "Dark" : "Light"}
          </button>
        ))}
      </div>
    </Card>
  )
}

export function SettingsView() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col overflow-y-auto px-6 pt-5 pb-10 min-h-0">
      <h1 className="text-lg font-semibold tracking-tight">Settings</h1>
      <div className="mt-4 grid gap-4">
        <AISettingsCard />
        <PrefsCard />
        <div className="grid gap-4 md:grid-cols-2">
          <AppearanceCard />
          <SearchCard />
        </div>
        <Separator />
        <p className="text-xs text-muted-foreground">
          Journal · local-first task, journal and AI life-OS. Backend API at{" "}
          <code className="text-foreground">http://127.0.0.1:8000</code>.
        </p>
      </div>
    </main>
  )
}
