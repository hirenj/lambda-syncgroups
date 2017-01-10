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

  process.env['AWS_REGION'] = config.region;

  var self_funcs = Object.keys(require('./index')).filter( (func) => config.functions[func] );

  var config_options = {
    'git-describe': {
      options: {},
      default: {}
    },
    lambda_package: {
      common: {
        package: 'package'
      }
    },
    env: {
      prod: {
        NODE_ENV: 'production',
      },
    }

  };
  config_options['lambda_deploy'] = {};

  self_funcs.forEach( (funcname) => {
    config_options['lambda_deploy'][funcname] = {
        options: {
          file_name: 'index.js',
          handler: 'index.'+funcname,
          region: config.region,
        },
        function: config.functions[funcname] || funcname,
        arn: null,
    };
  });

  config_options['lambda_checkversion'] = config_options['lambda_setversion'] = config_options['lambda_package_targets'] = {};
  Object.keys(config_options['lambda_deploy']).forEach(function(targ) {
    config_options['lambda_checkversion'][targ] = true;
    config_options['lambda_setversion'][targ] = true;
    config_options['lambda_package_targets'][targ] = true;
  });

  grunt.initConfig(config_options);

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
		var kmish = require('lambda-helpers').getKmish();
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
		var done = this.async();
		var AWS = require('lambda-helpers').AWS;
		var kms = new AWS.KMS();
		var keyId = config.keys.authSecrets;
		var fs = require('fs');
		kms.encrypt({ 'Plaintext' : fs.readFileSync('creds.json','utf8'), 'KeyId' : keyId },function(err,encrypted) {
			if (err) {
				console.log(err);
				throw err;
			}
			fs.writeFileSync('creds.kms.json.encrypted',JSON.stringify( { 'store' : 'kms', 'KeyId' : encrypted.KeyId, 'CiphertextBlob' : encrypted.CiphertextBlob.toString('base64') } ));
			done();
		});
	});

	grunt.registerTask('bootstrap' , ['authorise', 'encrypt-secrets-aws']);



  grunt.registerTask('saveRevision', function() {

      var branch = 'none';
      var done = this.async();

      grunt.event.once('git-describe', function (rev) {
        grunt.option('gitRevision', branch+'-'+rev);
      });

      grunt.util.spawn({
        cmd: 'git',
        args: ['symbolic-ref','--short','HEAD']
      }, function (error, result) {
          if (error) {
            grunt.log.error([error]);
          }
          branch = result;
          grunt.task.run('git-describe');
          done();
      });

  });

  grunt.registerMultiTask('lambda_package_targets','Check for version of lambda function',function(){
    if ( ! grunt.option('packagepath') ) {
      grunt.option('packagepath',grunt.config('lambda_deploy.common.package'));
      grunt.config('lambda_deploy.common',null);
    }
    if (grunt.config('lambda_deploy.'+this.target)) {
      grunt.config('lambda_deploy.'+this.target+'.package',grunt.option('packagepath'));
    }
  });

  grunt.registerMultiTask('lambda_checkversion','Check for version of lambda function',function(){
    grunt.task.requires('git-describe');
    var done = this.async();
    var target = this.target;
    if ( ! grunt.config().lambda_deploy[target] ) {
      grunt.log.writeln("No arn");
      grunt.config('lambda_package.'+target,null);
      grunt.config('lambda_deploy.'+target,null);
      grunt.config('lambda_setversion.'+target,null);
      done();
      return;
    }
    var arn = grunt.config().lambda_deploy[target].function;
    var AWS = require('aws-sdk');
    var lambda = new AWS.Lambda();
    lambda.getFunctionConfiguration({FunctionName: arn},function(err,data) {
      var git_status = grunt.option('gitRevision');
      if (git_status.dirty) {
        grunt.log.writeln("Git repo is dirty, updating by default");
      } else {
        var current_version = data.Description;
        if (current_version === git_status.toString()) {
          grunt.config('lambda_package.'+target,null);
          grunt.config('lambda_deploy.'+target,null);
          grunt.config('lambda_setversion.'+target,null);
        }
      }
      done();
    });
  });

  grunt.registerMultiTask('lambda_setversion','Set version for lambda function',function(){
    grunt.task.requires('git-describe');
    var done = this.async();
    var target = this.target;
    if ( ! grunt.config().lambda_deploy[target] ) {
      grunt.log.writeln("No arn");
      done();
      return;
    }
    var arn = grunt.config().lambda_deploy[target].function;
    var AWS = require('aws-sdk');
    var lambda = new AWS.Lambda();
    grunt.log.writeln("Setting version for "+target+" to ",grunt.option('gitRevision').toString());
    lambda.updateFunctionConfiguration({FunctionName: arn,Description: grunt.option('gitRevision').toString() },function(err,data) {
      if ( ! err ) {
        done();
      } else {
        grunt.fail.fatal(err);
      }
    });
  });

  grunt.registerTask('versioncheck',['saveRevision']);

  grunt.registerTask('deploy', function(func) {
    var tasks = ['lambda_deploy','lambda_setversion'];
    func = (func ? (':' + func) : '');
    grunt.task.run( ['env:prod','versioncheck','lambda_checkversion'+func,'force:lambda_package','force:lambda_package_targets' ].concat(tasks.map( (task) => 'force:'+task+func) ));
  });

	grunt.registerTask('test', ['lambda_invoke']);
};
