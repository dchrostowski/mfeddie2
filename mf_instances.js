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
// Will iterate through the MF_Eddie instances and determine if an instance has exceeded its time limit.
function start(self) {
    interval = setInterval(function() {
        var count = 0;
        var key_string = '';
        for(var key in self.instances) {
            var start_time = self.instances[key].time;
            var current_time = (new Date).getTime()/1000;
            var diff = current_time - start_time;
            var killed = false;
            if(diff > PROCESS_TIMEOUT_SECONDS) {
                var obj = self.instances[key];
                var m = obj['m'];
                if(m) {
                    killed = true;
                    m.exit_phantom();
                }
                delete self.instances[key];
            }
            if(!killed) {
                count++;
                key_string += key + ', ';
            }
        }
        if(count > 0) {
            mf_log.log('There are ' + count + ' instances running with these PIDs:');
            mf_log.log(key_string );
        }
    }, STATUS_INTERVAL);
}

// Add an MF_Eddie instance to the array
MF_Instances.prototype.push_instance = function(m) {
    var pid = m.ph.process.pid;
    mf_log.log("Creating browser instance with phantom pid " + pid);
    var epoch = (new Date).getTime() / 1000;
    this.instances[pid] = {m: m, time: epoch};
    return [['Set-Cookie', 'pid='+pid]];
}

// Get an MF_Eddie instance
MF_Instances.prototype.get_instance = function(pid) {
    if(this.instances[pid]) return this.instances[pid].m;
    return false;
}

MF_Instances.prototype.delete_instance = function(pid, cb) {
    if(!this.instances[pid]) {
        return cb('No pid found');
    }
    var m = this.instances[pid].m;
    if(m) {
        mf_log.log("Deleting browser instance with phantom pid " + pid );
        m.exit_phantom();
    }
    delete this.instances[pid];

    if(cb && typeof cb == 'function')
        cb();
}

MF_Instances.prototype.get_instance_count = function() {
    var count = 0;
    for(var key in this.instances)
        count++;
    return count;

}

// Will update the time of a browser instance, effectively resetting its timeout to PROCESS_TIMEOUT_SECONDS
MF_Instances.prototype.update_timeout = function(pid) {
    var m = this.instances[pid];
    if(m) {
        mf_log.log("Updating timeout for browser instance with phantom pid " + pid);
        var current_time = (new Date).getTime()/1000;
        this.instances[pid].time = current_time;
        return;
    }
    return;
}


module.exports = MF_Instances;
