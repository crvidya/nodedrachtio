var sip = require('./sip/sip')
  , sipMethods = require('./sip/methods')
  , utils = require('./utils')
  , Router = require('./router/router')
  , middleware = require('./middleware')
  , debug = require('debug')('drachtio:dispatcher');

var app = module.exports = {};

var env = process.env.NODE_ENV || 'development';

app.init = function(){
  this.settings = {};
  this.engines = {};
  this.defaultConfiguration();
};

/**
 * Initialize application configuration.
 *
 * @api private
 */

app.defaultConfiguration = function(){
  this.set('env', process.env.NODE_ENV || 'development');
  debug('booting in %s mode', this.get('env'));

  // implicit middleware
  this.use(middleware.init(this));

  // router
  this._router = new Router(this);
  this.routes = this._router.map;
  this.__defineGetter__('router', function(){
    this._usedRouter = true;
    this._router.caseSensitive = this.enabled('case sensitive routing');
    this._router.strict = this.enabled('strict routing');
    return this._router.middleware;
  });
};

/**
 * Utilize the given middleware `handle` to the given `route`,
 * defaulting to _/_. This "route" is the mount-point for the
 * middleware, when given a value other than _/_ the middleware
 * is only effective when that segment is present in the request's
 * pathname.
 *
 * For example if we were to mount a function at _/admin_, it would
 * be invoked on _/admin_, and _/admin/settings_, however it would
 * not be invoked for _/_, or _/posts_.
 *
 * Examples:
 *
 *      var app = connect();
 *      app.use(connect.favicon());
 *      app.use(connect.logger());
 *      app.use(connect.static(__dirname + '/public'));
 *
 * If we wanted to prefix static files with _/public_, we could
 * "mount" the `static()` middleware:
 *
 *      app.use('/public', connect.static(__dirname + '/public'));
 *
 * This api is chainable, so the following is valid:
 *
 *      connect()
 *        .use(connect.favicon())
 *        .use(connect.logger())
 *        .use(connect.static(__dirname + '/public'))
 *        .listen(3000);
 *
 * @param {String|Function|Server} route, callback or server
 * @param {Function|Server} callback or server
 * @return {Server} for chaining
 * @api public
 */

app.use = function(msgType, fn){
  // default route to '/'
  if ('string' != typeof msgType) {
    fn = msgType;
    msgType = 'all';
  }

  // wrap sub-apps
  if ('function' == typeof fn.handle) {
    var server = fn;
    fn.msgType = msgType;
    fn = function(req, res, next){
      server.handle(req, res, next);
    };
  }

  // add the middleware
  debug('use %s %s', msgType || 'all', fn.name || 'anonymous');
  this.stack.push({ msgType: msgType, handle: fn });

  return this;
};


app.handle = function(err, req, res, out) {
  var stack = this.stack
    , index = 0;

  function next(err) {
    var layer, msgType, c;

    // next callback
    layer = stack[index++];

    // all done
    if (!layer || res.headerSent) {
      // delegate to parent
      if (out) return out(err);

      // unhandled error
      if (err) {
        // production gets a basic error message
        var msg = 'production' == env
          ? sip.STATUS_CODES[res.statusCode]
          : err.stack || err.toString();
        //msg = utils.escape(msg);

        // log to stderr in a non-test env
        if ('test' != env) console.error(err.stack || err.toString());

        // if this is a response we were going to send (as opposed to receive) default to 500
        if( res.source === 'network') return ;

        if (res.statusCode < 400) res.statusCode = 500;
        debug('unhandled error',err) ;

        // respect err.status
        if (err.status) res.statusCode = err.status;

        if (res.headerSent) return ;

        res.send();
 
      } else if( req.request_uri.method === 'INVITE' && 'network' === req.source ) {
        debug('default 404');
        res.send(404) ;
      } else if( (req.request_uri.method === 'BYE' || req.request_uri.method === 'CANCEL') && 'network' === req.source ) {
        debug('default 200');
        res.send(200) ;
      }
      else if('network' === req.source) {
        debug('no handler in app for %s', req.request_uri.method) ;
      }
      return;
    }

    try {
      msgType = req.type ;
      var method = req.method ? req.method.toLowerCase() : undefined ;

      //path = utils.parseUrl(req).pathname;
      if (undefined == msgType) throw new Error('msgType is undefined');

      // skip this layer if the msgType doesn't match.
      if ('all' !== layer.msgType && msgType !== layer.msgType && method !== layer.msgType) return next(err);

      // Call the layer handler
      debug('%s %s : %s', layer.handle.name || 'anonymous', layer.msgType, msgType);
      var arity = layer.handle.length;
      if (err) {
        if (arity === 4) {
          layer.handle(err, req, res, next);
        } else {
          next(err);
        }
      } else if (arity < 4) {
        layer.handle(req, res, next);
      } else if( layer.handle.name === 'router') {
         layer.handle(err, req, res, next);
      } else {
        next();
      }
    } catch (e) {
      next(e);
    }
  }
  next(err);
};

/**
 * Assign `setting` to `val`, or return `setting`'s value.
 *
 *    app.set('foo', 'bar');
 *    app.get('foo');
 *    // => "bar"
 *
 * Mounted servers inherit their parent server's settings.
 *
 * @param {String} setting
 * @param {String} val
 * @return {Server} for chaining
 * @api public
 */

app.set = function(setting, val){
  if (1 == arguments.length) {
    if (this.settings.hasOwnProperty(setting)) {
      return this.settings[setting];
    } else if (this.parent) {
      return this.parent.set(setting);
    }
  } else {
    this.settings[setting] = val;
    return this;
  }
};
app.get = function(setting) { return this.set(setting) ; }

/**
 * Check if `setting` is enabled (truthy).
 *
 *    app.enabled('foo')
 *    // => false
 *
 *    app.enable('foo')
 *    app.enabled('foo')
 *    // => true
 *
 * @param {String} setting
 * @return {Boolean}
 * @api public
 */

app.enabled = function(setting){
  return !!this.set(setting);
};

/**
 * Check if `setting` is disabled.
 *
 *    app.disabled('foo')
 *    // => true
 *
 *    app.enable('foo')
 *    app.disabled('foo')
 *    // => false
 *
 * @param {String} setting
 * @return {Boolean}
 * @api public
 */

app.disabled = function(setting){
  return !this.set(setting);
};

/**
 * Enable `setting`.
 *
 * @param {String} setting
 * @return {app} for chaining
 * @api public
 */

app.enable = function(setting){
  return this.set(setting, true);
};

/**
 * Disable `setting`.
 *
 * @param {String} setting
 * @return {app} for chaining
 * @api public
 */

app.disable = function(setting){
  return this.set(setting, false);
};

sipMethods.forEach(function(method){
  app[method] = function(){
    var args = [method].concat([].slice.call(arguments));
    if (!this._usedRouter) this.use(this.router);
    this._router.route.apply(this._router, args);
  
    /* notify drachtio we want these requests */
    this.agent.route(method) ;
  
    return this;
  };
});

app.routeTransaction = function( transactionId, callbacks) {
  if (!this._usedRouter) this.use(this.router);
  this._router.routeTransaction.apply( this._router, [].slice.call( arguments ) ) ;
  return this;   
}

app.connect = function(){
  var self = this ;
  this.agent = this.uac.agent = sip.createAgent(this);  
  var args = [].slice.call( arguments );
  if( 0 == args.length || (1 === args.length && typeof args[0] == 'function') ) {
    args.unshift({
      port: this.get('port') || 8022
      ,host: this.get('host')
      ,secret: this.get('secret')
    }) ;
  }

  /* proxy connect and disconnect events from the agent since call only holds a reference to us (the app)*/
  this.agent.on('connect', function(e) { 
    debug('agent emitted connect')
    var pos = e.hostport.indexOf(':') ;
    var host = -1 == pos ? e.hostport : e.hostport.slice(0,pos) ;
    var port = -1 == pos ? 5060 : e.hostport.slice(++pos) ;
    self.set('hostport', e.hostport) ;
    self.set('sip address', host) ;
    self.set('sip port', port) ;
    self.emit('connect', e); 
  }) ;
  this.agent.on('disconnect', function() { self.emit('disconnect');}) ;

  return this.agent.connect.apply(this.agent, args);
};

app.disconnect = function() {
  this.agent.disconnect() ;

}