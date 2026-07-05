# AURIX Agent

<p align="center">
  <img src="https://www.image2url.com/r2/default/images/1783253521423-c6c0dcbf-3529-48f2-9399-415773d6c6a3.png" alt="AURIX Agent" width="760" />
</p>

<p align="center">
  <img src="https://img.shields.io/badge/license-MIT-22c55e?style=for-the-badge" alt="MIT" />
  <img src="https://img.shields.io/npm/v/aurix-ai?style=for-the-badge&color=cb3837&logo=npm&logoColor=white" alt="npm" />
  <img src="https://img.shields.io/badge/runtime-Node.js%20%7C%20Bun-339933?style=for-the-badge&logo=node.js&logoColor=white" alt="Runtime" />
  <img src="https://img.shields.io/badge/language-TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/interface-Terminal%20%2B%20Gateway-7c3aed?style=for-the-badge" alt="Interface" />
</p>

<p align="center">
  <b>The open-source AI agent that does not just chat — it opens browsers, edits repos, runs tools, solves verification widgets, hunts bugs, and finishes workflows.</b>
</p>

<p align="center">
  AURIX is a terminal-native autonomous workspace for builders, researchers, CTF players, and automation power users.<br/>
  Bring your own model endpoint, launch the TUI, and let the agent operate inside your real environment.
</p>

<p align="center">
  <a href="#quick-install"><b>Quick Install</b></a> ·
  <a href="#why-aurix"><b>Why AURIX</b></a> ·
  <a href="#standout-features"><b>Features</b></a> ·
  <a href="#bug-hunt-skills"><b>Bug Hunt</b></a> ·
  <a href="#research-social-intelligence"><b>Social Research</b></a> ·
  <a href="#configuration"><b>Config</b></a>
</p>

---

## Quick Install

```bash
npm install -g aurix-ai
aurix setup
aurix
```

That is the whole path: install the CLI, configure your model endpoint, then start the terminal workspace.

For development:

```bash
git clone https://github.com/DekaPrayoga/AurixAgent.git
cd AurixAgent
npm install
npm run build
npm link
aurix
```

Need a simple prompt-only mode?

```bash
aurix --lite
```

Want AURIX in chat apps?

```bash
aurix gateway
```

---

## Why AURIX?

Most AI coding tools stop at suggestions. AURIX is built to **operate**.

| If you want... | AURIX gives you... |
|---|---|
| An AI that can actually use your machine | Terminal execution, file editing, repo search, build/test loops, and tool calls. |
| Browser automation that can continue past verification prompts | CloakBrowser automation with screenshot observation, human-like input, CAPTCHA/grid/audio/slider flows. |
| Security and CTF help that is not generic | A full Bug Hunt skill pack for web, pwn, crypto, reverse, forensics, OSINT, malware, misc, AI/ML, and writeups. |
| Research that goes beyond one search result | Web search, scraping, forum/social research, synthesis, reports, and depth-based review/debate. |
| Trading and market analysis workflows | Stock/crypto/DeFi skills plus a `trading` tool for analysis, technical indicators, news, portfolio, comparison, and risk views. |
| Decisions that need disagreement | Council/debate patterns, supporter/skeptic/judge research agents, and native multi-agent routing. |
| An agent you can reach outside the terminal | Discord, Telegram, and WhatsApp gateway support. |
| No lock-in to one hosted model | OpenAI-compatible, Anthropic-compatible, and custom endpoint configuration. |
| Extensible tools | MCP server manager plus a large local skill system. |

AURIX is for people who want an agent that can **see, click, type, read, edit, run, investigate, remember, and report back**.

---

## What Can It Do?

```text
You:  Fix the failing auth tests and patch the bug.
AURIX: Reads the repo → edits code → runs tests → reads errors → fixes again.

You:  Open this signup page and complete the verification step.
AURIX: Opens CloakBrowser → fills fields → solves image/audio/slider challenge → submits.

You:  Solve this CTF web challenge.
AURIX: Loads Bug Hunt → maps routes → checks auth/injection/upload/JWT paths → writes exploit notes.

You:  Research what people say about this product across Reddit, X, YouTube, TikTok, HN, GitHub, Polymarket, and the web.
AURIX: Runs social research → clusters evidence → ranks signals → writes a source-backed brief.

You:  Analyze NVDA vs AMD with technicals, news, risk, and crypto/DeFi context.
AURIX: Uses trading + finance skills → gathers market data → compares signals → highlights risk, not financial advice.

You:  This product decision is debatable — convene a council.
AURIX: Splits voices into Architect, Skeptic, Pragmatist, and Critic → surfaces disagreement → gives a verdict.

You:  /depth xhigh — audit this project from Telegram.
AURIX: Applies deeper routing for that gateway user and returns a reviewed result.
```

---

## Standout Features

### 1. Stealth Browser + CAPTCHA / Verification Solving

AURIX ships with a Playwright-powered browser tool backed by **CloakBrowser**. It is designed for realistic browser automation: persistent profiles, visual page observation, human-like mouse paths, natural typing, scrolling, drag/drop, and autonomous handling of interactive verification widgets.

| Capability | What AURIX does |
|---|---|
| **Image grid challenges** | Screenshots tiles, asks a vision model to identify targets, clicks selected tiles with human-like movement, and verifies. |
| **Audio challenges** | Opens audio mode, retrieves or listens to the challenge, transcribes it through the configured audio path, and submits the answer. |
| **Hybrid mode** | Tries image solving first, then falls back to audio when needed. |
| **Sliders / drag widgets** | Uses eased mouse paths, overshoot correction, micro-jitter, and hold/drag actions. |
| **FunCaptcha / Arkose-style widgets** | Detects puzzle style and applies rotation, drag/drop, image-match, or interaction flows. |
| **Turnstile-style managed prompts** | Observes the widget and performs the required click/interaction flow when possible. |
| **Human behavior** | Warmup movement, natural delays, typo correction, scroll easing, random pauses, and persistent browser profile. |

Browser actions include:

```text
navigate, click, fill, type, screenshot, snapshot,
signup-assist, signin-assist,
detect-captcha, solve-captcha, captcha-grid, click-tile, captcha-verify,
slider-analyze, drag-to, hold-click
```

Hybrid CAPTCHA configuration:

```yaml
# ~/.aurix/config.yaml
captchaAudio: "hybrid"      # image | audio | hybrid
visionModel: "your-vision-model"
visionBaseUrl: "https://your-openai-compatible-endpoint/v1"
visionApiKey: "..."
```

> Best results come from a strong vision-capable model. If your main model is text-only, configure a separate `visionModel` for browser screenshots.

### 2. Bug Hunt Skills

AURIX includes a real local **Bug Hunt skill system** for CTFs, authorized security testing, security labs, and defensive research. Instead of generic security advice, AURIX can route into category-specific playbooks and technique notes.

| Skill Area | What it covers |
|---|---|
| **Web exploitation** | SQLi, XSS, SSTI, SSRF, XXE, JWT/JWE, OAuth/OIDC, SAML, file upload bugs, auth bypass, request smuggling, prototype pollution, GraphQL, parser tricks, known CVE patterns. |
| **Pwn / binary exploitation** | Buffer overflow, ROP, heap exploitation, format strings, seccomp, shellcoding, ELF triage. |
| **Crypto** | RSA, AES modes, ECC, PRNG weakness, padding oracles, lattice/Coppersmith-style attacks, ZKP and challenge-specific math. |
| **Reverse engineering** | ELF/PE analysis, stripped binaries, VMs, WASM, obfuscation, game/client reversing. |
| **Forensics** | PCAP, disk images, memory dumps, steganography, logs, browser artifacts, timeline reconstruction. |
| **OSINT** | Username/email/phone/domain/IP pivots, geolocation, DNS/WHOIS, public web traces, social-media investigation. |
| **Malware** | C2 traffic analysis, packers, .NET, obfuscated scripts, shellcode triage. |
| **AI/ML security** | Prompt injection challenges, adversarial examples, model extraction concepts, jail/challenge analysis. |
| **Writeups** | Turn solved challenges into clean, reproducible writeups. |

Pre-install CTF tooling when you want a ready lab box:

```bash
bash skills/bug-hunt/install_ctf_tools.sh all
```

Use only where you are allowed to test: CTFs, lab boxes, authorized bug bounty targets, internal audits, and defensive investigations.

### 3. Research + Social Intelligence

AURIX research is not limited to generic web search. The skill tree includes **social-researching** for finding what people actually say across social platforms, plus deep research, fact-checking, citation checks, claim verification, summarization, and video analysis.

| Research lane | Coverage |
|---|---|
| **Social research** | Reddit, X, YouTube, TikTok, Hacker News, Polymarket, GitHub, and the wider web. |
| **Deep research** | Multi-source planning, source gathering, deep-reading, synthesis, citations, and reports. |
| **Fact / claim checks** | Claim extraction, citation verification, skeptical review, and source-backed verdicts. |
| **Video research** | Useful when the topic includes YouTube/TikTok/video claims or creator sentiment. |
| **Market / product intelligence** | Competitive research, user sentiment, investor/market signals, and source attribution. |

The higher `/depth` levels activate more review behavior in the native research pipeline: supporter, skeptic, debate system, judge, citation guardian, logic critic, writer, and final reviewer.

### 4. Trading, Stocks, Crypto, and DeFi Analysis

AURIX includes both a `trading` tool and finance skills. It can analyze tickers, market news, technical indicators, stock comparisons, crypto/on-chain context, DeFi protocol risks, and portfolio-style summaries.

| Finance lane | What it does |
|---|---|
| **Trading analysis** | Symbol analysis, sentiment/news, technical indicators, comparison, portfolio, risk, and report actions. |
| **Stocks** | Fundamental + technical analysis, earnings/guidance context, valuation and sector risk framing. |
| **Crypto** | Project research, wallet/on-chain context, token risk notes, market data, contract caution. |
| **DeFi** | TVL, protocol metrics, audit status, smart-contract/admin/upgradeability risks. |
| **Prediction markets / market intelligence** | Non-advisory planning, oracle/venue research, and risk review workflows where the skill pack is available. |

AURIX should frame this as analysis and risk context, not financial advice.

### 5. Native Multi-Agent + Debatable Decisions

For bigger tasks, AURIX can route work through specialist agents while keeping them inside the native Aurix runtime: same provider config, same tools, same timeout behavior, same progress events.

```text
/multiagent        Toggle native multi-agent routing
/depth high        Prefer deeper routing for research/complex engineering tasks
/depth xhigh       Add stronger verification/debate for high-value tasks
/depth max         Force deep routing for research and complex builds/audits
/depth ultra       Maximum depth with final synthesis/review
/fast              Return to low-depth fast single-agent mode
```

AURIX also ships skill patterns for **council-style decisions** and team orchestration:

| Pattern | Useful when |
|---|---|
| **Research debate** | Claims need supporter/skeptic debate, judging, citation checking, and final review. |
| **Council** | A decision is genuinely debatable and needs Architect, Skeptic, Pragmatist, and Critic voices. |
| **Team orchestration** | Multi-agent work needs ownership, work items, merge gates, handoffs, and evidence. |
| **Parallel execution** | Independent lanes can run faster without losing correctness. |
| **Autonomous loops** | Long-running pipelines need sequential or DAG-like agent workflows. |

What this means in practice:

- code tasks can get implementation + review style passes,
- research tasks can use deeper source gathering and synthesis,
- complex audits can route through verifier/judge-style flows,
- product decisions can expose dissent before choosing,
- tool progress is visible instead of hidden behind a black box.

### 6. Multi-Platform Gateway

AURIX is not locked to one terminal window. Run it as a bot and keep working from chat apps:

| Interface | Best for |
|---|---|
| **Terminal TUI** | Coding sessions, repo edits, browser automation, local tools. |
| **Lite mode** | Fast prompt-only sessions. |
| **Discord** | Server/team workflows and remote task control. |
| **Telegram** | Mobile control and personal automation. |
| **WhatsApp** | Always-on assistant access through a familiar chat app. |

```bash
aurix gateway
```

Gateway mode supports per-user sessions, context continuity, command handling, and tool status updates.

### 7. MCP + Local Skill System

AURIX supports the **Model Context Protocol** and a large local skill directory.

```text
/mcp              Open interactive MCP manager
/mcp presets      Browse built-in server presets
/mcp catalog      Search MCP server catalog
/mcp connect      Add a server
/mcp reload       Restart MCP servers
/skills           List loaded local skills
/addskills        Enable the skill_loader tool
```

The local `skills/` tree currently contains **330+ skill files**, including Bug Hunt, trading/finance, social research, deep research, debate/council workflows, multi-agent orchestration, engineering patterns, testing, deployment, research, and automation skills.

---

## Command Map

### CLI entrypoints

```bash
aurix              # Launch full TUI
aurix --lite       # Launch lite prompt mode
aurix setup        # Configure provider/model/key
aurix gateway      # Start Discord/Telegram/WhatsApp gateway
aurix --continue   # Continue latest session
aurix --resume ID  # Resume a specific session
```

### In-app slash commands

| Command | Purpose |
|---|---|
| `/help` | Show command help. |
| `/status` | Show current model/session/tool status. |
| `/model` | View or switch model. |
| `/tools` | List available tools. |
| `/context` | Show context usage. |
| `/clear` | Clear visible chat. |
| `/reset` | Reset the current agent context. |
| `/theme` | Change TUI theme. |
| `/border` | Change border style. |
| `/browserui` / `/gui` | Browser UI helpers. |
| `/mcp` | Manage MCP servers. |
| `/github` | GitHub integration helpers. |
| `/gmail` | Gmail/email integration helpers. |
| `/depth` / `/effort` | Change reasoning/research depth. |
| `/deep-research` | Run explicit deep research flow. |
| `/multiagent` | Toggle native multi-agent routing. |
| `/fast` | Switch back to low-depth fast mode. |
| `/skills` / `/skill` | Browse skills or adjust skill visibility. |
| `/todo` | Manage todo items. |
| `/rules` | Manage session/project rules. |
| `/sessions` | Browse/resume sessions. |
| `/save` / `/export` / `/copy` | Save, export, or copy output. |
| `/reload-mcp` | Restart MCP servers and reload tools. |
| `/permissions` | Inspect permission settings. |
| `/exit` | Quit. |

---

## Configuration

Main config file:

```text
~/.aurix/config.yaml
```

Example:

```yaml
provider: custom              # openai | anthropic | custom | custom-anthropic
apiStyle: openai              # openai | anthropic | auto
baseUrl: "https://your-endpoint/v1"
apiKey: "..."
model: "your-model"

researchMode: low             # low | medium | high | xhigh | max | ultra
themeName: aurix
captchaAudio: "hybrid"

browser:
  proxies:
    - "http://user:pass@host:port"

gateway:
  discord:
    enabled: false
    token: ""
  telegram:
    enabled: false
    token: ""
  whatsapp:
    enabled: false
```

Environment variables override config values.

<!-- AUTO-GENERATED: env-reference -->
| Variable | Required | Description | Example |
|---|---:|---|---|
| `AURIX_PROVIDER` | No | Provider type. | `openai`, `anthropic`, `custom` |
| `AURIX_API_KEY` | Yes | Main model API key. | `sk-...` |
| `AURIX_BASE_URL` | No | Base URL for OpenAI-compatible or Anthropic-compatible endpoints. | `https://your-endpoint/v1` |
| `AURIX_API_STYLE` | No | Force endpoint protocol if auto-detect fails. | `auto`, `openai`, `anthropic` |
| `AURIX_MODEL` | No | Main model name. | `gpt-4o`, `your-model` |
| `AURIX_VISION_MODEL` | No | Vision model for screenshots/browser tasks. | `your-vision-model` |
| `SEARCH_API_KEY` | No | Optional external search provider key. | `...` |
| `SPOTIFY_ACCESS_TOKEN` / `SPOTIFY_TOKEN` | No | Optional music-control credentials. | `...` |
| `DISCORD_TOKEN` | No | Discord gateway token. | `...` |
| `TELEGRAM_TOKEN` | No | Telegram gateway token. | `...` |
<!-- /AUTO-GENERATED: env-reference -->

---

## Built-in Tool Categories

| Category | Capabilities |
|---|---|
| **File & Code** | Read/write/edit/search files, terminal execution, code execution. |
| **Browser** | CloakBrowser automation, screenshots, snapshots, CAPTCHA/verification solving, sliders, drag/drop. |
| **Web & Research** | Web search, scraping, social research across Reddit/X/YouTube/TikTok/HN/GitHub/Polymarket, forum research, YouTube helpers, report generation. |
| **Git & GitHub** | Git operations, PR/issues, releases, CI status, merge-conflict helpers. |
| **Office** | PDF, Excel, PowerPoint, email. |
| **DevOps** | Docker, VPS, deploy, cloud provisioning. |
| **Security / OSINT** | Authorized security testing helpers, CTF skills, OSINT investigation. |
| **Finance / Blockchain** | Trading analysis, stocks, crypto, DeFi, prediction-market research, EVM/Solana tooling. |
| **Creative** | GIF search, text humanizer, diagrams. |
| **Utility** | Maps, notifier, music, todo, memory, archive reader. |
| **MCP** | External tool servers loaded through Model Context Protocol. |

---

## Architecture

```text
src/
  agent/       Agent loop, context, config, memory, research pipeline, multi-agent runtime
  cli/         OpenTUI React interface, command palette, input/output panels
  gateway/     Discord / Telegram / WhatsApp gateway
  mcp/         MCP client, registry, catalog, tool adapter
  providers/   OpenAI-compatible, Anthropic-compatible, and custom provider adapters
  skills/      Local skill registry and loader
  tools/       Browser, terminal, file ops, git, research, OSINT, office, deploy, cloud, etc.
  utils/       Update check, terminal sanitization, base URL helpers, ASCII logo

skills/
  bug-hunt/    CTF and authorized security-testing skill pack

bin/
  aurix.js     CLI launcher

scripts/
  build.cjs    Build script
```

---

## Development

<!-- AUTO-GENERATED: package-scripts -->
| Command | Description |
|---|---|
| `npm run build` | Compile TypeScript with `scripts/build.cjs`. |
| `npm run dev` | Run `src/index.tsx` through `tsx`. |
| `npm run start` | Run the built app from `dist/index.js`. |
| `npm run prepare` | Build during package preparation. |
| `npm run postinstall` | Run package postinstall setup. |
| `npm run lint` | Run ESLint on `src/**/*.ts`. |
| `npm run format` | Format TypeScript files with Prettier. |
<!-- /AUTO-GENERATED: package-scripts -->

Project facts:

- npm package: `aurix-ai`
- CLI binary: `aurix`
- Runtime target: Node.js/Bun-compatible TypeScript
- Build output: `dist/`
- Config directory: `~/.aurix/`
- Browser profile: `~/.aurix-browser-profile`
- License: MIT

---

## Star the Repo

If AURIX looks useful, give it a ⭐ on GitHub. It helps more developers find the project, try the agent, report bugs, and contribute new tools/skills.

## License

MIT
