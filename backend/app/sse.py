"""Server-sent-event formatting for the streaming AI endpoints.

Wire format per message: `event: <name>\ndata: <json>\n\n`. The frontend
consumes these with a plain fetch + ReadableStream reader (no EventSource,
because we need POST bodies).
"""

from __future__ import annotations

import json

from fastapi.responses import StreamingResponse

SSE_HEADERS = {
    "Cache-Control": "no-cache",
    "X-Accel-Buffering": "no",  # don't buffer when proxied
}


def sse(event: str, data: object) -> str:
    return f"event: {event}\ndata: {json.dumps(data, default=str)}\n\n"


def stream_response(generator) -> StreamingResponse:
    return StreamingResponse(generator, media_type="text/event-stream", headers=SSE_HEADERS)
