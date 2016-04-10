var AWS = require('aws-sdk');
var dynamo = new AWS.DynamoDB({region:'us-east-1'});

require('es6-promise').polyfill();

var table_promises = {};

var get_table = function(table) {
	return Promise.resolve(table);
	if (table_promises[table]) {
		return table_promises[table];
	}
	table_promises[table] = new Promise(function(resolve,reject) {
		dynamo.listTables(function(err,data) {
			if (err) {
				throw err;
			}
			if (data.TableNames.indexOf(table) < 0) {
				resolve(create_table(table));
				return;
			}
			resolve(table);
		});
	});
	return table_promises[table];
};

var create_table = function(table) {
	var params = {
	    TableName : table,
	    KeySchema: [       
	        { AttributeName: "Name", KeyType: "HASH"},  //Partition key
	        { AttributeName: "valid_to", KeyType: "RANGE" }  //Sort key
	    ],
	    AttributeDefinitions: [       
	        { AttributeName: "Name", AttributeType: "S" },
	        { AttributeName: "valid_to", AttributeType: "N" }
	    ],
	    ProvisionedThroughput: {       
	        ReadCapacityUnits: 1, 
	        WriteCapacityUnits: 1
	    }
	};
	return new Promise(function(resolve,reject) {
		dynamo.createTable(params,function(err,result) {
			if (err) {
				throw err;
			}
			dynamo.waitFor('tableExists', {TableName: table}, function(err,result) {
				if (err) {
					throw err;
				}
				resolve(true);
			});
		});
	});
};

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
	return get_table(table).then(function() {
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


exports.getTable = get_table;

exports.putGrants = put_grants;