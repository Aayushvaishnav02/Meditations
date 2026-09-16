import { backendBase } from "@/lib/backend-base"

export class ApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${backendBase()}/api${path}`, {
      headers: { "Content-Type": "application/json" },
      ...init,
    })
  } catch {
    throw new ApiError(0, "Cannot reach the API. Is the backend running?")
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    let message = text || `${res.status} ${res.statusText}`
    try {
      // FastAPI error envelope: {"detail": "..."}
      const parsed = JSON.parse(text)
      if (typeof parsed?.detail === "string") message = parsed.detail
    } catch {
      // non-JSON body — keep the raw text
    }
    throw new ApiError(res.status, message)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "POST", body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
  put: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "PUT", body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
}
