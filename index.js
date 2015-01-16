/**
 * A resource used to query Google APIs
 */

var Resource   = require('deployd/lib/resource'),
    util       = require('util'),
    url        = require('url'),
    googleapis = require('googleapis'),
    _          = require('lodash-node'),
    OAuth2     = googleapis.auth.OAuth2;

/**
 * @constructor
 * GAPIResource constructor
 */
function GAPIResource() {
    Resource.apply(this, arguments);
}

util.inherits(GAPIResource, Resource);

GAPIResource.label = 'Google API Resource';

GAPIResource.basicDashboard = {
    settings : [
        {
            name : 'clientID',
            type : 'text'
        },

        {
            name : 'clientSecret',
            type : 'text'
        },

        {
            name        : 'authScopes',
            type        : 'textarea',
            description : 'Enter one auth scope per line'
        },

        {
            name : 'allowAnonymous',
            type : 'checkbox'
        }
    ]
};

GAPIResource.prototype.clientGeneration = true;

/**
 * Getter for the auth store, creates it if it doesn't already exist
 */
GAPIResource.prototype.getAuthStore = function() {
    return process.server.createStore('GAPIResourceAuthStore');
};

/**
 * @param {Context} A server context object
 * @return {object} An object with interesting bits about the request:
 *    url - the full url in the form /<instance>/<api>/<apiVersion>/<command><query>
 *    host - <hostname>:<port>
 *    instance - The name of the instance of GAPIResource being requested
 *    api - The Google API being requested (ex: drive)
 *    apiVersion - The version of the Google API being requested (ex: v2)
 *    command - The command to be issued against the Google API (ex: about/get)
 *    query - An object representing the querystring parameters passed
 *    body - An object representing the request body (valid for POST, PUT)
 *    apiMethod - Convenience property to gain access to the Google API client method
 */
GAPIResource.prototype.parseRequest = function(ctx) {
    var requestUrl = ctx.req.url,
        parsedUrl  = url.parse(requestUrl),
        urlChunks  = this.splitPath(parsedUrl.pathname),
        instance   = urlChunks.shift(),
        api        = urlChunks.shift(),
        apiVersion = urlChunks.shift(),
        command    = urlChunks.join('/'),
        query      = _.isEmpty(ctx.query) ? undefined : ctx.query,
        body       = _.isEmpty(ctx.body)  ? undefined : ctx.body;

    return {
        url        : requestUrl,
        host       : ctx.req.headers.host,
        instance   : instance,
        api        : api,
        apiVersion : apiVersion,
        command    : command,
        query      : query,
        body       : body,
        apiMethod  : command
    };
},

/**
 * Splits the raw path of a request into an array, discounting the 
 * empty strings resulting from the leading/trailing slashes
 * Also supports dot-delimited paths
 * @param {string} String representing a path in a request (ex: /<instance>/<api>/<apiVersion>/<command>)
 * @return {array} The path passed in split into an array
 */
GAPIResource.prototype.splitPath = function(path) {
    return path.split(/[\/.]/).filter(function(c) { return c; });
},

/**
 * Resolves a string path to the method of a Google API client
 * @param {object} client A client representation of a Google API
 * @param {string} path The path to a Google API method (slash or dot delimited)
 * @return {function} The Google API client function
 */
GAPIResource.prototype.getAPIMethod = function(client, path) {
    var chunkedPath = path.split(/[\/.]/).filter(function(c) { return c; });

    chunkedPath.forEach(function(chunk) {
        client = client[chunk];
    });

    return client;
}

/**
 * Initialization code to run before each request
 * The first time this is run, the auth store will be initialized with all the interesting bits
 * to start the oauth negotiation process
 * @param {Context} A server context object
 * @param {function} Standard callback function which will contain the oauth configuration
 */
GAPIResource.prototype.init = function(ctx, callback) {
    var _this         = this,
        authStore     = this.getAuthStore(),
        requestConfig = this.parseRequest(ctx);

    authStore.first({ instance : requestConfig.instance }, function(err, result) {
        if (err) {
            return callback(err);
        }

        if (result) {
            // callback with the complete store record
            callback(null, result);
        }
        else {
            // seed the store record with the instance name
            authStore.insert({
                instance      : requestConfig.instance,
                host          : requestConfig.host,
                client_id     : _this.config.clientID,
                client_secret : _this.config.clientSecret,
                scope         : _this.config.authScopes.split('\n').join(' '),
                redirect_uri  : [
                    'http:/',
                    requestConfig.host,
                    requestConfig.instance,
                    'auth',
                    'v1',
                    'oauth2callback'
                ].join('/')
            }, callback);
        }
    });
};

/**
 * Handles and routes incoming requests
 * @param {Context} ctx The server context object
 * @param {function} next Invoked when there are no matching routes, hands it back to the node router
 */
GAPIResource.prototype.handle = function(ctx, next) {
    var _this         = this,
        requestConfig = this.parseRequest(ctx),
        apiMethod;

    if (!this.config.allowAnonymous && !ctx.session.user) {
        ctx.done({ message : 'You must be logged in', statusCode : 500 });
    }

    this.init(ctx, function(err, oauthConfig) {
        var oauth2Client = new OAuth2(oauthConfig.client_id, oauthConfig.client_secret, oauthConfig.redirect_uri),
            api;

        if (err) {
            return ctx.done(err);
        }

        if (requestConfig.api === 'auth') {
            if (requestConfig.command === 'init') {
                // begin the application-owned account authentication process
                // by redirecting to a url used to get an authorization code
                ctx.res.writeHead(302, {
                        'Location'  : oauth2Client.generateAuthUrl({
                        access_type : 'offline',
                        scope       : oauthConfig.scope
                    })
                });
                ctx.res.end();
            }
            else if (requestConfig.command === 'oauth2callback') {
                oauth2Client.getToken(ctx.query.code, function(err, tokenConfig) {
                    // update the store with the access and refresh tokens
                    _this.getAuthStore().update({ instance : requestConfig.instance }, tokenConfig, ctx.done);
                });
            }
            else {
                return next();
            }
        }
        else {
            // set the access and refresh tokens for the request
            oauth2Client.setCredentials({
                access_token  : oauthConfig.access_token,
                refresh_token : oauthConfig.refresh_token
            });

            // Get the api object
            // An example this would equate to is googleapis.drive('v2');
            api = googleapis[requestConfig.api](requestConfig.apiVersion);

            // This will return the actual API method
            // An example of this would be drive.about.get()
            apiMethod = _this.getAPIMethod(api, requestConfig.apiMethod);

            if (apiMethod) {
                // Configure the parameters to be sent to the API method
                requestConfig.query = requestConfig.query || {};

                // Attach the oauth account to the request
                requestConfig.query.auth = oauth2Client;

                // Optionally add any body parameters
                if (requestConfig.body) {
                    requestConfig.query.resource = requestConfig.body;
                }

                // Execute the API request
                apiMethod(requestConfig.query, ctx.done);
            }
            else {
                next();
            }
        }
    });
};

module.exports = GAPIResource;