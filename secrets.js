var fs = require('fs');

require('es6-promise').polyfill();

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

var getSecretKmsLocal = function getSecretKmsLocal(filename) {
  return new Promise(function(resolve,reject) {
    fs.readFile(filename,function(err,data) {
      if (err) {
        reject(err);
        return;
      }
      resolve(JSON.parse(data));
    });
  });
};

var getSecretS3 = function getSecretS3() {
  var AWS = require('aws-sdk');
  promisify(AWS);

  var s3 = new AWS.S3({region:'us-east-1'});
  var bucket = 'test-gator';
  var params = {
    Bucket: bucket,
    Key: 'conf/creds.kms.json.encrypted'
  };
  return s3.getObject(params).promise().then(function(result) {
    return JSON.parse(result.data.Body.toString());
  });
};

var getEncryptedSecret = function getEncryptedSecret() {
  var AWS = require('aws-sdk');
  promisify(AWS);
  var kms = new AWS.KMS({region:'us-east-1'});

  var secretPath = './creds.kms.json.encrypted';
  return getSecretKmsLocal(secretPath).catch(function(err) {
    console.log("No bundled KMS credentials, checking on S3");
    return getSecretS3();
  }).then(function(encryptedSecret) {
    if ( ! encryptedSecret.store == 'kms') {
      throw new Error("Not a kms encrypted secret");
    }

    delete encryptedSecret.store;
    delete encryptedSecret.KeyId;
    encryptedSecret.CiphertextBlob = new Buffer(encryptedSecret.CiphertextBlob, 'base64');
    return kms.decrypt(encryptedSecret).promise();
  }).then(function(data) {
    var decryptedSecret = data.data['Plaintext'].toString();
    return decryptedSecret;
  });
};

var readLocalSecret = function readLocalSecret() {
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
};

exports.use_kms = true;

exports.getSecret = function getSecret() {
	if ( exports.use_kms ) {
		return getEncryptedSecret();
	}
	return readLocalSecret();
};