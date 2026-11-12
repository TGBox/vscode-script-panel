import * as fs from 'fs/promises';
import * as path from 'path';
import {
  CustomConfigFileRule,
  CustomScriptConfig,
  NodeRunner,
  PythonRunner,
  ScriptGroupData,
  ScriptItemData,
} from './models';
import {
  parseCargoToml,
  parseCustomJsonConfigFile,
  parseGradleFile,
  parseJustfile,
  parseMakefile,
  parsePackageJson,
  parsePipfile,
  parsePomXml,
  parsePyprojectToml,
  parseVsCodeTasksJson,
} from './parsers';

export interface ScannerOptions {
  /** Maximum directory recursion depth (0 = root only) */
  maxDepth: number;
  /** Folder names to ignore during recursive traversal */
  excludeFolders: string[];
  /** Default Node.js runner when no lockfile is found */
  defaultNodeRunner: NodeRunner;
  /** Default Python runner when no lockfile/tool section is found */
  defaultPythonRunner: PythonRunner;
  /** User-defined custom commands from settings */
  customScripts: CustomScriptConfig[];
  /** User-defined custom config file rules from settings */
  customConfigFiles: CustomConfigFileRule[];
}

export const DEFAULT_EXCLUDED_FOLDERS = [
  'node_modules',
  '.git',
  '.venv',
  'venv',
  'env',
  '__pycache__',
  'target',
  'dist',
  'out',
  'build',
  '.gradle',
  '.next',
  '.nuxt',
  'coverage',
  '.vscode-test',
];

const MAKEFILE_NAMES = new Set(['Makefile', 'makefile', 'GNUmakefile']);
const JUSTFILE_NAMES = new Set(['Justfile', 'justfile', '.justfile']);
const GRADLE_NAMES = new Set(['build.gradle', 'build.gradle.kts']);

/**
 * Formats a clean group label relative to the workspace root.
 */
function formatGroupLabel(
  workspaceRoot: string,
  filePath: string,
  multiRootPrefix?: string
): string {
  const rel = path.relative(workspaceRoot, filePath).split(path.sep).join('/');
  return multiRootPrefix ? `${multiRootPrefix}/${rel}` : rel;
}

/**
 * Asynchronously scans workspace root directories for supported project configuration files
 * and returns grouped script definitions.
 */
export async function scanWorkspaceForScripts(
  workspaceRoots: Array<{ name: string; fsPath: string }>,
  options: ScannerOptions
): Promise<ScriptGroupData[]> {
  const groups: ScriptGroupData[] = [];
  const excludedSet = new Set(options.excludeFolders);
  const isMultiRoot = workspaceRoots.length > 1;

  for (const root of workspaceRoots) {
    const prefix = isMultiRoot ? root.name : undefined;
    const rootEntries = await readDirNamesSafe(root.fsPath);
    const rootGroups = await scanDirectoryRecursive(
      root.fsPath,
      root.fsPath,
      0,
      options,
      excludedSet,
      rootEntries,
      prefix
    );
    groups.push(...rootGroups);
  }

  // Append custom scripts defined directly in VS Code settings
  if (options.customScripts.length > 0 && workspaceRoots.length > 0) {
    const defaultRoot = workspaceRoots[0].fsPath;
    const customItems: ScriptItemData[] = [];

    for (const item of options.customScripts) {
      if (!item.name || !item.command) {
        continue;
      }
      const resolvedCwd = item.cwd
        ? path.isAbsolute(item.cwd)
          ? item.cwd
          : path.join(defaultRoot, item.cwd)
        : defaultRoot;

      customItems.push({
        id: `custom-setting::${item.name}`,
        name: item.name,
        detail: item.description ? `${item.description} (${item.command})` : item.command,
        executionCommand: item.command,
        cwd: resolvedCwd,
        sourceType: 'custom',
        runner: 'Terminal',
      });
    }

    if (customItems.length > 0) {
      groups.push({
        id: 'group::custom-settings',
        label: 'Eigene Befehle (Settings)',
        description: `${customItems.length} ${customItems.length === 1 ? 'Befehl' : 'Befehle'}`,
        sourceType: 'custom',
        cwd: defaultRoot,
        scripts: customItems,
      });
    }
  }

  return groups;
}

async function readDirNamesSafe(dirPath: string): Promise<Set<string>> {
  try {
    const items = await fs.readdir(dirPath);
    return new Set(items);
  } catch {
    return new Set();
  }
}

async function readFileSafe(filePath: string): Promise<string | undefined> {
  try {
    return await fs.readFile(filePath, 'utf-8');
  } catch {
    return undefined;
  }
}

async function scanDirectoryRecursive(
  workspaceRoot: string,
  currentDir: string,
  depth: number,
  options: ScannerOptions,
  excludedSet: Set<string>,
  rootEntries: Set<string>,
  multiRootPrefix?: string
): Promise<ScriptGroupData[]> {
  let dirEntries;
  try {
    dirEntries = await fs.readdir(currentDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const localNames = new Set(dirEntries.map((e) => e.name));
  // Combine local directory files with workspace root files so lockfiles/wrappers in monorepo root are also recognized
  const combinedLookup = new Set<string>([...rootEntries, ...localNames]);

  const groups: ScriptGroupData[] = [];

  // 1. Check package.json
  if (localNames.has('package.json')) {
    const configPath = path.join(currentDir, 'package.json');
    const content = await readFileSafe(configPath);
    if (content !== undefined) {
      const { runner, scripts } = parsePackageJson(
        content,
        configPath,
        currentDir,
        combinedLookup,
        options.defaultNodeRunner
      );
      if (scripts.length > 0) {
        groups.push({
          id: `group::${configPath}`,
          label: formatGroupLabel(workspaceRoot, configPath, multiRootPrefix),
          description: runner,
          sourceType: 'npm',
          configPath,
          cwd: currentDir,
          scripts,
        });
      }
    }
  }

  // 2. Check pyproject.toml
  if (localNames.has('pyproject.toml')) {
    const configPath = path.join(currentDir, 'pyproject.toml');
    const content = await readFileSafe(configPath);
    if (content !== undefined) {
      const { runner, scripts } = parsePyprojectToml(
        content,
        configPath,
        currentDir,
        combinedLookup,
        options.defaultPythonRunner
      );
      if (scripts.length > 0) {
        groups.push({
          id: `group::${configPath}`,
          label: formatGroupLabel(workspaceRoot, configPath, multiRootPrefix),
          description: runner,
          sourceType: 'python',
          configPath,
          cwd: currentDir,
          scripts,
        });
      }
    }
  }

  // 3. Check Pipfile
  if (localNames.has('Pipfile')) {
    const configPath = path.join(currentDir, 'Pipfile');
    const content = await readFileSafe(configPath);
    if (content !== undefined) {
      const scripts = parsePipfile(content, configPath, currentDir);
      if (scripts.length > 0) {
        groups.push({
          id: `group::${configPath}`,
          label: formatGroupLabel(workspaceRoot, configPath, multiRootPrefix),
          description: 'pipenv',
          sourceType: 'python',
          configPath,
          cwd: currentDir,
          scripts,
        });
      }
    }
  }

  // 4. Check Makefile
  for (const makeName of MAKEFILE_NAMES) {
    if (localNames.has(makeName)) {
      const configPath = path.join(currentDir, makeName);
      const content = await readFileSafe(configPath);
      if (content !== undefined) {
        const scripts = parseMakefile(content, configPath, currentDir);
        if (scripts.length > 0) {
          groups.push({
            id: `group::${configPath}`,
            label: formatGroupLabel(workspaceRoot, configPath, multiRootPrefix),
            description: 'make',
            sourceType: 'makefile',
            configPath,
            cwd: currentDir,
            scripts,
          });
        }
      }
      break;
    }
  }

  // 5. Check Justfile
  for (const justName of JUSTFILE_NAMES) {
    if (localNames.has(justName)) {
      const configPath = path.join(currentDir, justName);
      const content = await readFileSafe(configPath);
      if (content !== undefined) {
        const scripts = parseJustfile(content, configPath, currentDir);
        if (scripts.length > 0) {
          groups.push({
            id: `group::${configPath}`,
            label: formatGroupLabel(workspaceRoot, configPath, multiRootPrefix),
            description: 'just',
            sourceType: 'justfile',
            configPath,
            cwd: currentDir,
            scripts,
          });
        }
      }
      break;
    }
  }

  // 6. Check Cargo.toml
  if (localNames.has('Cargo.toml')) {
    const configPath = path.join(currentDir, 'Cargo.toml');
    const content = await readFileSafe(configPath);
    if (content !== undefined) {
      const scripts = parseCargoToml(content, configPath, currentDir);
      if (scripts.length > 0) {
        groups.push({
          id: `group::${configPath}`,
          label: formatGroupLabel(workspaceRoot, configPath, multiRootPrefix),
          description: 'cargo',
          sourceType: 'cargo',
          configPath,
          cwd: currentDir,
          scripts,
        });
      }
    }
  }

  // 7. Check Gradle (build.gradle / build.gradle.kts)
  for (const gradleName of GRADLE_NAMES) {
    if (localNames.has(gradleName)) {
      const configPath = path.join(currentDir, gradleName);
      const content = await readFileSafe(configPath);
      if (content !== undefined) {
        const scripts = parseGradleFile(content, configPath, currentDir, combinedLookup);
        if (scripts.length > 0) {
          groups.push({
            id: `group::${configPath}`,
            label: formatGroupLabel(workspaceRoot, configPath, multiRootPrefix),
            description: scripts[0].runner,
            sourceType: 'gradle',
            configPath,
            cwd: currentDir,
            scripts,
          });
        }
      }
      break;
    }
  }

  // 8. Check Maven (pom.xml)
  if (localNames.has('pom.xml')) {
    const configPath = path.join(currentDir, 'pom.xml');
    const content = await readFileSafe(configPath);
    if (content !== undefined) {
      const scripts = parsePomXml(content, configPath, currentDir, combinedLookup);
      if (scripts.length > 0) {
        groups.push({
          id: `group::${configPath}`,
          label: formatGroupLabel(workspaceRoot, configPath, multiRootPrefix),
          description: scripts[0].runner,
          sourceType: 'maven',
          configPath,
          cwd: currentDir,
          scripts,
        });
      }
    }
  }

  // 9. Check .vscode/tasks.json (at root or current directory)
  if (localNames.has('.vscode')) {
    const tasksPath = path.join(currentDir, '.vscode', 'tasks.json');
    const content = await readFileSafe(tasksPath);
    if (content !== undefined) {
      const scripts = parseVsCodeTasksJson(content, tasksPath, currentDir);
      if (scripts.length > 0) {
        groups.push({
          id: `group::${tasksPath}`,
          label: formatGroupLabel(workspaceRoot, tasksPath, multiRootPrefix),
          description: 'VS Code Tasks',
          sourceType: 'vscode-tasks',
          configPath: tasksPath,
          cwd: currentDir,
          scripts,
        });
      }
    }
  }

  // 10. Check custom config file rules from settings
  for (const rule of options.customConfigFiles) {
    if (rule.fileName && localNames.has(rule.fileName)) {
      const configPath = path.join(currentDir, rule.fileName);
      const content = await readFileSafe(configPath);
      if (content !== undefined) {
        const scripts = parseCustomJsonConfigFile(content, configPath, currentDir, rule);
        if (scripts.length > 0) {
          groups.push({
            id: `group::custom-file::${configPath}`,
            label: formatGroupLabel(workspaceRoot, configPath, multiRootPrefix),
            description: rule.runnerCommand || 'custom',
            sourceType: 'custom',
            configPath,
            cwd: currentDir,
            scripts,
          });
        }
      }
    }
  }

  // Recurse into subdirectories if below maxDepth
  if (depth < options.maxDepth) {
    const subDirs = dirEntries
      .filter(
        (entry) =>
          entry.isDirectory() &&
          !entry.name.startsWith('.') &&
          !excludedSet.has(entry.name)
      )
      .sort((a, b) => a.name.localeCompare(b.name));

    for (const subDir of subDirs) {
      const subPath = path.join(currentDir, subDir.name);
      const subGroups = await scanDirectoryRecursive(
        workspaceRoot,
        subPath,
        depth + 1,
        options,
        excludedSet,
        rootEntries,
        multiRootPrefix
      );
      groups.push(...subGroups);
    }
  }

  return groups;
}

