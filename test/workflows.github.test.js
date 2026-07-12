var fs = require( 'fs' );
var path = require( 'path' );
var regexRegistry = require( '../src/regexRegistry.js' );

var ACTION_REVISIONS = Object.freeze( {
    actionsCache: Object.freeze( {
        action: 'actions/cache',
        ref: '55cc8345863c7cc4c66a329aec7e433d2d1c52a9',
        version: 'v6.1.0'
    } ),
    uploadArtifact: Object.freeze( {
        action: 'actions/upload-artifact',
        ref: '043fb46d1a93c77aae656e7c1c64a875d1fc6a0a',
        version: 'v7.0.1'
    } ),
    attestBuildProvenance: Object.freeze( {
        action: 'actions/attest-build-provenance',
        ref: '0f67c3f4856b2e3261c31976d6725780e5e4c373',
        version: 'v4.1.1'
    } )
} );

var CODEQL_ACTIONS = Object.freeze( {
    analyze: 'github/codeql-action/analyze',
    init: 'github/codeql-action/init'
} );

function readRepositoryFile( relativePath )
{
    return fs.readFileSync( path.join( __dirname, '..', relativePath ), 'utf8' );
}

function readWorkflow( workflowName )
{
    return readRepositoryFile( path.join( '.github', 'workflows', workflowName ) );
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

function codeqlActionRevisionsMatch( references )
{
    var initReferences = getActionReferences( references, CODEQL_ACTIONS.init );
    var analyzeReferences = getActionReferences( references, CODEQL_ACTIONS.analyze );

    return initReferences.length === 1 && analyzeReferences.length === 1 &&
        initReferences[ 0 ].ref === analyzeReferences[ 0 ].ref;
}

function workflowAssertionMessage( label, message )
{
    return label ? label + ': ' + message : message;
}

function isFullCommitSha( ref )
{
    return regexRegistry.createRegExp( 'sha1Lowercase' ).test( ref );
}

function createAlternateFullCommitSha( ref )
{
    if( !isFullCommitSha( ref ) )
    {
        throw new Error( 'workflow action revision fixture: full commit SHA required' );
    }

    return ( ref[ 0 ] === '0' ? '1' : '0' ) + ref.slice( 1 );
}

function assertFullCommitSha( assert, ref, message )
{
    assert.ok( isFullCommitSha( ref ), message );
}

function assertPinnedAction( assert, references, action, label, expectedCount )
{
    var actionReferences = getActionReferences( references, action );
    var reference = actionReferences[ 0 ];
    var count = expectedCount || 1;

    assert.equal(
        actionReferences.length,
        count,
        workflowAssertionMessage( label, action + ' reference count matches the workflow contract' )
    );
    if( actionReferences.length !== count )
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
    var expectedCount = workflowName === 'pr-vsix-build.yml' &&
        expectedRevision.action === ACTION_REVISIONS.uploadArtifact.action ? 2 : 1;
    var reference = assertPinnedAction(
        assert,
        getExternalActionReferences( readWorkflow( workflowName ) ),
        expectedRevision.action,
        workflowName,
        expectedCount
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

function withCodeqlRevision( contents, ref )
{
    return withActionRevisions( contents, [
        {
            action: CODEQL_ACTIONS.init,
            ref: ref
        },
        {
            action: CODEQL_ACTIONS.analyze,
            ref: ref
        }
    ] );
}

function getDependabotUpdateBlocks( contents, packageEcosystem )
{
    var lines = contents.split( regexRegistry.createRegExp( 'optionalCarriageReturnLineBreak' ) );
    var header = '  - package-ecosystem: ' + packageEcosystem;
    var starts = lines.reduce( function( indices, line, index )
    {
        if( line.indexOf( '  - package-ecosystem: ' ) === 0 )
        {
            indices.push( index );
        }
        return indices;
    }, [] );

    return starts.reduce( function( blocks, start, index )
    {
        if( lines[ start ] === header )
        {
            var end = starts[ index + 1 ] === undefined ? lines.length : starts[ index + 1 ];
            blocks.push( lines.slice( start, end ).join( '\n' ) );
        }
        return blocks;
    }, [] );
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

function getWorkflowStepBlock( contents, stepName )
{
    var marker = '      - name: ' + stepName;
    var start = contents.indexOf( marker );
    if( start === -1 )
    {
        return '';
    }
    var end = contents.indexOf( '\n      - name: ', start + marker.length );
    return contents.slice( start, end === -1 ? contents.length : end );
}

function assertSecurityWorkflowContract( assert, securityWorkflow, label )
{
    var references = getExternalActionReferences( securityWorkflow );
    var dependencyReview = assertPinnedAction( assert, references, 'actions/dependency-review-action', label );
    var codeqlInit = assertPinnedAction( assert, references, CODEQL_ACTIONS.init, label );
    var codeqlAnalyze = assertPinnedAction( assert, references, CODEQL_ACTIONS.analyze, label );
    var dependencyReviewJob = getWorkflowJobBlock( securityWorkflow, 'dependency-review' );
    var codeqlJob = getWorkflowJobBlock( securityWorkflow, 'codeql' );

    assert.ok(
        codeqlActionRevisionsMatch( references ),
        workflowAssertionMessage( label, 'CodeQL init and analyze use the same action revision' )
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
        codeqlJob.indexOf( codeqlInit.text ) !== -1,
        workflowAssertionMessage( label, 'CodeQL job uses the pinned init reference' )
    );
    assert.ok(
        codeqlJob.indexOf( codeqlAnalyze.text ) !== -1,
        workflowAssertionMessage( label, 'CodeQL job uses the pinned analyze reference' )
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

QUnit.test( 'workflow run names preserve hash characters', function( assert )
{
    getWorkflowPaths().forEach( function( workflowPath )
    {
        var contents = fs.readFileSync( workflowPath, 'utf8' );
        var relativePath = path.relative( path.join( __dirname, '..' ), workflowPath );
        var unsafeRunNameLine = contents
            .split( regexRegistry.createRegExp( 'optionalCarriageReturnLineBreak' ) )
            .find( function( line )
            {
                if( line.indexOf( 'run-name: ' ) !== 0 )
                {
                    return false;
                }

                var value = line.slice( 'run-name: '.length );
                return ![ '>', '|', "'", '"' ].includes( value[ 0 ] ) && value.indexOf( ' #' ) !== -1;
            } );

        assert.equal(
            unsafeRunNameLine,
            undefined,
            relativePath + ': plain YAML run-name cannot contain whitespace-hash'
        );
    } );
} );

QUnit.test( 'Dependabot groups CodeQL action revisions atomically', function( assert )
{
    var githubActionsUpdates = getDependabotUpdateBlocks(
        readRepositoryFile( path.join( '.github', 'dependabot.yml' ) ),
        'github-actions'
    );
    var githubActionsUpdate = githubActionsUpdates[ 0 ] || '';
    var expectedGroup = [
        '    groups:',
        '      codeql-action:',
        '        applies-to: version-updates',
        '        patterns:',
        '          - "github/codeql-action"',
        '          - "github/codeql-action/*"'
    ].join( '\n' );

    assert.equal( githubActionsUpdates.length, 1, 'github-actions update configuration exists once' );
    assert.ok(
        githubActionsUpdate.indexOf( expectedGroup ) !== -1,
        'CodeQL action paths share one version-update group'
    );
} );

QUnit.test( 'release workflow requests provenance-related permissions', function( assert )
{
    var contents = readWorkflow( 'release.yml' );

    assert.ok( contents.indexOf( 'id-token: write' ) !== -1 );
    assert.ok( contents.indexOf( 'attestations: write' ) !== -1 );
    assert.ok( contents.indexOf( 'contents: write' ) !== -1 );
} );

QUnit.test( 'workflow actions use verified release SHAs', function( assert )
{
    [ 'ci.yml', 'latest.yml', 'release.yml' ].forEach( function( workflowName )
    {
        assertWorkflowActionRevision( assert, workflowName, ACTION_REVISIONS.actionsCache );
    } );

    assertWorkflowActionRevision( assert, 'release.yml', ACTION_REVISIONS.attestBuildProvenance );
    [ 'pr-vsix-build.yml', 'pr-vsix-event.yml' ].forEach( function( workflowName )
    {
        assertWorkflowActionRevision( assert, workflowName, ACTION_REVISIONS.uploadArtifact );
    } );
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

QUnit.test( 'trusted PR workflow builds every verified platform VSIX after all gates', function( assert )
{
    var buildWorkflow = readWorkflow( 'pr-vsix-build.yml' );
    var testIndex = buildWorkflow.indexOf( 'run: npm test' );
    var bundleIndex = buildWorkflow.indexOf( 'run: npm run vscode:prepublish' );
    var platformBuildIndex = buildWorkflow.indexOf( 'node scripts/release/build-vsix.mjs all' );
    var verifyIndex = buildWorkflow.indexOf( 'node scripts/ci/verify-pr-vsix.mjs' );
    var uploadIndex = buildWorkflow.indexOf('name: Upload ${{ matrix.target }} VSIX');

    assert.ok( buildWorkflow.indexOf( 'rm -rf artifacts/vsix' ) !== -1 );
    [ testIndex, bundleIndex, platformBuildIndex, verifyIndex, uploadIndex ].forEach( function( index )
    {
        assert.ok( index >= 0 );
    } );
    assert.ok( testIndex < bundleIndex );
    assert.ok( bundleIndex < platformBuildIndex );
    assert.ok( platformBuildIndex < verifyIndex );
    assert.ok( verifyIndex < uploadIndex );
    assert.ok( buildWorkflow.indexOf( 'VSIX_BASENAME: better-todo-tree-pr-${{ steps.context.outputs.pull-request-number }}' ) !== -1 );
    assert.ok( buildWorkflow.indexOf( 'path: artifacts/vsix/*.vsix' ) !== -1 );
    assert.ok( buildWorkflow.indexOf( 'retention-days: 30' ) !== -1 );
    assert.ok( buildWorkflow.indexOf( 'archive: false' ) !== -1 );
    assert.ok( buildWorkflow.indexOf( 'overwrite: true' ) !== -1 );
    assert.ok( buildWorkflow.indexOf( 'compression-level: 0' ) !== -1 );
    assert.ok( buildWorkflow.indexOf( 'actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a' ) !== -1 );
    assert.equal(
        buildWorkflow.split( 'actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a' ).length - 1,
        2
    );
    assert.ok( buildWorkflow.indexOf( 'actions/cache' ) === -1 );
    assert.ok( buildWorkflow.indexOf( 'timeout-minutes: 30' ) !== -1 );
    [
        'Check out immutable build context',
        'Install dependencies',
        'Run test suite',
        'Build production bundle',
        'Build platform VSIX bundle',
        'Stage platform VSIX files'
    ].forEach( function( stepName )
    {
        assert.ok(
            getWorkflowStepBlock( buildWorkflow, stepName )
                .indexOf( "if: steps.context.outputs.build == 'true'" ) !== -1,
            stepName + ' is disabled for cleanup-only dispatches'
        );
    } );
    assert.equal(
        buildWorkflow.split( "if: steps.context.outputs.build == 'true'" ).length - 1,
        7
    );
    assert.ok( buildWorkflow.indexOf( 'matrix:\n        target: ${{ fromJson(needs.test-build.outputs.targets) }}' ) !== -1 );
    assert.ok( buildWorkflow.indexOf( 'node scripts/ci/delete-pr-vsix-staging.mjs' ) !== -1 );
} );

QUnit.test( 'trusted orchestration isolates and cancels only one PR generation', function( assert )
{
    var ciWorkflow = readWorkflow( 'ci.yml' );
    var buildWorkflow = readWorkflow( 'pr-vsix-build.yml' );
    var eventWorkflow = readWorkflow( 'pr-vsix-event.yml' );

    assert.ok( ciWorkflow.indexOf( 'pull_request:\n' ) !== -1 );
    assert.ok( ciWorkflow.indexOf( 'edited' ) === -1 );
    assert.ok( ciWorkflow.indexOf( 'github.event.pull_request.number || github.ref' ) !== -1 );
    assert.ok( ciWorkflow.indexOf( 'cancel-in-progress: true' ) !== -1 );
    assert.ok( ciWorkflow.indexOf( 'persist-credentials: false' ) !== -1 );
    assert.ok( buildWorkflow.indexOf( "format('PR VSIX Build PR #{0} head {1} base {2} merge {3} action {4}'" ) !== -1 );
    assert.ok( buildWorkflow.indexOf( 'node scripts/ci/resolve-pr-vsix-context.mjs' ) !== -1 );
    assert.ok( buildWorkflow.indexOf( 'ref: ${{ steps.context.outputs.checkout-sha }}' ) !== -1 );
    assert.ok( buildWorkflow.indexOf( 'repository_dispatch:\n    types:\n      - refresh-pr-vsix' ) !== -1 );
    assert.ok( buildWorkflow.indexOf( 'group: pr-vsix-build-${{ github.event.client_payload.pull_request_number }}' ) !== -1 );
    assert.ok(
        eventWorkflow.indexOf( [
            'run-name: >-',
            "  ${{ format('PR VSIX Event #{0} {1}', github.event.pull_request.number, github.event.action) }}"
        ].join( '\n' ) ) !== -1,
        'lifecycle run name preserves PR and action identity'
    );
    assert.ok( eventWorkflow.indexOf( "format('pr-vsix-fallback-{0}', github.event.pull_request.number)" ) !== -1 );
    assert.ok( eventWorkflow.indexOf( "format('pr-vsix-build-{0}', github.event.pull_request.number)" ) !== -1 );
} );

QUnit.test( 'privileged PR VSIX publisher executes trusted metadata code only', function( assert )
{
    var workflow = readWorkflow( 'pr-vsix-comment.yml' );
    var baseEventWorkflow = readWorkflow( 'pr-vsix-base-event.yml' );
    var eventWorkflow = readWorkflow( 'pr-vsix-event.yml' );
    var refreshWorkflow = readWorkflow( 'pr-vsix-refresh.yml' );
    var publisherScript = readRepositoryFile( path.join( 'scripts', 'ci', 'sync-pr-vsix-comment.mjs' ) );

    assert.ok( workflow.indexOf( 'workflow_run:' ) !== -1 );
    assert.ok( workflow.indexOf( 'pull_request_target:' ) === -1 );
    assert.ok( workflow.indexOf( '      - PR VSIX Build' ) !== -1 );
    assert.ok( workflow.indexOf( '      - PR VSIX Event' ) !== -1 );
    assert.ok( workflow.indexOf( '    types:\n      - completed' ) !== -1 );
    assert.ok( workflow.indexOf( '      - in_progress' ) === -1 );
    assert.ok( workflow.indexOf( "github.event.workflow_run.event == 'repository_dispatch'" ) !== -1 );
    assert.ok( workflow.indexOf( "github.event.workflow_run.event == 'pull_request_target'" ) !== -1 );
    assert.ok( workflow.indexOf( "github.event.workflow_run.event == 'pull_request'" ) !== -1 );
    assert.ok( workflow.indexOf( 'github.event.workflow_run.name' ) === -1 );
    assert.ok( publisherScript.indexOf( 'workflowRun.name' ) === -1 );
    assert.ok( publisherScript.indexOf( 'event.workflow_run.name' ) === -1 );
    assert.ok( workflow.indexOf( 'actions: write' ) !== -1 );
    assert.ok( workflow.indexOf( 'permissions: {}' ) !== -1 );
    assert.ok( workflow.indexOf( '      contents: read' ) !== -1 );
    assert.ok( workflow.indexOf( '      contents: write' ) !== -1 );
    assert.ok( workflow.indexOf( 'pull-requests: write' ) !== -1 );
    assert.ok( workflow.indexOf( 'ref: ${{ github.event.repository.default_branch }}' ) !== -1 );
    assert.ok( workflow.indexOf( 'persist-credentials: false' ) !== -1 );
    assert.ok( workflow.indexOf( 'node scripts/ci/sync-pr-vsix-comment.mjs' ) !== -1 );
    assert.ok( workflow.indexOf( 'download-artifact' ) === -1 );
    assert.ok( workflow.indexOf( 'node scripts/ci/sync-pr-vsix-comment.mjs resolve >> "$GITHUB_OUTPUT"' ) !== -1 );
    assert.ok( workflow.indexOf( "if: needs.resolve.outputs.processable == 'true'" ) !== -1 );
    assert.ok( workflow.indexOf( 'group: pr-vsix-comment-${{ needs.resolve.outputs.pull-request-number }}' ) !== -1 );
    assert.ok( workflow.indexOf( 'cancel-in-progress: false' ) !== -1 );
    assert.ok( workflow.indexOf( 'PR_VSIX_MONITOR_POLL_MS: 10000' ) !== -1 );
    assert.ok( workflow.indexOf( 'PR_VSIX_MONITOR_HEARTBEAT_MS: 60000' ) !== -1 );
    assert.ok( workflow.indexOf( 'PR_VSIX_MONITOR_TIMEOUT_MS: 3600000' ) !== -1 );
    assert.ok( workflow.indexOf( 'timeout-minutes: 75' ) !== -1 );
    assert.ok( workflow.indexOf( 'PR_VSIX_API_RETRY_ATTEMPTS: 4' ) !== -1 );
    assert.ok( workflow.indexOf( 'github.event.workflow_run.head_sha }}\n          fetch-depth' ) === -1 );
    assert.ok( eventWorkflow.indexOf( 'pull_request:\n    types:\n      - closed\n      - edited\n      - labeled\n      - unlabeled\n      - opened\n      - reopened\n      - synchronize' ) !== -1 );
    assert.ok( eventWorkflow.indexOf( 'pull_request_target:\n    types:\n      - closed\n      - edited\n      - labeled\n      - unlabeled\n      - opened\n      - reopened\n      - synchronize' ) !== -1 );
    assert.ok( eventWorkflow.indexOf( "github.event.action != 'edited' || github.event.changes.base != null" ) !== -1 );
    assert.ok( eventWorkflow.indexOf( "github.event.action != 'labeled' && github.event.action != 'unlabeled'" ) !== -1 );
    assert.ok( eventWorkflow.indexOf( 'better-todo-tree-pr-vsix-event-${{ github.event.pull_request.number }}-head-${{ github.event.pull_request.head.sha }}-base-${{ github.event.pull_request.base.sha }}-merge-none-' ) !== -1 );
    assert.ok( eventWorkflow.indexOf( '-run-${{ github.run_id }}-attempt-${{ github.run_attempt }}' ) !== -1 );
    assert.ok( eventWorkflow.indexOf( 'merge_commit_sha' ) === -1 );
    assert.ok( publisherScript.indexOf( 'merge_commit_sha' ) === -1 );
    assert.ok( publisherScript.indexOf( '/git/ref/pull/' ) !== -1 );
    assert.ok( eventWorkflow.indexOf( 'actions/checkout' ) === -1 );
    assert.ok( eventWorkflow.indexOf( 'permissions: {}' ) !== -1 );
    assert.ok( eventWorkflow.indexOf( 'pull-requests: write' ) === -1 );
    assert.ok( baseEventWorkflow.indexOf( 'push:\n    branches:\n      - "**"' ) !== -1 );
    assert.ok( baseEventWorkflow.indexOf( 'permissions: {}' ) !== -1 );
    assert.ok( baseEventWorkflow.indexOf( 'actions/' ) === -1 );
    assert.ok( baseEventWorkflow.indexOf( 'group: pr-vsix-base-event-${{ github.ref }}' ) !== -1 );
    assert.ok( refreshWorkflow.indexOf( 'schedule:' ) !== -1 );
    assert.ok( refreshWorkflow.indexOf( 'workflow_run:' ) !== -1 );
    assert.ok( refreshWorkflow.indexOf( 'repository_dispatch:\n    types:\n      - continue-pr-vsix-refresh' ) !== -1 );
    assert.ok( refreshWorkflow.indexOf( '      - PR VSIX Base Event' ) !== -1 );
    assert.ok( refreshWorkflow.indexOf( 'actions: read' ) !== -1 );
    assert.ok( refreshWorkflow.indexOf( 'contents: write' ) !== -1 );
    assert.ok( refreshWorkflow.indexOf( 'node scripts/ci/refresh-pr-vsix.mjs' ) !== -1 );
    assert.ok( refreshWorkflow.indexOf( 'PR_VSIX_ARTIFACT_RETENTION_DAYS: 30' ) !== -1 );
    assert.ok( refreshWorkflow.indexOf( 'PR_VSIX_RENEWAL_DAYS: 7' ) !== -1 );
    assert.ok( refreshWorkflow.indexOf( 'timeout-minutes: 180' ) !== -1 );
    assert.ok( refreshWorkflow.indexOf( 'PR_VSIX_DISPATCH_INTERVAL_MS: 1000' ) !== -1 );
    assert.ok( refreshWorkflow.indexOf( 'PR_VSIX_REFRESH_BATCH_SIZE: 400' ) !== -1 );
    assert.ok( refreshWorkflow.indexOf( 'persist-credentials: false' ) !== -1 );
    assert.ok( refreshWorkflow.indexOf( 'push:\n    branches:' ) === -1 );
    assert.ok( refreshWorkflow.indexOf( "format('branch-{0}', github.event.workflow_run.head_branch)" ) !== -1 );
    assert.ok( refreshWorkflow.indexOf( "format('continuation-{0}', github.event.client_payload.base || 'all')" ) !== -1 );
} );

QUnit.test( 'VSIX builder stages one ripgrep-universal binary for each native target', function( assert )
{
    var buildScript = fs.readFileSync( path.join( __dirname, '..', 'scripts', 'release', 'build-vsix.mjs' ), 'utf8' );

    assert.ok( buildScript.indexOf( "node_modules', '@vscode', 'ripgrep-universal'" ) !== -1 );
    assert.ok( buildScript.indexOf( "import { binPathFor } from '@vscode/ripgrep-universal';" ) !== -1 );
    assert.ok( buildScript.indexOf( "from './ripgrep-targets.mjs'" ) !== -1 );
    assert.ok( buildScript.indexOf( "fs.chmodSync(destinationPath, platform.os === 'win32' ? 0o644 : 0o755)" ) !== -1 );
    assert.ok( buildScript.indexOf( "copyRipgrepPackageFile('LICENSE')" ) !== -1 );
    assert.ok( buildScript.indexOf( "const { pack } = require('@vscode/vsce/out/package.js')" ) !== -1 );
    assert.ok( buildScript.indexOf( 'dependencies: false' ) !== -1 );
    assert.ok( buildScript.indexOf( 'finally {\n        resetRipgrepStage();\n    }' ) !== -1 );
} );

QUnit.test( 'PR VSIX builder uses the canonical release target pipeline', function( assert )
{
    var buildScript = readRepositoryFile( path.join( 'scripts', 'release', 'build-vsix.mjs' ) );
    var targetScript = readRepositoryFile( path.join( 'scripts', 'release', 'ripgrep-targets.mjs' ) );
    var verifyScript = readRepositoryFile( path.join( 'scripts', 'ci', 'verify-pr-vsix.mjs' ) );

    assert.ok( buildScript.indexOf( 'pr-preview' ) === -1 );
    assert.ok( buildScript.indexOf( 'PR_VSIX_FILENAME' ) === -1 );
    assert.ok( buildScript.indexOf( 'await packageTarget(target, outputPath)' ) !== -1 );
    assert.ok( targetScript.indexOf( 'function uniqueNativePlatforms' ) === -1 );
    assert.ok( verifyScript.indexOf( 'verifyPrVsixBundle' ) !== -1 );
    assert.ok( verifyScript.indexOf( 'TargetPlatform=' ) !== -1 );
    assert.ok( verifyScript.indexOf( "runUnzip(['-tqq', vsixPath])" ) !== -1 );
} );

QUnit.test( 'VSIX builder removes stale selected target outputs before packing', function( assert )
{
    var buildScript = fs.readFileSync( path.join( __dirname, '..', 'scripts', 'release', 'build-vsix.mjs' ), 'utf8' );

    assert.ok( buildScript.indexOf( 'function isSelectedTargetPackage' ) !== -1 );
    assert.ok( buildScript.indexOf( 'function cleanSelectedTargetOutputs' ) !== -1 );
    assert.ok( buildScript.indexOf( 'fs.unlinkSync(path.join(directory, fileName))' ) !== -1 );
    assert.ok( buildScript.indexOf( 'cleanSelectedTargetOutputs(outputDirectory, packageJson.name, selectedTargets)' ) !== -1 );
} );

QUnit.test( 'security workflow keeps dependency review and CodeQL coverage pinned', function( assert )
{
    assertSecurityWorkflowContract( assert, readWorkflow( 'security.yml' ) );
} );

QUnit.test( 'dependency review action revision satisfies security workflow contract', function( assert )
{
    var securityWorkflow = readWorkflow( 'security.yml' );
    var dependencyReview = assertPinnedAction(
        assert,
        getExternalActionReferences( securityWorkflow ),
        'actions/dependency-review-action',
        'dependency review fixture source'
    );
    var dependencyReviewWorkflow = withActionRevision(
        securityWorkflow,
        'actions/dependency-review-action',
        createAlternateFullCommitSha( dependencyReview.ref )
    );

    assertSecurityWorkflowContract( assert, dependencyReviewWorkflow, 'PR 20 dependency review' );
} );

QUnit.test( 'CodeQL revision contract accepts only atomic action updates', function( assert )
{
    var securityWorkflow = readWorkflow( 'security.yml' );
    var codeqlInit = assertPinnedAction(
        assert,
        getExternalActionReferences( securityWorkflow ),
        CODEQL_ACTIONS.init,
        'CodeQL fixture source'
    );
    var alternateRevision = createAlternateFullCommitSha( codeqlInit.ref );
    var initOnly = withActionRevision(
        securityWorkflow,
        CODEQL_ACTIONS.init,
        alternateRevision
    );
    var analyzeOnly = withActionRevision(
        securityWorkflow,
        CODEQL_ACTIONS.analyze,
        alternateRevision
    );
    var paired = withCodeqlRevision( securityWorkflow, alternateRevision );

    assert.notOk(
        codeqlActionRevisionsMatch( getExternalActionReferences( initOnly ) ),
        'init-only revision violates CodeQL parity'
    );
    assert.notOk(
        codeqlActionRevisionsMatch( getExternalActionReferences( analyzeOnly ) ),
        'analyze-only revision violates CodeQL parity'
    );
    assert.ok(
        codeqlActionRevisionsMatch( getExternalActionReferences( paired ) ),
        'paired revision preserves CodeQL parity'
    );
    assertSecurityWorkflowContract( assert, paired, 'paired CodeQL revision' );
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
    assert.ok( justfile.indexOf( 'test-actions-pr-vsix-build:' ) !== -1 );
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
