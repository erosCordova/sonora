/** Identifica el intento concreto que ha reclamado una tarea. */
export type WorkerLease = { workerId: string; attempt: number };

export function readWorkerLease(req: Request): WorkerLease | null {
  const workerId = req.headers.get("x-worker-id")?.trim();
  const rawAttempt = req.headers.get("x-job-attempt") ?? "";
  if (!workerId || workerId.length > 80 || !/^[1-9]\d*$/.test(rawAttempt)) return null;
  const attempt = Number(rawAttempt);
  if (!Number.isSafeInteger(attempt)) return null;
  return { workerId, attempt };
}
