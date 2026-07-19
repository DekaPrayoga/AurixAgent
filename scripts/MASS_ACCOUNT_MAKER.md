# Mass Account Maker — Load Testing Design

## Tujuan
Membuat **500 akun sintetis** ke aplikasi **localhost milik Anda** untuk load testing, lewat **official test endpoint**, dengan **concurrency terbatas** dan **laporan sukses/gagal**.

## Arsitektur

```
┌────────────────────┐     POST /api/test/users      ┌──────────────────────────┐
│ mass-account-maker │ ─────────────────────────────► │ Local app test endpoint  │
│  (worker pool)     │ ◄───────────────────────────── │ (atau mock server)       │
└────────────────────┘     201 / 4xx / 5xx + body     └──────────────────────────┘
          │
          ▼
   reports/*.csv + *.json
```

## Komponen

| File | Peran |
|---|---|
| `scripts/mass-account-maker.ts` | Generator + client concurrent + reporter |
| `reports/mass-accounts.csv` | Hasil per akun |
| `reports/mass-accounts.json` | Ringkasan run + detail |

## Kontrak Endpoint (official test)

```
POST /api/test/users
Content-Type: application/json
X-Load-Test: true
X-Test-Batch: <batchId>

{
  "username": "loadtest_user_0001",
  "email": "loadtest.user.0001@localhost.test",
  "password": "Lt!00001Aa#",
  "firstName": "Alex",
  "lastName": "Smith",
  "displayName": "Alex Smith 0001",
  "isTestAccount": true,
  "skipEmailVerification": true,
  "metadata": {
    "source": "mass-account-maker",
    "purpose": "load-testing",
    "batchId": "batch_..."
  }
}
```

Response sukses (contoh):

```json
{ "id": "usr_000001", "user": { "id": "usr_000001", "username": "..." } }
```

## Identitas Sintetis
- Username deterministik: `{prefix}_user_{index}`
- Email local-only: `{prefix}.user.{index}@localhost.test`
- Password memenuhi rule umum, deterministic per index
- Metadata menandai akun sebagai load-test (mudah dibersihkan)

## Concurrency Model
- Worker pool tetap (`--concurrency`, default **20**)
- Tidak spawn 500 request sekaligus
- Timeout per request (`--timeout`, default 10s)
- Progress tiap 5%

Rekomendasi awal:
- warm-up: `--count 50 --concurrency 10`
- full run: `--count 500 --concurrency 20`
- stress: naikkan concurrency bertahap (30 → 50), pantau error rate & latency

## Laporan
Setiap akun:
- `status`: success | failed | skipped
- `httpStatus`, `durationMs`, `responseId`, `error`

Ringkasan run:
- success / failed / skipped
- success rate
- avg latency + p95
- sample failure

Exit code `1` jika ada failure (cocok untuk CI).

## Cara Pakai

### 1) Dry-run (tanpa hit network)
```bash
bun run scripts/mass-account-maker.ts --count 500 --dry-run
```

### 2) Full load test ke localhost
```bash
bun run scripts/mass-account-maker.ts \
  --endpoint http://localhost:3000/api/test/users \
  --count 500 \
  --concurrency 20 \
  --prefix loadtest
```

### Flags
| Flag | Default | Keterangan |
|---|---|---|
| `--endpoint` | `http://localhost:3000/api/test/users` | Official test endpoint |
| `--count` | `500` | Jumlah akun |
| `--concurrency` | `20` | Worker paralel |
| `--timeout` | `10000` | Timeout ms / request |
| `--prefix` | `loadtest` | Prefix username/email |
| `--csv` | `reports/mass-accounts.csv` | Output CSV |
| `--json` | `reports/mass-accounts.json` | Output JSON |
| `--dry-run` | off | Generate + report tanpa POST |

## Safeguards Load Testing
1. Hanya target **localhost / staging milik Anda**
2. Pakai path **official test** (`/api/test/...`)
3. Set `isTestAccount=true` + metadata batch
4. Concurrency terbatas, bukan firehose tak terbatas
5. Simpan laporan untuk analisis bottleneck
6. Cleanup batch test setelah selesai (filter by `metadata.batchId` / prefix)

## Integrasi ke App Anda
Pastikan app punya (atau expose) endpoint test setara:
- auth test-only / feature flag
- skip email verification
- rate limit longgar khusus test path
- response menyertakan `id` user

Sesuaikan field body di `createAccount()` jika schema API Anda berbeda.
