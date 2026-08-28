/**
 * A minimal daily scheduler.
 *
 * The system has no cron and no job runner, and pulling one in for a handful of
 * once-a-day checks would be heavier than the problem. This runs a job shortly
 * after boot and then every 24 hours, which is the right cadence for anything
 * measured in days (document expiry, reorder timing).
 *
 * Jobs are expected to be idempotent — a restart re-runs them, and the
 * notification layer already de-duplicates by `eventKey`, so a job that runs
 * twice in a day produces one notification, not two.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Delay before the first run, so boot is not competing with a scan. */
const INITIAL_DELAY_MS = 30 * 1000;

export interface DailyJob {
  name: string;
  run: () => Promise<void>;
}

const timers: NodeJS.Timeout[] = [];

async function runJob(job: DailyJob) {
  const startedAt = Date.now();
  try {
    await job.run();
    console.log(`[Scheduler] ${job.name} finished in ${Date.now() - startedAt}ms`);
  } catch (err) {
    // A failing job must never take the process down with it.
    console.error(`[Scheduler] ${job.name} failed:`, err);
  }
}

export function startDailyJobs(jobs: DailyJob[]) {
  for (const job of jobs) {
    const initial = setTimeout(() => {
      void runJob(job);
      const repeating = setInterval(() => void runJob(job), DAY_MS);
      repeating.unref?.();
      timers.push(repeating);
    }, INITIAL_DELAY_MS);
    initial.unref?.();
    timers.push(initial);
  }
  console.log(`[Scheduler] ${jobs.length} daily job(s) armed: ${jobs.map((j) => j.name).join(', ')}`);
}

/** Test seam — stops everything this module has scheduled. */
export function stopDailyJobs() {
  for (const timer of timers) clearTimeout(timer as NodeJS.Timeout);
  timers.length = 0;
}
