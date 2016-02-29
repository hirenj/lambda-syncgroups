var jwt = require('jsonwebtoken');
var fs = require('fs');
var https = require('https');
var querystring = require('querystring');

var Queue = require('./queue');
var google = require('./google');

require('es6-promise').polyfill();

var getEncryptedSecret = function getEncryptedSecret() {
  var fs = require('fs');
  var AWS = require('aws-sdk');
  var kms = new AWS.KMS({region:'us-east-1'});

  var secretPath = './creds.kms.json.encrypted';
  var encryptedSecret = fs.readFileSync(secretPath);

  var encryptedSecret = JSON.parse(fs.readFileSync(secretPath));

  if ( ! encryptedSecret.store == 'kms') {
    throw new Error("Not a kms encrypted secret");
  }

  delete kms.store;

  return new Promise(function(resolve,reject) {
    kms.decrypt(encryptedSecret, function(err, data) {
      if (err) {
        console.log(err, err.stack);
        reject(err);
      } else {
        var decryptedSecret = data['Plaintext'].toString();
        resolve(decryptedSecret);
      }
    });
  });
};

var readLocalSecret = function readLocalSecret(callback) {
  var encryptedSecret = JSON.parse(fs.readFileSync('./creds.kmish.json.encrypted'));
  if ( ! encryptedSecret.store == 'kmish') {
    throw new Error("Not a kmish encrypted secret");
  }
  var kmish = require('./lib/kmish');
  return new Promise(function(resolve,reject) {
    kmish.decrypt(encryptedSecret,function(err,data) {
        var decryptedSecret = data['Plaintext'].toString();
        resolve(decryptedSecret);
    });
  });
  return Promise.resolve(datas.private_key);
};

exports.downloadEverything = function downloadEverything() {
  var queue = new Queue('DownloadQueue');
  queue.sendMessage({"foo" : "bar"})
  // Push all the shared files into the queue
}

exports.readChangedFiles = function sdfdsf() {
  // Push urls for each of the changed files into the pending queue along with an initial access token and max age
};

exports.updateQueueTokens = function blah() {
  // Update all tokens on the queue
}

// Every minute

exports.downloadFiles = function downloadFiles() {
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
    return queue.shift(count);
  }).then(function(messages) {
    return Promise.all(messages.map(function(message) { return message.finalise(); }));
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
    getEncryptedSecret = readLocalSecret;
  }
  var scopes = ["https://www.googleapis.com/auth/admin.directory.group.readonly","https://www.googleapis.com/auth/admin.directory.group.member.readonly"];

  obtainAuthToken(scopes.join(' ')).then(function(token) {
    var user = token.delegate;
    performGet("www.googleapis.com","/admin/directory/v1/groups",{ 'access_token' : token.access_token, 'userKey' : user }).then(function(data) {
        var data = JSON.parse(data);
        return (data.groups || []).map(function(group) {
          return group.email;
        });
    }).then(function(groups) {
      var results = [];
      var promises = groups.map(function(groupKey) {
        return performGet("www.googleapis.com","/admin/directory/v1/groups/"+groupKey+"/members",{ 'access_token' : token.access_token }).then(function(data) {
          var response = JSON.parse(data);
          var members_array = (response.members || []).map(function(member) {
            return { 'id' : member.id, 'email' : member.email };
          });
          return { 'group' : groupKey, 'members' : members_array };
        });
      });
      return Promise.all(promises);
    }).then(function(group_datas) {
      console.log(JSON.stringify(group_datas));
      return group_datas;
    }).catch(function(err) {
      console.error(err);
      console.error(err.stack);
    });

    // Write the json of group membership out to S3
  });
};