# AURIX

<p align="center">
  <b>Open-source terminal AI agent that can code, research, and execute real tasks.</b>
</p>

<p align="center">
  AURIX is a developer-first AI workspace for the terminal. It can inspect repositories, edit files, run shell commands, perform cited research, automate browser tasks, generate documents, and work across Terminal, Discord, Telegram, and WhatsApp.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/license-MIT-22c55e?style=for-the-badge" alt="MIT" />
  <img src="https://img.shields.io/badge/runtime-Bun-black?style=for-the-badge&logo=bun" alt="Bun" />
  <img src="https://img.shields.io/badge/language-TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/interface-Terminal%20%2B%20Chat-7c3aed?style=for-the-badge" alt="Interface" />
</p>

---

## What AURIX is

AURIX is not just another chat wrapper.

It is a **tool-using AI workspace** built for people who want an AI that can actually do work:

- read and modify real files
- run commands in a real environment
- research topics with citations
- automate browser and system tasks
- generate outputs like reports, PDFs, spreadsheets, and presentations
- stay accessible from both terminal and messaging apps

The core idea is simple: **give the model tools, memory, workflows, and an interface that fits how technical users actually work.**

## Why this repo is interesting

- **Execution, not just conversation** — AURIX can act on your workspace
- **Terminal-native** — built for repo work, shell workflows, and power users
- **Research built in** — useful for technical, academic, and market research
- **Multi-platform access** — same agent from terminal, Discord, Telegram, and WhatsApp
- **Extensible architecture** — tools, skills, providers, and workflows can grow with the project

## What you can do with AURIX

### Coding and repo work
- inspect repositories
- edit and refactor files
- run commands
- help with implementation and debugging
- support real code workflows instead of only suggesting snippets

### Deep research
- gather multi-source information
- summarize and structure findings
- produce cited output
- support long-form research tasks

### Automation
- shell automation
- browser automation
- file operations
- workflow chaining

### Documents and deliverables
- generate PDFs
- generate spreadsheets and presentations
- create structured written outputs

### Chat gateway access
- use the same workspace from:
  - terminal
  - Discord
  - Telegram
  - WhatsApp

## Quick start

### Install

```bash
git clone https://github.com/DekaPrayoga/AurixAgent.git
cd AurixAgent
bun install
bun run build
```

### Run

```bash
./bin/aurix
```

### Setup

```bash
aurix setup
```

## Example commands

```bash
aurix
aurix setup
aurix gateway
aurix sessions
aurix --resume <session-id>
```

Inside AURIX:

```text
/deep-research open-source terminal ai agents
/research-forums what developers think about digitalocean alternatives
/pdf generate a report from this markdown
```

## Why people may star this project

AURIX combines several things that are usually split across separate tools:

- terminal AI assistant
- repo-aware execution
- document generation
- multi-agent research
- chat platform integration
- extensible tool surface

That combination makes it more than a single-purpose CLI. It is closer to an **AI operating workspace** for technical users.

## Project structure

```text
src/
  tools/       Tool implementations
  agent/       Core agent loop, context, memory
  cli/         Terminal UI
  gateway/     Discord / Telegram / WhatsApp integration
  providers/   LLM providers
  skills/      Skill registry
skills/        Installed skills and scripts
dist/          Compiled output
```

## Best fit users

AURIX is best suited for:

- developers
- researchers
- operators
- technical power users
- people who want an AI that can use tools instead of only chatting

## Repository metadata to use on GitHub

### Description
Open-source terminal AI agent for coding, deep research, automation, and multi-platform task execution.

### Topics
ai, agent, terminal, cli, typescript, bun, llm, automation, research, developer-tools, productivity, browser-automation, multi-agent, openai, anthropic, discord-bot, telegram-bot, whatsapp-bot

## What would make this repo even stronger

If you want this repo to attract significantly more attention, the next high-impact additions are:

- a GIF demo near the top of the README
- screenshots of the terminal UI
- one killer use-case walkthrough
- a short architecture diagram
- launch posts on Reddit, X, and Hacker News

## Contributing

Helpful contributions include:

- docs improvements
- screenshots and demos
- tool additions
- gateway improvements
- UI polish
- workflow examples

## License

MIT
