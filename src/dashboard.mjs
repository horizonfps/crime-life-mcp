#!/usr/bin/env node
// Real-time CLI dashboard for Crime.Life bot
// Run: npm run dashboard
import 'dotenv/config';
import { readFileSync, existsSync, appendFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const DB_ROOT = join(process.cwd(), 'db');
const LOG_FILE = join(process.cwd(), 'bot.log');

// ===== ANSI HELPERS =====
const ESC = '\x1b';
const CLEAR = `${ESC}[2J${ESC}[H`;
const BOLD = `${ESC}[1m`;
const DIM = `${ESC}[2m`;
const RESET = `${ESC}[0m`;
const RED = `${ESC}[31m`;
const GREEN = `${ESC}[32m`;
const YELLOW = `${ESC}[33m`;
const BLUE = `${ESC}[34m`;
const MAGENTA = `${ESC}[35m`;
const CYAN = `${ESC}[36m`;
const WHITE = `${ESC}[37m`;
const BG_RED = `${ESC}[41m`;
const BG_GREEN = `${ESC}[42m`;
const BG_YELLOW = `${ESC}[43m`;
const BG_BLUE = `${ESC}[44m`;

function bar(current, max, width = 20, fillChar = '█', emptyChar = '░') {
  const pct = Math.min(1, Math.max(0, current / max));
  const filled = Math.round(pct * width);
  const empty = width - filled;
  const color = pct > 0.6 ? GREEN : pct > 0.3 ? YELLOW : RED;
  return `${color}${fillChar.repeat(filled)}${DIM}${emptyChar.repeat(empty)}${RESET}`;
}

function padRight(str, len) {
  return (str + '').slice(0, len).padEnd(len);
}

function padLeft(str, len) {
  return (str + '').slice(0, len).padStart(len);
}

function formatMoney(n) {
  if (n >= 1000000) return `$${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}K`;
  return `$${n}`;
}

// ===== LOG SYSTEM =====
export function logToFile(level, msg) {
  const ts = new Date().toISOString();
  const line = `[${ts}] [${level}] ${msg}\n`;
  appendFileSync(LOG_FILE, line);
}

export function getRecentLogs(n = 15) {
  if (!existsSync(LOG_FILE)) return [];
  const content = readFileSync(LOG_FILE, 'utf8');
  const lines = content.split('\n').filter(Boolean);
  return lines.slice(-n);
}

// ===== STATE TRACKING =====
let state = {
  running: false,
  player: null,
  weather: null,
  cycle: 0,
  startedAt: null,
  actions: [],         // { time, action, result, details }
  stats: {
    crimesCommitted: 0,
    crimesSuccess: 0,
    crimesFailed: 0,
    trainingSessions: 0,
    attacksWon: 0,
    attacksLost: 0,
    moneyEarned: 0,
    xpEarned: 0,
    respectEarned: 0,
    captchasSolved: 0,
    errors: 0,
    jailCount: 0,
    hospitalCount: 0,
  },
  sessionStartPlayer: null,
};

export function getState() { return state; }

export function updatePlayer(player) {
  if (!state.sessionStartPlayer && player) {
    state.sessionStartPlayer = { ...player };
  }
  state.player = player;
}

export function updateWeather(weather) {
  state.weather = weather;
}

export function setRunning(running) {
  state.running = running;
  if (running && !state.startedAt) state.startedAt = new Date();
}

export function incrementCycle() {
  state.cycle++;
}

export function logAction(action, result, details = '') {
  const entry = {
    time: new Date().toISOString().slice(11, 19),
    action,
    result,
    details,
  };
  state.actions.push(entry);
  if (state.actions.length > 50) state.actions.shift();

  // Log to file
  const icon = result === 'success' ? '✓' : result === 'error' ? '✗' : '→';
  logToFile(result === 'error' ? 'ERR' : 'ACT', `${icon} ${action} ${details}`);
}

export function trackCrime(success, moneyGained = 0, xpGained = 0, respectGained = 0, jailed = false) {
  state.stats.crimesCommitted++;
  if (success) {
    state.stats.crimesSuccess++;
    state.stats.moneyEarned += moneyGained;
    state.stats.xpEarned += xpGained;
    state.stats.respectEarned += respectGained;
  } else {
    state.stats.crimesFailed++;
  }
  if (jailed) state.stats.jailCount++;
}

export function trackTraining() { state.stats.trainingSessions++; }
export function trackAttack(won) { won ? state.stats.attacksWon++ : state.stats.attacksLost++; }
export function trackCaptcha() { state.stats.captchasSolved++; }
export function trackError() { state.stats.errors++; }
export function trackHospital() { state.stats.hospitalCount++; }

// ===== RENDER DASHBOARD =====
export function render() {
  const p = state.player;
  const w = state.weather;
  const s = state.stats;
  const sp = state.sessionStartPlayer;

  let out = CLEAR;

  // Header
  out += `${BG_BLUE}${WHITE}${BOLD} ⚡ CRIME.LIFE AUTONOMOUS BOT ⚡ ${RESET}\n`;
  out += `${DIM}─────────────────────────────────────────────────────────────${RESET}\n`;

  // Status line
  const statusIcon = state.running ? `${GREEN}● RUNNING${RESET}` : `${RED}● STOPPED${RESET}`;
  const uptime = state.startedAt ? formatUptime(new Date() - state.startedAt) : '--:--:--';
  out += ` Status: ${statusIcon}  │  Cycle: ${CYAN}${state.cycle}${RESET}  │  Uptime: ${uptime}\n`;
  out += `${DIM}─────────────────────────────────────────────────────────────${RESET}\n`;

  if (p) {
    // Player section
    out += `${BOLD} 👤 ${p.username}${RESET}  │  Level ${YELLOW}${p.level}${RESET}`;
    if (p.prison?.status) out += `  ${BG_RED}${WHITE} PRISON ${RESET}`;
    if (p.hospital?.status) out += `  ${BG_RED}${WHITE} HOSPITAL ${RESET}`;
    out += '\n';

    // XP bar
    const xpNeeded = getXpForLevel(p.level);
    const xpProgress = p.experience || 0;
    out += ` XP:     ${bar(xpProgress % xpNeeded, xpNeeded, 30)} ${padLeft(xpProgress % xpNeeded, 5)}/${xpNeeded}\n`;

    // Energy bar
    out += ` Energy: ${bar(p.energy, p.maxEnergy, 30)} ${padLeft(p.energy, 3)}/${p.maxEnergy}\n`;

    // Addiction bar
    const addPct = Math.round(p.addiction || 0);
    const addColor = addPct > 50 ? RED : addPct > 25 ? YELLOW : GREEN;
    out += ` Addict: ${bar(addPct, 100, 30)} ${addColor}${addPct}%${RESET}\n`;

    // Money & Respect
    out += `\n ${GREEN}💰 ${formatMoney(p.money)}${RESET}`;
    out += `  │  ${MAGENTA}⭐ ${p.respect} respect${RESET}`;
    out += `  │  ${CYAN}💎 ${p.cash || 0} gems${RESET}\n`;

    // Stats
    out += ` Stats: `;
    const statNames = { strength: '💪', intelligence: '🧠', resistence: '🛡️', intimidation: '😈', imunity: '🔬' };
    for (const [k, v] of Object.entries(p.stats || {})) {
      out += `${statNames[k] || k} ${v}  `;
    }
    out += '\n';

    // Equipped
    if (p.equipped) {
      out += ` Equip:  `;
      if (p.equipped.weapon) out += `⚔️ ${p.equipped.weapon}  `;
      if (p.equipped.armor) out += `🛡 ${p.equipped.armor}  `;
      if (p.equipped.equipment) out += `🎒 ${p.equipped.equipment}  `;
      if (!p.equipped.weapon && !p.equipped.armor && !p.equipped.equipment) out += `(none)`;
      out += '\n';
    }
  } else {
    out += ` ${DIM}Waiting for player data...${RESET}\n`;
  }

  out += `${DIM}─────────────────────────────────────────────────────────────${RESET}\n`;

  // Weather
  if (w) {
    const weatherIcon = { rain: '🌧️', cloudy: '☁️', clear: '☀️', storm: '⛈️', fog: '🌫️' }[w.weather?.type] || '🌤️';
    const periodIcon = { morning: '🌅', afternoon: '☀️', evening: '🌆', night: '🌙' }[w.period] || '🕐';
    out += ` ${weatherIcon} ${w.weather?.type} ${w.weather?.temperatureC}°C  │  ${periodIcon} ${w.period}`;
    if (w.period === 'morning') out += ` ${YELLOW}(+20% training)${RESET}`;
    if (w.weather?.type === 'rain') out += ` ${CYAN}(+5% crime)${RESET}`;
    out += '\n';
  }

  out += `${DIM}─────────────────────────────────────────────────────────────${RESET}\n`;

  // Session stats
  out += `${BOLD} 📊 SESSION STATS${RESET}\n`;
  const crimeRate = s.crimesCommitted > 0 ? Math.round(s.crimesSuccess / s.crimesCommitted * 100) : 0;
  out += ` Crimes: ${GREEN}${s.crimesSuccess}✓${RESET} / ${RED}${s.crimesFailed}✗${RESET} (${crimeRate}%)`;
  out += `  │  Train: ${CYAN}${s.trainingSessions}${RESET}`;
  out += `  │  PvP: ${GREEN}${s.attacksWon}W${RESET}/${RED}${s.attacksLost}L${RESET}\n`;
  out += ` Earned: ${GREEN}+${formatMoney(s.moneyEarned)}${RESET}  +${CYAN}${s.xpEarned}XP${RESET}  +${MAGENTA}${s.respectEarned}R${RESET}`;
  out += `  │  Captchas: ${s.captchasSolved}\n`;

  if (s.jailCount > 0 || s.hospitalCount > 0 || s.errors > 0) {
    out += ` ${RED}Jail: ${s.jailCount}  Hospital: ${s.hospitalCount}  Errors: ${s.errors}${RESET}\n`;
  }

  // Session gains (comparison with start)
  if (sp && p) {
    const dMoney = (p.money || 0) - (sp.money || 0);
    const dResp = (p.respect || 0) - (sp.respect || 0);
    const dLevel = (p.level || 0) - (sp.level || 0);
    out += ` Gains:  ${dMoney >= 0 ? GREEN + '+' : RED}${formatMoney(dMoney)}${RESET}`;
    out += `  ${dResp >= 0 ? GREEN + '+' : RED}${dResp}R${RESET}`;
    if (dLevel > 0) out += `  ${YELLOW}+${dLevel} levels!${RESET}`;
    out += '\n';
  }

  out += `${DIM}─────────────────────────────────────────────────────────────${RESET}\n`;

  // Recent actions
  out += `${BOLD} 📋 RECENT ACTIONS${RESET}\n`;
  const recent = state.actions.slice(-12);
  for (const a of recent) {
    const icon = a.result === 'success' ? `${GREEN}✓${RESET}` : a.result === 'error' ? `${RED}✗${RESET}` : `${YELLOW}→${RESET}`;
    const actionColor = {
      commit_crime: GREEN, train: CYAN, attack: RED, wait: DIM,
      buy_drug: MAGENTA, heal: YELLOW, send_chat: BLUE,
    }[a.action] || WHITE;
    out += ` ${DIM}${a.time}${RESET} ${icon} ${actionColor}${padRight(a.action, 14)}${RESET} ${a.details.slice(0, 40)}\n`;
  }
  if (recent.length === 0) {
    out += ` ${DIM}No actions yet...${RESET}\n`;
  }

  out += `${DIM}─────────────────────────────────────────────────────────────${RESET}\n`;
  out += ` ${DIM}Press Ctrl+C to stop  │  Log: bot.log${RESET}\n`;

  process.stdout.write(out);
}

function formatUptime(ms) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

function getXpForLevel(level) {
  // Approximate XP curve
  return Math.round(100 * Math.pow(1.5, level - 1));
}

// If running standalone, show dashboard with mock data
if (process.argv[1]?.includes('dashboard')) {
  console.log('Dashboard module loaded. Use with bot-loop for real-time monitoring.');
}
