import * as path from 'path';
import * as vscode from 'vscode';
import { ScriptItemData } from './models';
import {
  ProjectTreeDataProvider,
  ScriptCommandTreeItem,
  ScriptGroupTreeItem,
} from './treeDataProvider';

const CONFIG_WATCH_GLOB =
  '**/{package.json,pyproject.toml,Pipfile,Makefile,makefile,GNUmakefile,Justfile,justfile,.justfile,Cargo.toml,build.gradle,build.gradle.kts,pom.xml,tasks.json,pnpm-lock.yaml,yarn.lock,bun.lockb,bun.lock,package-lock.json,poetry.lock,pdm.lock,uv.lock,Pipfile.lock}';

/**
 * Manages reusable integrated VS Code terminals keyed by working directory.
 */
export class ScriptTerminalManager implements vscode.Disposable {
  private readonly terminalsByCwd = new Map<string, vscode.Terminal>();
  private readonly closeListener: vscode.Disposable;

  constructor() {
    this.closeListener = vscode.window.onDidCloseTerminal((closedTerminal) => {
      for (const [cwd, term] of this.terminalsByCwd.entries()) {
        if (term === closedTerminal) {
          this.terminalsByCwd.delete(cwd);
        }
      }
    });
  }

  /**
   * Executes a script inside a reused integrated terminal for its working directory.
   */
  public runScript(script: ScriptItemData): vscode.Terminal {
    let terminal = this.terminalsByCwd.get(script.cwd);
    if (!terminal || terminal.exitStatus !== undefined) {
      const folderName = path.basename(script.cwd) || 'Projekt';
      terminal = vscode.window.createTerminal({
        name: `Skripte (${folderName})`,
        cwd: script.cwd,
      });
      this.terminalsByCwd.set(script.cwd, terminal);
    }

    terminal.show(false);
    terminal.sendText(script.executionCommand, true);
    return terminal;
  }

  public dispose(): void {
    this.closeListener.dispose();
    this.terminalsByCwd.clear();
  }
}

/**
 * Opens a configuration file in the text editor and reveals the given 1-based line number.
 */
export async function openConfigFileAtLine(
  configPath: string,
  lineNumber = 1
): Promise<void> {
  const uri = vscode.Uri.file(configPath);
  const document = await vscode.workspace.openTextDocument(uri);
  const zeroBasedLine = Math.max(0, lineNumber - 1);
  const position = new vscode.Position(zeroBasedLine, 0);
  const selection = new vscode.Selection(position, position);

  await vscode.window.showTextDocument(document, {
    selection,
    preview: false,
  });
}

/**
 * Called when the extension is activated.
 */
export function activate(context: vscode.ExtensionContext): void {
  const treeProvider = new ProjectTreeDataProvider();
  const terminalManager = new ScriptTerminalManager();

  const treeViewDisposable = vscode.window.registerTreeDataProvider(
    'vscode-script-panel.treeView',
    treeProvider
  );

  const runScriptDisposable = vscode.commands.registerCommand(
    'vscode-script-panel.runScript',
    (item?: ScriptCommandTreeItem | ScriptItemData) => {
      const script =
        item instanceof ScriptCommandTreeItem ? item.script : item;
      if (!script || !script.executionCommand) {
        vscode.window.showWarningMessage(
          'Kein gültiger Skriptbefehl zum Ausführen ausgewählt.'
        );
        return;
      }
      terminalManager.runScript(script);
    }
  );

  const openConfigDisposable = vscode.commands.registerCommand(
    'vscode-script-panel.openConfigFile',
    async (item?: ScriptCommandTreeItem | ScriptGroupTreeItem) => {
      let configPath: string | undefined;
      let lineNumber = 1;

      if (item instanceof ScriptCommandTreeItem) {
        configPath = item.script.configPath;
        lineNumber = item.script.lineNumber ?? 1;
      } else if (item instanceof ScriptGroupTreeItem) {
        configPath = item.group.configPath;
        lineNumber = 1;
      }

      if (!configPath) {
        vscode.window.showInformationMessage(
          'Für diesen Eintrag ist keine Konfigurationsdatei hinterlegt.'
        );
        return;
      }

      try {
        await openConfigFileAtLine(configPath, lineNumber);
      } catch {
        vscode.window.showErrorMessage(
          `Konfigurationsdatei konnte nicht geöffnet werden: ${configPath}`
        );
      }
    }
  );

  const refreshDisposable = vscode.commands.registerCommand(
    'vscode-script-panel.refreshTree',
    () => {
      treeProvider.refresh();
    }
  );

  // Watch project configuration files for automatic TreeView updates
  const fileWatcher = vscode.workspace.createFileSystemWatcher(CONFIG_WATCH_GLOB);
  const onFileChange = (): void => treeProvider.refresh();
  const watcherCreateSub = fileWatcher.onDidCreate(onFileChange);
  const watcherChangeSub = fileWatcher.onDidChange(onFileChange);
  const watcherDeleteSub = fileWatcher.onDidDelete(onFileChange);

  const configChangeSub = vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration('vscode-script-panel')) {
      treeProvider.refresh();
    }
  });

  const workspaceFoldersSub = vscode.workspace.onDidChangeWorkspaceFolders(() => {
    treeProvider.refresh();
  });

  context.subscriptions.push(
    treeProviderOnDispose(treeProvider),
    terminalManager,
    treeViewDisposable,
    runScriptDisposable,
    openConfigDisposable,
    refreshDisposable,
    fileWatcher,
    watcherCreateSub,
    watcherChangeSub,
    watcherDeleteSub,
    configChangeSub,
    workspaceFoldersSub
  );
}

function treeProviderOnDispose(_provider: ProjectTreeDataProvider): vscode.Disposable {
  return {
    dispose: () => {
      // No-op disposable wrapper
    },
  };
}

/**
 * Called when the extension is deactivated.
 */
export function deactivate(): void {
  // Disposables registered in context.subscriptions are cleaned up automatically
}
