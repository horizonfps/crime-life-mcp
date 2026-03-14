// Autonomous bot loop - The main game-playing engine
// Shows real-time dashboard when run directly, silent when used as MCP
import 'dotenv/config';
import * as api from './game-api.mjs';
import * as brain from './brain.mjs';
import * as mem from './memory.mjs';
import { solveHCaptchaToken } from './captcha-solver.mjs';
import * as dash from './dashboard.mjs';

const EMAIL = process.env.ACCOUNT_EMAIL;
const PASSWORD = process.env.ACCOUNT_PASSWORD;

let running = false;
let gameState = {};
let sessionPlan = null;
let actionLog = [];
let errorCount = 0;
let captchaToken = null;
const MAX_ERRORS = 10;

// Whether to render the dashboard (true when run directly, false when imported by MCP)
let showDashboard = false;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function log(msg) {
  const ts = new Date().toISOString().slice(11, 19);
  const line = `[${ts}] ${msg}`;
  actionLog.push(line);
  if (actionLog.length > 200) actionLog.shift();
  dash.logToFile('BOT', msg);
}

// Ensure captcha is validated
async function ensureCaptcha() {
  try {
    const status = await api.getCaptchaStatus();
    const data = status?.data || status;
    if (data?.validated && data?.expiresIn > 10) return captchaToken;

    dash.logAction('solve_captcha', 'pending', 'Solving hCaptcha via Nopecha...');
    const sitekey = (data?.difficulty || 0) > 0 ? api.HCAPTCHA_SITEKEY_HARD : api.HCAPTCHA_SITEKEY;
    captchaToken = await solveHCaptchaToken(sitekey, 'https://crime.life');
    await api.validateCaptcha(captchaToken);
    dash.trackCaptcha();
    dash.logAction('solve_captcha', 'success', `Token: ${captchaToken.length} chars`);
    return captchaToken;
  } catch (err) {
    dash.logAction('solve_captcha', 'error', err.message.slice(0, 50));
    return null;
  }
}

// Login
async function initialize() {
  dash.logAction('login', 'pending', `Logging in as ${EMAIL}...`);
  const result = await api.login(EMAIL, PASSWORD);
  const player = result?.data || result;
  dash.logAction('login', 'success', `${player?.username} (Level ${player?.level})`);
  dash.updatePlayer(player);
  dash.setRunning(true);
}

// Refresh game state from API
async function refreshGameState() {
  const [player, crimes, weather, events, quests, gangInfo, leaderboard, onlinePlayers] =
    await Promise.allSettled([
      api.getPlayer(), api.getCrimes(), api.getTimeWeather(), api.getEventsToday(),
      api.getDailyQuests(), api.getGangInfo(), api.getLeaderboard(), api.getOnlinePlayers(),
    ]);

  const extract = (r) => r.status === 'fulfilled' ? (r.value?.data || r.value) : null;

  gameState = {
    player: extract(player),
    crimes: extract(crimes),
    weather: extract(weather),
    events: extract(events),
    dailyQuests: extract(quests),
    gangInfo: extract(gangInfo),
    leaderboard: extract(leaderboard),
    onlinePlayers: extract(onlinePlayers),
    timestamp: new Date().toISOString(),
  };

  dash.updatePlayer(gameState.player);
  dash.updateWeather(gameState.weather);

  return gameState;
}

// Execute a single action
async function executeAction(decision) {
  const { action, params = {} } = decision;

  try {
    let result, details = '';
    switch (action) {
      case 'commit_crime': {
        const ct = await ensureCaptcha();
        result = await api.commitCrime(params.crimeId || params.crimeid, ct);
        const d = result?.data || result;
        if (d?.success) {
          details = `${params.crimeId}: +$${d.moneyGained} +${d.expGained}XP +${d.respectGained}R`;
          dash.trackCrime(true, d.moneyGained, d.expGained, d.respectGained, false);
          dash.logAction(action, 'success', details);
          mem.appendMemory('learning', 'crime-results',
            `\n- [${new Date().toISOString()}] ${params.crimeId}: +$${d.moneyGained} +${d.expGained}XP +${d.respectGained}R`);
        } else if (d?.prison) {
          details = `JAILED while doing ${params.crimeId}`;
          dash.trackCrime(false, 0, 0, 0, true);
          dash.logAction(action, 'error', details);
        } else {
          details = `Failed: ${params.crimeId}`;
          dash.trackCrime(false);
          dash.logAction(action, 'error', details);
        }
        break;
      }

      case 'train': {
        const ct = await ensureCaptcha();
        result = await api.train(params.trainingId || params.stat, ct);
        const d = result?.data || result;
        const newStats = d?.stats;
        details = `${params.trainingId} → ${newStats ? JSON.stringify(newStats) : 'OK'}`;
        dash.trackTraining();
        dash.logAction(action, 'success', details.slice(0, 50));
        mem.appendMemory('learning', 'training-log',
          `\n- [${new Date().toISOString()}] ${params.trainingId}: ${JSON.stringify(newStats || {})}`);
        break;
      }

      case 'attack': {
        const targetId = params.targetId || params.target || params.targetid;
        result = await api.attackPlayer(targetId);
        const d = result?.data || result;
        const won = d?.won || d?.result === 'win' || d?.success;
        details = `${targetId}: ${won ? 'WON' : 'LOST'}`;
        dash.trackAttack(won);
        dash.logAction(action, won ? 'success' : 'error', details);
        const analysis = await brain.analyzeCombat(d, params);
        mem.saveMemory('combat-logs', `fight-${targetId}-${Date.now()}`,
          JSON.stringify({ result: d, analysis }, null, 2),
          { opponent: targetId, outcome: analysis.outcome });
        break;
      }

      case 'visit_club':
      case 'join_club': {
        const clubId = params.clubId || params.nightclubid || 'the-gutter';
        result = await api.joinClub(clubId);
        details = `Joined ${clubId}`;
        dash.logAction(action, 'success', details);
        break;
      }

      case 'buy_drug': {
        result = await api.buyClubDrug(
          params.clubId || 'the-gutter',
          params.drugId || 'espresso-shot'
        );
        details = `Bought ${params.drugId} at ${params.clubId}`;
        dash.logAction(action, 'success', details);
        break;
      }

      case 'heal': {
        result = await api.heal(params.treatmentId);
        details = 'Healed';
        dash.trackHospital();
        dash.logAction(action, 'success', details);
        break;
      }

      case 'send_chat': {
        const chatMsg = await brain.generateChatMessage({
          onlinePlayers: gameState.onlinePlayers,
          purpose: params.purpose || 'casual',
        });
        result = await api.sendChatMessage(chatMsg.message, params.channel || 'city-pt');
        details = `[${chatMsg.purpose}] ${chatMsg.message}`;
        dash.logAction(action, 'success', details.slice(0, 50));
        mem.appendMemory('chat-logs', 'outgoing-messages',
          `\n- [${new Date().toISOString()}] ${details}`);
        break;
      }

      case 'collect_factory': {
        result = await api.collectFactory(params.factoryId || params.factoryid);
        details = `Factory ${params.factoryId}`;
        dash.logAction(action, 'success', details);
        break;
      }

      case 'collect_hooker': {
        const hookerId = params.hookerId || params.hookerid;
        try {
          result = await api.collectHookerProfits(hookerId);
          const d = result?.data || result;
          details = `Collected from ${hookerId}: +$${d?.collected || d?.amount || '?'}`;
          dash.logAction(action, 'success', details);
          mem.appendMemory('economy', 'hooker-income',
            `\n- [${new Date().toISOString()}] Collected from ${hookerId}: ${JSON.stringify(d)}`);
        } catch (err) {
          details = `Hooker ${hookerId}: ${err.message.slice(0, 40)}`;
          dash.logAction(action, 'info', details);
          mem.appendMemory('learning', 'hooker-collection-errors',
            `\n- [${new Date().toISOString()}] ${details}`);
          result = { error: err.message };
        }
        break;
      }

      case 'daily_quest':
      case 'complete_quest': {
        const questId = params.questId || params.questid;
        try {
          result = await api.completeDailyQuest(questId);
          const d = result?.data || result;
          details = `Quest ${questId} claimed: +${d?.rewardReputation || '?'}R`;
          dash.logAction(action, 'success', details);
          mem.appendMemory('learning', 'quest-completions',
            `\n- [${new Date().toISOString()}] ${details}`);
        } catch (err) {
          details = `Quest ${questId}: ${err.message.slice(0, 40)}`;
          dash.logAction(action, 'info', details);
          result = { error: err.message };
        }
        break;
      }

      case 'upgrade_equipment': {
        const { shopId, itemId, slot, price, stats } = params;
        try {
          // Buy the item
          dash.logAction('buy_item', 'pending', `Buying ${itemId} from ${shopId} ($${price})...`);
          result = await api.buyItem(shopId, itemId);
          const buyData = result?.data || result;
          dash.logAction('buy_item', 'success', `Bought ${itemId} ($${price})`);

          // Equip it
          await sleep(1000);
          dash.logAction('equip_item', 'pending', `Equipping ${itemId} to ${slot}...`);
          const equipResult = await api.equipItem(itemId);
          dash.logAction('equip_item', 'success', `Equipped ${itemId} → ${slot}`);

          details = `Upgraded ${slot}: ${itemId} ($${price}, stats: ${JSON.stringify(stats)})`;
          mem.appendMemory('economy', 'equipment-upgrades',
            `\n- [${new Date().toISOString()}] ${details}`);
        } catch (err) {
          details = `Upgrade ${slot} failed: ${err.message.slice(0, 50)}`;
          dash.logAction('upgrade_equipment', 'error', details.slice(0, 50));
          mem.appendMemory('learning', 'equipment-errors',
            `\n- [${new Date().toISOString()}] Tried ${itemId} from ${shopId}: ${err.message}`);
          result = { error: err.message };
        }
        break;
      }

      case 'check_junkyard': {
        try {
          const [inventory, recipes] = await Promise.allSettled([
            api.getJunkyardInventory(),
            api.getJunkyardRecipes(),
          ]);
          const inv = (inventory.status === 'fulfilled' ? inventory.value?.data || inventory.value : null);
          const recs = (recipes.status === 'fulfilled' ? recipes.value?.data || recipes.value : null);

          const items = inv?.items || inv || [];
          const allRecipes = recs?.recipes || recs || [];

          // Find craftable recipes: check if we have enough ingredients
          const craftable = [];
          for (const recipe of allRecipes) {
            if (!recipe.ingredients) continue;
            const canCraft = recipe.ingredients.every(ing => {
              const owned = Array.isArray(items)
                ? items.find(i => i.id === ing.itemId || i.itemId === ing.itemId)
                : null;
              return owned && (owned.quantity || owned.amount || 0) >= ing.quantity;
            });
            if (canCraft && (recipe.craftCost || 0) <= (gameState.player?.money || 0)) {
              craftable.push(recipe);
            }
          }

          // Prioritize energy consumables
          const energyRecipe = craftable.find(r =>
            r.description?.toLowerCase().includes('energy') ||
            r.resultType === 'consumable'
          );

          if (energyRecipe) {
            dash.logAction('craft_item', 'pending', `Crafting ${energyRecipe.name}...`);
            result = await api.craftItem(energyRecipe.id);
            details = `Crafted ${energyRecipe.name} (${energyRecipe.description})`;
            dash.logAction('craft_item', 'success', details.slice(0, 50));
            mem.appendMemory('learning', 'crafting-log',
              `\n- [${new Date().toISOString()}] ${details}`);
          } else if (craftable.length > 0) {
            // Craft first available item
            const recipe = craftable[0];
            dash.logAction('craft_item', 'pending', `Crafting ${recipe.name}...`);
            result = await api.craftItem(recipe.id);
            details = `Crafted ${recipe.name} (${recipe.description})`;
            dash.logAction('craft_item', 'success', details.slice(0, 50));
            mem.appendMemory('learning', 'crafting-log',
              `\n- [${new Date().toISOString()}] ${details}`);
          } else {
            details = `Junkyard: ${Array.isArray(items) ? items.length : 0} junk items, nothing craftable yet`;
            dash.logAction('check_junkyard', 'info', details.slice(0, 50));
            mem.appendMemory('learning', 'junkyard-checks',
              `\n- [${new Date().toISOString()}] ${details}. Inventory: ${JSON.stringify((Array.isArray(items) ? items : []).map(i => `${i.name || i.id}x${i.quantity || i.amount || 1}`))}`);
          }
        } catch (err) {
          details = `Junkyard error: ${err.message.slice(0, 40)}`;
          dash.logAction('check_junkyard', 'info', details);
          result = { error: err.message };
        }
        break;
      }

      case 'add_targets': {
        const needed = params.needed || 2;
        try {
          // Get online players to find targets
          const onlinePlayers = gameState.onlinePlayers?.data || gameState.onlinePlayers;
          const leaderboard = gameState.leaderboard?.data || gameState.leaderboard;
          const myLevel = gameState.player?.level || 1;

          // Find suitable targets (near our level)
          let candidates = [];
          if (Array.isArray(leaderboard)) {
            candidates = leaderboard
              .filter(p => p.level && Math.abs(p.level - myLevel) <= 5 && p.id !== gameState.player?.id)
              .slice(0, needed);
          }

          let added = 0;
          for (const target of candidates) {
            try {
              await api.addTarget(target.id || target.playerId);
              added++;
              dash.logAction('add_target', 'success', `Added ${target.username || target.id} (Lv${target.level})`);
            } catch (err) {
              dash.logAction('add_target', 'info', `Target ${target.username}: ${err.message.slice(0, 30)}`);
            }
            if (added >= needed) break;
            await sleep(1000);
          }

          details = `Added ${added}/${needed} targets`;
          if (added === 0) dash.logAction('add_targets', 'info', 'No suitable targets found');
          mem.appendMemory('learning', 'target-additions',
            `\n- [${new Date().toISOString()}] ${details}`);
          result = { added };
        } catch (err) {
          details = `Add targets error: ${err.message.slice(0, 40)}`;
          dash.logAction('add_targets', 'info', details);
          result = { error: err.message };
        }
        break;
      }

      case 'explore_game': {
        try {
          // Gather intel from various game systems
          const discoveries = [];

          // Check events
          const events = gameState.events;
          if (events?.event) {
            discoveries.push(`Active event: ${events.event.type?.name} - ${events.event.type?.description}`);
          }

          // Check player state for opportunities
          const p = gameState.player;
          if (p?.factories?.length > 0) {
            for (const f of p.factories) {
              discoveries.push(`Factory: ${f.name || f.id} - collect available`);
            }
          }

          // Check hookers earning rate
          if (p?.hookers?.length > 0) {
            for (const h of p.hookers) {
              discoveries.push(`Hooker: ${h.name} earns $${h.hourlyRate}/h, uncollected: $${(h.uncollected_profits || 0).toFixed(0)}, death risk: ${h.deathRisk}%`);
            }
          }

          // Check quest status
          const quests = gameState.dailyQuests?.quests || [];
          const incomplete = quests.filter(q => !q.completed);
          if (incomplete.length > 0) {
            discoveries.push(`Incomplete quests: ${incomplete.map(q => `${q.name} (${q.progress}/${q.required})`).join(', ')}`);
          }

          // Check bank status
          if (!p?.bank?.balance && p?.bank?.balance !== 0) {
            discoveries.push('No bank account yet - could open one to protect money');
          } else if (p?.money > 5000 && p?.bank?.maintenanceActive) {
            discoveries.push(`Bank available: balance $${p.bank.balance}, could deposit excess cash`);
          }

          // Weather effects
          const weather = gameState.weather;
          if (weather) {
            discoveries.push(`Weather: ${weather.weather?.type} ${weather.weather?.temperatureC}°C, period: ${weather.period}`);
          }

          // Addiction level check
          if (p?.addiction > 70) {
            discoveries.push(`WARNING: Addiction at ${p.addiction.toFixed(0)}% - drug purchases may be limited`);
          }

          // Save intel
          const report = discoveries.join('\n- ');
          details = `Explored: ${discoveries.length} findings`;
          dash.logAction('explore_game', 'success', details);
          mem.saveMemory('learning', 'game-exploration',
            `# Game Exploration - ${new Date().toISOString()}\n\n- ${report}`,
            { playerLevel: p?.level, money: p?.money });

          result = { discoveries };
        } catch (err) {
          details = `Explore error: ${err.message.slice(0, 40)}`;
          dash.logAction('explore_game', 'info', details);
          result = { error: err.message };
        }
        break;
      }

      case 'deposit': {
        result = await api.deposit(params.amount);
        details = `Deposited $${params.amount}`;
        dash.logAction(action, 'success', details);
        break;
      }

      case 'wait': {
        const waitSec = params.seconds || 30;
        details = `${waitSec}s (${decision.reasoning})`;
        dash.logAction(action, 'info', details.slice(0, 50));
        await sleep(waitSec * 1000);
        result = { waited: true };
        break;
      }

      default: {
        details = `Unknown: ${action}`;
        dash.logAction(action, 'info', details);
        result = null;
      }
    }

    errorCount = 0;
    return result;
  } catch (err) {
    const details = `${action}: ${err.message.slice(0, 60)}`;
    dash.logAction(action, 'error', details);
    dash.trackError();
    errorCount++;
    log(`Error: ${details}`);
    mem.appendMemory('learning', 'errors',
      `\n- [${new Date().toISOString()}] ${details}`);
    return { error: err.message };
  }
}

// Monitor chat
async function monitorChat() {
  try {
    const messages = await api.getChatMessages('city-pt');
    const data = messages?.data?.messages || messages?.data || [];
    if (Array.isArray(data) && data.length > 0) {
      const chatSummary = data.slice(-20).map(m =>
        `[${m.username || m.sender}] ${m.message || m.text}`
      ).join('\n');
      mem.saveMemory('chat-logs', 'recent-global-chat', chatSummary);
    }
  } catch {}
}

// Track leaderboard
async function trackLeaderboard() {
  try {
    const lb = await api.getLeaderboard();
    const data = lb?.data || lb;
    if (data && Array.isArray(data)) {
      mem.saveMemory('strategies', 'leaderboard-snapshot',
        JSON.stringify(data.slice(0, 10), null, 2));
    }
  } catch {}
}

// Dashboard render loop (runs independently of bot loop)
let dashInterval = null;
function startDashboard() {
  if (!showDashboard) return;
  dashInterval = setInterval(() => dash.render(), 1000);
}

function stopDashboard() {
  if (dashInterval) { clearInterval(dashInterval); dashInterval = null; }
}

// ===== MAIN LOOP =====
export async function mainLoop() {
  dash.logToFile('SYS', '=== Crime.Life Bot Starting ===');

  await initialize();
  await refreshGameState();

  const player = gameState.player;
  log(`Player: ${player?.username} | Level ${player?.level} | $${player?.money} | ${player?.energy}/${player?.maxEnergy}E | ${player?.respect}R`);

  // Plan session
  sessionPlan = await brain.planSession(gameState);
  mem.saveMemory('strategies', 'current-session-plan', JSON.stringify(sessionPlan, null, 2));
  dash.logAction('plan_session', 'success', sessionPlan.goals?.slice(0, 2).join(', '));

  running = true;
  dash.setRunning(true);
  startDashboard();

  let cycleCount = 0;
  let chatCycle = 0;
  let leaderboardCycle = 0;

  while (running) {
    cycleCount++;
    dash.incrementCycle();

    if (errorCount >= MAX_ERRORS) {
      dash.logAction('system', 'error', `Too many errors (${errorCount}), pausing 5min`);
      await sleep(300000);
      errorCount = 0;
      try { await initialize(); } catch { log('Re-login failed'); }
    }

    try {
      await refreshGameState();
      const p = gameState.player;

      // Hospital
      if (p?.hospital?.status) {
        try {
          dash.logAction('heal', 'pending', 'In hospital, trying treatment...');
          const healResult = await api.heal();
          dash.logAction('heal', 'success', `Healed: ${JSON.stringify(healResult?.data || healResult).slice(0, 60)}`);
          dash.trackHospital();
        } catch (err) {
          // Treatment failed, try instant release
          try {
            dash.logAction('heal', 'pending', 'Treatment failed, trying instant release...');
            await api.instantRelease();
            dash.logAction('heal', 'success', 'Instant release used');
          } catch {
            dash.logAction('heal', 'info', `Waiting for release (${err.message.slice(0, 40)})`);
          }
        }
        await sleep(15000);
        continue;
      }

      // Prison
      if (p?.prison?.status) {
        dash.logAction('prison', 'pending', 'In prison, waiting...');
        await sleep(10000);
        continue;
      }

      // Brain decides
      const decision = await brain.decideNextAction(gameState);

      // If brain says buy_drug, join the club first
      if (decision._needsClubJoin) {
        const clubId = decision.params?.clubId || 'the-gutter';
        try {
          dash.logAction('join_club', 'pending', `Joining ${clubId} for drugs...`);
          await api.joinClub(clubId);
          dash.logAction('join_club', 'success', `Joined ${clubId}`);
        } catch (err) {
          dash.logAction('join_club', 'info', `Already in club or error: ${err.message.slice(0, 40)}`);
        }
        await sleep(1000);
      }

      await executeAction(decision);

      // Chat monitoring
      if (++chatCycle >= 5) { chatCycle = 0; await monitorChat(); }

      // Leaderboard tracking
      if (++leaderboardCycle >= 20) { leaderboardCycle = 0; await trackLeaderboard(); }

      // Session snapshots
      if (cycleCount % 10 === 0) {
        mem.saveSession({
          cycle: cycleCount,
          player: { level: p?.level, money: p?.money, respect: p?.respect, energy: p?.energy },
          stats: dash.getState().stats,
        });
      }

      // Auto-evolve strategy every 50 cycles
      if (cycleCount % 50 === 0 && cycleCount > 0) {
        try {
          dash.logAction('evolve_strategy', 'pending', 'Reviewing performance and evolving strategy...');
          const recentActions = dash.getState().actions.slice(-20).map(a => `${a.time} ${a.action}: ${a.details}`).join('\n');
          const evolved = await brain.evolveStrategy(recentActions, dash.getState().stats);
          dash.logAction('evolve_strategy', evolved ? 'success' : 'info', evolved ? 'Strategy evolved!' : 'No evolution needed');
        } catch (err) {
          dash.logAction('evolve_strategy', 'error', err.message.slice(0, 50));
        }
      }

      // Delay between actions
      const delay = getActionDelay(decision.action);
      await sleep(delay);

    } catch (err) {
      dash.logAction('loop_error', 'error', err.message.slice(0, 50));
      errorCount++;
      await sleep(10000);
    }
  }

  stopDashboard();
  dash.setRunning(false);
  dash.logToFile('SYS', '=== Bot Stopped ===');
}

function getActionDelay(action) {
  const base = {
    commit_crime: 3000, train: 3000, attack: 5000, visit_club: 4000,
    heal: 2000, send_chat: 8000, wait: 1000, collect_factory: 3000,
    daily_quest: 2000, complete_quest: 2000, buy_drug: 3000,
    collect_hooker: 2000, check_junkyard: 3000, craft_item: 3000,
    add_targets: 2000, explore_game: 2000, upgrade_equipment: 3000,
    buy_item: 2000, equip_item: 2000,
  };
  const baseDelay = base[action] || 4000;
  return baseDelay + Math.random() * baseDelay * 0.5;
}

// Exports for MCP server
export function stopBot() { running = false; }
export function isRunning() { return running; }
export function getActionLog() { return actionLog; }
export function getGameState() { return gameState; }
export function getSessionPlan() { return sessionPlan; }
export function getDashState() { return dash.getState(); }

// ===== CLI ENTRY POINT =====
if (process.argv[1]?.includes('bot-loop')) {
  showDashboard = true;

  // Handle Ctrl+C gracefully
  process.on('SIGINT', () => {
    running = false;
    stopDashboard();
    console.log('\n\nBot stopped by user. Check bot.log for full history.');
    process.exit(0);
  });

  mainLoop().catch(err => {
    stopDashboard();
    console.error('\nFatal error:', err.message);
    console.error('Check bot.log for details.');
    process.exit(1);
  });
}
