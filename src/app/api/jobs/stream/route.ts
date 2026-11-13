import { getCurrentUser } from "@/lib/auth";
import { recoverStaleJobs, systemStatus, userJobs } from "@/lib/jobs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Server-Sent Events: estado real de las tareas del usuario (lectura de la base de datos).
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "No autenticado" }, { status: 401 });
  const enc = new TextEncoder();
  let timer: ReturnType<typeof setInterval> | undefined;
  let last = "";
  let ticks = 0;
  let closed = false;
  let busy = false;
  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data: unknown) =>
        { if (!closed) controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)); };
      const close = () => {
        if (closed) return;
        closed = true;
        if (timer) clearInterval(timer);
        try {
          controller.close();
        } catch {}
      };
      const tick = async () => {
        if (closed || busy) return;
        busy = true;
        try {
          if (ticks % 10 === 0) await recoverStaleJobs();
          const [jobs, system] = await Promise.all([userJobs(user.id), ticks % 5 === 0 ? systemStatus() : null]);
          if (closed) return;
          if (system || JSON.stringify(jobs) !== last) {
            send("state", { jobs, system });
            last = JSON.stringify(jobs);
          } else controller.enqueue(enc.encode(": ping\n\n"));
        } catch (e) {
          if (!closed) send("error", { message: (e as Error).message });
        } finally {
          busy = false;
        }
        ticks++;
        if (ticks > 200) close(); // el cliente reconecta automáticamente
      };
      req.signal.addEventListener("abort", close);
      controller.enqueue(enc.encode("retry: 3000\n\n"));
      void tick();
      timer = setInterval(tick, 1500);
    },
    cancel() {
      closed = true;
      if (timer) clearInterval(timer);
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
