var fs = require( 'fs' );
var os = require( 'os' );
var path = require( 'path' );
var events = require( 'events' );
var childProcess = require( 'child_process' );

var ripgrep = require( '../src/ripgrep.js' );
var regexRegistry = require( '../src/regexRegistry.js' );
var TODO_REGEX_SOURCE = regexRegistry.pattern( 'todoCapture' );
var TODO_FIXME_REGEX_SOURCE = regexRegistry.pattern( 'todoFixmeCapture' );

function createFakeProcess()
{
    var process = new events.EventEmitter();
    process.stdout = new events.EventEmitter();
    process.stderr = new events.EventEmitter();
    process.kill = function( signal )
    {
        this.emit( 'close', null, signal );
    };
    return process;
}

function createJsonLine( payload )
{
    return JSON.stringify( payload ) + '\n';
}

function createDeferred()
{
    var resolve;
    var reject;
    var promise = new Promise( function( promiseResolve, promiseReject )
    {
        resolve = promiseResolve;
        reject = promiseReject;
    } );

    return {
        promise: promise,
        resolve: resolve,
        reject: reject
    };
}

QUnit.module( "ripgrep streaming search", function( hooks )
{
    var originalSpawn;
    var fakeRgPath;

    hooks.beforeEach( function()
    {
        originalSpawn = childProcess.spawn;
        fakeRgPath = path.join( os.tmpdir(), 'todo-tree-rg-test' );
        fs.writeFileSync( fakeRgPath, '', { mode: 0o755 } );
    } );

    hooks.afterEach( function()
    {
        childProcess.spawn = originalSpawn;
        ripgrep.kill();

        if( fs.existsSync( fakeRgPath ) )
        {
            fs.unlinkSync( fakeRgPath );
        }
    } );

    QUnit.test( "parseArgumentString keeps quoted sections intact", function( assert )
    {
        assert.deepEqual(
            ripgrep.parseArgumentString( '--max-columns=1000 --glob "src/**/*.js" --type-add=foo:*.foo' ),
            [ '--max-columns=1000', '--glob', 'src/**/*.js', '--type-add=foo:*.foo' ]
        );
    } );

    QUnit.test( "buildArgs adds PCRE2 for lookaround regexes", function( assert )
    {
        var args = ripgrep.buildArgs( {
            regex: regexRegistry.pattern( 'tagCaptureNotIdentifierSuffix' ),
            additional: '--max-columns=1000',
            globs: []
        } );

        assert.notEqual( args.indexOf( '--pcre2' ), -1 );
        assert.ok( args.indexOf( '--pcre2' ) < args.indexOf( '-e' ) );
    } );

    QUnit.test( "buildArgs preserves explicit ripgrep engine args", function( assert )
    {
        var args = ripgrep.buildArgs( {
            regex: regexRegistry.pattern( 'tagCaptureNotIdentifierSuffix' ),
            additional: '--engine=default',
            globs: []
        } );

        assert.equal( args.indexOf( '--pcre2' ), -1 );
        assert.notEqual( args.indexOf( '--engine=default' ), -1 );
    } );

    QUnit.test( "search parses streamed json messages across chunk boundaries", function( assert )
    {
        var seenMessages = [];

        childProcess.spawn = function()
        {
            var fakeProcess = createFakeProcess();
            var firstLine = createJsonLine( {
                type: 'match',
                data: {
                    path: { text: '/tmp/file.js' },
                    lines: { text: 'TODO first' },
                    line_number: 1,
                    absolute_offset: 0,
                    submatches: [ {
                        match: { text: 'TODO first' },
                        start: 0,
                        end: 10
                    } ]
                }
            } );

            process.nextTick( function()
            {
                fakeProcess.stdout.emit( 'data', Buffer.from( firstLine.slice( 0, 40 ) ) );
                fakeProcess.stdout.emit( 'data', Buffer.from( firstLine.slice( 40 ) ) );
                fakeProcess.stdout.emit( 'data', Buffer.from(
                    createJsonLine( {
                        type: 'match',
                        data: {
                            path: { text: '/tmp/file.js' },
                            lines: { text: 'FIXME second' },
                            line_number: 2,
                            absolute_offset: 12,
                            submatches: [ {
                                match: { text: 'FIXME second' },
                                start: 0,
                                end: 13
                            } ]
                        }
                    } )
                ) );
                fakeProcess.stdout.emit( 'data', Buffer.from(
                    createJsonLine( {
                        type: 'summary',
                        data: {
                            stats: {
                                matches: 2
                            }
                        }
                    } )
                ) );
                fakeProcess.emit( 'close', 0, null );
            } );

            return fakeProcess;
        };

        return ripgrep.search( '/', {
            rgPath: fakeRgPath,
            regex: TODO_FIXME_REGEX_SOURCE,
            unquotedRegex: TODO_FIXME_REGEX_SOURCE,
            additional: '',
            globs: [],
            multiline: false
        }, function( message )
        {
            seenMessages.push( message );
        } ).then( function( summary )
        {
            assert.equal( seenMessages.length, 3 );
            assert.equal( seenMessages[ 0 ].type, 'match' );
            assert.equal( seenMessages[ 0 ].data.path.text, '/tmp/file.js' );
            assert.equal( seenMessages[ 1 ].data.lines.text, 'FIXME second' );
            assert.equal( summary.stats.matches, 2 );
        } );
    } );

    QUnit.test( "search rejects invalid cwd with a typed ripgrep error", function( assert )
    {
        return ripgrep.search( '', {
            rgPath: fakeRgPath,
            regex: TODO_REGEX_SOURCE,
            unquotedRegex: TODO_REGEX_SOURCE,
            additional: '',
            globs: [],
            multiline: false
        } ).then( function()
        {
            assert.ok( false, 'expected invalid cwd rejection' );
        }, function( error )
        {
            assert.ok( error instanceof ripgrep.RipgrepError );
            assert.equal( error.name, 'RipgrepError' );
            assert.equal( error.message, 'No `cwd` provided' );
        } );
    } );

    QUnit.test( "search rejects missing options with a typed ripgrep error", function( assert )
    {
        return ripgrep.search( '/' ).then( function()
        {
            assert.ok( false, 'expected missing options rejection' );
        }, function( error )
        {
            assert.ok( error instanceof ripgrep.RipgrepError );
            assert.equal( error.message, 'No search term provided' );
        } );
    } );

    QUnit.test( "search rejects null options with a typed ripgrep error", function( assert )
    {
        return ripgrep.search( '/', null ).then( function()
        {
            assert.ok( false, 'expected null options rejection' );
        }, function( error )
        {
            assert.ok( error instanceof ripgrep.RipgrepError );
            assert.equal( error.message, 'No search term provided' );
        } );
    } );

    QUnit.test( "search rejects invalid globs with a typed ripgrep error", function( assert )
    {
        return ripgrep.search( '/', {
            rgPath: fakeRgPath,
            regex: TODO_REGEX_SOURCE,
            unquotedRegex: TODO_REGEX_SOURCE,
            additional: '',
            globs: '**/*.js',
            multiline: false
        } ).then( function()
        {
            assert.ok( false, 'expected invalid globs rejection' );
        }, function( error )
        {
            assert.ok( error instanceof ripgrep.RipgrepError );
            assert.equal( error.message, 'ripgrep globs must be an array' );
        } );
    } );

    QUnit.test( "search applies defaults without mutating caller options", function( assert )
    {
        var options = {
            rgPath: fakeRgPath,
            unquotedRegex: TODO_REGEX_SOURCE
        };

        childProcess.spawn = function()
        {
            var fakeProcess = createFakeProcess();
            process.nextTick( function()
            {
                fakeProcess.emit( 'close', 1, null );
            } );
            return fakeProcess;
        };

        return ripgrep.search( '/', options ).then( function()
        {
            assert.deepEqual( options, {
                rgPath: fakeRgPath,
                unquotedRegex: TODO_REGEX_SOURCE
            } );
        } );
    } );

    QUnit.test( "search wraps synchronous spawn failures as typed ripgrep errors", function( assert )
    {
        childProcess.spawn = function()
        {
            throw new Error( 'spawn failed' );
        };

        return ripgrep.search( '/', {
            rgPath: fakeRgPath,
            regex: TODO_REGEX_SOURCE,
            unquotedRegex: TODO_REGEX_SOURCE,
            additional: '',
            globs: [],
            multiline: false
        } ).then( function()
        {
            assert.ok( false, 'expected spawn rejection' );
        }, function( error )
        {
            assert.ok( error instanceof ripgrep.RipgrepError );
            assert.equal( error.message, 'spawn failed' );
            assert.equal( error.cancelled, false );
        } );
    } );

    QUnit.test( "search rejects missing ripgrep executables with a typed ripgrep error", function( assert )
    {
        var missingPath = path.join( os.tmpdir(), 'todo-tree-rg-missing' );

        return ripgrep.search( '/', {
            rgPath: missingPath,
            regex: TODO_REGEX_SOURCE,
            unquotedRegex: TODO_REGEX_SOURCE,
            additional: '',
            globs: [],
            multiline: false
        } ).then( function()
        {
            assert.ok( false, 'expected missing ripgrep rejection' );
        }, function( error )
        {
            assert.ok( error instanceof ripgrep.RipgrepError );
            assert.equal( error.message, 'ripgrep executable not found (' + missingPath + ')' );
        } );
    } );

    QUnit.test( "search rejects malformed ripgrep json without throwing out of band", function( assert )
    {
        childProcess.spawn = function()
        {
            var fakeProcess = createFakeProcess();
            process.nextTick( function()
            {
                fakeProcess.stdout.emit( 'data', Buffer.from( '{"type":' + '\n' ) );
            } );
            return fakeProcess;
        };

        return ripgrep.search( '/', {
            rgPath: fakeRgPath,
            regex: TODO_REGEX_SOURCE,
            unquotedRegex: TODO_REGEX_SOURCE,
            additional: '',
            globs: [],
            multiline: false
        } ).then( function()
        {
            assert.ok( false, 'expected malformed json rejection' );
        }, function( error )
        {
            assert.ok( error instanceof ripgrep.RipgrepError );
            assert.ok( regexRegistry.createRegExp( 'jsonOrUnexpected' ).test( error.message ) );
            assert.equal( error.cancelled, false );
        } );
    } );

    QUnit.test( "malformed ripgrep json reports pattern cleanup failures", function( assert )
    {
        var originalUnlink = fs.promises.unlink;
        var patternFilePath = path.join( os.tmpdir(), 'todo-tree-pattern-json-test.txt' );

        fs.promises.unlink = function()
        {
            return Promise.reject( Object.assign( new Error( 'json cleanup failed' ), { code: 'EPERM' } ) );
        };

        childProcess.spawn = function()
        {
            var fakeProcess = createFakeProcess();
            process.nextTick( function()
            {
                fakeProcess.stdout.emit( 'data', Buffer.from( '{"type":' + '\n' ) );
            } );
            return fakeProcess;
        };

        return ripgrep.search( '/', {
            rgPath: fakeRgPath,
            regex: TODO_REGEX_SOURCE,
            unquotedRegex: TODO_REGEX_SOURCE,
            additional: '',
            globs: [],
            multiline: false,
            patternFilePath: patternFilePath
        } ).then( function()
        {
            assert.ok( false, 'expected cleanup failure' );
        }, function( error )
        {
            assert.ok( error instanceof ripgrep.RipgrepError );
            assert.equal( error.message, 'json cleanup failed' );
        } ).finally( function()
        {
            fs.promises.unlink = originalUnlink;
            if( fs.existsSync( patternFilePath ) )
            {
                fs.unlinkSync( patternFilePath );
            }
        } );
    } );

    QUnit.test( "cleanup from one search does not clear a newer active search", function( assert )
    {
        var originalUnlink = fs.promises.unlink;
        var firstProcess = createFakeProcess();
        var secondProcess = createFakeProcess();
        var firstSpawned = createDeferred();
        var secondSpawned = createDeferred();
        var spawnCount = 0;
        var secondKilled = false;
        var unlinkDeferreds = [];
        var patternFilePath = path.join( os.tmpdir(), 'todo-tree-pattern-race-test.txt' );

        secondProcess.kill = function( signal )
        {
            secondKilled = true;
            this.emit( 'close', null, signal );
        };

        fs.promises.unlink = function()
        {
            var deferred = createDeferred();
            unlinkDeferreds.push( deferred );
            return deferred.promise;
        };

        childProcess.spawn = function()
        {
            spawnCount++;
            if( spawnCount === 1 )
            {
                firstSpawned.resolve();
                return firstProcess;
            }

            secondSpawned.resolve();
            return secondProcess;
        };

        var firstSearch = ripgrep.search( '/', {
            rgPath: fakeRgPath,
            regex: TODO_REGEX_SOURCE,
            unquotedRegex: TODO_REGEX_SOURCE,
            additional: '',
            globs: [],
            multiline: false,
            patternFilePath: patternFilePath
        } );

        var secondSearch;

        return firstSpawned.promise.then( function()
        {
            firstProcess.stdout.emit( 'data', Buffer.from( '{"type":' + '\n' ) );
            secondSearch = ripgrep.search( '/', {
                rgPath: fakeRgPath,
                regex: TODO_REGEX_SOURCE,
                unquotedRegex: TODO_REGEX_SOURCE,
                additional: '',
                globs: [],
                multiline: false
            } );

            return secondSpawned.promise;
        } ).then( function()
        {
            unlinkDeferreds.forEach( function( deferred )
            {
                deferred.resolve();
            } );

            return firstSearch.then( function()
            {
                assert.ok( false, 'expected first search rejection' );
            }, function( error )
            {
                assert.ok( error instanceof ripgrep.RipgrepError );
            } );
        } ).then( function()
        {
            ripgrep.kill();
            assert.equal( secondKilled, true );
            return secondSearch.then( function()
            {
                assert.ok( false, 'expected second search cancellation' );
            }, function( error )
            {
                assert.ok( error instanceof ripgrep.RipgrepError );
                assert.equal( error.cancelled, true );
            } );
        } ).finally( function()
        {
            fs.promises.unlink = originalUnlink;
        } );
    } );

    QUnit.test( "kill cancels only the active search state", function( assert )
    {
        var firstProcess = createFakeProcess();
        var secondProcess = createFakeProcess();
        var firstSpawned = createDeferred();
        var secondSpawned = createDeferred();
        var spawnCount = 0;

        childProcess.spawn = function()
        {
            spawnCount++;
            if( spawnCount === 1 )
            {
                firstSpawned.resolve();
                return firstProcess;
            }

            secondSpawned.resolve();
            return secondProcess;
        };

        var firstSearch = ripgrep.search( '/', {
            rgPath: fakeRgPath,
            regex: TODO_REGEX_SOURCE,
            unquotedRegex: TODO_REGEX_SOURCE,
            additional: '',
            globs: [],
            multiline: false
        } );

        var secondSearch;

        return firstSpawned.promise.then( function()
        {
            secondSearch = ripgrep.search( '/', {
                rgPath: fakeRgPath,
                regex: TODO_REGEX_SOURCE,
                unquotedRegex: TODO_REGEX_SOURCE,
                additional: '',
                globs: [],
                multiline: false
            } );

            return secondSpawned.promise;
        } ).then( function()
        {
            ripgrep.kill();

            return secondSearch.then( function()
            {
                assert.ok( false, 'expected second search cancellation' );
            }, function( error )
            {
                assert.ok( error instanceof ripgrep.RipgrepError );
                assert.equal( error.cancelled, true );
            } );
        } ).then( function()
        {
            firstProcess.emit( 'close', 0, null );
            return firstSearch;
        } ).then( function( summary )
        {
            assert.deepEqual( summary, { stats: { matches: 0 } } );
        } );
    } );

    QUnit.test( "kill cancels the active search", function( assert )
    {
        childProcess.spawn = function()
        {
            var fakeProcess = createFakeProcess();
            process.nextTick( function()
            {
                ripgrep.kill();
            } );
            return fakeProcess;
        };

        var promise = ripgrep.search( '/', {
            rgPath: fakeRgPath,
            regex: TODO_REGEX_SOURCE,
            unquotedRegex: TODO_REGEX_SOURCE,
            additional: '',
            globs: [],
            multiline: false
        } ).then( function()
        {
            assert.ok( false, 'expected search cancellation' );
        }, function( error )
        {
            assert.equal( error.cancelled, true );
        } );

        return promise;
    } );

    QUnit.test( "search passes filenames with spaces and parentheses as a single spawn argument", function( assert )
    {
        var seenArgs;
        childProcess.spawn = function( executable, args )
        {
            seenArgs = args;

            var fakeProcess = createFakeProcess();
            process.nextTick( function()
            {
                fakeProcess.emit( 'close', 1, null );
            } );
            return fakeProcess;
        };

        return ripgrep.search( '/', {
            rgPath: fakeRgPath,
            regex: TODO_REGEX_SOURCE,
            unquotedRegex: TODO_REGEX_SOURCE,
            additional: '',
            globs: [],
            multiline: false,
            filename: '/tmp/project (feature branch)/file name.js'
        } ).then( function()
        {
            assert.equal( seenArgs[ seenArgs.length - 1 ], '/tmp/project (feature branch)/file name.js' );
        } );
    } );

    QUnit.test( "search passes ripgrep executable paths with spaces and parentheses directly to spawn", function( assert )
    {
        var seenExecutable;
        var spacedRgPath = path.join( os.tmpdir(), 'todo tree (rg binary)' );

        fs.writeFileSync( spacedRgPath, '', { mode: 0o755 } );

        childProcess.spawn = function( executable )
        {
            seenExecutable = executable;

            var fakeProcess = createFakeProcess();
            process.nextTick( function()
            {
                fakeProcess.emit( 'close', 1, null );
            } );
            return fakeProcess;
        };

        return ripgrep.search( '/', {
            rgPath: spacedRgPath,
            regex: TODO_REGEX_SOURCE,
            unquotedRegex: TODO_REGEX_SOURCE,
            additional: '',
            globs: [],
            multiline: false
        } ).then( function()
        {
            assert.equal( seenExecutable, spacedRgPath );
        } ).finally( function()
        {
            if( fs.existsSync( spacedRgPath ) )
            {
                fs.unlinkSync( spacedRgPath );
            }
        } );
    } );

    QUnit.test( "cleanup failures surface as ripgrep errors", function( assert )
    {
        var originalUnlink = fs.promises.unlink;
        var patternFilePath = path.join( os.tmpdir(), 'todo-tree-pattern-test.txt' );

        fs.promises.unlink = function()
        {
            return Promise.reject( Object.assign( new Error( 'unlink failed' ), { code: 'EPERM' } ) );
        };

        childProcess.spawn = function()
        {
            var fakeProcess = createFakeProcess();
            process.nextTick( function()
            {
                fakeProcess.emit( 'close', 1, null );
            } );
            return fakeProcess;
        };

        return ripgrep.search( '/', {
            rgPath: fakeRgPath,
            regex: TODO_REGEX_SOURCE,
            unquotedRegex: TODO_REGEX_SOURCE,
            additional: '',
            globs: [],
            multiline: false,
            patternFilePath: patternFilePath
        } ).then( function()
        {
            assert.ok( false, 'expected cleanup failure' );
        }, function( error )
        {
            assert.ok( regexRegistry.createRegExp( 'unlinkFailed' ).test( error.message ) );
        } ).finally( function()
        {
            fs.promises.unlink = originalUnlink;
            if( fs.existsSync( patternFilePath ) )
            {
                fs.unlinkSync( patternFilePath );
            }
        } );
    } );
} );
