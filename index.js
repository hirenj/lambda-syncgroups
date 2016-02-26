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

var obtainAuthToken = function obtainAuthToken(scope,callback) {
  var payload = {
    "iss": "",
    "scope":scope,
    "aud": "https://www.googleapis.com/oauth2/v4/token",
    "exp": parseInt(((new Date()).getTime()+30*60*1000)/1000),
    "iat": parseInt((new Date()).getTime()/1000)
  };

  return getEncryptedSecret().then(function(secret) {
    secret = JSON.parse(secret);
    var cert = secret.private_key;
    payload.iss = secret.client_email;
    if (secret.delegate) {
      payload.sub = secret.delegate;
    }
    return new Promise(function(resolve,reject) {
      jwt.sign(payload,cert,{ 'algorithm' : 'RS256' },function(token) {
        var result = performPost('www.googleapis.com','/oauth2/v4/token',{
          "grant_type" : "urn:ietf:params:oauth:grant-type:jwt-bearer",
          "assertion" : token
        }).then(function(body) {
          var token = JSON.parse(body);
          if (payload.sub) {
            token.delegate = payload.sub;
          }
          return token;
        });
        resolve(result);
      });
    });
  });
};

var performGet = function performGet(host,path,data) {
  return performPost(host,path,data,"GET");
}

var performPost = function performPost(host,path,data,method) {
    var post_data = "";

    var post_options = {
        "host": host,
        "port": '443',
        "path": path,
        "method": method ? method : 'POST',
        "headers": {
        }
    };

    if (data.access_token) {
      post_options.headers['Authorization'] = 'Bearer ' + data.access_token;
      delete data.access_token;
    }

    // Build the post string from an object
    if (data) {
      post_data = querystring.stringify(data);
    }


    // An object of options to indicate where to post to

    if (method == 'GET' && post_data) {
      post_options.path = post_options.path + '?' + post_data;
    }
    if (! method && post_data) {
      post_options.headers['Content-Type'] = 'application/x-www-form-urlencoded'
      post_options.headers['Content-Length'] = post_data.length;
    }

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
      if (post_data && ! method ) {
        post_request.write(post_data);
      }
      post_request.end();
    });

    return result;
};

exports.handler = function syncGappsGroups(event,context) {
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
    }).catch(function(err) {
      console.error(err);
      console.error(err.stack);
    });

    // Write the json of group membership out to S3
  });
};