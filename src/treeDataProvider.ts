import * as vscode from 'vscode';
import {
  CustomConfigFileRule,
  CustomScriptConfig,
  NodeRunner,
  PythonRunner,
  ScriptGroupData,
  ScriptItemData,
  ScriptSourceType,
} from './models';
import { DEFAULT_EXCLUDED_FOLDERS, ScannerOptions, scanWorkspaceForScripts } from './scanner';

export type ScriptTreeElement = ScriptGroupTreeItem | ScriptCommandTreeItem | EmptyStateTreeItem;

/**
 * Maps a script source ecosystem to an appropriate VS Code ThemeIcon name.
 */
function getGroupIconName(sourceType: ScriptSourceType): string {
  switch (sourceType) {
    case 'npm':
      return 'package';
    case 'python':
      return 'symbol-namespace';
    case 'makefile':
    case 'justfile':
      return 'tools';
    case 'cargo':
      return 'Watch';
    case 'gradle':
    case 'maven':
      return 'library';
    case 'vscode-tasks':
      return 'tasklist';
    case 'custom':
    default:
      return 'terminal';
  }
}

/**
 * Tree item representing a configuration file or script group.
 */
export class ScriptGroupTreeItem extends vscode.TreeItem {
  public readonly kind = 'group' as const;

  constructor(public readonly group: ScriptGroupData) {
    super(group.label, vscode.TreeItemCollapsibleState.Expanded);
    this.id = group.id;
    this.description = group.description;
    this.tooltip = group.configPath
      ? `${group.label} (${group.description})\nPfad: ${group.configPath}`
      : `${group.label} (${group.description})`;
    this.contextValue = group.configPath ? 'scriptGroupWithFile' : 'scriptGroupCustom';
    this.iconPath = new vscode.ThemeIcon(getGroupIconName(group.sourceType));
  }
}

/**
 * Tree item representing an individual executable script command.
 */
export class ScriptCommandTreeItem extends vscode.TreeItem {
  public readonly kind = 'script' as const;

  constructor(public readonly script: ScriptItemData) {
    super(script.name, vscode.TreeItemCollapsibleState.None);
    this.id = script.id;
    this.description = script.detail;

    const tooltipLines = [
      `Skript: ${script.name}`,
      `Befehl: ${script.executionCommand}`,
      `Definition: ${script.detail}`,
      `Arbeitsverzeichnis: ${script.cwd}`,
    ];
    if (script.configPath) {
      const lineSuffix = script.lineNumber ? `:${script.lineNumber}` : '';
      tooltipLines.push(`Datei: ${script.configPath}${lineSuffix}`);
    }
    this.tooltip = tooltipLines.join('\n');

    this.contextValue = script.configPath ? 'scriptItemWithFile' : 'scriptItemCustom';
    this.iconPath = new vscode.ThemeIcon('play');

    // Direct left-click runs the script immediately
    this.command = {
      command: 'vscode-script-panel.runScript',
      title: 'Skript ausführen',
      arguments: [this],
    };
  }
}

/**
 * Placeholder tree item shown when no scripts are discovered in the workspace.
 */
export class EmptyStateTreeItem extends vscode.TreeItem {
  public readonly kind = 'empty' as const;

  constructor(message: string, descriptionText = '') {
    super(message, vscode.TreeItemCollapsibleState.None);
    this.description = descriptionText;
    this.tooltip = message;
    this.contextValue = 'emptyState';
    this.iconPath = new vscode.ThemeIcon('info');
  }
}

/**
 * Provides grouped project scripts for the Explorer sidebar TreeView.
 */
export class ProjectTreeDataProvider implements vscode.TreeDataProvider<ScriptTreeElement> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<
    ScriptTreeElement | undefined | void
  >();
  public readonly onDidChangeTreeData: vscode.Event<ScriptTreeElement | undefined | void> =
    this._onDidChangeTreeData.event;

  private cachedGroups: ScriptGroupData[] | undefined;

  /**
   * Clears cached groups and triggers a TreeView refresh.
   */
  public refresh(): void {
    this.cachedGroups = undefined;
    this._onDidChangeTreeData.fire();
  }

  public getTreeItem(element: ScriptTreeElement): vscode.TreeItem {
    return element;
  }

  public async getChildren(element?: ScriptTreeElement): Promise<ScriptTreeElement[]> {
    if (!element) {
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders || workspaceFolders.length === 0) {
        return [new EmptyStateTreeItem('Kein Workspace-Ordner geöffnet')];
      }

      if (!this.cachedGroups) {
        const roots = workspaceFolders.map((folder) => ({
          name: folder.name,
          fsPath: folder.uri.fsPath,
        }));
        const options = this.readScannerOptions();
        this.cachedGroups = await scanWorkspaceForScripts(roots, options);
      }

      if (this.cachedGroups.length === 0) {
        return [
          new EmptyStateTreeItem(
            'Keine Skriptbefehle gefunden',
            'package.json, Makefile, pyproject.toml, Cargo.toml …'
          ),
        ];
      }

      return this.cachedGroups.map((group) => new ScriptGroupTreeItem(group));
    }

    if (element instanceof ScriptGroupTreeItem) {
      return element.group.scripts.map((script) => new ScriptCommandTreeItem(script));
    }

    return [];
  }

  private readScannerOptions(): ScannerOptions {
    const config = vscode.workspace.getConfiguration('vscode-script-panel');
    const maxDepth = config.get<number>('maxScanDepth') ?? 4;
    const excludeFolders =
      config.get<string[]>('excludeFolders') ?? DEFAULT_EXCLUDED_FOLDERS;
    const defaultNodeRunner = config.get<NodeRunner>('defaultNodeRunner') ?? 'npm';
    const defaultPythonRunner =
      config.get<PythonRunner>('defaultPythonRunner') ?? 'python';
    const customScripts = config.get<CustomScriptConfig[]>('customScripts') ?? [];
    const customConfigFiles =
      config.get<CustomConfigFileRule[]>('customConfigFiles') ?? [];

    return {
      maxDepth,
      excludeFolders,
      defaultNodeRunner,
      defaultPythonRunner,
      customScripts,
      customConfigFiles,
    };
  }
}
