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
    for (var i = 0; i < b.length; i++) {
        hash[b[i]] = 1;
    }

    for (var i = 0; i < a.length; i++) {
        delete hash[a[i]];
    }

    var c = new Array();
    var i = 0;
    for (var n in hash) {
        c[i++] = n;
    }

    return c;
}

/* 
 * Probes and identifies the system for rogue processes that may 
 * have spawned and kills them.  Does this by making a ps system call 
 * and parses STDOUT.
 * ps -eo ppid,pid,etime,command | grep phantomjs
 * */
function phantom_procs(tracked_pids) {
    // NodeJS process running
    var node_pid = process.pid;
    
    var lines = new Array();
    var system_pids = new Array();
    var rogue_pids = new Array();

    // exec callback, takes system call's stdout
    var exec_cb = function(so) {
		
		//console.log(so);
        lines = so.split(/\r?\n/g);
        
        for (var i = 0; i < lines.length; i++) {
            // matching for words and also elapsed time of process
            // pid ppid etime cmd_start ...
            //  42 1234 00;49 phantomjs  ...)
            var line_data = lines[i].match(/^\s*?(\w+)\s+(\w+)\s+(\w+\:\w+\:?\w+?)\s+(\w+)/);
            
            if (line_data === null) continue;
            // Get parent process id
            var ppid = parseInt(line_data[1]);
            console.log('PPID? ' + ppid);
            // Get phantom process id
            var pid = parseInt(line_data[2]);
            // Get elapsed time, reverse order of numbers.
            var etime = line_data[3].split(':').reverse();
            // Add an hours placeholder if it is needed.
            //console.log('etime array: ' + etime);
            while (etime.length < 3) {
                etime.push(0);
            }
            // Determine # of seconds the process has been running
            etime = (etime[0] * 1) + (etime[1] * 60) + (etime[2] * 60);
            
            var cmd_start = line_data[4];
            
            
            console.log('pid: ' + pid + ' ppid: ' + ppid + ' cmd: ' + cmd_start + ' etime: ' + etime);
            // 1. Is a phantomjs proc
            // 2. Has been running for at least one minute
            if (cmd_start === 'phantomjs' && etime > 60) {
                // parent process id is this nodejs process
                // OR the process was orphaned
                if (ppid === node_pid || ppid === 1) {
                    // push to array of possible rogue procs
                    system_pids.push(pid);
                }
                else {
					console.log(pid + " IS NOT A PID WE'RE CONCERNED WITH BECAUSE:");
					console.log(ppid + " !=1 and " + ppid + " != " + node_pid);
					console.log('pid: ' + pid + ' ppid: ' + ppid + ' cmd: ' + cmd_start + ' etime: ' + etime);
				}
            }

        }
        

        if (system_pids.length > 0) {
            mf_log.log('tracked pids:');
            mf_log.log(tracked_pids);
            mf_log.log('possible rogue:');
            mf_log.log(system_pids);
        }
        
        // if you need to brush up on your discrete math:
        // https://en.wikipedia.org/wiki/Complement_%28set_theory%29
        rogue_pids = relative_compliment(tracked_pids, system_pids);
        if (rogue_pids !== 'undefined' && rogue_pids.length > 0) {
            mf_log.log('Confirmed rogue processes:');
            mf_log.log(rogue_pids);
        }
        
        


        if (rogue_pids !== null && rogue_pids.length > 0) {
            exec('kill ' + rogue_pids.join(' '), function(err, so, se) {
                if (err !== null) {
                    mf_log.log('Error occurred while trying to kill rogue processes:');
                    mf_log.log(err);
                } else {
                    mf_log.log('successfully killed all rogue processes.');
                }
            });
        }
    };

    var proc = exec('ps -eo ppid,pid,etime,command | grep phantomjs', function(err, stdout, stderr) {
        if (err !== null) {
            mf_log.log('Error while probing phantomjs processes:');
            mf_log.log(err);
        } else {
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
