var childProcess = require( 'child_process' );
var fs = require( 'fs' );
var os = require( 'os' );
var path = require( 'path' );

function makeExecutable( filePath, contents )
{
    fs.writeFileSync( filePath, contents, { mode: 0o755 } );
}

function createWorkspace()
{
    var tempDirectory = fs.mkdtempSync( path.join( os.tmpdir(), 'better-todo-tree-release-' ) );
    var binDirectory = path.join( tempDirectory, 'bin' );
    var artifactsDirectory = path.join( tempDirectory, 'artifacts', 'release' );

    fs.mkdirSync( binDirectory, { recursive: true } );
    fs.mkdirSync( artifactsDirectory, { recursive: true } );

    return {
        root: tempDirectory,
        bin: binDirectory,
        artifacts: artifactsDirectory
    };
}

function createReleaseGitWorkspace()
{
    var workspace = createWorkspace();
    var remotePath = path.join( workspace.root, 'origin.git' );
    var env = Object.assign( {}, process.env, {
        GIT_AUTHOR_NAME: 'Codex',
        GIT_AUTHOR_EMAIL: 'codex@example.invalid',
        GIT_COMMITTER_NAME: 'Codex',
        GIT_COMMITTER_EMAIL: 'codex@example.invalid'
    } );

    fs.writeFileSync( path.join( workspace.root, 'package.json' ), JSON.stringify( { version: '0.0.225' }, null, 2 ) + '\n' );
    childProcess.spawnSync( 'git', [ 'init', '-b', 'master' ], { cwd: workspace.root, encoding: 'utf8', env: env } );
    childProcess.spawnSync( 'git', [ 'add', 'package.json' ], { cwd: workspace.root, encoding: 'utf8', env: env } );
    childProcess.spawnSync( 'git', [ 'commit', '-m', 'release test fixture' ], { cwd: workspace.root, encoding: 'utf8', env: env } );
    childProcess.spawnSync( 'git', [ 'init', '--bare', remotePath ], { cwd: workspace.root, encoding: 'utf8', env: env } );
    childProcess.spawnSync( 'git', [ 'remote', 'add', 'origin', remotePath ], { cwd: workspace.root, encoding: 'utf8', env: env } );
    childProcess.spawnSync( 'git', [ 'push', '-u', 'origin', 'master' ], { cwd: workspace.root, encoding: 'utf8', env: env } );
    childProcess.spawnSync( 'git', [ 'tag', '-a', 'v0.0.225', '-m', 'release' ], { cwd: workspace.root, encoding: 'utf8', env: env } );
    childProcess.spawnSync( 'git', [ 'push', 'origin', 'v0.0.225' ], { cwd: workspace.root, encoding: 'utf8', env: env } );

    return workspace;
}

function runScript( scriptPath, options )
{
    return childProcess.spawnSync( 'bash', [ scriptPath ], {
        cwd: options.cwd,
        encoding: 'utf8',
        env: options.env
    } );
}

QUnit.module( 'release workflow scripts' );

QUnit.test( 'release-artifacts enumerates release VSIX files in a stable order', function( assert )
{
    var workspace = createWorkspace();
    var result;

    fs.writeFileSync( path.join( workspace.artifacts, 'better-todo-tree-0.0.225-web.vsix' ), 'web' );
    fs.writeFileSync( path.join( workspace.artifacts, 'better-todo-tree-0.0.225-linux-x64.vsix' ), 'linux' );

    result = childProcess.spawnSync(
        'bash',
        [
            '-lc',
            '. "' + path.join( __dirname, '..', 'scripts', 'release', 'release-artifacts.sh' ) + '" && release_artifact_files'
        ],
        {
            cwd: workspace.root,
            encoding: 'utf8',
            env: process.env
        }
    );

    assert.strictEqual( result.status, 0, result.stderr );
    assert.deepEqual(
        result.stdout.trim().split( /\r?\n/ ),
        [
            'artifacts/release/better-todo-tree-0.0.225-linux-x64.vsix',
            'artifacts/release/better-todo-tree-0.0.225-web.vsix'
        ]
    );
} );

QUnit.test( 'publish-vscode-marketplace publishes every VSIX with duplicate-safe flags', function( assert )
{
    var workspace = createWorkspace();
    var callLogPath = path.join( workspace.root, 'npx.log' );
    var env = Object.assign( {}, process.env, {
        PATH: workspace.bin + path.delimiter + process.env.PATH,
        VSCE_PAT: 'vsce-test-token'
    } );

    fs.writeFileSync( path.join( workspace.artifacts, 'better-todo-tree-0.0.225-linux-x64.vsix' ), 'linux' );
    fs.writeFileSync( path.join( workspace.artifacts, 'better-todo-tree-0.0.225-web.vsix' ), 'web' );

    makeExecutable(
        path.join( workspace.bin, 'npx' ),
        '#!/usr/bin/env bash\n' +
        'printf "%s\\n" "$*" >> "' + callLogPath + '"\n'
    );

    var result = runScript( path.join( __dirname, '..', 'scripts', 'release', 'publish-vscode-marketplace.sh' ), {
        cwd: workspace.root,
        env: env
    } );
    var callLog = fs.readFileSync( callLogPath, 'utf8' );

    assert.strictEqual( result.status, 0, result.stderr );
    assert.ok( callLog.indexOf( '@vscode/vsce publish --packagePath artifacts/release/better-todo-tree-0.0.225-linux-x64.vsix -p vsce-test-token --skip-duplicate' ) !== -1 );
    assert.ok( callLog.indexOf( '@vscode/vsce publish --packagePath artifacts/release/better-todo-tree-0.0.225-web.vsix -p vsce-test-token --skip-duplicate' ) !== -1 );
    assert.ok( callLog.indexOf( 'ovsx publish' ) === -1 );
} );

QUnit.test( 'publish-open-vsx publishes every VSIX with duplicate-safe flags', function( assert )
{
    var workspace = createWorkspace();
    var callLogPath = path.join( workspace.root, 'npx.log' );
    var env = Object.assign( {}, process.env, {
        PATH: workspace.bin + path.delimiter + process.env.PATH,
        OVSX_PAT: 'ovsx-test-token'
    } );

    fs.writeFileSync( path.join( workspace.artifacts, 'better-todo-tree-0.0.225-linux-x64.vsix' ), 'linux' );
    fs.writeFileSync( path.join( workspace.artifacts, 'better-todo-tree-0.0.225-web.vsix' ), 'web' );

    makeExecutable(
        path.join( workspace.bin, 'npx' ),
        '#!/usr/bin/env bash\n' +
        'printf "%s\\n" "$*" >> "' + callLogPath + '"\n'
    );

    var result = runScript( path.join( __dirname, '..', 'scripts', 'release', 'publish-open-vsx.sh' ), {
        cwd: workspace.root,
        env: env
    } );
    var callLog = fs.readFileSync( callLogPath, 'utf8' );

    assert.strictEqual( result.status, 0, result.stderr );
    assert.ok( callLog.indexOf( 'ovsx publish --packagePath artifacts/release/better-todo-tree-0.0.225-linux-x64.vsix -p ovsx-test-token --skip-duplicate' ) !== -1 );
    assert.ok( callLog.indexOf( 'ovsx publish --packagePath artifacts/release/better-todo-tree-0.0.225-web.vsix -p ovsx-test-token --skip-duplicate' ) !== -1 );
    assert.ok( callLog.indexOf( '@vscode/vsce publish' ) === -1 );
} );

QUnit.test( 'bootstrap-release-environment creates the release environment and marketplace secret', function( assert )
{
    var workspace = createWorkspace();
    var callLogPath = path.join( workspace.root, 'gh.log' );
    var env = Object.assign( {}, process.env, {
        PATH: workspace.bin + path.delimiter + process.env.PATH,
        VSCE_PAT: 'vsce-test-token'
    } );

    makeExecutable(
        path.join( workspace.bin, 'gh' ),
        '#!/usr/bin/env bash\n' +
        'printf "%s\\n" "$*" >> "' + callLogPath + '"\n' +
        'if [[ "$1 $2" == "repo view" ]]; then\n' +
        '  printf "FanaticPythoner\\nbetter-todo-tree\\n"\n' +
        '  exit 0\n' +
        'fi\n'
    );

    var result = runScript( path.join( __dirname, '..', 'scripts', 'release', 'bootstrap-release-environment.sh' ), {
        cwd: workspace.root,
        env: env
    } );
    var callLog = fs.readFileSync( callLogPath, 'utf8' );

    assert.strictEqual( result.status, 0, result.stderr );
    assert.ok( result.stdout.indexOf( "Configured environment 'release' for FanaticPythoner/better-todo-tree." ) !== -1 );
    assert.ok( result.stdout.indexOf( 'Stored environment secrets: VSCE_PAT' ) !== -1 );
    assert.ok( callLog.indexOf( 'repo view --json owner,name --jq .owner.login, .name' ) !== -1 );
    assert.ok( callLog.indexOf( 'api --method PUT -H Accept: application/vnd.github+json repos/FanaticPythoner/better-todo-tree/environments/release' ) !== -1 );
    assert.ok( callLog.indexOf( 'secret set VSCE_PAT --env release --repo FanaticPythoner/better-todo-tree --body vsce-test-token' ) !== -1 );
    assert.ok( callLog.indexOf( 'secret set OVSX_PAT' ) === -1 );
} );

QUnit.test( 'bootstrap-release-environment adds the optional Open VSX secret when provided', function( assert )
{
    var workspace = createWorkspace();
    var callLogPath = path.join( workspace.root, 'gh.log' );
    var env = Object.assign( {}, process.env, {
        PATH: workspace.bin + path.delimiter + process.env.PATH,
        OWNER: 'FanaticPythoner',
        REPO: 'better-todo-tree',
        ENV_NAME: 'release',
        VSCE_PAT: 'vsce-test-token',
        OVSX_PAT: 'ovsx-test-token'
    } );

    makeExecutable(
        path.join( workspace.bin, 'gh' ),
        '#!/usr/bin/env bash\n' +
        'printf "%s\\n" "$*" >> "' + callLogPath + '"\n'
    );

    var result = runScript( path.join( __dirname, '..', 'scripts', 'release', 'bootstrap-release-environment.sh' ), {
        cwd: workspace.root,
        env: env
    } );
    var callLog = fs.readFileSync( callLogPath, 'utf8' );

    assert.strictEqual( result.status, 0, result.stderr );
    assert.ok( result.stdout.indexOf( 'Stored environment secrets: VSCE_PAT, OVSX_PAT' ) !== -1 );
    assert.ok( callLog.indexOf( 'secret set OVSX_PAT --env release --repo FanaticPythoner/better-todo-tree --body ovsx-test-token' ) !== -1 );
} );

QUnit.test( 'create-github-release creates a prerelease when one does not exist', function( assert )
{
    var workspace = createWorkspace();
    var callLogPath = path.join( workspace.root, 'gh.log' );
    var env = Object.assign( {}, process.env, {
        PATH: workspace.bin + path.delimiter + process.env.PATH,
        GH_TOKEN: 'gh-test-token',
        RELEASE_TAG: 'v0.0.225',
        PRERELEASE: 'true'
    } );

    fs.writeFileSync( path.join( workspace.artifacts, 'better-todo-tree-0.0.225-linux-x64.vsix' ), 'linux' );

    makeExecutable(
        path.join( workspace.bin, 'gh' ),
        '#!/usr/bin/env bash\n' +
        'printf "%s\\n" "$*" >> "' + callLogPath + '"\n' +
        'if [[ "$1 $2" == "release view" ]]; then\n' +
        '  exit 1\n' +
        'fi\n'
    );

    var result = runScript( path.join( __dirname, '..', 'scripts', 'release', 'create-github-release.sh' ), {
        cwd: workspace.root,
        env: env
    } );
    var callLog = fs.readFileSync( callLogPath, 'utf8' );

    assert.strictEqual( result.status, 0, result.stderr );
    assert.ok( callLog.indexOf( 'release view v0.0.225' ) !== -1 );
    assert.ok( callLog.indexOf( 'release create v0.0.225 artifacts/release/better-todo-tree-0.0.225-linux-x64.vsix --generate-notes --verify-tag --prerelease' ) !== -1 );
} );

QUnit.test( 'create-github-release uploads assets when the release already exists', function( assert )
{
    var workspace = createWorkspace();
    var callLogPath = path.join( workspace.root, 'gh.log' );
    var env = Object.assign( {}, process.env, {
        PATH: workspace.bin + path.delimiter + process.env.PATH,
        GH_TOKEN: 'gh-test-token',
        RELEASE_TAG: 'v0.0.225',
        PRERELEASE: 'false'
    } );

    fs.writeFileSync( path.join( workspace.artifacts, 'better-todo-tree-0.0.225-linux-x64.vsix' ), 'linux' );
    fs.writeFileSync( path.join( workspace.artifacts, 'better-todo-tree-0.0.225-web.vsix' ), 'web' );

    makeExecutable(
        path.join( workspace.bin, 'gh' ),
        '#!/usr/bin/env bash\n' +
        'printf "%s\\n" "$*" >> "' + callLogPath + '"\n' +
        'if [[ "$1 $2" == "release view" ]]; then\n' +
        '  exit 0\n' +
        'fi\n'
    );

    var result = runScript( path.join( __dirname, '..', 'scripts', 'release', 'create-github-release.sh' ), {
        cwd: workspace.root,
        env: env
    } );
    var callLog = fs.readFileSync( callLogPath, 'utf8' );

    assert.strictEqual( result.status, 0, result.stderr );
    assert.ok( callLog.indexOf( 'release upload v0.0.225 artifacts/release/better-todo-tree-0.0.225-linux-x64.vsix artifacts/release/better-todo-tree-0.0.225-web.vsix --clobber' ) !== -1 );
    assert.ok( callLog.indexOf( 'release create v0.0.225' ) === -1 );
} );

QUnit.test( 'resolve-release-metadata validates the tag and emits release outputs', function( assert )
{
    var workspace = createReleaseGitWorkspace();
    var env = Object.assign( {}, process.env, {
        GITHUB_OUTPUT: '',
        INPUT_TAG: 'v0.0.225',
        REF_NAME: 'master',
        REF_TYPE: 'branch'
    } );
    var result = childProcess.spawnSync(
        'bash',
        [ path.join( __dirname, '..', 'scripts', 'release', 'resolve-release-metadata.sh' ) ],
        {
            cwd: workspace.root,
            encoding: 'utf8',
            env: env
        }
    );

    assert.strictEqual( result.status, 0, result.stderr );
    assert.ok( result.stdout.indexOf( 'tag=v0.0.225' ) !== -1 );
    assert.ok( result.stdout.indexOf( 'prerelease=false' ) !== -1 );
    assert.ok( result.stdout.indexOf( 'release_ref=v0.0.225' ) !== -1 );
    assert.ok( /^release_sha=[0-9a-f]{40}$/m.test( result.stdout ) );
} );
