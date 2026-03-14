# Crime.Life MCP Bot

A bot for the [Crime.Life](https://crime.life) browser RPG that runs as an MCP server (Model Context Protocol). **Claude Code is the brain** — it plays the game, makes decisions, saves learnings, and evolves its strategy over time.

## How it works

```
┌──────────────────────────────────────────────────────┐
│  Claude Code CLI (THE BRAIN)                         │
│  - Reads game state via get_game_state               │
│  - Decides and executes actions (commit_crime, etc)  │
│  - Saves learnings (save_memory)                     │
│  - Evolves strategy (get_strategy / update_strategy) │
└──────────────────┬───────────────────────────────────┘
                   │ stdio (MCP)
┌──────────────────▼───────────────────────────────────┐
│  server.mjs  (MCP Server - 35+ tools)                │
├──────────┬──────────┬───────────┬────────────────────┤
│ game-api │ captcha  │ brain.mjs │ memory.mjs         │
│ HTTP API │ Nopecha  │ Strategy  │ Persistent storage │
│ REST     │ hCaptcha │ + Shop DB │ in /db/*.md        │
└──────────┴──────────┴───────────┴────────────────────┘
```

**No external LLM required.** Claude Code uses the MCP tools directly to play. The strategy lives in `db/strategies/master-strategy.md` — Claude Code reads it, follows it, and evolves it as it learns.

**Auto-generation:** On first run, the bot scans the game (player stats, available crimes, quests, weather, equipment) and generates a complete strategy from scratch. No manual configuration needed.

### Game loop

1. You tell Claude Code "play the game"
2. It calls `get_game_state` to see the current state
3. If no strategy exists, it scans the game and auto-generates one
4. Reads the strategy with `get_strategy`
5. Decides the best action and executes it (commit_crime, train, buy_drug, etc)
6. Saves learnings to `db/` via `save_memory`
7. During energy downtime, reviews and updates the strategy
8. Repeats

### Files

| File | Purpose |
|---|---|
| `src/server.mjs` | MCP server with 35+ tools |
| `src/game-api.mjs` | HTTP client for the Crime.Life API |
| `src/captcha-solver.mjs` | Solves hCaptcha via Nopecha API |
| `src/brain.mjs` | Strategy I/O + shop data + basic fallback |
| `src/memory.mjs` | Persistent memory system using .md files |
| `src/bot-loop.mjs` | Legacy autonomous loop (fallback without Claude Code) |
| `src/dashboard.mjs` | CLI dashboard |
| `db/strategies/` | Bot strategy (evolves over time) |
| `db/learning/` | Accumulated learnings |

## Installation

### Prerequisites

- [Node.js](https://nodejs.org/) v18+
- [Claude Code CLI](https://claude.com/claude-code)
- [Crime.Life](https://crime.life) account
- [Nopecha](https://nopecha.com/) API key (for captcha solving)

### Setup

1. Clone the repository:
```bash
git clone https://github.com/horizonfps/crime-life-mcp.git
cd crime-life-mcp
```

2. Install dependencies:
```bash
npm install
```

3. Copy the example config files and fill in your data:
```bash
cp .env.example .env
cp .mcp.json.example .mcp.json
```

4. Edit `.env` with your Nopecha key:
```env
GAME_API_URL=https://api.crime.life
NOPECHA_API_KEY=your-nopecha-key
```

5. Edit `.mcp.json` with your account credentials:
```json
{
  "mcpServers": {
    "crime-life-bot": {
      "command": "node",
      "args": ["src/server.mjs"],
      "cwd": ".",
      "env": {
        "ACCOUNT_EMAIL": "your-email@example.com",
        "ACCOUNT_PASSWORD": "your-password"
      }
    }
  }
}
```

### Running

```bash
cd crime-life-mcp
claude
# Inside Claude Code:
# "play the game" — Claude Code starts playing
# "check my stats" — shows current status
# "evolve the strategy" — reviews and improves the rules
```

## Multi-account

Each account runs as a separate MCP server instance. Add to `.mcp.json`:

```json
{
  "mcpServers": {
    "crime-life-bot": {
      "command": "node",
      "args": ["src/server.mjs"],
      "cwd": ".",
      "env": {
        "ACCOUNT_EMAIL": "account1@example.com",
        "ACCOUNT_PASSWORD": "password1"
      }
    },
    "crime-life-bot-2": {
      "command": "node",
      "args": ["src/server.mjs"],
      "cwd": ".",
      "env": {
        "ACCOUNT_EMAIL": "account2@example.com",
        "ACCOUNT_PASSWORD": "password2"
      }
    }
  }
}
```

Restart Claude Code to load the new servers. Tools will be duplicated — one per account.

## MCP Tools

### Strategy (the brain)
| Tool | Description |
|---|---|
| `get_strategy` | Read current strategy (auto-generates if none exists) |
| `update_strategy` | Rewrite the strategy |
| `scan_game` | Scan the game and regenerate strategy from scratch |

### Game
| Tool | Description |
|---|---|
| `login` | Manual login |
| `get_game_state` | Full game state |
| `get_weather` | Time and weather |
| `get_crimes` / `commit_crime` | Crimes |
| `train` | Train a stat |
| `attack_player` / `get_targets` / `check_attack` | PvP |
| `join_club` / `buy_drug` | Nightclub and drugs |
| `heal` / `instant_release` | Hospital and prison |
| `buy_item` / `equip_item` | Shop and equipment |
| `bank_status` / `bank_deposit` / `bank_withdraw` | Bank |
| `collect_factory` | Factories |
| `gang_info` / `gang_crimes` / `gang_signup` | Gang |
| `get_chat` / `send_chat` | Chat |
| `get_daily_quests` / `complete_quest` | Daily quests |
| `junkyard_recipes` / `junkyard_inventory` / `craft_item` | Junkyard |
| `solve_captcha` | Manual captcha solve |
| `search_player` | Search players |
| `raw_api` | Raw API request |

### Memory
| Tool | Description |
|---|---|
| `save_memory` / `read_memory` | Save/read memories |
| `list_memories` / `search_memories` | List/search |
| `memory_summary` | Full summary |

### Legacy (autonomous bot)
| Tool | Description |
|---|---|
| `start_bot` / `stop_bot` / `bot_status` | Autonomous bot with basic fallback (no Claude Code) |

## License

ISC
