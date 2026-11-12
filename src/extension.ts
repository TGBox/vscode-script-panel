import * as vscode from 'vscode';
import { ProjectTreeDataProvider } from './treeDataProvider';

/**
 * Formats the greeting message using user configuration or default fallback.
 */
export function formatGreeting(customGreeting?: string): string {
  const trimmed = (customGreeting ?? '').trim();
  return trimmed.length > 0 ? trimmed : 'Hallo aus vscode-script-panel!';
}

/**
 * Called when the extension is activated.
 */
export function activate(context: vscode.ExtensionContext): void {
  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.text = '$(rocket) vscode-script-panel';
  statusBarItem.tooltip = 'vscode-script-panel: Klicken zum Ausführen';
  statusBarItem.command = 'vscode-script-panel.helloWorld';
  statusBarItem.show();

  const helloDisposable = vscode.commands.registerCommand('vscode-script-panel.helloWorld', () => {
    const config = vscode.workspace.getConfiguration('vscode-script-panel');
    const greeting = formatGreeting(config.get<string>('greeting'));
    vscode.window.showInformationMessage(greeting);
  });

  const treeProvider = new ProjectTreeDataProvider();
  const treeViewDisposable = vscode.window.registerTreeDataProvider(
    'vscode-script-panel.treeView',
    treeProvider
  );
  const refreshDisposable = vscode.commands.registerCommand('vscode-script-panel.refreshTree', () => {
    treeProvider.refresh();
    vscode.window.showInformationMessage('vscode-script-panel: Baumansicht aktualisiert.');
  });
  context.subscriptions.push(treeViewDisposable, refreshDisposable);

  context.subscriptions.push(statusBarItem, helloDisposable);
}

/**
 * Called when the extension is deactivated.
 */
export function deactivate(): void {
  // Clean up resources if necessary
}
