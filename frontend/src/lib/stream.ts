/** Minimal SSE-over-fetch client for the streaming AI endpoints.
 *
 * Uses a plain POST + ReadableStream (EventSource can't send bodies).
 * Yields {event, data} pairs with data parsed as JSON; `signal` aborts.
 */
export async function* sseEvents(
  path: string,
  body: unknown,
  signal?: AbortSignal,
): AsyncGenerator<{ event: string; data: any }> {
  const BASE = import.meta.env.VITE_API_URL ?? "http://127.0.0.1:8000"
  const res = await fetch(`${BASE}/api${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  })
  if (!res.ok || !res.body) {
    let detail = `${res.status} ${res.statusText}`
    try {
      const parsed = await res.json()
      if (typeof parsed?.detail === "string") detail = parsed.detail
    } catch {
      // non-JSON error body
    }
    throw new Error(detail)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let idx
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0, idx)
      buffer = buffer.slice(idx + 2)
      const parsed = parseFrame(frame)
      if (parsed) yield parsed
    }
  }
}

function parseFrame(frame: string): { event: string; data: any } | null {
  let event = "message"
  let data = ""
  for (const line of frame.split("\n")) {
    if (line.startsWith("event: ")) event = line.slice(7).trim()
    else if (line.startsWith("data: ")) data += line.slice(6)
  }
  if (!data) return null
  try {
    return { event, data: JSON.parse(data) }
  } catch {
    return null
  }
}
