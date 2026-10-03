import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import postcss from 'postcss';

const css = postcss.parse(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../app/globals.css'), 'utf8'));

describe('shared scrollbar theme (#58)', () => {
  it('reserves the root gutter and leaves scrollbars available in nested scrolling areas', () => {
    const rootRules: Record<string, string> = {};
    css.walkRules('html', rule => { rule.walkDecls(decl => { rootRules[decl.prop] = decl.value; }); });
    expect(rootRules['scrollbar-gutter']).toBe('stable');
    const values: string[] = [];
    css.walkDecls('scrollbar-width', decl => { values.push(decl.value); });
    expect(values).toContain('thin');
    expect(values).not.toContain('none');
  });
  it('uses existing theme tokens for both scrollbar implementations and restores system colors in forced-color mode', () => {
    const colors: string[] = [];
    css.walkDecls('scrollbar-color', decl => { colors.push(decl.value); });
    expect(colors).toContain('hsl(var(--muted-foreground)) hsl(var(--background))');
    let thumb = '';
    css.walkRules('*::-webkit-scrollbar-thumb', rule => { rule.walkDecls('background', decl => { thumb = decl.value; }); });
    expect(thumb).toBe('hsl(var(--muted-foreground))');
    let systemColors = false;
    css.walkAtRules('media', rule => {
      if (rule.params === '(forced-colors: active)') rule.walkDecls('scrollbar-color', decl => { systemColors = decl.value === 'auto'; });
    });
    expect(systemColors).toBe(true);
  });
});
