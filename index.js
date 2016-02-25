var jwt = require('jsonwebtoken');
var fs = require('fs');
var https = require('https');
var querystring = require('querystring');

require('es6-promise').polyfill();

//aws kms encrypt --key-id some_key_id --plaintext "This is the scret you want to encrypt" --query CiphertextBlob --output text | base64 -D > ./encrypted-secret

var getEncryptedSecret = function getEncryptedSecret() {
  var fs = require('fs');
  var AWS = require('aws-sdk');
  var kms = new AWS.KMS({region:'eu-west-1'});

  var secretPath = './encrypted-secret';
  var encryptedSecret = fs.readFileSync(secretPath);

  var params = {
    CiphertextBlob: encryptedSecret
  };
  return new Promise(function(resolve,reject) {
    kms.decrypt(params, function(err, data) {
      if (err) {
        console.log(err, err.stack);
        reject(err);
      } else {
        var decryptedScret = data['Plaintext'].toString();
        resolve(decryptedScret);
      }
    });
  });
};

var readLocalSecret = function readLocalSecret(callback) {
  var datas = require('./creds.json');
  console.log(datas.client_email);
  return Promise.resolve(datas.private_key);
};

var obtainAuthToken = function obtainAuthToken(user,scope,callback) {
  var payload = {
    "iss":user,
    "scope":scope,
    "aud": "https://www.googleapis.com/oauth2/v4/token",
    "sub": "[valid user]",
    "exp": parseInt(((new Date()).getTime()+30*60*1000)/1000),
    "iat": parseInt((new Date()).getTime()/1000)
  };

  return getEncryptedSecret().then(function(cert) {
    return new Promise(function(resolve,reject) {
      jwt.sign(payload,cert,{ 'algorithm' : 'RS256' },function(token) {
        var result = performPost('www.googleapis.com','/oauth2/v4/token',{
          "grant_type" : "urn:ietf:params:oauth:grant-type:jwt-bearer",
          "assertion" : token
        }).then(function(body) {
          console.log(body);
          return JSON.parse(body);
        });
        resolve(result);
      });
    });
  });
};

var performPost = function performPost(host,path,data) {
    // Build the post string from an object
    var post_data = querystring.stringify(data);

    // An object of options to indicate where to post to
    var post_options = {
        "host": host,
        "port": '443',
        "path": path,
        "method": 'POST',
        "headers": {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': post_data.length
        }
    };
    var result = new Promise(function(resolve,reject) {
      var post_request = https.request(post_options, function(res) {
          var body = '';

          res.on('data', function(chunk)  {
              body += chunk;
          });

          res.on('end', function() {
              resolve(body);
          });

          res.on('error', function(e) {
              console.log('error:' + e.message);
              reject(e);
          });
      });

      // post the data
      post_request.write(post_data);
      post_request.end();
    });

    return result;
};

exports.handler = function syncGappsGroups(event,context) {
  if (context.awsRequestId == 'LAMBDA_INVOKE') {
    getEncryptedSecret = readLocalSecret;
  }
  // Read list of groups that we wish to keep an eye on
  // from S3.

  obtainAuthToken("creds.json/client_email","https://www.googleapis.com/auth/admin.directory.group.readonly https://www.googleapis.com/auth/admin.directory.group.member.readonly").then(function(token) {
    // Auth requests with token.access_token
    groups.forEach(function(groupKey) {
      // GET https://www.googleapis.com/admin/directory/v1/groups/ + groupKey + /members
      // response.members[0].id
    });

    // Write the json of group membership out to S3
  });
};