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

## What is AURIX

AURIX is not another chat wrapper. It is a **tool-using AI workspace** built for people who want an AI that can actually do work:

- Read, write, and refactor real files in your project
- Execute shell commands in a real environment
- Research topics with multi-source citations
- Automate browser and system tasks
- Generate PDFs, spreadsheets, and presentations
- Accessible from terminal, Discord, Telegram, and WhatsApp

The core philosophy: **give the model real tools, persistent memory, and an interface that fits how technical users actually work.**

## Features

### Code & Repo Work
- Full repository inspection and navigation
- Intelligent file editing and refactoring
- Command execution with context awareness
- Implementation support beyond just snippets

### Deep Research
- Multi-source information gathering (web, arXiv, Wikipedia, forums)
- Citation-verified output
- Structured reports with configurable depth
- 13-agent research pipeline for deep analysis

### Automation
- Shell command automation
- Browser automation (headless Chrome)
- Workflow chaining across tools
- File operations at scale

### Document Generation
- PDF reports
- Excel spreadsheets
- PowerPoint presentations
- Structured markdown output

### Multi-Platform Gateway
- Same workspace from terminal, Discord, Telegram, and WhatsApp
- Session persistence across platforms
- QR code login for messaging apps

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
