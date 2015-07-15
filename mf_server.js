/*
 * mf_server.js - Main point of execution.
 * Handles http requests from crawlers.
 * Initializes MF_Eddie instances and controls actions of the browser
 * Rate limits requests
*/
'use strict';
var http = require('http');
var url = require('url');
var config = require('config');
var mf_log = require('./mf_log');
var response_data;
var MF_Eddie = require('./mf_eddie');
var MF_Instances = require('./mf_instances');
var mf_instances = new MF_Instances();

var json = 'application/json';
var MAX_INSTANCES = config.get('max_instances') || 8;
mf_log.log('max instances: ' + MAX_INSTANCES);
mf_log.log(config.get('port'));

function gen_response (status, message) {
    return JSON.stringify({status: status, message: message});
}
function visit_response (status, message, time) {
    return JSON.stringify({status: status, message: message, time: time});
}

function parseCookies (request) {
    var list = {},
        rc = request.headers.cookie;
    rc && rc.split(';').forEach(function( cookie ) {
        var parts = cookie.split('=');
        list[parts.shift().trim()] = decodeURI(parts.join('='));
    });

    return list;
}

function decide_fate(keep_alive, pid) {
    if(!keep_alive) {
        mf_log.log('keep_alive = 0, deleting instance');
       return mf_instances.delete_instance(pid, function(msg) {
            return msg;
        });
    }
    else
        return false;
}

// http server sends arguments here and determines what to do with them.
function parse_query_args(args, cb, pid) {

    if(pid) mf_instances.update_timeout(pid)
    else args['keep_alive'] = parseInt(args.keep_alive) || false;

    args['timeout'] = parseInt(args.timeout) || false;
    args['load_external'] = parseInt(args.load_external) || false;
    args['load_media'] = parseInt(args.load_media) || false;
    args['get_content'] = parseInt(args.get_content) || false;

    if (typeof args.return_on_timeout === 'undefined') args['return_on_timeout'] = true
    else args['return_on_timeout'] = parseInt(args.return_on_timeout);
    
    if (typeof args.require_proxy === 'undefined') args['require_proxy'] = true
    else args['require_proxy'] = parseInt(args.require_proxy);

    var allowed = [];
    var disallowed = [];
    if(args.allowed) allowed = JSON.parse(args.allowed);
    if(args.disallowed) disallowed = JSON.parse(args.disallowed);
    args['allowed'] = allowed;
    args['disallowed'] = disallowed;
    
    if(args.action == 'test_jquery') {
		var m = mf_instances.get_instance(pid);
		m.test_jquery();
	}

    if(args.action == 'visit') {
        var set_cookies = false;
        // Respond with 503 if there are too many browsers open to take on any additional work.
        if((mf_instances.get_instance_count() >= MAX_INSTANCES) && !pid) {
            mf_log.log("Bad status reason: OVER MAX INSTANCES");
            return cb('503 - Service Unavailable', 'text/html', null, 503);
        }

        // A squid proxy, user agent, and url are required for a page visit.
        if(((!args.proxy && args.require_proxy) || !args.user_agent || !args.url) && !pid) {
            mf_log.log("Bad status reason: MISSING REQUIRED PARAMS");
            return cb(gen_response('Error', 'Missing required params'), json, null, 503);
        }
        //Visit callback function
        var vcb = function(v_err, v_warn, ok) {
                if(v_err) {
                    mf_log.log("Error on visit: " + v_err);
                    var del_cb = function() {cb(gen_response('Error', v_err), json, null, mf_eddie.status_code);};
                    return mf_instances.delete_instance(mf_eddie.ph.process.pid, del_cb);
                }
                if(v_warn && !args.get_content) {
                    return cb(gen_response('OK', v_warn), json, set_cookies, null, mf_eddie.status_code);
                }
                return (args.get_content) ? cb(ok, mf_eddie.page_content_type, set_cookies, mf_eddie.status_code) : cb(visit_response('OK', 'Visited page', mf_eddie.load_time), json, set_cookies, mf_eddie.status_code);
        };
        // Instance creation callback.
        var mfcb = function(err) {
            if(err) return cb(gen_response('Error', err), json);
            set_cookies = mf_instances.push_instance(mf_eddie);
            return mf_eddie.visit(args.url, vcb, args.get_content);
        };
        // browser instance
        var mf_eddie;
        // if there is already phantom process
        if(pid) {
            mf_eddie = mf_instances.get_instance(pid);
            if(mf_eddie) {
                return mf_eddie.visit(args.url, vcb, args.get_content);
            }
            else {
                mf_log.log("Bad status reason: UNABLE TO RETRIEVE INSTANCE WITH PID " + pid);
                return cb(gen_response('Error', "Unable to retrieve instance with pid " + pid + ' - process may have timed out.'), json, null, 503);
            }
        }
        // otherwise, make a new browser instance.
        else mf_eddie = new MF_Eddie(args, mfcb);
    }
    
    else if (args.action == 'enter_text') {
		var ft = args.force_text || false;
        if(!pid || !args.selector || !args.text) {
            mf_log.log("Bad status reason: MISSING REQUIRED PARAMS ON ENTER_TEXT");
            return cb(gen_response('Error', 'Missing required params.'), json, null, 503);
        }
        var m = mf_instances.get_instance(pid);
        if(!m) {
            return cb(gen_response('Error', 'No phantom instance found with pid ' + pid + ' - request may have timed out.'), json, null, 503);
        }
        // click callback function
        var etcb = function(err, warn, ok) {
            if(err) return cb(gen_response('Error', err), json);
            else if(warn) return cb(gen_response('Warning', warn), json);
            else if(ok) return cb(gen_response('OK', ok), json);
        };

        var text_args = {
            selector: args.selector,
            callback: etcb,
            force_text: ft,
            text: args.text,
            timeout: args.timeout
        };
        // Call click function of browser
        m.enter_text(text_args);
    }
    // Will return content, not necessarily HTML code (e.g. JSON data may be returned)
    else if (args.action == 'get_html') {
        if(!pid) return cb(gen_response('Error', 'Missing phantom pid'), json);
        var m = mf_instances.get_instance(pid);
        if(!m) {
            mf_log.log("Bad status reason: NO PHANTOM INSTANCE FOUND WITH PID " + pid + " - MAY HAVE TIMED OUT");
            return cb(gen_response('Error', 'No phantom instance found with pid ' + pid + ' - request may have timed out.'), json, null, 503);
        }
        var gcb = function(err, html) {
            if(err) return cb(gen_response("Error", err), json);
            return cb(html, m.page_content_type, null, m.status_code);
        };
        return m.get_content(args.timeout, gcb);
		
	}

    else if (args.action == 'click') {
        var fc = args.force_click || false;
        var fst = args.force_selector_type || false;
        if(!pid || !args.selector) {
            mf_log.log("Bad status reason: MISSING REQUIRED PARAMS ON CLICK");
            return cb(gen_response('Error', 'Missing required params.'), json, null, 503);
        }
        var m = mf_instances.get_instance(pid);
        if(!m) {
            return cb(gen_response('Error', 'No phantom instance found with pid ' + pid + ' - request may have timed out.'), json, null, 503);
        }
        // click callback function
        var ccb = function(err, warn, ok) {
            if(err) return cb(gen_response('Error', err), json);
            else if(warn) return cb(gen_response('Warning', warn), json);
            else if(ok) return cb(gen_response('OK', ok), json);
        };

        var click_args = {
            selector: args.selector,
            callback: ccb,
            force_click: fc,
            force_selector_type: fst,
            timeout: args.timeout
        };
        // Call click function of browser
        m.click(click_args);
    }
    // Will return content, not necessarily HTML code (e.g. JSON data may be returned)
    else if (args.action == 'get_html') {
        if(!pid) return cb(gen_response('Error', 'Missing phantom pid'), json);
        var m = mf_instances.get_instance(pid);
        if(!m) {
            mf_log.log("Bad status reason: NO PHANTOM INSTANCE FOUND WITH PID " + pid + " - MAY HAVE TIMED OUT");
            return cb(gen_response('Error', 'No phantom instance found with pid ' + pid + ' - request may have timed out.'), json, null, 503);
        }
        var gcb = function(err, html) {
            if(err) return cb(gen_response("Error", err), json);
            return cb(html, m.page_content_type, null, m.status_code);
        };
        return m.get_content(args.timeout, gcb);
    }

    else if (args.action == 'back') {
        if(!pid) return cb(gen_response('Error', 'Missing pid'), json);
        var m = mf_instances.get_instance(pid);
        if(!m) {
            mf_log.log("Bad status reason: NO PHANTOM INSTANCE FOUND WITH PID " + pid + " - MAY HAVE TIMED OUT");
            return cb(gen_response('Error', 'No phantom instance found with pid ' + pid + ' - request may have timed out.'), json, null, 503);
        }
        var bcb = function(err, msg) {
            if(err) return cb(gen_response('Error', err), json);
            return cb(gen_response('OK', msg), json);
        }
        return m.back(bcb);

    }
    // closes the browser and deletes the instance
    else if (args.action == 'kill') {
        if(!pid) return cb(gen_response('Error', 'Missing pid', json));
        if(args.keep_alive && args.keep_alive) return cb(gen_response("Error", "Ambiguous action.  Action is kill but keep_alive option is set to true"), json, null, 503);
        // The killing of the process will take place in the response_callback method.
        return cb(gen_response('OK', 'Killed browser with pid ' + pid), json);

    }

    else {
        mf_log.log("Bad status reason: INVALID ACTION");
        return cb(gen_response('Error',"Invalid action: " + args.action), json, null, 503);
    }

}

function isEmpty(obj) {
    for(var prop in obj) {
        if(obj.hasOwnProperty(prop)) return false;
    }
    return true;
}

// takes an array of headers or query params and refactors the headless browser options
function get_args(data) {
    var args = {};
    var mf_regex = new RegExp(/^mf(\-|_)/i);
    var hyphen_re = new RegExp(/\-/g);
    for(var d in data) {
        if(mf_regex.test(d)) {
            var key = d.replace(mf_regex, '');
            key = key.replace(hyphen_re, '_');
            key = key.toLowerCase();
            args[key] = data[d];
        }
    }

    return args;
}
// Determines the MF_Eddie instace's PhantomJS process id through the cookie sent by the client
function extract_pid (cookies) {
    var pid_re = new RegExp(/^pid=/i);
    var pid = false;
    for (var i in cookies) {
        var c = cookies[i];
        if(c[0] == 'Set-Cookie' && pid_re.test(c[1])) {
            pid = c[1].replace(pid_re, '');
            break;
        }
    }
    return pid;
}

function get_date() {
    return '[' + new Date().toISOString() + ']';
}

// Creates the HTTP server which will act as a proxy.
var server = http.createServer(function(req, res) {
    var req_args = {};
    var req_data = url.parse(req.url, true);
    // Web API mode: Checks to see if we are getting our browser options/commands from query parameters
    if(!isEmpty(req_data.query) && req_data.query.mf_action) {
        req_args = get_args(req_data.query);

    }
    // Proxy mode: Checks to see if we are getting our browser options/commands from request headers.
    else if(!isEmpty(req.headers) && req.headers['mf-action']) {
        req_args = get_args(req.headers);
        req_args['url'] = req.url;
    }

    if((req_args.action == 'click' || req_args.action == 'back') && typeof req_args.keep_alive == 'undefined') {
        req_args['keep_alive'] = 1;
    }

    var req_cookies = parseCookies(req);
    mf_log.log("-------------------------------------------------");
    mf_log.log("Request parameters:");
    for (var key in req_args) {
        mf_log.log(key + ": " + req_args[key]);
    }
    mf_log.log("-------------------------------------------------");

    // This function will be called back from this.parse_query_args()
    var response_callback = function (data, content_type, cookies, code) {
        var status_code = code || 200;
        if(status_code != 200 || status_code != '200') {
            mf_log.log("mfeddie responded with bad status " + status_code + ":\n");
            //mf_log.log(data);
        }
        var pid = req_cookies.pid || extract_pid(cookies);
        if(decide_fate(req_args.keep_alive, pid)) {
            cookies = [];
            cookies.push(['Set-Cookie', 'pid=0']);
        }
        var headers = [['Content-Type', content_type]];
        if(cookies) {
            for(var i=0; i<cookies.length; i++) {
                headers.push(cookies[i]);
            }
        }

        res.writeHead(status_code, headers);
        res.end(data);
    };

    parse_query_args(req_args, response_callback, req_cookies.pid);
});
var port = config.get('port') || 8315;
server.listen(port);
