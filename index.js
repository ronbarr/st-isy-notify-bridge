/**
 * Created by rodtoll on 1/29/16.
 *
 * Reflector.
 *
 * This class starts a server which sits in front of an ISY and proxies requests to subscribe to notifications.
 * It receives the subscription request and forwards it to the ISY, rewriting the responseurl to match the
 * url of this server. It then passes on any incoming notification requests to the server that did the
 * subscribe based on the URL specified in the subscribe request.
 *
 * This is only neccessary because natively the ISY sends POST messages for notifications which do not specify
 * a space between the content-type header's colon ':' and the value. Once SmartThings fixes this bug this will
 * no longer be needed.
 *
 * Set the isyAddress and isyPort to the address and port of your ISY server.
 * Set the localAddress value to your local IP address on the LAN that this server runs on.
 */

var express = require("express");
var xmlparser = require('express-xml-bodyparser');
var basicAuth = require('basic-auth');
var restler = require('restler');
var net = require('net');
var url = require('url');

var ReflectorServer = function(config) {
    this.serverPort = config.serverPort == undefined ? 3003 : config.serverPort;
    this.localAddress = config.localAddress == undefined ? "10.0.1.44" : config.localAddress;
    this.targetUrl = "http://10.0.1.4:39500/";
    this.isyAddress = config.isyAddress == undefined ? "10.0.1.44": config.isyAddress;
    this.isyPort = config.isyPort == undefined ? 3000 : config.isyPort;
    this.app = express();
    this.app.use(xmlparser());
    this.messagesToSend = [];
}

ReflectorServer.prototype.log = function(msg) {ß
    if(this.debugEnabled) {
        console.log(msg)
    }
}

ReflectorServer.prototype.getIsyUrl = function(path) {
    return "http://"+this.isyAddress+":"+this.isyPort+"/"+path;
}

ReflectorServer.prototype.sendNextMessage = function() {
    if(this.messagesToSend.length == 0) {
        console.log("No messages to send");
        return;
    }
    var that = this;
    var parsedUrl = url.parse(this.targetUrl);
    var address = parsedUrl.hostname;
    var port = Number(parsedUrl.port);
    var msgToSend = this.messagesToSend[0];
    var client = new net.Socket();
//    console.log("Sending notification to: "+address+":"+port);
    client.connect(port, address, function() {
        try {
            if(msgToSend.indexOf("<control>ST</control>")!= -1) {
                console.log('Sending...' + msgToSend);
            }
            client.write(msgToSend);
            client.destroy();
            that.messagesToSend.splice(0,1);
        } catch(Error) {
            console.log('Error sending...' + Error);
            console.log('Trying again...');
        }
        that.sendNextMessage();
    });
}

ReflectorServer.prototype.handleNotification = function(req,res) {
    /*var options = {
        data: req.rawBody,
        headers: {
            'CONTENT-TYPE': 'text/xml'

        }
    }*/
    console.log('Queuing incoming notification to '+this.targetUrl+' queue now has '+this.messagesToSend.length+' items in it now');
    if(this.targetUrl != null) {
        var msg=""+
            "POST / HTTP/1.1\r\n"+
            "Accept: */*\r\n"+
            "User-Agent: Restler for Node.js\r\n"+
            "Host: "+this.targetUrl+"\r\n"+
            "Accept-Encoding: gzip, deflate\r\n"+
            "CONTENT-TYPE: text/xml\r\n"+
            "Content-Length: "+req.header('Content-Length')+
            "\r\n"+
            "Connection: keep-alive\r\n\r\n"+
            req.rawBody;
        this.messagesToSend.push(msg);
//        console.log("Queue now has: "+this.messagesToSend.length+" items");
        if(this.messagesToSend.length == 1) {
            this.sendNextMessage();
        }
        res.sendStatus(200).end();
    } else {
        console.log('Not forwarding as no target Url set yet');
    }
}

ReflectorServer.prototype.handleAddWebSubscription = function(req,res) {
    this.targetUrl = req.body['s:envelope']['s:body'][0]['u:subscribe'][0]['reporturl'][0];
    var newNotifyUrl = "http://"+this.localAddress+":"+this.server.address().port+"/notify";
    console.log('Rewriting incoming subscription from: ['+this.targetUrl+'] to ['+newNotifyUrl+']');
    var requestBody = req.rawBody;
    requestBody = requestBody.replace(this.targetUrl,newNotifyUrl);
    var user = basicAuth(req)
    var responseSource = res

    var options = {
        data: requestBody,
        username: user.name,
        password: user.pass,
        headers: {
            'CONTENT-TYPE': 'text/xml'
        }
    }
    console.log('Sending subscribe to: '+this.getIsyUrl('services'));
    restler.post(this.getIsyUrl('services'), options).on('complete', function(result,response) {
        console.log('Got response from services...'+result);
        responseSource.sendStatus(responseSource.statusCode).end();
    });
}


ReflectorServer.prototype.configureRoutes = function() {
    var that = this;

    this.app.post('/services', function (req, res) {
        that.handleAddWebSubscription(req,res);
    });

    this.app.post('/notify', function(req,res) {
        that.handleNotification(req,res);
    });
}

ReflectorServer.prototype.start = function()
{
    var that = this;
    this.configureRoutes()
    this.server = this.app.listen(this.serverPort, function () {
        var host = that.server.address().address;
        var port = that.server.address().port;

        console.log('reflector app listening at http://%s:%s', host, port);
    });
}

var config = {
    isyAddress: "10.0.1.19",        // Address of the ISY we are reflecting
    isyPort: 80,                    // Port of the ISY we are reflecting
    serverPort: 3003,               // Port this server should run on
    localAddress: "10.0.1.49"       // Local address of this machine
}

bridge = new ReflectorServer(config);
bridge.start();
