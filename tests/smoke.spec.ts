import { expect, test } from '@playwright/test';

/**
 * The end-to-end check: open the built game, play it, and see that it worked.
 *
 * Everything else in `tests/` runs the simulation without a browser. This is the only
 * thing that proves the pieces are actually wired to each other — that the models
 * compile, the canvas gets a context, the loop runs, the horde arrives and nothing
 * throws on the way. A unit suite cannot catch a scene that never adds its meshes.
 *
 * What it deliberately does *not* assert is frame rate. CI has no GPU: Chromium falls
 * back to software rasterisation, so any number measured here would say something
 * about SwiftShader and nothing about a player's machine.
 */

const PLAY_SECONDS = 20;

/** Reads a labelled count out of the debug overlay. */
function overlayNumber(text: string, pattern: RegExp): number {
  const match = pattern.exec(text);
  return match === null ? -1 : Number(match[1]);
}

test('a run starts, plays and stays quiet', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));

  await page.goto('/?debug=1&seed=smoke');

  // The title screen, and a simulation that is not running behind it. Scoped to the
  // shell and picked by position rather than by label: the HUD's pause button comes
  // first in the document, and the label depends on the stored language.
  await expect(page.locator('.sh-root')).toBeVisible();
  await page.locator('.sh-root .sh-button[data-primary]').click();
  await expect(page.locator('.sh-root')).toBeHidden();

  // Walk, so the world streams and the crowd has to chase something.
  await page.keyboard.down('KeyD');
  await page.waitForTimeout((PLAY_SECONDS / 2) * 1000);
  await page.keyboard.down('KeyW');
  await page.waitForTimeout((PLAY_SECONDS / 2) * 1000);
  await page.keyboard.up('KeyD');
  await page.keyboard.up('KeyW');

  const overlay = (await page.locator('#perf-overlay').textContent()) ?? '';

  // The horde arrived and the player's weapons found it.
  expect(overlayNumber(overlay, /enemies (\d+)/)).toBeGreaterThan(10);
  expect(overlayNumber(overlay, /kills (\d+)/)).toBeGreaterThan(0);

  // The scene is drawing, and within the draw-call budget the whole design rests on.
  const drawCalls = overlayNumber(overlay, /draw calls (\d+)/);
  expect(drawCalls).toBeGreaterThan(0);
  expect(drawCalls).toBeLessThan(60);

  // The clock advanced, which is the one thing that proves the loop ran.
  const clock = await page.locator('.hud-time').textContent();
  expect(clock).toMatch(/^00:[0-9]{2}$/);
  expect(clock).not.toBe('00:00');

  expect(errors).toEqual([]);
});

test('pause stops the world and resume starts it again', async ({ page }) => {
  await page.goto('/?debug=1&seed=smoke&go=1');
  await page.waitForTimeout(2500);

  const clock = async (): Promise<string> => (await page.locator('.hud-time').textContent()) ?? '';

  await page.keyboard.press('Escape');
  await expect(page.locator('.sh-root')).toBeVisible();

  const paused = await clock();
  await page.waitForTimeout(1500);
  expect(await clock()).toBe(paused);

  await page.keyboard.press('Escape');
  await expect(page.locator('.sh-root')).toBeHidden();
  await page.waitForTimeout(1500);
  expect(await clock()).not.toBe(paused);
});

test('nothing opaque covers the game during ordinary play', async ({ page }) => {
  // A regression guard with history: an author `display` declaration outranks the
  // `hidden` attribute's user-agent rule, and a panel that stopped showing its text
  // kept painting a near-opaque wash over the whole run.
  await page.goto('/?seed=smoke&go=1');
  await page.waitForTimeout(3000);

  const veiling = await page.evaluate(() => {
    const covering: string[] = [];
    for (const element of document.body.querySelectorAll('*')) {
      const rect = element.getBoundingClientRect();
      if (rect.width < innerWidth * 0.9 || rect.height < innerHeight * 0.9) continue;
      const style = getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      const opaque =
        style.backgroundColor !== 'rgba(0, 0, 0, 0)' && !style.backgroundColor.endsWith(', 0)');
      if (opaque || style.backdropFilter !== 'none') {
        covering.push(`${element.tagName}.${String(element.className)}`);
      }
    }
    return covering;
  });

  expect(veiling).toEqual([]);
});

test('the run can be played with a finger', async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const phone = await context.newPage();
  const errors: string[] = [];
  phone.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));

  await phone.goto('/?debug=1&seed=smoke&go=1');
  await phone.waitForTimeout(2500);

  // The one control a phone has, and the one it does not: steering, and a way to stop.
  await phone.touchscreen.tap(200, 700);
  await phone.waitForTimeout(2000);
  await expect(phone.locator('.hud-pause')).toBeVisible();
  await phone.locator('.hud-pause').tap();
  await expect(phone.locator('.sh-root')).toBeVisible();

  // Nothing should scroll sideways on a phone, at any panel.
  const scrolls = await phone.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1,
  );
  expect(scrolls).toBe(false);
  expect(errors).toEqual([]);

  await context.close();
});

test('a browser that forbids the gamepad still plays', async ({ browser }) => {
  // The failure this pins actually shipped. Embedded in a cross-origin iframe whose
  // permissions policy omits `gamepad`, `navigator.getGamepads()` raises a
  // SecurityError instead of returning nothing. It is polled every frame, so the
  // unguarded call threw before the first frame was ever drawn: the player got a grey
  // screen, and because nothing in the game caught it, nothing said why.
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'getGamepads', {
      configurable: true,
      value: () => {
        throw new DOMException('disallowed by permissions policy', 'SecurityError');
      },
    });
  });

  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));

  await page.goto('/?debug=1&seed=pad&go=1');
  await page.waitForTimeout(2500);

  // The boot panel is gone, which only happens once a frame has been drawn.
  expect(await page.locator('#boot').count()).toBe(0);

  const clock = async (): Promise<string> => (await page.locator('.hud-time').textContent()) ?? '';
  const before = await clock();
  await page.touchscreen.tap(200, 700);
  await page.waitForTimeout(3000);
  expect(await clock()).not.toBe(before);

  expect(errors).toEqual([]);
  await context.close();
});

test('the hero actually swings while his weapons fire', async ({ page }) => {
  // The regression this pins shipped and was reported by the person playing it: "the
  // character does nothing when attacking". The trigger asked the rig whether its
  // animation had `finished`, which is only ever true for a one-shot — a walking hero
  // plays a loop, so the condition could not pass and the sword never moved. Unit
  // tests covered the rig and still missed it, because the fault was in the wiring.
  await page.goto('/?debug=1&seed=swing&go=1');
  await page.waitForTimeout(2500);

  const seen = new Set<string>();
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(120);
    const overlay = (await page.locator('#perf-overlay').textContent()) ?? '';
    const match = /hero (\S+)/.exec(overlay);
    if (match !== null) seen.add(match[1]);
  }

  // Weapons fire on their own from the first second, so a swing must appear without
  // the test pressing anything.
  expect([...seen].some((state) => state.includes('+attack'))).toBe(true);
});
