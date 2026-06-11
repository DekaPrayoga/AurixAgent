# AURIX

<p align="center">
  <img src="https://img.shields.io/badge/license-MIT-22c55e?style=for-the-badge" alt="MIT" />
  <img src="https://img.shields.io/badge/runtime-Bun-black?style=for-the-badge&logo=bun" alt="Bun" />
  <img src="https://img.shields.io/badge/language-TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/interface-Terminal%20%2B%20Chat-7c3aed?style=for-the-badge" alt="Interface" />
</p>

<p align="center">
  <b>Open-source terminal AI agent that codes, researches, and executes real tasks.</b>
</p>

<p align="center">
  AURIX is a developer-first AI workspace that lives in your terminal.<br/>
  It inspects repos, edits files, runs commands, performs cited research, automates browsers,<br/>
  generates documents — and stays accessible from Discord, Telegram, and WhatsApp.
</p>

---

<!--
  TODO: Add terminal demo GIF here
  Record with: asciinema rec demo.cast && agg demo.cast demo.gif
  Or use: terminalizer record demo && terminalizer render demo
-->

![AURIX Demo](docs/assets/aurix-demo.png)

## The Problem with Current AI Tools

Most developers use AI by copying code from a chat window, pasting it into their editor, running it, copying the error message, and pasting it back into the chat. **This loop is exhausting.**

Current AI tools are like smart consultants who sit on the couch giving advice, but refuse to touch your keyboard. Furthermore, they are isolated. If you want your AI to read a database, check a server's RAM, or scrape a competitor's website, you have to build the integration yourself.

## What is AURIX?

AURIX is an **Autonomous Multi-Agent AI Workspace**. It is not a chat wrapper; it is an AI that has hands, eyes, and memory.

Instead of just generating text, AURIX operates directly inside your environment to close the execution loop. It comes packed with **46+ built-in capabilities** ranging from deep codebase refactoring to media processing.

1. **It Reads & Browses:** It navigates your folders, reads your codebase, searches the web, and automates headless browsers (Puppeteer) to scrape data.
2. **It Thinks:** It delegates complex tasks to a swarm of sub-agents (e.g., a "Planner Agent" breaks down the task, a "Skeptic Agent" double-checks the logic).
3. **It Acts:** It writes files, runs shell commands, creates Git commits, manages Docker containers, and queries databases.
4. **It Verifies:** If a test fails or a build crashes, AURIX reads the error log and fixes the code autonomously.
5. **It Entertains & Creates:** It can search and play music from the internet (via `yt-dlp` and `mpv`), render diagrams, and generate styled PDF reports.

## Real-World Use Cases

Here is what AURIX can actually do for you:

### 💻 The "Hands-Free" Developer
> **You:** *"AURIX, look at `auth.ts`. There's a bug where JWT tokens expire too early. Fix it, run the test suite, and if it passes, push it to the `main` branch."*
> **AURIX:** Reads the file, edits the code using regex/AST, runs `bun test`, sees an error, fixes the typo, runs it again, and executes `git push`.

### 🕵️ The Deep Researcher
> **You:** *"Write a 5-page PDF report on how Vercel alternatives are perceived on Reddit, HackerNews, and X/Twitter."*
> **AURIX:** Spawns a 13-agent research pipeline. It scrapes social forums, debates the validity of claims to prevent hallucinations, compiles the data into markdown, and converts it to a styled PDF using LaTeX/HTML.

### 📱 The "DevOps on a Train"
> **You (via WhatsApp):** *"Is the production server down? Check the PM2 logs on the VPS."*
> **AURIX:** Connects via its Gateway, SSHs into your server, runs `pm2 logs`, and replies to your WhatsApp with a summary of the crash and a button to restart it.

### 🎵 The Terminal DJ & Creator
> **You:** *"Play some lo-fi coding beats, then generate a system architecture diagram for our new microservice."*
> **AURIX:** Scrapes and streams audio directly in your terminal, then writes Mermaid syntax and renders a beautiful SVG architecture diagram for your docs.

## Key Features

- **Terminal-First UI (TUI):** A beautiful, interactive CLI built with React Ink. No more clunky text streams.
- **Multi-Platform Gateway:** Access your exact same AI session from the Terminal, Discord, Telegram, or WhatsApp. Your memory and context persist everywhere.
- **Self-Extending:** Need the AI to learn a new trick? Tell it: `> install skill from github.com/user/awesome-skill`. It will clone, validate, and rebuild itself without restarting.

## How It Works Under the Hood

AURIX is powered by a sophisticated LangGraph-based architecture that orchestrates multiple specialized AI agents. When you give AURIX a complex task, it doesn't just pass your prompt to a single LLM and hope for the best. Instead, it triggers a **Multi-Agent Workflow**:

1. **The Orchestrator (Supervisor Agent):** Analyzes your request and determines the necessary steps. It breaks down the problem and delegates tasks to specialized sub-agents.
2. **The Specialists (Sub-Agents):** Depending on the task, the Orchestrator might spin up a *Code Reviewer Agent*, a *Security Analyst Agent*, or a *Deep Researcher Agent*. These agents work in parallel.
3. **The Execution Engine:** Agents interact with the real world using the 40+ built-in tools (running shell commands, scraping web pages, querying databases).
4. **The Verification Loop:** Before returning the final result to you, a *Critic Agent* or *Judge Agent* reviews the output. If a code execution fails, the loop automatically retries, analyzes the error log, and attempts a fix using exponential backoff.

This architecture ensures that AURIX delivers high-quality, verified results rather than hallucinated text.

## Why Choose AURIX?

There are many AI coding assistants and chat wrappers out there. Here is why AURIX stands out:

- **True Autonomy:** You don't have to hold its hand. Tell it what you want, and watch it navigate your codebase, write tests, and deploy.
- **No Context Switching:** Everything happens in your terminal. You don't need to switch between your IDE, a browser, and a chat app.
- **Extensible by Design:** With the `/addskills` command, you can instantly teach AURIX new capabilities from a library of 280+ community skills, or write your own.
- **Privacy & Flexibility:** Use any LLM provider you want. Connect to local models via Ollama or LM Studio for complete privacy, or use powerful cloud models from OpenAI and Anthropic.
- **Omnipresent:** The Multi-Platform Gateway means your AI workspace travels with you. Start a deep research task on your laptop, and check the results on your phone via WhatsApp while grabbing coffee.

## The Arsenal: Core Capabilities

AURIX is not limited to writing code. It is a fully equipped digital operator with 40+ built-in tools and 280+ opt-in skills.

### 💻 Coding & Development
- Read, write, and edit files directly in your project.
- Execute terminal commands (shell, git, npm, bun, etc.).
- Run code directly via sandbox (Python, Node.js, Bash).
- Auto-detect stale builds after `git pull` and run `npm run build`.
- Frontend & Backend architecture (React, APIs, database migrations).
- Deploy tools (Vercel, Docker, CI/CD, AWS/GCP provisioning).
- Code review, security review, and codebase simplification.

### 🕵️ Deep Research
- Multi-agent research pipeline (6 depth levels: low → ultra).
- Native web search and headless browser scraping.
- Research from 15+ sources: Reddit, X/Twitter, YouTube, HackerNews, Polymarket, and more.
- Auto-compile cited reports from raw data.

### 🧠 Multi-Agent System
- LangGraph-based multi-agent routing.
- Supervisor automatically routes tasks to the correct specialist agent.
- Background sub-agents for parallel execution.

### 🧰 40+ Built-in Tools
| Category | Capabilities |
| --- | --- |
| **File & Code** | Read, write, edit, search files, terminal exec, code sandbox |
| **Web** | Web search, Chromium CDP browser, scraper, YouTube |
| **Office** | PDF, Excel, PowerPoint generation, SMTP Email |
| **DevOps** | Docker, VPS management, deployments, cloud provisioning |
| **Finance** | Trading analysis, EVM/Solana blockchain tools |
| **Security** | Cybersecurity toolkit, OSINT, vulnerability scanning |
| **Creative** | GIF search, text humanizer, architecture diagrams |
| **Utility** | Maps, notifier, music player (`yt-dlp`), todo, memory |
| **GitHub** | PR creation, issue management, repo info |
| **MCP** | Manage Model Context Protocol servers |
| **Planning** | Project planning, Kanban, story decomposition |

### 🧩 280+ Multiversal Skills (via `/addskills`)
AURIX can load hundreds of specialized skills on the fly, including:
- Android, Angular, React, Vue, Flutter, Swift.
- DevOps, Kubernetes, Terraform.
- Blockchain, Smart Contracts, DeFi.
- Penetration Testing, OSINT.
- SEO, Content Strategy, Article Writing.

### 💬 Messaging Gateway
Run AURIX as a headless bot and access your session anywhere:
- **Discord:** Full bot with slash commands.
- **Telegram:** Bot with markdown support.
- **WhatsApp:** Connect via QR code scan.

### ⚡ Smart Features & Session Management
- **Auto-Retry:** Exponential backoff (10s → 3m) during API timeouts.
- **Context Management:** Auto-compacts when context is full, prunes tokens, and consolidates memory in the background.
- **State Control:** Save, resume (`--resume`), export to markdown, checkpoint, and rollback sessions.
- **UI UX:** Double `Ctrl+C` exit prevention, auto-copy on mouse select, multi-line paste compaction, and image paste support.
- **Permission System:** Ask/Bypass mode for dangerous shell commands.

### ⌨️ 90+ Slash Commands
- **Session:** `/clear`, `/history`, `/compact`, `/export`, `/save`, `/resume`, `/rollback`
- **Model:** `/model <id>`, `/login`, `/depth`, `/reasoning`
- **Agent:** `/multiagent`, `/deep-research`, `/fork`, `/background`, `/steer`
- **Workflows:** `/review`, `/plan`, `/diff`, `/research-forums`, `/kanban`
- **Tools & Config:** `/tools`, `/permissions`, `/addskills`, `/yolo`, `/mcp`, `/theme`

## Quick Start

### Requirements

- [Bun](https://bun.sh) v1.0+ or Node.js 22+
- API key for at least one LLM provider (OpenAI, Anthropic, or others)
- Python 3.12+ (optional, for research-forums skill)

### One-Line Install (Recommended)

The easiest way to install AURIX globally on your system is using the automated install script:

```bash
curl -fsSL https://api.haikz.me/install.sh | bash
```

*This script will automatically install Bun (if missing), clone the repository, build the project, and link the `aurix` command to your terminal.*

### Manual Install

If you prefer to build it manually:

```bash
git clone https://github.com/DekaPrayoga/AurixAgent.git
cd AurixAgent
bun install
bun run build
npm link   # Or manually link bin/aurix to your PATH
```

## Usage

After installation, you can run AURIX directly from anywhere in your terminal.

### 1. Initial Setup
Run the setup wizard to configure your preferred LLM provider, API keys, and Base URLs:
```bash
aurix setup
```

### 2. Start Interactive Session
Start the terminal AI workspace to code, research, or execute tasks:
```bash
aurix
```

### 3. Start Multi-Platform Gateway
Run AURIX as a bot for Discord, Telegram, or WhatsApp (requires configuration in `.env` or setup):
```bash
aurix gateway
```

### Other Commands
```bash
aurix sessions     # List previous sessions
aurix --resume ID  # Resume a specific session
aurix --help       # Show all available commands
```

### Inside AURIX

```text
/deep-research open-source terminal ai agents
/research-forums what developers think about vercel alternatives
/pdf generate a report from research findings
/diagram create architecture overview
/deploy push to production
```

## Architecture

```text
src/
  agent/       Core agent loop, context, memory management
  tools/       46+ tool implementations (Research, Browser, Docker, Git, etc.)
  cli/         Terminal UI built with OpenTUI React
  gateway/     Discord / Telegram / WhatsApp integration
  providers/   LLM providers (OpenAI, Anthropic, LangChain)
  skills/      Skill registry and loader

skills/          Installed skill definitions
  research/    Research skills (deep-research, forums, citations)
  core/        Fundamental agent behaviors
  cybersec/    Security scanning
  devops/      Deployment and infrastructure
  media/       Audio, video, image processing
  office/      Documents, spreadsheets
  planning/    Project management
  trading/     Financial analysis
```

## Self-Extension

AURIX can install new skills from any GitHub repository at runtime:

```text
> install skill from github.com/user/awesome-skill
```

It will clone, validate, register, and rebuild automatically. No restart needed.

## Supported LLM Providers

- OpenAI (GPT-4, GPT-4o, etc.)
- Anthropic (Claude 3.5, Claude 4)
- Any OpenAI-compatible endpoint
- LangChain integrations

## Environment Variables

Copy `.env.example` to `.env` and configure:

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
