
var EventEmitter = require('events').EventEmitter;
var util = require('util');

function LocalEmitter() {
  EventEmitter.call(this);
};

util.inherits(LocalEmitter, EventEmitter);

var myEmitter = new LocalEmitter();


var subscribe_local = function subscribe_local(params,cb) {
	myEmitter.on(params.topic,cb);
	return Promise.resolve(true);
};

var publish_local = function publish_local(params,callback) {
	myEmitter.emit(params.topic,{'Records' : [{'Sns' : { 'Message' : params.Message } }]});
	return Promise.resolve(true);
};

var topic_arns = {};

var sns_get_arn = function(params) {
	if (params.topic.match(/^arn:/)){
		return params.topic;
	}
	if (topic_arns[params.topic]) {
		return topic_arns[params.topic];
	}
	topic_arns[params.topic] = new Promise(function(resolve,reject) {
		var SNS = require('aws-sdk').SNS;
		var sns = new SNS({region:'us-east-1'});
		sns.listTopics(function(err,topicarns) {
			if (err) {
				reject(err);
				return;
			}
			var arns = topicarns.Topics.filter(function(arn) { return arn.TopicArn.split(':').reverse()[0] == params.topic; });
			resolve(arns[0].TopicArn);
		});
	});
	return topic_arns[params.topic];
}


var publish_sns = function(params,callback) {
	return sns_get_arn(params).then(function(arn) {
		params.TopicArn = arn;
		delete params.topic;
		var SNS = require('aws-sdk').SNS;
		var sns = new SNS({region:'us-east-1'});
		return new Promise(function(resolve,reject) {
			sns.publish(params,function(err,result) {
				if (err) {
					reject(err);
					return;
				}
				resolve(result);
			});
		});
	});
};

var subscribe = function subscribe(params) {
	if (! exports.use_aws) {
		return subscribe_local(params);
	}
};

var publish = function publish(params) {
	if (! exports.use_aws) {
		return publish_local(params);
	}
	return publish_sns(params);
};


exports.subscribe = subscribe;
exports.publish = publish;
exports.use_aws = true;