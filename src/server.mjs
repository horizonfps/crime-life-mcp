#!/usr/bin/env node
// Crime.Life MCP Server - Autonomous game bot with learning & memory
import 'dotenv/config';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import * as api from './game-api.mjs';
import * as mem from './memory.mjs';
import * as brain from './brain.mjs';
import { solveHCaptchaToken } from './captcha-solver.mjs';
import { mainLoop, stopBot as stopBotLoop, isRunning, getActionLog, getGameState, getSessionPlan, getDashState } from './bot-loop.mjs';

let botPromise = null;

function ok(data) {
  return { content: [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }] };
}

async function ensureLoggedIn() {
  if (!api.getToken()) {
    await api.login(process.env.ACCOUNT_EMAIL, process.env.ACCOUNT_PASSWORD);
  }
}

async function ensureCaptcha() {
  const status = await api.getCaptchaStatus();
  const data = status?.data || status;
  if (data?.validated) return null;
  const sitekey = (data?.difficulty || 0) > 0 ? api.HCAPTCHA_SITEKEY_HARD : api.HCAPTCHA_SITEKEY;
  const token = await solveHCaptchaToken(sitekey, 'https://crime.life');
  await api.validateCaptcha(token);
  return token;
}

// ======= MCP SERVER =======
const server = new McpServer({ name: 'crime-life-bot', version: '1.0.0' });

// ---- BOT CONTROL ----

server.tool('start_bot', 'Start the autonomous game bot that plays, learns, and aims for rank 1. Use bot_status to monitor progress.', {}, async () => {
  if (isRunning()) return ok('Bot is already running! Use bot_status to see progress.');
  botPromise = mainLoop().catch(e => console.error('Bot error:', e));

  // Wait a moment for initialization
  await new Promise(r => setTimeout(r, 3000));
  const state = getGameState();
  const player = state?.player;

  if (player) {
    return ok([
      '● BOT STARTED - Playing autonomously!',
      '',
      `👤 ${player.username} | Level ${player.level}`,
      `💰 $${player.money} | ⭐ ${player.respect} respect | ⚡ ${player.energy}/${player.maxEnergy} energy`,
      `📊 STR=${player.stats?.strength} INT=${player.stats?.intelligence} RES=${player.stats?.resistence}`,
      '',
      'The bot will now:',
      '• Commit crimes to earn money, XP, and respect',
      '• Train stats during morning hours (+20% bonus)',
      '• Auto-solve captchas via Nopecha',
      '• Learn from actions and save to /db/',
      '',
      'Use bot_status to see live progress, stats, and action log.',
      'Use stop_bot to stop.',
    ].join('\n'));
  }
  return ok('Bot started! Use bot_status to monitor.');
});

server.tool('stop_bot', 'Stop the autonomous game bot', {}, async () => {
  stopBotLoop();
  return ok('Bot stopped');
});

server.tool('bot_status', 'Get current bot status with full dashboard data: player stats, session gains, action history, and performance metrics', {}, async () => {
  const state = getGameState();
  const player = state?.player;
  const dashState = getDashState();
  const s = dashState.stats;
  const sp = dashState.sessionStartPlayer;

  const lines = [];
  lines.push(isRunning() ? '● BOT RUNNING' : '○ BOT STOPPED');
  lines.push(`Cycle: ${dashState.cycle} | Uptime: ${dashState.startedAt ? Math.round((Date.now() - new Date(dashState.startedAt).getTime()) / 60000) + 'min' : 'N/A'}`);
  lines.push('');

  if (player) {
    lines.push(`👤 ${player.username} | Level ${player.level}`);
    lines.push(`⚡ Energy: ${player.energy}/${player.maxEnergy}`);
    lines.push(`💰 Money: $${player.money} | ⭐ Respect: ${player.respect} | 💎 Gems: ${player.cash || 0}`);
    lines.push(`📊 Stats: STR=${player.stats?.strength} INT=${player.stats?.intelligence} RES=${player.stats?.resistence} INT=${player.stats?.intimidation} IMU=${player.stats?.imunity}`);
    lines.push(`🎒 Weapon: ${player.equipped?.weapon || 'none'} | Armor: ${player.equipped?.armor || 'none'}`);
    lines.push(`💉 Addiction: ${Math.round(player.addiction || 0)}%`);
    if (player.prison?.status) lines.push('🔒 IN PRISON');
    if (player.hospital?.status) lines.push('🏥 IN HOSPITAL');
    lines.push('');
  }

  // Session stats
  const crimeRate = s.crimesCommitted > 0 ? Math.round(s.crimesSuccess / s.crimesCommitted * 100) : 0;
  lines.push('── SESSION STATS ──');
  lines.push(`Crimes: ${s.crimesSuccess}✓ / ${s.crimesFailed}✗ (${crimeRate}% success)`);
  lines.push(`Training: ${s.trainingSessions} | PvP: ${s.attacksWon}W/${s.attacksLost}L`);
  lines.push(`Earned: +$${s.moneyEarned} +${s.xpEarned}XP +${s.respectEarned}R`);
  lines.push(`Captchas: ${s.captchasSolved} | Jail: ${s.jailCount} | Hospital: ${s.hospitalCount} | Errors: ${s.errors}`);

  if (sp && player) {
    lines.push('');
    lines.push('── SESSION GAINS ──');
    lines.push(`Money: ${(player.money - sp.money) >= 0 ? '+' : ''}$${player.money - sp.money}`);
    lines.push(`Respect: ${(player.respect - sp.respect) >= 0 ? '+' : ''}${player.respect - sp.respect}`);
    if (player.level > sp.level) lines.push(`Level: +${player.level - sp.level} levels!`);
  }

  lines.push('');
  lines.push('── RECENT ACTIONS ──');
  const recent = dashState.actions.slice(-10);
  for (const a of recent) {
    const icon = a.result === 'success' ? '✓' : a.result === 'error' ? '✗' : '→';
    lines.push(`${a.time} ${icon} ${a.action}: ${a.details.slice(0, 50)}`);
  }

  if (state?.weather) {
    lines.push('');
    lines.push(`🌤️ Weather: ${state.weather.weather?.type} ${state.weather.weather?.temperatureC}°C | Period: ${state.weather.period}`);
  }

  return ok(lines.join('\n'));
});

// ---- AUTH ----

server.tool('login', 'Login to Crime.Life', {}, async () => {
  const result = await api.login(process.env.ACCOUNT_EMAIL, process.env.ACCOUNT_PASSWORD);
  const p = result?.data || result;
  return ok(`Logged in as ${p?.username} (Level ${p?.level})`);
});

// ---- GAME STATE ----

server.tool('get_game_state', 'Get full current game state (player, crimes, weather, etc). Auto-generates strategy if none exists.', {}, async () => {
  await ensureLoggedIn();
  const [player, crimes, weather, events, quests, lb, online] = await Promise.allSettled([
    api.getPlayer(), api.getCrimes(), api.getTimeWeather(),
    api.getEventsToday(), api.getDailyQuests(), api.getLeaderboard(), api.getOnlinePlayers(),
  ]);
  const extract = (r) => r.status === 'fulfilled' ? (r.value?.data || r.value) : null;

  // Auto-generate strategy if none exists
  if (!brain.getStrategy()) {
    const crimeData = extract(crimes);
    brain.generateInitialStrategy({
      player: extract(player),
      crimes: crimeData?.crimes || crimeData || [],
      weather: extract(weather),
      events: extract(events),
      quests: extract(quests)?.quests || [],
    });
  }

  return ok({
    player: extract(player),
    crimes: extract(crimes)?.crimes?.map(c => ({ id: c.id, name: c.name, level: c.requiredLevel, energy: c.energyCost, money: `${c.minimumMoney}-${c.maximumMoney}`, xp: `${c.minimumExp}-${c.maximumExp}` })),
    weather: extract(weather), events: extract(events),
    dailyQuests: extract(quests), onlinePlayers: extract(online)?.count,
    leaderboard: extract(lb)?.slice?.(0, 10),
    strategyGenerated: !brain.getStrategy() ? false : true,
  });
});

server.tool('get_weather', 'Get current game time and weather', {}, async () => {
  await ensureLoggedIn();
  return ok((await api.getTimeWeather())?.data);
});

server.tool('get_leaderboard', 'Get top 100 leaderboard', {}, async () => {
  await ensureLoggedIn();
  return ok((await api.getLeaderboard())?.data);
});

server.tool('get_online_players', 'Get currently online players', {}, async () => {
  await ensureLoggedIn();
  return ok((await api.getOnlinePlayers())?.data);
});

// ---- CRIMES ----

server.tool('get_crimes', 'List all available crimes', {}, async () => {
  await ensureLoggedIn();
  return ok((await api.getCrimes())?.data);
});

server.tool('commit_crime', 'Commit a crime (auto-solves captcha)', {
  crimeId: z.string().describe('Crime identifier (e.g. steal-candy-from-a-child)'),
}, async ({ crimeId }) => {
  await ensureLoggedIn();
  const ct = await ensureCaptcha();
  const result = await api.commitCrime(crimeId, ct);
  return ok(result?.data);
});

// ---- TRAINING ----

server.tool('train', 'Train a stat at a gym (auto-solves captcha)', {
  trainingId: z.string().describe('Training ID from game config'),
}, async ({ trainingId }) => {
  await ensureLoggedIn();
  const ct = await ensureCaptcha();
  return ok((await api.train(trainingId, ct))?.data);
});

// ---- COMBAT ----

server.tool('check_attack', 'Check if you can attack a target', {
  targetId: z.string().describe('Target player ID'),
}, async ({ targetId }) => {
  await ensureLoggedIn();
  return ok((await api.checkAttack(targetId))?.data);
});

server.tool('attack_player', 'Attack another player in PvP', {
  targetId: z.string().describe('Target player ID'),
}, async ({ targetId }) => {
  await ensureLoggedIn();
  return ok((await api.attackPlayer(targetId))?.data);
});

server.tool('get_targets', 'Get available PvP targets', {}, async () => {
  await ensureLoggedIn();
  return ok((await api.getPlayerTargets())?.data);
});

// ---- NIGHTCLUBS ----

server.tool('join_club', 'Join a nightclub to restore energy', {
  clubId: z.string().describe('Club ID (the-gutter, ushuaia, skid-row, club-dopamine)'),
}, async ({ clubId }) => {
  await ensureLoggedIn();
  return ok((await api.joinClub(clubId))?.data);
});

server.tool('buy_drug', 'Buy a drug at a nightclub', {
  clubId: z.string().describe('Club ID'),
  drugId: z.string().describe('Drug ID (espresso-shot, tobacco-shot, fentanyl, ketamine, methamphetamine)'),
}, async ({ clubId, drugId }) => {
  await ensureLoggedIn();
  return ok((await api.buyClubDrug(clubId, drugId))?.data);
});

// ---- HOSPITAL & PRISON ----

server.tool('heal', 'Get treatment at the hospital', {
  treatmentId: z.string().optional().describe('Treatment ID'),
}, async ({ treatmentId }) => {
  await ensureLoggedIn();
  return ok((await api.heal(treatmentId))?.data);
});

server.tool('instant_release', 'Use consumable for instant release from hospital/prison', {}, async () => {
  await ensureLoggedIn();
  return ok((await api.instantRelease())?.data);
});

// ---- SHOP & EQUIPMENT ----

server.tool('buy_item', 'Buy an item from a shop', {
  shopId: z.string().describe('Shop identifier'),
  itemId: z.string().describe('Item identifier'),
}, async ({ shopId, itemId }) => {
  await ensureLoggedIn();
  return ok((await api.buyItem(shopId, itemId))?.data);
});

server.tool('equip_item', 'Equip an item', {
  itemId: z.string().describe('Item identifier'),
}, async ({ itemId }) => {
  await ensureLoggedIn();
  return ok((await api.equipItem(itemId))?.data);
});

// ---- BANK ----

server.tool('bank_status', 'Get bank account status', {}, async () => {
  await ensureLoggedIn();
  return ok((await api.getBankStatus())?.data);
});

server.tool('bank_deposit', 'Deposit money in the bank', {
  amount: z.number().describe('Amount to deposit'),
}, async ({ amount }) => {
  await ensureLoggedIn();
  return ok((await api.deposit(amount))?.data);
});

server.tool('bank_withdraw', 'Withdraw money from the bank', {
  amount: z.number().describe('Amount to withdraw'),
}, async ({ amount }) => {
  await ensureLoggedIn();
  return ok((await api.withdraw(amount))?.data);
});

// ---- FACTORIES ----

server.tool('collect_factory', 'Collect income from a factory', {
  factoryId: z.string().describe('Factory identifier'),
}, async ({ factoryId }) => {
  await ensureLoggedIn();
  return ok((await api.collectFactory(factoryId))?.data);
});

// ---- GANGS ----

server.tool('gang_info', 'Get gang information', {}, async () => {
  await ensureLoggedIn();
  return ok((await api.getGangInfo())?.data);
});

server.tool('gang_crimes', 'Get available gang crimes', {}, async () => {
  await ensureLoggedIn();
  return ok((await api.getGangCrimes())?.data);
});

server.tool('gang_signup', 'Sign up for a gang crime', {
  crimeId: z.string().describe('Gang crime ID'),
}, async ({ crimeId }) => {
  await ensureLoggedIn();
  return ok((await api.signupGangCrime(crimeId))?.data);
});

// ---- CHAT ----

server.tool('get_chat', 'Read recent chat messages', {
  channel: z.string().optional().describe('Channel (e.g. city-pt, city-en)'),
}, async ({ channel }) => {
  await ensureLoggedIn();
  return ok((await api.getChatMessages(channel || 'city-pt'))?.data);
});

server.tool('send_chat', 'Send a message in game chat', {
  message: z.string().describe('Message text'),
  channel: z.string().optional().describe('Channel (e.g. city-pt, city-en)'),
}, async ({ message, channel }) => {
  await ensureLoggedIn();
  return ok((await api.sendChatMessage(message, channel || 'city-pt'))?.data);
});

// ---- DAILY QUESTS ----

server.tool('get_daily_quests', 'Get today\'s daily quests', {}, async () => {
  await ensureLoggedIn();
  return ok((await api.getDailyQuests())?.data);
});

server.tool('complete_quest', 'Complete a daily quest', {
  questId: z.string().describe('Quest identifier'),
}, async ({ questId }) => {
  await ensureLoggedIn();
  return ok((await api.completeDailyQuest(questId))?.data);
});

// ---- JUNKYARD ----

server.tool('junkyard_recipes', 'Get available junkyard crafting recipes', {}, async () => {
  await ensureLoggedIn();
  return ok((await api.getJunkyardRecipes())?.data);
});

server.tool('junkyard_inventory', 'Get junkyard inventory', {}, async () => {
  await ensureLoggedIn();
  return ok((await api.getJunkyardInventory())?.data);
});

server.tool('craft_item', 'Craft an item at the junkyard', {
  recipeId: z.string().describe('Recipe identifier'),
}, async ({ recipeId }) => {
  await ensureLoggedIn();
  return ok((await api.craftItem(recipeId))?.data);
});

// ---- CAPTCHA ----

server.tool('solve_captcha', 'Solve hCaptcha for the game (Nopecha)', {}, async () => {
  await ensureLoggedIn();
  const token = await ensureCaptcha();
  return ok({ solved: true, tokenLength: token?.length });
});

// ---- AI BRAIN ----

server.tool('plan_session', 'Have the AI brain plan the next gaming session strategy', {}, async () => {
  await ensureLoggedIn();
  const [player, crimes, weather] = await Promise.all([api.getPlayer(), api.getCrimes(), api.getTimeWeather()]);
  const plan = await brain.planSession({ player: player?.data, crimes: crimes?.data, weather: weather?.data });
  return ok(plan);
});

server.tool('decide_action', 'Ask the AI brain what to do next', {}, async () => {
  await ensureLoggedIn();
  const [player, crimes, weather, events] = await Promise.all([
    api.getPlayer(), api.getCrimes(), api.getTimeWeather(), api.getEventsToday(),
  ]);
  const decision = await brain.decideNextAction({
    player: player?.data, crimes: crimes?.data, weather: weather?.data, events: events?.data,
  });
  return ok(decision);
});

server.tool('analyze_combat', 'Have AI analyze a combat result', {
  combatResult: z.string().describe('Combat result JSON'),
  enemyProfile: z.string().describe('Enemy profile JSON'),
}, async ({ combatResult, enemyProfile }) => {
  const analysis = await brain.analyzeCombat(JSON.parse(combatResult), JSON.parse(enemyProfile));
  return ok(analysis);
});

server.tool('search_player', 'Search for a player by name', {
  query: z.string().describe('Player name to search'),
}, async ({ query }) => {
  await ensureLoggedIn();
  return ok((await api.searchPlayers(query))?.data);
});

// ---- STRATEGY (Claude Code evolves these) ----

async function scanAndCreateStrategy() {
  await ensureLoggedIn();
  const [player, crimes, weather, events, quests] = await Promise.allSettled([
    api.getPlayer(), api.getCrimes(), api.getTimeWeather(),
    api.getEventsToday(), api.getDailyQuests(),
  ]);
  const extract = (r) => r.status === 'fulfilled' ? (r.value?.data || r.value) : null;
  const crimeData = extract(crimes);
  return brain.generateInitialStrategy({
    player: extract(player),
    crimes: crimeData?.crimes || crimeData || [],
    weather: extract(weather),
    events: extract(events),
    quests: extract(quests)?.quests || [],
  });
}

server.tool('get_strategy', 'Read the current bot strategy. If no strategy exists, scans the game and auto-generates one.', {}, async () => {
  let strategy = brain.getStrategy();
  if (!strategy) {
    await scanAndCreateStrategy();
    strategy = brain.getStrategy();
    return ok('No strategy found — scanned the game and created one from scratch!\n\n' + strategy);
  }
  return ok(strategy);
});

server.tool('update_strategy', 'Update the bot strategy. The bot reads this every cycle to decide actions. Write rules, priorities, thresholds.', {
  strategy: z.string().describe('Full strategy content in markdown'),
}, async ({ strategy }) => {
  brain.updateStrategy(strategy);
  return ok('Strategy updated! The bot will use the new rules starting next cycle.');
});

server.tool('evolve_strategy', 'Force the bot to review its recent performance and auto-evolve the strategy using AI', {}, async () => {
  const dashState = getDashState();
  const recent = dashState.actions.slice(-20).map(a => `${a.time} ${a.action}: ${a.details}`).join('\n');
  const evolved = await brain.evolveStrategy(recent, dashState.stats);
  if (evolved) {
    return ok('Strategy evolved! Check with get_strategy to see the changes.');
  }
  return ok('Could not evolve strategy (LLM unavailable or not enough data).');
});

server.tool('scan_game', 'Scan the full game state and regenerate the strategy from scratch based on current player data', {}, async () => {
  const strategy = await scanAndCreateStrategy();
  return ok('Game scanned and strategy regenerated!\n\n' + strategy);
});

// ---- RAW API ----

server.tool('raw_api', 'Make a raw API request to any endpoint', {
  method: z.enum(['GET', 'POST', 'PUT', 'DELETE']),
  path: z.string().describe('API path (e.g. /player/auth)'),
  body: z.string().optional().describe('JSON body string'),
}, async ({ method, path, body }) => {
  await ensureLoggedIn();
  return ok(await api.rawRequest(method, path, body ? JSON.parse(body) : undefined));
});

// ---- MEMORY ----

server.tool('save_memory', 'Save a memory/learning to the bot database', {
  category: z.enum(['strategies', 'combat-logs', 'player-profiles', 'economy', 'chat-logs', 'learning', 'sessions']),
  title: z.string(), content: z.string(),
}, async ({ category, title, content }) => {
  return ok({ saved: mem.saveMemory(category, title, content) });
});

server.tool('read_memory', 'Read a specific memory', {
  category: z.string(), title: z.string(),
}, async ({ category, title }) => {
  return ok(mem.readMemory(category, title) || 'Memory not found');
});

server.tool('list_memories', 'List all memories in a category', {
  category: z.string(),
}, async ({ category }) => ok(mem.listMemories(category)));

server.tool('search_memories', 'Search across all bot memories', {
  query: z.string(),
}, async ({ query }) => ok(mem.searchMemories(query)));

server.tool('memory_summary', 'Get summary of all stored memories', {}, async () => ok(mem.getMemorySummary()));

// ---- RESOURCES ----

server.resource('game-state', 'crime-life://game-state', async (uri) => ({
  contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(getGameState(), null, 2) }],
}));

server.resource('bot-log', 'crime-life://bot-log', async (uri) => ({
  contents: [{ uri: uri.href, mimeType: 'text/plain', text: getActionLog().join('\n') }],
}));

server.resource('memory-index', 'crime-life://memory-index', async (uri) => ({
  contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(mem.getMemorySummary(), null, 2) }],
}));

// ---- START ----
const transport = new StdioServerTransport();
await server.connect(transport);
