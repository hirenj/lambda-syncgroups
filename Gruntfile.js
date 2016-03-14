/**
 * Grunt Uploader for Lambda scripts
 * Updated from original by Chris Moyer <cmoyer@aci.info>
 */
'use strict';
module.exports = function(grunt) {
	require('load-grunt-tasks')(grunt);

	var path = require('path');
	grunt.initConfig({
		lambda_invoke: {
			default: {
				package: 'syncgroups',
				options: {
					file_name: 'index.js',
					handler: 'populateGroupGrants',
					event: 'event.json',
				},
			},
		},
		lambda_deploy: {
			default: {
				package: 'syncgroups',
				options: {
					file_name: 'index.js',
					handler: 'populateGroupGrants',
				},
				function: "populateGroupGrants",
				arn: null,
			},
			downloadFile: {
				package: 'syncgroups',
				options: {
					file_name: 'index.js',
					handler: 'index.downloadFile',
				},
				function: 'downloadFile',
				arn: null,
			}
		},
		lambda_package: {
			default: {
				package: 'syncgroups',
			},
			downloadFile: {
				package: 'syncgroups',
			}
		},
		env: {
			prod: {
				NODE_ENV: 'production',
			},
		},

	});

	grunt.registerTask('encrypt-secrets-local','Encrypt secrets',function() {
		var kmish = require('./lib/kmish');
		var fs = require('fs');
		kmish.encrypt({ 'PlainText' : fs.readFileSync('creds.json','utf8') },function(err,encrypted) {
			fs.writeFileSync('creds.kmish.json.encrypted',JSON.stringify( { 'store' : 'kmish', 'CiphertextBlob' : encrypted } ));
		});
	});

	grunt.registerTask('reencrypt-secrets-aws','Re-encrypt secrets for AWS',function() {
		var done = this.async();
		var keyId = 'alias/default';
		var secrets = require('./secrets');
		var fs = require('fs');
		secrets.use_kms = false;
		secrets.getSecret().then(function(secret) {
			var KMS = require('aws-sdk').KMS;
			var kms = new KMS({region:'us-east-1'});
			kms.encrypt({ 'Plaintext' : secret , 'KeyId' : keyId },function(err,encrypted) {
				if (err) {
					throw err;
				}
				fs.writeFileSync('creds.kms.json.encrypted',JSON.stringify( { 'store' : 'kms', 'KeyId' : encrypted.KeyId, 'CiphertextBlob' : encrypted.CiphertextBlob.toString('base64') } ));
				secrets.use_kms = true;
				secrets.getSecret().then(function(new_secret) {
					console.log(JSON.parse(new_secret).client_email == new_secret);
					done();
				}).catch(function(err) {
					console.log(err,err.stack);
					done();
				});
			});
		}).catch(function(err) {
			console.log(err);
			console.log(err.stack);
			done();
		});
	});

	grunt.registerTask('encrypt-secrets-aws','Encrypt secrets',function(keyId) {
		var AWS = require('aws-sdk');
		var kms = new AWS.KMS({region:'us-east-1'});
		var keyId = 'alias/default';
		var fs = require('fs');
		kms.encrypt({ 'Plaintext' : fs.readFileSync('creds.json','utf8'), 'KeyId' : keyId },function(err,encrypted) {
			if (err) {
				throw err;
			}
			fs.writeFileSync('creds.kms.json.encrypted',JSON.stringify( { 'store' : 'kms', 'CiphertextBlob' : encrypted } ));
		});
	});
	grunt.registerTask('deploy:downloadFile', ['env:prod', 'lambda_package:downloadFile', 'lambda_deploy:downloadFile']);
	grunt.registerTask('deploy', ['env:prod', 'lambda_package', 'lambda_deploy']);
	grunt.registerTask('test', ['lambda_invoke']);
};
