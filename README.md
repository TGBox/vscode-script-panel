# Projekt-Skriptbefehle (`vscode-script-panel`)

Eine VS Code Extension, die im Explorer-Sidepanel den aufklappbaren Bereich **„Skriptbefehle"** einfügt. Alle im Projekt definierten Skripte, Targets und Tasks werden automatisch aus den jeweiligen Projekt-Konfigurationsdateien (inklusive Monorepo-Unterordnern) ausgelesen und lassen sich direkt per Klick ausführen.

## Unterstützte Konfigurationsdateien & Ökosysteme

- **Node.js (`package.json`)**: Automatische Erkennung von `npm`, `pnpm`, `yarn` und `bun` anhand von Lockfiles (`pnpm-lock.yaml`, `yarn.lock`, `bun.lockb`, `bun.lock`, `package-lock.json`) oder dem Feld `packageManager`.
- **Python (`pyproject.toml`, `Pipfile`)**: Unterstützt `[project.scripts]`, `[tool.poetry.scripts]`, `[tool.pdm.scripts]`, `[tool.taskipy.tasks]`, `[tool.poe.tasks]`, `[tool.hatch.envs.default.scripts]` sowie `Pipfile` `[scripts]` mit automatischer Runner-Erkennung (`poetry`, `pdm`, `uv`, `pipenv`, `hatch`).
- **Make & Just (`Makefile`, `Justfile`)**: Liest alle Make-Targets und Just-Rezepte inklusive Beschreibungen aus.
- **Rust (`Cargo.toml`)**: Bietet die wichtigsten Standard-Lifecycle-Befehle (`build`, `run`, `test`, `check`, `clippy`, `clean`) sowie eigene Einträge aus `[package.metadata.scripts]`.
- **Java (`build.gradle`, `build.gradle.kts`, `pom.xml`)**: Standard-Lifecycle-Tasks sowie benutzerdefinierte Gradle-Tasks (`task` / `tasks.register`), inklusive automatischer Nutzung von `./gradlew` bzw. `./mvnw`.
- **VS Code Tasks (`.vscode/tasks.json`)**: Liest im Workspace konfigurierte Tasks aus.
- **Eigene Befehle & Dateien**: Frei definierbare Zusatzbefehle (`vscode-script-panel.customScripts`) und eigene JSON-Konfigurationsdateien (`vscode-script-panel.customConfigFiles`, z. B. `composer.json`) über die VS Code Settings.

## Bedienung im Explorer-Sidepanel

- **Direktes Klicken** auf einen Skriptbefehl führt ihn sofort in einem wiederverwendeten integrierten Terminal im passenden Arbeitsverzeichnis (`cwd`) aus.
- **Inline-Aktionen**:
  - `$(play)` **Skript ausführen**: Startet das Skript im Terminal.
  - `$(go-to-file)` **In Konfigurationsdatei öffnen**: Öffnet die zugehörige Konfigurationsdatei und springt direkt in die Zeile der Skript-Definition.
- **Automatische Aktualisierung**: Ein `FileSystemWatcher` überwacht alle unterstützten Konfigurationsdateien und aktualisiert die Baumansicht bei Änderungen sofort.

## Einstellungen

- `vscode-script-panel.maxScanDepth`: Maximale Suchtiefe für Unterordner in Monorepos (Standard: `4`).
- `vscode-script-panel.excludeFolders`: Zu ignorierende Ordnernamen (z. B. `node_modules`, `.git`, `.venv`, `target`, `dist`, `out`).
- `vscode-script-panel.defaultNodeRunner`: Fallback-Paketmanager für `package.json` (`npm`, `pnpm`, `yarn`, `bun`).
- `vscode-script-panel.defaultPythonRunner`: Fallback-Runner für `pyproject.toml` (`poetry`, `pdm`, `uv`, `pipenv`, `hatch`, `python`).
- `vscode-script-panel.customScripts`: Liste eigener Terminal-Befehle für das Panel.
- `vscode-script-panel.customConfigFiles`: Regeln für zusätzliche JSON-Konfigurationsdateien.

## Entwicklung & Tests

```bash
# Kompilieren (tsc -> out/)
npm run compile

# Typprüfung
npm run typecheck

# Unit-Tests mit Vitest ausführen
npm test
```
