'use strict';

const fs = require('fs');
const childProcess = require('child_process');
const path = require('path');
const vscode = require('vscode');

const TARGET_ID = 'FanaticPythoner.better-todo-tree';
const COMMAND_PREFIX = 'better-todo-tree.';
const RESULT_PATH = process.env.BETTER_TODO_TREE_QA_RESULT;
const TRACE_PATH = typeof RESULT_PATH === 'string' ? `${RESULT_PATH}.trace` : undefined;

function trace(event) {
    if (TRACE_PATH) {
        fs.appendFileSync(TRACE_PATH, `${new Date().toISOString()} ${event}\n`, 'utf8');
    }
}

function assertCondition(condition, message) {
    if (condition !== true) {
        throw new Error(message);
    }
}

function delay(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function runCommand(result, command, ...args) {
    trace(`begin ${command}`);
    const start = performance.now();
    await vscode.commands.executeCommand(command, ...args);
    result.commandDurationsMs[command] = Number((performance.now() - start).toFixed(3));
    result.executedCommands.push(command);
    trace(`end ${command}`);
}

async function awaitWithDeadline(promise, message) {
    let handle;
    const deadline = new Promise((resolve, reject) => {
        handle = setTimeout(() => reject(new Error(message)), 5000);
    });

    try {
        return await Promise.race([promise, deadline]);
    } finally {
        clearTimeout(handle);
    }
}

async function runInteractedCommand(result, command, interaction) {
    trace(`begin ${command}`);
    const start = performance.now();
    const completion = vscode.commands.executeCommand(command);
    if (command === 'better-todo-tree.importLegacySettings') {
        await captureCheckpoint(`settings-import-ready-${result.executedCommands.length}`);
    } else {
        await delay(300);
    }
    await interaction();
    await awaitWithDeadline(completion, `${command} interaction did not settle`);
    result.commandDurationsMs[command] = Number((performance.now() - start).toFixed(3));
    result.executedCommands.push(command);
    trace(`end ${command}`);
}

function requireRegisteredCommand(registered, candidates, label) {
    const command = candidates.find((candidate) => registered.has(candidate));
    assertCondition(typeof command === 'string', `${label} command missing`);
    return command;
}

function sendKeys(...tokens) {
    const result = childProcess.spawnSync(process.env.BETTER_TODO_TREE_QA_PYTHON, [path.join(__dirname, 'send-keys.py'), ...tokens], {
        encoding: 'utf8'
    });
    if (result.status !== 0) {
        throw new Error(`keyboard input failed: ${result.stderr.trim()}`);
    }
}

async function waitFor(predicate, message, timeoutMs = 4000) {
    const deadline = performance.now() + timeoutMs;
    while (performance.now() < deadline) {
        if (await predicate() === true) {
            return;
        }
        await delay(50);
    }
    throw new Error(message);
}

function activePosition() {
    const editor = vscode.window.activeTextEditor;
    assertCondition(Boolean(editor), 'active editor missing');
    return {
        line: editor.selection.active.line,
        character: editor.selection.active.character
    };
}

async function openSource(workspaceRoot) {
    const sourceUri = vscode.Uri.file(path.join(workspaceRoot, 'source.js'));
    const document = await vscode.workspace.openTextDocument(sourceUri);
    const editor = await vscode.window.showTextDocument(document, { preview: false });
    return { sourceUri, document, editor };
}

async function readTreeExport(result) {
    await runCommand(result, 'better-todo-tree.exportTree');
    return vscode.window.activeTextEditor.document.getText();
}

function targetConfiguration() {
    return vscode.workspace.getConfiguration('better-todo-tree');
}

async function checkToggle(result, command, setting) {
    const before = targetConfiguration().get(setting);
    assertCondition(typeof before === 'boolean', `${setting} boolean default missing`);
    await runCommand(result, command);
    await waitFor(() => targetConfiguration().get(setting) === !before, `${setting} first toggle failed`);
    await runCommand(result, command);
    await waitFor(() => targetConfiguration().get(setting) === before, `${setting} second toggle failed`);
}

async function checkScanMode(result, command, expected) {
    await runCommand(result, command);
    await waitFor(() => targetConfiguration().get('tree.scanMode') === expected, `${command} mode mismatch`);
    await delay(200);
}

function writeJsonAtomic(filePath, value) {
    const temporary = `${filePath}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', 'utf8');
    fs.renameSync(temporary, filePath);
}

async function captureCheckpoint(name, tree) {
    const request = `${RESULT_PATH}.checkpoint`;
    const acknowledgement = `${request}.ack`;
    writeJsonAtomic(request, { name, tree });
    await waitFor(() => fs.existsSync(acknowledgement) &&
        fs.readFileSync(acknowledgement, 'utf8') === name, `${name} screenshot missing`, 15000);
}

async function checkNotebookEditors(result, workspaceRoot) {
    trace('begin notebook settings');
    const configuration = targetConfiguration();
    await configuration.update('tree.scanMode', 'open files', vscode.ConfigurationTarget.Workspace);
    await configuration.update('highlights.defaultHighlight', {
        type: 'text', foreground: '#ffff66', gutterIcon: true
    }, vscode.ConfigurationTarget.Workspace);
    for (const document of vscode.workspace.textDocuments.filter((entry) => entry.isDirty && entry.isUntitled)) {
        await vscode.window.showTextDocument(document);
        await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
    }
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    trace('end notebook editor closure');
    const notebookPath = path.join(workspaceRoot, 'customer.ipynb');
    fs.writeFileSync(notebookPath, JSON.stringify({
        cells: ['first', 'second'].map((name) => ({
            cell_type: 'code', metadata: {}, execution_count: null, outputs: [],
            source: [`# TODO ${name} cell\n`]
        })),
        metadata: { language_info: { name: 'python' } }, nbformat: 4, nbformat_minor: 5
    }, null, 2) + '\n');
    const notebook = await vscode.workspace.openNotebookDocument(vscode.Uri.file(notebookPath));
    trace('end notebook document open');
    await vscode.window.showNotebookDocument(notebook);
    trace('end notebook editor open');
    await runCommand(result, 'better-todo-tree.refresh');
    let exportNumber = 0;
    async function readExport() {
        const uri = vscode.Uri.parse(`better-todo-tree-export:customer-notebook-${exportNumber++}.json`);
        return (await vscode.workspace.openTextDocument(uri)).getText();
    }
    async function awaitExport(predicate, message) {
        const deadline = performance.now() + 10000;
        while (performance.now() < deadline) {
            const exported = await readExport();
            if (predicate(exported)) {
                return exported;
            }
            await delay(100);
        }
        throw new Error(message);
    }
    const initial = await awaitExport((text) => text.includes('first cell') && text.includes('second cell'),
        'notebook export omitted a same-line cell');
    assertCondition(!initial.includes('.qa-transient.js'), 'closed text editor retained open-files results');
    await delay(500);
    await captureCheckpoint('notebook-initial');
    const first = notebook.cellAt(0).document;
    const edit = new vscode.WorkspaceEdit();
    edit.replace(first.uri, new vscode.Range(first.positionAt(0), first.positionAt(first.getText().length)),
        '# FIXME edited first cell\n');
    assertCondition(await vscode.workspace.applyEdit(edit), 'notebook cell edit rejected');
    assertCondition(await notebook.save(), 'notebook save rejected');
    const edited = await awaitExport((text) => text.includes('edited first cell') && text.includes('second cell') &&
        !text.includes('TODO first cell'), 'notebook edit did not refresh the exported tree');
    await delay(500);
    await captureCheckpoint('notebook-edited');
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    await runCommand(result, 'better-todo-tree.refresh');
    const closed = await awaitExport((text) => !text.includes('first cell') && !text.includes('second cell'),
        'closed notebook retained open-files results');
    assertCondition(!closed.includes('.qa-transient.js'), 'empty editor set retained cached text results');
    result.notebookChecks = { cellCount: notebook.cellCount, initial: JSON.parse(initial),
        edited: JSON.parse(edited), closed: JSON.parse(closed) };
}

async function checkHighlightSchema(result, workspaceRoot, phase, namespace = 'better-todo-tree') {
    const configuration = vscode.workspace.getConfiguration(namespace);
    const previous = configuration.inspect('highlights.defaultHighlight').workspaceValue;
    const uri = vscode.Uri.file(path.join(workspaceRoot, '.vscode/settings.json'));
    const jsonConfiguration = vscode.workspace.getConfiguration('json', uri);
    const previousValidation = jsonConfiguration.inspect('validate.enable').workspaceValue;
    try {
        const document = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(document);
        await vscode.extensions.getExtension('vscode.json-language-features').activate();
        await waitFor(async () => {
            const symbols = await vscode.commands.executeCommand('vscode.executeDocumentSymbolProvider', uri);
            return Array.isArray(symbols) && symbols.length > 0;
        }, 'settings document symbol provider did not become ready', 15000);
        await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
        const editor = await vscode.window.showTextDocument(document);
        await configuration.update('highlights.defaultHighlight', {
            type: 'invalid-highlight-mode', foreground: 'editor.foreground', background: 'rgba(20, 30, 40, 0.5)'
        }, vscode.ConfigurationTarget.Workspace);
        await waitFor(() => document.getText().includes('invalid-highlight-mode'),
            'settings document did not load the invalid control', 10000);
        await jsonConfiguration.update('validate.enable', false, vscode.ConfigurationTarget.Workspace);
        await jsonConfiguration.update('validate.enable', true, vscode.ConfigurationTarget.Workspace);
        const invalidPosition = document.positionAt(document.getText().indexOf('invalid-highlight-mode') + 1);
        try {
            await waitFor(() => vscode.languages.getDiagnostics(uri).some((entry) => {
                return entry.range.contains(invalidPosition);
            }), 'invalid highlight type produced no schema diagnostic', 10000);
        } catch (error) {
            result.settingChecks.schemaControlEvidence = {
                languageId: document.languageId, position: invalidPosition,
                documentText: document.getText(),
                validationEnabled: vscode.workspace.getConfiguration('json', uri).get('validate.enable'),
                highlightInspection: configuration.inspect('highlights.defaultHighlight'),
                diagnostics: vscode.languages.getDiagnostics(uri).map((entry) => ({
                    message: entry.message, range: entry.range
                }))
            };
            await captureCheckpoint(`settings-${phase}-failure`);
            throw error;
        }
        result.settingChecks.invalidHighlightDiagnostics = vscode.languages.getDiagnostics(uri)
            .filter((entry) => entry.range.contains(invalidPosition)).map((entry) => entry.message);
        editor.revealRange(new vscode.Range(invalidPosition, invalidPosition), vscode.TextEditorRevealType.InCenter);
        await delay(200);
        await captureCheckpoint(`settings-${phase}-invalid`);
        await configuration.update('highlights.defaultHighlight', {
            type: 'capture-groups:1,3', foreground: 'editor.foreground', background: 'rgba(20, 30, 40, 0.5)'
        }, vscode.ConfigurationTarget.Workspace);
        await waitFor(() => document.getText().includes('capture-groups:1,3') &&
            vscode.languages.getDiagnostics(uri).length === 0,
        'supported highlight settings retain schema diagnostics', 10000);
        const validPosition = document.positionAt(document.getText().indexOf('capture-groups:1,3'));
        editor.revealRange(new vscode.Range(validPosition, validPosition), vscode.TextEditorRevealType.InCenter);
        await delay(200);
        await captureCheckpoint(`settings-${phase}-valid`);
        result.settingChecks.highlightSchemaDiagnostics = vscode.languages.getDiagnostics(uri)
            .filter((entry) => entry.severity <= vscode.DiagnosticSeverity.Warning)
            .map((entry) => entry.message);
        assertCondition(result.settingChecks.highlightSchemaDiagnostics.length === 0,
            'supported highlight settings produce schema diagnostics: ' +
            JSON.stringify(result.settingChecks.highlightSchemaDiagnostics));
    } finally {
        await jsonConfiguration.update('validate.enable', previousValidation, vscode.ConfigurationTarget.Workspace);
        await configuration.update('highlights.defaultHighlight', previous, vscode.ConfigurationTarget.Workspace);
        await openSource(workspaceRoot);
    }
}

async function executeProbe() {
    assertCondition(typeof RESULT_PATH === 'string' && RESULT_PATH.length > 0, 'result path missing');
    const workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;
    const result = {
        schemaVersion: 1,
        success: false,
        targetId: TARGET_ID,
        vscodeVersion: vscode.version,
        extensionVersion: undefined,
        contributedCommandCount: 0,
        registeredCommandCount: 0,
        missingCommands: [],
        executedCommands: [],
        commandDurationsMs: {},
        navigation: [],
        export: {},
        diagnostics: {},
        settingChecks: {},
        filterChecks: {},
        lifecycleChecks: {},
        automationCommands: {},
        unexecutedCommands: [],
        error: undefined
    };

    try {
        trace('begin probe');
        const target = vscode.extensions.getExtension(TARGET_ID);
        assertCondition(Boolean(target), 'target extension missing');
        result.extensionVersion = target.packageJSON.version;

        const activationStart = performance.now();
        await target.activate();
        assertCondition(targetConfiguration().get('highlights.useColourScheme') === false,
            'migration changed explicit palette opt-out');
        assertCondition(JSON.stringify(vscode.workspace.getConfiguration('todo-tree').get('tags')) === JSON.stringify(['TODO', 'FIXME', 'BUG', 'HACK']),
            'flat Todo Tree source setting changed during activation');
        assertCondition(vscode.workspace.getConfiguration('todo-tree').inspect('highlights.useColourScheme').workspaceValue === false,
            'Todo Tree palette opt-out changed during activation');
        result.activationMs = Number((performance.now() - activationStart).toFixed(3));
        assertCondition(target.isActive === true, 'target extension inactive');
        await checkHighlightSchema(result, workspaceRoot, 'startup');

        const registered = new Set(await vscode.commands.getCommands(true));
        const contributed = target.packageJSON.contributes.commands.map((entry) => entry.command);
        result.contributedCommandCount = contributed.length;
        result.registeredCommandCount = Array.from(registered).filter((entry) => {
            return entry.startsWith(COMMAND_PREFIX);
        }).length;
        result.missingCommands = contributed.filter((entry) => registered.has(entry) !== true);
        assertCondition(result.missingCommands.length === 0, 'contributed command registration incomplete');

        const clearNotifications = requireRegisteredCommand(registered, [
            'notifications.clearAll',
            'workbench.action.closeMessages'
        ], 'notification clear');
        result.automationCommands = { clearNotifications };

        const colourSchemeInspection = vscode.workspace.getConfiguration('todo-tree').inspect('highlights.useColourScheme');
        result.settingChecks.colourSchemeDefault = colourSchemeInspection.defaultValue;
        result.settingChecks.colourSchemeEffective = targetConfiguration().get('highlights.useColourScheme');
        result.settingChecks.colourSchemeExplicit = [
            colourSchemeInspection.globalValue,
            colourSchemeInspection.workspaceValue,
            colourSchemeInspection.workspaceFolderValue
        ].some((value) => value !== undefined);
        assertCondition(result.settingChecks.colourSchemeDefault === false, 'colour scheme default mismatch');
        assertCondition(result.settingChecks.colourSchemeEffective === false, 'colour scheme effective value mismatch');
        assertCondition(result.settingChecks.colourSchemeExplicit === true, 'Todo Tree palette opt-out missing');

        await openSource(workspaceRoot);
        await runCommand(result, 'workbench.view.extension.todo-tree-container');
        await runCommand(result, 'better-todo-tree.refresh');
        await delay(1200);

        await runCommand(result, 'better-todo-tree.exportScanDiagnostics');
        const diagnosticDocument = vscode.window.activeTextEditor.document;
        const diagnostics = JSON.parse(diagnosticDocument.getText());
        result.diagnostics = {
            schemaVersion: diagnostics.schemaVersion,
            publicSafe: diagnostics.privacy.publicSafe,
            issueCount: diagnostics.summary.issueCount,
            active: diagnostics.scan.active,
            eventCount: diagnostics.events.length
        };
        assertCondition(diagnostics.schemaVersion === 2, 'diagnostic schema mismatch');
        assertCondition(diagnostics.privacy.publicSafe === true, 'diagnostic privacy contract mismatch');
        assertCondition(diagnostics.summary.issueCount === 0, 'diagnostic scan issue detected');
        assertCondition(diagnostics.scan.active === false, 'diagnostic scan remained active');

        await runCommand(result, 'better-todo-tree.exportTree');
        const exportDocument = vscode.window.activeTextEditor.document;
        const exportText = exportDocument.getText();
        result.export = {
            scheme: exportDocument.uri.scheme,
            bytes: Buffer.byteLength(exportText),
            containsSource: exportText.includes('source.js'),
            containsNestedSource: exportText.includes('example.py'),
            containsTodo: exportText.includes('TODO first'),
            containsFixme: exportText.includes('FIXME second'),
            containsHack: exportText.includes('HACK nested')
        };
        assertCondition(result.export.scheme === 'better-todo-tree-export', 'export scheme mismatch');
        assertCondition(result.export.containsSource === true, 'export source path missing');
        assertCondition(result.export.containsNestedSource === true, 'export nested source path missing');
        assertCondition(result.export.containsTodo === true, 'export TODO missing');
        assertCondition(result.export.containsFixme === true, 'export FIXME missing');
        assertCondition(result.export.containsHack === true, 'export HACK missing');

        await runCommand(result, 'better-todo-tree.treeStateBusy');
        await runCommand(result, 'better-todo-tree.scanBusy');

        await runInteractedCommand(result, 'better-todo-tree.filter', async () => {
            sendKeys('text=todo', 'key=Return');
        });
        await delay(300);
        const filteredExport = await readTreeExport(result);
        result.filterChecks.textFilterContainsTodo = filteredExport.includes('TODO first');
        result.filterChecks.textFilterExcludesFixme = filteredExport.includes('FIXME second') === false;
        assertCondition(result.filterChecks.textFilterContainsTodo === true, 'text filter removed TODO');
        assertCondition(result.filterChecks.textFilterExcludesFixme === true, 'text filter retained FIXME');
        await runCommand(result, 'better-todo-tree.filterClear');

        await runInteractedCommand(result, 'better-todo-tree.addTag', async () => {
            sendKeys('text=qacustomer', 'key=Return');
        });
        await waitFor(
            () => targetConfiguration().get('general.tags').includes('qacustomer'),
            'add-tag setting mutation missing'
        );
        result.filterChecks.addTagPersisted = true;
        await runInteractedCommand(result, 'better-todo-tree.removeTag', async () => {
            sendKeys('text=qacustomer', 'key=Down', 'key=space', 'key=Return');
        });
        await waitFor(
            () => targetConfiguration().get('general.tags').includes('qacustomer') === false,
            'remove-tag setting mutation missing'
        );
        result.filterChecks.removeTagPersisted = true;

        await runInteractedCommand(result, 'better-todo-tree.openCurrentScanFile', async () => {
            await vscode.commands.executeCommand(clearNotifications);
        });
        await runInteractedCommand(result, 'better-todo-tree.switchScope', async () => {
            sendKeys('text=qapython', 'key=Return');
        });
        await delay(500);
        let folderExport = await readTreeExport(result);
        result.filterChecks.scopeContainsPython = folderExport.includes('example.py');
        result.filterChecks.scopeExcludesJavaScript = folderExport.includes('source.js') === false;
        assertCondition(result.filterChecks.scopeContainsPython === true, 'scope filter removed Python source');
        assertCondition(result.filterChecks.scopeExcludesJavaScript === true, 'scope filter retained JavaScript source');
        await runCommand(result, 'better-todo-tree.resetAllFilters');
        await delay(500);

        const nestedNode = { fsPath: path.join(workspaceRoot, 'nested') };
        const sourceNode = { fsPath: path.join(workspaceRoot, 'source.js') };

        await runCommand(result, 'better-todo-tree.showOnlyThisFolder', nestedNode);
        await delay(500);
        folderExport = await readTreeExport(result);
        result.filterChecks.folderOnlyContainsNested = folderExport.includes('example.py');
        result.filterChecks.folderOnlyExcludesRoot = folderExport.includes('source.js') === false;
        assertCondition(result.filterChecks.folderOnlyContainsNested === true, 'folder filter removed nested source');
        assertCondition(result.filterChecks.folderOnlyExcludesRoot === true, 'folder filter retained root source');
        await runCommand(result, 'better-todo-tree.resetAllFilters');
        await delay(500);

        await runCommand(result, 'better-todo-tree.showOnlyThisFolderAndSubfolders', nestedNode);
        await delay(500);
        folderExport = await readTreeExport(result);
        result.filterChecks.subtreeContainsNested = folderExport.includes('example.py');
        result.filterChecks.subtreeExcludesRoot = folderExport.includes('source.js') === false;
        assertCondition(result.filterChecks.subtreeContainsNested === true, 'subtree filter removed nested source');
        assertCondition(result.filterChecks.subtreeExcludesRoot === true, 'subtree filter retained root source');
        await runCommand(result, 'better-todo-tree.resetAllFilters');
        await delay(500);

        await runCommand(result, 'better-todo-tree.excludeThisFolder', nestedNode);
        await delay(500);
        folderExport = await readTreeExport(result);
        result.filterChecks.folderExclusionRetainsRoot = folderExport.includes('source.js');
        result.filterChecks.folderExclusionRemovesNested = folderExport.includes('example.py') === false;
        assertCondition(result.filterChecks.folderExclusionRetainsRoot === true, 'folder exclusion removed root source');
        assertCondition(result.filterChecks.folderExclusionRemovesNested === true, 'folder exclusion retained nested source');
        await runCommand(result, 'better-todo-tree.resetAllFilters');
        await delay(500);

        await runCommand(result, 'better-todo-tree.excludeThisFile', sourceNode);
        await delay(500);
        folderExport = await readTreeExport(result);
        result.filterChecks.fileExclusionRemovesRoot = folderExport.includes('source.js') === false;
        result.filterChecks.fileExclusionRetainsNested = folderExport.includes('example.py');
        assertCondition(result.filterChecks.fileExclusionRemovesRoot === true, 'file exclusion retained root source');
        assertCondition(result.filterChecks.fileExclusionRetainsNested === true, 'file exclusion removed nested source');
        await runInteractedCommand(result, 'better-todo-tree.removeFilter', async () => {
            sendKeys('key=Down', 'key=space', 'key=Return');
        });
        await delay(500);
        folderExport = await readTreeExport(result);
        result.filterChecks.filterRemovalRestoresRoot = folderExport.includes('source.js');
        result.filterChecks.filterRemovalRetainsNested = folderExport.includes('example.py');
        assertCondition(result.filterChecks.filterRemovalRestoresRoot === true, 'filter removal omitted root source');
        assertCondition(result.filterChecks.filterRemovalRetainsNested === true, 'filter removal omitted nested source');
        await runCommand(result, 'better-todo-tree.resetAllFilters');
        await delay(500);

        await runInteractedCommand(result, 'better-todo-tree.importLegacySettings', async () => {
            await vscode.commands.executeCommand(clearNotifications);
        });

        const source = await openSource(workspaceRoot);
        source.editor.selection = new vscode.Selection(new vscode.Position(0, 0), new vscode.Position(0, 0));
        await runCommand(result, 'better-todo-tree.goToNext');
        result.navigation.push(activePosition());
        assertCondition(activePosition().line === 1, 'next navigation missed first TODO');
        await runCommand(result, 'better-todo-tree.goToNext');
        result.navigation.push(activePosition());
        assertCondition(activePosition().line === 3, 'next navigation missed second TODO');
        await runCommand(result, 'better-todo-tree.goToPrevious');
        result.navigation.push(activePosition());
        assertCondition(activePosition().line === 1, 'previous navigation missed first TODO');

        const revealSelection = new vscode.Selection(new vscode.Position(4, 3), new vscode.Position(4, 3));
        await runCommand(result, 'better-todo-tree.revealInFile', source.sourceUri, { selection: revealSelection });
        result.navigation.push(activePosition());
        assertCondition(activePosition().line === 4, 'reveal in file selection mismatch');

        await checkScanMode(result, 'better-todo-tree.scanOpenFilesOnly', 'open files');
        await checkScanMode(result, 'better-todo-tree.scanCurrentFileOnly', 'current file');
        await checkScanMode(result, 'better-todo-tree.scanWorkspaceAndOpenFiles', 'workspace');
        await checkScanMode(result, 'better-todo-tree.scanWorkspaceOnly', 'workspace only');
        result.settingChecks.scanMode = targetConfiguration().get('tree.scanMode');

        await checkToggle(result, 'better-todo-tree.toggleItemCounts', 'tree.showCountsInTree');
        await checkToggle(result, 'better-todo-tree.toggleBadges', 'tree.showBadges');
        await checkToggle(result, 'better-todo-tree.toggleCompactFolders', 'tree.disableCompactFolders');

        for (const command of [
            'better-todo-tree.showFlatView',
            'better-todo-tree.showTagsOnlyView',
            'better-todo-tree.showTreeView',
            'better-todo-tree.cycleViewStyle',
            'better-todo-tree.groupByTag',
            'better-todo-tree.ungroupByTag',
            'better-todo-tree.groupBySubTag',
            'better-todo-tree.ungroupBySubTag',
            'better-todo-tree.expand',
            'better-todo-tree.collapse',
            'better-todo-tree.toggleTreeExpansion',
            'better-todo-tree.filterClear',
            'better-todo-tree.resetAllFilters',
            'better-todo-tree.reveal',
            'better-todo-tree.resetCache',
            'better-todo-tree.refresh'
        ]) {
            await runCommand(result, command);
            await delay(100);
        }

        result.settingChecks.itemCountsRestored = targetConfiguration().get('tree.showCountsInTree');
        result.settingChecks.badgesRestored = targetConfiguration().get('tree.showBadges');
        result.settingChecks.compactFoldersRestored = targetConfiguration().get('tree.disableCompactFolders');

        trace('begin transient document');
        const transientPath = path.join(workspaceRoot, '.qa-transient.js');
        fs.writeFileSync(transientPath, '// TODO transient editor lifecycle probe\n', 'utf8');
        const transientDocument = await vscode.workspace.openTextDocument(vscode.Uri.file(transientPath));
        trace('end transient document');
        await vscode.window.showTextDocument(transientDocument, { preview: false });
        trace('end transient editor');
        await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
        trace('end transient close');
        await waitFor(() => {
            return vscode.window.visibleTextEditors.some((editor) => {
                return editor.document.uri.toString() === transientDocument.uri.toString();
            }) === false;
        }, 'transient editor remained visible');
        await delay(700);
        trace('end transient delay');
        result.lifecycleChecks.closedEditorDelaySettled = vscode.window.visibleTextEditors.some((editor) => {
            return editor.document.uri.toString() === transientDocument.uri.toString();
        }) === false;
        assertCondition(result.lifecycleChecks.closedEditorDelaySettled === true, 'transient editor returned');
        await checkHighlightSchema(result, workspaceRoot, 'after-commands');
        await checkNotebookEditors(result, workspaceRoot);

        result.unexecutedCommands = contributed.filter((entry) => {
            return result.executedCommands.includes(entry) !== true;
        });
        assertCondition(result.unexecutedCommands.length === 0, 'contributed command execution incomplete');
        result.success = true;
        trace('end probe');
    } catch (error) {
        trace(`error ${error.name}: ${error.message}`);
        result.error = {
            name: error.name,
            code: error.code,
            cause: error.cause && error.cause.message,
            message: error.message,
            stack: error.stack
        };
    }

    writeJsonAtomic(RESULT_PATH, result);
}

function activate() {
    waitFor(() => fs.existsSync(process.env.BETTER_TODO_TREE_QA_START), 'probe start signal missing', 60000)
        .then(async () => {
            if (process.env.BETTER_TODO_TREE_QA_MODE === 'migration') {
                const result = await require('./migration.js').run({
                    captureCheckpoint, waitFor, runInteractedCommand, requireRegisteredCommand
                });
                writeJsonAtomic(RESULT_PATH, result);
            } else if (process.env.BETTER_TODO_TREE_QA_MODE === 'settings') {
                const result = await require('./settings.js').run({
                    captureCheckpoint, waitFor, runInteractedCommand, requireRegisteredCommand,
                    checkHighlightSchema, delay, writeJsonAtomic
                });
                writeJsonAtomic(RESULT_PATH, result);
            } else {
                await executeProbe();
            }
        }).catch((error) => {
        writeJsonAtomic(RESULT_PATH, {
            schemaVersion: 1,
            success: false,
            error: {
                name: error.name,
                code: error.code,
                cause: error.cause && error.cause.message,
                operation: error.operation,
                message: error.message,
                stack: error.stack
            }
        });
    });
}

module.exports = { activate };
