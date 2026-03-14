# Crime.Life MCP Bot

Bot para o jogo [Crime.Life](https://crime.life) que roda como servidor MCP (Model Context Protocol). O **Claude Code e o cerebro** — ele joga, toma decisoes, salva aprendizados e evolui a estrategia ao longo do tempo.

## Como funciona

```
┌──────────────────────────────────────────────────────┐
│  Claude Code CLI (O CEREBRO)                         │
│  - Le o game state via get_game_state                │
│  - Decide e executa acoes (commit_crime, train, etc) │
│  - Salva aprendizados (save_memory)                  │
│  - Evolui a estrategia (get_strategy/update_strategy)│
└──────────────────┬───────────────────────────────────┘
                   │ stdio (MCP)
┌──────────────────▼───────────────────────────────────┐
│  server.mjs  (MCP Server - 35+ tools)                │
├──────────┬──────────┬───────────┬────────────────────┤
│ game-api │ captcha  │ brain.mjs │ memory.mjs         │
│ HTTP API │ Nopecha  │ Strategy  │ Persistencia       │
│ REST     │ hCaptcha │ + Shop DB │ em /db/*.md        │
└──────────┴──────────┴───────────┴────────────────────┘
```

**Sem LLM externa.** O Claude Code usa as MCP tools diretamente pra jogar. A estrategia vive em `db/strategies/master-strategy.md` — o Claude Code le, segue, e evolui conforme aprende.

**Auto-geração:** Na primeira vez que o bot roda, ele escaneia o jogo (player stats, crimes disponiveis, quests, clima, equipamentos) e gera uma estrategia completa do zero. Nao precisa configurar nada.

### Fluxo de jogo

1. Voce fala "joga" pro Claude Code
2. Ele chama `get_game_state` pra ver o estado atual
3. Se nao existir estrategia, escaneia o jogo e gera uma automaticamente
4. Le a estrategia com `get_strategy`
5. Decide a melhor acao e executa (commit_crime, train, buy_drug, etc)
6. Salva aprendizados em `db/` via `save_memory`
7. Quando espera energia, revisa e atualiza a estrategia
8. Repete

### Arquivos

| Arquivo | O que faz |
|---|---|
| `src/server.mjs` | Servidor MCP com 35+ tools |
| `src/game-api.mjs` | Client HTTP pra API do Crime.Life |
| `src/captcha-solver.mjs` | Resolve hCaptcha via Nopecha API |
| `src/brain.mjs` | Strategy I/O + shop data + fallback basico |
| `src/memory.mjs` | Sistema de memoria persistente em .md |
| `src/bot-loop.mjs` | Loop autonomo legado (fallback sem Claude Code) |
| `src/dashboard.mjs` | Dashboard CLI |
| `db/strategies/` | Estrategia do bot (evolui com o tempo) |
| `db/learning/` | Aprendizados acumulados |

## Instalacao

### Pre-requisitos

- [Node.js](https://nodejs.org/) v18+
- [Claude Code CLI](https://claude.com/claude-code)
- Conta no [Crime.Life](https://crime.life)
- API key do [Nopecha](https://nopecha.com/) (resolver captchas)

### Setup

1. Clone o repositorio:
```bash
git clone <url-do-repo>
cd crime-life-mcp
```

2. Instale as dependencias:
```bash
npm install
```

3. Copie os arquivos de exemplo e preencha com seus dados:
```bash
cp .env.example .env
cp .mcp.json.example .mcp.json
```

4. Edite o `.env` com sua chave do Nopecha:
```env
GAME_API_URL=https://api.crime.life
NOPECHA_API_KEY=sua-chave-nopecha
```

5. Edite o `.mcp.json` com as credenciais da sua conta:
```json
{
  "mcpServers": {
    "crime-life-bot": {
      "command": "node",
      "args": ["src/server.mjs"],
      "cwd": ".",
      "env": {
        "ACCOUNT_EMAIL": "seu-email@exemplo.com",
        "ACCOUNT_PASSWORD": "sua-senha"
      }
    }
  }
}
```

### Rodando

```bash
cd crime-life-mcp
claude
# Dentro do Claude Code:
# "joga pra mim" — Claude Code comeca a jogar
# "ve o status" — mostra stats atuais
# "evolui a estrategia" — revisa e melhora as regras
```

## Multi-conta

Cada conta e uma instancia separada do MCP server. Adicione no `.mcp.json`:

```json
{
  "mcpServers": {
    "crime-life-bot": {
      "command": "node",
      "args": ["src/server.mjs"],
      "cwd": ".",
      "env": {
        "ACCOUNT_EMAIL": "conta1@exemplo.com",
        "ACCOUNT_PASSWORD": "senha1"
      }
    },
    "crime-life-bot-2": {
      "command": "node",
      "args": ["src/server.mjs"],
      "cwd": ".",
      "env": {
        "ACCOUNT_EMAIL": "conta2@exemplo.com",
        "ACCOUNT_PASSWORD": "senha2"
      }
    }
  }
}
```

Reinicie o Claude Code pra carregar os servers. As tools ficam duplicadas — uma por conta.

## Tools MCP

### Estrategia (o cerebro)
| Tool | Descricao |
|---|---|
| `get_strategy` | Le a estrategia atual (auto-gera se nao existir) |
| `update_strategy` | Reescreve a estrategia |
| `scan_game` | Escaneia o jogo e regenera a estrategia do zero |

### Jogo
| Tool | Descricao |
|---|---|
| `login` | Login manual |
| `get_game_state` | Estado completo do jogo |
| `get_weather` | Hora e clima |
| `get_crimes` / `commit_crime` | Crimes |
| `train` | Treinar stat |
| `attack_player` / `get_targets` / `check_attack` | PvP |
| `join_club` / `buy_drug` | Nightclub e drogas |
| `heal` / `instant_release` | Hospital e prisao |
| `buy_item` / `equip_item` | Shop e equipamento |
| `bank_status` / `bank_deposit` / `bank_withdraw` | Banco |
| `collect_factory` | Fabricas |
| `gang_info` / `gang_crimes` / `gang_signup` | Gang |
| `get_chat` / `send_chat` | Chat |
| `get_daily_quests` / `complete_quest` | Quests diarias |
| `junkyard_recipes` / `junkyard_inventory` / `craft_item` | Junkyard |
| `solve_captcha` | Captcha manual |
| `search_player` | Busca jogadores |
| `raw_api` | Request direto |

### Memoria
| Tool | Descricao |
|---|---|
| `save_memory` / `read_memory` | Salva/le memorias |
| `list_memories` / `search_memories` | Lista/busca |
| `memory_summary` | Resumo geral |

### Legado (bot autonomo)
| Tool | Descricao |
|---|---|
| `start_bot` / `stop_bot` / `bot_status` | Bot autonomo com fallback basico (sem Claude Code) |

## Licenca

ISC
