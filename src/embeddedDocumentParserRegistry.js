function EmbeddedDocumentParserError( message )
{
    this.name = 'EmbeddedDocumentParserError';
    this.message = message;
    Error.captureStackTrace( this, EmbeddedDocumentParserError );
}

EmbeddedDocumentParserError.prototype = Object.create( Error.prototype );
EmbeddedDocumentParserError.prototype.constructor = EmbeddedDocumentParserError;

function validateParserId( id )
{
    if( typeof ( id ) !== 'string' || id.length === 0 )
    {
        throw new EmbeddedDocumentParserError( 'embeddedDocumentParserRegistry: parser id is required.' );
    }
}

function validateParserFactory( id, factory )
{
    validateParserId( id );

    if( typeof ( factory ) !== 'function' )
    {
        throw new EmbeddedDocumentParserError( 'embeddedDocumentParserRegistry: factory is required for ' + id + '.' );
    }
}

function EmbeddedDocumentParserRegistry()
{
    this.factories = new Map();
}

EmbeddedDocumentParserRegistry.prototype.register = function( id, factory )
{
    validateParserFactory( id, factory );

    if( this.factories.has( id ) )
    {
        throw new EmbeddedDocumentParserError( 'embeddedDocumentParserRegistry: duplicate parser id ' + id + '.' );
    }

    this.factories.set( id, factory );
    return this;
};

EmbeddedDocumentParserRegistry.prototype.create = function( id, options )
{
    validateParserId( id );

    if( this.factories.has( id ) !== true )
    {
        throw new EmbeddedDocumentParserError( 'embeddedDocumentParserRegistry: unknown parser id ' + id + '.' );
    }

    var parser = this.factories.get( id )( options || {} );

    if( !parser || typeof ( parser.parse ) !== 'function' )
    {
        throw new EmbeddedDocumentParserError( 'embeddedDocumentParserRegistry: parser ' + id + ' must expose parse(text).' );
    }

    return parser;
};

function createEmbeddedDocumentParserRegistry()
{
    return new EmbeddedDocumentParserRegistry();
}

module.exports.EmbeddedDocumentParserError = EmbeddedDocumentParserError;
module.exports.EmbeddedDocumentParserRegistry = EmbeddedDocumentParserRegistry;
module.exports.createEmbeddedDocumentParserRegistry = createEmbeddedDocumentParserRegistry;
