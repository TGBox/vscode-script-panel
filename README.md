# vscode-script-panel

A VSCode extension that adds a panel dedicated to running your most often used commands in a simpler way.

## Funktionen

- **Befehl (`vscode-script-panel.helloWorld`):** Zeigt eine konfigurierbare Begrüßungsnachricht an (`Strg+Umschalt+P` -> `vscode-script-panel: Hallo Welt anzeigen`).
- **Statusleiste:** Direkter Schnellzugriff über den Eintrag in der rechten VS Code Statusleiste.
- **Sidebar TreeView (`vscode-script-panel.treeView`):** Hierarchische Baumansicht in der Explorer-Seitenleiste inklusive Refresh-Befehl.

## Entwicklung starten

1. Abhängigkeiten installieren:

   ```bash
   npm install
   ```

2. Projekt in VS Code öffnen und **`F5`** drücken:
   - Dies kompiliert die Erweiterung automatisch (`npm: compile`) und startet ein neues **Extension Development Host**-Fenster mit geladener Extension.

## Nützliche Befehle

```bash
# Einmalig kompilieren (tsc -> out/extension.js)
npm run compile

# Watch-Modus für kontinuierliche Entwicklung
npm run watch

# TypeScript-Typprüfung
npm run typecheck

# Unit-Tests mit Vitest ausführen
npm test

# Installierbares .vsix-Paket erstellen
npm run package
```

## Einstellungen

Diese Erweiterung stellt folgende VS Code Einstellung bereit:

- `vscode-script-panel.greeting`: Benutzerdefinierter Begrüßungstext für den Befehl.
