/**
 * Mass Account Maker — Load Testing Tool
 * Creates synthetic accounts against a localhost official test endpoint.
 *
 * Usage:
 *   bun run scripts/mass-account-maker.ts
 *   bun run scripts/mass-account-maker.ts --count 500 --concurrency 20
 *   bun run scripts/mass-account-maker.ts --endpoint http://localhost:3000/api/test/users
 */

// ─── Config ───────────────────────────────────────────────────────────────────

interface Config {
  endpoint: string;
  count: number;
  concurrency: number;
  timeoutMs: number;
  outputCsv: string;
  outputJson: string;
  dryRun: boolean;
  prefix: string;
}

function parseArgs(argv: string[]): Config {
  const get = (flag: string, fallback: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
  };

  return {
    endpoint: get("--endpoint", "http://localhost:3000/api/test/users"),
    count: Number(get("--count", "500")),
    concurrency: Number(get("--concurrency", "20")),
    timeoutMs: Number(get("--timeout", "10000")),
    outputCsv: get("--csv", "reports/mass-accounts.csv"),
    outputJson: get("--json", "reports/mass-accounts.json"),
    dryRun: argv.includes("--dry-run"),
    prefix: get("--prefix", "loadtest"),
  };
}

// ─── Synthetic Identity Generator ────────────────────────────────────────────

const FIRST = [
  "Alex", "Jordan", "Sam", "Casey", "Riley", "Morgan", "Taylor", "Avery",
  "Quinn", "Blake", "Cameron", "Drew", "Emery", "Finley", "Harper", "Jamie",
];
const LAST = [
  "Smith", "Johnson", "Lee", "Brown", "Garcia", "Miller", "Davis", "Wilson",
  "Moore", "Taylor", "Anderson", "Thomas", "Jackson", "White", "Harris", "Martin",
];

function pad(n: number, width = 4): string {
  return String(n).padStart(width, "0");
}

function randomPick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

function syntheticPassword(index: number): string {
  // Deterministic-enough for load tests, still satisfies common password rules
  return `Lt!${pad(index, 5)}Aa#`;
}

export interface SyntheticAccount {
  index: number;
  username: string;
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  displayName: string;
  metadata: {
    source: "mass-account-maker";
    purpose: "load-testing";
    batchId: string;
  };
}

function generateAccount(index: number, prefix: string, batchId: string): SyntheticAccount {
  const firstName = randomPick(FIRST);
  const lastName = randomPick(LAST);
  const tag = pad(index);

  return {
    index,
    username: `${prefix}_user_${tag}`,
    email: `${prefix}.user.${tag}@localhost.test`,
    password: syntheticPassword(index),
    firstName,
    lastName,
    displayName: `${firstName} ${lastName} ${tag}`,
    metadata: {
      source: "mass-account-maker",
      purpose: "load-testing",
      batchId,
    },
  };
}

// ─── Result Types ────────────────────────────────────────────────────────────

export type AccountStatus = "success" | "failed" | "skipped";

export interface AccountResult {
  index: number;
  username: string;
  email: string;
  status: AccountStatus;
  httpStatus?: number;
  durationMs: number;
  error?: string;
  responseId?: string;
}

export interface RunReport {
  startedAt: string;
  finishedAt: string;
  endpoint: string;
  requested: number;
  concurrency: number;
  dryRun: boolean;
  success: number;
  failed: number;
  skipped: number;
  avgDurationMs: number;
  p95DurationMs: number;
  results: AccountResult[];
}

// ─── Concurrency Pool ────────────────────────────────────────────────────────

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
  onProgress?: (done: number, total: number) => void,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  let done = 0;

  async function runWorker() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await worker(items[i]!, i);
      done++;
      onProgress?.(done, items.length);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => runWorker());
  await Promise.all(workers);
  return results;
}

// ─── HTTP Create ─────────────────────────────────────────────────────────────

async function createAccount(
  endpoint: string,
  account: SyntheticAccount,
  timeoutMs: number,
  dryRun: boolean,
): Promise<AccountResult> {
  const started = performance.now();

  if (dryRun) {
    return {
      index: account.index,
      username: account.username,
      email: account.email,
      status: "skipped",
      durationMs: Math.round(performance.now() - started),
      error: "dry-run",
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-Load-Test": "true",
        "X-Test-Batch": account.metadata.batchId,
      },
      body: JSON.stringify({
        username: account.username,
        email: account.email,
        password: account.password,
        firstName: account.firstName,
        lastName: account.lastName,
        displayName: account.displayName,
        // Common test flags for official/local test endpoints
        isTestAccount: true,
        skipEmailVerification: true,
        metadata: account.metadata,
      }),
      signal: controller.signal,
    });

    const durationMs = Math.round(performance.now() - started);
    let bodyText = "";
    let responseId: string | undefined;

    try {
      bodyText = await res.text();
      const json = JSON.parse(bodyText) as Record<string, unknown>;
      responseId =
        (json.id as string | undefined) ??
        (json.userId as string | undefined) ??
        ((json.user as Record<string, unknown> | undefined)?.id as string | undefined);
    } catch {
      // non-JSON body is fine; keep raw snippet in error path
    }

    if (res.ok) {
      return {
        index: account.index,
        username: account.username,
        email: account.email,
        status: "success",
        httpStatus: res.status,
        durationMs,
        responseId,
      };
    }

    return {
      index: account.index,
      username: account.username,
      email: account.email,
      status: "failed",
      httpStatus: res.status,
      durationMs,
      error: bodyText.slice(0, 300) || `HTTP ${res.status}`,
    };
  } catch (err) {
    const durationMs = Math.round(performance.now() - started);
    const message = err instanceof Error ? err.message : String(err);
    return {
      index: account.index,
      username: account.username,
      email: account.email,
      status: "failed",
      durationMs,
      error: message,
    };
  } finally {
    clearTimeout(timer);
  }
}

// ─── Reporting ───────────────────────────────────────────────────────────────

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[idx]!;
}

function buildReport(
  cfg: Config,
  results: AccountResult[],
  startedAt: Date,
  finishedAt: Date,
): RunReport {
  const durations = results.map((r) => r.durationMs).sort((a, b) => a - b);
  const avg =
    durations.length === 0
      ? 0
      : Math.round(durations.reduce((a, b) => a + b, 0) / durations.length);

  return {
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    endpoint: cfg.endpoint,
    requested: cfg.count,
    concurrency: cfg.concurrency,
    dryRun: cfg.dryRun,
    success: results.filter((r) => r.status === "success").length,
    failed: results.filter((r) => r.status === "failed").length,
    skipped: results.filter((r) => r.status === "skipped").length,
    avgDurationMs: avg,
    p95DurationMs: percentile(durations, 95),
    results,
  };
}

function toCsv(results: AccountResult[]): string {
  const header = [
    "index",
    "username",
    "email",
    "status",
    "httpStatus",
    "durationMs",
    "responseId",
    "error",
  ].join(",");

  const rows = results.map((r) =>
    [
      r.index,
      r.username,
      r.email,
      r.status,
      r.httpStatus ?? "",
      r.durationMs,
      r.responseId ?? "",
      JSON.stringify(r.error ?? ""),
    ].join(","),
  );

  return [header, ...rows].join("\n");
}

async function ensureParentDir(filePath: string) {
  const path = await import("node:path");
  const fs = await import("node:fs/promises");
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

async function writeReports(cfg: Config, report: RunReport) {
  const fs = await import("node:fs/promises");
  await ensureParentDir(cfg.outputCsv);
  await ensureParentDir(cfg.outputJson);
  await fs.writeFile(cfg.outputCsv, toCsv(report.results), "utf8");
  await fs.writeFile(cfg.outputJson, JSON.stringify(report, null, 2), "utf8");
}

function printSummary(report: RunReport) {
  const total = report.results.length;
  const rate = total === 0 ? 0 : ((report.success / total) * 100).toFixed(1);

  console.log("\n════════════════════════════════════════");
  console.log(" MASS ACCOUNT MAKER — REPORT");
  console.log("════════════════════════════════════════");
  console.log(` Endpoint     : ${report.endpoint}`);
  console.log(` Requested    : ${report.requested}`);
  console.log(` Concurrency  : ${report.concurrency}`);
  console.log(` Dry-run      : ${report.dryRun}`);
  console.log(` Success      : ${report.success}`);
  console.log(` Failed       : ${report.failed}`);
  console.log(` Skipped      : ${report.skipped}`);
  console.log(` Success rate : ${rate}%`);
  console.log(` Avg latency  : ${report.avgDurationMs} ms`);
  console.log(` p95 latency  : ${report.p95DurationMs} ms`);
  console.log(` Started      : ${report.startedAt}`);
  console.log(` Finished     : ${report.finishedAt}`);
  console.log("════════════════════════════════════════");

  if (report.failed > 0) {
    console.log("\nSample failures:");
    report.results
      .filter((r) => r.status === "failed")
      .slice(0, 5)
      .forEach((r) => {
        console.log(`  #${r.index} ${r.username} → ${r.httpStatus ?? "-"} ${r.error ?? ""}`);
      });
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const cfg = parseArgs(process.argv.slice(2));

  if (!Number.isFinite(cfg.count) || cfg.count <= 0) {
    throw new Error("--count must be a positive number");
  }
  if (!Number.isFinite(cfg.concurrency) || cfg.concurrency <= 0) {
    throw new Error("--concurrency must be a positive number");
  }

  const batchId = `batch_${Date.now()}`;
  const accounts = Array.from({ length: cfg.count }, (_, i) =>
    generateAccount(i + 1, cfg.prefix, batchId),
  );

  console.log("Mass Account Maker");
  console.log(`- endpoint    : ${cfg.endpoint}`);
  console.log(`- count       : ${cfg.count}`);
  console.log(`- concurrency : ${cfg.concurrency}`);
  console.log(`- timeout     : ${cfg.timeoutMs}ms`);
  console.log(`- dry-run     : ${cfg.dryRun}`);
  console.log(`- batchId     : ${batchId}`);
  console.log("");

  const startedAt = new Date();
  let lastPct = -1;

  const results = await mapPool(
    accounts,
    cfg.concurrency,
    (account) => createAccount(cfg.endpoint, account, cfg.timeoutMs, cfg.dryRun),
    (done, total) => {
      const pct = Math.floor((done / total) * 100);
      if (pct !== lastPct && pct % 5 === 0) {
        lastPct = pct;
        process.stdout.write(`\rProgress: ${done}/${total} (${pct}%)`);
      }
    },
  );

  process.stdout.write("\n");
  const finishedAt = new Date();
  const report = buildReport(cfg, results, startedAt, finishedAt);
  await writeReports(cfg, report);
  printSummary(report);

  console.log(`\nCSV  : ${cfg.outputCsv}`);
  console.log(`JSON : ${cfg.outputJson}`);

  // non-zero exit if any hard failures (useful for CI)
  if (report.failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("Fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
