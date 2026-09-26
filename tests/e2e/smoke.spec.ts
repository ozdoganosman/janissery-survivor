import { expect, test, type Page } from '@playwright/test';

/**
 * Opens the built game in a real browser and plays a few minutes of it. Unit tests cover
 * the rules; this is the only check that the renderer, the HUD and the input are wired
 * to each other and that WebGL accepts every draw.
 */

/** Finds open plain outside the walls, clear of roads, fields and houses, and centres the view on it. */
async function lookAtOpenGround(page: Page): Promise<void> {
  const found = await page.evaluate(() => {
    const c = window.__game!.city;
    const { grid } = c;
    const free = (x: number, z: number): boolean => {
      if (!grid.inBounds(x, z)) return false;
      const i = grid.index(x, z);
      return (
        c.road[i] === 0 &&
        c.house[i] === 0 &&
        c.field[i] < 0 &&
        c.zone[i] === 0 &&
        c.terrain.water[i] === 0 &&
        c.terrain.slope[i] < 0.3 &&
        c.terrain.fertility[i] > 0.2
      );
    };
    for (let wz = -30; wz < 20; wz++) {
      for (let wx = 30; wx < 80; wx++) {
        const x0 = grid.tileOf(wx);
        const z0 = grid.tileOf(wz);
        let ok = true;
        for (let dz = 0; dz < 18 && ok; dz++)
          for (let dx = 0; dx < 20 && ok; dx++) ok = free(x0 + dx, z0 + dz);
        if (ok) return { x: wx + 10, z: wz + 7 };
      }
    }
    return null;
  });
  expect(found).not.toBeNull();
  await page.evaluate((p) => {
    const rig = window.__game!.world.rig;
    rig.setView(p!.x, p!.z, 10, 0);
    rig.snap();
  }, found);
}

async function drag(page: Page, from: [number, number], to: [number, number]): Promise<void> {
  const box = (await page.locator('#view').boundingBox())!;
  await page.mouse.move(box.x + box.width * from[0], box.y + box.height * from[1]);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * to[0], box.y + box.height * to[1], { steps: 6 });
  await page.mouse.up();
}

test('the city draws, grows on zoned land, takes fields, a bazaar, layers and a budget', async ({ page }) => {
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
  expect(await page.evaluate(() => window.__game!.city.stats.population)).toBeGreaterThan(1000);
  // The townspeople are out in the streets.
  expect(await page.evaluate(() => window.__game!.world.people.count)).toBeGreaterThan(200);

  // Time moves at normal speed and stops when paused.
  const firstDate = await page.locator('.cartouche .date').textContent();
  await page.waitForFunction(
    (d) => document.querySelector('.cartouche .date')?.textContent !== d,
    firstDate,
    { timeout: 30_000 },
  );
  await page.keyboard.press('Space');
  expect(await page.evaluate(() => window.__game!.city.calendar.speed)).toBe(0);

  await lookAtOpenGround(page);

  // A road across the middle of the screen.
  await page.getByRole('button', { name: /Yol/ }).click();
  await drag(page, [0.3, 0.45], [0.7, 0.45]);
  await expect.poll(() => page.evaluate(() => window.__game!.city.treasury)).toBeLessThan(20000);

  // Zone a strip beside it, then let time run until houses rise on those new lots.
  await page.getByRole('button', { name: /Konut/ }).click();
  const zonesBefore = await page.evaluate(() => Array.from(window.__game!.city.zone));
  await drag(page, [0.35, 0.49], [0.65, 0.53]);
  const newLots = await page.evaluate((prev) => {
    const c = window.__game!.city;
    const out: number[] = [];
    for (let i = 0; i < c.zone.length; i++) if (c.zone[i] === 1 && prev[i] === 0) out.push(i);
    return out;
  }, zonesBefore);
  expect(newLots.length).toBeGreaterThan(5);
  await page.keyboard.press('3');
  await expect
    .poll(
      () =>
        page.evaluate((lots) => {
          const c = window.__game!.city;
          return lots.filter((i) => c.house[i] > 0).length;
        }, newLots),
      { timeout: 40_000 },
    )
    .toBeGreaterThan(0);
  await page.keyboard.press('Space');

  // A barley field further out.
  const fieldsBefore = await page.evaluate(() => window.__game!.city.fields.size);
  await page.getByRole('button', { name: /Tarla/ }).click();
  await page.getByRole('button', { name: /Arpa/ }).click();
  await drag(page, [0.38, 0.66], [0.6, 0.78]);
  await expect.poll(() => page.evaluate(() => window.__game!.city.fields.size)).toBe(fieldsBefore + 1);

  // A bazaar on the far side of the road: the build tool shows where it would stand, and a
  // click where the tip names no problem puts it there.
  const buildingsBefore = await page.evaluate(() => window.__game!.city.buildings.size);
  await page.getByRole('button', { name: /Yapı/ }).click();
  await page.getByRole('button', { name: /Arasta/ }).click();
  const view = (await page.locator('#view').boundingBox())!;
  let placed = false;
  for (let y = 0.34; y <= 0.445 && !placed; y += 0.005) {
    await page.mouse.move(view.x + view.width * 0.5, view.y + view.height * y);
    if (/^Arasta ·/.test((await page.locator('.tip').textContent()) ?? '')) {
      await page.mouse.down();
      await page.mouse.up();
      placed = true;
    }
  }
  expect(placed).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__game!.city.buildings.size)).toBe(buildingsBefore + 1);
  await expect(page.locator('.info.pinned h3')).toHaveText('Arasta');

  // The ledger shows the city's figures, the depot folds open, and the fertility layer
  // toggles from the toolbar.
  await expect(page.locator('.ledger')).toContainText('Nüfus');
  await expect(page.locator('.ledger')).toContainText('kile');
  await expect(page.locator('.ledger')).toContainText('Refah');
  await page.getByRole('button', { name: /Mallar/ }).click();
  await expect(page.locator('.ledger .goods')).toContainText('Un');
  await page.getByRole('button', { name: /Katman/ }).click();
  await page.getByRole('button', { name: /Verimlilik/ }).click();
  expect(await page.evaluate(() => window.__game!.world.terrain.fertilityVisible)).toBe(true);
  // A service layer replaces it, and the budget opens with the tax switch.
  await page.getByRole('button', { name: /^Su$/ }).click();
  expect(await page.evaluate(() => window.__game!.world.activeLayer)).toBe('su');
  expect(await page.evaluate(() => window.__game!.world.terrain.fertilityVisible)).toBe(false);
  await page.getByRole('button', { name: /Bütçe/ }).click();
  await expect(page.locator('.ledger .budget')).toContainText('Sultan payı');
  await page.getByRole('button', { name: /^Ağır$/ }).click();
  expect(await page.evaluate(() => window.__game!.city.policy.tax)).toBe('agir');

  expect(problems).toEqual([]);
});
