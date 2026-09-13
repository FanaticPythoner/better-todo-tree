'use strict';

const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');
const vscode = require('vscode');

async function run({ captureCheckpoint, waitFor, runInteractedCommand, requireRegisteredCommand,
    checkHighlightSchema, delay, writeJsonAtomic }) {
    const result = { executedCommands: [], unexecutedCommands: [], commandDurationsMs: {}, settingChecks: {} };
    const root = vscode.workspace.workspaceFolders[0].uri.fsPath;
    const settingsPath = path.join(root, '.vscode/settings.json');
    const beforeActivation = fs.readFileSync(settingsPath, 'utf8');
    const target = vscode.extensions.getExtension('FanaticPythoner.better-todo-tree');
    await target.activate();
    assert.equal(fs.readFileSync(settingsPath, 'utf8'), beforeActivation);
    const current = vscode.workspace.getConfiguration('better-todo-tree');
    const source = vscode.workspace.getConfiguration('todo-tree');
    assert.equal(current.inspect('general.tags').workspaceValue, undefined);
    assert.deepEqual(source.inspect('general.tags').workspaceValue, ['TODO', 'FIXME']);
    const properties = Object.assign({}, ...target.packageJSON.contributes.configuration.map((group) => group.properties));
    const declared = Object.keys(properties).filter((key) => key.startsWith('todo-tree.'));
    for (const key of declared) {
        assert.ok(vscode.workspace.getConfiguration().inspect(key), `unregistered setting ${key}`);
    }
    result.settingChecks.registeredAliases = declared;
    result.settingChecks.activationReadOnly = true;
    let exportNumber = 0;
    async function readExport() {
        const uri = vscode.Uri.parse(`better-todo-tree-export:settings-${exportNumber++}.json`);
        return (await vscode.workspace.openTextDocument(uri)).getText();
    }
    const exports = {};
    async function expectTree(name, included, excluded) {
        let text;
        await waitFor(async () => {
            text = await readExport();
            return included.every((label) => text.includes(label)) && excluded.every((label) => !text.includes(label));
        }, `${name} tree mismatch`, 15000);
        exports[name] = JSON.parse(text);
    }
    await vscode.commands.executeCommand('workbench.view.extension.todo-tree-container');
    await expectTree('activation', ['first', 'second'], []);
    await vscode.commands.executeCommand('better-todo-tree.expand');
    await captureCheckpoint('todo-tree-initial', { included: ['first', 'second'], excluded: [] });
    async function editSettings(edit) {
        const values = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
        edit(values);
        writeJsonAtomic(settingsPath, values);
        await delay(500);
    }
    await editSettings((values) => { values['todo-tree.general.tags'] = ['FIXME']; });
    await expectTree('live-grouped-tags', ['second'], ['first']);
    await captureCheckpoint('todo-tree-live-grouped', { included: ['second'], excluded: ['first'] });
    await editSettings((values) => {
        delete values['todo-tree.general.tags'];
        delete values['todo-tree.highlights.defaultHighlight'];
        values['todo-tree.tags'] = ['TODO', 'FIXME'];
        values['todo-tree.regex'] = '// ($TAGS)';
        values['todo-tree.defaultHighlight'] = { type: 'text', foreground: '#ffff66', gutterIcon: true };
        values['todo-tree.customHighlight'] = { FIXME: { foreground: '#ff99dd', icon: 'flame' } };
    });
    await expectTree('live-flat-settings', ['first', 'second'], []);
    await captureCheckpoint('todo-tree-live-flat', { included: ['first', 'second'], excluded: [] });
    await checkHighlightSchema(result, root, 'todo-tree', 'todo-tree');
    await editSettings((values) => {
        values['todo-tree.general.enableFileWatcher'] = true;
        values['todo-tree.general.fileWatcherGlob'] = '**/watched-*.js';
    });
    const unwatched = path.join(root, 'outside-watch.js');
    fs.writeFileSync(unwatched, '// TODO outside watcher\n');
    await delay(1500);
    assert.equal((await readExport()).includes('outside watcher'), false);
    fs.unlinkSync(unwatched);
    const watched = path.join(root, 'watched-external.js');
    fs.writeFileSync(watched, '// TODO external created\n');
    await expectTree('external-create', ['external created'], []);
    fs.writeFileSync(watched, '// FIXME external edited\n');
    await expectTree('external-edit', ['external edited'], ['external created']);
    fs.unlinkSync(watched);
    await expectTree('external-delete', ['first', 'second'], ['external edited']);
    await editSettings((values) => { values['todo-tree.general.enableFileWatcher'] = false; });
    fs.writeFileSync(watched, '// TODO watcher disabled\n');
    await delay(1500);
    assert.equal((await readExport()).includes('watcher disabled'), false);
    fs.unlinkSync(watched);
    result.settingChecks.fileWatcher = { create: true, change: true, delete: true, glob: true, disabled: true };
    const sourceBeforeImport = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    const commands = new Set(await vscode.commands.getCommands(true));
    const clear = requireRegisteredCommand(commands, ['notifications.clearAll', 'workbench.action.closeMessages'],
        'notification clear');
    await runInteractedCommand(result, 'better-todo-tree.importLegacySettings',
        () => vscode.commands.executeCommand(clear));
    const imported = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    for (const [key, value] of Object.entries(sourceBeforeImport)) {
        assert.deepEqual(imported[key], value, `import changed ${key}`);
    }
    assert.deepEqual(current.inspect('general.tags').workspaceValue, ['TODO', 'FIXME']);
    assert.equal(current.inspect('highlights.useColourScheme').workspaceValue, false);
    const beforeRetry = fs.readFileSync(settingsPath, 'utf8');
    await runInteractedCommand(result, 'better-todo-tree.importLegacySettings',
        () => vscode.commands.executeCommand(clear));
    assert.equal(fs.readFileSync(settingsPath, 'utf8'), beforeRetry);
    await editSettings((values) => { values['todo-tree.tags'] = ['FIXME']; });
    await expectTree('current-namespace-precedence', ['first', 'second'], []);
    await captureCheckpoint('todo-tree-imported', { included: ['first', 'second'], excluded: [] });
    result.settingChecks.sourcePreserved = true;
    result.settingChecks.importIdempotent = true;
    result.settingChecks.liveGrouped = true;
    result.settingChecks.liveFlat = true;
    result.settingChecks.exports = exports;
    result.settingChecks.settings = imported;
    return Object.assign(result, { success: true, vscodeVersion: vscode.version,
        extensionVersion: target.packageJSON.version });
}

module.exports = { run };
