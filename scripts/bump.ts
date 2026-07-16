import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

const packagePath = 'package.json';

type ReleaseType = 'major' | 'minor' | 'patch';
type PackageJson = {
  name: string;
  version: string;
};

const releaseType = process.argv[2] as ReleaseType | undefined;

if (!releaseType || !['major', 'minor', 'patch'].includes(releaseType)) {
  throw new Error('Usage: bun scripts/bump.ts <major|minor|patch>');
}

const readPackage = (packagePath: string): PackageJson =>
  JSON.parse(readFileSync(join(process.cwd(), packagePath), 'utf8')) as PackageJson;

const pkg = readPackage(packagePath);
const versionParts = pkg.version.split('.').map(Number);

if (versionParts.length !== 3 || versionParts.some((part) => Number.isNaN(part))) {
  throw new Error('Invalid version in package.json');
}

const [major, minor, patch] = versionParts as [number, number, number];

const nextVersion = {
  major: `${major + 1}.0.0`,
  minor: `${major}.${minor + 1}.0`,
  patch: `${major}.${minor}.${patch + 1}`,
}[releaseType];

pkg.version = nextVersion;
writeFileSync(join(process.cwd(), packagePath), `${JSON.stringify(pkg, null, 2)}\n`);

if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `version=${nextVersion}\n`);
}

process.stdout.write(`${nextVersion}\n`);
