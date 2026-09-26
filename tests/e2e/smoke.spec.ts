import { expect, test, type Page } from '@playwright/test';

/**
 * Opens the built game in a real browser and plays a few minutes of it. Unit tests cover
 * the rules; this is the only check that the renderer, the HUD and the input are wired
 * to each other and that WebGL accepts every draw.
 */

/** Centres the view on the first spot near `near` where the chosen building may go. */
async function lookAtSite(page: Page, near: [number, number]): Promise<void> {
  const found = await page.evaluate((near) => {
    const g = window.__game!;
    const c = g.city;
    const cx = c.grid.tileOf(near[0]);
    const cz = c.grid.tileOf(near[1]);
    for (let r = 0; r < 30; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const plan = g.previewPlacement({ x: cx + dx, z: cz + dz }, 0, 0);
          if (plan.problem === undefined) return { x: c.grid.centre(cx + dx), z: c.grid.centre(cz + dz) };
        }
      }
    }
    return null;
  }, near);
  expect(found).not.toBeNull();
  await page.evaluate((p) => {
    const rig = window.__game!.world.rig;
    rig.setView(p!.x, p!.z, 10, 0);
    rig.snap();
  }, found);
}

async function clickCentre(page: Page): Promise<void> {
  const box = (await page.locator('#view').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.up();
}

test('the city draws and grows; buildings go up where they are put, rise a level, come down', async ({
  page,
}) => {
  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    // WebGL reports rejected draw calls as warnings, and a rejected draw is an empty screen.
    if (m.type() === 'error' || m.text().includes('GL_INVALID')) problems.push(`${m.type()}: ${m.text()}`);
  });

  await page.goto('/');
  await page.waitForFunction(() => (window.__game?.frames ?? 0) > 5, null, { timeout: 90_000 });
  await expect(page.locator('.cartouche .title')).toHaveText('Dârülmülk Konya');
  await expect(page.locator('.treasury .amount')).toHaveText('3.000');
  await expect(page.locator('.ledger')).toContainText('Taş');
  await expect(page.locator('#boot')).toBeHidden();
  expect(await page.evaluate(() => window.__game!.city.population)).toBeGreaterThan(1000);
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

  // A quarry on the stone: the build bar marks the sites, a click puts the quarry there.
  await page.getByRole('button', { name: /İnşa/ }).click();
  await page.locator('.buildbar button[data-kind="ocak"]').click();
  expect(await page.evaluate(() => window.__game!.world.terrain.sitesVisible)).toBe(true);
  const site = await page.evaluate(() => window.__game!.city.def.resource.sites[0]);
  await lookAtSite(page, [site.x, site.z]);
  await clickCentre(page);
  await expect.poll(() => page.evaluate(() => window.__game!.city.buildings.size)).toBe(3);
  await expect(page.locator('.info.pinned h3')).toHaveText('Taş Ocağı');
  expect(await page.evaluate(() => window.__game!.city.treasury)).toBe(2500);

  // Time runs until the quarry stands.
  await page.keyboard.press('3');
  await expect
    .poll(
      () =>
        page.evaluate(
          () => [...window.__game!.city.buildings.values()].find((b) => b.kind === 'ocak')?.level ?? 0,
        ),
      { timeout: 40_000 },
    )
    .toBe(1);
  await page.keyboard.press('Space');

  // The old bazaar rises a level from its panel.
  const bazaar = await page.evaluate(() => {
    const c = window.__game!.city;
    const b = [...c.buildings.values()].find((x) => x.kind === 'carsi')!;
    return { x: b.x0, z: b.z0, id: b.id };
  });
  await page.evaluate((b) => window.__game!.select({ x: b.x, z: b.z }), bazaar);
  await expect(page.locator('.info.pinned h3')).toHaveText('Larende Çarşısı');
  await page.locator('.info .ladder .upgrade').click();
  await expect
    .poll(() => page.evaluate((id) => window.__game!.city.buildings.get(id)?.work?.toLevel ?? 0, bazaar.id))
    .toBe(2);

  // The buildings list: each building with its next level, the next ring of walls at its
  // head, and a name that takes the camera to the building and its badge.
  await page.keyboard.press('l');
  await expect(page.locator('.roster')).toBeVisible();
  await expect(page.locator('.roster .summary')).toContainText('yapı hakkı 3/5');
  await expect(page.locator('.roster .entry.walls')).toContainText('Dış Sur');
  await expect(page.locator('.roster .entry.walls')).toContainText('Büyük Şehir');
  await page.locator('.roster .entry .name', { hasText: 'Meram Ambarı' }).click();
  await expect(page.locator('.info.pinned h3')).toHaveText('Meram Ambarı');
  await expect(page.locator('.info.pinned .ladder')).toBeVisible();
  await expect(page.locator('.markers .marker').first()).toBeVisible();
  await page.keyboard.press('l');
  await expect(page.locator('.roster')).toBeHidden();

  // Taxes: the ledger's switch, and the accounts fold open.
  await page.getByRole('button', { name: /^Ağır$/ }).click();
  expect(await page.evaluate(() => window.__game!.city.policy.tax)).toBe('agir');
  await page.getByRole('button', { name: /Hesap/ }).click();
  await expect(page.locator('.ledger .accounts')).toContainText('Hane vergisi');
  await expect(page.locator('.ledger .accounts')).toContainText('Kalabalık');

  // The quarry comes down again with the demolish tool.
  const quarry = await page.evaluate(() => {
    const c = window.__game!.city;
    const b = [...c.buildings.values()].find((x) => x.kind === 'ocak')!;
    return { x: c.grid.centre(b.x0), z: c.grid.centre(b.z0) };
  });
  await page.evaluate((p) => {
    const rig = window.__game!.world.rig;
    rig.setView(p.x, p.z, 10, 0);
    rig.snap();
  }, quarry);
  await page.locator('.toolbar button[data-tool="yik"]').click();
  await clickCentre(page);
  await expect.poll(() => page.evaluate(() => window.__game!.city.buildings.size)).toBe(2);

  // The menu keeps the city and brings it back.
  await page.getByRole('button', { name: 'Menü' }).click();
  await page.locator('.menu [data-action="kaydet"]').click();
  const kept = await page.evaluate(() => ({
    akce: window.__game!.city.treasury,
    buildings: window.__game!.city.buildings.size,
  }));
  await page.evaluate(() => {
    window.__game!.city.treasury = 1;
  });
  await page.locator('.menu [data-action="yukle"]').click();
  await expect.poll(() => page.evaluate(() => window.__game!.city.treasury)).toBe(kept.akce);
  expect(await page.evaluate(() => window.__game!.city.buildings.size)).toBe(kept.buildings);
  // The save also leaves as a file.
  await page.getByRole('button', { name: 'Menü' }).click();
  const [file] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Dosyaya indir' }).click(),
  ]);
  expect(file.suggestedFilename()).toMatch(/^darulmulk-konya-.*\.json$/);
  // The first click started the sound.
  expect(await page.evaluate(() => window.__game!.sound.running)).toBe(true);

  expect(problems).toEqual([]);
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

  test('a first tap shows the building and its price, a second tap builds it', async ({ page }) => {
    const problems: string[] = [];
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    page.on('console', (m) => {
      if (m.type() === 'error' || m.text().includes('GL_INVALID')) problems.push(`${m.type()}: ${m.text()}`);
    });
    await page.goto('/');
    await page.waitForFunction(() => (window.__game?.frames ?? 0) > 5, null, { timeout: 90_000 });
    await page.evaluate(() => window.__game!.setSpeed(0));
    await page.locator('.toolbar button[data-tool="insa"]').tap();
    await page.locator('.buildbar button[data-kind="hamam"]').tap();
    await lookAtSite(page, [6, 12]);
    const box = (await page.locator('#view').boundingBox())!;
    const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await page.touchscreen.tap(centre.x, centre.y);
    await expect(page.locator('.tip')).toContainText('Hamam');
    expect(await page.evaluate(() => window.__game!.city.buildings.size)).toBe(2);
    await page.touchscreen.tap(centre.x, centre.y);
    await expect.poll(() => page.evaluate(() => window.__game!.city.buildings.size)).toBe(3);
    await expect(page.locator('.info.pinned h3')).toHaveText('Hamam');
    expect(problems).toEqual([]);
  });
});
