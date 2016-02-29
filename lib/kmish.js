var keytar = require('keytar');

var crypto = require('crypto');

require('es6-promise').polyfill();

var algorithm = 'aes-256-ctr';

var encrypt = function encrypt(buffer,password){
	var cipher = crypto.createCipher(algorithm,password)
	var crypted = Buffer.concat([cipher.update(buffer),cipher.final()]);
	return crypted;
}
 
var decrypt = function decrypt(buffer,password){
	var decipher = crypto.createDecipher(algorithm,password)
	var dec = Buffer.concat([decipher.update(buffer) , decipher.final()]);
	return dec;
}

/** Sync */
var make_password = function make_password(size) {
	return new Promise(function(resolve,reject) {
		var buf = crypto.randomBytes(size);
		resolve(buf.toString('base64'));
	});
};

var get_main_password = function(callback) {
	var master_pass = keytar.getPassword('kmish','master');
	if (! master_pass) {
		return make_password(30).then(function(token) {
			keytar.addPassword('kmish','master',token);
		}).then(get_main_password);
	}
	return new Promise(function(resolve,reject) {
		resolve(master_pass);
	});
};

var decrypt_data = function decrypt_data(params,callback) {
	var data_string = params.CiphertextBlob;
	var data = JSON.parse((new Buffer(data_string,'base64')).toString());
	get_main_password().then(function(password) {
		var unwrapped_key = decrypt(new Buffer(data.key,"base64"),password).toString('base64');
		var unencrypted = decrypt(new Buffer(data.data,"base64"),unwrapped_key).toString('utf8');
		callback(null,{
			'KeyId' : 'Some Key',
			'Plaintext' : unencrypted
		});
	}).catch(function(err) {
		console.error(err);
		console.log(err.stack);
		callback(error);		
	});
};

var encrypt_data = function encrypt_data(params,callback) {
	var data_string = params.PlainText;
	get_main_password().then(function(password) {
		return make_password(30).then(function(unwrapped_key) {
			var encrypted_data = encrypt(new Buffer(data_string,'utf8'),unwrapped_key).toString('base64');
			var encrypted_key = encrypt(new Buffer(unwrapped_key,'base64'),password).toString('base64');
			var data = new Buffer(JSON.stringify({'key' : encrypted_key, 'data' : encrypted_data })).toString('base64');
			callback(null,data);
		});
	}).catch(function(err){
		console.error(err);
		console.log(err.stack);
		callback(error);
	});
};


exports.decrypt = decrypt_data;
exports.encrypt = encrypt_data;