var fs = require( 'fs' );
var os = require( 'os' );
var path = require( 'path' );
var events = require( 'events' );
var childProcess = require( 'child_process' );

var ripgrep = require( '../src/ripgrep.js' );

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
            regex: '(TODO|FIXME)',
            unquotedRegex: '(TODO|FIXME)',
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
            regex: '(TODO)',
            unquotedRegex: '(TODO)',
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
            regex: '(TODO)',
            unquotedRegex: '(TODO)',
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
            regex: '(TODO)',
            unquotedRegex: '(TODO)',
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
            regex: '(TODO)',
            unquotedRegex: '(TODO)',
            additional: '',
            globs: [],
            multiline: false,
            patternFilePath: patternFilePath
        } ).then( function()
        {
            assert.ok( false, 'expected cleanup failure' );
        }, function( error )
        {
            assert.ok( /unlink failed/.test( error.message ) );
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
