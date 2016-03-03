var https = require('https');
var querystring = require('querystring');
require('es6-promise').polyfill();


var Queue = require('./queue').queue;
var google = require('./google');

exports.downloadEverything = function downloadEverything(event,context) {
  if (! context || context.awsRequestId == 'LAMBDA_INVOKE') {
    require('./secrets').use_kms = false;
  }

  var queue = new Queue('DownloadQueue');

  google.getFiles("group-email@domain.com").then(function(files) {
    files = files.splice(0,3);
    return Promise.all(files.map(function(file) {
      return queue.sendMessage({'id' : file.id, 'group' : file.group, 'name' : file.name, 'md5' : file.md5Checksum });
    }));
  });
  // Push all the shared files into the queue
}

exports.readChangedFiles = function sdfdsf() {
  // Push urls for each of the changed files into the pending queue along with an initial access token and max age
};

exports.updateQueueTokens = function blah() {
  // Update all tokens on the queue
}

// Every minute

exports.downloadFiles = function downloadFiles(event,context) {
  if (! context || context.awsRequestId == 'LAMBDA_INVOKE') {
    require('./secrets').use_kms = false;
  }

  var queue = new Queue('DownloadQueue');
  var active = queue.getActiveMessages().then(function(active) {
    var diff = 5 - active;
    if (diff < 0) {
      return 0;
    } else {
      return diff;
    }
  });

  active.then(function(count) {
    if (count < 1) {
      throw new Error('Already maximum number of active downloads')
    }
    return queue.shift(count);
  }).then(function(messages) {
    return Promise.all(messages.map(function(message) {
      var file = JSON.parse(message.Body);
      console.log(file);
      return message;
    })).then(function() {
      return Promise.all( messages.map(function(message) { return message.finalise(); }) );
    });
  }).catch(function(err) {
    console.error(err);
    console.error(err.stack);
  });

  // Pop the first file in the queue

  // Read the permissions / metadata

  // If the first token is expired, trigger an updateQueueTokens

  // See if file has new checksum, and get the group it belongs to.
  // If good, publish this file + metadata onto the downloading SNS topic if the queue length <= 5
};

exports.downloadFile = function downloadFile() {
  // Download a single file to the group path given the access token
  // Remove from the downloading queue
  // Push back onto the pending queue if there is a failure
  // var params = {Bucket: 'bucket', Key: 'key', Body: stream};
  // s3.upload(params, function(err, data) {
  //   console.log(err, data);
  // });
}


exports.syncGappsGroups = function syncGappsGroups(event,context) {
  if (context.awsRequestId == 'LAMBDA_INVOKE') {
    require('./secrets').use_kms = false;
  }
  google.getGroups().then(function(group_datas) {
    console.log(JSON.stringify(group_datas));
    return group_datas;
  }).catch(function(err) {
    console.error(err);
    console.error(err.stack);
  });

};