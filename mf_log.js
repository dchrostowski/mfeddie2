var fs = require('fs');
var config = require('config');
var log_file = config.log_file || 'default.log';

exports.log = function (str) {
	var date = '[' + new Date().toISOString() + ']: ';
	console.log(date + str);
	return;
}
