var drachtio = require('../..')
,app = drachtio()
,RedisStore = require('drachtio-redis')(drachtio) 
,d = require('../fixtures/data')
,debug = require('debug')('drachtio:simple-uas2') ;

app.connect({
    host: 'localhost'
    ,port: 8022
    ,secret: 'cymru'
    ,appName: 'uas'
}) ;

app.use( drachtio.session({store: new RedisStore({host: 'localhost', prefix:''}) }) ) ;
app.use( drachtio.dialog() ) ;
app.use( app.router ) ;

app.invite(function(req, res) {

    req.session = {
        user: 'daveh'
        ,cdr: {
            start: new Date()
            ,end: Object.create(null)
        }
    }

    res.send(200, {
        headers: {
            'content-type': 'application/sdp'
        }
        ,body: d.dummySdp
    }) ;

    req.cancel( function( req, res ){
        debug('request was canceled')
    }) ;
}) ;

app.on('sipdialog:create', function(e) {
    var dialog = e.target ;
    var session = e.session ;

    debug('dialog was created, session: ', session) ;

    session.cdr.connect = new Date() ;
    session.save() ;
 })
.on('sipdialog:terminate', function(e) {
   var dialog = e.target ;
    var session = e.session ;

    debug('dialog was terminated, session: ', session) ;
}) ;



