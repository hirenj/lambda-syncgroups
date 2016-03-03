var AWS = require('aws-sdk');
var sqs = new AWS.SQS({region:'us-east-1'});

require('es6-promise').polyfill();

var sqs_get_queue = function(queue) {
  return new Promise(function(resolve,reject) {
    sqs.getQueueUrl({'QueueName' : queue },function(err,result) {
      if (err) {
        throw err;
      }
      resolve(result.QueueUrl);
    });
  });
};

var sqs_create_queue = function(queue,timeout) {
  return new Promise(function(resolve,reject) {
    var queue_details = { 'QueueName' : queue,
                          'Attributes' : {
                            'VisibilityTimeout' : (timeout || 300)+''
                          }
                        };
    sqs.createQueue(queue_details,function(err,result) {
      if (err) {
        throw err;
      }
      resolve(result.QueueUrl);
    });
  });
};

var sqs_send_message = function(queueUrl, message) {
  return new Promise(function(resolve,reject) {
    sqs.sendMessage({'QueueUrl' : queueUrl , 'MessageBody' : JSON.stringify(message) },function(err,done) {
      if (err) {
        throw err;
      }
      resolve(done);
    });
  });
};

var sqs_get_active_messages = function(queueUrl) {
  var params = {'QueueUrl' : queueUrl,
                'AttributeNames' : ['ApproximateNumberOfMessagesNotVisible']
              };
  return new Promise(function(resolve,reject) {
    sqs.getQueueAttributes(params,function(err,data) {
      if (err) {
        throw err;
      }
      resolve(parseInt(data.Attributes['ApproximateNumberOfMessagesNotVisible']));
    });
  });
};

var sqs_receive_messages = function(queueUrl,number) {
  var params = {'QueueUrl' : queueUrl , 'MaxNumberOfMessages': number };
  return new Promise(function(resolve) {
    sqs.receiveMessage(params,function(err,data) {
      (data.Messages || []).forEach(function(message) {
        message.finalise = function() {
          return sqs_delete_message(queueUrl, message.ReceiptHandle );
        };
        message.unshift = function() {
          return sqs_reset_timeout(queueUrl, message.ReceiptHandle );
        };
      });
      resolve(data.Messages || []);
    });
  });
};

var sqs_delete_message = function(queueUrl,receiptHandle) {
  var params = {'QueueUrl' : queueUrl, 'ReceiptHandle' : receiptHandle };
  return new Promise(function(resolve) {
    sqs.deleteMessage(params,function(err,data) {
      if (err) {
        throw err;
      }
      resolve(data);
    });
  });
};

var sqs_reset_timeout = function(queueUrl,receiptHandle) {
  var params = {'QueueUrl' : queueUrl, 'ReceiptHandle' : receiptHandle, 'VisibilityTimeout' : '0' };
  return new Promise(function(resolve) {
    sqs.changeMessageVisibility(params,function(err,data) {
      if (err) {
        console.error(err);
        console.error(err.stack);
        throw err;
      }
      resolve(data);
    });
  });
};

var Queue = function Queue(name) {
  this.name = name;
};

Queue.prototype.ensureQueue = function ensureQueue(queue) {
  if (this.queue) {
    return this.queue;
  }
  sqs_get_queue(queue).then(function(queueUrl) {
    if (! queueUrl ) {
      return sqs_create_queue(queue);
    }
    return queueUrl;
  });
};

Queue.prototype.getQueue = function getQueue(queue) {
  if (this.queue) {
    return this.queue;
  }
  this.queue = sqs_get_queue(queue);
  return this.queue;
};

Queue.prototype.sendMessage = function sendMessage(message) {
  return this.getQueue(this.name).then(function(queueUrl) {
    return sqs_send_message(queueUrl,message);
  });
};

Queue.prototype.getActiveMessages = function getActiveMessages() {
  return this.getQueue(this.name).then(function(queueUrl) {
    return sqs_get_active_messages(queueUrl);
  });
};

Queue.prototype.shift = function shift(number) {
  return this.getQueue(this.name).then(function(queueUrl) {
    return sqs_receive_messages(queueUrl,number);
  });
};

Queue.prototype.finalise = function finalise(receiptHandle) {
  return this.getQueue(this.name).then(function(queueUrl) {
    return sqs_delete_message(queueUrl, message.ReceiptHandle );
  });
};

Queue.prototype.finalise = function finalise(receiptHandle) {
  return this.getQueue(this.name).then(function(queueUrl) {
    return sqs_reset_timeout(queueUrl, receiptHandle );
  });
};


exports.queue = Queue;