/*
 * mf_eddie.js - Headless browser class.
 * Browser objects will be made from this class.
 * Provides the basic functions (visit, click, get_html) of the browser.
 *
 */
'use strict';
var config = require('config');
var phantom = require('phantom');
var URL = require('url');
var mf_log = require('./mf_log');
var events = require('events');
var WAIT = config.get('wait') || 800;

MF_Eddie.prototype.get_phantom_pid = function() {
    var pid = this.ph.process.pid;
    return pid;
}
MF_Eddie.prototype.set_phantom = function(p, cb) {
    mf_log.log('set phantom called');
    this.ph = p;
    if (cb && typeof cb == 'function')
        return cb();
    return;
};

MF_Eddie.prototype.cache_page = function(url, content_type, cb) {
    if (typeof content_type === 'undefined' || !content_type) content_type = 'text/html';
    var cached_content = {
        url: url,
        content_type: content_type
    };
    this.history_queue.push(cached_content);
    this.history_queue_pos++;
    return cb();
}

MF_Eddie.prototype.set_page = function(err, page, cb) {
    var ok = false;
    if (page) {
        ok = true;
        this.page = page;
        var cache_cb = function() {
            if (cb && typeof cb === 'function') {
                return cb(err, ok);
            }
        }
        return this.cache_page(this.req_args.url, this.page_content_type, cache_cb);
    }
}


function MF_Eddie(args, cb, mf_instances) {
    var push_instance_cb = function(err, pid) {
        return cb(err, this);
    }.bind(this);
    var phantom_cb = function() {
        return mf_instances.push_instance(this, push_instance_cb);
    }.bind(this);

    this.warnings = [];
    this.history_queue = [];
    this.history_queue_pos = -1;
    this.mf_content_type = false;
    this.fatal_error = false;
    this.eventEmitter = new events.EventEmitter();

    var permanent_args = config.get('permanent_args');

    this.settings = {};
    for (var i in permanent_args) {
        var arg_name = permanent_args[i];
        this.settings[arg_name] = args[arg_name];
        delete args[arg_name];
    }

    var parameters_arg = (this.settings.require_proxy !== 'undefined') ? {
        paramaters: {
            proxy: this.settings.proxy
        }
    } : false;
    if (this.settings.require_proxy) {
        return phantom.create({
            parameters: {
                proxy: this.settings.proxy
            }
        }, function(ph) {
            return this.set_phantom(ph, phantom_cb);
        }.bind(this));
    } else {
        return phantom.create(function(ph) {
            return this.set_phantom(ph, phantom_cb);
        }.bind(this));
    }
};

function base_url(url) {
    return url.match(/^https?:\/\/[^\/]+/i);
}

MF_Eddie.prototype.set_args = function(args, cb) {
    this.req_args = {};

    for (var a in args) {
        this.req_args[a] = args[a];
    }
    cb();
}

MF_Eddie.prototype.cookie = function() {
    var pid = this.ph.process.pid;
    return [
        ['Set-Cookie', 'pid=' + pid + '; path=/mfeddie']
    ];
}

// Will load a page in browser.
MF_Eddie.prototype.visit = function(args, cb) {
    this.current_action = 'visit';
    this.set_args(args, function() {

        var set_page_cb = function(err, ok) {
            if (this.responded) return;
            if (err) return cb(err);

            if (ok) {
                ok = 'Successfully visited page.';
            }

            if (this.req_args.get_content && !err) {
                var get_content_cb = function(err, warn, content) {
                    if (err || warn) {
                        this.fatal_error = err || warn;
                        this.eventEmitter.emit('fatal_error');
                        return;
                    }
                    this.page_content_type = this.page_content_type || 'text/html';
                    this.mf_content_type = false;
                    this.responded = true;
                    return cb(false, false, content);
                }.bind(this);
                return this.get_content(false, get_content_cb);
            } else {
                this.mf_content_type = 'application/json';
                this.responded = true;
                return cb(err, false, ok);
            }
        }.bind(this);


        this.ph.createPage(function(page) {

            var page_timeout_fn = function() {
                mf_log.log('Page timeout while fetching ' + this.current_url);
                if (this.settings.return_on_timeout && this.page_content_type) {
                    this.eventEmitter.removeListener('page_timeout', page_timeout_fn);
                    this.warnings.push(
                        'Page failed to fully load prior to page timeout.');
                    return this.set_page(false, page, set_page_cb);
                } else {
                    this.status_code = 504;
                    this.fatal_error = 'Gateway Timeout: The page at ' + this.current_url +
                        ' failed to load within the time specified (' + this.settings
                        .page_timeout + ' ms)';
                    this.eventEmitter.emit('fatal_error');
                    return;
                }
            }.bind(this);

            this.eventEmitter.on('page_timeout', page_timeout_fn);

            page.set('viewportSize', {
                width: 800,
                height: 800
            });
            page.set('paperSize', {
                width: 1024,
                height: 768,
                border: '0px'
            });
            page.set('settings.userAgent', this.settings.user_agent);
            page.set('settings.resourceTimeout', this.settings.resource_timeout);


            page.set('onLoadStarted', function() {
                this.load_in_progress = true;
            }.bind(this));



            page.set('onLoadFinished', function() {
                this.load_in_progress = false;
            }.bind(this));


            var hostname = URL.parse(this.req_args.url).hostname.replace('www.', '');
            var base = base_url(this.req_args.url);
            var request_filter_args = {
                base_url: base,
                hostname: hostname,
                load_external: this.settings.load_external,
                load_images: this.settings.load_images,
                load_css: this.settings.load_css,
                allowed: this.settings.allowed,
                disallowed: this.settings.disallowed
            };
            // Will determine whether or not to abort a given request
            page.onResourceRequested(
                function(requestData, request, scoped_args) {
                    // If allowed, do nothing, return.
                    for (var i in scoped_args['allowed']) {
                        if (requestData['url'].indexOf(scoped_args['allowed'][i]) > -
                            1) {
                            //console.log('allow request: ' + requestData['url'] + ' is explicitly allowed.');
                            return;
                        }
                    }
                    // If disallowed, abort request
                    for (var i in scoped_args['disallowed']) {
                        if (requestData['url'].indexOf(scoped_args['disallowed'][i]) >
                            -1) {
                            //console.log('abort request: ' + requestData['url'] + ' is explicitly disallowed.');
                            return request.abort();
                        }
                    }
                    var is_subdomain = false;
                    if (!scoped_args['load_external'] && requestData['url'].match(
                            /(?:\w+\.)+\w+/m).toString().indexOf(scoped_args[
                            'hostname']) > -1)
                        is_subdomain = true;
                    var is_external = false;
                    if (!scoped_args['load_external'] && requestData['url'].indexOf(
                            scoped_args['base_url']) != 0 && requestData['url'].indexOf(
                            '/') != 0)
                        is_external = true;
                    if (!scoped_args['load_external'] && !is_subdomain && is_external) {
                        //console.log('abort request: ' + requestData['url'] + ' is external');
                        return request.abort();
                    }
                    if (!scoped_args['load_images'] && (
                            /\.(tif|tiff|png|jpg|jpeg|gif)($|\?)/).test(requestData[
                            'url'])) {
                        //console.log('abort request: '  + requestData['url'] + ' appears to be an image file');
                        return request.abort();
                    }
                    if (!scoped_args['load_css'] && (/\.css($|\?)/).test(requestData[
                            'url'])) {
                        //console.log('abort request: '  + requestData['url'] + ' appears to be css');
                        return request.abort();
                    }
                    return;
                },
                function(requestData) {}, request_filter_args
            );
            // If a resource does not load within the timeout, abort all requests and close the browser.
            page.set('onResourceTimeout', function(request) {

                if (request.url == this.current_url || !this.page_content_type) {
                    this.status_code = 504;
                    this.fatal_error = "Resource/Gateway Timeout: " + request.url +
                        " did not load in time.";
                    this.eventEmitter.emit('fatal_error');
                    return;
                } else if (!this.settings.return_on_timeout) {
                    this.fatal_error = 'Resource Timeout: ' + request.url +
                        ' failed to load in time while fetching ' + this.current_url;
                    this.eventEmitter.emit('fatal_error');
                    return;
                } else {
                    this.warnings.push('Resource Timeout: ' + request.url +
                        ' timed out while loading page.');
                }

            }.bind(this));

            page.set('onNavigationRequested', function(url, type, willNavigate, main) {
                if (main) {
                    this.current_url = url;
                    this.page_content_type = false;
                    this.responded = false;
                    this.timedOut = false;
                    this.warnings = [];
                    setTimeout(function() {
                        this.eventEmitter.emit('page_timeout');
                        this.timedOut = true;
                    }.bind(this), this.settings.page_timeout);
                }

            }.bind(this));

            page.set('onConsoleMessage', function(msg) {
                //console.log(msg);
            });

            page.set('onResourceReceived', function(resp) {
                var resp_url = resp.url.replace(/\//g, "");
                var curr_url = this.current_url.replace(/\//g, "");

                if (!this.page_content_type && (resp_url == curr_url)) {
                    if (resp.redirectURL) {
                        this.current_url = resp.redirectURL;
                        this.page_content_type = false;
                    } else {
                        this.page_content_type = resp.contentType;
                        this.status_code = resp.status;
                    }
                }
            }.bind(this));

            page.open(this.req_args.url, function(status) {
                if (status != 'success') {
                    this.fatal_error = this.fatal_error ||
                        "Unknown error ocurred while opening page at " + this.req_args
                        .url;
                    this.status_code = this.status_code || 500;
                    this.eventEmitter.emit('fatal_error');
                    return;
                }
                mf_log.log('Page opened with status code ' + this.status_code +
                    ' and content type ' + this.page_content_type);
                return this.set_page(false, page, set_page_cb);
            }.bind(this));
        }.bind(this));
    }.bind(this));
};

// Instructs mfeddie to simply wait for specified number of millseconds.
MF_Eddie.prototype.wait = function(args, cb) {
    this.set_args(args, function() {
        return setTimeout(function() {
            this.mf_content_type = 'application/json';
            return cb(false, false, 'Waited for ' + this.req_args.timeout + ' ms');
        }.bind(this), this.req_args.timeout);
    }.bind(this));
}

// Browser back button
MF_Eddie.prototype.back = function(args, cb) {
    this.set_args(args, function() {
        if (this.history_queue_pos <= 0) {
            return cb(false, "Can't go back, there are no previously loaded pages.\n");
        }
        this.history_queue_pos--;

        this.page.goBack();
        var ret_fn = function() {
            var cached = this.history_queue[this.history_queue_pos];
            this.page_content_type = cached.content_type;
            var warn = (this.warnings.length > 0);
            var ok = (warn) ? false : "Went back to " + cached.url;
            return cb(false, warn, ok);
            return cb(false, false, "Went back to " + cached.url);
        }.bind(this);
        return setTimeout(ret_fn, this.req_args.timeout);

    }.bind(this));
}

// Browser forward button
MF_Eddie.prototype.forward = function(args, cb) {
    this.set_args(args, function() {
        var last_pos = this.history_queue.length - 1;
        if (this.history_queue_pos >= last_pos) {
            return cb(false, "Can't go forward, there are no previously loaded pages.\n");
        }
        this.history_queue_pos++;
        this.page.goForward();
        var ret_fn = function() {
            var cached = this.history_queue[this.history_queue_pos];
            this.page_content_type = cached.content_type;
            var warn = (this.warnings.length > 0);
            var ok = (warn) ? false : "Went forward to " + cached.url;
            return cb(false, warn, ok);
        }.bind(this);
        return setTimeout(ret_fn, this.req_args.timeout);

    }.bind(this));
}

// Renders an image of the page
MF_Eddie.prototype.render_page = function(args, cb) {
    this.set_args(args, function() {
        this.page.render(this.req_args.dl_file_loc);
        var ret_cb = function() {
            this.mf_content_type = 'application/json';
            this.mf_status_code = 200;
            return cb(false, false, "OK, renderd page to " + this.req_args.dl_file_loc);
        }.bind(this);
        return setTimeout(ret_cb, this.req_args.timeout);

    }.bind(this));
}

MF_Eddie.prototype.click = function(args, cb) {
    this.set_args(args, function() {
        return this.get_element(function(err, warn, ok) {
            this.mf_content_type = 'application/json';
            return setTimeout(function() {
                return cb(err, warn, ok);
            }, this.req_args.timeout);
        }.bind(this));
    }.bind(this));
};

MF_Eddie.prototype.download_image = function(args, cb) {
    this.set_args(args, function() {
        this.get_element(function(err, warn, clipRect) {
            if (err || warn) return cb(err, warn);

            this.page.set('clipRect', clipRect);
            this.page.render(this.req_args['dl_file_loc']);
            return setTimeout(function() {
                this.mf_content_type = 'application/json';
                var success = 'Downloaded image to ' + this.req_args[
                    'dl_file_loc'];
                return cb(false, false, success);
            }.bind(this), this.req_args.timeout);
        }.bind(this));
    }.bind(this));
};

function keypress_event_args(string) {
    var args = [];
    var key_map = config.get('key_map');
    var string_arr = string.split('');
    for (var i = 0; i < string_arr.length; i++) {
        var char = string_arr[i];
        if (char == '\\' && string_arr[i + 1] == 'n') {
            char = key_map['Return'];
            i++;
        }



        var arg = ['keypress', char, null, null];
        args.push(arg);
    }
    return args;
}

function get_random_time(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}



MF_Eddie.prototype.enter_text = function(args, cb) {
    this.set_args(args, function() {
        this.get_element(function(err, warn, sel_type) {
            if (err || warn) return cb(err, warn);

            var send_events = function(args, pos, min, max) {
                if (pos < event_args.length) {
                    var random = get_random_time(min, max);
                    return setTimeout(function() {
                        this.page.sendEvent.apply(this, args[pos]);
                        return send_events(args, ++pos, min, max);
                    }.bind(this), random);
                } else {
                    var ok = 'Successfully entered ' + this.req_args['text'] +
                        ' to element ' + this.req_args['selector'];
                    return cb(false, false, ok);
                }

            }.bind(this);

            var event_args = keypress_event_args(this.req_args['text']);
            var min_time = parseInt(this.req_args.timeout * 0.5);
            var max_time = parseInt(this.req_args.timeout * 1.5);
            return send_events(event_args, 0, min_time, max_time);


            this.mf_content_type = 'application/json';
            return cb(false, false, 'ok');
        }.bind(this));


    }.bind(this));
};

MF_Eddie.prototype.follow_link = function(args, cb) {
    this.set_args(args, function() {
        return this.get_element(function(err, warn, new_link) {
            if (err || warn) return cb(err, warn);
            this.page.evaluate(evaluateWithArgs(function(link) {
                try {
                    location.href = link;
                } catch (err) {
                    return [err, false];
                }
                return [false, true];
            }, new_link), function(res) {
                this.mf_content_type = 'application/json';
                if (res[0]) return cb(res[0]);
                return setTimeout(function() {
                    return this.cache_page(new_link, this.page_content_type,
                        function() {
                            var ok = "Followed link to " + new_link +
                                '.  Page content-type is ' + this.page_content_type;
                            return cb(false, false, ok);
                        }.bind(this));
                }.bind(this), this.req_args.timeout);

            }.bind(this));

        }.bind(this));
    }.bind(this));
};

function evaluateWithArgs(fn) {
    return "function() { return (" + fn.toString() + ").apply(this, " + JSON.stringify(Array.prototype.slice.call(
        arguments, 1)) + ");}";
}

function get_selector_type(selector) {
    var re = /\//;
    return selector.match(re) ? 'xpath' : 'css';
}

MF_Eddie.prototype.get_element = function(cb) {
    var selector_type = this.req_args.force_selector_type || get_selector_type(this.req_args.selector);
    var timeout = this.req_args.timeout || WAIT;
    var req_args = this.req_args;
    var eval_args = {
        selector_type: selector_type,
        req_args: req_args
    };

    this.page.evaluate(evaluateWithArgs(function(args) {
        function eventFire(el, etype) {
            if (el.fireEvent) {
                el.fireEvent('on' + etype);
            } else {
                var evObj = document.createEvent('Events');
                evObj.initEvent(etype, true, false);
                el.dispatchEvent(evObj);
            }
        }

        function getElementByXpath(path) {
            return document.evaluate(path, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE,
                null).singleNodeValue;
        }

        function getElementByQuerySelector(sel) {
            return document.querySelector(sel);
        }

        function getImgDimensions(el) {
            var rect = el.getBoundingClientRect();

            return {
                top: rect.top,
                left: rect.left,
                width: rect.width,
                height: rect.height
            };
        }

        try {
            var element;
            if (args['selector_type'] == 'css') {
                element = getElementByQuerySelector(args.req_args['selector']);
            } else if (args['selector_type'] == 'xpath') {
                element = getElementByXpath(args.req_args['selector']);
            } else {
                var msg = "Invalid selector type '" + args['selector_type'] + "'";
                return [msg, false, false];
            }
            if (element == null || typeof element === 'undefined') {
                var msg = "Could not match an element with " + args.selector_type +
                    " selector '" + args.req_args['selector'] + "'";
                return [false, msg, false];
            } else if (element.offsetWidth <= 0 && element.offsetHeight <= 0 && !args.req_args[
                    'force']) {
                var msg = "Element found but appears to be hidden.  Use force=1 to override.";
                return [false, msg, false];
            } else {
                switch (args.req_args.action) {
                    case 'click':
                        eventFire(element, 'click');
                        return [false, false, 'Fired click event on ' + args.req_args[
                            'selector']];
                        break;
                    case 'download_image':
                        var img = getImgDimensions(element);
                        if (img) {
                            return [false, false, img];
                        }
                        return ["Unknown error while downloading.", false, false];
                        break;
                    case 'enter_text':
                        if (typeof element.attributes.value === 'undefined' && !args.req_args[
                                'force']) {
                            var warning = args.req_args.selector +
                                ' does not appear to have a value attribute.  Use force =1 to override';
                            return [false, warning, false];
                        }
                        // Firing a focus event seems to occassionally cause a problem on the subsequent keypress sequence.
                        // Also, click events are more human than blur events, I guess.
                        //eventFire(element, 'focus');
                        eventFire(element, 'click');
                        return [false, false, true];
                        break;
                    case 'follow_link':
                        var current_link = window.location.href;
                        var new_link = element.href;
                        //location.href = new_link;
                        return [false, false, new_link];
                        break;
                }
            }
        } catch (err) {
            return [err.message, false, false];
        }
    }, eval_args), function(res) {
        if (err) mf_log.log('Error on get element: ' + err);
        var err = res[0];
        var warn = res[1];
        var ok = res[2];
        return cb(err, warn, ok);
    });
};

// Simply gets the page's content
MF_Eddie.prototype.get_content = function(args, cb) {
    var timeout = this.req_args.timeout || false;
    var wrapper_fn = function() {
        if (!timeout) timeout = WAIT;
        var getContent = function() {
            this.page.getContent(function(res) {
                if (res) {
                    this.mf_content_type = false;
                    return cb(false, false, res);
                }
                this.mf_content_type = 'application/json';
                return cb("No content returned");
            }.bind(this));
        }.bind(this);
        return setTimeout(getContent, timeout);
    }.bind(this);

    if (args) {
        return this.set_args(args, wrapper_fn);
    } else {
        timeout = WAIT;
        return wrapper_fn();
    }
}

MF_Eddie.prototype.kill = function(args, cb) {
    this.set_args(args, function() {
        var ok = 'killing browser with phantom pid ' + args.pid;
        return cb(false, false, ok);
    }.bind(this));
}

// Closes the browser
MF_Eddie.prototype.exit_phantom = function(cb) {
    var pid = this.get_phantom_pid();
    if (this.page) this.page.close();
    this.ph.exit();
    return cb();
}
module.exports = MF_Eddie;
