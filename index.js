var https = require('https');
var querystring = require('querystring');
require('es6-promise').polyfill();


var Queue = require('./queue').queue;
var google = require('./google');

var grants_table = 'grants';
var download_topic = 'download';
var download_queue = 'DownloadQueue';

try {
    fs.accessSync('resources.conf.json', fs.F_OK);
    var config = require('./resources.conf.json');
    grants_table = config.tables.grants;
    download_topic = config.queue.download;
    download_queue = config.queue.DownloadQueue;
} catch (e) {
}


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
// Permissions: Roles downloadQueueSource / keyDecrypter
//   - KMS decrypt
//   - SQS sendMessage
exports.downloadEverything = function downloadEverything(event,context) {
  if (! context || context.awsRequestId == 'LAMBDA_INVOKE') {
    require('./secrets').use_kms = false;
  }
  var group = context.groupid;

  var queue = new Queue(download_queue);

  google.getFiles(group).then(function(files) {
    files = files.splice(0,1);
    return Promise.all(files.map(function(file) {
      return queue.sendMessage({'id' : file.id, 'group' : file.group, 'name' : file.name, 'md5' : file.md5Checksum });
    }));
  });
  // Push all the shared files into the queue
};

// Every minute
// Permissions: Roles keyDecrypter / downloadQueueConsumer
//   - SNS publish
//   - KMS decrypt
//   - SQS readMessage changeMessageVisbility

exports.downloadFiles = function downloadFiles(event,context) {
  console.log("Lambda downloadFiles execution");
  if (! context || context.awsRequestId == 'LAMBDA_INVOKE') {
    require('./secrets').use_kms = false;
  }

  var auth_data = null;

  var have_auth = google.getServiceAuth(["https://www.googleapis.com/auth/drive.readonly"]).then(function(auth) {
    auth_data = auth.credentials;
  });

  var queue = new Queue(download_queue);
  var active = queue.getActiveMessages().then(function(active) {
    var diff = 5 - active;
    if (diff < 0) {
      return 0;
    } else {
      return diff;
    }
  });


  active.then(have_auth).then(function(count) {
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
        'auth_token' : auth_data,
        'md5' : file.md5,
        'name' : file.name,
        'groupid' : file.group,
        'queueId' : message.ReceiptHandle
      });
      var sns_params = { 'topic': download_topic, 'Message' : sns_message };
      require('./lib/snish').publish(sns_params).then(function() {
        console.log("Triggered download");
      }).catch(function(err) {
        console.log("Didnt trigger download");
        console.error(err);
        console.error(err.stack);
        message.unshift();
      });
    });
  }).catch(function(err) {
    console.error(err);
    console.error(err.stack);
    message.unshift();
  });
};

// Permissions: Roles uploadsSource / downloadQueueConsumer
//   - SNS receive event source
//   - SQS deleteMessage changeMessageVisbility
//   - S3 put file / Read metadata
exports.downloadFile = function downloadFile(event,context) {
  console.log("Lambda downloadFile execution");
  // Download a single file to the group path given the access token
  // Remove from the downloading queue
  // Push back onto the pending queue if there is a failure
  var queue = new Queue(download_queue);
  var file = JSON.parse(event.Records[0].Sns.Message);
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
    context.succeed('Triggered download');
  });

};

// Subscribe the lambda functions to the appropriate sns topics
exports.subscribeNotifications = function subscribeNotifications(event,context) {
  var snish = require('./lib/snish');
  snish.use_aws = false;

  // TODO - get TopicArn from API config, or
  // from a config file
  snish.subscribe({ 'topic': download_topic, 'Protocol': 'https' },exports.downloadFile);

  // Do the download of files every minute
  setInterval(exports.downloadFiles,60);

  // Subscribe to S3 events from config-derived bucket / prefix
};

// Permissions: Roles keyDecrypter / updateGrants
//   - DynamoDb grants table put items
exports.populateGroupGrants = function populateGroupGrants(event,context) {
  console.log("Lambda syncGappsGroups execution");
  if (context.awsRequestId == 'LAMBDA_INVOKE') {
    require('./secrets').use_kms = false;
  }
  google.getGroups().then(function(grants) {
    return require('./grants').putGrants(grants_table,grants);
  }).catch(function(err) {
    console.error(err);
    console.error(err.stack);
  }).then(function() {
    context.succeed('Synchronised group memberships with grants');
  });

};