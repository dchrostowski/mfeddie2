var fs = require('fs');
var config = require('config');
var log_file = config.log_file || 'default.log';
var log_std_out = config.get('log_std_out');
var log_date = config.get('log_date');

exports.log = function (str) {
    var date = '[' + new Date().toISOString() + ']: ';
    if(log_std_out) {
		if(log_date) console.log(date + str);
		else console.log(str);
	}
    fs.appendFile(log_file, date+str+"\n");
    return;
}
