# AURIX

<p align="center">
  <img src="https://img.shields.io/badge/license-MIT-22c55e?style=for-the-badge" alt="MIT" />
  <img src="https://img.shields.io/badge/runtime-Bun-black?style=for-the-badge&logo=bun" alt="Bun" />
  <img src="https://img.shields.io/badge/language-TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/native-Rust-dea584?style=for-the-badge&logo=rust&logoColor=white" alt="Rust" />
  <img src="https://img.shields.io/badge/interface-Terminal%20%2B%20Chat-7c3aed?style=for-the-badge" alt="Interface" />
</p>

<p align="center">
  <b>Open-source terminal AI agent that codes, researches, browses, and solves — with real hands.</b>
</p>

<p align="center">
  AURIX is a developer-first AI workspace that lives in your terminal.<br/>
  It inspects repos, edits files, runs commands, performs cited research, automates stealth browsers<br/>
  with built-in CAPTCHA solving, generates documents — and stays accessible from Discord, Telegram, and WhatsApp.
</p>

---

<!--
  TODO: Add terminal demo GIF here
  Record with: asciinema rec demo.cast && agg demo.cast demo.gif
  Or use: terminalizer record demo && terminalizer render demo
-->

![AURIX Demo](docs/assets/aurix-demo.png)

## What is AURIX?

AURIX is an **Autonomous Multi-Agent AI Workspace**. It is not a chat wrapper — it is an AI that has hands, eyes, and memory.

Instead of just generating text, AURIX operates directly inside your environment to close the execution loop. It comes packed with **46+ built-in tools**, a **Rust-powered token counter** for accurate context management, a **stealth browser engine** with CAPTCHA solving, and **100+ CTF/security skills** for offensive security testing.

1. **It Reads & Browses:** Navigates your folders, reads your codebase, searches the web, and automates a stealth Chromium browser (CloakBrowser) that solves CAPTCHAs including image challenges, sliders, and FunCaptcha.
2. **It Thinks:** Delegates complex tasks to a swarm of sub-agents. Accurate BPE token counting via a native Rust module ensures context is never wasted.
3. **It Acts:** Writes files, runs shell commands, creates Git commits, manages Docker containers, queries databases, drags sliders, and clicks image tiles.
4. **It Verifies:** If a test fails or a build crashes, AURIX reads the error log and fixes the code autonomously.
5. **It Hunts:** Ships with 100+ CTF and penetration testing skills covering web exploitation, binary pwn, crypto, reverse engineering, forensics, OSINT, and AI/ML security.

## Standout Features

### Stealth Browser with CAPTCHA Solving

AURIX ships with **CloakBrowser** — a patched Chromium with source-level anti-detection that passes reCAPTCHA scoring, Cloudflare Turnstile, and fingerprint checks. The built-in CAPTCHA solver handles:

| CAPTCHA Type | Method |
|---|---|
| **reCAPTCHA v2** | Auto-click checkbox + image grid solver (screenshots each tile, AI vision picks matches) |
| **hCaptcha** | Same image grid solving flow |
| **Cloudflare Turnstile** | Managed challenge auto-click |
| **FunCaptcha (Arkose Labs / Microsoft)** | Puzzle type detection + rotation, drag-drop, image-match solving |
| **GeeTest / MTCaptcha** | Slider drag with human-like easing + micro-jitter |
| **Text CAPTCHA** | Screenshot + OCR via AI vision |

New browser actions: `captcha-grid`, `click-tile`, `captcha-verify`, `drag-to`, `hold-click` — all with human-like mouse behavior (eased curves, random delays, micro-jitter).

### Rust-Powered Token Counter

Token counting was wildly inaccurate (`Math.ceil(text.length / 4)` underestimates by 30-60% for code). Now uses a **native Rust BPE tokenizer** via napi-rs:

- **tiktoken-rs** with `cl100k_base` (GPT-4) and `o200k_base` (GPT-4o) encodings
- Accurate context management — no more premature overflow or wasted context window
- Real API usage tracking from `response.usage.promptTokens` / `completionTokens`
- Automatic JS fallback if Rust toolchain unavailable

### Bug Hunt Skill — 100+ CTF & Security Skills

Bundled with comprehensive offensive security skills covering every CTF category:

| Category | Files | Covers |
|---|---|---|
| **Web** | 20 | SQLi, XSS, SSTI, SSRF, JWT, prototype pollution, file upload RCE, 500+ techniques |
| **Pwn** | 18 | Buffer overflow, ROP, heap, format string, kernel exploitation, seccomp bypass |
| **Crypto** | 16 | RSA, AES, ECC, PRNG, ZKP, lattice, Coppersmith, padding oracle |
| **Reverse** | 18 | ELF/PE analysis, VMs, WASM, obfuscation, game clients |
| **Forensics** | 14 | Disk images, memory dumps, PCAP, steganography, event logs |
| **Misc** | 12 | Jails, encodings, RF/SDR, esoteric languages, game theory |
| **Malware** | 3 | C2 traffic, packers, .NET analysis |
| **OSINT** | 3 | Social media, geolocation, DNS, public records |
| **AI/ML** | 3 | Adversarial examples, prompt injection, model extraction |

## What's New in v1.0.0

This is a major release with significant new capabilities:

### CAPTCHA Resolver
Full end-to-end CAPTCHA solving built into the browser tool — not a third-party API, the agent itself solves challenges:
- **Image Grid Solver** — Screenshots each tile individually, AI vision analyzes which match the instruction ("select traffic lights"), clicks matching tiles, handles dynamic tile replacement in reCAPTCHA
- **Slider Solver** — Human-like drag with eased curves + micro-jitter for GeeTest, MTCaptcha, and custom sliders
- **FunCaptcha Solver** — Auto-detects puzzle type (rotation, drag-drop, image-match, counting) from Arkose Labs / Microsoft CAPTCHA
- **Hold-Click** — Press-and-hold interactions with human jitter for advanced challenge types
- **Structured Error Returns** — All CAPTCHA actions return `[OK]`, `[ERROR]`, or `[WARN]` status so the agent knows exactly what succeeded and what to retry

### CloakBrowser Engine
Replaced plain Playwright with **CloakBrowser** — a patched Chromium with source-level anti-detection:
- Undetectable webdriver spoof, WebGL/Canvas fingerprint, plugin/language spoofing
- Persistent browser profiles (cookies, sessions survive across runs)
- Human-like mouse, keyboard, and scroll behavior built-in
- Auto-downloads patched Chromium binary on first run

### Rust Native Token Counter
New `native/token-counter/` module built with **tiktoken-rs** via napi-rs:
- Accurate BPE token counting (was underestimating by 30-60%)
- Supports `cl100k_base` (GPT-4) and `o200k_base` (GPT-4o) encodings
- Real API usage tracking from `response.usage.promptTokens` / `completionTokens`
- Automatic JS fallback if Rust unavailable

### Bug Hunt Skill
Imported 100+ CTF and penetration testing skills from `ljagiello/ctf-skills`:
- 9 categories covering web, pwn, crypto, reverse, forensics, misc, malware, OSINT, AI/ML
- Dispatcher skill that categorizes challenges by file type, keywords, and service behavior
- Routes to the matching sub-skill with deep specialized techniques

### Other Improvements
- **1000 iteration limit** (up from 200) — agents can work on complex tasks without stopping prematurely
- **Structured tool responses** — `[OK]` / `[ERROR]` / `[WARN]` prefixes for unambiguous agent feedback
- **30 browser actions** — from basic navigation to full CAPTCHA solving workflows
- **Multi-platform installers** — One-line install for Linux, macOS, and Windows

## Real-World Use Cases

### The "Hands-Free" Developer
> **You:** *"Look at `auth.ts`. There's a bug where JWT tokens expire too early. Fix it, run the test suite, and if it passes, push it."*
> **AURIX:** Reads the file, edits the code, runs tests, sees an error, fixes it, runs again, executes `git push`.

### The Deep Researcher
> **You:** *"Write a 5-page PDF report on how Vercel alternatives are perceived on Reddit and HackerNews."*
> **AURIX:** Spawns a 13-agent research pipeline. Scrapes forums, debates claims, compiles data into markdown, converts to styled PDF.

### The Browser Automator
> **You:** *"Go to this site, fill the registration form, solve whatever CAPTCHA pops up, and submit."*
> **AURIX:** Opens stealth browser, fills form, detects reCAPTCHA image challenge, screenshots each tile, uses vision to pick matching images, clicks verify.

### The CTF Player
> **You:** *"Here's a challenge file. Find the flag."*
> **AURIX:** Triages the file, categorizes it (crypto? web? pwn?), loads the matching Bug Hunt sub-skill, applies specialized techniques, captures the flag.

## Key Features

- **Terminal-First UI (TUI):** Beautiful, interactive CLI built with React Ink.
- **Multi-Platform Gateway:** Access from Terminal, Discord, Telegram, or WhatsApp. Memory and context persist everywhere.
- **Self-Extending:** `> install skill from github.com/user/awesome-skill` — clones, validates, and rebuilds without restarting.
- **Accurate Token Counting:** Native Rust BPE tokenizer prevents context waste.
- **Stealth Browser:** CloakBrowser with source-level Chromium patches, human-like behavior, and full CAPTCHA solving.
- **1000 Iteration Limit:** Agents can work on complex tasks without hitting premature limits.

## How It Works Under the Hood

AURIX is powered by a LangGraph-based architecture that orchestrates multiple specialized AI agents:

1. **The Orchestrator (Supervisor Agent):** Analyzes your request and delegates to specialist agents.
2. **The Specialists:** Code Reviewer, Security Analyst, Deep Researcher, CTF Player — working in parallel.
3. **The Execution Engine:** 46+ built-in tools including a stealth browser, Rust token counter, and Docker manager.
4. **The Verification Loop:** A Critic Agent reviews output before returning. If execution fails, the loop retries with exponential backoff.

## Quick Start

### Requirements

- [Bun](https://bun.sh) v1.0+ or Node.js 22+
- API key for at least one LLM provider (OpenAI, Anthropic, or others)
- Rust toolchain (optional — improves token counting accuracy)
- Python 3.12+ (optional, for research-forums skill)

### One-Line Install

All scripts pull the latest version from the repo automatically — your install stays up to date.

**Linux:**
```bash
curl -fsSL https://api.haikz.me/install.sh | bash
```

**macOS:**
```bash
curl -fsSL https://api.haikz.me/install.mac.sh | bash
```

**Windows (PowerShell):**
```powershell
irm https://api.haikz.me/install.ps1 | iex
```

**Windows (CMD):**
```cmd
curl -fsSL -o install.bat https://api.haikz.me/install.bat && install.bat
```

*These scripts automatically install Bun (if missing), clone the repository, build the project, and link the `aurix` command to your terminal.*

### Manual Install

```bash
git clone https://github.com/DekaPrayoga/AurixAgent.git
cd AurixAgent
bun install        # or npm install
bun run build      # or npm run build
npm link           # link bin/aurix to PATH
```

### From Source (with Rust token counter)

```bash
git clone https://github.com/DekaPrayoga/AurixAgent.git
cd AurixAgent
npm install        # postinstall auto-builds Rust module
npm run build
npm link
```

## Usage

### 1. Initial Setup
```bash
aurix setup        # Configure LLM provider, API key, model
```

### 2. Start Interactive Session
```bash
aurix              # Launch the terminal AI workspace
```

### 3. Start Multi-Platform Gateway
```bash
aurix gateway      # Run as Discord/Telegram/WhatsApp bot
```

### Other Commands
```bash
aurix sessions     # List previous sessions
aurix --resume ID  # Resume a specific session
aurix update       # Update to latest version
aurix --help       # Show all commands
```

## Architecture

```text
src/
  agent/       Core agent loop, context, memory, TokenCounter
  tools/       46+ tools (Browser, Research, Docker, Git, etc.)
  cli/         Terminal UI (React Ink)
  gateway/     Discord / Telegram / WhatsApp integration
  providers/   LLM providers (OpenAI, Anthropic, LangChain)
  skills/      Skill registry and loader

native/
  token-counter/   Rust BPE tokenizer (tiktoken-rs via napi-rs)
    Cargo.toml     Rust crate config
    src/lib.rs     count_tokens(), count_tokens_batch()

skills/
  bug-hunt/        100+ CTF & security testing skills
    ctf-web/       Web exploitation (SQLi, XSS, SSTI, SSRF, JWT...)
    ctf-pwn/       Binary exploitation (ROP, heap, kernel...)
    ctf-crypto/    Cryptography (RSA, AES, ECC, PRNG, ZKP...)
    ctf-reverse/   Reverse engineering (ELF/PE, VMs, WASM...)
    ctf-forensics/ Forensics (disk, memory, PCAP, stego...)
    ctf-misc/      Jails, encodings, RF/SDR, game theory
    ctf-malware/   Malware analysis (C2, packers, .NET)
    ctf-osint/     OSINT (social media, geolocation, DNS)
    ctf-ai-ml/     AI/ML security (adversarial, prompt injection)
    ctf-writeup/   Write-up generator
```

## The Arsenal: 46+ Built-in Tools

| Category | Capabilities |
| --- | --- |
| **File & Code** | Read, write, edit, search files, terminal exec, code sandbox |
| **Browser** | Stealth Chromium (CloakBrowser), CAPTCHA solving (reCAPTCHA, hCaptcha, FunCaptcha, Turnstile, GeeTest, sliders), drag-to, hold-click, persistent profiles |
| **Web** | Web search, scraper, YouTube |
| **Office** | PDF, Excel, PowerPoint generation, SMTP Email |
| **DevOps** | Docker, VPS management, deployments, cloud provisioning |
| **Finance** | Trading analysis, EVM/Solana blockchain tools |
| **Security** | Bug Hunt skills (100+ CTF techniques), OSINT, vulnerability scanning |
| **Creative** | GIF search, text humanizer, architecture diagrams |
| **Utility** | Maps, notifier, music player, todo, memory |
| **GitHub** | PR creation, issue management, repo info |
| **MCP** | Manage Model Context Protocol servers |
| **Planning** | Project planning, Kanban, story decomposition |

## Self-Extension

AURIX can install new skills from any GitHub repository at runtime:

```text
> install skill from github.com/user/awesome-skill
```

It clones, validates, registers, and rebuilds automatically. No restart needed.

## Supported LLM Providers

- OpenAI (GPT-4, GPT-4o, etc.)
- Anthropic (Claude 3.5, Claude 4)
- Any OpenAI-compatible endpoint
- LangChain integrations

## Environment Variables

```bash
cp .env.example .env
```

Key variables:
- `OPENAI_API_KEY` — OpenAI access
- `ANTHROPIC_API_KEY` — Anthropic access
- `DISCORD_TOKEN` — Discord bot gateway
- `TELEGRAM_BOT_TOKEN` — Telegram gateway
- `BRAVE_API_KEY` — Enhanced web search (optional)

## License

MIT
