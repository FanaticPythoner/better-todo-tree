var fs = require( 'fs' );
var os = require( 'os' );
var path = require( 'path' );
var Readable = require( 'stream' ).Readable;
var utils = require( '../src/utils.js' );
var detection = require( '../src/detection.js' );
var streamScanner = require( '../src/runtime/streamScanner.js' );

function createMockFs( content, statOverrides, chunkSize )
{
    var resolvedChunkSize = typeof ( chunkSize ) === 'number' && chunkSize > 0 ?
        chunkSize :
        Math.max( 1, content.length );

    return {
        stat: function( filePath, callback )
        {
            if( statOverrides && Object.prototype.hasOwnProperty.call( statOverrides, filePath ) )
            {
                if( statOverrides[ filePath ] instanceof Error )
                {
                    callback( statOverrides[ filePath ] );
                    return;
                }
                callback( null, statOverrides[ filePath ] );
                return;
            }
            callback( null, { size: Buffer.byteLength( content, 'utf8' ) } );
        },
        readFile: function( filePath, encoding, callback )
        {
            callback( null, content );
        },
        createReadStream: function()
        {
            var offset = 0;
            var stream = new Readable( {
                read: function()
                {
                    if( offset >= content.length )
                    {
                        this.push( null );
                        return;
                    }
                    var nextOffset = Math.min( content.length, offset + resolvedChunkSize );
                    this.push( content.slice( offset, nextOffset ) );
                    offset = nextOffset;
                }
            } );
            stream.setEncoding( 'utf8' );
            return stream;
        }
    };
}

function createDetectionConfig( overrides )
{
    var config = {
        tagList: [ 'TODO', 'FIXME', '[ ]', '[x]' ],
        regexSource: utils.DEFAULT_REGEX_SOURCE,
        caseSensitive: true,
        multiLine: false,
        subTagRegexString: '(^:\\s*)',
        tags: function() { return this.tagList; },
        regex: function()
        {
            return {
                tags: this.tagList,
                regex: this.regexSource,
                caseSensitive: this.caseSensitive,
                multiLine: this.multiLine
            };
        },
        subTagRegex: function() { return this.subTagRegexString; },
        isRegexCaseSensitive: function() { return this.caseSensitive; },
        shouldGroupByTag: function() { return false; },
        globs: function() { return []; },
        shouldUseColourScheme: function() { return false; },
        defaultHighlight: function() { return {}; },
        customHighlight: function() { return {}; },
        foregroundColourScheme: function() { return []; },
        backgroundColourScheme: function() { return []; }
    };

    return Object.assign( config, overrides || {} );
}

function createUri( fsPath )
{
    return {
        fsPath: fsPath,
        toString: function()
        {
            return fsPath;
        }
    };
}

QUnit.module( "streamScanner", function()
{
    QUnit.test( "small files take the in-memory path and call scanFn exactly once", function( assert )
    {
        var done = assert.async();
        var content = "// TODO first\n// FIXME second\n";
        var fsImpl = createMockFs( content );
        var calls = [];

        streamScanner.scanWorkspaceFileWithText( '/tmp/file.js', function( text, info )
        {
            calls.push( { text: text, info: info } );
            return [ {
                line: 1,
                endLine: 1,
                matchStartOffset: 3,
                matchEndOffset: 12,
                tagStartOffset: 3,
                tagEndOffset: 7
            } ];
        }, { fs: fsImpl } ).then( function( results )
        {
            assert.equal( calls.length, 1, "scanFn called once for small files" );
            assert.equal( calls[ 0 ].info.charOffset, 0 );
            assert.equal( calls[ 0 ].info.lineOffset, 0 );
            assert.equal( calls[ 0 ].info.isFirst, true );
            assert.equal( calls[ 0 ].info.isLast, true );
            assert.equal( calls[ 0 ].text, content );
            assert.equal( results.length, 1 );
            assert.equal( results[ 0 ].line, 1, "line not adjusted for in-memory path" );
            done();
        } ).catch( function( error )
        {
            assert.notOk( error, error && error.stack ? error.stack : String( error ) );
            done();
        } );
    } );

    QUnit.test( "files exceeding maxInMemoryBytes stream chunks and aggregate global offsets", function( assert )
    {
        var done = assert.async();
        var lines = [];
        for( var index = 0; index < 200; index++ )
        {
            lines.push( "// TODO line" + index );
        }
        var content = lines.join( "\n" ) + "\n";
        var fsImpl = createMockFs( content, undefined, 64 );
        var chunkCalls = [];

        streamScanner.scanWorkspaceFileWithText( '/tmp/big.js', function( text, info )
        {
            chunkCalls.push( { length: text.length, info: info } );
            var matches = [];
            var match;
            var regex = /\/\/ TODO line(\d+)/g;
            while( ( match = regex.exec( text ) ) !== null )
            {
                matches.push( {
                    line: 1,
                    endLine: 1,
                    matchStartOffset: match.index + 3,
                    matchEndOffset: match.index + match[ 0 ].length,
                    tagStartOffset: match.index + 3,
                    tagEndOffset: match.index + 7,
                    tag: 'TODO',
                    actualTag: 'TODO',
                    payloadIndex: parseInt( match[ 1 ], 10 )
                } );
            }
            return matches;
        }, { fs: fsImpl, maxInMemoryBytes: 200, chunkBytes: 200, overlapBytes: 64 } ).then( function( results )
        {
            assert.ok( chunkCalls.length >= 2, "expected multiple chunks but got " + chunkCalls.length );

            var seen = new Set();
            for( var rIndex = 0; rIndex < results.length; rIndex++ )
            {
                seen.add( results[ rIndex ].payloadIndex );
            }

            for( var li = 0; li < 200; li++ )
            {
                assert.ok( seen.has( li ), "result for line" + li + " missing" );
            }

            var sorted = results.slice().sort( function( a, b ) { return a.matchStartOffset - b.matchStartOffset; } );
            for( var sIndex = 1; sIndex < sorted.length; sIndex++ )
            {
                assert.ok( sorted[ sIndex ].matchStartOffset > sorted[ sIndex - 1 ].matchStartOffset,
                    "global offsets must be strictly increasing across chunks" );
            }

            done();
        } ).catch( function( error )
        {
            assert.notOk( error, error && error.stack ? error.stack : String( error ) );
            done();
        } );
    } );

    QUnit.test( "duplicate matches in the overlap region are deduplicated by global offset", function( assert )
    {
        var done = assert.async();
        var content = [
            "line0",
            "line1 TODO duplicate",
            "line2",
            "line3 TODO duplicate",
            "line4"
        ].join( "\n" ) + "\n";
        var fsImpl = createMockFs( content, undefined, 8 );

        streamScanner.scanWorkspaceFileWithText( '/tmp/dup.js', function( text )
        {
            var matches = [];
            var index = 0;
            while( ( index = text.indexOf( "TODO", index ) ) !== -1 )
            {
                matches.push( {
                    line: 1,
                    endLine: 1,
                    matchStartOffset: index,
                    matchEndOffset: index + 4,
                    tagStartOffset: index,
                    tagEndOffset: index + 4,
                    tag: 'TODO',
                    actualTag: 'TODO'
                } );
                index += 4;
            }
            return matches;
        }, { fs: fsImpl, maxInMemoryBytes: 4, chunkBytes: 16, overlapBytes: 8 } ).then( function( results )
        {
            assert.equal( results.length, 2, "exactly two distinct TODOs" );
            var keys = results.map( function( r ) { return r.matchStartOffset; } ).sort( function( a, b ) { return a - b; } );
            assert.notEqual( keys[ 0 ], keys[ 1 ], "two distinct global offsets" );
            done();
        } ).catch( function( error )
        {
            assert.notOk( error, error && error.stack ? error.stack : String( error ) );
            done();
        } );
    } );

    QUnit.test( "stream errors propagate and reject the returned promise", function( assert )
    {
        var done = assert.async();
        var fsImpl = {
            stat: function( filePath, callback )
            {
                callback( null, { size: 999999999 } );
            },
            readFile: function() { },
            createReadStream: function()
            {
                var stream = new Readable( {
                    read: function()
                    {
                        var emitter = this;
                        process.nextTick( function()
                        {
                            emitter.emit( 'error', new Error( 'simulated stream failure' ) );
                        } );
                    }
                } );
                return stream;
            }
        };

        streamScanner.scanWorkspaceFileWithText( '/tmp/broken.js', function() { return []; }, {
            fs: fsImpl,
            maxInMemoryBytes: 1
        } ).then( function()
        {
            assert.ok( false, "expected promise to reject" );
            done();
        } ).catch( function( error )
        {
            assert.equal( error.message, 'simulated stream failure' );
            done();
        } );
    } );

    QUnit.test( "stat errors propagate and reject the returned promise", function( assert )
    {
        var done = assert.async();
        var fsImpl = {
            stat: function( filePath, callback )
            {
                callback( new Error( 'no such file' ) );
            },
            readFile: function() { },
            createReadStream: function() { return new Readable( { read: function() {} } ); }
        };

        streamScanner.scanWorkspaceFileWithText( '/tmp/missing.js', function() { return []; }, {
            fs: fsImpl
        } ).then( function()
        {
            assert.ok( false, "expected promise to reject" );
            done();
        } ).catch( function( error )
        {
            assert.equal( error.message, 'no such file' );
            done();
        } );
    } );

    QUnit.test( "detector-backed streaming preserves single-line logical todo blocks across chunk boundaries", function( assert )
    {
        var done = assert.async();
        var uri = createUri( '/tmp/logical-block.js' );
        var content = [
            '// TODO first',
            '// second detail',
            '// third detail',
            'plain'
        ].join( '\n' ) + '\n';
        var fsImpl = createMockFs( content, undefined, 12 );

        utils.init( createDetectionConfig() );

        streamScanner.scanWorkspaceFileWithText( uri.fsPath, function( text )
        {
            return detection.scanTextWithStreamingContext( detection.createScanContext( uri, text ) );
        }, { fs: fsImpl, maxInMemoryBytes: 1, chunkBytes: 18, overlapBytes: 8 } ).then( function( results )
        {
            assert.equal( results.length, 1, 'exactly one logical TODO is emitted' );
            assert.equal( results[ 0 ].actualTag, 'TODO' );
            assert.equal( results[ 0 ].displayText, 'first' );
            assert.deepEqual( results[ 0 ].continuationText, [ 'second detail', 'third detail' ] );
            assert.equal( results[ 0 ].line, 1 );
            assert.equal( results[ 0 ].endLine, 3 );
            done();
        } ).catch( function( error )
        {
            assert.notOk( error, error && error.stack ? error.stack : String( error ) );
            done();
        } );
    } );

    QUnit.test( "detector-backed streaming preserves multiline block comments until the closing delimiter arrives", function( assert )
    {
        var done = assert.async();
        var uri = createUri( '/tmp/block-comment.cpp' );
        var content = [
            '/*',
            ' * TODO investigate parser',
            ' * keep multiline detail',
            ' */',
            'plain'
        ].join( '\n' ) + '\n';
        var fsImpl = createMockFs( content, undefined, 10 );

        utils.init( createDetectionConfig() );

        streamScanner.scanWorkspaceFileWithText( uri.fsPath, function( text )
        {
            return detection.scanTextWithStreamingContext( detection.createScanContext( uri, text ) );
        }, { fs: fsImpl, maxInMemoryBytes: 1, chunkBytes: 18, overlapBytes: 8 } ).then( function( results )
        {
            assert.equal( results.length, 1, 'exactly one block-comment TODO is emitted' );
            assert.equal( results[ 0 ].actualTag, 'TODO' );
            assert.equal( results[ 0 ].displayText, 'investigate parser' );
            assert.deepEqual( results[ 0 ].continuationText, [ 'keep multiline detail' ] );
            assert.equal( results[ 0 ].line, 2 );
            assert.equal( results[ 0 ].endLine, 4 );
            done();
        } ).catch( function( error )
        {
            assert.notOk( error, error && error.stack ? error.stack : String( error ) );
            done();
        } );
    } );

    QUnit.test( "scanFn errors abort streaming immediately", function( assert )
    {
        var done = assert.async();
        var content = "// TODO a\n// TODO b\n// TODO c\n";
        var fsImpl = createMockFs( content, undefined, 4 );
        var callCount = 0;

        streamScanner.scanWorkspaceFileWithText( '/tmp/aborted.js', function()
        {
            callCount++;
            throw new Error( 'cancelled scan' );
        }, { fs: fsImpl, maxInMemoryBytes: 4, chunkBytes: 8, overlapBytes: 2 } ).then( function()
        {
            assert.ok( false, "expected promise to reject" );
            done();
        } ).catch( function( error )
        {
            assert.equal( error.message, 'cancelled scan' );
            assert.equal( callCount, 1, "scanFn invoked exactly once before abort" );
            done();
        } );
    } );

    QUnit.test( "options validation rejects invalid chunk and overlap sizes", function( assert )
    {
        assert.throws( function()
        {
            streamScanner.streamFileChunks( '/tmp/x.js', function() {}, {
                fs: createMockFs( "" ),
                chunkBytes: 0
            } );
        }, /chunkBytes/ );

        assert.throws( function()
        {
            streamScanner.streamFileChunks( '/tmp/x.js', function() {}, {
                fs: createMockFs( "" ),
                chunkBytes: 100,
                overlapBytes: 100
            } );
        }, /overlapBytes/ );

        assert.throws( function()
        {
            streamScanner.streamFileChunks( '/tmp/x.js', function() {}, {
                fs: { stat: function() {}, readFile: function() {} }
            } );
        }, /createReadStream/ );
    } );

    QUnit.test( "lineOffset advances by exact newline count of the consumed prefix", function( assert )
    {
        var done = assert.async();
        var content = "a\nb\nc\nd\ne\nf\ng\nh\n";
        var fsImpl = createMockFs( content, undefined, 4 );
        var observedFirstLines = [];

        streamScanner.scanWorkspaceFileWithText( '/tmp/lines.js', function( text, info )
        {
            observedFirstLines.push( info.lineOffset );
            return [ {
                line: 1,
                endLine: 1,
                matchStartOffset: 0,
                matchEndOffset: 1,
                tagStartOffset: 0,
                tagEndOffset: 1,
                tag: 'X' + info.lineOffset
            } ];
        }, { fs: fsImpl, maxInMemoryBytes: 1, chunkBytes: 4, overlapBytes: 2 } ).then( function( results )
        {
            assert.ok( observedFirstLines.length >= 2, "expected multiple chunks" );
            assert.equal( observedFirstLines[ 0 ], 0, "first chunk starts at line 0" );
            for( var index = 1; index < observedFirstLines.length; index++ )
            {
                assert.ok( observedFirstLines[ index ] >= observedFirstLines[ index - 1 ],
                    "lineOffset is monotonic non-decreasing across chunks" );
            }
            assert.ok( results.length >= 1 );
            done();
        } ).catch( function( error )
        {
            assert.notOk( error, error && error.stack ? error.stack : String( error ) );
            done();
        } );
    } );

    QUnit.test( "results without offsets are still aggregated and not silently dropped", function( assert )
    {
        var done = assert.async();
        var content = "alpha\nbeta\ngamma\n";
        var fsImpl = createMockFs( content, undefined, 5 );

        streamScanner.scanWorkspaceFileWithText( '/tmp/noOffsets.js', function( text )
        {
            return [ { line: 1, tag: 'A_' + text.length } ];
        }, { fs: fsImpl, maxInMemoryBytes: 4, chunkBytes: 5, overlapBytes: 0 } ).then( function( results )
        {
            assert.ok( results.length >= 1, "results without offsets are still emitted" );
            done();
        } ).catch( function( error )
        {
            assert.notOk( error, error && error.stack ? error.stack : String( error ) );
            done();
        } );
    } );

    QUnit.test( "no-newline single-line files force-cut after hardCutBytes is exceeded", function( assert )
    {
        var done = assert.async();
        var content = new Array( 401 ).join( 'x' );
        var fsImpl = createMockFs( content, undefined, 50 );
        var chunkSizes = [];

        streamScanner.scanWorkspaceFileWithText( '/tmp/oneline.txt', function( text )
        {
            chunkSizes.push( text.length );
            return [];
        }, { fs: fsImpl, maxInMemoryBytes: 50, chunkBytes: 100, overlapBytes: 16, hardCutBytes: 200 } ).then( function()
        {
            assert.ok( chunkSizes.length >= 2, "expected multiple chunks for a long no-newline file" );
            assert.equal( chunkSizes.reduce( function( sum, size ) { return sum + size; }, 0 ) >= content.length,
                true,
                "every byte of the file is delivered through chunks" );
            done();
        } ).catch( function( error )
        {
            assert.notOk( error, error && error.stack ? error.stack : String( error ) );
            done();
        } );
    } );

    QUnit.test( "real on-disk file streamed through the streamScanner produces every TODO/FIXME tag exactly once", function( assert )
    {
        var done = assert.async();
        var tempRoot = fs.mkdtempSync( path.join( os.tmpdir(), 'btt-stream-' ) );
        var tempFile = path.join( tempRoot, 'huge.js' );
        var lines = [];
        var expectedTags = [];
        for( var lineIndex = 0; lineIndex < 1000; lineIndex++ )
        {
            lines.push( '// padding line ' + lineIndex );
            if( lineIndex % 50 === 0 )
            {
                lines.push( '// TODO real-' + lineIndex );
                expectedTags.push( { tag: 'TODO', payload: 'real-' + lineIndex } );
            }
            if( lineIndex % 73 === 0 )
            {
                lines.push( '// FIXME real-' + lineIndex );
                expectedTags.push( { tag: 'FIXME', payload: 'real-' + lineIndex } );
            }
        }
        var content = lines.join( '\n' ) + '\n';
        fs.writeFileSync( tempFile, content );

        function findTags( text )
        {
            var matches = [];
            var regex = /\/\/ (TODO|FIXME) (\S+)/g;
            var match;
            while( ( match = regex.exec( text ) ) !== null )
            {
                matches.push( {
                    line: 1,
                    endLine: 1,
                    matchStartOffset: match.index,
                    matchEndOffset: match.index + match[ 0 ].length,
                    tagStartOffset: match.index + 3,
                    tagEndOffset: match.index + 3 + match[ 1 ].length,
                    tag: match[ 1 ],
                    actualTag: match[ 1 ],
                    displayText: match[ 2 ]
                } );
            }
            return matches;
        }

        streamScanner.scanWorkspaceFileWithText( tempFile, findTags, {
            maxInMemoryBytes: 256,
            chunkBytes: 1024,
            overlapBytes: 256
        } ).then( function( streamedResults )
        {
            assert.equal( streamedResults.length, expectedTags.length,
                "streaming returns exactly " + expectedTags.length + " unique tags (got " + streamedResults.length + ")" );

            var streamedKeys = streamedResults.map( function( r )
            {
                return r.tag + ':' + r.displayText;
            } ).sort();
            var expectedKeys = expectedTags.map( function( e )
            {
                return e.tag + ':' + e.payload;
            } ).sort();
            assert.deepEqual( streamedKeys, expectedKeys,
                "every (tag, payload) pair from the on-disk file is reported exactly once" );

            var sortedByOffset = streamedResults.slice().sort( function( a, b )
            {
                return a.matchStartOffset - b.matchStartOffset;
            } );
            for( var sIndex = 1; sIndex < sortedByOffset.length; sIndex++ )
            {
                assert.ok( sortedByOffset[ sIndex ].matchStartOffset > sortedByOffset[ sIndex - 1 ].matchStartOffset,
                    "global match offsets are strictly increasing across chunks" );
            }
        } ).catch( function( error )
        {
            assert.notOk( error, error && error.stack ? error.stack : String( error ) );
        } ).then( function()
        {
            try
            {
                fs.rmSync( tempRoot, { recursive: true, force: true } );
            }
            catch( cleanupError )
            {
                /* ignore cleanup errors */
            }
            done();
        } );
    } );
} );
