var fs = require('fs');

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

  delete encryptedSecret.store;
  delete encryptedSecret.KeyId;
  encryptedSecret.CiphertextBlob = new Buffer(encryptedSecret.CiphertextBlob, 'base64');

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