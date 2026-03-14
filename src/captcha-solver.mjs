// hCaptcha solver using Nopecha API
import 'dotenv/config';

const NOPECHA_KEY = process.env.NOPECHA_API_KEY;
const NOPECHA_BASE = 'https://api.nopecha.com/v1';

async function nopechaRequest(method, path, body = null) {
  const url = `${NOPECHA_BASE}${path}`;
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Basic ${NOPECHA_KEY}`,
  };
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(url, opts);

  // 409 = job still processing (not an error, just incomplete)
  if (res.status === 409) {
    return { data: 'incomplete' };
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Nopecha ${method} ${path} failed (${res.status}): ${text}`);
  }
  return res.json();
}

// Solve hCaptcha token challenge - returns a valid token for form submission
export async function solveHCaptchaToken(sitekey, pageUrl, options = {}) {
  const body = {
    sitekey,
    url: pageUrl,
  };

  if (options.proxy) {
    body.proxy = {
      scheme: options.proxy.scheme || 'http',
      host: options.proxy.host,
      port: options.proxy.port,
      ...(options.proxy.username && { username: options.proxy.username }),
      ...(options.proxy.password && { password: options.proxy.password }),
    };
  }

  if (options.rqdata) {
    body.data = { rqdata: options.rqdata };
  }

  if (options.useragent) {
    body.useragent = options.useragent;
  }

  // Submit the job
  const submitResult = await nopechaRequest('POST', '/token/hcaptcha', body);
  const jobId = submitResult.data;

  if (!jobId) throw new Error('No job ID returned from Nopecha');

  // Poll for the result
  return pollForResult(`/token/hcaptcha?id=${jobId}`);
}

// Solve hCaptcha image recognition challenge
export async function solveHCaptchaRecognition(challengeData) {
  const body = {
    data: {
      request_type: challengeData.type || 'image_label_binary',
      requester_question: {
        en: challengeData.question,
      },
      tasklist: challengeData.images.map((img, i) => ({
        task_key: challengeData.taskKeys?.[i] || `task_${i}`,
        datapoint_uri: img, // base64 or URL
      })),
    },
  };

  if (challengeData.examples) {
    body.data.requester_question_example = challengeData.examples;
  }

  const submitResult = await nopechaRequest('POST', '/recognition/hcaptcha', body);
  const jobId = submitResult.data;

  if (!jobId) throw new Error('No job ID returned from Nopecha');

  return pollForResult(`/recognition/hcaptcha?id=${jobId}`);
}

async function pollForResult(path, maxAttempts = 30, intervalMs = 2000) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await sleep(intervalMs);
    try {
      const result = await nopechaRequest('GET', path);
      if (result.data && result.data !== 'incomplete') {
        return result.data;
      }
    } catch (err) {
      // If the job is still processing, we might get errors
      if (attempt >= maxAttempts - 1) throw err;
    }
  }
  throw new Error('Captcha solve timed out');
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// Detect hCaptcha on a Playwright page and solve it
export async function detectAndSolveHCaptcha(page) {
  // Check if hCaptcha iframe exists
  const hcaptchaFrame = page.frameLocator('iframe[src*="hcaptcha"]');

  try {
    const checkbox = hcaptchaFrame.locator('#checkbox');
    const isVisible = await checkbox.isVisible({ timeout: 2000 });

    if (!isVisible) return null;

    // Get the sitekey from the page
    const sitekey = await page.evaluate(() => {
      const el = document.querySelector('[data-sitekey]');
      return el?.getAttribute('data-sitekey') || null;
    });

    if (!sitekey) return null;

    const pageUrl = page.url();

    // Try token-based solve first
    const token = await solveHCaptchaToken(sitekey, pageUrl);

    // Inject the token into the page
    await page.evaluate((tkn) => {
      const textarea = document.querySelector('textarea[name="h-captcha-response"]');
      if (textarea) textarea.value = tkn;
      const input = document.querySelector('input[name="h-captcha-response"]');
      if (input) input.value = tkn;
      // Trigger callback if available
      if (window.hcaptcha) {
        try { window.hcaptcha.execute(); } catch {}
      }
    }, token);

    return token;
  } catch {
    return null;
  }
}
