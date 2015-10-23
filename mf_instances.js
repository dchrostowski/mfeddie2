/*
 * mf_instances.js - Keeps track of browser instances.
 * An instance of this class is created when mf_server.js is executed.
 * It will keep an associative array of browser instances
 * Provides functions such as push_instance, delete_instance, and get_instance
 *
 */
'use strict';
var config = require('config');
var fs = require('fs');
var exec = require('child_process').exec;
// How often to check MF_Eddie instances
var STATUS_INTERVAL = config.get('status_interval') || 5000;
// The number of seconds an MF_Eddie instance is allowed to run.
var PROCESS_TIMEOUT_SECONDS = config.get('process_timeout_seconds') || 120;
var mf_log = require('./mf_log');
var interval;

function MF_Instances() {
    // Initializes an empty associative array to store MF_Eddie instances.
    mf_log.log("log init");
    this.instances = {};
    start(this);
};
// get relative complement of a in b
function relative_compliment(a, b) {
	var hash = {};
	for(var i=0; i<b.length; i++) {
		hash[b[i]] = 1;
	}
	
	for(var i=0; i<a.length; i++) {
		delete hash[a[i]];
	}
	
	var c = new Array();
	var i=0;
	for(var n in hash) {
		c[i++] = n;
	}
	
	return c;
}

function phantom_procs (tracked_pids) {
	var node_pid = process.pid;
	console.log('\nthe nodejs process is ' + node_pid + '\n');
	var lines = new Array();
	var system_pids = new Array();
	var rogue_pids = new Array();
	
	var exec_cb = function(so) {
		lines = so.split(/\r?\n/g);
		for(var i=0; i<lines.length; i++) {
			var line_data = lines[i].match(/(\w+)/g);
			if(line_data === null) continue;
			var ppid = parseInt(line_data[0]);
			var pid = parseInt(line_data[1]);
			var etime = parseInt(line_data[2]);
			var cmd_start = line_data[3];
			
			if(cmd_start === 'phantomjs' && etime > 60) {
				if(ppid === node_pid || ppid === 1) {
					system_pids.push(pid);
				}
			}
			
		}
		console.log('top:tracked, bottom:system');
		console.log(tracked_pids);
		console.log(system_pids);
		
		rogue_pids = relative_compliment(tracked_pids, system_pids);
		console.log('\nfound these rogue pids:');
		console.log(rogue_pids);
		
		
		if(rogue_pids !== null && rogue_pids.length > 0) {
			exec('kill ' + rogue_pids.join(' '), function(err, so, se) {
				if(err !== null) {
					console.log('ERROR WHILE KILLING ROGUE PROCS:');
					console.log(err);
				}
				else {
					console.log('killed rogue processes with the following pids:');
					for(var i=0; i<rogue_pids.length; i++) {
						console.log(rogue_pids[i]);
					}
				}
			});
		}
	};
	
	var proc = exec('ps -eo ppid,pid,etimes,command | grep phantomjs', function(err, stdout, stderr) {
		stdout
		if(err !== null) {
			console.log('ERROR FETCHING PHANTOM PROCS');
			console.log(err);
		}
		else {
			return exec_cb(stdout);
		}
	});
	
	
	
}
// Will iterate through the MF_Eddie instances and determine if an instance has exceeded its time limit.
function start(self) {
    interval = setInterval(function() {
        var count = 0;
        var key_string = '';
        var tracked_pids = new Array();
        for (var key in self.instances) {
			tracked_pids.push(parseInt(key));
            var start_time = self.instances[key].time;
            var current_time = (new Date).getTime() / 1000;
            var diff = current_time - start_time;
            var killed = false;
            if (diff > PROCESS_TIMEOUT_SECONDS) {
                var obj = self.instances[key];
                var m = obj['m'];
                if (m) {
                    m.exit_phantom(function() {
                        delete self.instances[key];
                        killed = true;
                    });
                }
            }
            if (!killed) {
                count++;
                key_string += key + ', ';
            }
        }
        if (count > 0) {
            mf_log.log('There are ' + count + ' instances running with these PIDs:');
            mf_log.log(key_string);
        }
        phantom_procs(tracked_pids);
    }, STATUS_INTERVAL);
}

// Add an MF_Eddie instance to the array
MF_Instances.prototype.push_instance = function(m, cb) {
    var pid = m.ph.process.pid;
    mf_log.log("Creating browser instance with phantom pid " + pid);
    var epoch = (new Date).getTime() / 1000;
    this.instances[pid] = {
        m: m,
        time: epoch
    };
    return cb(false, pid);
}

// Get an MF_Eddie instance
MF_Instances.prototype.get_instance = function(pid, cb) {
    if (this.instances[pid]) {
        return cb(false, this.instances[pid].m);
    }

    var err = {
        status: "Error",
        message: "Unable to get phantom instance with process id " + pid
    };
    mf_log.log('Error fetching instance: ' + err.message);
    return cb(JSON.stringify(err));
}

MF_Instances.prototype.delete_instance = function(pid, cb) {
    if (!this.instances[pid]) {
        mf_log.log("Error while deleting phantom process " + pid + ': process not found');
        return cb('No pid found');
    }
    var exit_cb = function() {
        delete this.instances[pid];
        return cb(false, true);
    }.bind(this);
    var m = this.instances[pid].m;
    if (m) {
        mf_log.log("Deleting browser instance with phantom pid " + pid);
        return m.exit_phantom(exit_cb);
    }
}

MF_Instances.prototype.get_instance_count = function() {
    var count = 0;
    for (var key in this.instances)
        count++;
    return count;

}

// Will update the time of a browser instance, effectively resetting its timeout to PROCESS_TIMEOUT_SECONDS
MF_Instances.prototype.update_timeout = function(pid, cb) {
    var m = this.instances[pid];
    if (m) {
        mf_log.log("Updating timeout for browser instance with phantom pid " + pid);
        var current_time = (new Date).getTime() / 1000;
        this.instances[pid].time = current_time;
    }
    return cb();
}
module.exports = MF_Instances;
