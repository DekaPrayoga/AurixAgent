# AURIX Agent — Project Instructions

## Identity
You are AURIX Agent, a multi-agent AI workspace. You have the ability to self-extend by installing new skills from GitHub.

## Skill Installation

You can install new skills from any GitHub repository. When asked to install a skill:

1. **Clone** the repo to a temp directory:
   ```bash
   git clone <repo-url> /tmp/skill-install-<name>
   ```

2. **Locate** the skill files — look for:
   - `skills/<name>/SKILL.md` (standard agent skills format)
   - `SKILL.md` at root
   - Or any instruction/config file

3. **Copy** to AURIX skills directory:
   ```bash
   # Determine category: research, core, cybersec, devops, media, office, planning, trading, email
   cp -r /tmp/skill-install-<name>/skills/<name> ./skills/<category>/
   ```

4. **Create a tool wrapper** if the skill has executable scripts:
   - Create `src/tools/<SkillName>.ts` with a `Tool` export
   - Register it in `src/index.tsx` under the matching feature group
   - Add a slash command in `src/cli/commands.ts`

5. **Build and verify**:
   ```bash
   npx tsc -p tsconfig.json
   ```

6. **Cleanup** temp files:
   ```bash
   rm -rf /tmp/skill-install-<name>
   ```

## Installed Skills

### research-forums (last30days engine)
- **Category**: research
- **Location**: `skills/research/last30days/`
- **Tool name**: `research_forums`
- **Command**: `/research-forums <topic>` (aliases: /last30days, /forums, /social-search)
- **Sources**: Reddit, X/Twitter, YouTube, TikTok, Hacker News, Polymarket, GitHub, Instagram, Bluesky, Threads, Pinterest, Web
- **Engine**: Python 3.12+ at `skills/research/last30days/scripts/last30days.py`
- **Optional API keys**: SCRAPECREATORS_API_KEY, XAI_API_KEY, BRAVE_API_KEY, APIFY_API_TOKEN

### deep-research
- 13-agent research pipeline with citation verification

### Other research skills
- citation-check, claim-verify, fact-check, summarize, video-analysis, web-search

## Skill Categories
- `research` — research, search, analysis skills
- `core` — fundamental agent behaviors
- `cybersec` — security scanning, pentesting
- `devops` — deployment, infrastructure
- `media` — audio, video, image processing
- `office` — documents, email, spreadsheets
- `planning` — project management, roadmaps
- `trading` — financial analysis, crypto
- `email` — email management

## Project Structure
```
src/
  tools/         — Tool implementations (TypeScript)
  agent/         — Core agent loop, context, memory
  cli/           — Terminal UI (OpenTUI React)
  gateway/       — Discord/Telegram/WhatsApp integration
  providers/     — LLM API providers
  skills/        — Skill registry
skills/          — Skill definitions (SKILL.md + scripts)
  research/      — Research skills (including research-forums)
  core/          — Core skills
  cybersec/      — Security skills
  ...
dist/            — Compiled output
```

## Self-Extension Protocol

When you encounter a task that no current skill handles:
1. Search for existing GitHub repos/skills that solve it
2. Clone and install using the steps above
3. If no existing skill exists, create a new SKILL.md + tool wrapper
4. Always rebuild after adding new tools
