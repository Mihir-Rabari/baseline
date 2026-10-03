import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

export interface SkillIndexEntry {
  name: string;
  path: string;
  description: string;
}

export function parseYamlFrontmatter(content: string): { frontmatter: Record<string, string>; body: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) {
    throw new Error('Missing or invalid YAML frontmatter delimiters (---)');
  }

  const rawYaml = match[1];
  const body = match[2];
  const frontmatter: Record<string, string> = {};

  const lines = rawYaml.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) continue;
    const key = trimmed.slice(0, colonIdx).trim();
    let val = trimmed.slice(colonIdx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    frontmatter[key] = val;
  }

  return { frontmatter, body };
}

export function parseIndexYaml(content: string): SkillIndexEntry[] {
  const skills: SkillIndexEntry[] = [];
  const lines = content.split(/\r?\n/);
  let currentSkill: Partial<SkillIndexEntry> | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('- name:')) {
      if (currentSkill && currentSkill.name && currentSkill.path && currentSkill.description) {
        skills.push(currentSkill as SkillIndexEntry);
      }
      currentSkill = {
        name: trimmed.replace('- name:', '').trim(),
      };
    } else if (trimmed.startsWith('path:') && currentSkill) {
      currentSkill.path = trimmed.replace('path:', '').trim();
    } else if (trimmed.startsWith('description:') && currentSkill) {
      let desc = trimmed.replace('description:', '').trim();
      if ((desc.startsWith('"') && desc.endsWith('"')) || (desc.startsWith("'") && desc.endsWith("'"))) {
        desc = desc.slice(1, -1);
      }
      currentSkill.description = desc;
    }
  }

  if (currentSkill && currentSkill.name && currentSkill.path && currentSkill.description) {
    skills.push(currentSkill as SkillIndexEntry);
  }

  return skills;
}

export async function validateSkills(options: { isLint?: boolean } = {}): Promise<SkillIndexEntry[]> {
  const mode = options.isLint ? 'Linting' : 'Validating';
  console.log(`\x1b[35m=== ${mode} Agent Skills & Discovery Registry ===\x1b[0m\n`);

  const indexPath = path.join(rootDir, 'skills', 'index.yaml');
  if (!fs.existsSync(indexPath)) {
    throw new Error(`Missing skills registry: ${indexPath}`);
  }

  const indexContent = await fs.promises.readFile(indexPath, 'utf-8');
  const skills = parseIndexYaml(indexContent);

  if (skills.length === 0) {
    throw new Error('skills/index.yaml contains zero valid skill definitions.');
  }

  console.log(`[Skills Check] 📋 Found ${skills.length} skills in skills/index.yaml\n`);

  const seenNames = new Set<string>();
  const winUserPrefix = ['C:', '\\', 'Users', '\\'].join('');
  const devProjectPrefix = ['K:', '\\', 'Projects', '\\', 'create-odoo-app'].join('');

  for (const skill of skills) {
    // 1. Check Name format
    if (!skill.name || !/^[a-z0-9-]+$/.test(skill.name)) {
      throw new Error(`Invalid skill name format in index.yaml: "${skill.name}". Must be lowercase alphanumeric.`);
    }

    if (seenNames.has(skill.name)) {
      throw new Error(`Duplicate skill name detected in index.yaml: "${skill.name}"`);
    }
    seenNames.add(skill.name);

    // 2. Check Path Exists
    const skillFullPath = path.join(rootDir, skill.path);
    if (!fs.existsSync(skillFullPath)) {
      throw new Error(`Skill file not found: ${skill.path} (resolved: ${skillFullPath})`);
    }

    const dirName = path.basename(path.dirname(skillFullPath));
    if (dirName !== skill.name) {
      throw new Error(`Skill directory name "${dirName}" does not match skill name "${skill.name}" in ${skill.path}`);
    }

    // 3. Read & Parse SKILL.md
    const content = await fs.promises.readFile(skillFullPath, 'utf-8');
    if (content.trim().length === 0) {
      throw new Error(`Skill file is empty: ${skill.path}`);
    }

    const { frontmatter, body } = parseYamlFrontmatter(content);

    if (!frontmatter.name) {
      throw new Error(`Missing required "name" in frontmatter of ${skill.path}`);
    }

    if (frontmatter.name !== skill.name) {
      throw new Error(
        `Frontmatter name "${frontmatter.name}" does not match index.yaml name "${skill.name}" in ${skill.path}`
      );
    }

    if (!frontmatter.description) {
      throw new Error(`Missing required "description" in frontmatter of ${skill.path}`);
    }

    if (!body || body.trim().length === 0) {
      throw new Error(`Skill body is empty in ${skill.path}`);
    }

    // 4. Structural Heading Check
    if (!body.includes('# ') || !body.includes('## ')) {
      throw new Error(`Skill document in ${skill.path} must contain standard markdown headings (# and ##)`);
    }

    // 5. Check for Leaked Local Machine Paths
    if (content.includes(winUserPrefix) || content.includes(devProjectPrefix)) {
      throw new Error(`LEAK DETECTED: Hardcoded developer paths found in ${skill.path}`);
    }

    console.log(`  ✔ [${skill.name}] ${skill.path} (valid)`);
  }

  const pastVerb = options.isLint ? 'linted' : 'verified';
  console.log(`\n\x1b[32m✔ All ${skills.length} Agent Skills successfully ${pastVerb} and valid!\x1b[0m\n`);
  return skills;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const isLint = process.argv.includes('--lint');
  validateSkills({ isLint }).catch((err) => {
    console.error('\n\x1b[31m✖ Skills validation failed:\x1b[0m', err.message || err);
    process.exit(1);
  });
}
