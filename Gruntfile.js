/**
 * Grunt Uploader for Lambda scripts
 * Updated from original by Chris Moyer <cmoyer@aci.info>
 */
'use strict';
module.exports = function(grunt) {
	require('load-grunt-tasks')(grunt);

	var path = require('path');

	var config = {'functions' : {} };
	try {
		config = require('./resources.conf.json');
	} catch (e) {
	}

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
			populateGroupGrants: {
				package: 'syncgroups',
				options: {
					file_name: 'index.js',
					handler: 'index.populateGroupGrants',
					region: config.region,
				},
				function: config.functions['populateGroupGrants'] || 'populateGroupGrants',
				arn: null,
			},
			downloadFile: {
				package: 'syncgroups',
				options: {
					file_name: 'index.js',
					handler: 'index.downloadFile',
					region: config.region,
				},
				function: config.functions['downloadFile'] || 'downloadFile',
				arn: null,
			},
			downloadFiles: {
				package: 'syncgroups',
				options: {
					file_name: 'index.js',
					handler: 'index.downloadFiles',
					region: config.region,
				},
				function: config.functions['downloadFiles'] || 'downloadFiles',
				arn: null,
			},
			downloadEverything: {
				package: 'syncgroups',
				options: {
					file_name: 'index.js',
					handler: 'index.downloadEverything',
					region: config.region,
				},
				function: config.functions['downloadEverything'] || 'downloadEverything',
				arn: null,
			},
			subscribeWebhook: {
				package: 'syncgroups',
				options: {
					file_name: 'index.js',
					handler: 'index.subscribeWebhook',
					region: config.region,
				},
				function: config.functions['subscribeWebhook'] || 'subscribeWebhook',
				arn: null,
			},
			acceptWebhook: {
				package: 'syncgroups',
				options: {
					file_name: 'index.js',
					handler: 'index.acceptWebhook',
					region: config.region,
				},
				function: config.functions['acceptWebhook'] || 'acceptWebhook',
				arn: null,
			},
		},
		lambda_package: {
			populateGroupGrants: {
				package: 'syncgroups',
			},
			downloadFile: {
				package: 'syncgroups',
			},
			downloadFiles: {
				package: 'syncgroups',
			},
			downloadEverything: {
				package: 'syncgroups',
			},
			subscribeWebhook: {
				package: 'syncgroups',
			},
			acceptWebhook: {
				package: 'syncgroups',
			}
		},
		env: {
			prod: {
				NODE_ENV: 'production',
			},
		},

	});

	grunt.registerTask('authorise','Populate authorisation',function() {
		var done = this.async();
		var google = require('googleapis');
		var fs = require('fs');
		var secret = JSON.parse(fs.readFileSync('creds.json','utf8'));
		var authClient = new google.auth.OAuth2(secret.installed.client_id,
												secret.installed.client_secret,
												'urn:ietf:wg:oauth:2.0:oob');
		var url = authClient.generateAuthUrl({
			access_type: 'offline',
			scope: [	"https://www.googleapis.com/auth/admin.directory.group.readonly",
						"https://www.googleapis.com/auth/admin.directory.group.member.readonly",
						"https://www.googleapis.com/auth/groups",
						"https://www.googleapis.com/auth/drive.readonly",
						"https://www.googleapis.com/auth/userinfo.email"]
		});
		console.log(url);
		var readlineSync = require('readline-sync');
		var authtoken = readlineSync.question('Enter authorisation token:');
		authClient.getToken(authtoken, function(err, tokens) {
			secret.installed.refresh_token = tokens.refresh_token;
			fs.writeFileSync('creds.json',JSON.stringify( secret ));
			done();
		});
	});

	grunt.registerTask('encrypt-secrets-local','Encrypt secrets',function() {
		var done = this.async();
		var kmish = require('lambda-helpers').kmish;
		var fs = require('fs');
		kmish.encrypt({ 'PlainText' : fs.readFileSync('creds.json','utf8') },function(err,encrypted) {
			fs.writeFileSync('creds.kmish.json.encrypted',JSON.stringify( { 'store' : 'kmish', 'CiphertextBlob' : encrypted } ));
			done();
		});
	});

	grunt.registerTask('reencrypt-secrets-aws','Re-encrypt secrets for AWS',function() {
		var done = this.async();
		var keyId = config.keys.authSecrets;
		var secrets = require('lambda-helpers').secrets;
		var fs = require('fs');
		secrets.use_kms = false;
		secrets.getSecret().then(function(secret) {
			require('lambda-helpers').AWS.setRegion(config.region);
			var KMS = require('lambda-helpers').AWS.KMS;
			var kms = new KMS();
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
		var AWS = require('lambda-helpers').AWS;
		var kms = new AWS.KMS();
		var keyId = config.keys.authSecrets;
		var fs = require('fs');
		kms.encrypt({ 'Plaintext' : fs.readFileSync('creds.json','utf8'), 'KeyId' : keyId },function(err,encrypted) {
			if (err) {
				throw err;
			}
			fs.writeFileSync('creds.kms.json.encrypted',JSON.stringify( { 'store' : 'kms', 'CiphertextBlob' : encrypted } ));
		});
	});

	grunt.registerTask('bootstrap' , ['authorise', 'encrypt-secrets-aws']);
	grunt.registerTask('deploy:populateGroupGrants', ['env:prod', 'lambda_package:populateGroupGrants', 'lambda_deploy:populateGroupGrants']);
	grunt.registerTask('deploy:downloadFile', ['env:prod', 'lambda_package:downloadFile', 'lambda_deploy:downloadFile']);
	grunt.registerTask('deploy:downloadFiles', ['env:prod', 'lambda_package:downloadFiles', 'lambda_deploy:downloadFiles']);
	grunt.registerTask('deploy:downloadEverything', ['env:prod', 'lambda_package:downloadEverything', 'lambda_deploy:downloadEverything']);
	grunt.registerTask('deploy:subscribeWebhook', ['env:prod', 'lambda_package:subscribeWebhook', 'lambda_deploy:subscribeWebhook']);
	grunt.registerTask('deploy:acceptWebhook', ['env:prod', 'lambda_package:acceptWebhook', 'lambda_deploy:acceptWebhook']);
	grunt.registerTask('deploy', ['env:prod', 'lambda_package', 'lambda_deploy']);
	grunt.registerTask('test', ['lambda_invoke']);
};
