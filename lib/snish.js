
var EventEmitter = require('events');
var util = require('util');

function MyEmitter() {
  EventEmitter.call(this);
};

util.inherits(MyEmitter, EventEmitter);

var myEmitter = new MyEmitter();


var subscribe = function subscribe(params,cb) {
	myEmitter.on(params.TopicArn,cb);
};

var publish = function publish(params,callback) {
	myEmitter.emit(params.TopicArn,{'Records' : [{'Message' : params.Message }]});
};

// exports.subscribe = subscribe;
// exports.createTopic;

exports.publish = publish;