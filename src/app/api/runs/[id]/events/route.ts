import type { RunEvent } from "@/contracts";
import { watchRun } from "@/run/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let deliver: (event: RunEvent) => void = () => undefined;
  const watch = watchRun(id, (event) => deliver(event));
  if (!watch) return new Response("Run not found.", { status: 404 });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let sent = Number(request.headers.get("last-event-id")) || 0;
      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        watch.unsubscribe();
        controller.close();
      };
      deliver = (event) => {
        if (closed || event.seq <= sent) return;
        sent = event.seq;
        controller.enqueue(encoder.encode(`id: ${event.seq}\ndata: ${JSON.stringify(event)}\n\n`));
        if (event.type === "run-stop") close();
      };
      request.signal.addEventListener("abort", close, { once: true });
      controller.enqueue(encoder.encode(": open\n\n"));
      watch.backlog.forEach(deliver);
      if (!watch.live) close();
    },
    cancel: () => watch.unsubscribe(),
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
