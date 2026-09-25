import { expect, test } from '@playwright/test';

/**
 * Opens the built game in a real browser and plays a few seconds of it. Unit tests cover
 * the rules; this is the only check that the renderer, the HUD and the input are wired
 * to each other and that WebGL accepts every draw.
 */
test('the city draws, time passes and a road can be built', async ({ page }) => {
  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    // WebGL reports rejected draw calls as warnings, and a rejected draw is an empty screen.
    if (m.type() === 'error' || m.text().includes('GL_INVALID')) problems.push(`${m.type()}: ${m.text()}`);
  });

  await page.goto('/');
  await page.waitForFunction(() => (window.__game?.frames ?? 0) > 5, null, { timeout: 90_000 });
  await expect(page.locator('.cartouche .title')).toHaveText('Dârülmülk Konya');
  await expect(page.locator('.treasury .amount')).toHaveText('20.000');
  await expect(page.locator('#boot')).toBeHidden();

  // Time moves at normal speed and stops when paused.
  const firstDate = await page.locator('.cartouche .date').textContent();
  await page.waitForFunction(
    (d) => document.querySelector('.cartouche .date')?.textContent !== d,
    firstDate,
    { timeout: 30_000 },
  );
  await page.keyboard.press('Space');
  const paused = await page.evaluate(() => window.__game?.city.calendar.speed);
  expect(paused).toBe(0);

  // Look at open plain east of the walls and drag a road across it.
  await page.evaluate(() => {
    const rig = window.__game!.world.rig;
    rig.setView(42, 8, 16, 0);
    rig.snap();
  });
  await page.getByRole('button', { name: /Yol/ }).click();
  const box = (await page.locator('#view').boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.5, { steps: 6 });
  await expect(page.locator('.tip')).toContainText('dirhem');
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => window.__game!.city.treasury)).toBeLessThan(20000);

  // The fertility layer toggles from the toolbar.
  await page.getByRole('button', { name: /Verimlilik/ }).click();
  expect(await page.evaluate(() => window.__game!.world.terrain.fertilityVisible)).toBe(true);

  expect(problems).toEqual([]);
});
