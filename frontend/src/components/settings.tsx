import { useEffect, useState } from "react"
import {
  Bot,
  Check,
  CheckCircle2,
  ChevronDown,
  Coins,
  Gauge,
  Palette,
  RefreshCw,
  RotateCcw,
  Save,
  ScrollText,
  Search,
  XCircle,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  useAIUsage,
  useAppPrefs,
  useAISettings,
  usePrompts,
  useResetAISettings,
  useReindex,
  useSaveAISettings,
  useSaveAppPrefs,
  useSavePrompts,
  useSearchStatus,
  useTestAI,
} from "@/hooks/api"
import { THEMES, useUi, type Theme } from "@/stores/ui"
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
  const [fastModelName, setFastModelName] = useState("")
  const [baseUrl, setBaseUrl] = useState("")
  const [apiKey, setApiKey] = useState("") // never prefilled; empty means "unchanged"

  useEffect(() => {
    if (!ai.data) return
    setProvider(ai.data.provider)
    setModelName(ai.data.model_name)
    setFastModelName(ai.data.fast_model_name ?? "")
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
          <Field label="Model name" hint="e.g. llama3.2:3b, gpt-4o-mini, claude-3-5-sonnet-latest, ag/gemini-3.8-flash-high (Antigravity)">
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
                fast_model_name: fastModelName,
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
              test.data.ok ? "border-positive/30 bg-positive/10 text-positive" : "border-destructive/30 bg-destructive/10 text-destructive",
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

function PromptsCard() {
  const prompts = usePrompts(true)
  const save = useSavePrompts()
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [open, setOpen] = useState<string | null>(null)

  const label = (key: string) =>
    key
      .split("_")
      .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
      .join(" ")

  function saveDraft(key: string) {
    const value = drafts[key]
    if (value === undefined) return
    save.mutate({ [key]: value === "" ? null : value })
  }

  return (
    <Card title="System prompts" icon={ScrollText}>
      <p className="text-xs text-muted-foreground">
        Override how each agent thinks. Empty means the built-in default is used.
      </p>
      <div className="mt-3 space-y-1.5">
        {(prompts.data?.prompts ?? []).map((p) => {
          const draft = drafts[p.key]
          const edited = draft !== undefined
          return (
            <div key={p.key} className="rounded-lg border border-[var(--glass-border)]">
              <button
                type="button"
                onClick={() => setOpen(open === p.key ? null : p.key)}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm"
              >
                <span className="font-medium">{label(p.key)}</span>
                {p.override && (
                  <Badge variant="outline" className="text-[10px] text-primary">
                    custom
                  </Badge>
                )}
                <span className="ml-auto text-[11px] text-muted-foreground">{open === p.key ? "close" : "edit"}</span>
              </button>
              {open === p.key && (
                <div className="space-y-2 px-3 pb-3">
                  <textarea
                    value={edited ? draft : (p.override ?? p.default)}
                    onChange={(e) => setDrafts({ ...drafts, [p.key]: e.target.value })}
                    rows={5}
                    className="w-full rounded-md border border-[var(--glass-border)] bg-[var(--glass-bg)] px-2 py-1.5 text-xs leading-relaxed outline-none focus:border-primary/50"
                  />
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="xs" disabled={!edited || save.isPending} onClick={() => saveDraft(p.key)}>
                      <Save /> Save
                    </Button>
                    {p.override && (
                      <Button
                        variant="ghost"
                        size="xs"
                        disabled={save.isPending}
                        onClick={() => {
                          setDrafts({ ...drafts, [p.key]: "" })
                          save.mutate({ [p.key]: null })
                        }}
                      >
                        <RotateCcw /> Reset
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </Card>
  )
}

function UsageCard() {
  const usage = useAIUsage(7, true)
  const fmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n))

  return (
    <Card title="AI usage (7 days)" icon={Coins}>
      {usage.isPending ? (
        <p className="text-sm text-muted-foreground">…</p>
      ) : (usage.data?.calls ?? 0) === 0 ? (
        <p className="text-sm text-muted-foreground">No AI calls yet — run a review or ask your second brain.</p>
      ) : (
        <div className="space-y-2 text-sm">
          <div className="flex items-center gap-2">
            <Badge variant="outline">{usage.data!.calls} calls</Badge>
            <Badge variant="outline">{fmt(usage.data!.input_tokens)} in</Badge>
            <Badge variant="outline">{fmt(usage.data!.output_tokens)} out</Badge>
          </div>
          <ul className="space-y-1 text-xs text-muted-foreground">
            {usage.data!.by_agent.map((a) => (
              <li key={a.agent} className="flex items-center gap-2">
                <span className="w-24 capitalize">{a.agent}</span>
                <span>{a.calls} calls</span>
                <span className="ml-auto">
                  {fmt(a.input_tokens)} in · {fmt(a.output_tokens)} out
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
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

function ThemeSwatch({ id }: { id: Theme }) {
  const meta = THEMES.find((t) => t.id === id)!
  return (
    <span
      className={cn(
        "flex h-4 w-7 shrink-0 overflow-hidden rounded border border-border/60",
        meta.dark && "dark",
        id !== "dark" && id !== "light" && `theme-${id}`,
      )}
      aria-hidden
    >
      <span className="flex-1 bg-background" />
      <span className="flex-1 bg-card" />
      <span className="flex-1 bg-primary" />
    </span>
  )
}

function AppearanceCard() {
  const theme = useUi((s) => s.theme)
  const setTheme = useUi((s) => s.setTheme)
  const current = THEMES.find((t) => t.id === theme) ?? THEMES[0]
  return (
    <Card title="Appearance" icon={Palette}>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="outline" size="sm" className="w-60 justify-between" aria-label={`Theme: ${current.label}`} />
          }
        >
          <span className="flex items-center gap-2">
            <ThemeSwatch id={current.id} />
            {current.label}
          </span>
          <ChevronDown className="size-3.5 text-muted-foreground" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-60">
          {THEMES.map((t) => (
            <DropdownMenuItem key={t.id} onClick={() => setTheme(t.id)}>
              <ThemeSwatch id={t.id} />
              <span className="flex-1">{t.label}</span>
              {theme === t.id && <Check className="size-3.5" />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </Card>
  )
}

export function SettingsView() {
  return (
    <main className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
      <div className="mx-auto flex w-full max-w-3xl flex-col px-6 pt-5 pb-10">
      <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
      <div className="mt-4 grid gap-4">
        <AISettingsCard />
        <div className="grid gap-4 md:grid-cols-2">
          <UsageCard />
          <PrefsCard />
        </div>
        <PromptsCard />
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
    </div>
    </main>
  )
}
