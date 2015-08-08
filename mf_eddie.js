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

MF_Eddie.prototype.cache_page = function(url, content_type, cb) {
	if(!content_type) content_type = 'text/html';
	console.log('cached ' + url + " with content type " + content_type);
	
	var cached_content = {url: url, content_type:content_type};
	this.history_queue.push(cached_content);
	this.history_queue_pos++;
	console.log("at position " + this.history_queue_pos + " in history.");
	return cb();
}

MF_Eddie.prototype.set_page = function(err, warn, page, cb) {
	var set_page_fn = function() {
		if(page) this.page = page;
		this.responded = true;
		var req_args = this.req_args;
		
		if(err) {
			this.fatal_error = err;
			this.status_code = this.status_code || 500;
			this.mf_content_type = 'application/json';
			return cb(err);
		}
		
		if(warn) {
			console.log("get content? " + this.req_args.get_content);
			console.log("page content_type? " + this.page_content_type);
			console.log("mf content_type? " + this.mf_content_type);
			if(this.timedOut && this.req_args.get_content) {
				warn = false;
				this.mf_content_type = this.page_content_type;
				this.mf_status_code = this.page_status_code || 200;
			}
			else {
				this.mf_content_type = 'application/json';
				return cb(err, warn, false);
			}
		}	
		if(page) {
			if(this.req_args.get_content) {
				return this.get_content(false, function(e,w,c) {
					return cb(e, w, c);
				}.bind(this));
			}
			else {
				this.mf_content_type = 'application/json';
				this.mf_status_code = this.page_status_code || 200;
				return cb(false, false, "OK.  Visited page.");
			}
		}
	}.bind(this);
	
	if(!err && !this.responded && page && this.req_args.keep_alive) {
		this.cache_page(this.req_args.url, this.page_content_type, set_page_fn);
	}
	else { set_page_fn(); }
}


function MF_Eddie(args, cb, mf_instances) {
    var push_instance_cb = function(err, pid) {
        return cb(err, this);
    }.bind(this);
    var phantom_cb = function() {
        return mf_instances.push_instance(this, push_instance_cb);
    }.bind(this);
	this.history_queue = [];
	this.history_queue_pos = -1;
    this.mf_content_type = false;
    this.fatal_error = false;
    this.eventEmitter = new events.EventEmitter();
    this.visit_timeout = args.timeout;
    this.allowed = args.allowed;
    this.disallowed = args.disallowed;
    this.load_external = args.load_external;
    this.load_images = args.load_images;
    this.load_css = args.load_css;
    this.return_on_timeout = args.return_on_timeout;
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
	this.responded = false;
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
            page.set('settings.resourceTimeout', this.visit_timeout);
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
                load_external: this.load_external,
                load_images: this.load_images,
                load_css: this.load_css,
                allowed: this.allowed,
                disallowed: this.disallowed
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
				console.log('TIMEOUT OCCURRED WITH MFEDDIE.VISIT_TIMEOUT = ' + this.visit_timeout);
				console.log('TIMEOUT, CHECK PAGE_CONTENT TYPE: ' + this.page_content_type);
				console.log('TIMEOUT, CHECK RETURN ON TIMEOUT: ' + this.return_on_timeout);
				if(this.return_on_timeout && this.page_content_type) {
						console.log('non fatal timeout');
						this.eventEmitter.emit('non_fatal_timeout');
						console.log(this.page_content_type);
						this.status_code = 200;
						this.mf_content_type = this.page_content_type || 'text/html';
						this.timedOut = true;
						return this.set_page(false, 'Page timed out, returning partially loaded content', page, cb);
				}
				else {
					this.status_code = 504;
					this.fatal_error = "Gateway Timeout: timeout occurred before " + request.url + " responded.";
					this.eventEmitter.emit('fatal_error');
					return;
				}
			}.bind(this));
            
            page.set('onConsoleMessage', function(msg) {
				//console.log(msg);
			});
			
            page.set('onResourceReceived', function(resp) {
				console.log(resp.id);
				var resp_url = resp.url.replace(/\//g, "");
				var curr_url = this.current_url.replace(/\//g, "");
				if(!this.page_content_type && (resp_url == curr_url)) {
					console.log('url req and resp match');
					console.log("setting content type to " + resp.contentType);
					console.log('setting status code to ' + resp.status);
                    if(resp.redirectURL) {
						this.current_url = resp.redirectURL;
						this.page_content_type = false;
					}
					else {
						this.page_content_type = resp.contentType;
						this.status_code = resp.status;
					}
				}                
            }.bind(this));
            var t = Date.now();
            this.timedOut = false;
            this.page_content_type = false;
            this.responded = false;
            this.current_url = this.req_args.url;
            console.log('UCRRENT URL: ' + this.current_url);
            page.open(this.req_args.url, function(status) {
                if(status != 'success') {
					this.fatal_error = "Unknown error ocurred while opening page at " + this.req_args.url;
					this.mf_status_code = this.mf_status_code || 500;
					this.eventEmitter.emit('fatal_error');
					return;
				}
                return this.set_page(false, false, page, cb);
            }.bind(this));
        }.bind(this));
    }.bind(this));
};

MF_Eddie.prototype.back = function(args, cb) {
	this.set_args(args, function() {
		if(this.history_queue_pos <= 0) {
			return cb(false, "Can't go back, there are no previously loaded pages.\n");
		}
		this.history_queue_pos--;
		var cached = this.history_queue[this.history_queue_pos];
		this.eventEmitter.on('non_fatal_timeout', function() {
			this.status_code = 200;
			this.mf_content_type = 'application/json';
			return cb(false, "A timeout ocurred (possibly on the previous request).  Will continue to attempt to go back to " + cached.url);
		}.bind(this));
		this.page.goBack();
		var ret_fn = function() {
			this.page_content_type = cached.content_type;
			return cb(false, false, "Went back to " + cached.url);
		}.bind(this);
		return setTimeout(ret_fn, this.req_args.timeout);
		
	}.bind(this));
	/*
	console.log('back function called');
	this.set_args(args, function() {
		this.status_code = 200;
		this.mf_content_type = 'application/json';
		if(this.history_queue_pos < 1) {
			return cb("There is no previous page cached.", false, false);
		}
		var cached_content = this.history_queue[--this.history_queue_pos];
		console.log('is cached_content defined? ' + cached_content);
		console.log('cached_content url? ' + cached_content.url);
		console.log('cached_content url alt? ' + cached_content['url']);
		console.log('page content type? ' + cached_content.content_type);
		
		this.page.setContent(cached_content.content, cached_content.url, function(res) {
			var err = false, warn = false, ok = false;
			this.page_content_type = cached_content.content_type;
			if(res == 'fail') {
				warn = 'An unknown failure ocurred while loading cached content.  Try using the visit action to reload ' + cached_content.url;
			}
			else {
				ok = "Went back to " + cached_content.url;
			}
			var ret_fn = function() {return cb(err, warn, ok);};
			return setTimeout(ret_fn, this.req_args.timeout);
		}.bind(this));
	}.bind(this));
	* */
}

MF_Eddie.prototype.forward = function(args, cb) {
	this.set_args(args, function() {
		if(this.history_queue_pos >= this.history_queue.length-1) {
			return cb(false, "Can't go forward, there are no previously loaded pages.\n");
		}
		this.history_queue_pos--;
		this.page.goBack();
		var ret_fn = function() {
			var cached = this.history_queue[this.history_queue_pos];
			this.page_content_type = cached.content_type;
			return cb(false, false, "Went back to " + cached.url);
		}.bind(this);
		return setTimeout(ret_fn, this.req_args.timeout);
		
	}.bind(this));
	/*
	this.set_args(args, function() {
		this.status_code = 200;
		this.mf_content_type = 'application/json';
		
		if(this.history_queue_pos >= this.history_queue.length - 1) {
			return cb("There is no forward page cached.", false, false);
		}
		var cached_content = this.history_queue[++this.history_queue_pos];
		console.log('is cached_content defined? ' + cached_content);
		console.log('cached_content url? ' + cached_content.url);
		console.log('cached_content url alt? ' + cached_content['url']);
		console.log('page content type? ' + cached_content.content_type);
		
		
		this.page.setContent(cached_content.content, cached_content.url, function(res) {
			var err = false, warn = false, ok = false;
			this.page_content_type = cached_content.content_type;
			if(res == 'fail') {
				warn = 'An unknown failure ocurred while loading cached content.  Try using the visit action to reload ' + cached_content.url;
			}
			else {
				ok = "Went forward to " + cached_content.url;
			}
			var ret_fn = function() {return cb(err, warn, ok);};
			return setTimeout(ret_fn, this.req_args.timeout);
		}.bind(this));
	}.bind(this));
	* */
}

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
			this.mf_status_code = 200;
			return setTimeout(function() {cb(err, warn, ok);}, this.req_args.timeout);
		}.bind(this));
	}.bind(this));
};

MF_Eddie.prototype.download_image = function(args, cb) {
	this.set_args(args, function() {
		this.get_element(function(err, warn, clipRect) {
			console.log('download_image callback');
			if(err||warn) return cb(err,warn);
			
			this.page.set('clipRect', clipRect);
			this.page.render(this.req_args['dl_file_loc']);
			return setTimeout(function() {
				this.status_code = 200;
				this.mf_content_type = 'application/json';
				var success = 'Downloaded image to ' + this.req_args['dl_file_loc'];
				return cb(false, false, success);
			}.bind(this), this.req_args.timeout);
		}.bind(this));
	}.bind(this));
};

MF_Eddie.prototype.enter_text = function(args, cb) {
	this.set_args(args, function() {
		this.get_element(function(err, warn, ok) {
			console.log('enter_text callback');
			this.status_code = 200;
			this.mf_content_type = 'application/json';
			return cb(err, warn, ok);
		}.bind(this));
	}.bind(this));
};

MF_Eddie.prototype.follow_link = function(args, cb) {
	this.set_args(args, function() {
		return this.get_element(function(err, warn, new_link) {
			
			if(err||warn) return cb(err, warn);
			
			this.eventEmitter.on('non_fatal_timeout', function() {
				this.status_code = 200;
				this.mf_content_type = 'application/json';
				return cb(false, "A timeout ocurred (possibly on the previous request).  Will continue to attempt to follow link to " + new_link);
			});
			this.current_url = new_link;
			this.page_content_type = false;
			this.page.evaluate(evaluateWithArgs(function(link) {
				location.href=link;
			}, new_link), function(res) {
				this.status_code = 200;
				this.mf_content_type = 'application/json';
				return setTimeout(function() {
					return this.cache_page(new_link, this.page_content_type, function() {
						return cb(false, false, "Followed link to " + new_link + '.  Page content-type is ' + this.page_content_type);
					}.bind(this));
				}.bind(this),this.req_args.timeout);

			}.bind(this));
			/*this.page.open(new_link, function(status) {
				if (status != 'success') {
					this.status_code = 500;
					this.mf_content_type = 'application/json';
					return cb(false, 'Unable to open page at ' + new_link, false);
				}
				else {
					console.log('FOLLOW LINK: was page content type set?' + this.page_content_type);
					
					return this.cache_page(new_link, this.page_content_type, function() {
						return cb(false, false, "Followed link to " + new_link);
					}.bind(this));
				}
			}.bind(this));*/
			
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
	var timeout = this.req_args.timeout || WAIT;
	var req_args = this.req_args;
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
			var element;
			if(args['selector_type'] == 'css') {
				element = getElementByQuerySelector(args.req_args['selector']);
			}
			else if(args['selector_type'] == 'xpath') {
				element = getElementByXpath(args.req_args['selector']);
			}
			else {
				var msg = "Invalid selector type '" + args['selector_type'] + "'";
				return [msg, false, false];
			}
			if(element == null || typeof element === 'undefined') {
				var msg = "Could not match an element with " + args.selector_type + " selector '" + args.req_args['selector'] + "'";
				return [false, msg, false];
			}
			else if(element.offsetWidth <=0 && element.offsetHeight <= 0 && !args.req_args['force']) {
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
					var new_link = element.href;
					//location.href = new_link;
					return [false, false, new_link];
				break;
				}
			}
		}
		catch(err) {
			return [err.message, false, false];
		}
	}, eval_args), function(res) {
			console.log(typeof res);
			var err = res[0];
			var warn = res[1];
			var ok = res[2];
			console.log(err + ' ' + warn + ' ' + ok);
			return cb(err, warn, ok);
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
MF_Eddie.prototype.get_content = function(args, cb) {
	var timeout = false;
	var wrapper_fn = function() {
		if(!timeout) timeout = this.req_args.content;
		var getContent = function() {
			this.page.getContent(function(res) {
				if(res) {
					this.mf_content_type = this.page_content_type || this.mf_content_type;
					return cb(false, false, res);
				}
				this.mf_content_type = 'application/json';
				return cb("No content returned");
			}.bind(this));
		}.bind(this);
		return setTimeout(getContent, timeout);
	}.bind(this);
	
	if(args) {return this.set_args(args, wrapper_fn);}
	else {timeout = 2000; return wrapper_fn(); }
}

MF_Eddie.prototype.kill = function(args, cb) {
	this.set_args(args, function() {
		var ok = 'killing browser with phantom pid ' + args.pid;
		console.log(ok);
		return cb(false, false, ok);
	}.bind(this));
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
