import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

export interface SkillEntry {
  name: string;
  path: string;
  description: string;
}

// Precomputed CRC32 table for fast checksum calculation
const CRC32_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC32_TABLE[i] = c >>> 0;
}

function calculateCrc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) {
    crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ buffer[i]) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

interface ZipFileEntry {
  name: string;
  data: Buffer;
}

/**
 * Creates a deterministic, standard ZIP archive buffer without external dependencies.
 */
export function createDeterministicZip(entries: ZipFileEntry[]): Buffer {
  // Sort entries alphabetically by name for deterministic ordering
  const sortedEntries = [...entries].sort((a, b) => a.name.localeCompare(b.name));

  const localFileChunks: Buffer[] = [];
  const centralDirChunks: Buffer[] = [];
  let offset = 0;

  // Normalized DOS time: 1980-01-01 00:00:00 -> 0x0021, 0x0000
  const dosTime = 0x0000;
  const dosDate = 0x0021;

  for (const entry of sortedEntries) {
    const uncompressed = entry.data;
    const crc = calculateCrc32(uncompressed);
    const compressed = zlib.deflateRawSync(uncompressed, { level: 9 });
    const nameBuffer = Buffer.from(entry.name.replace(/\\/g, '/'), 'utf-8');

    // Local file header (30 bytes + name length)
    const localHeader = Buffer.alloc(30 + nameBuffer.length);
    localHeader.writeUInt32LE(0x04034b50, 0); // Local header signature
    localHeader.writeUInt16LE(20, 4);         // Version needed to extract (2.0)
    localHeader.writeUInt16LE(0, 6);          // General purpose bit flag
    localHeader.writeUInt16LE(8, 8);          // Compression method (8 = Deflate)
    localHeader.writeUInt16LE(dosTime, 10);   // File modification time
    localHeader.writeUInt16LE(dosDate, 12);   // File modification date
    localHeader.writeUInt32LE(crc, 14);       // CRC-32
    localHeader.writeUInt32LE(compressed.length, 18);   // Compressed size
    localHeader.writeUInt32LE(uncompressed.length, 22); // Uncompressed size
    localHeader.writeUInt16LE(nameBuffer.length, 26);   // File name length
    localHeader.writeUInt16LE(0, 28);         // Extra field length
    nameBuffer.copy(localHeader, 30);

    localFileChunks.push(localHeader, compressed);

    // Central directory header (46 bytes + name length)
    const cdHeader = Buffer.alloc(46 + nameBuffer.length);
    cdHeader.writeUInt32LE(0x02014b50, 0);    // Central dir signature
    cdHeader.writeUInt16LE(20, 4);            // Version made by
    cdHeader.writeUInt16LE(20, 6);            // Version needed to extract
    cdHeader.writeUInt16LE(0, 8);             // General purpose bit flag
    cdHeader.writeUInt16LE(8, 10);            // Compression method
    cdHeader.writeUInt16LE(dosTime, 12);      // File modification time
    cdHeader.writeUInt16LE(dosDate, 14);      // File modification date
    cdHeader.writeUInt32LE(crc, 16);          // CRC-32
    cdHeader.writeUInt32LE(compressed.length, 20);   // Compressed size
    cdHeader.writeUInt32LE(uncompressed.length, 24); // Uncompressed size
    cdHeader.writeUInt16LE(nameBuffer.length, 28);   // File name length
    cdHeader.writeUInt16LE(0, 30);            // Extra field length
    cdHeader.writeUInt16LE(0, 32);            // File comment length
    cdHeader.writeUInt16LE(0, 34);            // Disk number start
    cdHeader.writeUInt16LE(0, 36);            // Internal file attributes
    cdHeader.writeUInt32LE(0, 38);            // External file attributes
    cdHeader.writeUInt32LE(offset, 42);       // Relative offset of local header
    nameBuffer.copy(cdHeader, 46);

    centralDirChunks.push(cdHeader);
    offset += localHeader.length + compressed.length;
  }

  const centralDirectoryOffset = offset;
  const centralDirectoryBuffer = Buffer.concat(centralDirChunks);
  const centralDirectorySize = centralDirectoryBuffer.length;

  // End of central directory record (22 bytes)
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // EOCD signature
  eocd.writeUInt16LE(0, 4);          // Disk number
  eocd.writeUInt16LE(0, 6);          // Disk with central dir
  eocd.writeUInt16LE(sortedEntries.length, 8);  // Entries on this disk
  eocd.writeUInt16LE(sortedEntries.length, 10); // Total entries
  eocd.writeUInt32LE(centralDirectorySize, 12); // Central dir size
  eocd.writeUInt32LE(centralDirectoryOffset, 16); // Central dir offset
  eocd.writeUInt16LE(0, 20);         // Comment length

  return Buffer.concat([...localFileChunks, centralDirectoryBuffer, eocd]);
}

export function parseIndexYaml(content: string): SkillEntry[] {
  const skills: SkillEntry[] = [];
  const lines = content.split(/\r?\n/);
  let currentSkill: Partial<SkillEntry> | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('- name:')) {
      if (currentSkill && currentSkill.name && currentSkill.path && currentSkill.description) {
        skills.push(currentSkill as SkillEntry);
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
    skills.push(currentSkill as SkillEntry);
  }

  return skills;
}

export async function getSkillFiles(skillDir: string, relativePrefix = ''): Promise<ZipFileEntry[]> {
  const entries: ZipFileEntry[] = [];
  const items = await fs.promises.readdir(skillDir, { withFileTypes: true });

  for (const item of items) {
    const itemPath = path.join(skillDir, item.name);
    const relativeName = relativePrefix ? `${relativePrefix}/${item.name}` : item.name;

    if (item.isDirectory()) {
      const subEntries = await getSkillFiles(itemPath, relativeName);
      entries.push(...subEntries);
    } else if (item.isFile()) {
      const data = await fs.promises.readFile(itemPath);
      entries.push({ name: relativeName, data });
    }
  }

  return entries;
}

export async function packSkill(skillName: string, options: { outDir?: string; silent?: boolean } = {}): Promise<{ zipPath: string; dirPath: string; fileCount: number }> {
  const outDir = options.outDir || path.join(rootDir, 'dist', 'skills');
  const skillSourceDir = path.join(rootDir, 'skills', skillName);

  if (!fs.existsSync(skillSourceDir)) {
    throw new Error(`Skill not found at: ${skillSourceDir}`);
  }

  const skillFile = path.join(skillSourceDir, 'SKILL.md');
  if (!fs.existsSync(skillFile)) {
    throw new Error(`SKILL.md missing in skill directory: ${skillSourceDir}`);
  }

  await fs.promises.mkdir(outDir, { recursive: true });

  // 1. Gather all files in skill directory
  const files = await getSkillFiles(skillSourceDir);

  // 2. Export clean standalone directory bundle: dist/skills/<skill-name>/
  const dirPath = path.join(outDir, skillName);
  await fs.promises.mkdir(dirPath, { recursive: true });
  for (const file of files) {
    const targetFilePath = path.join(dirPath, file.name);
    await fs.promises.mkdir(path.dirname(targetFilePath), { recursive: true });
    await fs.promises.writeFile(targetFilePath, file.data);
  }

  // 3. Create deterministic ZIP bundle: dist/skills/<skill-name>.zip
  const zipBuffer = createDeterministicZip(files);
  const zipPath = path.join(outDir, `${skillName}.zip`);
  await fs.promises.writeFile(zipPath, zipBuffer);

  if (!options.silent) {
    console.log(`  ✔ [${skillName}] -> ${path.relative(rootDir, zipPath)} (${files.length} file(s), ${zipBuffer.length} bytes)`);
  }

  return { zipPath, dirPath, fileCount: files.length };
}

export async function packAllSkills(options: { outDir?: string; silent?: boolean } = {}): Promise<number> {
  const indexPath = path.join(rootDir, 'skills', 'index.yaml');
  if (!fs.existsSync(indexPath)) {
    throw new Error(`Skills registry missing: ${indexPath}`);
  }

  const indexContent = await fs.promises.readFile(indexPath, 'utf-8');
  const skills = parseIndexYaml(indexContent);

  if (!options.silent) {
    console.log(`\x1b[35m=== Packaging ${skills.length} Agent Skill Bundles ===\x1b[0m\n`);
  }

  for (const skill of skills) {
    await packSkill(skill.name, options);
  }

  if (!options.silent) {
    console.log(`\n\x1b[32m✔ Successfully packaged all ${skills.length} skill bundles into dist/skills/\x1b[0m\n`);
  }

  return skills.length;
}

export async function listSkills(): Promise<void> {
  const indexPath = path.join(rootDir, 'skills', 'index.yaml');
  const indexContent = await fs.promises.readFile(indexPath, 'utf-8');
  const skills = parseIndexYaml(indexContent);

  console.log('\x1b[35m=== Canonical Agent Skills Registry ===\x1b[0m\n');
  console.log('NAME'.padEnd(18) + 'PATH'.padEnd(38) + 'DESCRIPTION');
  console.log('-'.repeat(90));

  for (const skill of skills) {
    console.log(`${skill.name.padEnd(18)}${skill.path.padEnd(38)}${skill.description}`);
  }
  console.log(`\nTotal: ${skills.length} skills\n`);
}

export async function showSkill(skillName: string): Promise<void> {
  const skillPath = path.join(rootDir, 'skills', skillName, 'SKILL.md');
  if (!fs.existsSync(skillPath)) {
    console.error(`\x1b[31m✖ Skill "${skillName}" not found at: ${skillPath}\x1b[0m`);
    process.exit(1);
  }

  const content = await fs.promises.readFile(skillPath, 'utf-8');
  console.log(`\x1b[35m=== Skill: ${skillName} (${skillPath}) ===\x1b[0m\n`);
  console.log(content);
}

// CLI entrypoint
async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--list') || args.includes('-l')) {
    await listSkills();
    return;
  }

  if (args.includes('--show') || args.includes('-s')) {
    const skillIndex = args.findIndex((a) => a === '--show' || a === '-s');
    const skillName = args[skillIndex + 1];
    if (!skillName) {
      console.error('Error: Please specify a skill name to show. Example: pnpm skills:show authentication');
      process.exit(1);
    }
    await showSkill(skillName);
    return;
  }

  if (args.includes('--export') || args.includes('-e')) {
    console.log('\x1b[35m=== Exporting Standalone Agent Skill Bundles ===\x1b[0m\n');
    await packAllSkills();
    return;
  }

  if (args.includes('--all') || args.includes('-a') || args.length === 0) {
    await packAllSkills();
    return;
  }

  const targetSkill = args.find((a) => !a.startsWith('-'));
  if (targetSkill) {
    console.log(`\x1b[35m=== Packaging Agent Skill: ${targetSkill} ===\x1b[0m\n`);
    await packSkill(targetSkill);
    console.log(`\n\x1b[32m✔ Skill "${targetSkill}" packaged successfully!\x1b[0m\n`);
    return;
  }

  console.log('Usage: pnpm skills:pack [skill-name | --all | --list | --show <name> | --export]');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error('\n\x1b[31m✖ Packaging failed:\x1b[0m', err.message || err);
    process.exit(1);
  });
}
