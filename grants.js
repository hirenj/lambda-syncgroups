'use strict';
/*jshint esversion: 6, node:true */

var AWS = require('lambda-helpers').AWS;
var dynamo = new AWS.DynamoDB();
var s3 = new AWS.S3();

var table_promises = {};

var make_items = function(groupdata) {
	var groupid = groupdata.groupid;
	var grouptype = groupdata.type;
	var item = {};
	item.Name = {S:grouptype+"-"+groupid};
	item.valid_to = {N:'9007199254740991'};
	item.valid_from = {N:'0'};
	item.users = {SS:groupdata.members.filter(user => user.email ).map( user => user.email.toLowerCase() )};
	item.superusers = {SS:groupdata.members.filter(user => user.email ).filter(user => user.role == 'superuser').map( user => user.email )};
	item.grantee = {S:'system'};
	item.proteins = {S:'*'};
	item.datasets = {S:grouptype+"-"+groupid+'/*'};
	if (item.users.SS.length == 0) {
		item.users.SS = ['none'];
	}
	if (item.superusers.SS.length == 0) {
		item.superusers.SS = ['none'];
	}
	return {'PutRequest' : { 'Item': item } };
};

var get_existing_google_grants = function(table) {
	var params = {
		TableName : table,
		ProjectionExpression : '#name',
		FilterExpression: "begins_with(#name,:prefix)",
		ExpressionAttributeNames:{
			"#name" : "Name"
		},
		ExpressionAttributeValues: {
			":prefix" : {S:"googlegroup-"}
		}
	};
	return new Promise(function(resolve,reject) {
		dynamo.scan(params,function(err,data) {
			if (err) {
				reject(err);
				return;
			}
			resolve((data.Items || []).map(function(item) { return item.Name['S'].replace(/^googlegroup-/,''); }));
		});
	});
};

var put_grants = function(table,grants) {
	return get_existing_google_grants(table).then(function(existing) {
		var toadd = grants.map(function(grant) { return grant.groupid; });
		existing.forEach(function(current) {
			if (toadd.indexOf(current) < 0) {
				console.log("Need to remove ",current);
				grants.push({ "groupid" : current, "type" : "googlegroup", "members" : [ {"id" : "none" } ] });
			}
		});
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
	console.log("Writing bucket config to ",bucket);
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

var read_grant_config = function(bucket) {
	var params = {
		Bucket: bucket,
		Key: 'conf/groupids'
	};
	return new Promise(function(resolve,reject) {
		s3.getObject(params,function(err,result) {
			if (err) {
				reject(err);
				return;
			}
			resolve(JSON.parse(result.Body.toString()));
		});
    });
};

exports.writeGrantConfig = write_grant_config;
exports.readGrantConfig = read_grant_config;
exports.putGrants = put_grants;