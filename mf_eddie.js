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
MF_Eddie.prototype.set_page = function(err, warn, page, cb) {
	if(page) this.page = page;


	//if(this.responded) { console.log("SET PAGE: ALREADY RESPONDED"); return; }
	this.responded = true;
	var req_args = this.req_args;
	
	if(err) {
		this.fatal_error = err;
		this.status_code = this.status_code || 500;
		this.mf_content_type = 'application/json';
		return cb(err);
	}
	
	if(warn) {
		if(this.timedOut && this.req_args.get_content) {
			warn = false;
			this.mf_status_code = this.page_status_code || 200;
		}
		else {
			this.mf_content_type = 'application/json';
			return cb(err, warn, false);
		}
	}	
	if(page) {
		if(this.req_args.get_content) {
			return this.get_content(1500, function(e,w,c) {
				this.mf_content_type = this.page_content_type || 'text/html';
				return cb(e, w, c);
			}.bind(this));
		}
		else {
			this.mf_content_type = 'application/json';
			this.mf_status_code = this.page_status_code || 200;
			return cb(false, false, "OK.  Visited page.");
		}
	}
}


function MF_Eddie(args, cb, mf_instances) {
    var push_instance_cb = function(err, pid) {
        return cb(err, this);
    }.bind(this);
    var phantom_cb = function() {
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
	this.timedOut = false;
    this.set_args(args, function() {
        this.ph.createPage(function(page) {
			this.timedOut = false;
			this.start_time = Date.now();
			this.responded = false;
			page.set('viewportSize', {width:800, height:800});
			page.set('paperSize', {width: 1024, height: 768, border:'0px' });
            page.set('settings.userAgent', this.user_agent);
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
				console.log('timeout');
				if(this.req_args.return_on_timeout && this.page_content_type) {
						this.status_code = 200;
						this.mf_content_type = this.page_content_type || 'text/html';
						return this.set_page(false, 'Page timed out, returning partially loaded content', page, cb);
				}
				else {
					this.status_code = 504;
					this.fatal_error = 'Gateway Timeout: timeout occurred before receiving any data from ' + request.url;
					return this.set_page(this.fatal_error, false, false, cb);
				}
			}.bind(this));
            
            page.set('onConsoleMessage', function(msg) {
				console.log(msg);
			});
			
			this.resp_id_target = 1;
            page.set('onResourceReceived', function(resp) {
				if(resp.id == this.resp_id_target) {
					console.log("setting content type to " + resp.contentType);
					console.log('setting status code to ' + resp.status);
                    this.page_content_type = resp.contentType;
                    this.status_code = resp.status;
                    if(resp.redirectURL) {
						console.log('increment target');
						this.resp_id_target += 1;
						console.log('target='+ this.resp_id_target);
					}
				}
				
				var elapsed = Date.now() - this.start_time;
				if(elapsed > this.req_args.timeout) {
					
				}
                
                
                // Will determine the content type to send back to crawler
            }.bind(this));
            var t = Date.now();
            this.timedOut = false;
            page.open(this.req_args.url, function(status) {
                if(status != 'success') {
					this.fatal_error = "Unknown error ocurred while opening page at " + this.req_args.url;
					this.mf_status_code = this.page_status_code || 500;
					return this.set_page(this.fatal_error, false, false, cb);
				}
                return this.set_page(false, false, page, cb);
            }.bind(this));
        }.bind(this));
    }.bind(this));
};

MF_Eddie.prototype.click = function(args, cb) {
	this.set_args(args, function() {
		return this.get_element(function(err, warn, ok) {
			return cb(err, warn, ok);
		}.bind(this));
	}.bind(this));
};

MF_Eddie.prototype.download_image = function(args, cb) {
	var timeout = this.req_args.timeout;
	this.req_args['timeout'] = 50;
	this.req_args['callback_timeout'] = timeout;
	this.set_args(args, function() {
		this.get_element(function(err, warn, clipRect) {
			console.log('download_image callback');
			if(err||warn) return cb(err,warn);
			
			this.page.set('clipRect', clipRect);
			this.page.render(this.req_args['dl_file_loc']);
			return setTimeout(function() {
				var success = 'Downloaded image to ' + this.req_args['dl_file_loc'];
				return cb(false, false, success);
			}.bind(this), this.req_args['callback_timeout']);
		}.bind(this));
	}.bind(this));
};

MF_Eddie.prototype.enter_text = function(args, cb) {
	this.set_args(args, function() {
		this.get_element(function(err, warn, ok) {
			console.log('enter_text callback');
			return cb(err, warn, ok);
		}.bind(this));
	}.bind(this));
};

MF_Eddie.prototype.follow_link = function(args, cb) {
	this.set_args(args, function() {
		return this.get_element(function(err, warn, ok) {
			
		}.bind(this));
	}.bind(this));
};
function evaluateWithArgs(fn) {
    return "function() { return (" + fn.toString() + ").apply(this, " + JSON.stringify(Array.prototype.slice.call(arguments, 1)) + ");}";
}

function get_selector_type(selector) {
    var re = /\//;
    return selector.match(re) ? 'xpath' : 'css';
}

MF_Eddie.prototype.get_element = function(cb) {
	var selector_type = this.req_args.force_selector_type || get_selector_type(this.req_args.selector);
	console.log("determined selector type to be " + selector_type);
	var timeout = this.req_args.timeout || WAIT;
	var req_args = this.req_args;
	this.mf_content_type = 'application/json';
	this.status_code = 200;
	var eval_args = {selector_type: selector_type, req_args: req_args};

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
			
			function getElementByXpath(path) {
				return document.evaluate(path, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
			}
			
			function getElementByQuerySelector(sel) {
				return document.querySelector(sel);
			}
			
			function getImgDimensions(el) {
				var rect = el.getBoundingClientRect();
				
				return {
					top : rect.top,
					left : rect.left,
					width : rect.width,
					height : rect.height
				};
			}
		try {
			console.log('inside eval');
			
			console.log('after fn defs');
			var element;
			if(args['selector_type'] == 'css') {
				console.log('SELECTOR IS CSS');
				element = getElementByQuerySelector(args.req_args['selector']);
			}
			else if(args['selector_type'] == 'xpath') {
				console.log('SELECTOR IS XPATH');
				element = getElementByXpath(args.req_args['selector']);
			}
			else {
				var msg = "Invalid selector type '" + args['selector_type'] + "'";
				return [msg, false, false];
			}
			if(element == null || typeof element === 'undefined') {
				console.log('el is null');
				var msg = "Could not match an element with " + args.selector_type + " selector '" + args.req_args['selector'] + "'";
				return [msg, false, false];
			}
			else if(element.offsetWidth <=0 && element.offsetHeight <= 0 && !args.req_args['force']) {
				console.log('el is not visible');
				var msg = "Element found but appears to be hidden.  Use force=1 to override.";
				return [false, msg, false];
			}
			else {
				switch(args.req_args.action) {
				case 'click':
					eventFire(element, 'click');
					return [false, false, 'Fired click event on ' + args.req_args['selector']];
				break;
				case 'download_image':
				console.log('DOWN IMAGE');
					var img = getImgDimensions(element);
					if(img) {
						return [false, false, img];
					}
					return ["Unknown error while downloading.", false, false];
				break;
				case 'enter_text':
					if(typeof element.attributes.value === 'undefined') {
						var warning = 'Warnning: ' + args.req_args.selector + ' does not appear to have a value attribute.  Use force =1 to override';
						return [false, warning, false];
					}
					element.value = args.req_args['text'];
					return [false, false, 'Set value for field ' + args.req_args.selector + ' to ' + args.req_args['text']];
				break;
				case 'follow_link':
					var current_link = window.location.href;
					var new_link = element[0].href;
					location.href = new_link;
					return [false, false, {'prev':current_link,'new':new_link}];
				break;
				}
			}
		}
		catch(err) {
			return [err.message, false, false];
		}
	}, eval_args), function(res) {
			console.log('reached cb bottom');
			console.log(typeof res);
			var err = res[0];
			var warn = res[1];
			var ok = res[2];
			console.log('bottom err, warn ok:');
			console.log(err + ' ' + warn + ' ' + ok);
			var ret_fn = function() {return cb(err, warn, ok);}
			return setTimeout(ret_fn, timeout);
	});
};



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
