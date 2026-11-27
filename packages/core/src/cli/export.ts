import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { build, type Rolldown } from 'vite';
import { SLIDE_ID_RE } from '../editing/slide-ops.ts';
import { createViteConfig } from '../vite/config.ts';
import { createCliLogger, printHeader } from './ui.ts';

function scriptString(source: string): string {
  return JSON.stringify(source).replaceAll('<', '\\u003c');
}

function createHtml(files: Rolldown.OutputBundle[string][], license: string): string {
  let code: string | undefined;
  const styles: string[] = [];
  for (const file of files) {
    if (
      file.type === 'chunk' &&
      file.isEntry &&
      !code &&
      !file.imports.length &&
      file.dynamicImports.every((id) => id === file.fileName)
    ) {
      code = file.code;
    } else if (file.type === 'asset' && file.fileName.endsWith('.css')) {
      styles.push(String(file.source));
    } else {
      throw new Error(`Cannot embed standalone build output: ${file.fileName}`);
    }
  }
  if (!code) throw new Error('Standalone build did not generate a player');

  // Inline modules avoid parsing the whole bundle twice. HTML tokenizer
  // markers require embedding the code as a string to preserve its bytes.
  const player = /<\/script|<!--/i.test(code)
    ? `<script>
const player = document.createElement('script');
player.type = 'module';
player.textContent = ${scriptString(code)};
document.body.append(player);
</script>`
    : `<script type="module">${code}</script>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<!--
${license.trimEnd()}
-->
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" href="data:,">
<title>open-slide</title>
</head>
<body>
<div id="root"></div>
<script>
const styles = document.createElement('style');
styles.textContent = ${scriptString(styles.join('\n'))};
document.head.append(styles);
</script>
${player}
</body>
</html>
`;
}

export async function exportStandalone(slideId: string, output?: string): Promise<void> {
  if (!SLIDE_ID_RE.test(slideId)) throw new Error(`Invalid slide id: ${slideId}`);
  printHeader('exporting standalone HTML');
  const config = await createViteConfig({
    userCwd: process.cwd(),
    mode: 'build',
    standaloneSlide: slideId,
  });
  const appRoot = String(config.root);
  const license = await readFile(path.resolve(appRoot, '../../LICENSE'), 'utf8');
  const result = await build({
    ...config,
    base: './',
    publicDir: false,
    customLogger: createCliLogger(),
    build: {
      write: false,
      copyPublicDir: false,
      reportCompressedSize: false,
      assetsInlineLimit: Number.MAX_SAFE_INTEGER,
      cssCodeSplit: false,
      modulePreload: false,
      rolldownOptions: {
        input: path.join(appRoot, 'standalone.tsx'),
        output: { codeSplitting: false },
      },
    },
  });
  if (!('output' in result)) throw new Error('Expected a single standalone build');
  const html = createHtml(result.output, license);
  await writeFile(output ?? `${slideId}.html`, html);
}
