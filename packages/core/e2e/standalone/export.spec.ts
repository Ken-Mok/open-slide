import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import { expect, test } from '@playwright/test';
import { prepareScratchProject, runCli, slideSourcePath, TINY_PNG } from '../tests/helpers.ts';

const source = `import { useEffect, useState } from 'react';
import { Step, Steps, useIsActivePage, type Page } from '@open-slide/core';
import image from './badge.png';
import './motion.css';

export const meta = { title: 'Playable export' };
export const notes = ['First speaker note', 'Second speaker note'];
export const transition = {
  duration: 700,
  morph: true,
  enter: { keyframes: [{ opacity: 0 }, { opacity: 1 }] },
  exit: { keyframes: [{ opacity: 1 }, { opacity: 0 }] },
} satisfies Page['transition'];

const First: Page = () => {
  const active = useIsActivePage();
  const [count, setCount] = useState(0);
  const [message, setMessage] = useState('');
  useEffect(() => {
    if (!active) return;
    const id = setTimeout(() => setCount(42), 60);
    return () => clearTimeout(id);
  }, [active]);
  return <div data-testid="first">
    <div data-osd-morph="shared" style={{ position: 'absolute', left: 30, top: 30 }}>Shared</div>
    <button data-testid="interactive" onClick={async () => setMessage((await import('./lazy')).message)}>
      Run interaction
    </button>
    <output data-testid="message">{message}</output>
    <output data-testid="count">{count}</output>
    <img data-testid="asset" src={image} alt="badge" />
    <div data-testid="css-asset" className="export-badge" />
    <div data-testid="entrance" className={active ? 'entrance' : ''}>Animated text</div>
    <Steps><Step><span data-testid="step">Revealed</span></Step></Steps>
  </div>;
};

const Second: Page = () => <div data-testid="second" style={{ width: "100%", height: "100%" }}>
  <div data-osd-morph="shared" style={{ position: 'absolute', left: 800, top: 350 }}>Shared</div>
</div>;

const Third: Page = () => <div data-testid="third">Final page</div>;
Third.transition = { duration: 0 };

export default [First, Second, Third] satisfies Page[];
`;

let projectDir: string;
let filename: string;
let exportedUrl: string;
let buildMs: number;
let bytes: number;
let gzipBytes: number;

test.beforeAll(async ({ browserName }) => {
  projectDir = prepareScratchProject(`standalone-${browserName}`);
  const entry = slideSourcePath('playable', projectDir);
  await fs.mkdir(path.dirname(entry), { recursive: true });
  await Promise.all([
    fs.writeFile(entry, source),
    fs.writeFile(path.join(path.dirname(entry), 'badge.png'), TINY_PNG),
    fs.writeFile(
      path.join(path.dirname(entry), 'lazy.ts'),
      'export const message = "</script></style>";',
    ),
    fs.writeFile(
      path.join(path.dirname(entry), 'motion.css'),
      `
      .export-badge { background-image: url('./badge.png'); }
      @keyframes offline-entry { from { opacity: 0 } to { opacity: 1 } }
      .entrance { animation: offline-entry 20s linear; }
    `,
    ),
    fs.writeFile(
      slideSourcePath('alpha', projectDir),
      "throw new Error('Unrelated deck must be excluded');",
    ),
  ]);
  const started = performance.now();
  const result = await runCli(['export', 'playable'], projectDir);
  buildMs = performance.now() - started;
  expect(result.code, result.stdout + result.stderr).toBe(0);
  filename = path.join(projectDir, 'playable.html');
  const data = await fs.readFile(filename);
  expect(data.toString()).toContain('Copyright (c) 2026 Yiwei Ho');
  expect(data.toString()).not.toContain('Unrelated deck must be excluded');
  bytes = data.length;
  gzipBytes = gzipSync(data).length;

  const portableDir = await fs.mkdtemp(path.join(projectDir, 'portable-'));
  const portableFile = path.join(portableDir, 'renamed deck.html');
  await fs.rename(filename, portableFile);
  expect(await fs.readdir(portableDir)).toEqual(['renamed deck.html']);
  exportedUrl = pathToFileURL(portableFile).href;
});

test.afterAll(async () => {
  if (projectDir) await fs.rm(projectDir, { recursive: true, force: true });
});

test.use({ offline: true, reducedMotion: 'no-preference' });

test('plays CSS and React animations, handlers, lazy imports and imported assets offline', async ({
  page,
  context,
}, info) => {
  const externalRequests: string[] = [];
  const errors: Error[] = [];
  context.on('request', (request) => {
    if (!request.url().startsWith('data:') && request.url() !== exportedUrl)
      externalRequests.push(request.url());
  });
  page.on('pageerror', (error) => errors.push(error));
  await page.addInitScript(() => {
    const observer = new MutationObserver(() => {
      if (!document.querySelector('[data-testid="first"]')) return;
      performance.mark('first-slide');
      observer.disconnect();
    });
    observer.observe(document, { subtree: true, childList: true });
  });
  const firstSlideMs: number[] = [];
  for (let i = 0; i < 5; i++) {
    await page.goto(exportedUrl);
    await expect(page.getByTestId('first')).toBeVisible();
    firstSlideMs.push(
      await page.evaluate(() => performance.getEntriesByName('first-slide')[0].startTime),
    );
  }
  await expect(page).toHaveTitle('Playable export');
  await expect(page.getByTestId('count')).toHaveText('42');
  await expect(page.getByTestId('entrance')).toHaveCSS('animation-name', 'offline-entry');
  await expect(page.getByTestId('asset')).toHaveJSProperty('naturalWidth', 1);
  await expect(page.getByTestId('css-asset')).toHaveCSS(
    'background-image',
    /^url\("data:image\/png/,
  );
  await expect
    .poll(() =>
      page.evaluate(async () => {
        await document.fonts.ready;
        return [...document.fonts].some(
          (font) => font.family.includes('Geist') && font.status === 'loaded',
        );
      }),
    )
    .toBe(true);
  await page.getByTestId('interactive').click();
  await expect(page.getByTestId('message')).toHaveText('</script></style>');
  expect(errors).toEqual([]);
  expect(externalRequests).toEqual([]);
  const timings = { buildMs, bytes, gzipBytes, firstSlideMs };
  await info.attach('performance', {
    body: JSON.stringify(timings),
    contentType: 'application/json',
  });
  console.info(info.project.name, timings);
});

test('replays steps, morph, enter/exit, reverse navigation and interruption', async ({ page }) => {
  await page.goto(exportedUrl);
  await expect(page.getByTestId('step')).toBeVisible();
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByTestId('step')).toBeHidden();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('step')).toBeVisible();
  await page.keyboard.press('ArrowRight');
  const morph = page.locator('[data-osd-morph-layer]');
  await expect(morph).toBeAttached();
  const layer = page.locator('[data-osd-dir="forward"]');
  await expect(layer).toBeAttached();
  const opacityFrames = await layer.evaluate((el) =>
    [...el.children].flatMap((child) =>
      child
        .getAnimations()
        .map((animation) =>
          (animation.effect as KeyframeEffect).getKeyframes().map((frame) => frame.opacity),
        ),
    ),
  );
  expect(opacityFrames).toEqual(
    expect.arrayContaining([
      [1, 1],
      [0, 1],
    ]),
  );
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('third')).toBeVisible();
  await expect(morph).toHaveCount(0);
  await expect(page.getByTestId('first')).toHaveCount(0);
  await page.keyboard.press('Home');
  await expect(page.locator('[data-osd-dir="backward"]')).toBeAttached();
  await expect(page.getByTestId('first')).toBeVisible();
});

test('honors reduced motion and supports presentation controls', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(exportedUrl);
  await expect(page.getByTestId('first')).toBeVisible();
  await page.keyboard.press('b');
  const blackout = page.locator('[data-osd-chrome] [aria-hidden].bg-black');
  await expect(blackout).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(blackout).toHaveCount(0);
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('second')).toBeVisible();
  await expect(page.getByTestId('first')).toHaveCount(0);
  await expect(page.locator('[data-osd-morph-layer]')).toHaveCount(0);
  await page.keyboard.press('End');
  await expect(page.getByTestId('third')).toBeVisible();
});

test('syncs a presenter popup with speaker notes and navigation from a local file', async ({
  page,
}) => {
  await page.goto(exportedUrl);
  await expect(page.getByTestId('first')).toBeVisible();
  const opened = page.waitForEvent('popup');
  await page.keyboard.press('p');
  const presenter = await opened;
  await expect(presenter.getByText('First speaker note')).toBeVisible();
  await presenter.keyboard.press('ArrowLeft');
  await expect(page.getByTestId('step')).toBeHidden();
  await presenter.keyboard.press('ArrowRight');
  await expect(page.getByTestId('step')).toBeVisible();
  await presenter.keyboard.press('ArrowRight');
  await expect(page.getByTestId('second')).toBeVisible();
  await expect(presenter.getByText('Second speaker note')).toBeVisible();
});

test('fails clearly for unknown decks without creating an artifact', async ({ browserName }) => {
  test.skip(browserName !== 'chromium', 'CLI behavior is browser independent');
  const result = await runCli(['export', 'no-such-deck', '-o', 'missing.html'], projectDir);
  expect(result.code).toBe(1);
  expect(result.stderr).toContain('Slide not found: no-such-deck');
  await expect(fs.stat(path.join(projectDir, 'missing.html'))).rejects.toMatchObject({
    code: 'ENOENT',
  });
});
