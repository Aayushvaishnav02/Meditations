import { afterEach, describe, expect, it, vi } from "vitest"
import { sseEvents } from "./stream"

function mockFetch(chunks: string[], ok = true, status = 200) {
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c))
      controller.close()
    },
  })
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(ok ? body : body, { status, headers: { "content-type": "text/event-stream" } })),
  )
}

afterEach(() => vi.unstubAllGlobals())

describe("sseEvents", () => {
  it("parses well-formed frames", async () => {
    mockFetch(['event: partial\ndata: {"text":"hi"}\n\nevent: done\ndata: {}\n\n'])
    const events = []
    for await (const e of sseEvents("/x", {})) events.push(e)
    expect(events).toEqual([
      { event: "partial", data: { text: "hi" } },
      { event: "done", data: {} },
    ])
  })

  it("reassembles frames split across network chunks", async () => {
    mockFetch([
      'event: partial\ndata: {"text":"hel',
      'lo"}\n\nevent: sour',
      'ces\ndata: [1]\n\nevent: done\ndata: {"text":"hello"}\n\n',
    ])
    const events = []
    for await (const e of sseEvents("/x", {})) events.push(e)
    expect(events).toEqual([
      { event: "partial", data: { text: "hello" } },
      { event: "sources", data: [1] },
      { event: "done", data: { text: "hello" } },
    ])
  })

  it("skips malformed frames instead of throwing", async () => {
    mockFetch(["data: not-json\n\nevent: done\ndata: {}\n\n"])
    const events = []
    for await (const e of sseEvents("/x", {})) events.push(e)
    expect(events).toEqual([{ event: "done", data: {} }])
  })

  it("throws a readable error for non-2xx responses with a detail envelope", async () => {
    mockFetch([JSON.stringify({ detail: "AI request failed: rate limit" })], false, 502)
    await expect(async () => {
      for await (const _ of sseEvents("/x", {})) {
        /* consume */
      }
    }).rejects.toThrow("AI request failed: rate limit")
  })
})
