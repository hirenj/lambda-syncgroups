'use strict';
/*jshint esversion: 6, node:true */

var google = require('googleapis');
var fs = require('fs');

var bucket_name = 'test-gator';

var get_service_auth = function get_service_auth(secret,scopes) {
  return new Promise(function(resolve) {
    secret = JSON.parse(secret);
    var authClient = new google.auth.OAuth2(secret.installed.client_id,
                                            secret.installed.client_secret,
                                            'urn:ietf:wg:oauth:2.0:oob');
    authClient.setCredentials({
      refresh_token: secret.installed.refresh_token
    });
    authClient.refreshAccessToken(function(err,tokens) {
      if (err) {
        throw err;
      }
      resolve(authClient);
    });
  });
};

var google_get_user_groups = function(auth,user) {
  var service = google.admin('directory_v1');
  return new Promise(function(resolve,reject) {
    service.groups.list({auth : auth, userKey : user },function(err,data) {
      if (err) {
        reject(err);
        return;
      }
      resolve ((data.groups || []).map(function(group) {
        return group.email;
      }));
    });
  });
};

var google_get_group_membership = function(auth,group) {
  var service = google.admin('directory_v1');
  return new Promise(function(resolve) {
    service.members.list({auth: auth, groupKey: group },function(err,data) {
      if (err) {
        throw err;
      }
      var members_array = (data.members || []).map(function(member) {
        var role = member.role;
        if (role == 'OWNER' || role == 'MANAGER') {
          role = 'superuser';
        }
        return { 'id' : "googleuser-"+member.id, 'email' : member.email, 'role' : role };
      });
      resolve(members_array);
    });
  });
};

var google_get_group_files = function(auth,group) {
  var service = google.drive('v3');
  return new Promise(function(resolve) {
    //'q' : "sharedWithMe and name contains 'msdata'"
    service.files.list({'auth' : auth, 'corpus' : 'user', 'q' : "name contains 'msdata' and '"+group+"' in readers", 'fields' : 'files(id,md5Checksum,name)' },function(err,result) {
      if (err) {
        throw err;
      }
      result.files.forEach(function(file) {
        file.group = group;
      });
      console.log(result.files.length, "files available");
      resolve(result.files);
    });
  });
};

var google_get_start_token = function(auth) {
  var service = google.drive('v3');
  return new Promise(function(resolve,reject) {
    service.changes.getStartPageToken({'auth' : auth},function(err,result) {
      if (err) {
        reject(err);
        return;
      }
      var startPageToken = result.startPageToken;
      resolve(startPageToken);
    });
  });
};

var google_request_hook = function(auth,hook_url,token) {
  var service = google.drive('v3');
  return new Promise(function(resolve,reject) {
    service.changes.watch({'auth' : auth,
    pageToken: token,
    resource: {
      id: require('uuid').v1(),
      type: 'web_hook',
      address: hook_url
    }},function(err,result) {
      if (err) {
        reject(err);
        return;
      }
      result.page_token = token;
      resolve(result);
    });
  });
};

var google_register_hook = function(auth,hook_url) {
  return google_get_start_token(auth).then(function(startPageToken) {
    return google_request_hook(auth,hook_url,startPageToken);
  });
};

var google_remove_hook = function(auth,hook_data) {
  var service = google.drive('v3');

  return new Promise(function(resolve,reject) {
    service.channels.stop({'auth' : auth, 
      resource: {
        kind: hook_data.kind,
        id: hook_data.id,
        resourceId: hook_data.resourceId,
        resourceUri: hook_data.resourceUri,
        type: 'web_hook',
        address: hook_data.address
      }},function(err,result) {
        if (err) {
          console.log("Got an error");
          console.log(err);
          console.log(err.code);
          if (err.code == 404) {
            console.log("Channel already removed at ",hook_data.id);
            resolve(true);
            return;
          }
          reject(err);
          return;
        }
        console.log("Successfully removed channel at ",hook_data.id);
        resolve(true);
      });
    });
};

var google_get_file_if_needed = function(auth,file) {
  return google_get_file_if_needed_s3(auth,file);
}

var check_existing_file_s3 = function(file) {
  var AWS = require('lambda-helpers').AWS;
  var s3 = new AWS.S3();
  var params = {
    Bucket: bucket_name,
    Key: 'uploads/google-' +file.id +'/googlegroup-'+ file.groupid,
    IfNoneMatch: '"'+file.md5+'"'
  };
  return new Promise(function(resolve,reject) {
    s3.headObject(params, function(err, data) {
      if (err) {

        if (err.statusCode >= 500) {
          reject(err);
          return;
        }

        if (err.statusCode == 304) {
          console.log("Already uploaded");
          resolve(true);
          return;
        }
        if (err.statusCode == 403) {
          console.log("File doesn't exist");
          resolve(file);
          return;
        }
        if (err.statusCode == 404) {
          console.log("No file, need to upload");
          resolve(file);
          return;
        }
        reject(err);
        return;
      }
    });
  });
};

var google_get_file_if_needed_s3 = function(auth,file) {
  var drive = google.drive('v3');
  console.log("Getting file from google",file.id," md5 ",file.md5);
  return check_existing_file_s3(file).then(function(exists) {
    if (exists === true) {
      return true;
    }
    var AWS = require('lambda-helpers').AWS;
    var s3 = new AWS.S3();

    var params = {
      Bucket: bucket_name,
      Key: 'uploads/google-' +file.id +'/googlegroup-'+ file.groupid
    };
    console.log("Trying upload to S3");
    var in_stream = drive.files.get({
      'auth' : auth,
      'fileId' : file.id ,
      'alt' : 'media'
    });
    var stream = new require('stream').PassThrough();
    in_stream.pipe(stream);
    params.Body = stream;
    params.ContentMD5 = new Buffer(file.md5,'hex').toString('base64');
    var options = {partSize: 15 * 1024 * 1024, queueSize: 1};
    return new Promise(function(resolve,reject) {
      s3.upload(params, options,function(err,data) {
        if (err) {
          reject(err);
          return;
        }
        resolve(data);
      });
    });
  });
};

var google_get_file_if_needed_local = function(auth,file) {
  var service = google.drive('v3');
  return new Promise(function(resolve,reject) {
    fs.lstat(file.id+'.msdata.json',function(err,stats) {
      if (! err) {
        // Skip checking MD5
        return resolve(true);
      }
      console.log("Downloading "+file.name,file.id);
      var dest = fs.createWriteStream(file.id+'.msdata.json');

      service.files.get({
        'auth' : auth,
        'fileId' : file.id ,
        'alt' : 'media'
      }).on('end',resolve).on('error',reject).pipe(dest);
    })
  });
};

var google_get_me_email = function(auth) {
  var service = google.oauth2('v2');
  return new Promise(function(resolve,reject) {
    service.userinfo.get({'auth' : auth },function(err,result) {
      if (err) {
        reject(err);
        return;
      }
      auth.delegate = result.id;
      resolve(auth);
    });
  });
};

var remove_missing_groups = function(fileid,groups) {
  var AWS = require('lambda-helpers').AWS;
  var s3 = new AWS.S3();
  var params = {
    Bucket: bucket_name,
    Prefix: "uploads/"+fileid+"/"
  };
  return s3.listObjects(params).promise().then(function(result) {
    var params = {Bucket: bucket_name, Delete: { Objects: [] }};
    params.Delete.Objects = result.Contents.filter(function(content) {
      var group_id = content.Key.split('googlegroup-')[1];
      if (groups.indexOf(group_id) < 0) {
        return true;
      }
    }).map(function(content) { return { Key: content.Key }; });
    if (params.Delete.Objects.length < 1) {
      return Promise.resolve(true);
    }
    console.log("Removing missing groups for ",JSON.stringify(params.Delete.Objects));
    return s3.deleteObjects(params).promise();
  });
};

var google_populate_file_group = function(auth,files) {
  var service = google.drive('v3');
  var promises = files.map(function(fileId) {
    return new Promise(function(resolve,reject) {
      service.files.get({'auth' : auth, 'fileId': fileId,'fields':'id,permissions,md5Checksum,name'},function(err,result) {
        if (err) {
          reject(err);
          return;
        }
        var groups = result.permissions.filter(function(perm) { return perm.type === 'group'; }).map(function(perm) {
          return perm.emailAddress;
        });
        remove_missing_groups("google-"+fileId,groups).then(function() {
          resolve(groups.map(function(groupid) {
            return { 'id' : result.id, 'name' : result.name, 'md5Checksum' : result.md5Checksum, 'group' : groupid };
          }));
        }).catch(function(err) {
          reject(err);
        });
      });
    });
  });
  return Promise.all(promises).then(function(file_details) {
    return [].concat.apply([], file_details);
  });
};

var google_get_changed_files = function(auth,page_token,files) {
  var service = google.drive('v3');
  if ( ! files ) {
    files = [];
  }
  if (page_token == 'none') {
    return google_get_start_token(auth).then(function(token) {
      return google_get_changed_files(auth,token,files);
    });
  }
  return new Promise(function(resolve,reject) {
    service.changes.list({'auth' : auth, pageToken: page_token },function(err,result) {
      if (err) {
        reject(err);
        return;
      }
      console.log("Changes",JSON.stringify(result.changes.map(function(file) {
        return { id: file.fileId, removed: file.removed, name : file.file.name };
      })));
      var current_files = result.changes.filter(function(file) {
        return ! file.removed && file.file.name.match(/msdata/);
      }).map(function(file) {
        return file.fileId;
      });
      if (result.nextPageToken) {
        resolve(google_get_changed_files(auth,result.nextPageToken,files.concat(current_files)));
        return;
      }
      if (result.newStartPageToken) {
        console.log("New start page token should be ",result.newStartPageToken);
        // Update the triggers with the new start page token
        resolve({ files: files.concat(current_files), token: result.newStartPageToken });
      }
    });
  });
};

var getChangedFiles = function getChangedFiles(page_token) {
  var scopes = ["https://www.googleapis.com/auth/drive.readonly"];
  return getServiceAuth(scopes).then(function(auth) {
    return google_get_changed_files(auth,page_token).then(function(files) {
      return google_populate_file_group(auth,files.files).then(function(fileinfo) {
        return {files: fileinfo, token: files.token };
      });
    });
  });
};

var registerHook = function registerHook(hook_url) {
  var scopes = ["https://www.googleapis.com/auth/drive.readonly"];
  return getServiceAuth(scopes).then(function(auth) {
    return google_register_hook(auth,hook_url);
  });
};

var removeHook = function removeHook(hook_data) {
  var scopes = ["https://www.googleapis.com/auth/drive.readonly"];
  return getServiceAuth(scopes).then(function(auth) {
    return google_remove_hook(auth,hook_data);
  });  
};

var downloadFileIfNecessary = function downloadFileIfNecessary(file) {
  var scopes = ["https://www.googleapis.com/auth/drive.readonly"];
  if (file.auth_token && file.auth_token.access_token) {
    console.log("We have an Auth token, trying to access directly");
    var auth_client = new google.auth.OAuth2();
    auth_client.credentials = file.auth_token;
    delete file.auth_token.refresh_token;
    return google_get_file_if_needed(auth_client,file);
  }
  console.log("We have no auth token, trying to get a fresh auth");
  return getServiceAuth(scopes).then(function(auth) {
    return google_get_file_if_needed(auth,file);
  });
};

var getGroupsDomain = function getGroupsDomain() {
  var scopes = ["https://www.googleapis.com/auth/admin.directory.group.readonly","https://www.googleapis.com/auth/admin.directory.group.member.readonly"];
  return getServiceAuth(scopes).then(function(auth) {
    return google_get_me_email(auth);
  }).then(function(auth) {
    return google_get_user_groups(auth,auth.delegate);
  }).then(function(groups) {
    return getServiceAuth(scopes).then(function(auth) {
      return Promise.all(groups.map(function(group) {
        return google_get_group_membership(auth,group).then(function(members) {
          return {'groupid' : group, 'type' : 'googlegroup', 'members' : members };
        });
      }));
    });
  }).catch(function(err) {
    if (err.code == 404) {
      console.log("Not a domains user");
      return [];
    }
    console.log("Other error ",err,err.stack);
    return [];
  });
};

var getGroups = function getGroups() {
  return Promise.all( [ getGroupsDomain(), getOtherGroups() ]).then(function(groupsdata) {
    var results = groupsdata[0];
    var groupids = results.map(function(group) { return group.groupid; });
    return results.concat((groupsdata[1] || []).filter(function(group) {
      return groupids.indexOf(group.groupid) < 0;
    }));
  });
};

var getFiles = function getFiles(group) {
  var scopes = ["https://www.googleapis.com/auth/drive.readonly"];
  return getServiceAuth(scopes).then(function(auth) {
    return google_get_group_files(auth,group);
  }).then(function(files) {
    return files;
  });
};

var auth_promise;

var getServiceAuth = function getServiceAuth(scopes,force) {
  if (auth_promise && ! force) {
    console.log("Returning cached permissions");
    return auth_promise;
  }
  auth_promise = require('lambda-helpers').secrets.getSecret(bucket_name).then(function(secret) {
    return get_service_auth(secret,scopes);
  });
  return auth_promise;
};

var apps_script = function(auth,scriptId,method) {
  var service = google.script('v1');
  // Create execution request.
  var request = {
      'function': method,
      'parameters': [],
      'devMode': false   // Optional.
  };

  return new Promise(function(resolve,reject) {
    service.scripts.run({"scriptId" : scriptId, auth: auth, resource: request},function(err,result) {
      if (err || result.error) {
        reject(err || result.error);
      }
      resolve(result.response.result);
    });
  });
};

/* Things you've got to do to get this working:
    * For whichever user is associated with the
      refresh_token stored in the secrets, add
      permission as an editor for the API project
      that granted the refresh_token.
    * Upload the getgroups.gs to google drive under
      the same user.
    * Change the project number for the script
      so that it's using the common project.
    * Remove the editor permission for the user (
      we only did this so that Apps Script could
      create a Client ID and Client Secret to use
      internally)
    * Run it once to auth it, and deploy as an API
      and get the ID for it.
 */

var getOtherGroups = function getOtherGroups() {
  return require('lambda-helpers').secrets.getSecret(bucket_name).then(function(secret) {
    return get_service_auth(secret,[]);
  }).then(function(auth) {
    return apps_script(auth,'MAgSTtG0xXRHQLMfFQVaOiYmdacAnBeYG','getgroups');
  });
}
exports.setRootBucket = function(bucket) {
  bucket_name = bucket;
};
exports.registerHook = registerHook;
exports.removeHook = removeHook;
exports.downloadFileIfNecessary = downloadFileIfNecessary;
exports.getFiles = getFiles;
exports.getChangedFiles = getChangedFiles;
exports.getServiceAuth = getServiceAuth;
exports.getGroups = getGroups;