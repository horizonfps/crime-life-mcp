// Crime.Life API client - handles all HTTP communication with the game server
// Endpoints reverse-engineered from game JS bundles
import 'dotenv/config';

const API_BASE = process.env.GAME_API_URL || 'https://api.crime.life';
let authToken = null;  // Login token (from /player/login)
let sessionToken = null; // Session token (from /player/auth) - used for game actions
let cookies = null;

export function getToken() { return sessionToken || authToken; }
export function getCookies() { return cookies; }

async function request(method, path, body = null, extraHeaders = {}) {
  const url = `${API_BASE}${path}`;
  const token = sessionToken || authToken;
  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    ...extraHeaders,
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (cookies) headers['Cookie'] = cookies;

  const opts = { method, headers };
  if (body && method !== 'GET') opts.body = JSON.stringify(body);

  const res = await fetch(url, opts);
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) cookies = setCookie;

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`API ${method} ${path} failed (${res.status}): ${text}`);
  }
  if (!text) return null;
  return JSON.parse(text);
}

// Helper: get the session token string (for embedding in request bodies)
function tok() { return sessionToken || authToken; }

// ====== AUTH ======

export async function login(email, password) {
  const data = await request('POST', '/player/login', { email, password });
  authToken = data?.token || data?.data?.token || null;

  // Chain auth to get session token (required for game actions like crimes, training)
  if (authToken) {
    const authData = await request('POST', '/player/auth');
    sessionToken = authData?.data?.token || authData?.token || null;
    return authData; // Return full player data
  }
  return data;
}

export async function auth() {
  const data = await request('POST', '/player/auth');
  sessionToken = data?.data?.token || data?.token || null;
  return data;
}

// ====== PLAYER ======

export async function getPlayer() {
  return request('POST', '/player/auth');
}

export async function getPlayerEvents() {
  return request('POST', '/player/events');
}

export async function getPlayerAssets() {
  return request('POST', '/player/assets', { token: tok() });
}

export async function getPlayerTargets() {
  return request('POST', '/player/targets', { token: tok() });
}

export async function searchPlayers(query) {
  return request('POST', '/search', { token: tok(), query });
}

export async function addTarget(targetId) {
  return request('POST', '/player/targets/add', { token: tok(), targetid: targetId });
}

// ====== CAPTCHA ======
// Crime.Life uses hCaptcha. The flow is:
// 1. POST /captcha/status {token} -> check if captcha is validated
// 2. If not validated, solve hCaptcha with sitekey
// 3. POST /captcha/status {token, captchaToken} -> validate
// Sitekeys: normal="9ca8bf70-0d06-43ca-8a58-0924f58a0e54", hard="b5fee4f0-8a1a-44b6-9152-818c5bd68314"

export const HCAPTCHA_SITEKEY = '9ca8bf70-0d06-43ca-8a58-0924f58a0e54';
export const HCAPTCHA_SITEKEY_HARD = 'b5fee4f0-8a1a-44b6-9152-818c5bd68314';

export async function getCaptchaStatus() {
  return request('POST', '/captcha/status', { token: tok() });
}

export async function validateCaptcha(captchaToken) {
  return request('POST', '/captcha/status', { token: tok(), captchaToken });
}

// ====== CRIMES ======
// Body: {crimeid, token, captchaToken?}

export async function getCrimes() {
  return request('GET', '/crimes');
}

export async function commitCrime(crimeId, captchaToken = null) {
  const body = { crimeid: crimeId, token: tok() };
  if (captchaToken) body.captchaToken = captchaToken;
  return request('POST', '/crimes/execute', body);
}

// ====== TRAINING ======
// Body: {trainingid, token, captchaToken?}

export async function train(trainingId, captchaToken = null) {
  const body = { trainingid: trainingId, token: tok() };
  if (captchaToken) body.captchaToken = captchaToken;
  return request('POST', '/trainings/buy', body);
}

// ====== COMBAT ======
// Check: POST /player/attack/check {token, targetid}
// Attack: POST /player/attack {token, targetid}

export async function checkAttack(targetId) {
  return request('POST', '/player/attack/check', { token: tok(), targetid: targetId });
}

export async function attackPlayer(targetId) {
  return request('POST', '/player/attack', { token: tok(), targetid: targetId });
}

// ====== HOSPITAL ======
// POST /hospital/treatment {token, treatment_id}

export async function heal(treatmentId) {
  return request('POST', '/hospital/treatment', { token: tok(), treatment_id: treatmentId });
}

export async function instantRelease() {
  return request('POST', '/consumables/instant-release', { token: tok() });
}

// ====== NIGHTCLUBS ======
// POST /nightclub/join {nightclubid, token}
// POST /nightclub/leave {nightclubid, token}
// POST /nightclub/buy-drug {nightclubid, drugid, token}
// POST /nightclub/engage {nightclubid, serviceid, token}

export async function joinClub(clubId) {
  return request('POST', '/nightclub/join', { nightclubid: clubId, token: tok() });
}

export async function leaveClub(clubId) {
  return request('POST', '/nightclub/leave', { nightclubid: clubId, token: tok() });
}

export async function buyClubDrug(clubId, drugId) {
  return request('POST', '/nightclub/buy-drug', { nightclub_id: clubId, drug_id: drugId, token: tok() });
}

export async function engageService(clubId, serviceId) {
  return request('POST', '/nightclub/engage', { nightclubid: clubId, serviceid: serviceId, token: tok() });
}

// ====== PHARMACY / CONSUMABLES ======
// GET /consumables
// POST /consumables/buy {token, consumableid}

export async function getConsumables() {
  return request('GET', '/consumables');
}

export async function buyConsumable(consumableId) {
  return request('POST', '/consumables/buy', { token: tok(), consumableid: consumableId });
}

export async function useConsumable(consumableId) {
  return request('POST', '/consumables/use', { token: tok(), consumable_id: consumableId });
}

// ====== SHOP / EQUIPMENT ======
// POST /shops/purchase {token, itemid, shopid}
// POST /equipment/equip {token, itemid}
// POST /equipment/unequip {token, slot}

export async function buyItem(shopId, itemId) {
  return request('POST', '/shops/purchase', { token: tok(), itemid: itemId, shopid: shopId });
}

export async function equipItem(itemId) {
  return request('POST', '/equipment/equip', { token: tok(), itemid: itemId });
}

export async function unequipItem(slot) {
  return request('POST', '/equipment/unequip', { token: tok(), slot });
}

// ====== BANK ======
// POST /bank/status {token}
// POST /bank/open {token}
// POST /bank/deposit {token, amount}
// POST /bank/withdraw {token, amount}

export async function getBankStatus() {
  return request('POST', '/bank/status', { token: tok() });
}

export async function openBank() {
  return request('POST', '/bank/open', { token: tok() });
}

export async function deposit(amount) {
  return request('POST', '/bank/deposit', { token: tok(), amount });
}

export async function withdraw(amount) {
  return request('POST', '/bank/withdraw', { token: tok(), amount });
}

// ====== FACTORIES ======
// POST /factories/collect {token, factoryid}
// POST /factories/buy-upgrade {token, factoryid}

export async function collectFactory(factoryId) {
  return request('POST', '/factories/collect', { token: tok(), factoryid: factoryId });
}

export async function upgradeFactory(factoryId) {
  return request('POST', '/factories/buy-upgrade', { token: tok(), factoryid: factoryId });
}

// ====== HOOKERS / BROTHEL ======

export async function collectHookerProfits(hookerId) {
  return request('POST', '/hookers/collect', { token: tok(), hookerid: hookerId });
}

export async function upgradeHooker(hookerId) {
  return request('POST', '/hookers/buy-upgrade', { token: tok(), hookerid: hookerId });
}

// ====== JUNKYARD ======

export async function getJunkyardRecipes() {
  return request('POST', '/junkyard/recipes', { token: tok() });
}

export async function getJunkyardInventory() {
  return request('POST', '/junkyard/inventory', { token: tok() });
}

export async function craftItem(recipeId) {
  return request('POST', '/junkyard/craft', { token: tok(), recipeId });
}

export async function sellJunk(itemId) {
  return request('POST', '/junkyard/sell', { token: tok(), itemid: itemId });
}

// ====== GANGS ======

export async function getGangInfo() {
  return request('POST', '/gangs/info', { token: tok() });
}

export async function createGang(name) {
  return request('POST', '/gangs/create', { token: tok(), name });
}

export async function getGangCrimes() {
  return request('POST', '/gangs/crimes/available', { token: tok() });
}

export async function createGangCrime(crimeId) {
  return request('POST', '/gangs/crimes/create', { token: tok(), crimeid: crimeId });
}

export async function signupGangCrime(crimeId) {
  return request('POST', '/gangs/crimes/signup', { token: tok(), crimeid: crimeId });
}

export async function startGangCrime(crimeId) {
  return request('POST', '/gangs/crimes/start', { token: tok(), crimeid: crimeId });
}

export async function inviteToGang(playerId) {
  return request('POST', '/gangs/members/invite', { token: tok(), playerid: playerId });
}

export async function donateToGang(amount) {
  return request('POST', '/gangs/donate', { token: tok(), amount });
}

// Gang Turf Wars
export async function getTurfMap() {
  return request('POST', '/gangs/turf/map', { token: tok() });
}

export async function getTurfStats() {
  return request('POST', '/gangs/turf/stats', { token: tok() });
}

export async function startTurfBattle(turfId) {
  return request('POST', '/gangs/turf/battle/start', { token: tok(), turfid: turfId });
}

// ====== CHAT ======
// POST /chat/messages {channel, token}
// POST /chat/send {channel, message, token}

export async function getChatMessages(channel = 'city-pt') {
  return request('POST', '/chat/messages', { channel, token: tok() });
}

export async function sendChatMessage(message, channel = 'city-pt') {
  return request('POST', '/chat/send', { channel, message, token: tok() });
}

// ====== DAILY QUESTS ======

export async function getDailyQuests() {
  return request('POST', '/daily-quests/today', { token: tok() });
}

export async function completeDailyQuest(questId) {
  return request('POST', '/daily-quests/complete', { token: tok(), questid: questId });
}

// ====== WORLD ======

export async function getTimeWeather() {
  return request('GET', '/world/time-weather');
}

export async function getConfig() {
  return request('GET', '/config/game');
}

export async function getEventsToday() {
  return request('GET', '/events/today');
}

export async function getBreakingNews() {
  return request('GET', '/breaking-news/latest');
}

export async function getOnlinePlayers() {
  return request('GET', '/online/players');
}

// ====== LEADERBOARD ======

export async function getLeaderboard() {
  return request('GET', '/leaderboard/top100');
}

// ====== NEWSSTAND ======

export async function getNewsstand() {
  return request('GET', '/newsstand/details');
}

// ====== CASINO ======

export async function getPokerTables() {
  return request('POST', '/casino/poker/tables', { token: tok() });
}

// ====== GENERIC ======

export async function rawRequest(method, path, body) {
  return request(method, path, body);
}
