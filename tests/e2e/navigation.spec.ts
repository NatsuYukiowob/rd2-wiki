import { test, expect } from '@playwright/test';

for (const [width, height] of [[390, 844], [430, 932]]) {
  test(`NAV. ${width}×${height} 觸控、裁切、關閉與跳頁`, { tag: '@mobile' }, async ({ browser }, testInfo) => {
    const context = await browser.newContext({ baseURL: testInfo.project.use.baseURL, viewport: { width: width!, height: height! }, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    await page.goto('/');
    const links = page.locator('.nav-links');
    const summary = page.locator('.nav-menu > summary');
    const details = page.locator('.nav-menu');
    const panel = page.locator('.nav-menu-items');
    await details.evaluate(n => {
      const events: string[] = [];
      (window as Window & { navEvents?: string[] }).navEvents = events;
      n.addEventListener('click', () => events.push(`click:${(n as HTMLDetailsElement).open}`));
      n.addEventListener('toggle', () => events.push(`toggle:${(n as HTMLDetailsElement).open}`));
    });
    expect(await links.evaluate(n => n.scrollWidth > n.clientWidth)).toBe(true);
    await links.evaluate(n => { n.scrollLeft = n.scrollWidth; });
    expect(await links.evaluate(n => n.scrollLeft)).toBeGreaterThan(0);
    await summary.tap();
    await expect(details).toHaveAttribute('open', '');
    const metrics = await panel.evaluate(menu => {
      const nav = document.querySelector('#site-nav')!;
      const links = document.querySelector('.nav-links')!;
      const r = menu.getBoundingClientRect();
      return { open: (menu.parentElement as HTMLDetailsElement).open,
        box: { x: r.x, y: r.y, width: r.width, height: r.height },
        nav: [nav.scrollWidth, nav.clientWidth, nav.scrollHeight, nav.clientHeight],
        links: [links.scrollWidth, links.clientWidth, links.scrollHeight, links.clientHeight],
        overflow: [getComputedStyle(nav).overflowX, getComputedStyle(nav).overflowY],
        position: getComputedStyle(menu).position,
        containingBlock: (menu as HTMLElement).offsetParent?.id,
        navPosition: getComputedStyle(nav).position,
        navZIndex: getComputedStyle(nav).zIndex,
        backdropFilter: getComputedStyle(nav).backdropFilter,
        events: (window as Window & { navEvents?: string[] }).navEvents,
        hits: [...menu.querySelectorAll('a')].every(a => { const b = a.getBoundingClientRect();
          return menu.contains(document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2)); }),
      };
    });
    expect(metrics.open && metrics.hits).toBe(true);
    expect(metrics.overflow).toEqual(['visible', 'visible']);
    expect(metrics.position).toBe('absolute');
    expect(metrics.containingBlock).toBe('site-nav');
    await testInfo.attach('navigation-metrics', { body: JSON.stringify(metrics, null, 2), contentType: 'application/json' });
    await expect(panel).toBeVisible();
    expect(metrics.box.y).toBeGreaterThan((await page.locator('#site-nav').boundingBox())!.height);
    await page.screenshot({ path: testInfo.outputPath('menu.png') });
    await page.keyboard.press('Escape');
    await expect(details).not.toHaveAttribute('open');
    await expect(summary).toBeFocused();
    await summary.tap();
    await page.touchscreen.tap(5, height! - 10);
    await expect(details).not.toHaveAttribute('open');
    for (const href of ['/guide', '/rewards']) {
      await summary.tap();
      await panel.locator(`a[href="${href}"]`).tap();
      await expect(page).toHaveURL(new RegExp(`${href}/?$`));
    }
    await context.close();
    const noJS = await browser.newContext({ baseURL: testInfo.project.use.baseURL, viewport: { width: width!, height: height! }, isMobile: true, hasTouch: true, javaScriptEnabled: false });
    const fallback = await noJS.newPage();
    await fallback.goto('/');
    await fallback.locator('summary').tap();
    await expect(fallback.locator('details')).toHaveAttribute('open', '');
    await fallback.locator('.nav-menu-items a[href="/guide"]').tap();
    await expect(fallback).toHaveURL(/\/guide\/?$/);
    await fallback.locator('summary').tap();
    await fallback.locator('.nav-menu-items a[href="/rewards"]').tap();
    await expect(fallback).toHaveURL(/\/rewards\/?$/);
    await noJS.close();
  });
}
