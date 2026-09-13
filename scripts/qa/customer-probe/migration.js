'use strict';

const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');
const vscode = require('vscode');
const jsonc = require('jsonc-parser');

async function run({ captureCheckpoint, waitFor, runInteractedCommand, requireRegisteredCommand }) {
    const result = { executedCommands: [], unexecutedCommands: [], commandDurationsMs: {} };
    const target = vscode.extensions.getExtension('FanaticPythoner.better-todo-tree');
    await target.activate();
    const folders = vscode.workspace.workspaceFolders;
    assert.equal(folders.length, 2);
    const settingsFiles = [process.env.BETTER_TODO_TREE_QA_PROFILE,
        vscode.workspace.workspaceFile.fsPath,
        ...folders.map((folder) => path.join(folder.uri.fsPath, '.vscode/settings.json'))];
    const inspections = [];
    function check(setting, field, expected, uri, languageId) {
        const scope = languageId ? { uri, languageId } : uri;
        const inspection = vscode.workspace.getConfiguration('better-todo-tree', scope).inspect(setting);
        inspections.push({ setting, field, expected, uri: uri && uri.toString(), languageId, inspection });
        assert.deepEqual(inspection[field], expected, `${setting} ${field} ${uri || ''} ${languageId || ''}`);
    }
    const commands = new Set(await vscode.commands.getCommands(true));
    const clear = requireRegisteredCommand(commands, ['notifications.clearAll', 'workbench.action.closeMessages'],
        'notification clear');
    async function importSettings() {
        await runInteractedCommand(result, 'better-todo-tree.importLegacySettings',
            () => vscode.commands.executeCommand(clear));
    }
    const beforeImport = settingsFiles.map((file) => fs.readFileSync(file, 'utf8'));
    assert.equal(vscode.workspace.getConfiguration('better-todo-tree').inspect('general.tags').globalValue, undefined);
    assert.deepEqual(vscode.workspace.getConfiguration('todo-tree').inspect('general.tags').globalValue, ['GLOBAL']);
    assert.equal(vscode.workspace.getConfiguration('todo-tree').inspect('highlightDelay').globalValue, 0);
    await importSettings();
    check('general.tags', 'globalValue', ['GLOBAL']);
    check('highlights.highlightDelay', 'globalValue', 0);
    check('regex.regex', 'globalLanguageValue', '(SHARED)', undefined, 'javascript');
    check('highlights.useColourScheme', 'workspaceValue', false);
    check('filtering.includeGlobs', 'workspaceValue', []);
    check('regex.regex', 'workspaceFolderValue', '(TODO_FIRST)', folders[0].uri);
    check('regex.regex', 'workspaceFolderValue', '(CURRENT_SECOND)', folders[1].uri);
    check('regex.regex', 'workspaceFolderLanguageValue', '(PYTHON_FIRST)', folders[0].uri, 'python');
    const beforeRetry = settingsFiles.map((file) => fs.readFileSync(file, 'utf8'));
    const shared = vscode.workspace.getConfiguration().inspect('[python][javascript]').globalValue;
    assert.deepEqual(shared, { 'todo-tree.regex.regex': '(SHARED)',
        'better-todo-tree.regex.regex': '(SHARED)', 'editor.tabSize': 3 });
    await importSettings();
    assert.deepEqual(settingsFiles.map((file) => fs.readFileSync(file, 'utf8')), beforeRetry);
    function sourceValues(value) {
        return Object.fromEntries(Object.entries(value).filter(([key]) => key.startsWith('todo-tree.') || key.startsWith('['))
            .map(([key, entry]) => [key, key.startsWith('[') ? sourceValues(entry) : entry]));
    }
    settingsFiles.forEach((file, index) => {
        const errors = [];
        const original = jsonc.parse(beforeImport[index], errors, { allowTrailingComma: true });
        const importedText = fs.readFileSync(file, 'utf8');
        const imported = jsonc.parse(importedText, errors, { allowTrailingComma: true });
        assert.deepEqual(errors, []);
        if (beforeImport[index].includes('// Todo Tree configuration retained.')) {
            assert.ok(importedText.includes('// Todo Tree configuration retained.'));
        }
        assert.deepEqual(sourceValues(imported.settings || imported), sourceValues(original.settings || original));
    });
    const files = {};
    for (const file of settingsFiles) {
        const text = fs.readFileSync(file, 'utf8');
        const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
        files[file] = text;
        if (file === vscode.workspace.workspaceFile.fsPath) {
            await vscode.window.showTextDocument(document);
            await captureCheckpoint('migration-workspace');
        }
    }
    const third = path.join(path.dirname(vscode.workspace.workspaceFile.fsPath), 'third');
    fs.mkdirSync(path.join(third, '.vscode'), { recursive: true });
    fs.writeFileSync(path.join(third, '.vscode/settings.json'), JSON.stringify({
        'todo-tree.regex.regex': '(THIRD_FOLDER)'
    }, null, 2));
    const thirdUri = vscode.Uri.file(third);
    assert.equal(vscode.workspace.updateWorkspaceFolders(folders.length, 0, { uri: thirdUri }), true);
    await waitFor(() => vscode.workspace.getConfiguration('todo-tree', thirdUri)
        .inspect('regex.regex')?.workspaceFolderValue === '(THIRD_FOLDER)',
    'added folder source setting missing', 15000);
    assert.equal(vscode.workspace.getConfiguration('better-todo-tree', thirdUri)
        .inspect('regex.regex').workspaceFolderValue, undefined);
    await importSettings();
    assert.equal(vscode.workspace.getConfiguration('todo-tree', thirdUri)
        .inspect('regex.regex').workspaceFolderValue, '(THIRD_FOLDER)');
    check('regex.regex', 'workspaceFolderValue', '(THIRD_FOLDER)', thirdUri);
    return Object.assign(result, { success: true, vscodeVersion: vscode.version,
        extensionVersion: target.packageJSON.version,
        migrationChecks: { inspections, files, idempotentRetry: true, addedFolder: true, sourcePreserved: true, activationReadOnly: true } });
}

module.exports = { run };
