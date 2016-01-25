var express = require("express");
var xmldom = require('xmldom');
var fs = require('fs');
var parser = require('xmldom').DOMParser;
var xmlImpl = require('xmldom').DOMImplementation;
var ISY = require('isy-js')
var xmlparser = require('express-xml-bodyparser');

var basicAuth = require('basic-auth');
var restler = require('restler')



var StIsyBridge = function(config) {
    this.serverPort = config.serverPort == undefined ? 3003 : config.serverPort;
    this.isyAddress = config.isyAddress == undefined ? "10.0.1.44": config.isyAddress;
    this.isyPort = config.isyPort == undefined ? 3000 : config.isyPort;
    this.isyUserName = config.isyUserName == undefined ? "admin" : config.isyUserName;
    this.isyPassword = config.isyPassword == undefined ? "password" : config.isyPassword;
    this.debugEnabled = config.debugEnabled == undefined ? true : config.debugEnabled;
    this.logResponseContent = config.logResponseContent == undefined ? true : config.logResponseContent;
    this.extendedErrors = config.extendedErrors == undefined ? true : config.extendedErrors;
    this.app = express();
    this.app.use(xmlparser());
    this.xmlImplementation = new xmlImpl();
    this.sequenceNumber = 0;
    this.webSubscriptions = [];
    this.webSubscriptionInitialIndex = []
    this.isy = new ISY.ISY(this.isyAddress+":"+this.isyPort, this.isyUserName, this.isyPassword, true, this.handleChanged.bind(this), false, false, this.debugEnabled);
    this.isy.initialize(this.handleIsyInitialized.bind(this));
}

StIsyBridge.prototype.log = function(msg) {
    if(this.debugEnabled) {
        console.log(msg)
    }
}

StIsyBridge.prototype.getNextSequenceNumber = function() {
    this.sequenceNumber++;
    return this.sequenceNumber;
}

StIsyBridge.prototype.buildCommandResponse = function(res, resultSuccess, resultCode, extended) {
    this.setupResponseHeaders(res, resultCode);
    var resultString =
        '<?xml version="1.0" encoding="UTF-8"?>\r\n'+
        '<RestResponse succeeded="'+resultSuccess+   '">\r\n'+
        '    <status>'+resultCode+'</status>\r\n';
    if(this.extendedErrors && extended != undefined && extended != null) {
        resultString += '    <extended>'+extended+'</extended>\r\n';
    }
    resultString += '</RestResponse>\r\n';
    if(this.logResponseContent) {
        this.log('Response Body: '+resultString);
    }
    res.send(resultString);
}

StIsyBridge.prototype.handleIsyInitialized = function() {
    this.log("Isy Initialized")
    this.start()
}

StIsyBridge.prototype.logRequestStartDetails = function(req) {
    this.log("REQUEST. Source="+req.ip+" Url: "+req.originalUrl);
}

StIsyBridge.prototype.logRequestEndDetails = function(res) {
    this.log("RESULT: Code="+res.statusCode);
}

StIsyBridge.prototype.buildSubscribeResponse = function(res, subscriptionId) {
    this.setupSubscribeResponseHeaders(res, 200);
    var response = '<?xml version="1.0" encoding="UTF-8"?><s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"><s:Body><SubscriptionResponse><SID>uuid:'
    response += subscriptionId
    response += '</SID><duration>0</duration></SubscriptionResponse></s:Body></s:Envelope>'
    if(this.logResponseContent) {
        this.log('Response Body: '+response);
    }
    res.send(response)
}

StIsyBridge.prototype.buildDeviceUpdate = function(device) {
    var updateData = '<?xml version="1.0"?><Event seqnum="';
    updateData += this.getNextSequenceNumber();
    updateData += '" side="uuid:47"><control>ST</control><action>';
    updateData += device.currentState;
    updateData += '</action><node>';
    updateData += device.address;
    updateData += '</node><eventInfo></eventInfo></Event>';
    return updateData;
}

StIsyBridge.prototype.sendNextWebSubscribeUpdate = function(url,currentIndex) {
    var deviceList = this.isy.getDeviceList();
    this.log('Sending update...'+currentIndex);
    if(currentIndex >= deviceList.length) {
        this.log('Done!');
    } else {
        this.sendDeviceUpdateWeb(url, currentIndex, this.sendNextWebSubscribeUpdate.bind(this));
    }
}

StIsyBridge.prototype.handleAddWebSubscription = function(req,res) {
    this.logRequestStartDetails(req)
    var webSubscriptionNumber = this.webSubscriptions.length

    var envelopeElement = req.body['s:envelope']
    if(envelopeElement == null) {
        this.buildCommandResponse(res, false, 500, 'Malformed envelope element in request, rejected')
    } else {
        var bodyElement = envelopeElement['s:body']
        if(bodyElement == null) {
            this.buildCommandResponse(res, false, 500, 'Malformed envelope body element, rejected')
        } else {
            var subscribeElement = bodyElement[0]['u:subscribe']
            if(subscribeElement == null) {
                this.buildCommandResponse(res, false, 500, 'Missing subscribe element, rejected')
            } else {
                var subscribeUrl = subscribeElement[0].reporturl[0]
                if(subscribeUrl.indexOf('http')==-1) {
                    this.buildCommandResponse(res, false, 500, 'Invalid target url')
                } else {
                    this.webSubscriptions[webSubscriptionNumber] = subscribeUrl;
                    this.webSubscriptionInitialIndex[webSubscriptionNumber] = 0;
                    this.buildSubscribeResponse(res, webSubscriptionNumber);
                    //this.sendInitialWebState(subscribeUrl);
                }
            }
        }
    }
    this.logRequestEndDetails(res)
}

StIsyBridge.prototype.sendInitialWebState = function(endpoint) {
    this.sendNextWebSubscribeUpdate(endpoint,0)
}

StIsyBridge.prototype.sendDeviceUpdateWeb = function(subscribeUrl,deviceIndex,completed) {
    var device = this.isy.getDeviceList()[deviceIndex];
    var updateData = this.buildDeviceUpdate(device);
    this.log('WEB: NOTIFICATION: Target URL: '+subscribeUrl);
    this.log('WEB: NOTIFICATION: '+updateData);
    var options = {
        data: updateData,
        headers: {
            'CONTENT-TYPE': 'text/xml'
        }
    }
    restler.post(subscribeUrl, options).on('complete', function(result,response) {
        completed(subscribeUrl,deviceIndex+1,completed);
    });
}

StIsyBridge.prototype.sendDeviceUpdateWebForDeviceObject = function(subscribeUrl, device) {
    var updateData = this.buildDeviceUpdate(device);
    this.log('WEB: NOTIFICATION: Target URL: '+subscribeUrl);
    this.log('WEB: NOTIFICATION: '+updateData);
    var options = {
        data: updateData,
        headers: {
            'CONTENT-TYPE': 'text/xml'
        }
    }
    restler.post(subscribeUrl, options).on('complete', function(result,response) {
    });
}

StIsyBridge.prototype.setupSubscribeResponseHeaders = function(res, resultCode) {
    res.set('EXT','UCoS, UPnP/1.0, UDI/1.0');
    res.set('cache-control', "max-age=3600, must-revalidate");
    res.set('WWW-Authenticate','Basic realm="/"');
    res.set('Last-Modified', new Date());
    res.set('Connection','Keep-Alive');
    res.set('Content-Type', 'application/soap+xml; charset=UTF-8');

    res.status(resultCode);

}

StIsyBridge.prototype.setupResponseHeaders = function(res, resultCode) {
    res.set('EXT','UCoS, UPnP/1.0, UDI/1.0');
    res.set('Cache-Control', 'no-cache');
    res.set('WWW-Authenticate','Basic realm="/"');
    res.set('Last-Modified', new Date());
    res.set('Connection','Keep-Alive');
    res.set('Content-Type', 'text/xml; charset=UTF-8');

    res.status(resultCode);
}


StIsyBridge.prototype.handleChanged = function(isy,device) {
    var subscriptionsCopy = []
    for(var copyIndex = 0; copyIndex < this.webSubscriptions.length; copyIndex++) {
        subscriptionsCopy[copyIndex] = this.webSubscriptions[copyIndex]
    }
    for(var subscriptionIndex = 0; subscriptionIndex < subscriptionsCopy.length; subscriptionIndex++) {
        this.sendDeviceUpdateWebForDeviceObject(subscriptionsCopy[subscriptionIndex], device);
    }
}

StIsyBridge.prototype.buildUnauthorizedResponse = function(res) {
    res.set('WWW-Authenticate', 'Basic realm=Authorization Required');
    res.sendStatus(401);
}

StIsyBridge.prototype.authHandler = function (req, res, next) {
    var user = basicAuth(req);

    if (!user || !user.name || !user.pass) {
        this.buildUnauthorizedResponse(res);
        this.log('ERROR: Denied request, credentials not specified');
        return res;
    }

    if (user.name === "admin" && user.pass === "password") {
        return next();
    } else {
        this.buildUnauthorizedResponse(res);
        this.log('ERROR: Denied request, credentials not specified');
        return res;
    }
}

StIsyBridge.prototype.configureRoutes = function() {
    var that = this;

    this.app.post('/services', this.authHandler.bind(this), function (req, res) {
        that.handleAddWebSubscription(req,res)
    });
}

StIsyBridge.prototype.start = function()
{
    this.configureRoutes()
    var server = this.app.listen(this.serverPort, function () {
        var host = server.address().address;
        var port = server.address().port;

        console.log('fst-isy-notify-bridge app listening at http://%s:%s', host, port);
    });
}

var config = {
    isyAddress: "10.0.1.19",
    isyPort: 80,
    isyUserName: "admin",
    isyPassword: "password"
}

bridge = new StIsyBridge(config)