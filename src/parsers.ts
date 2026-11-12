import {
  CustomConfigFileRule,
  NodeRunner,
  PythonRunner,
  ScriptItemData,
} from './models';

/**
 * Strips single-line (//) and multi-line (/* *\/) comments and trailing commas from JSONC content.
 */
export function stripJsonComments(content: string): string {
  let result = '';
  let inString = false;
  let stringChar = '';
  let i = 0;

  while (i < content.length) {
    const ch = content[i];
    const next = content[i + 1];

    if (inString) {
      result += ch;
      if (ch === '\\' && i + 1 < content.length) {
        result += content[i + 1];
        i += 2;
        continue;
      }
      if (ch === stringChar) {
        inString = false;
      }
      i++;
      continue;
    }

    if (ch === '"') {
      inString = true;
      stringChar = ch;
      result += ch;
      i++;
      continue;
    }

    // Single-line comment
    if (ch === '/' && next === '/') {
      while (i < content.length && content[i] !== '\n') {
        i++;
      }
      continue;
    }

    // Multi-line comment
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < content.length && !(content[i] === '*' && content[i + 1] === '/')) {
        if (content[i] === '\n') {
          result += '\n';
        }
        i++;
      }
      i += 2;
      continue;
    }

    result += ch;
    i++;
  }

  // Remove trailing commas before } or ]
  return result.replace(/,\s*([}\]])/g, '$1');
}

/**
 * Finds the 1-based line number of a key or pattern in text lines, optionally starting from a given line index.
 */
export function findLineNumber(
  lines: string[],
  matcher: (line: string) => boolean,
  startIndex = 0
): number {
  for (let i = startIndex; i < lines.length; i++) {
    if (matcher(lines[i])) {
      return i + 1;
    }
  }
  return 1;
}

/**
 * Escapes special regex characters in a literal string.
 */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Detects the appropriate Node.js package manager based on package.json fields, lockfiles, and fallback setting.
 */
export function detectNodeRunner(
  existingFiles: Set<string>,
  packageManagerField?: string,
  fallbackRunner: NodeRunner = 'npm'
): NodeRunner {
  if (typeof packageManagerField === 'string') {
    const normalized = packageManagerField.trim().toLowerCase();
    if (normalized.startsWith('pnpm')) return 'pnpm';
    if (normalized.startsWith('yarn')) return 'yarn';
    if (normalized.startsWith('bun')) return 'bun';
    if (normalized.startsWith('npm')) return 'npm';
  }

  if (existingFiles.has('pnpm-lock.yaml')) return 'pnpm';
  if (existingFiles.has('yarn.lock')) return 'yarn';
  if (existingFiles.has('bun.lockb') || existingFiles.has('bun.lock')) return 'bun';
  if (existingFiles.has('package-lock.json') || existingFiles.has('npm-shrinkwrap.json')) {
    return 'npm';
  }

  return fallbackRunner;
}

/**
 * Builds the shell command to run a Node.js script with the chosen runner.
 */
export function buildNodeExecutionCommand(runner: NodeRunner, scriptName: string): string {
  const needsQuotes = /\s/.test(scriptName);
  const safeName = needsQuotes ? `"${scriptName}"` : scriptName;
  return `${runner} run ${safeName}`;
}

/**
 * Parses scripts from a package.json file.
 */
export function parsePackageJson(
  content: string,
  configPath: string,
  cwd: string,
  existingFiles: Set<string>,
  fallbackRunner: NodeRunner = 'npm'
): { runner: NodeRunner; scripts: ScriptItemData[] } {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(stripJsonComments(content)) as Record<string, unknown>;
  } catch {
    return { runner: fallbackRunner, scripts: [] };
  }

  const packageManagerField =
    typeof parsed.packageManager === 'string' ? parsed.packageManager : undefined;
  const runner = detectNodeRunner(existingFiles, packageManagerField, fallbackRunner);

  const rawScripts = parsed.scripts;
  if (!rawScripts || typeof rawScripts !== 'object' || Array.isArray(rawScripts)) {
    return { runner, scripts: [] };
  }

  const lines = content.split(/\r?\n/);
  const scriptsSectionStart = lines.findIndex((line) => /"scripts"\s*:/.test(line));
  const searchStart = scriptsSectionStart >= 0 ? scriptsSectionStart : 0;

  const scripts: ScriptItemData[] = [];
  for (const [name, value] of Object.entries(rawScripts as Record<string, unknown>)) {
    if (typeof value !== 'string') {
      continue;
    }

    const keyRegex = new RegExp(`"${escapeRegExp(name)}"\\s*:`);
    const lineNumber = findLineNumber(lines, (line) => keyRegex.test(line), searchStart);

    scripts.push({
      id: `${configPath}::${name}`,
      name,
      detail: value,
      executionCommand: buildNodeExecutionCommand(runner, name),
      cwd,
      configPath,
      lineNumber,
      sourceType: 'npm',
      runner,
    });
  }

  return { runner, scripts };
}

/**
 * Detects the appropriate Python runner based on lockfiles, pyproject.toml sections, and fallback setting.
 */
export function detectPythonRunner(
  content: string,
  existingFiles: Set<string>,
  fallbackRunner: PythonRunner = 'python'
): PythonRunner {
  if (existingFiles.has('poetry.lock') || /\[tool\.poetry(\.|\])/.test(content)) {
    return 'poetry';
  }
  if (existingFiles.has('pdm.lock') || /\[tool\.pdm(\.|\])/.test(content)) {
    return 'pdm';
  }
  if (existingFiles.has('uv.lock') || /\[tool\.uv(\.|\])/.test(content)) {
    return 'uv';
  }
  if (existingFiles.has('Pipfile.lock') || existingFiles.has('Pipfile')) {
    return 'pipenv';
  }
  if (/\[tool\.hatch(\.|\])/.test(content)) {
    return 'hatch';
  }
  return fallbackRunner;
}

/**
 * Extracts key-value pairs under specific TOML table headers, along with their 1-based line numbers.
 */
function extractTomlTableEntries(
  content: string,
  targetHeaders: Set<string>
): Array<{ header: string; key: string; value: string; lineNumber: number }> {
  const lines = content.split(/\r?\n/);
  let currentHeader = '';
  const entries: Array<{ header: string; key: string; value: string; lineNumber: number }> = [];

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();

    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const headerMatch = trimmed.match(/^\[([^\]]+)\]/);
    if (headerMatch) {
      currentHeader = headerMatch[1].trim();
      continue;
    }

    if (!targetHeaders.has(currentHeader)) {
      continue;
    }

    const kvMatch = trimmed.match(/^([A-Za-z0-9_.-]+|"[^"]+"|'[^']+')\s*=\s*(.+)$/);
    if (kvMatch) {
      const rawKey = kvMatch[1].replace(/^['"]|['"]$/g, '');
      let rawValue = kvMatch[2].trim();
      // Remove inline comment if not inside quotes
      if (rawValue.startsWith('"') || rawValue.startsWith("'")) {
        const quote = rawValue[0];
        const endQuoteIdx = rawValue.indexOf(quote, 1);
        if (endQuoteIdx > 0) {
          rawValue = rawValue.slice(1, endQuoteIdx);
        }
      } else if (rawValue.startsWith('{')) {
        // Inline table e.g. { cmd = "pytest", help = "Run tests" }
        const cmdMatch = rawValue.match(/(?:cmd|shell|call)\s*=\s*["']([^"']+)["']/);
        if (cmdMatch) {
          rawValue = cmdMatch[1];
        }
      }
      entries.push({
        header: currentHeader,
        key: rawKey,
        value: rawValue,
        lineNumber: i + 1,
      });
    }
  }

  return entries;
}

/**
 * Parses scripts and tasks from a pyproject.toml file.
 */
export function parsePyprojectToml(
  content: string,
  configPath: string,
  cwd: string,
  existingFiles: Set<string>,
  fallbackRunner: PythonRunner = 'python'
): { runner: string; scripts: ScriptItemData[] } {
  const detectedRunner = detectPythonRunner(content, existingFiles, fallbackRunner);
  const targetHeaders = new Set([
    'project.scripts',
    'tool.poetry.scripts',
    'tool.pdm.scripts',
    'tool.taskipy.tasks',
    'tool.poe.tasks',
    'tool.hatch.envs.default.scripts',
  ]);

  const entries = extractTomlTableEntries(content, targetHeaders);
  const scripts: ScriptItemData[] = [];

  for (const entry of entries) {
    let executionCommand: string;
    let runnerLabel: string = detectedRunner;

    if (entry.header === 'tool.pdm.scripts') {
      runnerLabel = 'pdm';
      executionCommand = `pdm run ${entry.key}`;
    } else if (entry.header === 'tool.poetry.scripts') {
      runnerLabel = 'poetry';
      executionCommand = `poetry run ${entry.key}`;
    } else if (entry.header === 'tool.taskipy.tasks') {
      const prefix =
        detectedRunner === 'poetry'
          ? 'poetry run task'
          : detectedRunner === 'pdm'
            ? 'pdm run task'
            : detectedRunner === 'uv'
              ? 'uv run task'
              : 'task';
      executionCommand = `${prefix} ${entry.key}`;
    } else if (entry.header === 'tool.poe.tasks') {
      const prefix =
        detectedRunner === 'poetry'
          ? 'poetry run poe'
          : detectedRunner === 'pdm'
            ? 'pdm run poe'
            : detectedRunner === 'uv'
              ? 'uv run poe'
              : 'poe';
      executionCommand = `${prefix} ${entry.key}`;
    } else if (entry.header === 'tool.hatch.envs.default.scripts') {
      runnerLabel = 'hatch';
      executionCommand = `hatch run ${entry.key}`;
    } else {
      // [project.scripts]
      if (detectedRunner === 'uv') {
        executionCommand = `uv run ${entry.key}`;
      } else if (detectedRunner === 'poetry') {
        executionCommand = `poetry run ${entry.key}`;
      } else if (detectedRunner === 'pdm') {
        executionCommand = `pdm run ${entry.key}`;
      } else if (detectedRunner === 'pipenv') {
        executionCommand = `pipenv run ${entry.key}`;
      } else if (detectedRunner === 'hatch') {
        executionCommand = `hatch run ${entry.key}`;
      } else {
        executionCommand = entry.key;
      }
    }

    scripts.push({
      id: `${configPath}::${entry.header}::${entry.key}`,
      name: entry.key,
      detail: entry.value,
      executionCommand,
      cwd,
      configPath,
      lineNumber: entry.lineNumber,
      sourceType: 'python',
      runner: runnerLabel,
    });
  }

  return { runner: detectedRunner, scripts };
}

/**
 * Parses scripts from a Pipfile ([scripts] section).
 */
export function parsePipfile(
  content: string,
  configPath: string,
  cwd: string
): ScriptItemData[] {
  const entries = extractTomlTableEntries(content, new Set(['scripts']));
  return entries.map((entry) => ({
    id: `${configPath}::${entry.key}`,
    name: entry.key,
    detail: entry.value,
    executionCommand: `pipenv run ${entry.key}`,
    cwd,
    configPath,
    lineNumber: entry.lineNumber,
    sourceType: 'python',
    runner: 'pipenv',
  }));
}

/**
 * Parses targets from a Makefile.
 */
export function parseMakefile(
  content: string,
  configPath: string,
  cwd: string
): ScriptItemData[] {
  const lines = content.split(/\r?\n/);
  const scripts: ScriptItemData[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line || line.startsWith('\t') || line.trim().startsWith('#')) {
      continue;
    }

    // Match target definitions: target1 target2: prerequisites (excluding :=, ::=, +=, ?=)
    const match = line.match(/^([A-Za-z0-9_./-]+(?:\s+[A-Za-z0-9_./-]+)*)\s*:([^=]|$)/);
    if (!match) {
      continue;
    }

    const targetNames = match[1].trim().split(/\s+/);
    const restOfLine = line.slice(line.indexOf(':') + 1).trim();

    for (const target of targetNames) {
      if (target.startsWith('.') || target.includes('%') || seen.has(target)) {
        continue;
      }
      seen.add(target);

      // Look ahead for the first recipe line or comment
      let detail = restOfLine ? `Abhängigkeiten: ${restOfLine}` : 'Make-Target';
      if (i + 1 < lines.length && lines[i + 1].startsWith('\t')) {
        detail = lines[i + 1].trim().replace(/^@/, '');
      }

      scripts.push({
        id: `${configPath}::${target}`,
        name: target,
        detail,
        executionCommand: `make ${target}`,
        cwd,
        configPath,
        lineNumber: i + 1,
        sourceType: 'makefile',
        runner: 'make',
      });
    }
  }

  return scripts;
}

/**
 * Parses recipes from a Justfile.
 */
export function parseJustfile(
  content: string,
  configPath: string,
  cwd: string
): ScriptItemData[] {
  const lines = content.split(/\r?\n/);
  const scripts: ScriptItemData[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line || /^\s/.test(line) || line.trim().startsWith('#') || line.trim().startsWith('[')) {
      continue;
    }

    // Ignore variable assignments (name := value) and settings/aliases (set ..., alias ..., import ..., mod ...)
    if (/^[A-Za-z0-9_-]+\s*:=/.test(line) || /^(set|alias|import|mod|export)\s+/.test(line)) {
      continue;
    }

    const match = line.match(/^@?([A-Za-z_][A-Za-z0-9_-]*)(?:\s+[^:]*)?\s*:([^=]|$)/);
    if (!match) {
      continue;
    }

    const recipeName = match[1];
    if (seen.has(recipeName)) {
      continue;
    }
    seen.add(recipeName);

    let detail = 'Just-Rezept';
    if (i > 0 && lines[i - 1].trim().startsWith('#')) {
      detail = lines[i - 1].trim().replace(/^#+\s*/, '');
    } else if (i + 1 < lines.length && /^\s+/.test(lines[i + 1])) {
      detail = lines[i + 1].trim().replace(/^@/, '');
    }

    scripts.push({
      id: `${configPath}::${recipeName}`,
      name: recipeName,
      detail,
      executionCommand: `just ${recipeName}`,
      cwd,
      configPath,
      lineNumber: i + 1,
      sourceType: 'justfile',
      runner: 'just',
    });
  }

  return scripts;
}

/**
 * Parses Cargo.toml for standard Rust lifecycle commands and custom metadata scripts.
 */
export function parseCargoToml(
  content: string,
  configPath: string,
  cwd: string
): ScriptItemData[] {
  const lines = content.split(/\r?\n/);
  const hasPackageOrWorkspace = lines.some((line) =>
    /^\s*\[(package|workspace)\]/.test(line)
  );
  if (!hasPackageOrWorkspace) {
    return [];
  }

  const packageLine = findLineNumber(lines, (line) => /^\s*\[(package|workspace)\]/.test(line));
  const standardCommands: Array<{ name: string; args: string; detail: string }> = [
    { name: 'build', args: 'build', detail: 'Projekt kompilieren (cargo build)' },
    { name: 'run', args: 'run', detail: 'Projekt kompilieren und ausführen (cargo run)' },
    { name: 'test', args: 'test', detail: 'Tests ausführen (cargo test)' },
    { name: 'check', args: 'check', detail: 'Auf Kompilierfehler prüfen (cargo check)' },
    { name: 'clippy', args: 'clippy', detail: 'Linter-Analyse ausführen (cargo clippy)' },
    { name: 'clean', args: 'clean', detail: 'Build-Artefakte bereinigen (cargo clean)' },
  ];

  const scripts: ScriptItemData[] = standardCommands.map((cmd) => ({
    id: `${configPath}::std::${cmd.name}`,
    name: cmd.name,
    detail: cmd.detail,
    executionCommand: `cargo ${cmd.args}`,
    cwd,
    configPath,
    lineNumber: packageLine,
    sourceType: 'cargo',
    runner: 'cargo',
  }));

  // Also parse [package.metadata.scripts] or [workspace.metadata.scripts] if defined
  const customEntries = extractTomlTableEntries(
    content,
    new Set(['package.metadata.scripts', 'workspace.metadata.scripts'])
  );

  for (const entry of customEntries) {
    scripts.push({
      id: `${configPath}::custom::${entry.key}`,
      name: entry.key,
      detail: entry.value,
      executionCommand: entry.value,
      cwd,
      configPath,
      lineNumber: entry.lineNumber,
      sourceType: 'cargo',
      runner: 'cargo',
    });
  }

  return scripts;
}

/**
 * Parses build.gradle / build.gradle.kts for standard Gradle lifecycle tasks and explicit task declarations.
 */
export function parseGradleFile(
  content: string,
  configPath: string,
  cwd: string,
  existingFiles: Set<string>,
  isWindows = process.platform === 'win32'
): ScriptItemData[] {
  const hasWrapper =
    existingFiles.has('gradlew') || existingFiles.has('gradlew.bat');
  const runnerCmd = hasWrapper ? (isWindows ? '.\\gradlew.bat' : './gradlew') : 'gradle';
  const runnerLabel = hasWrapper ? 'gradlew' : 'gradle';

  const standardTasks: Array<{ name: string; detail: string }> = [
    { name: 'build', detail: 'Projekt bauen und testen' },
    { name: 'run', detail: 'Anwendung starten' },
    { name: 'test', detail: 'Unit-Tests ausführen' },
    { name: 'check', detail: 'Alle Prüfungen ausführen' },
    { name: 'clean', detail: 'Build-Verzeichnis bereinigen' },
  ];

  const scripts: ScriptItemData[] = standardTasks.map((task) => ({
    id: `${configPath}::std::${task.name}`,
    name: task.name,
    detail: task.detail,
    executionCommand: `${runnerCmd} ${task.name}`,
    cwd,
    configPath,
    lineNumber: 1,
    sourceType: 'gradle',
    runner: runnerLabel,
  }));

  const seen = new Set(standardTasks.map((t) => t.name));
  const lines = content.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('//') || line.startsWith('/*')) {
      continue;
    }

    // Match Groovy/Kotlin task definitions:
    // task myTask / task('myTask') / tasks.register('myTask') / tasks.register<Type>("myTask") / tasks.create("myTask")
    const match =
      line.match(/^task\s+([A-Za-z0-9_-]+)\s*(\(|\{|$)/) ||
      line.match(/^task\s*\(\s*['"]([A-Za-z0-9_-]+)['"]/) ||
      line.match(/tasks\.(?:register|create)(?:<[^>]+>)?\s*\(\s*['"]([A-Za-z0-9_-]+)['"]/);

    if (match) {
      const taskName = match[1];
      if (!seen.has(taskName)) {
        seen.add(taskName);
        scripts.push({
          id: `${configPath}::custom::${taskName}`,
          name: taskName,
          detail: 'Benutzerdefinierter Gradle-Task',
          executionCommand: `${runnerCmd} ${taskName}`,
          cwd,
          configPath,
          lineNumber: i + 1,
          sourceType: 'gradle',
          runner: runnerLabel,
        });
      }
    }
  }

  return scripts;
}

/**
 * Parses pom.xml for standard Maven lifecycle phases.
 */
export function parsePomXml(
  content: string,
  configPath: string,
  cwd: string,
  existingFiles: Set<string>,
  isWindows = process.platform === 'win32'
): ScriptItemData[] {
  if (!content.includes('<project')) {
    return [];
  }

  const hasWrapper = existingFiles.has('mvnw') || existingFiles.has('mvnw.bat');
  const runnerCmd = hasWrapper ? (isWindows ? '.\\mvnw.bat' : './mvnw') : 'mvn';
  const runnerLabel = hasWrapper ? 'mvnw' : 'mvn';

  const lines = content.split(/\r?\n/);
  const projectLine = findLineNumber(lines, (line) => line.includes('<project'));

  const phases: Array<{ name: string; detail: string }> = [
    { name: 'compile', detail: 'Quellcode kompilieren (mvn compile)' },
    { name: 'test', detail: 'Unit-Tests ausführen (mvn test)' },
    { name: 'package', detail: 'Paket erstellen (mvn package)' },
    { name: 'install', detail: 'Artefakt lokal installieren (mvn install)' },
    { name: 'clean', detail: 'Build-Artefakte löschen (mvn clean)' },
  ];

  return phases.map((phase) => ({
    id: `${configPath}::std::${phase.name}`,
    name: phase.name,
    detail: phase.detail,
    executionCommand: `${runnerCmd} ${phase.name}`,
    cwd,
    configPath,
    lineNumber: projectLine,
    sourceType: 'maven',
    runner: runnerLabel,
  }));
}

/**
 * Parses .vscode/tasks.json for defined workspace tasks.
 */
export function parseVsCodeTasksJson(
  content: string,
  configPath: string,
  cwd: string
): ScriptItemData[] {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(stripJsonComments(content)) as Record<string, unknown>;
  } catch {
    return [];
  }

  if (!Array.isArray(parsed.tasks)) {
    return [];
  }

  const lines = content.split(/\r?\n/);
  const scripts: ScriptItemData[] = [];

  for (const rawTask of parsed.tasks) {
    if (!rawTask || typeof rawTask !== 'object') {
      continue;
    }
    const task = rawTask as Record<string, unknown>;
    const type = typeof task.type === 'string' ? task.type : 'shell';
    const command = typeof task.command === 'string' ? task.command : undefined;
    const script = typeof task.script === 'string' ? task.script : undefined;
    const label =
      typeof task.label === 'string'
        ? task.label
        : script
          ? `${type}: ${script}`
          : command ?? '';

    if (!label) {
      continue;
    }

    let executionCommand = '';
    if (type === 'npm' && script) {
      executionCommand = `npm run ${script}`;
    } else if (command) {
      const args = Array.isArray(task.args)
        ? task.args.filter((a): a is string => typeof a === 'string').join(' ')
        : '';
      executionCommand = args ? `${command} ${args}` : command;
    } else if (script) {
      executionCommand = script;
    } else {
      continue;
    }

    const searchTarget =
      typeof task.label === 'string'
        ? `"${escapeRegExp(task.label)}"`
        : script
          ? `"${escapeRegExp(script)}"`
          : `"${escapeRegExp(executionCommand)}"`;
    const targetRegex = new RegExp(searchTarget);
    const lineNumber = findLineNumber(lines, (line) => targetRegex.test(line));

    scripts.push({
      id: `${configPath}::${label}`,
      name: label,
      detail: executionCommand,
      executionCommand,
      cwd,
      configPath,
      lineNumber,
      sourceType: 'vscode-tasks',
      runner: 'task',
    });
  }

  return scripts;
}

/**
 * Parses a custom JSON configuration file based on a user-defined rule in VS Code settings.
 */
export function parseCustomJsonConfigFile(
  content: string,
  configPath: string,
  cwd: string,
  rule: CustomConfigFileRule
): ScriptItemData[] {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(stripJsonComments(content)) as Record<string, unknown>;
  } catch {
    return [];
  }

  const keyPath = (rule.jsonScriptsKey ?? 'scripts').split('.');
  let current: unknown = parsed;
  for (const segment of keyPath) {
    if (current && typeof current === 'object' && !Array.isArray(current)) {
      current = (current as Record<string, unknown>)[segment];
    } else {
      current = undefined;
      break;
    }
  }

  if (!current || typeof current !== 'object' || Array.isArray(current)) {
    return [];
  }

  const lines = content.split(/\r?\n/);
  const scripts: ScriptItemData[] = [];
  const runnerPrefix = rule.runnerCommand.trim();

  for (const [name, value] of Object.entries(current as Record<string, unknown>)) {
    if (typeof value !== 'string') {
      continue;
    }
    const keyRegex = new RegExp(`"${escapeRegExp(name)}"\\s*:`);
    const lineNumber = findLineNumber(lines, (line) => keyRegex.test(line));

    scripts.push({
      id: `${configPath}::${name}`,
      name,
      detail: value,
      executionCommand: runnerPrefix ? `${runnerPrefix} ${name}` : value,
      cwd,
      configPath,
      lineNumber,
      sourceType: 'custom',
      runner: runnerPrefix || 'custom',
    });
  }

  return scripts;
}

