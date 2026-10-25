import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

const SCRIPT_SET = {
  build: 'tsup',
  test: 'vitest run',
  dev: 'tsup --watch',
  clean: 'rm -rf dist',
};

const CORE_DEV_DEPENDENCIES = {
  tsup: '^8.0.0',
  typescript: '^5.3.0',
  vitest: '^4.0.0',
};

const SDK_DEV_DEPENDENCIES = {
  '@types/node': '^20.11.0',
  ...CORE_DEV_DEPENDENCIES,
};

export const RELEASE_PACKAGE_SPECS = [
  { directory: 'core', name: '@trinoris/agent-core', dependencies: {}, devDependencies: CORE_DEV_DEPENDENCIES },
  { directory: 'sdk', name: '@trinoris/agent-sdk', dependencies: { '@trinoris/agent-core': 'workspace:*' }, devDependencies: SDK_DEV_DEPENDENCIES },
  { directory: 'cli', name: '@trinoris/agent-cli', dependencies: { '@trinoris/agent-core': 'workspace:*', '@trinoris/agent-sdk': 'workspace:*' }, devDependencies: SDK_DEV_DEPENDENCIES },
];

const ROOT_SCRIPTS = {
  build: 'turbo run build',
  test: 'turbo run test',
  lint: 'turbo run lint',
  dev: 'turbo run dev --parallel',
  clean: 'turbo run clean && rm -rf node_modules',
  release: 'bash scripts/release.sh',
  'release:dry': 'bash scripts/release.sh --dry-run',
};

const ROOT_DEV_DEPENDENCIES = {
  turbo: '^1.11.0',
  typescript: '^5.3.0',
  vitest: '^4.0.0',
};
const ROOT_ENGINES = { node: '>=20.0.0', pnpm: '>=8.0.0' };

const ROOT_PACKAGE_KEYS = [
  'name', 'version', 'private', 'description', 'workspaces', 'scripts', 'devDependencies',
  'repository', 'bugs', 'homepage', 'packageManager', 'engines',
];
const PACKAGE_KEYS = [
  'name', 'version', 'description', 'type', 'main', 'module', 'types', 'exports', 'files',
  'scripts', 'dependencies', 'devDependencies', 'keywords', 'repository', 'bugs', 'homepage',
  'author', 'license', 'publishConfig', 'bin',
];

const EXPORTS = {
  '.': {
    types: './dist/index.d.ts',
    import: './dist/index.js',
    require: './dist/index.cjs',
  },
};
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

function readJson(path, errors) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    errors.push(`${path}: cannot read valid JSON (${error instanceof Error ? error.message : String(error)})`);
    return null;
  }
}

function expectEqual(actual, expected, label, errors) {
  if (!isDeepStrictEqual(actual, expected)) {
    errors.push(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

export function validatePackageManifest(pkg, spec, label = spec.name) {
  const errors = [];
  const unexpectedKeys = Object.keys(pkg).filter(key => !PACKAGE_KEYS.includes(key));
  if (unexpectedKeys.length) errors.push(`${label} has unexpected manifest fields: ${unexpectedKeys.join(', ')}`);
  if (typeof pkg.version !== 'string' || !SEMVER.test(pkg.version)) {
    errors.push(`${label} version must be a valid numeric semver version`);
  }
  expectEqual(pkg.name, spec.name, `${label} name`, errors);
  expectEqual(pkg.private ?? false, false, `${label} private`, errors);
  expectEqual(pkg.type, 'module', `${label} type`, errors);
  expectEqual(pkg.license, 'Apache-2.0', `${label} license`, errors);
  expectEqual(pkg.files, ['dist'], `${label} publish allow-list`, errors);
  expectEqual(pkg.scripts, SCRIPT_SET, `${label} scripts (unexpected build or lifecycle command)`, errors);
  expectEqual(pkg.dependencies ?? {}, spec.dependencies, `${label} runtime dependencies`, errors);
  expectEqual(pkg.devDependencies ?? {}, spec.devDependencies, `${label} development dependencies`, errors);
  expectEqual(pkg.publishConfig, { registry: 'https://registry.npmjs.org/', access: 'public' }, `${label} publish target`, errors);
  expectEqual(pkg.main, './dist/index.cjs', `${label} main entry`, errors);
  expectEqual(pkg.module, './dist/index.js', `${label} module entry`, errors);
  expectEqual(pkg.types, './dist/index.d.ts', `${label} type entry`, errors);
  expectEqual(pkg.exports, EXPORTS, `${label} exports`, errors);
  expectEqual(pkg.bin ?? {}, spec.directory === 'cli' ? { 'trinoris-agent': './dist/bin.js' } : {}, `${label} executable entry`, errors);
  return errors;
}

function validatePackage(root, spec, errors) {
  const path = join(root, 'packages', spec.directory, 'package.json');
  const pkg = readJson(path, errors);
  if (!pkg) return;
  errors.push(...validatePackageManifest(pkg, spec, path));
}

/**
 * Validate publish inputs before pnpm executes package scripts. Dependency resolution and
 * integrity hashes are separately verified by `pnpm install --frozen-lockfile`.
 */
export function validateReleaseInputs(root) {
  const errors = [];
  const rootPath = join(root, 'package.json');
  const rootPackage = readJson(rootPath, errors);
  if (rootPackage) {
    const unexpectedKeys = Object.keys(rootPackage).filter(key => !ROOT_PACKAGE_KEYS.includes(key));
    if (unexpectedKeys.length) errors.push(`${rootPath} has unexpected manifest fields: ${unexpectedKeys.join(', ')}`);
    expectEqual(rootPackage.name, 'trinoris-multi-agents', `${rootPath} name`, errors);
    expectEqual(rootPackage.private, true, `${rootPath} private`, errors);
    expectEqual(rootPackage.packageManager, 'pnpm@8.12.0', `${rootPath} packageManager`, errors);
    expectEqual(rootPackage.engines, ROOT_ENGINES, `${rootPath} engines`, errors);
    expectEqual(rootPackage.workspaces, ['packages/*'], `${rootPath} workspaces`, errors);
    expectEqual(rootPackage.scripts, ROOT_SCRIPTS, `${rootPath} scripts`, errors);
    expectEqual(rootPackage.devDependencies, ROOT_DEV_DEPENDENCIES, `${rootPath} development dependencies`, errors);
  }

  for (const spec of RELEASE_PACKAGE_SPECS) validatePackage(root, spec, errors);

  const lockPath = join(root, 'pnpm-lock.yaml');
  try {
    const lock = readFileSync(lockPath, 'utf8');
    if (!/^lockfileVersion:\s*'6\.0'\s*$/m.test(lock)) {
      errors.push(`${lockPath}: expected the reviewed pnpm lockfile format (6.0)`);
    }
    for (const spec of RELEASE_PACKAGE_SPECS) {
      if (!new RegExp(`^  packages/${spec.directory}:$`, 'm').test(lock)) {
        errors.push(`${lockPath}: missing importer packages/${spec.directory}`);
      }
    }
  } catch (error) {
    errors.push(`${lockPath}: cannot read lockfile (${error instanceof Error ? error.message : String(error)})`);
  }

  return errors;
}

const thisFile = fileURLToPath(import.meta.url);
const repoRoot = dirname(dirname(thisFile));
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === pathToFileURL(thisFile).href) {
  const errors = validateReleaseInputs(repoRoot);
  if (errors.length) {
    console.error('Release input integrity check failed:');
    for (const error of errors) console.error(`  - ${error}`);
    process.exitCode = 1;
  } else {
    console.log(`Release input integrity passed for ${RELEASE_PACKAGE_SPECS.length} packages.`);
  }
}
