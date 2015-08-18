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

function gen_response(status, message) {
    return JSON.stringify({
        status: status,
        message: message
    });
}

function visit_response(status, message, time) {
    return JSON.stringify({
        status: status,
        message: message,
        time: time
    });
}

function parseCookies(request) {
    var list = {},
        rc = request.headers.cookie;
    rc && rc.split(';').forEach(function(cookie) {
        var parts = cookie.split('=');
        list[parts.shift().trim()] = decodeURI(parts.join('='));
    });

    return list;
}

function decide_fate(mfeddie, cb) {

    var keep_alive = mfeddie.req_args.keep_alive
    var fatal_error = mfeddie.fatal_error;
    var pid = mfeddie.ph.process.pid;

    var redirect = mfeddie.redirect;
    var del_cb = function(err, ok) {
        if (err) {
            return cb(err, false);
        } else return cb(false, true);
    }
    if (!keep_alive || fatal_error) {
        if (fatal_error) mf_log.log('A fatal error occurred: ' + fatal_error + '.  Killing phantom process ' + pid);
        if (!keep_alive && !fatal_error) mf_log.log('mf_keep_alive = 0, killing phantom process ' + pid);
        return mf_instances.delete_instance(pid, cb);
    }
    mf_instances.update_timeout(pid, function() {
        return cb(true, false);
    });
}

function delete_pid_cookie() {
    return [
        ['Set-Cookie', 'pid=deleted; path=/mfeddie; expires=Thu, 01 Jan 1970 00:00:00 GMT'],
        ['Connection', 'close']
    ];
}

function validate_type(param_name, param_val, cb) {
    var type_reqs = config.get('param_type_reqs');
    var expected = type_reqs[param_name];
    var casted;
    var err_prefix = param_name + ' expects type ' + expected + '; ';
    var err = false;
    switch (expected) {
        case 'string':
            if (typeof param_val !== expected) {
                err = err_prefix + "type received: " + typeof param_val;
            }
            casted = param_val + '';
            break;
        case 'int':
            if (isNaN(param_val)) {
                err = err_prefix + param_val + ' is not a number';
            } else if (param_val != parseInt(param_val, 10)) {
                err = err_prefix + param_val + ' is not an integer';
            } else {
                casted = parseInt(param_val);
            }
            break;
        case 'json':
            try {
                casted = JSON.parse(param_val);
            } catch (parse_err) {
                err = err_prefix + 'a problem ocurred while parsing ';
                err = err + param_value + ': ' + parse_err;
            }
            break;
    }

    return cb(err, casted);

}

function validate_actions_and_parameters(request_args, cb) {
    var valid_actions = config.get('actions');
    var action = request_args.action;
    // 1. Check that the provided action is a valid action
    if (typeof action === 'undefined') return cb("No action defined.  Set mf_action parameter or header.");

    var valid_action = false;
    for (var i in valid_actions) {
        if (valid_actions[i] === action) {
            valid_action = true;
            break;
        }
    }
    if (!valid_action) {
        return cb("Invalid action: '" + action + "'");

    }
    var validated = {
        "action": action,
    };
    // 2. Check that all required arguments are present.
    var action_required = config.get('action_required');
    var required_params = action_required[validated.action];
    for (var i in required_params) {
        var param_name = required_params[i];
        var param_val = request_args[param_name];
        if (typeof param_val === 'undefined') {
            return cb("Missing required param '" + param_name + "' for action '" + action);
        } else {
            validated[param_name] = param_val;
        }
    }
    // 3. Add in optional params
    var action_optional_defaults = config.get('action_optional_defaults');
    var optional_defaults = action_optional_defaults[validated.action];
    for (var param_name in optional_defaults) {
        var param_val = request_args[param_name];
        if (typeof param_val !== 'undefined') {
            validated[param_name] = param_val;
        } else {
            validated[param_name] = optional_defaults[param_name];
        }
    }

    //4. Cast all parameters to the correct type e.g. (int, string, json object) and catch any type mismatches.
    var error = false;
    for (var param_name in validated) {
        var param_value = validated[param_name];
        validate_type(param_name, param_value, function(t_err, valid_param) {
            error = t_err;
            validated[param_name] = valid_param;
        });
        if (error) break;
    }

    return cb(error, validated);
}

// http server sends arguments here and determines what to do with them.
function parse_query_args(args, cb) {
    var validated_args;
    var mfeddie;
    var action_callback = function(err, warn, ok) {
        if (mfeddie.eventEmitter) {
            mfeddie.eventEmitter.removeAllListeners();
        }
        return decide_fate(mfeddie, function(alive, dead) {
            var status_code, content_type, content, status, message, cookie, warnings;
            if (alive) cookie = mfeddie.cookie();
            if (dead) cookie = delete_pid_cookie();
            status_code = mfeddie.status_code;
            var mf_content_type = mfeddie.mf_content_type || false;
            var page_content_type = mfeddie.page_content_type || 'text/html';
            content_type = mf_content_type || page_content_type;
            warnings = mfeddie.warnings;

            if (mf_content_type == 'application/json') {
                if (err) {
                    status = 'Error';
                    message = err;
                }
                if (warn) {
                    status = 'Warning';
                    message = warn;
                }
                if (ok) {
                    status = 'OK';
                    message = ok;
                }

                content = {
                    status: status,
                    message: message
                };
                if (warnings.length > 0 && !mfeddie.settings.suppress_warn) content['warnings'] = warnings;
                content = JSON.stringify(content);
            } else {
                content = ok;
            }

            return cb(content, content_type, cookie, status_code);
        });

    };
    var instance_callback = function(err, mf) {
        mfeddie = mf;
        if (err) {
            err = JSON.stringify({
                status: 'Error',
                message: err
            });
            return cb(err, 'application/json', delete_pid_cookie(), 400);
        }
        mfeddie.fatal_error = false;
        mfeddie.warnings = new Array();

        var fn = validated_args.action;
        mfeddie.eventEmitter.on('fatal_error', function() {
            mfeddie.mf_status_code = mfeddie.mf_status_code || 500;
            mfeddie.mf_content_type = 'application/json';
            mfeddie.fatal_error = mfeddie.fatal_error || 'Unknown error occurred during ' + fn;
            return action_callback(mfeddie.fatal_error);
        });
        mfeddie[fn](validated_args, action_callback);
    };

    var validate_cb = function(v_err, v_args) {
        validated_args = v_args;

        if (v_err) {
            v_err = JSON.stringify({
                status: 'Error',
                message: v_err
            });
            return cb(v_err, 'application/json', null, 500);
        }
        var process_id = validated_args.pid;
        var action = validated_args.action;
        if (!process_id && action == 'visit') return new MF_Eddie(validated_args, instance_callback, mf_instances);
        else if (!process_id && action != 'visit') {
            var err = JSON.stringify({
                status: 'Error',
                message: "Invalid Phantom process id"
            });
            return cb(err, 'application/json', delete_pid_cookie(), 500);
        } else return mf_instances.get_instance(process_id, instance_callback);
    }
    validate_actions_and_parameters(args, validate_cb);
}

function isEmpty(obj) {
    for (var prop in obj) {
        if (obj.hasOwnProperty(prop)) return false;
    }
    return true;
}

// takes an array of headers or query params and refactors the headless browser options
function get_args(data) {
    var args = {};
    var mf_regex = new RegExp(/^mf(\-|_)/i);
    var hyphen_re = new RegExp(/\-/g);
    for (var d in data) {
        if (mf_regex.test(d)) {
            var key = d.replace(mf_regex, '');
            key = key.replace(hyphen_re, '_');
            key = key.toLowerCase();
            args[key] = data[d];
        }
    }

    return args;
}
// Determines the MF_Eddie instace's PhantomJS process id through the cookie sent by the client
function extract_pid(cookies) {
    var pid_re = new RegExp(/^pid=/i);
    var pid = false;
    for (var i in cookies) {
        var c = cookies[i];
        if (c[0] == 'Set-Cookie' && pid_re.test(c[1])) {
            pid = c[1].replace(pid_re, '');
            break;
        }
    }
    return pid;
}

function get_date() {
    return '[' + new Date().toISOString() + ']';
}

var last_resp = (new Date).getTime() / 1000;

// Creates the HTTP server which will act as a proxy.
var server = http.createServer(function(req, res) {
    var req_args = {};
    var req_data = url.parse(req.url, true);
    // Web API mode: Checks to see if we are getting our browser options/commands from query parameters
    if (!isEmpty(req_data.query) && req_data.query.mf_action) {
        req_args = get_args(req_data.query);

    }
    // Proxy mode: Checks to see if we are getting our browser options/commands from request headers.
    else if (!isEmpty(req.headers) && req.headers['mf-action']) {
        req_args = get_args(req.headers);
    }
    req_args['url'] = req_args.url || req.url;

    if ((req_args.action == 'click' || req_args.action == 'back') && typeof req_args.keep_alive == 'undefined') {
        req_args['keep_alive'] = 1;
    }

    var req_cookies = parseCookies(req);
    mf_log.log("-------------------------------------------------");
    mf_log.log("Request parameters:");
    for (var key in req_args) {
        mf_log.log('\t' + key + ": " + req_args[key]);
    }
    mf_log.log("-------------------------------------------------");

    // This function will be called back from this.parse_query_args()
    var response_callback = function(data, content_type, cookies, status_code) {
        if (!status_code) status_code = 200;
        if (status_code >= 300 && status_code < 400) {
            mf_log.log("mfeddie attempted to respond with redirect code: " + status_code);
            status_code = 200;
        }
        if (status_code != 200 || status_code != '200') {
            mf_log.log("mfeddie responded with non-200 status:");
            mf_log.log("\tStatus Code: " + status_code);
            mf_log.log('\tContent-Type: ' + content_type);

        }
        var headers = [
            ['Content-Type', content_type]
        ];
        if (cookies) {
            for (var i = 0; i < cookies.length; i++) {
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
