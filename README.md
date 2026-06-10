<div align="center">

```
 █████╗ ██╗   ██╗██████╗ ██╗██╗  ██╗
██╔══██╗██║   ██║██╔══██╗██║╚██╗██╔╝
███████║██║   ██║██████╔╝██║ ╚███╔╝
██╔══██║██║   ██║██╔══██╗██║ ██╔██╗
██║  ██║╚██████╔╝██║  ██║██║██╔╝ ██╗
╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═╝╚═╝╚═╝  ╚═╝
```

### A G E N T I C &nbsp; A I &nbsp; :: &nbsp; T E R M I N A L &nbsp; A U T O N O M Y &nbsp; W O R K S P A C E

**Your terminal is now an AI-powered command center.** Code, research, write, deploy, automate — across terminal, Discord, Telegram, and WhatsApp.

[![License](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-ESM-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Bun](https://img.shields.io/badge/Runtime-Bun-000000?style=for-the-badge&logo=bun&logoColor=white)](https://bun.sh/)

</div>

---

## What is AURIX?

**AURIX Agent** is a fully autonomous AI workspace that runs entirely from your terminal. Unlike traditional AI assistants that only answer questions, AURIX executes — it writes code, runs shell commands, edits files, manages git repos, browses the web, generates documents, and orchestrates complex multi-step workflows. At its core is a team of 13 specialized AI agents that collaborate on research, code generation, document writing, and analysis, delivering results that no single-model chatbot can match.

AURIX extends beyond the terminal through its gateway system — connecting to **Discord**, **Telegram**, and **WhatsApp** so you can interact with the same AI workspace from any messaging platform. Whether you're debugging code from your phone, running deep research from a Telegram group, or deploying infrastructure from Discord, AURIX operates with full tool access and zero permission friction. It supports 35+ integrated tools, 6 research depth levels (from quick answers to publication-grade multi-agent papers), and works with any OpenAI or Anthropic-compatible API — including local models via Ollama.

### Why AURIX?

| | Traditional AI Chat | AURIX Agent |
|---|---|---|
| **Scope** | Single-turn Q&A | Multi-step autonomous execution |
| **Tools** | Text only | 35+ integrated tools |
| **Agents** | 1 model | 13 specialized agents |
| **Platforms** | Web browser | Terminal + Discord + Telegram + WhatsApp |
| **Research** | Generic answers | Multi-source, cited, peer-reviewed |
| **Memory** | Session-only | Persistent per-session memory |
| **Code** | Suggestions | Full read/write/execute pipeline |

---

## Capabilities

| Category | What AURIX Can Do |
|----------|-------------------|
| **Coding** | Write, debug, refactor code in any language. Shell execution, file editing, git operations, code review |
| **Research** | Multi-source research with verified citations. 6 depth levels from quick answers to publication-grade papers |
| **Documents** | Generate PDF, PowerPoint (PPTX), Excel (XLSX), Word docs, reports, invoices, resumes |
| **Multi-Agent** | 13-agent research team: Analyst, Planner, Researcher, Writer, Judge, Critic, Debate system |
| **Academic** | Write papers, theses, literature reviews with proper citations from ArXiv, Wikipedia, DuckDuckGo |
| **Browser** | Full browser automation — scrape, fill forms, take screenshots, extract data |
| **Security** | Port scanning, vulnerability assessment, SSL checks, DNS, WHOIS, penetration testing |
| **Trading** | Stock/crypto analysis with real-time market data |
| **DevOps** | VPS management, Docker, Nginx, SSL certificates, deployment pipelines |
| **Planning** | Sprint planning, roadmaps, feature decomposition, project management |
| **Office** | Email sending/reading, PDF generation, spreadsheet operations |
| **Vision** | Image analysis — describe, OCR, analyze any image |
| **Music** | YouTube music scraping, playlist management, audio detection |
| **Gateway** | Discord, Telegram, WhatsApp integration — AI assistant everywhere |

---

## Quick Start

### Install & Setup

```bash
curl -fsSL https://api.haikz.me/install.sh | bash
aurix setup
```

That's it. The installer clones AURIX to `~/.aurix/agent`, builds it, and adds the `aurix` command to your PATH. Configuration, sessions, and research data are stored in `~/.aurix/`.

### Manual Install

```bash
git clone https://github.com/DekaPrayoga/AurixAgent.git
cd AurixAgent
bun install
bun run build
aurix setup
```

### Run

```bash
aurix              # Start interactive session
aurix setup        # Configure provider & API key
aurix gateway      # Start Discord/Telegram/WhatsApp bots
aurix sessions     # List saved sessions
aurix --resume ID  # Resume a previous session
aurix --help       # Show all CLI options
```

### First Steps

1. Run `aurix setup` to configure your AI provider and API key
2. Type anything — AURIX just works. No ceremony needed
3. Use `/help` to discover 70+ slash commands
4. Try `/research <topic>` for deep multi-agent research
5. Use `/depth ultra` for publication-grade output

---

## Multi-Platform Support

AURIX meets you wherever you are:

### Terminal (TUI)

Full-featured terminal UI with dark theme, gray box message panels, autocomplete slash commands, paste support, and persistent session management. Built on OpenTUI (React for terminal).

**Key features:**
- Bracketed paste mode with image detection
- 70+ slash commands with fuzzy autocomplete
- Permission prompt system (allow once / always / deny)
- Real-time tool execution display
- Session save/resume with UUID-based IDs
- Multiple themes (aurix, amber, violet, mono, opencode)

### Discord

- `/start` — show all commands
- `/` — slash command autocomplete
- Mention the bot + your question
- DM support
- File attachments and image analysis

### Telegram

- `/start` — show all commands
- Inline command menu registered automatically
- Document/file handling
- Group chat support

### WhatsApp

- **`!ai`** prefix (e.g., `!ai write a python script`)
- `!ai start` — show all commands
- `!ai help` — quick help
- `!ai <question>` — ask anything

---

## Research Depth System

AURIX features a **6-level research depth system** that scales from quick single-agent answers to publication-grade multi-agent research with peer review.

| Mode | Agents | Pipeline | Use Case |
|------|--------|----------|----------|
| `low` | 1 | Direct response | Quick questions, simple tasks |
| `medium` | 1 | Research + sources | Factual queries with citations |
| `high` | 5+ | Full team + citations | Academic research, reports |
| `xhigh` | 7+ | + Debate system | Contested topics, deep analysis |
| `max` | 9+ | + Logic Critic | Technical papers, complex problems |
| `ultra` | 13 | + Final Review Loop | Publication-grade research |

### The 13-Agent Research Pipeline

```
User Prompt
    |
    v
[Request Analyzer] --> Classifies intent, selects depth
    |
    v
[Planning Agent] --> Decomposes into sub-tasks
    |
    v
[Research Agent] --> Multi-source data gathering
    |
    v
[Analyst Agent] --> Data synthesis and pattern extraction
    |
    v
[Writer Agent] --> Draft composition with citations
    |
    v
[Supporter Agent] <--> [Skeptic Agent]  (Debate System)
    |
    v
[Judge Agent] --> Evaluates argument quality
    |
    v
[Logic Critic] --> Formal logic verification
    |
    v
[Final Reviewer] --> Publication-grade quality check
    |
    v
[Citation Guardian] --> Verifies all references exist
    |
    v
[Video Agent] --> Finds supporting video resources
    |
    v
Final Output (cited, verified, peer-reviewed)
```

### Citation Integrity

All scientific/academic research enforces **source verification**:
- Every claim must be backed by a verified source (ArXiv, Wikipedia, DuckDuckGo)
- **No source = claim flagged as invalid** and removed
- The Citation Guardian cross-checks all references before output
- Proper bibliography/references section always included

---

## Research Documentation: Case Study

Below is a real example of AURIX's research output — an academic paper on **Chemicals in Harvest Products and Garden Plants**, demonstrating the depth and quality of AURIX's research capabilities.

### Chemicals in Harvest Products: Benefits, Risks, and Food Quality Implications

Harvest products, garden plants, and fruits are essential components of the food and nutrition system. These agricultural products contain not only water, carbohydrates, vitamins, and minerals, but also various other chemical compounds that can be beneficial or pose risks depending on their nature and concentration.

![Fresh fruits and vegetables](docs/assets/buah-sayur.jpg)
*Fresh harvest produce as a source of natural phytochemical compounds.*

#### Natural Chemical Compounds in Plants

Plants produce diverse **primary metabolites** (carbohydrates, proteins, fats, amino acids) essential for growth, and **secondary metabolites** (alkaloids, flavonoids, tannins, saponins, terpenoids, phenolics) that serve as natural defense mechanisms against insects, microbes, and environmental stress.

Key natural compounds found in fruits and vegetables:

| Compound | Found In | Health Benefit |
|----------|----------|---------------|
| Vitamin C | Citrus, strawberry, guava | Immune support, antioxidant |
| Anthocyanin | Berries, grapes | Anti-inflammatory, antioxidant |
| Lycopene | Tomatoes, watermelon | Cancer prevention, heart health |
| Polyphenols | Apples, grapes, tea | Antioxidant, anti-aging |
| Carotenoids | Carrots, sweet potato | Vision, immune function |

According to Liu (2010), fruits and vegetables contain bioactive components that support prevention of degenerative diseases through antioxidant activity and other physiological effects.

#### Agricultural Chemicals: Pesticides and Fertilizers

Modern agriculture relies on chemical inputs that can leave residues on harvest products:

![Pesticide application](docs/assets/penyemprotan.jpg)
*Agricultural spraying — a common source of chemical residue on harvest products.*

**Pesticides** (insecticides, fungicides, herbicides) boost productivity but leave residues that may pose health risks. Damalas and Eleftherohorinos (2011) note that while pesticides have significant agronomic benefits, uncontrolled exposure can impact human health and the environment.

**Nitrogen fertilizers** can cause nitrate accumulation in leafy vegetables (spinach, lettuce). The European Food Safety Authority (2008) considers nitrate in vegetables a concern requiring monitoring, especially for vulnerable populations.

**Heavy metals** (lead, cadmium, arsenic, mercury) can contaminate produce through polluted soil, industrial waste, or poor-quality irrigation water. Sharma, Agrawal, and Marshall (2007) demonstrated that vegetables grown in contaminated environments can accumulate concerning levels of heavy metals.

#### Food Safety and Control

International standards from the **Codex Alimentarius** (FAO/WHO) provide maximum residue limits for food safety. Key control measures include:

- **Good Agricultural Practices** — proper pesticide use, crop rotation, balanced fertilization
- **Environmental monitoring** — soil and irrigation water quality testing
- **Post-harvest standards** — safe use of coatings, preservatives, ripening agents
- **Laboratory analysis** — regular testing of residue levels, nitrate content, heavy metals, antioxidant content

#### References

1. Damalas, C. A., & Eleftherohorinos, I. G. (2011). Pesticide Exposure, Safety Issues, and Risk Assessment Indicators. *International Journal of Environmental Research and Public Health*, 8(5), 1402-1419.
2. European Food Safety Authority. (2008). Nitrate in vegetables: Scientific Opinion. *EFSA Journal*, 689, 1-79.
3. FAO/WHO Codex Alimentarius. (2024). International Food Standards.
4. Liu, R. H. (2010). Health-Promoting Components of Fruits and Vegetables in the Diet. *Advances in Nutrition*, 1(1), 13-22.
5. Sharma, R. K., Agrawal, M., & Marshall, F. M. (2007). Heavy metal contamination of soil and vegetables. *Ecotoxicology and Environmental Safety*, 66(2), 258-266.
6. Slavin, J. L., & Lloyd, B. (2012). Health Benefits of Fruits and Vegetables. *Advances in Nutrition*, 3(4), 506-516.
7. World Health Organization. (2020). Pesticide residues in food.

> This case study was generated by AURIX's `ultra` research depth mode, demonstrating multi-source synthesis, citation verification, and academic-grade output quality.

---

## Full Command Reference

### Session Commands

| Command | Description |
|---------|-------------|
| `/help` | Show commands, keybindings, and capabilities |
| `/clear` | Clear transcript and reset screen |
| `/new` / `/reset` | Start fresh session |
| `/exit` | Exit AURIX |
| `/status` | Show model, provider, mode, permissions, uptime |
| `/history` | Show message count for current context |
| `/context` | Show context usage and compaction stats |
| `/cost` | Show session token usage and estimated cost |
| `/save` | Save session transcript to file |
| `/export` | Export session to markdown |
| `/title <name>` | Rename current session |
| `/sessions` | Browse past saved sessions |
| `/resume [id]` | Resume archived conversation |
| `/branch [name]` | Create divergent conversation branch |
| `/copy [N]` | Copy last N assistant messages to clipboard |
| `/image <path>` | Attach image file to conversation |
| `/paste` | Attach clipboard image |
| `/retry` | Resend last user message |
| `/undo` | Delete last user+assistant interaction |
| `/rollback [N]` | Rollback N interactions |
| `/rewind` | Revert to last checkpoint |
| `/recap` | Summarize conversation progress |
| `/btw <question>` | Quick side question without context |
| `/stash` | Stash current input for later |
| `/tag` | Tag the current session |
| `/whoami` | Show your access level |
| `/redraw` | Force full UI repaint |
| `/restart` | Gracefully restart after draining |
| `/usage` | Show token usage and rate limits |
| `/doctor` | Run health checks on Node, provider, tools, memory |
| `/update` | Update AURIX to latest version |

### Model Commands

| Command | Description |
|---------|-------------|
| `/login` | Open login dialog for API key, base URL, model |
| `/model <id>` | Switch model for this session |
| `/depth <level>` | Set research depth (low/medium/high/xhigh/max/ultra) |
| `/effort <level>` | Alias for depth |
| `/fast` | Quick switch to low effort mode |
| `/deep` | Toggle deep research mode |
| `/reasoning <level>` | Adjust reasoning depth (low/medium/high) |
| `/variant` | Select model variant |

### Agent Commands

| Command | Description |
|---------|-------------|
| `/multiagent` | Toggle LangGraph multi-agent routing |
| `/goal <condition>` | Auto-continue until condition is met |
| `/fork <directive>` | Spawn background sub-agent |
| `/steer <guidance>` | Inject guidance after next tool call |
| `/queue <text>` | Schedule next input after current task |
| `/background <prompt>` | Run prompt in background |
| `/agents` | Show active agents and running tasks |
| `/subgoal [text]` | Add extra criteria to active goal |
| `/handoff <platform>` | Hand off session to messaging platform |

### Workflow Commands

| Command | Description |
|---------|-------------|
| `/review` | AI review of current repository |
| `/plan` | Produce implementation plan first |
| `/diff` | Inspect current git diff |
| `/code-review [level]` | Review git diff for issues |
| `/security-review` | Scan for security vulnerabilities |
| `/simplify [target]` | Suggest simplifications and refactoring |
| `/verify` | Run type checks, tests, build validation |
| `/insights` | Analyze coding patterns and architecture |
| `/kanban` | Multi-profile collaboration board |

### Tool Commands

| Command | Description |
|---------|-------------|
| `/tools` | List loaded tools |
| `/toolsets` | List available toolsets |
| `/permissions` | Inspect or clear tool permission rules |
| `/yolo` | Auto-approve all tool calls |
| `/approve` | Approve a pending dangerous command |
| `/deny` | Deny a pending dangerous command |
| `/cron` | Manage scheduled tasks |
| `/browser` | Connect browser tools via CDP |

### Skill Commands

| Command | Description |
|---------|-------------|
| `/skills [search]` | List loaded skills and categories |
| `/skill new <name>` | Create local skill scaffold |
| `/bundles` | List skill bundles |
| `/curator` | Background skill maintenance |
| `/reload-skills` | Re-scan skills directory |

### Config Commands

| Command | Description |
|---------|-------------|
| `/setup` | Re-run interactive setup wizard |
| `/config` | Show config path and settings |
| `/theme` / `/color` | Show/change theme |
| `/skin [name]` | Show or change display skin |
| `/snapshot [name]` | Save or restore config snapshot |
| `/verbose` | Toggle verbose tool output |
| `/focus` | Toggle minimalist UI mode |
| `/add-dir <path>` | Grant file access to directory |
| `/profile` | Show active profile and home dir |
| `/personality [name]` | Set personality overlay |
| `/statusbar` | Toggle status bar |
| `/footer` | Toggle gateway metadata footer |
| `/indicator` | Pick busy-indicator style |
| `/voice` | Toggle voice mode |
| `/busy` | Control Enter behavior while working |
| `/reload` | Reload .env variables |
| `/warp <workspace>` | Set active workspace |
| `/move` | Move session to different workspace |
| `/codex-runtime` | Toggle codex runtime for OpenAI |

### Connection Commands

| Command | Description |
|---------|-------------|
| `/github` / `/gh` | GitHub connection status |
| `/gmail` / `/email` | Gmail connection status |
| `/mcp` | MCP/plugin bridge status |
| `/platforms` / `/gateway` | Gateway platform status |
| `/platform <action>` | Pause/resume gateway platforms |
| `/reload-mcp` | Reload MCP servers |

### Plugin Commands

| Command | Description |
|---------|-------------|
| `/plugin` | Manage extensions |
| `/plugins` | List installed plugins |

---

## Gateway Commands (Discord/Telegram/WhatsApp)

| Command | Discord/Telegram | WhatsApp |
|---------|-----------------|----------|
| Show commands | `/start` | `!ai start` |
| Quick help | `/help` | `!ai help` |
| Clear context | `/reset` | `!ai reset` |
| Switch model | `/model <name>` | `!ai model <name>` |
| Set base URL | `/baseurl <url>` | `!ai baseurl <url>` |
| Set API key | `/apikey <key>` | `!ai apikey <key>` |
| Research depth | `/depth <level>` | `!ai depth <level>` |
| Fast mode | `/fast` | `!ai fast` |
| Code review | `/review` | `!ai review` |
| Planning | `/plan` | `!ai plan` |
| Deep research | `/research <topic>` | `!ai research <topic>` |
| List tools | `/tools` | `!ai tools` |
| List skills | `/skills` | `!ai skills` |
| Status | `/status` | `!ai status` |
| Save session | `/save` | `!ai save` |
| Ask anything | `@bot <question>` | `!ai <question>` |

Gateway mode operates **without permission prompts** — all tool calls are auto-approved for seamless headless operation. Messages include a `sent from <platform>` tag so the AI can adapt its response format.

---

## Configuration

Config stored at `~/.aurix/config.yaml`:

```yaml
provider: openai          # anthropic | openai | custom
apiKey: sk-...
baseUrl: https://api.openai.com/v1
model: gpt-4o
apiStyle: auto            # auto | openai | anthropic
researchMode: high        # low | medium | high | xhigh | max | ultra
maxTokens: 4096
temperature: 0.7

langsmith:
  apiKey: lsv2_...
  project: aurix-agent

gateway:
  discord:
    enabled: true
    token: YOUR_DISCORD_TOKEN
  telegram:
    enabled: true
    token: YOUR_TELEGRAM_TOKEN
  whatsapp:
    enabled: true

features:
  - trading
  - cybersec
  - vps
  - research
  - office
  - planning
  - frontend
  - backend
  - deploy
  - cloud
  - osint
  - creative
  - maps
  - notifier
```

### Environment Variables

```bash
AURIX_PROVIDER=openai
AURIX_API_KEY=sk-...
AURIX_BASE_URL=https://api.openai.com/v1
AURIX_MODEL=gpt-4o

# Optional
TAVILY_API_KEY=tvly-...        # Enhanced web search
LANGCHAIN_API_KEY=lsv2_...     # Tracing/observability
DISCORD_TOKEN=...              # Discord bot token
TELEGRAM_TOKEN=...             # Telegram bot token
```

---

## Supported Providers

| Provider | Endpoint | Models |
|----------|----------|--------|
| OpenAI | `/v1/chat/completions` | GPT-4o, o1, o3, etc. |
| Anthropic | `/v1/messages` | Claude 4, 3.5 Sonnet, etc. |
| Ollama | `/v1/chat/completions` | Local LLMs |
| LM Studio | `/v1/chat/completions` | Local LLMs |
| vLLM | `/v1/chat/completions` | High-throughput inference |
| FreeModel | `/v1/chat/completions` | Free API access |
| Any OpenAI-compatible | Auto-detected | Most third-party APIs |
| Any Anthropic-compatible | Auto-detected | |

---

## Tools (35+)

| Tool | Description |
|------|-------------|
| `terminal` | Shell command execution |
| `read_file` | Read files with line ranges |
| `write_file` | Write/create files |
| `search_files` | Ripgrep-powered content search |
| `file_edit` | Surgical file editing |
| `mcp_manage` | MCP server management |
| `github_*` | PR, issues, repos (gh CLI) |
| `system_info` | CPU, RAM, disk, network |
| `browser` | Browser automation (CDP) |
| `code_exec` | Run Python/Node/Bash |
| `web_search` | DuckDuckGo + Tavily |
| `todo` | Persistent task list |
| `vision` | Image analysis and OCR |
| `music` | yt-dlp + mpv audio |
| `memory` | Persistent facts with tags |
| `pdf` | PDF generation |
| `email` | Send/read email |
| `cybersec` | Security scanning |
| `research` | Multi-source research |
| `trading` | Stock/crypto analysis |
| `vps` | VPS management |
| `planning` | Project planning |
| `frontend_*` | React, Vue, Angular, Svelte |
| `backend_*` | Express, FastAPI, Django |
| `deploy_*` | Docker, CI/CD, cloud |
| `cloud_*` | AWS, GCP, Azure |
| `blockchain_*` | Smart contracts, DeFi |
| `excel` | Excel/XLSX generation |
| `pptx` | PowerPoint generation |
| `osint` | Open-source intelligence |
| `scraper` | Web scraping |
| `docker` | Container management |
| `youtube` | Video analysis |
| `diagram` | Diagram generation |
| `humanizer` | AI text humanization |
| `maps` | Geographic data |
| `notifier` | Notification system |
| `gif_search` | GIF search and embed |

---

## Architecture

```
src/
├── index.tsx              # Entry point
├── gateway-entry.ts       # Gateway mode entry
├── agent/
│   ├── AgentLoop.ts       # Core agent execution loop
│   ├── Config.ts          # Configuration management
│   ├── Context.ts         # System prompt builder
│   ├── ContextManager.ts  # Context window management
│   ├── MemoryEngine.ts    # Session persistence
│   ├── MultiAgent.ts      # LangGraph multi-agent routing
│   ├── ResearchPipeline.ts # Research orchestration
│   ├── Setup.ts           # Interactive setup wizard
│   └── research/          # 13 specialized research agents
│       ├── RequestAnalyzer.ts
│       ├── PlanningAgent.ts
│       ├── ResearchAgent.ts
│       ├── AnalystAgent.ts
│       ├── WriterAgent.ts
│       ├── SupporterAgent.ts
│       ├── SkepticAgent.ts
│       ├── JudgeAgent.ts
│       ├── LogicCritic.ts
│       ├── FinalReviewer.ts
│       ├── CitationGuardian.ts
│       ├── VideoAgent.ts
│       └── DebateSystem.ts
├── cli/
│   ├── App.tsx            # Main TUI application
│   ├── ChatArea.tsx       # Message rendering
│   ├── InputBox.tsx       # Input with paste support
│   ├── Banner.tsx         # ASCII art banner
│   ├── StatusBar.tsx      # Bottom status bar
│   ├── PermissionPrompt.tsx # Tool permission dialog
│   ├── LoginModal.tsx     # API credential entry
│   ├── SessionPanel.tsx   # Session management
│   ├── commands.ts        # 70+ slash commands
│   └── theme.ts           # Dark theme system
├── tools/                 # 35+ integrated tools
├── providers/             # LLM API providers
├── gateway/               # Discord/Telegram/WhatsApp
├── skills/                # Skill registry system
│   ├── core/
│   ├── cybersec/
│   ├── devops/
│   ├── email/
│   ├── media/
│   ├── office/
│   ├── planning/
│   ├── research/
│   └── trading/
├── trading/               # Trading subsystem
└── utils/                 # Shared utilities
```

---

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Language | TypeScript (ESM) |
| Runtime | Bun (recommended) / Node.js 22+ |
| TUI Framework | OpenTUI (React for terminal) |
| LLM SDKs | openai + @anthropic-ai/sdk |
| Multi-Agent | @langchain/langgraph |
| Observability | LangSmith |
| Database | better-sqlite3 |
| Discord | discord.js |
| Telegram | Bot API (long polling) |
| WhatsApp | @whiskeysockets/baileys |
| Config | js-yaml |
| Testing | bun test |

---

## Requirements

- **Bun** (recommended) or **Node.js** 22+
- **npm** or **yarn**
- **ripgrep** — `apt install ripgrep` (for code search)
- **yt-dlp** — `pip install yt-dlp` (for music/video)
- **ffmpeg** — `apt install ffmpeg` (for audio processing)

### Optional
- **discord.js** — Discord bot support
- **@whiskeysockets/baileys** + **pino** — WhatsApp support

---

## Themes

AURIX ships with 5 built-in themes:

| Theme | Primary | Accent | Description |
|-------|---------|--------|-------------|
| `aurix` | `#fab283` peach | `#9d7cd8` purple | Default warm dark theme |
| `opencode` | `#fab283` peach | `#9d7cd8` purple | OpenCode-inspired |
| `amber` | `#FFB020` gold | `#7fd88f` green | Classic terminal feel |
| `violet` | `#9d7cd8` purple | `#fab283` peach | Cool purple tones |
| `mono` | `#eeeeee` white | `#808080` gray | Minimal monochrome |

Change with `/theme <name>` or `/skin <name>`.

---

## Session Management

AURIX features robust session persistence:

- **UUID-based IDs** — proper v4 UUIDs (e.g., `a1b2c3d4-e5f6-7890-abcd-ef1234567890`)
- **JSON format** — full message content preserved, including tool calls and results
- **Per-session memory** — each session has its own `.memory.json` companion file
- **Auto-save** — sessions saved automatically on exit
- **Resume** — `aurix --resume <id>` or `/resume <id>` to continue
- **Pruning** — old tool results pruned to save context, messages preserved

---

## License

MIT

---

<div align="center">

**AURIX** — Terminal Autonomy Workspace

*Built with precision. Designed for autonomy.*

</div>
