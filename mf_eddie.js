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
var TIMEOUT = config.get('timeout') || 2500;
var WAIT = config.get('wait') || 800;
function evaluateWithArgs(fn) {
    return "function() { return (" + fn.toString() + ").apply(this, " + JSON.stringify(Array.prototype.slice.call(arguments, 1)) + ");}";
}
MF_Eddie.prototype.get_phantom_pid = function() {
    var pid = this.ph.process.pid;
    return pid;
}
MF_Eddie.prototype.set_phantom = function (p, cb) {
    mf_log.log('set phantom called');
    this.ph = p;
    if(cb && typeof cb == 'function')
        return cb();
    return;
};
MF_Eddie.prototype.set_page = function(p, cb) {
	if(this.fatal_error) return;
    this.page = p;
    var warn = false;
    if(this.timedOut && this.req_args.return_on_timeout && !this.req_args.get_content) {
		if(!this.page_content_type && !this.mf_content_type) {
			this.mf_content_type = 'text/html';
		}
		warn = "Page timed out during load.  Returned partially loaded page.";
	}
    if(this.req_args.get_content) {
        return this.get_content(1500, function(err, warn, content) {
            return cb(err, warn, content);
        });
    }
    this.mf_content_type = 'application/json';
    var ok = (warn) ? false : "Successfully visited page.";
    return cb(false, warn, ok);
};

function MF_Eddie(args, cb, mf_instances) {
    mf_log.log("new mfeddie called");
    var push_instance_cb = function(err, pid) {
        return cb(err, this);
    }.bind(this);
    var phantom_cb = function() {
        mf_log.log("has ph?");
        mf_log.log(this.ph);
        return mf_instances.push_instance(this, push_instance_cb);
    }.bind(this);

    this.mf_content_type = false;
    this.fatal_error = false;
    var parameters_arg = (args.require_proxy !== 'undefined') ? {paramaters: {proxy: args.proxy}} : false;
    if(args.require_proxy) {
        return phantom.create({parameters: {proxy: args.proxy}}, function(ph) {
            this.user_agent = args.user_agent;
            this.proxy = args.proxy;
            return this.set_phantom(ph, phantom_cb);
        }.bind(this));
    }
    else {
       return phantom.create(function(ph) {
            this.user_agent = args.user_agent;
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
    return [['Set-Cookie', 'pid='+pid+'; path=/mfeddie']];
}

// Will load a page in browser.
MF_Eddie.prototype.visit = function(args, cb) {
	this.current_action = 'visit';
    this.set_args(args, function() {
        this.ph.createPage(function(page) {
			this.timedOut = false;
			this.start_time = Date.now();
			var pcb = function(e, w, c) {
				if(!this.visit_responded) {
                    cb(e, w, c);
                    this.visit_response = true;
				}
			}.bind(this);
            page.set('settings.userAgent', this.user_agent);
            console.log('check the timeout val!!!! ' + this.req_args.timeout);
            page.set('settings.resourceTimeout', this.req_args.timeout);
            page.set('onConsoleMessage', function(msg) {});
            page.set('onLoadStarted', function() {
                this.loadInProgress = true;
            }.bind(this));
            page.set('onLoadFinished', function() {
                this.loadInProgress = false;
            }.bind(this));
            var hostname = URL.parse(this.req_args.url).hostname.replace('www.', '');
            var base = base_url(this.req_args.url);
            var request_filter_args = {
                base_url: base,
                hostname: hostname,
                load_external: this.req_args.load_external,
                load_images: this.req_args.load_images,
                load_css: this.req_args.load_css,
                allowed: this.req_args.allowed,
                disallowed: this.req_args.disallowed
            };
            // Will determine whether or not to abort a given request
            page.onResourceRequested(
                function(requestData, request, scoped_args) {
                    // If allowed, do nothing, return.
                    for(var i in scoped_args['allowed']) {
                        if(requestData['url'].indexOf(scoped_args['allowed'][i]) > -1) {
							console.log('allow request: ' + requestData['url'] + ' is explicitly allowed.');
                            return;
                        }
                    }
                    // If disallowed, abort request
                    for(var i in scoped_args['disallowed']) {
                        if(requestData['url'].indexOf(scoped_args['disallowed'][i]) > -1) {
							console.log('abort request: ' + requestData['url'] + ' is explicitly disallowed.');
                            return request.abort();
                        }
                    }
                    var is_subdomain = false;
                    if(!scoped_args['load_external'] && requestData['url'].match(/(?:\w+\.)+\w+/m).toString().indexOf(scoped_args['hostname']) > -1)
                        is_subdomain = true;
                    var is_external = false;
                    if(!scoped_args['load_external'] && requestData['url'].indexOf(scoped_args['base_url']) != 0 && requestData['url'].indexOf('/') != 0)
                        is_external = true;
                    if(!scoped_args['load_external'] && !is_subdomain && is_external) {
                        console.log('abort request: ' + requestData['url'] + ' is external');
                        return request.abort();
                    }
                    if(!scoped_args['load_images'] && (/\.(tif|tiff|png|jpg|jpeg|gif)($|\?)/).test(requestData['url'])) {
                        console.log('abort request: '  + requestData['url'] + ' appears to be an image file');
                        return request.abort();
                    }
                    if(!scoped_args['load_css'] && (/\.css($|\?)/).test(requestData['url'])) {
                        console.log('abort request: '  + requestData['url'] + ' appears to be css');
                        return request.abort();
                    }
                    return;
                }, function(requestData) { }, request_filter_args
            );
            // If a resource does not load within the timeout, abort all requests and close the browser.
			page.set('onResourceTimeout', function(request) {
				if(request.id == 1) {
					this.req_args.return_on_timeout = false;
					this.fatal_error = 'Gateway Timeout: request to ' + this.req_args.url + ' timed out before receiving any response.';
					this.mf_content_type = 'application/json';
					this.status_code = 504;
					return cb(this.fatal_error);
				}
			}.bind(this));
            
            page.set('onConsoleMessage', function(msg) {
				console.log(msg);
			});
            page.set('onResourceReceived', function(resp) {
				
				if(resp.id == 1 && resp.stage == 'end') {
					console.log('resp 1 returned ');
                    this.page_content_type = resp.contentType;
                    this.status_code = resp.status;
                    return;
                }
                var elapsed = Date.now() - this.start_time;
				if(elapsed > this.req_args.timeout  && !this.timedOut) {
					if(this.req_args.return_on_timeout) {
						if(!this.status_code || this.status_code == 301) {
							this.status_code = 200;
						}
						if(!this.page_content_type) {
							this.mf_content_type = 'text/html';
						}
						this.timedOut = true;
						return this.set_page(page, pcb);
					}
				}
                // Will determine the content type to send back to crawler
            }.bind(this));
            var t = Date.now();
            this.timedOut = false;
            page.open(this.req_args.url, function(status) {
                if(status != 'success') {
					if(!this.page_content_type) {
						this.mf_content_type = 'application/json';
					}
					if(!this.fatal_error) {
						this.status_code = 500;
						this.fatal_error = "Unknown error ocurred while opening page at " + this.req_args.url;
					}
					return cb(this.fatal_error);
				}
                if(this.fatal_error) {
					this.mf_content_type = 'application/json';
					return cb(this.fatal_error);
				}
                return this.set_page(page, pcb);
            }.bind(this));
        }.bind(this));
    }.bind(this));
};

MF_Eddie.prototype.download_image = function(dl_args) {
    this.current_action = 'download_image';
    var timeout = dl_args.timeout || WAIT;
    if(!dl_args.selector) {
        return dl_args.callback('Missing required arguments: enter_text(selector)', false, false);
    }
    if(!this.page) {
        return dl_args.callback('Error: no page loaded', false, false);
    }
    var eval_args = {s:dl_args.selector};
    this.page.injectJs(config.get('jquery_lib'), function() {
        this.page.evaluate(evaluateWithArgs(function(args) {
            function getImgDimensions($i) {
                return {
                    top : $i.offset().top,
                    left : $i.offset().left,
                    width : $i.width(),
                    height : $i.height()
                }
            }
            var element = $(args.s);
            if(!element) {
                var msg = "Element " + args.s + " not found.";
                return [msg, false, false];
            }
            else if(!element.is(":visible")) {
                var msg = "Element " + args.s + " appears to be hidden.  Use force to override";
                return [false, msg, false];
            }
            var img = getImgDimensions(element);
            if(img) {
                return [false, false, img];
            }
            return ["Unknown error while downloading.", false, false];
        }, eval_args), function(res) {
            setTimeout(function() {
                var image;
                if(!res[0] && !res[1]) {
                    image = res[2];
                    res[2] = "OK, downloaded image"
                }
                this.page.set('clipRect', image);
                this.page.render(dl_args.dl_file_loc);
                return dl_args.callback(res[0], res[1], res[2]);
            }.bind(this), timeout);
        }.bind(this));
    }.bind(this));
};
MF_Eddie.prototype.follow_link = function(fl_args) {
    this.current_action = 'follow_link';
    var timeout = fl_args.timeout || WAIT;
    if(!fl_args.selector) {
        return fl_args.callback('Missing required arguments: enter_text(selector)', false, false);
    }
    if(!this.page) {
        return fl_args.callback('Error: no page loaded', false, false);
    }
    var eval_args = {s:fl_args.selector};
    this.page.injectJs(config.get('jquery_lib'), function() {
        this.page.evaluate(evaluateWithArgs(function(args) {
            var element = $(args.s);
            if(!element) {
                var msg = "Element " + args.s + " not found.";
                return [msg, false, false];
            }
            else if(!element.is(":visible")) {
                var msg = "Element " + args.s + " appears to be hidden.  Use force_follow=1 to override";
                return [false, msg, false];
            }
            else if(!element[0].href) {
                var msg = "Element " + args.s + " does not appear to be a link.  Could not find href attribute";
                return [msg, false, false];
            }
            else {
                location.href = element[0].href;
            }
            return [false, false, 'Found element ' + args.s + ' and followed link to ' + element[0].href];
        }, eval_args), function(res) {
            setTimeout(function() {return fl_args.callback(res[0], res[1], res[2]);}, timeout);
        });
    }.bind(this));
};
MF_Eddie.prototype.enter_text = function(et_args) {
    this.current_action = 'enter_text';
    mf_log.log('mf_eddie.js: in enter_text fn');
    mf_log.log("libpath?");
    mf_log.log(this.ph.libraryPath);
    var timeout = et_args.timeout || WAIT;
    if(!et_args.selector) {
        return et_args.callback('Missing required arguments: enter_text(selector)', false, false);
    }
    if(!this.page) {
        return et_args.callback('Error: no page loaded', false, false);
    }
    var eval_args = {s:et_args.selector, f: et_args.force_text, t: et_args.text};
    this.page.injectJs(config.get('jquery_lib'), function() {
        this.page.evaluate(evaluateWithArgs(function(args) {
            var element = $(args.s);
            if(!element) {
                var msg = "Element " + args.s + " not found.";
                return [msg, false, false];
            }
            else if(!element.is(":visible")) {
                var msg = "Element " + args.s + " appears to be hidden.  Use force_text=1 to override";
                return [false, msg, false];
            }
            else {
                element.val(args.t);
            }
            return [false, false, 'Found element ' + args.s + ' and entered text'];
        }, eval_args), function(res) {
            setTimeout(function() {return et_args.callback(res[0], res[1], res[2]);}, timeout);
        });
    }.bind(this));
};
function get_selector_type(selector) {
    var re = /\//;
    return selector.match(re) ? 'xpath' : 'css';
}
// Click action
MF_Eddie.prototype.click = function(c_args) {
    this.current_action = 'click';
    var timeout = c_args.timeout || WAIT;
    if(!c_args.selector) {
        return c_args.callback('Missing required arguments: click(selector)', false, false);
    }
    if(!this.page) {
        return c_args.callback('Error: no page loaded', false, false);
    }
    var eval_args = {s:c_args.selector, f: c_args.force_click};
    this.page.injectJs(config.get('jquery_lib'), function() {
        this.page.evaluate(evaluateWithArgs(function(args) {
            function eventFire(el, etype){
              if (el.fireEvent) {
                el.fireEvent('on' + etype);
              } else {
                var evObj = document.createEvent('Events');
                evObj.initEvent(etype, true, false);
                el.dispatchEvent(evObj);
              }
            }
            var element = $(args.s);
            if(!element) {
                var msg = "Element " + args.s + " not found.";
                return [msg, false, false];
            }
            else if(!element.is(":visible")) {
                var msg = "Element " + args.s + " appears to be hidden.  Use force_text=1 to override";
                return [false, msg, false];
            }
            else {
                eventFire(element[0], 'click');
            }
            return [false, false, 'Found and clicked element ' + args.s];
        }, eval_args), function(res) {
                setTimeout(function() {return c_args.callback(res[0], res[1], res[2]);}, timeout);
        });
    }.bind(this));
};
MF_Eddie.prototype.back = function(cb) {
    this.current_action = 'back';
    if(this.page.canGoBack) {
        page.goBack();
        return cb(null, 'Went back.');
    }
    else {
        return cb("Unable to go back");
    }
}
// Gets the page's content by returning the outer HTML of the <html> tag
MF_Eddie.prototype.get_page_html = function(cb, to) {
    this.current_action = 'get_html';
    var timeout = to || WAIT;
    var getPageHTML = function () {
        this.page.evaluate(function() {
            return document.querySelectorAll('html')[0].outerHTML;
        }, function(res) {
            return cb(null, res);
        });
    }.bind(this);
    setTimeout(getPageHTML, timeout);
}
// Simply gets the page's content
MF_Eddie.prototype.get_content = function(to, cb) {
    var timeout = to || WAIT;
    console.log('GET CONTENT FUNCTION');
    if(this.page) console.log('this.page = TRUE');
    var getContent = function() {
        this.page.getContent(function(res) {
			console.log('GET CONTENT CALLBACK');
			if(res) console.log('RES IS TRUE');
            if(res) return cb(false, false, res);
        return cb("No content returned");
        });
    }.bind(this);
    return setTimeout(getContent, timeout);
}
// Closes the browser
MF_Eddie.prototype.exit_phantom = function(cb) {
	console.log('mfeddie exit phantom called');
    var pid = this.get_phantom_pid();
    if(this.page) this.page.close();
    this.ph.exit();
    return cb();
}
module.exports = MF_Eddie;
