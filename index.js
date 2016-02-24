var jwt = require('jsonwebtoken');
var fs = require('fs');
var https = require('https');

//aws kms encrypt --key-id some_key_id --plaintext "This is the scret you want to encrypt" --query CiphertextBlob --output text | base64 -D > ./encrypted-secret

var getEncryptedSecret = function getEncryptedSecret(callback) {
  var fs = require('fs');
  var AWS = require('aws-sdk');
  var kms = new AWS.KMS({region:'eu-west-1'});

  var secretPath = './encrypted-secret';
  var encryptedSecret = fs.readFileSync(secretPath);

  var params = {
    CiphertextBlob: encryptedSecret
  };

  kms.decrypt(params, function(err, data) {
    if (err) {
      console.log(err, err.stack);
      callback(err);
    } else {
      var decryptedScret = data['Plaintext'].toString();
      callback(null,decryptedScret);
    }
  });
};

var obtainAuthToken = function obtainAuthToken(user,scope,callback) {
  var payload = {
    "iss":user,
    "scope":scope,
    "aud":"https://www.googleapis.com/oauth2/v4/token",
    "exp": (new Date()).getTime(),
    "iat": (new Date()).getTime()+5*60*1000;
  };
  getEncryptedSecret(function(cert) {
    jwt.sign(payload,cert,{'algorithm' : 'RS256' },function(token) {
      performPost('www.googleapis.com','/oauth2/v4/token',{
        "grant_type" : "urn:ietf:params:oauth:grant-type:jwt-bearer",
        "assertion" : token
      },function(err,body) {
        if ( ! err ) {
          return JSON.parse(body);
        }
      });
    });
  });
};

var performPost = function performPost(host,path,data,callback) {

    // Build the post string from an object
    var post_data = JSON.stringify(data);

    // An object of options to indicate where to post to
    var post_options = {
        "host": host,
        "port": '443',
        "path": path,
        "method": 'POST',
        "headers": {
            'Content-Type': 'application/json',
            'Content-Length': post_data.length
        }
    };

    var post_request = https.request(post_options, function(res) {
        var body = '';

        res.on('data', function(chunk)  {
            body += chunk;
        });

        res.on('end', function() {
            callback(null,body);
        });

        res.on('error', function(e) {
            console.log('error:' + e.message);
            callback(e);
        });
    });

    // post the data
    post_request.write(post_data);
    post_request.end();
};

exports.handler = function syncGappsGroups(event,context) {

  // Read list of groups that we wish to keep an eye on
  // from S3.

  obtainAuthToken("[Service account email]","https://www.googleapis.com/auth/admin.directory.group.readonly",function(token) {
    // Auth requests with token.access_token
    groups.forEach(function(groupKey) {
      // GET https://www.googleapis.com/admin/directory/v1/groups/ + groupKey + /members
      // response.members[0].id
    });

    // Write the json of group membership out to S3
  });
};