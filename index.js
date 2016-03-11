var https = require('https');
var querystring = require('querystring');
require('es6-promise').polyfill();


var Queue = require('./queue').queue;
var google = require('./google');


Promise.anyFailed = function(arrayOfPromises) {
  // For each promise that resolves or rejects,
  // make them all resolve.
  // Record which ones did resolve or reject
  var resolvingPromises = arrayOfPromises.map(function(promise) {
    return promise.then(function(result) {
      return {
        resolve: true,
        result: result
      };
    }, function(error) {
      return {
        resolve: false,
        result: error
      };
    });
  });

  return Promise.all(resolvingPromises).then(function(results) {
    // Count how many passed/failed
    var passed = [], failed = [], allPassed = true;
    results.forEach(function(result) {
      if(! result.resolve) {
        allPassed = false;
      }
      passed.push(result.resolve ? result.result : null);
      failed.push(result.resolve ? null : result.result);
    });

    if(! allPassed) {
      throw failed;
    } else {
      return passed;
    }
  });
};

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
    messages.forEach(function(message) {
      var file = JSON.parse(message.Body);
      console.log(file.id);
      var sns_message = JSON.stringify({
        'id' : file.id,
        'auth_token' : 'AUTH',
        'md5' : file.md5,
        'name' : file.name,
        'queueId' : message.ReceiptHandle
      });
      if (! require('./secrets').use_kms) {
        exports.downloadFile({'Records' : [{'Message' : sns_message }]});
      } else {
        // Send message to SNS
      }
    });
  }).catch(function(err) {
    console.error(err);
    console.error(err.stack);
  });
};

exports.downloadFile = function downloadFile(event,context) {
  // Download a single file to the group path given the access token
  // Remove from the downloading queue
  // Push back onto the pending queue if there is a failure
  var queue = new Queue('DownloadQueue');

  var file = JSON.parse(event.Records[0].Message);
  google.downloadFileIfNecessary(file).then(function() {
    console.log("Done downloading");
    console.log(file.id);
    return queue.finalise(file.queueId);
  }).catch(function(err) {
    console.error(err);
    console.error(err.stack);
    console.log("Unshifting job");
    return queue.unshift(file.queueId);
  }).then(function() {
    console.log("Done download worker");
  });

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