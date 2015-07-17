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
    this.ph = p;
    if(cb && typeof cb == 'function')
        return cb(null);
    return;
};

MF_Eddie.prototype.set_page = function(p, cb, rcf) {
    this.page = p;
    var warn = false;
    if(this.timedOut) warn = "Page timed out during load.  Returned partially loaded page.";
    if(rcf) {
        return this.get_content(1500, function(err, content) {
            return cb(err, warn, content);
        });
    }
    return cb(false, warn, 1);
};

MF_Eddie.prototype.update_args = function(args, cb) {
	this.proxy = args.proxy;
    this.user_agent = args.user_agent;
    this.load_media = args.load_media;
    this.load_external = args.load_external;
    this.timeout = args.timeout || TIMEOUT;
    this.allowed = args.allowed;
    this.disallowed = args.disallowed;
    this.return_on_timeout = args.return_on_timeout;
    this.require_proxy = args.require_proxy;

    this.page_content_type = 'text/html';
    this.status_code = '';
    this.loadInProgress = false;
    this.page_html = 'No page loaded';
    this.timedOut = false;
    this.current_action = 'init';
    this.url = null;
    this.load_time = 0;
    
    if(typeof cb === 'function') return cb();
    return;
}

function MF_Eddie(args, cb) {
    this.update_args(args);
    
    var parameters_arg = (this.require_proxy) ? {paramaters: {proxy: args.proxy}} : false;
    if(args.require_proxy) {
		phantom.create({parameters: {proxy: args.proxy}}, function(ph) {
			this.set_phantom(ph, cb);
		}.bind(this));
	}
	else {
		phantom.create(function(ph) {
			this.set_phantom(ph, cb);
		}.bind(this));
	}
};

function base_url(url) {
    return url.match(/^https?:\/\/[^\/]+/i);

}
// Will load a page in browser.
MF_Eddie.prototype.visit = function(url, cb, rcf) {
    this.current_action = 'visit';
    this.url = url;
    this.timedOut = false;

    this.ph.createPage(function(page) {
        page.set('settings.userAgent', this.user_agent);
        page.set('settings.resourceTimeout', this.timeout);
        page.set('onConsoleMessage', function(msg) {});
        page.set('onLoadStarted', function() {
            this.loadInProgress = true;
        }.bind(this));
        page.set('onLoadFinished', function() {
            this.loadInProgress = false;
        }.bind(this));
        var first_request = true;
        var hostname = URL.parse(this.url).hostname.replace('www.', '');
        var base = base_url(this.url);
        var req_args = {
            base_url: base,
            hostname: hostname,
            load_external: this.load_external,
            load_media: this.load_media,
            allowed: this.allowed,
            disallowed: this.disallowed,
        };
        // Will determine whether or not to abort a given request
        page.onResourceRequested(
            function(requestData, request, scoped_args) {
                // If allowed, do not abort
                for(var i in scoped_args.allowed) {
                    if(requestData['url'].indexOf(scoped_args.allowed[i]) > -1) {
                        return;
                    }
                }
                // If disallowed, abort request
                for(var i in scoped_args.disallowed) {
                    if(requestData['url'].indexOf(scoped_args.disallowed[i]) > -1) {
                        request.abort();
                        return;
                    }
                }

                var is_subdomain = false;
                if(!scoped_args.load_external && requestData['url'].match(/(?:\w+\.)+\w+/m).toString().indexOf(scoped_args.hostname) > -1)
                    is_subdomain = true;

                var is_external = false;
                if(!scoped_args.load_external && requestData['url'].indexOf(scoped_args.base_url) != 0 && requestData['url'].indexOf('/') != 0)
                    is_external = true;

                if(!scoped_args.load_external && !is_subdomain && is_external) {
                    //console.log('abort request: ' + requestData['url'] + ' is external');
                    request.abort();
                    return;
                }

                if(!scoped_args.load_media && (/\.(css|png|jpg|jpeg)($|\?)/).test(requestData['url'])) {
                    //console.log('abort request: '  + requestData['url'] + ' is media or styling.');
                    request.abort();
                    return;
                }

                return;

            }, function(requestData) { }, req_args
        );
        // If a resource does not load within the timeout, abort all requests and close the browser.
        page.set('onResourceTimeout', function() {
            if(this.current_action == 'visit' && !this.timedOut) {
                this.timedOut = true;
                if(this.return_on_timeout) {
                    mf_log.log("Request timed out, returning what has loaded.");
                    var pcb = function(e, w, c){cb(e, w, c);};
                    return this.set_page(page, pcb, rcf);
                }
                page.close();
                mf_log.log("Request to " + url + " timed out.  pid: " + this.pid);
                this.status_code = 504;
                return cb('Gateway Timeout: Request to ' + url + ' timed out.');
            }
        }.bind(this));

        page.set('onResourceReceived', function(resp) {
            // Will determine the content type to send back to crawler
            if(resp.id == 1 && resp.stage == 'end') {
                this.page_content_type = resp.contentType;
                this.status_code = resp.status;
            }
        }.bind(this));
        var t = Date.now();


        page.open(url, function(status) {
            var err = (status == 'success') ? false : ('Failed to open ' + url);
            if(err)
                return cb(err);
            var pcb = function(e, w, c){cb(e, w, c);};
            t = Date.now() - t;
            this.load_time = t;
            return this.set_page(page, pcb, rcf);
        }.bind(this));

    }.bind(this));
};

MF_Eddie.prototype.test_jquery = function() {
	this.page.injectJs(config.get('jquery_lib'), function() {
		return this.page.evaluate(function() {
			$('input#fname').val('Toshi');
			
			$('#b').click();
		})
	}.bind(this));
}

MF_Eddie.prototype.download_image = function(dl_args) {
	mf_log.log("reached download_image function");
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

    var getContent = function() {
        this.page.getContent(function(res) {
            if(res) return cb(null, res);
        return cb("No content returned");
        });
    }.bind(this);

    setTimeout(getContent, timeout);
}
// Closes the browser
MF_Eddie.prototype.exit_phantom = function() {
    var pid = this.get_phantom_pid();
    if(this.page) this.page.close();
    this.ph.exit();

}

module.exports = MF_Eddie;
