import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mockTerminals: Array<{
  name: string;
  cwd?: string;
  exitStatus?: unknown;
  show: ReturnType<typeof vi.fn>;
  sendText: ReturnType<typeof vi.fn>;
}> = [];

let closeTerminalCallback: ((term: unknown) => void) | undefined;

vi.mock('vscode', () => ({
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
  TreeItem: class {
    label: string;
    collapsibleState: number;
    id?: string;
    tooltip?: string;
    description?: string;
    contextValue?: string;
    iconPath?: unknown;
    command?: unknown;
    constructor(label: string, collapsibleState: number) {
      this.label = label;
      this.collapsibleState = collapsibleState;
    }
  },
  ThemeIcon: class {
    constructor(public readonly id: string) {}
  },
  EventEmitter: class {
    event = vi.fn();
    fire = vi.fn();
  },
  Uri: {
    file: (fsPath: string) => ({ fsPath }),
  },
  Position: class {
    constructor(
      public readonly line: number,
      public readonly character: number
    ) {}
  },
  Selection: class {
    constructor(
      public readonly anchor: unknown,
      public readonly active: unknown
    ) {}
  },
  window: {
    showInformationMessage: vi.fn(),
    showWarningMessage: vi.fn(),
    showErrorMessage: vi.fn(),
    showTextDocument: vi.fn(async () => ({})),
    registerTreeDataProvider: vi.fn(() => ({ dispose: vi.fn() })),
    createTerminal: vi.fn((options: { name: string; cwd?: string }) => {
      const term = {
        name: options.name,
        cwd: options.cwd,
        exitStatus: undefined,
        show: vi.fn(),
        sendText: vi.fn(),
      };
      mockTerminals.push(term);
      return term;
    }),
    onDidCloseTerminal: vi.fn((cb: (term: unknown) => void) => {
      closeTerminalCallback = cb;
      return { dispose: vi.fn() };
    }),
  },
  commands: {
    registerCommand: vi.fn(() => ({ dispose: vi.fn() })),
  },
  workspace: {
    workspaceFolders: undefined as
      | Array<{ name: string; uri: { fsPath: string } }>
      | undefined,
    getConfiguration: vi.fn(() => ({
      get: vi.fn(() => undefined),
    })),
    openTextDocument: vi.fn(async (uri: { fsPath: string }) => ({ uri })),
    createFileSystemWatcher: vi.fn(() => ({
      onDidCreate: vi.fn(() => ({ dispose: vi.fn() })),
      onDidChange: vi.fn(() => ({ dispose: vi.fn() })),
      onDidDelete: vi.fn(() => ({ dispose: vi.fn() })),
      dispose: vi.fn(),
    })),
    onDidChangeConfiguration: vi.fn(() => ({ dispose: vi.fn() })),
    onDidChangeWorkspaceFolders: vi.fn(() => ({ dispose: vi.fn() })),
  },
}));

import { activate, openConfigFileAtLine, ScriptTerminalManager } from '../src/extension';
import {
  detectNodeRunner,
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
} from '../src/parsers';
import { DEFAULT_EXCLUDED_FOLDERS, scanWorkspaceForScripts } from '../src/scanner';
import { ProjectTreeDataProvider, ScriptGroupTreeItem } from '../src/treeDataProvider';

describe('Parsers & Runner Detection', () => {
  it('detects Node.js runner from packageManager field and lockfiles', () => {
    expect(detectNodeRunner(new Set(), 'pnpm@9.1.0')).toBe('pnpm');
    expect(detectNodeRunner(new Set(['yarn.lock']))).toBe('yarn');
    expect(detectNodeRunner(new Set(['bun.lockb']))).toBe('bun');
    expect(detectNodeRunner(new Set(['pnpm-lock.yaml']))).toBe('pnpm');
    expect(detectNodeRunner(new Set(), undefined, 'npm')).toBe('npm');
  });

  it('parses package.json scripts with line numbers and detected runner', () => {
    const pkgContent = [
      '{',
      '  "name": "demo",',
      '  "scripts": {',
      '    "dev": "vite",',
      '    "build": "tsc && vite build"',
      '  }',
      '}',
    ].join('\n');

    const { runner, scripts } = parsePackageJson(
      pkgContent,
      '/proj/package.json',
      '/proj',
      new Set(['pnpm-lock.yaml'])
    );

    expect(runner).toBe('pnpm');
    expect(scripts).toHaveLength(2);
    expect(scripts[0]).toMatchObject({
      name: 'dev',
      detail: 'vite',
      executionCommand: 'pnpm run dev',
      lineNumber: 4,
    });
    expect(scripts[1]).toMatchObject({
      name: 'build',
      detail: 'tsc && vite build',
      executionCommand: 'pnpm run build',
      lineNumber: 5,
    });
  });

  it('parses pyproject.toml and Pipfile scripts', () => {
    const pyproject = [
      '[tool.poetry]',
      'name = "demo"',
      '',
      '[tool.poetry.scripts]',
      'serve = "app.main:run"',
      '',
      '[tool.taskipy.tasks]',
      'test = "pytest -v"',
    ].join('\n');

    const { runner, scripts } = parsePyprojectToml(
      pyproject,
      '/proj/pyproject.toml',
      '/proj',
      new Set(['poetry.lock'])
    );

    expect(runner).toBe('poetry');
    expect(scripts).toHaveLength(2);
    expect(scripts[0]).toMatchObject({
      name: 'serve',
      executionCommand: 'poetry run serve',
      lineNumber: 5,
    });
    expect(scripts[1]).toMatchObject({
      name: 'test',
      executionCommand: 'poetry run task test',
      lineNumber: 8,
    });

    const pipfile = ['[scripts]', 'lint = "flake8 src"'].join('\n');
    const pipScripts = parsePipfile(pipfile, '/proj/Pipfile', '/proj');
    expect(pipScripts).toHaveLength(1);
    expect(pipScripts[0].executionCommand).toBe('pipenv run lint');
  });

  it('parses Makefile and Justfile targets/recipes', () => {
    const makefile = [
      '.PHONY: build clean',
      'CC := gcc',
      '',
      'build: src/main.c',
      '\t@gcc -o app src/main.c',
      '',
      'clean:',
      '\trm -rf app',
    ].join('\n');

    const makeScripts = parseMakefile(makefile, '/proj/Makefile', '/proj');
    expect(makeScripts.map((s) => s.name)).toEqual(['build', 'clean']);
    expect(makeScripts[0].detail).toBe('gcc -o app src/main.c');
    expect(makeScripts[0].lineNumber).toBe(4);

    const justfile = [
      'set dotenv-load := true',
      '',
      '# Startet den Entwicklungsserver',
      'dev port="3000":',
      '  npm run dev -- --port {{port}}',
    ].join('\n');

    const justScripts = parseJustfile(justfile, '/proj/Justfile', '/proj');
    expect(justScripts).toHaveLength(1);
    expect(justScripts[0]).toMatchObject({
      name: 'dev',
      detail: 'Startet den Entwicklungsserver',
      executionCommand: 'just dev',
      lineNumber: 4,
    });
  });

  it('parses Cargo.toml, build.gradle, and pom.xml', () => {
    const cargo = [
      '[package]',
      'name = "rust-app"',
      'version = "0.1.0"',
      '',
      '[package.metadata.scripts]',
      ' migrate = "sqlx migrate run"',
    ].join('\n');

    const cargoScripts = parseCargoToml(cargo, '/proj/Cargo.toml', '/proj');
    expect(cargoScripts.map((s) => s.name)).toContain('build');
    expect(cargoScripts.map((s) => s.name)).toContain('test');
    expect(cargoScripts.find((s) => s.name === 'migrate')?.executionCommand).toBe(
      'sqlx migrate run'
    );

    const gradle = [
      'plugins { id("java") }',
      'tasks.register("integrationTest") {',
      '  println("Running integration tests")',
      '}',
    ].join('\n');

    const gradleScripts = parseGradleFile(
      gradle,
      '/proj/build.gradle.kts',
      '/proj',
      new Set(['gradlew']),
      false
    );
    expect(gradleScripts.find((s) => s.name === 'build')?.executionCommand).toBe(
      './gradlew build'
    );
    expect(
      gradleScripts.find((s) => s.name === 'integrationTest')?.executionCommand
    ).toBe('./gradlew integrationTest');

    const pom = '<project><modelVersion>4.0.0</modelVersion></project>';
    const mavenScripts = parsePomXml(pom, '/proj/pom.xml', '/proj', new Set(), false);
    expect(mavenScripts.map((s) => s.name)).toEqual([
      'compile',
      'test',
      'package',
      'install',
      'clean',
    ]);
  });

  it('parses .vscode/tasks.json with comments and custom JSON config files', () => {
    const tasksJson = [
      '{',
      '  // VS Code Tasks configuration',
      '  "version": "2.0.0",',
      '  "tasks": [',
      '    {',
      '      "label": "Docker Compose Up",',
      '      "type": "shell",',
      '      "command": "docker compose up -d",',
      '    }',
      '  ]',
      '}',
    ].join('\n');

    const tasks = parseVsCodeTasksJson(tasksJson, '/proj/.vscode/tasks.json', '/proj');
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      name: 'Docker Compose Up',
      executionCommand: 'docker compose up -d',
      lineNumber: 6,
    });

    const composerJson = JSON.stringify({
      scripts: {
        'test:unit': 'phpunit',
      },
    });
    const customScripts = parseCustomJsonConfigFile(
      composerJson,
      '/proj/composer.json',
      '/proj',
      {
        fileName: 'composer.json',
        jsonScriptsKey: 'scripts',
        runnerCommand: 'composer run',
      }
    );
    expect(customScripts).toHaveLength(1);
    expect(customScripts[0].executionCommand).toBe('composer run test:unit');
  });
});

describe('Workspace Scanner & TreeView Integration', () => {
  let tempDir: string | undefined;

  afterEach(async () => {
    mockTerminals.length = 0;
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  it('scans workspace recursively (monorepo) while ignoring excluded folders', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'script-panel-test-'));
    await fs.writeFile(
      path.join(tempDir, 'package.json'),
      JSON.stringify({ scripts: { build: 'tsc' } })
    );

    const subPkgDir = path.join(tempDir, 'packages', 'web');
    await fs.mkdir(subPkgDir, { recursive: true });
    await fs.writeFile(
      path.join(subPkgDir, 'package.json'),
      JSON.stringify({ scripts: { start: 'vite' } })
    );

    // Ignored node_modules folder
    const ignoredDir = path.join(tempDir, 'node_modules', 'some-pkg');
    await fs.mkdir(ignoredDir, { recursive: true });
    await fs.writeFile(
      path.join(ignoredDir, 'package.json'),
      JSON.stringify({ scripts: { shouldIgnore: 'echo nope' } })
    );

    const groups = await scanWorkspaceForScripts(
      [{ name: 'root', fsPath: tempDir }],
      {
        maxDepth: 4,
        excludeFolders: DEFAULT_EXCLUDED_FOLDERS,
        defaultNodeRunner: 'npm',
        defaultPythonRunner: 'python',
        customScripts: [
          {
            name: 'Eigenes Backup',
            command: './backup.sh',
            description: 'Sichert die Datenbank',
          },
        ],
        customConfigFiles: [],
      }
    );

    expect(groups.map((g) => g.label)).toEqual([
      'package.json',
      'packages/web/package.json',
      'Eigene Befehle (Settings)',
    ]);

    const provider = new ProjectTreeDataProvider();
    const vscodeMod = await import('vscode');
    (vscodeMod.workspace as { workspaceFolders?: unknown }).workspaceFolders = [
      { name: 'root', uri: { fsPath: tempDir } },
    ];

    const rootTreeItems = await provider.getChildren();
    expect(rootTreeItems.length).toBeGreaterThanOrEqual(2);
    expect(rootTreeItems[0]).toBeInstanceOf(ScriptGroupTreeItem);

    const childItems = await provider.getChildren(rootTreeItems[0]);
    expect(childItems).toHaveLength(1);
  });

  it('reuses terminals per working directory and registers extension subscriptions', async () => {
    const manager = new ScriptTerminalManager();
    const scriptA = {
      id: '1',
      name: 'build',
      detail: 'tsc',
      executionCommand: 'npm run build',
      cwd: '/workspace/app',
      sourceType: 'npm' as const,
      runner: 'npm',
    };

    const term1 = manager.runScript(scriptA);
    const term2 = manager.runScript(scriptA);
    expect(term1).toBe(term2);
    expect(mockTerminals).toHaveLength(1);
    expect(mockTerminals[0].sendText).toHaveBeenCalledWith('npm run build', true);

    if (closeTerminalCallback) {
      closeTerminalCallback(term1);
    }
    const term3 = manager.runScript(scriptA);
    expect(term3).not.toBe(term1);
    manager.dispose();

    await openConfigFileAtLine('/workspace/app/package.json', 4);

    const subscriptions: unknown[] = [];
    const mockContext = {
      subscriptions,
      extensionUri: { fsPath: '/test' },
    } as unknown as Parameters<typeof activate>[0];

    activate(mockContext);
    expect(subscriptions.length).toBeGreaterThanOrEqual(8);
  });
});
