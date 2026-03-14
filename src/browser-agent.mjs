// Browser agent - Uses Playwright for actions that require browser interaction
// (login with captcha, complex UI interactions, screenshot analysis)
import 'dotenv/config';
import { chromium } from 'playwright';
import { detectAndSolveHCaptcha } from './captcha-solver.mjs';

let browser = null;
let context = null;
let page = null;

export async function launchBrowser(headless = true) {
  if (browser) return page;
  browser = await chromium.launch({ headless });
  context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
  });
  page = await context.newPage();
  return page;
}

export async function closeBrowser() {
  if (browser) {
    await browser.close();
    browser = null;
    context = null;
    page = null;
  }
}

export function getPage() { return page; }

// Login via browser (handles captcha if present)
export async function browserLogin(email, password) {
  const p = await launchBrowser();
  await p.goto('https://crime.life/login', { waitUntil: 'networkidle' });

  // Fill login form
  await p.fill('input[type="email"], input[placeholder*="example"]', email);
  await p.fill('input[type="password"]', password);

  // Check for captcha before submitting
  const captchaToken = await detectAndSolveHCaptcha(p);
  if (captchaToken) {
    console.log('[Browser] Captcha solved successfully');
  }

  // Click login button
  await p.click('button:has-text("Entrar"):not(:has-text("Google"))');

  // Wait for game to load
  try {
    await p.waitForSelector('[data-pin-type]', { timeout: 30000 });
    console.log('[Browser] Login successful, game loaded');
  } catch {
    // Might have another captcha or error
    const captchaToken2 = await detectAndSolveHCaptcha(p);
    if (captchaToken2) {
      console.log('[Browser] Second captcha solved');
      await p.waitForSelector('[data-pin-type]', { timeout: 30000 });
    }
  }

  // Extract auth token from localStorage or cookies
  const token = await p.evaluate(() => {
    return localStorage.getItem('token') ||
           localStorage.getItem('accessToken') ||
           document.cookie;
  });

  return { success: true, token };
}

// Intercept API responses to learn endpoint formats
export async function interceptApiCalls(duration = 30000) {
  const p = getPage();
  if (!p) throw new Error('Browser not launched');

  const captured = [];

  const handler = (response) => {
    const url = response.url();
    if (url.includes('api.crime.life')) {
      response.json().then(data => {
        captured.push({
          url,
          method: response.request().method(),
          status: response.status(),
          data,
          timestamp: new Date().toISOString(),
        });
      }).catch(() => {});
    }
  };

  p.on('response', handler);
  await new Promise(r => setTimeout(r, duration));
  p.off('response', handler);

  return captured;
}

// Take a screenshot of the current game state
export async function takeScreenshot(filename = 'game-state.png') {
  const p = getPage();
  if (!p) throw new Error('Browser not launched');
  await p.screenshot({ path: filename, fullPage: false });
  return filename;
}

// Navigate to a specific game section by clicking on the map
export async function navigateTo(section) {
  const p = getPage();
  if (!p) throw new Error('Browser not launched');

  // Try clicking on the map pin with the section name
  try {
    await p.click(`button:has-text("${section}")`, { timeout: 5000 });
    await p.waitForTimeout(1000);
    return true;
  } catch {
    console.log(`[Browser] Could not find section: ${section}`);
    return false;
  }
}

// Extract the current game state from the browser DOM
export async function extractGameState() {
  const p = getPage();
  if (!p) throw new Error('Browser not launched');

  return p.evaluate(() => {
    const state = {};

    // Try to extract player info from the DOM
    const levelEl = document.querySelector('[class*="level"], [class*="Level"]');
    if (levelEl) state.level = levelEl.textContent;

    const moneyEl = document.querySelector('[class*="money"], [class*="cash"]');
    if (moneyEl) state.money = moneyEl.textContent;

    const energyEl = document.querySelector('[class*="energy"], [class*="Energy"]');
    if (energyEl) state.energy = energyEl.textContent;

    // Check if in hospital or prison
    state.inHospital = !!document.querySelector('[class*="hospital"]:not([data-pin-type])');
    state.inPrison = !!document.querySelector('[class*="prison"]:not([data-pin-type])');

    return state;
  });
}
