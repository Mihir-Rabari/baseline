import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

interface DependencyInfo {
  name: string;
  version: string;
  type: 'prod' | 'dev';
  packageLocations: string[];
}

async function findPackageJsonFiles(dir: string): Promise<string[]> {
  const results: string[] = [];
  const entries = await fs.promises.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git' || entry.name === '.next') {
      continue;
    }
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const subResults = await findPackageJsonFiles(fullPath);
      results.push(...subResults);
    } else if (entry.isFile() && entry.name === 'package.json') {
      results.push(fullPath);
    }
  }

  return results;
}

export async function checkDependencies(): Promise<void> {
  console.log('\x1b[35m=== Inspecting Monorepo Dependency Inventory & Baselines ===\x1b[0m\n');

  const pkgFiles = await findPackageJsonFiles(rootDir);
  const depMap = new Map<string, DependencyInfo>();

  for (const pkgPath of pkgFiles) {
    const relPath = path.relative(rootDir, pkgPath);
    const content = JSON.parse(await fs.promises.readFile(pkgPath, 'utf-8'));

    const deps = content.dependencies || {};
    for (const [dep, ver] of Object.entries(deps)) {
      if (typeof ver !== 'string' || ver.startsWith('workspace:')) continue;
      const existing = depMap.get(dep);
      if (existing) {
        if (!existing.packageLocations.includes(relPath)) {
          existing.packageLocations.push(relPath);
        }
      } else {
        depMap.set(dep, { name: dep, version: ver, type: 'prod', packageLocations: [relPath] });
      }
    }

    const devDeps = content.devDependencies || {};
    for (const [dep, ver] of Object.entries(devDeps)) {
      if (typeof ver !== 'string' || ver.startsWith('workspace:')) continue;
      const existing = depMap.get(dep);
      if (existing) {
        if (!existing.packageLocations.includes(relPath)) {
          existing.packageLocations.push(relPath);
        }
      } else {
        depMap.set(dep, { name: dep, version: ver, type: 'dev', packageLocations: [relPath] });
      }
    }
  }

  console.log('PACKAGE'.padEnd(35) + 'VERSION'.padEnd(16) + 'TYPE'.padEnd(8) + 'CONSUMED IN');
  console.log('-'.repeat(90));

  const sorted = Array.from(depMap.values()).sort((a, b) => a.name.localeCompare(b.name));
  for (const dep of sorted) {
    const locSummary = dep.packageLocations.length <= 2
      ? dep.packageLocations.join(', ')
      : `${dep.packageLocations.slice(0, 2).join(', ')} (+${dep.packageLocations.length - 2} more)`;
    console.log(`${dep.name.padEnd(35)}${dep.version.padEnd(16)}${dep.type.padEnd(8)}${locSummary}`);
  }

  console.log(`\n\x1b[32m✔ Total direct external dependencies audited: ${sorted.length}\x1b[0m\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  checkDependencies().catch((err) => {
    console.error('\n\x1b[31m✖ Dependency check failed:\x1b[0m', err.message || err);
    process.exit(1);
  });
}
