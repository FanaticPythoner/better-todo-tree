var fs = require( 'fs' );
var path = require( 'path' );
var regexRegistry = require( '../src/regexRegistry.js' );

var ACTION_REVISIONS = Object.freeze( {
    actionsCache: Object.freeze( {
        action: 'actions/cache',
        ref: '55cc8345863c7cc4c66a329aec7e433d2d1c52a9',
        version: 'v6.1.0'
    } ),
    attestBuildProvenance: Object.freeze( {
        action: 'actions/attest-build-provenance',
        ref: '0f67c3f4856b2e3261c31976d6725780e5e4c373',
        version: 'v4.1.1'
    } ),
    codeql: Object.freeze( {
        actionAnalyze: 'github/codeql-action/analyze',
        actionInit: 'github/codeql-action/init',
        ref: '54f647b7e1bb85c95cddabcd46b0c578ec92bc1a',
        version: 'v4.36.3'
    } )
} );

function readWorkflow( workflowName )
{
    return fs.readFileSync( path.join( __dirname, '..', '.github', 'workflows', workflowName ), 'utf8' );
}

function getWorkflowPaths()
{
    return fs.readdirSync( path.join( __dirname, '..', '.github', 'workflows' ) )
        .filter( function( fileName )
        {
            return fileName.endsWith( '.yml' );
        } )
        .map( function( fileName )
        {
            return path.join( __dirname, '..', '.github', 'workflows', fileName );
        } );
}

function getExternalActionReferences( contents )
{
    return contents.split( regexRegistry.createRegExp( 'optionalCarriageReturnLineBreak' ) )
        .reduce( function( references, line )
        {
            var match = line.match( regexRegistry.createRegExp( 'workflowUsesLine' ) );
            if( !match || match[ 1 ].indexOf( './' ) === 0 )
            {
                return references;
            }

            references.push( parseActionReference( match[ 1 ] ) );
            return references;
        }, [] );
}

function parseActionReference( reference )
{
    var parts = reference.split( '@' );
    if( parts.length !== 2 || !parts[ 0 ] || !parts[ 1 ] )
    {
        throw new Error( 'workflow action reference: expected owner/repo[/path]@sha' );
    }

    return {
        action: parts[ 0 ],
        ref: parts[ 1 ],
        text: reference
    };
}

function getActionReferences( references, action )
{
    return references.filter( function( reference )
    {
        return reference.action === action;
    } );
}

function workflowAssertionMessage( label, message )
{
    return label ? label + ': ' + message : message;
}

function isFullCommitSha( ref )
{
    return regexRegistry.createRegExp( 'sha1Lowercase' ).test( ref );
}

function assertFullCommitSha( assert, ref, message )
{
    assert.ok( isFullCommitSha( ref ), message );
}

function assertPinnedAction( assert, references, action, label )
{
    var actionReferences = getActionReferences( references, action );
    var reference = actionReferences[ 0 ];

    assert.equal(
        actionReferences.length,
        1,
        workflowAssertionMessage( label, action + ' is configured once' )
    );
    if( actionReferences.length !== 1 )
    {
        throw new Error( 'workflow action reference count mismatch: ' + action );
    }
    assertFullCommitSha(
        assert,
        reference.ref,
        workflowAssertionMessage( label, action + ' uses a full commit SHA' )
    );

    return reference;
}

function assertWorkflowActionRevision( assert, workflowName, expectedRevision )
{
    var reference = assertPinnedAction(
        assert,
        getExternalActionReferences( readWorkflow( workflowName ) ),
        expectedRevision.action,
        workflowName
    );

    assert.equal(
        reference.ref,
        expectedRevision.ref,
        workflowAssertionMessage(
            workflowName,
            expectedRevision.action + ' uses ' + expectedRevision.version + ' release SHA'
        )
    );
}

function createActionReference( action, ref )
{
    if( !isFullCommitSha( ref ) )
    {
        throw new Error( 'workflow action revision invalid: ' + action );
    }

    return action + '@' + ref;
}

function withActionRevision( contents, action, ref )
{
    var actionReferences = getActionReferences( getExternalActionReferences( contents ), action );

    if( actionReferences.length !== 1 )
    {
        throw new Error( 'workflow action reference count mismatch: ' + action );
    }

    return contents.split( actionReferences[ 0 ].text ).join( createActionReference( action, ref ) );
}

function withActionRevisions( contents, revisions )
{
    return revisions.reduce( function( updatedContents, revision )
    {
        return withActionRevision( updatedContents, revision.action, revision.ref );
    }, contents );
}

function getWorkflowJobBlock( contents, jobName )
{
    var lines = contents.split( regexRegistry.createRegExp( 'optionalCarriageReturnLineBreak' ) );
    var start = lines.findIndex( function( line )
    {
        return line === '  ' + jobName + ':';
    } );
    if( start === -1 )
    {
        return '';
    }

    var end = lines.findIndex( function( line, index )
    {
        return index > start && regexRegistry.createRegExp( 'workflowJobHeaderLine' ).test( line );
    } );
    return lines.slice( start, end === -1 ? lines.length : end ).join( '\n' );
}

function assertSecurityWorkflowContract( assert, securityWorkflow, label )
{
    var references = getExternalActionReferences( securityWorkflow );
    var dependencyReview = assertPinnedAction( assert, references, 'actions/dependency-review-action', label );
    var codeqlInit = assertPinnedAction( assert, references, ACTION_REVISIONS.codeql.actionInit, label );
    var codeqlAnalyze = assertPinnedAction( assert, references, ACTION_REVISIONS.codeql.actionAnalyze, label );
    var dependencyReviewJob = getWorkflowJobBlock( securityWorkflow, 'dependency-review' );
    var codeqlJob = getWorkflowJobBlock( securityWorkflow, 'codeql' );

    assert.equal(
        codeqlInit.ref,
        codeqlAnalyze.ref,
        workflowAssertionMessage( label, 'CodeQL init and analyze use the same action revision' )
    );
    assert.equal(
        codeqlInit.ref,
        ACTION_REVISIONS.codeql.ref,
        workflowAssertionMessage(
            label,
            'CodeQL action uses ' + ACTION_REVISIONS.codeql.version + ' release SHA'
        )
    );
    assert.ok(
        dependencyReviewJob.indexOf( "if: github.event_name == 'pull_request'" ) !== -1,
        workflowAssertionMessage( label, 'dependency review runs only on pull requests' )
    );
    assert.ok(
        dependencyReviewJob.indexOf( dependencyReview.text ) !== -1,
        workflowAssertionMessage( label, 'dependency review job uses the pinned action reference' )
    );
    assert.ok(
        codeqlJob.indexOf( 'security-events: write' ) !== -1,
        workflowAssertionMessage( label, 'CodeQL job can write code scanning results' )
    );
    assert.ok(
        codeqlJob.indexOf( 'fail-fast: true' ) !== -1,
        workflowAssertionMessage( label, 'CodeQL matrix fails fast' )
    );
    assert.ok(
        codeqlJob.indexOf( 'fail-fast: false' ) === -1,
        workflowAssertionMessage( label, 'CodeQL matrix does not disable fail-fast' )
    );
    assert.ok(
        codeqlJob.indexOf( '- language: javascript-typescript' ) !== -1 &&
            codeqlJob.indexOf( 'category: /language:javascript-typescript' ) !== -1,
        workflowAssertionMessage( label, 'CodeQL matrix scans JavaScript and TypeScript with a stable category' )
    );
    assert.ok(
        codeqlJob.indexOf( '- language: actions' ) !== -1 &&
            codeqlJob.indexOf( 'category: /language:actions' ) !== -1,
        workflowAssertionMessage( label, 'CodeQL matrix scans GitHub Actions with a stable category' )
    );
    assert.ok(
        codeqlJob.indexOf( 'category: ${{ matrix.category }}' ) !== -1,
        workflowAssertionMessage( label, 'CodeQL analyze reads explicit matrix category values' )
    );
    assert.ok(
        codeqlJob.indexOf( 'if: matrix.setup-node' ) !== -1,
        workflowAssertionMessage( label, 'Node setup is scoped to JavaScript analysis' )
    );
}

QUnit.module( 'GitHub workflows' );

QUnit.test( 'external workflow actions are pinned to full commit SHAs', function( assert )
{
    getWorkflowPaths().forEach( function( workflowPath )
    {
        var contents = fs.readFileSync( workflowPath, 'utf8' );
        getExternalActionReferences( contents ).forEach( function( reference )
        {
            assertFullCommitSha(
                assert,
                reference.ref,
                path.basename( workflowPath ) + ' pins ' + reference.text
            );
        } );
    } );
} );

QUnit.test( 'release workflow requests provenance-related permissions', function( assert )
{
    var contents = readWorkflow( 'release.yml' );

    assert.ok( contents.indexOf( 'id-token: write' ) !== -1 );
    assert.ok( contents.indexOf( 'attestations: write' ) !== -1 );
    assert.ok( contents.indexOf( 'contents: write' ) !== -1 );
} );

QUnit.test( 'cache and provenance workflow actions use Dependabot release SHAs', function( assert )
{
    [ 'ci.yml', 'latest.yml', 'release.yml' ].forEach( function( workflowName )
    {
        assertWorkflowActionRevision( assert, workflowName, ACTION_REVISIONS.actionsCache );
    } );

    assertWorkflowActionRevision( assert, 'release.yml', ACTION_REVISIONS.attestBuildProvenance );
} );

QUnit.test( 'latest workflow publishes a moving prerelease from master', function( assert )
{
    var latestWorkflow = readWorkflow( 'latest.yml' );
    var movingReleaseScript = fs.readFileSync( path.join( __dirname, '..', 'scripts', 'release', 'create-or-update-moving-github-release.sh' ), 'utf8' );

    assert.ok( latestWorkflow.indexOf( 'push:\n    branches:\n      - master' ) !== -1 );
    assert.ok( latestWorkflow.indexOf( 'schedule:' ) !== -1 );
    assert.ok( latestWorkflow.indexOf( 'group: latest-master' ) !== -1 );
    assert.ok( latestWorkflow.indexOf( "RELEASE_TAG: latest" ) !== -1 );
    assert.ok( latestWorkflow.indexOf( 'RELEASE_TARGET_BRANCH: master' ) !== -1 );
    assert.ok( latestWorkflow.indexOf( 'run: bash scripts/release/create-or-update-moving-github-release.sh' ) !== -1 );
    assert.ok( movingReleaseScript.indexOf( 'git push --force origin "refs/tags/$RELEASE_TAG"' ) !== -1 );
    assert.ok( movingReleaseScript.indexOf( 'gh release delete "$RELEASE_TAG" --yes' ) !== -1 );
    assert.ok( movingReleaseScript.indexOf( 'write-release-notes.sh' ) !== -1 );
    assert.ok( movingReleaseScript.indexOf( '--channel latest' ) !== -1 );
    assert.ok( movingReleaseScript.indexOf( '--prerelease' ) !== -1 );
} );

QUnit.test( 'release workflows build and publish from the resolved release ref', function( assert )
{
    var releaseWorkflow = readWorkflow( 'release.yml' );
    var reusableBuildWorkflow = readWorkflow( 'reusable-build-vsix.yml' );
    var publishVsCodeScript = fs.readFileSync( path.join( __dirname, '..', 'scripts', 'release', 'publish-vscode-marketplace.sh' ), 'utf8' );
    var publishOpenVsxScript = fs.readFileSync( path.join( __dirname, '..', 'scripts', 'release', 'publish-open-vsx.sh' ), 'utf8' );
    var githubReleaseScript = fs.readFileSync( path.join( __dirname, '..', 'scripts', 'release', 'create-github-release.sh' ), 'utf8' );
    var releaseArtifactsScript = fs.readFileSync( path.join( __dirname, '..', 'scripts', 'release', 'release-artifacts.sh' ), 'utf8' );
    var renderMarketplaceChangelogScript = fs.readFileSync( path.join( __dirname, '..', 'scripts', 'release', 'render-marketplace-changelog.sh' ), 'utf8' );
    var verifyMarketplaceScript = fs.readFileSync( path.join( __dirname, '..', 'scripts', 'release', 'verify-vscode-marketplace.sh' ), 'utf8' );

    assert.ok( releaseWorkflow.indexOf( 'release_ref: ${{ steps.meta.outputs.release_ref }}' ) !== -1 );
    assert.ok( releaseWorkflow.indexOf( 'ref: ${{ needs.preflight.outputs.release_ref }}' ) !== -1 );
    assert.ok( releaseWorkflow.indexOf( 'run: bash scripts/release/resolve-release-metadata.sh' ) !== -1 );
    assert.ok( releaseWorkflow.indexOf( 'verify-marketplace:' ) !== -1 );
    assert.ok( releaseWorkflow.indexOf( 'publish:' ) !== -1 );
    assert.ok( releaseWorkflow.indexOf( 'run: bash scripts/release/publish-vscode-marketplace.sh' ) !== -1 );
    assert.ok( releaseWorkflow.indexOf( 'run: bash scripts/release/publish-open-vsx.sh' ) !== -1 );
    assert.ok( releaseWorkflow.indexOf( 'continue-on-error: true' ) === -1 );
    assert.ok( releaseWorkflow.indexOf( 'timeout-minutes: 4320' ) !== -1 );
    assert.ok( releaseWorkflow.indexOf( 'OPEN_VSX_RETRY_INTERVAL_SECONDS: 300' ) !== -1 );
    assert.ok( releaseWorkflow.indexOf( 'steps.publish_open_vsx.outcome }}" == \'failure\'' ) !== -1 );
    assert.ok( releaseWorkflow.indexOf( '::warning::Open VSX publication failed after VS Code Marketplace publication completed.' ) !== -1 );
    assert.ok( releaseWorkflow.indexOf( 'run: bash scripts/release/create-github-release.sh' ) !== -1 );
    assert.ok( releaseWorkflow.indexOf( 'run: bash scripts/release/verify-vscode-marketplace.sh' ) !== -1 );
    assert.ok( releaseWorkflow.indexOf( 'github-release:\n    needs:\n      - preflight\n      - publish' ) !== -1 );
    assert.ok( releaseWorkflow.indexOf( 'publish-open-vsx:' ) === -1 );
    assert.ok( reusableBuildWorkflow.indexOf( 'ref:' ) !== -1 );
    assert.ok( reusableBuildWorkflow.indexOf( 'ref: ${{ inputs.ref }}' ) !== -1 );
    assert.ok( reusableBuildWorkflow.indexOf( 'fetch-depth: 0' ) !== -1 );
    assert.ok( reusableBuildWorkflow.indexOf( 'release_tag:' ) !== -1 );
    assert.ok( reusableBuildWorkflow.indexOf( 'run: bash scripts/release/render-marketplace-changelog.sh --through-tag "${{ inputs.release_tag }}"' ) !== -1 );
    assert.ok( publishVsCodeScript.indexOf( '@vscode/vsce publish' ) !== -1 );
    assert.ok( publishVsCodeScript.indexOf( '--skip-duplicate' ) !== -1 );
    assert.ok( publishOpenVsxScript.indexOf( 'ovsx_args=(--no-install ovsx)' ) !== -1 );
    assert.ok( publishOpenVsxScript.indexOf( 'publish --packagePath' ) !== -1 );
    assert.ok( publishOpenVsxScript.indexOf( '--skip-duplicate' ) !== -1 );
    assert.ok( publishOpenVsxScript.indexOf( 'status (408|425|429|500|502|503|504)' ) !== -1 );
    assert.ok( publishOpenVsxScript.indexOf( 'OPEN_VSX_RETRY_INTERVAL_SECONDS' ) !== -1 );
    assert.ok( releaseArtifactsScript.indexOf( "No VSIX artifacts were found in '" ) !== -1 );
    assert.ok( githubReleaseScript.indexOf( 'release_artifact_files' ) !== -1 );
    assert.ok( githubReleaseScript.indexOf( "gh release view \"$RELEASE_TAG\"" ) !== -1 );
    assert.ok( githubReleaseScript.indexOf( 'gh release upload "$RELEASE_TAG" "${files[@]}" --clobber' ) !== -1 );
    assert.ok( renderMarketplaceChangelogScript.indexOf( 'Stable release notes published to GitHub are mirrored here for Marketplace version history.' ) !== -1 );
    assert.ok( renderMarketplaceChangelogScript.indexOf( '## Upstream Todo Tree history' ) !== -1 );
    assert.ok( verifyMarketplaceScript.indexOf( 'render-marketplace-changelog.sh' ) !== -1 );
    assert.ok( verifyMarketplaceScript.indexOf( 'verify-vscode-marketplace.py' ) !== -1 );
} );

QUnit.test( 'ci workflow uploads only the smoke-test linux artifact', function( assert )
{
    var ciWorkflow = readWorkflow( 'ci.yml' );

    assert.ok( ciWorkflow.indexOf( 'rm -rf artifacts/vsix' ) !== -1 );
    assert.ok( ciWorkflow.indexOf( 'artifacts/vsix/*-linux-x64.vsix' ) !== -1 );
    assert.ok( ciWorkflow.indexOf( 'actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a' ) !== -1 );
} );

QUnit.test( 'VSIX builder stages one ripgrep-universal binary for each native target', function( assert )
{
    var buildScript = fs.readFileSync( path.join( __dirname, '..', 'scripts', 'release', 'build-vsix.mjs' ), 'utf8' );

    assert.ok( buildScript.indexOf( "node_modules', '@vscode', 'ripgrep-universal'" ) !== -1 );
    assert.ok( buildScript.indexOf( "import { binPathFor } from '@vscode/ripgrep-universal';" ) !== -1 );
    assert.ok( buildScript.indexOf( "['linux-armhf', Object.freeze({ os: 'linux', arch: 'arm' })]" ) !== -1 );
    assert.ok( buildScript.indexOf( "['alpine-x64', Object.freeze({ os: 'linux', arch: 'x64' })]" ) !== -1 );
    assert.ok( buildScript.indexOf( "['alpine-arm64', Object.freeze({ os: 'linux', arch: 'arm64' })]" ) !== -1 );
    assert.ok( buildScript.indexOf( "fs.chmodSync(destinationPath, platform.os === 'win32' ? 0o644 : 0o755)" ) !== -1 );
    assert.ok( buildScript.indexOf( "copyRipgrepPackageFile('LICENSE')" ) !== -1 );
    assert.ok( buildScript.indexOf( "const { pack } = require('@vscode/vsce/out/package.js')" ) !== -1 );
    assert.ok( buildScript.indexOf( 'dependencies: false' ) !== -1 );
    assert.ok( buildScript.indexOf( 'finally {\n        resetRipgrepStage();\n    }' ) !== -1 );
} );

QUnit.test( 'security workflow keeps dependency review and CodeQL coverage pinned', function( assert )
{
    assertSecurityWorkflowContract( assert, readWorkflow( 'security.yml' ) );
} );

QUnit.test( 'dependency review and latest CodeQL action revisions satisfy security workflow contract', function( assert )
{
    var securityWorkflow = readWorkflow( 'security.yml' );
    var regressionFixtures = [
        {
            name: 'PR 20 dependency review',
            revisions: [
                {
                    action: 'actions/dependency-review-action',
                    ref: 'a1d282b36b6f3519aa1f3fc636f609c47dddb294'
                }
            ]
        },
        {
            name: 'CodeQL ' + ACTION_REVISIONS.codeql.version,
            revisions: [
                {
                    action: ACTION_REVISIONS.codeql.actionInit,
                    ref: ACTION_REVISIONS.codeql.ref
                },
                {
                    action: ACTION_REVISIONS.codeql.actionAnalyze,
                    ref: ACTION_REVISIONS.codeql.ref
                }
            ]
        }
    ];

    regressionFixtures.forEach( function( fixture )
    {
        assertSecurityWorkflowContract(
            assert,
            withActionRevisions( securityWorkflow, fixture.revisions ),
            fixture.name
        );
    } );
} );

QUnit.test( 'workflow action revision fixtures fail on invalid input', function( assert )
{
    var securityWorkflow = readWorkflow( 'security.yml' );

    assert.throws( function()
    {
        withActionRevision( securityWorkflow, 'github/codeql-action/init', 'v4.36.0' );
    }, function( error )
    {
        return error.message === 'workflow action revision invalid: github/codeql-action/init';
    } );

    assert.throws( function()
    {
        withActionRevision(
            securityWorkflow,
            'github/codeql-action/upload-sarif',
            '7211b7c8077ea37d8641b6271f6a365a22a5fbfa'
        );
    }, function( error )
    {
        return error.message === 'workflow action reference count mismatch: github/codeql-action/upload-sarif';
    } );
} );

QUnit.test( 'justfile exposes GitHub Actions verification recipes', function( assert )
{
    var justfile = fs.readFileSync( path.join( __dirname, '..', 'justfile' ), 'utf8' );
    var releaseWorkflow = readWorkflow( 'release.yml' );
    var latestWorkflow = readWorkflow( 'latest.yml' );

    assert.ok( justfile.indexOf( 'bootstrap-release-env:' ) !== -1 );
    assert.ok( justfile.indexOf( 'lint-actions:' ) !== -1 );
    assert.ok( justfile.indexOf( 'test-actions-ci:' ) !== -1 );
    assert.ok( justfile.indexOf( 'test-actions-release-build:' ) !== -1 );
    assert.ok( justfile.indexOf( 'test-actions-latest-build:' ) !== -1 );
    assert.ok( justfile.indexOf( 'test-actions:' ) !== -1 );
    assert.ok( releaseWorkflow.indexOf( 'actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c' ) !== -1 );
    assert.ok( latestWorkflow.indexOf( 'actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c' ) !== -1 );
} );

QUnit.test( 'parity harness source files are present in the repository tree', function( assert )
{
    var parityRoot = path.join( __dirname, 'parity' );
    var requiredFiles = [
        'compare.js',
        'corpus.js',
        'improvementsRegistry.js',
        'parity.robustness.test.js',
        'parity.test.js',
        'scanHarness.js',
        'upstreamDetector.js',
        'upstreamExtensionHarness.js',
        'upstreamGitLoader.js',
        'README.md'
    ];

    requiredFiles.forEach( function( relativePath )
    {
        var absolutePath = path.join( parityRoot, relativePath );
        assert.ok( fs.existsSync( absolutePath ), relativePath + ' exists under test/parity/' );
    } );

    assert.ok(
        !fs.existsSync( path.join( parityRoot, 'upstream-src' ) ),
        'no static upstream-src/ directory: upstream is cloned at runtime into .tools/upstream-todo-tree/'
    );
} );

QUnit.test( 'parity harness pins to the canonical upstream Gruntfuggly/todo-tree remote and a 40-char commit', function( assert )
{
    var upstreamGitLoader = require( './parity/upstreamGitLoader.js' );

    assert.equal(
        upstreamGitLoader.UPSTREAM_REPO_URL,
        'https://github.com/Gruntfuggly/todo-tree.git',
        'pinned remote is the canonical upstream repository'
    );
    assert.ok(
        regexRegistry.createRegExp( 'sha1Lowercase' ).test( upstreamGitLoader.UPSTREAM_COMMIT ),
        'pinned commit is a 40-char lowercase hex SHA-1: ' + upstreamGitLoader.UPSTREAM_COMMIT
    );
} );

QUnit.test( '.vscodeignore excludes the upstream clone, test fixtures, build tooling, and editor backups so they never ship in the published VSIX', function( assert )
{
    var contents = fs.readFileSync( path.join( __dirname, '..', '.vscodeignore' ), 'utf8' );
    var lines = contents.split( regexRegistry.createRegExp( 'optionalCarriageReturnLineBreak' ) )
        .map( function( line ) { return line.trim(); } );

    assert.ok( lines.indexOf( 'test/' ) !== -1, '.vscodeignore lists `test/`' );
    assert.ok( lines.indexOf( 'src/' ) !== -1, '.vscodeignore lists `src/` (bundle ships from dist/)' );
    assert.ok( lines.indexOf( 'TODOS_LISTS/' ) !== -1, '.vscodeignore lists `TODOS_LISTS/`' );
    assert.ok( lines.indexOf( '.github/' ) !== -1, '.vscodeignore lists `.github/`' );
    assert.ok( lines.indexOf( '.tools/' ) !== -1, '.vscodeignore lists `.tools/` (upstream clone cache)' );
    assert.ok( lines.indexOf( 'buildCodiconNames.js' ) !== -1, '.vscodeignore lists `buildCodiconNames.js` (build-time tool, not needed at runtime)' );
    assert.ok( lines.indexOf( 'old-*.js' ) !== -1, '.vscodeignore lists `old-*.js` (pre-refactor scratch files never ship)' );
    assert.ok( lines.indexOf( '*.bak' ) !== -1, '.vscodeignore lists `*.bak` (editor backups never ship)' );
    assert.ok( lines.indexOf( '*~' ) !== -1, '.vscodeignore lists `*~` (editor backups never ship)' );
} );

QUnit.test( '.gitignore excludes the upstream clone cache so cloned upstream sources are never committed', function( assert )
{
    var contents = fs.readFileSync( path.join( __dirname, '..', '.gitignore' ), 'utf8' );
    var lines = contents.split( regexRegistry.createRegExp( 'optionalCarriageReturnLineBreak' ) )
        .map( function( line ) { return line.trim(); } );

    assert.ok( lines.indexOf( '.tools/' ) !== -1, '.gitignore lists `.tools/`' );
} );

QUnit.test( 'repository root is free of pre-refactor scratch files and stray agent context files', function( assert )
{
    var repoRoot = path.join( __dirname, '..' );
    var bannedFiles = [ 'old-extension-pre-refactor.js', '.codex' ];

    bannedFiles.forEach( function( banned )
    {
        assert.ok(
            !fs.existsSync( path.join( repoRoot, banned ) ),
            'repo root does not contain pre-refactor scratch / stray agent file: ' + banned
        );
    } );

    var rootEntries = fs.readdirSync( repoRoot );
    var oldJsFiles = rootEntries.filter( function( entry )
    {
        return regexRegistry.createRegExp( 'oldJsFile' ).test( entry );
    } );
    assert.equal(
        oldJsFiles.length,
        0,
        'repo root has no `old-*.js` scratch files: ' + JSON.stringify( oldJsFiles )
    );

    var bakFiles = rootEntries.filter( function( entry )
    {
        return regexRegistry.createRegExp( 'backupFileSuffix' ).test( entry ) ||
            regexRegistry.createRegExp( 'tildeSuffix' ).test( entry );
    } );
    assert.equal(
        bakFiles.length,
        0,
        'repo root has no editor backup files: ' + JSON.stringify( bakFiles )
    );
} );
