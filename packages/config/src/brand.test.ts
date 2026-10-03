import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AppConfig } from './app-config.js';
import { IamConfig } from './iam-config.js';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const oldBrand = /courtos/i;

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(tsx?|jsx?|json|css|svg|html|webmanifest)$/.test(entry.name) && !/\.(test|spec)\./.test(entry.name) ? [path] : [];
  });
}

describe('Baseline product branding (#57)', () => {
  it('keeps application identity and user-visible role descriptions on the Baseline brand', () => {
    expect(AppConfig.name).toBe('Baseline');
    expect(JSON.stringify(IamConfig)).not.toMatch(oldBrand);
  });

  it('prevents the old brand in web copy, fixtures, metadata and text assets', () => {
    const files = [...sourceFiles(join(root, 'apps/web/src')), ...sourceFiles(join(root, 'apps/web/public'))];
    const offenders = files.filter(path => oldBrand.test(readFileSync(path, 'utf8'))).map(path => relative(root, path));
    expect(offenders).toEqual([]);
  });
});
