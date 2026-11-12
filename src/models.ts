/**
 * Supported configuration ecosystem types.
 */
export type ScriptSourceType =
  | 'npm'
  | 'python'
  | 'makefile'
  | 'justfile'
  | 'cargo'
  | 'gradle'
  | 'maven'
  | 'vscode-tasks'
  | 'custom';

/**
 * Node.js package manager runners.
 */
export type NodeRunner = 'npm' | 'pnpm' | 'yarn' | 'bun';

/**
 * Python environment/script runners.
 */
export type PythonRunner = 'poetry' | 'pdm' | 'uv' | 'pipenv' | 'hatch' | 'python';

/**
 * Represents a single executable script command parsed from a config file or settings.
 */
export interface ScriptItemData {
  /** Unique identifier for this script item */
  id: string;
  /** Display name of the script (e.g. 'build', 'test') */
  name: string;
  /** The raw command or definition shown as description (e.g. 'vitest run') */
  detail: string;
  /** The full shell command to execute in the terminal (e.g. 'npm run test') */
  executionCommand: string;
  /** Working directory where the command should be executed */
  cwd: string;
  /** Absolute path to the source configuration file, if backed by a file */
  configPath?: string;
  /** 1-based line number inside the configuration file where the script is defined */
  lineNumber?: number;
  /** Ecosystem type */
  sourceType: ScriptSourceType;
  /** Name of the runner used (e.g. 'pnpm', 'cargo', 'make') */
  runner: string;
}

/**
 * Represents a collapsible group of scripts (typically one config file or custom settings group).
 */
export interface ScriptGroupData {
  /** Unique identifier for this group */
  id: string;
  /** Display label (e.g. 'package.json', 'frontend/package.json', 'Eigene Befehle') */
  label: string;
  /** Secondary text shown next to the group label (e.g. runner name or relative path) */
  description: string;
  /** Ecosystem type */
  sourceType: ScriptSourceType;
  /** Absolute path to the configuration file, if backed by a file */
  configPath?: string;
  /** Working directory for scripts in this group */
  cwd: string;
  /** Scripts belonging to this group */
  scripts: ScriptItemData[];
}

/**
 * User-defined custom script entry from VS Code settings.
 */
export interface CustomScriptConfig {
  name: string;
  command: string;
  cwd?: string;
  description?: string;
}

/**
 * User-defined custom config file rule from VS Code settings.
 */
export interface CustomConfigFileRule {
  /** File name or relative path to match (e.g. 'composer.json' or 'scripts.json') */
  fileName: string;
  /** JSON property path containing a key-value map of scripts (e.g. 'scripts') */
  jsonScriptsKey?: string;
  /** Prefix command to execute a script (e.g. 'composer run') */
  runnerCommand: string;
}

