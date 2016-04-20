var https = require('https');
var querystring = require('querystring');
require('es6-promise').polyfill();


var Queue = require('./queue').queue;
var google = require('./google');

var grants_table = 'grants';
var download_topic = 'download';
var download_queue = 'DownloadQueue';

try {
    var config = require('./resources.conf.json');
    grants_table = config.tables.grants;
    download_topic = config.queue.DownloadTopic;
    download_queue = config.queue.DownloadQueue;
    downloadEverythingName = config.functions.downloadEverything;
    downloadFilesName = config.functions.downloadFiles;
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

var download_files_group = function(group) {
  return google.getFiles(group);
};

var download_changed_files = function(page_token) {
  return google.getChangedFiles(page_token);
};

var update_page_token = function(page_token,arn) {
  console.log("Writing page token ",page_token);
  return ;
};

exports.acceptWebhook = function acceptWebhook(event,context) {
  var exp_date = new Date(new Date().getTime() + 2*60*1000);
  // We want to use the setTimeout technique here to coalesce
  // any subsequent calls to the webhook and do a primitive
  // rate limiting
  require('./events').setTimeout('GoogleDownloadFiles',exp_date).then(function(new_rule) {
    if (! new_rule) {
      return;
    }
    return require('./events').subscribe('GoogleDownloadFiles',context.invokedFunctionArn.replace(/function:.*/,'function:')+downloadEverythingName,{'page_token' : 'none'});
  }).catch(function(err) {
    console.error(err,err.stack);
  }).then(function() {
    context.succeed('Done');
  });
};

// Permissions: Roles downloadQueueSource / keyDecrypter
//   - KMS decrypt
//   - SQS sendMessage

// Needs permission to run from cloudwatch event
exports.downloadEverything = function downloadEverything(event,context) {
  if (! context || context.awsRequestId == 'LAMBDA_INVOKE') {
    require('./secrets').use_kms = false;
  }
  console.log("downloadEverything");
  console.log(event);

  var group = event.groupid;
  var token = event.page_token;

  if ( ! group && ! token ) {
    context.succeed('Done');
    return;
  }

  var queue = new Queue(download_queue);
  var download_promise = Promise.resolve(true);

  if (group) {
    download_promise = download_files_group(group);
  } else if (token) {
    download_promise = download_changed_files(token).then(function(fileinfos) {
      // Re-subscribe self using the new page token as the state
      return require('./events').subscribe("GoogleDownloadFiles",context.invokedFunctionArn,{page_token:fileinfos.token}).then(function() {
        return fileinfos.files;
      });
    });
  }

  // Push all the shared files into the queue
  download_promise.then(function(files) {
    files = files.splice(0,1);
    console.log("Files to download ",files);
    // We should increase the frequency the download daemon runs here

    return Promise.all(files.map(function(file) {
      return queue.sendMessage({'id' : file.id, 'group' : file.group, 'name' : file.name, 'md5' : file.md5Checksum });
    })).then(function() {
      // Register the downloadFiles daemon
      require('./events').setInterval('DownloadFilesDaemon','3 minutes').then(function(new_rule) {
        if (new_rule) {
          require('./events').subscribe('DownloadFilesDaemon',context.invokedFunctionArn.replace(/function:.*/,'function:')+downloadFilesName,{'no_messages' : 0});
        }
      });
    });
  }).then(function() {
    context.succeed('Done');
  }).catch(function(err) {
    console.error(err,err.stack);
    context.succeed('Done');
  });
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
  var total_messages = -1;
  var active = queue.getActiveMessages().then(function(counts) {
    var active_count = counts[0];
    total_messages = counts[1];
    var diff = 5 - active_count;
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
    var next_promise = Promise.resolve(true);
    if (total_messages < 1) {
      throw new Error('No messages');
    } else {
      next_promise = require('./events').subscribe('DownloadFilesDaemon', context.invokedFunctionArn, {'no_messages': 0 } );
    }
    return next_promise.then(function() {
      return queue.shift(count);
    });
  }).then(function(messages) {
    return Promise.all(messages.map(function(message) {
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
      return require('./lib/snish').publish(sns_params).then(function() {
        console.log("Triggered download");
      }).catch(function(err) {
        console.log("Didnt trigger download");
        console.error(err);
        console.error(err.stack);
        message.unshift();
      });
    }));
  }).catch(function(err) {
    if (err.message === 'No messages') {
      console.log("No messages");
      if (event.no_messages >= 5) {
        console.log("Disabling downloadFiles daemon");
        return require('./events').setTimeout('DownloadFilesDaemon',new Date(1000));
      } else {
        console.log("Incrementing no messages counter to ",(event.no_messages || 0) + 1);
        return require('./events').subscribe('DownloadFilesDaemon',context.invokedFunctionArn,{'no_messages':(event.no_messages || 0) + 1});
      }
    } else {
      console.error(err);
      console.error(err.stack);
    }
  }).then(function() {
    context.succeed('Ran downloadFiles');
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

var promisify = function(aws) {
  aws.Request.prototype.promise = function() {
    return new Promise(function(accept, reject) {
      this.on('complete', function(response) {
        if (response.error) {
          reject(response.error);
        } else {
          accept(response);
        }
      });
      this.send();
    }.bind(this));
  };
};

/*
  subscribeWebhook -> run again 5 minutes before expiration time for hook
  change -> set rule to run once 3 minutes from now
  downloadEverything -> set change_state (i.e. the target for downloadEverything) to current state
*/

exports.subscribeWebhook = function(event,context) {
  console.log(event);
/*
Bootstrap the watching by passing the baseUrl to the function
Add a feature variable somewhere that we can pause the
re-subscription with
*/

  if ( ! event.base_url) {
    console.log("No base url, returning");
    context.succeed('Done');
    return;
  }
  var removed_last_hook = Promise.resolve(false);

  // event.last_hook and event.last_hook.expiration in next 5 minutes, renew hook.

  if (event.last_hook && parseInt(event.last_hook.expiration) <= ((new Date()).getTime() + (5*60*1000)) ) {
    event.last_hook.address = event.base_url+'/hook';
    removed_last_hook = google.removeHook(event.last_hook);
  } else {
    console.log("No need to remove and re-init webhook");
  }

  // We should list targets here and extract out the current pageToken
  // associated with the downloadEverything method

  removed_last_hook.then(function(removed) {
    if ( ! removed && event.last_hook ) {
      console.log("Not removed, and have a last hook. No need to change events");
      return Promise.resolve(event.last_hook);
    }
    console.log("Registering hook");
    return google.registerHook(event.base_url+'/hook');
  }).then(function(hook) {
    console.log("Checking if we want to subscribe");
    if ( ! event.base_url ) {
      return true;
    }
    var last_hook = hook;

    var exp_date = new Date(parseInt(last_hook.expiration)-5*60*1000);

    var change_state = {
      'base_url' : event.base_url,
      'last_hook' : last_hook,
      'page_token' : last_hook.page_token
    };
    require('./events').setTimeout('GoogleWebhookWatcher',exp_date).then(function() {
      // We don't clobber the targets if
      // this is just a rescheduling
      if (event.last_hook === hook) {
        console.log("Skipping target setting as we are simply rescheduling");
        return Promise.resolve(true);
      }
      require('./events').subscribe('GoogleWebhookWatcher',context.invokedFunctionArn,change_state);
    });
  }).then(function() {
    context.succeed('Done');
  }).catch(function(err) {
    console.log(err,err.stack);
    context.succeed("Done");
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
  if (! context || context.awsRequestId == 'LAMBDA_INVOKE') {
    require('./secrets').use_kms = false;
  }
  google.getGroups().then(function(grants) {
    return require('./grants').putGrants(grants_table,grants);
  }).then(function() {
    require('./events').setInterval('PopulateGroupGrants','1 hour').then(function(new_rule) {
      if (new_rule) {
        require('./events').subscribe('PopulateGroupGrants',context.invokedFunctionArn,{});
      }
    });
  }).catch(function(err) {
    console.error(err);
    console.error(err.stack);
  }).then(function() {
    context.succeed('Synchronised group memberships with grants');
  });

};