var AWS = require('aws-sdk');
var dynamo = new AWS.DynamoDB({region:'us-east-1'});
var s3 = new AWS.S3({region:'us-east-1'});

require('es6-promise').polyfill();

var table_promises = {};

var make_items = function(groupdata) {
	var groupid = groupdata.groupid;
	var grouptype = groupdata.type;
	var item = {};
	item.Name = {S:grouptype+groupid};
	item.valid_to = {N:'9007199254740991'};
	item.valid_from = {N:'0'};
	item.users = {SS:groupdata.members.map(function(user) { return user.id; })};
	item.grantee = {S:'system'};
	item.proteins = {S:'*'};
	item.datasets = {S:grouptype+groupid+'/*'};
	return {'PutRequest' : { 'Item': item } };
};

var put_grants = function(table,grants) {
	return Promise.resolve(true).then(function() {
		console.log("Got table");
		var params = {};
		params.RequestItems = {};
		params.RequestItems[table] = grants.map(make_items);
		return new Promise(function(resolve,reject) {
			dynamo.batchWriteItem(params, function(err, data) {
				if (err) {
					reject(err);
					return;
				}
				resolve(data);
			});
		});
	});
};

var write_grant_config = function(valid_groups,bucket) {
	var params = {
		Bucket: bucket,
		Key: 'conf/groupids',
		Body: JSON.stringify(valid_groups)
	};
	return new Promise(function(resolve,reject) {
		s3.upload(params,function(err,result) {
			if (err) {
				reject(err);
				return;
			}
			resolve(result);
		});
    });
};

exports.writeGrantConfig = write_grant_config;
exports.putGrants = put_grants;