var google = require('googleapis');
var fs = require('fs');

var get_service_auth = function get_service_auth(secret,scopes) {
  return new Promise(function(resolve) {
    secret = JSON.parse(secret);
    var authClient = new google.auth.OAuth2(secret.installed.client_id,secret.installed.client_secret,'urn:ietf:wg:oauth:2.0:oob');
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
  return new Promise(function(resolve) {
    service.groups.list({auth : auth, userKey : user },function(err,data) {
      if (err) {
        throw err;
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
        return { 'id' : "googleuser-"+member.id, 'email' : member.email };
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

var google_register_hook = function(auth,hook_url) {
  var service = google.drive('v3');
  return new Promise(function(resolve,reject) {
    service.changes.getStartPageToken({'auth' : auth},function(err,result) {
      if (err) {
        reject(err);
        return;
      }
      var startPageToken = result.startPageToken;
      service.changes.watch({'auth' : auth,
      pageToken: startPageToken,      
      resource: {
        id: require('uuid').v1(),
        type: 'web_hook',
        address: hook_url
      }},function(err,result) {
        if (err) {
          reject(err);
          return;
        }
        result.page_token = startPageToken;
        resolve(result);
      });
    });
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
            resolve(result);
            return;
          }
          reject(err);
          return;
        }
        console.log("Successfully removed channel at ",hook_data.id);
        resolve(result);
      });
    });
};

var google_get_file_if_needed = function(auth,file) {
  return google_get_file_if_needed_s3(auth,file);
}

var google_get_file_if_needed_s3 = function(auth,file) {
  var service = google.drive('v3');
  var AWS = require('aws-sdk');
  var s3 = new AWS.S3({region:'us-east-1'});

  return new Promise(function(resolve,reject) {
    var params = {
      Bucket: 'test-gator',
      Key: 'uploads/'+ 'group-'+ file.groupid + '/' +file.id,
      IfNoneMatch: '"'+file.md5+'"'
    };
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

        if (err.statusCode == 404) {
          console.log("No file, need to upload");
        }
      }

      var in_stream = service.files.get({
        'auth' : auth,
        'fileId' : file.id ,
        'alt' : 'media'
      });
      var stream = new require('stream').PassThrough();
      in_stream.pipe(stream);
      params.Body = stream;
      params.ContentMD5 = new Buffer(file.md5,'hex').toString('base64');
      var options = {partSize: 15 * 1024 * 1024, queueSize: 1};
      s3.upload(params, options, function(err, data) {
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
    var auth_client = new google.auth.OAuth2();
    auth_client.credentials = file.auth_token;
    delete file.auth_token.refresh_token;
    return google_get_file_if_needed(auth_client,file);
  }

  return getServiceAuth(scopes).then(function(auth) {
    return google_get_file_if_needed(auth,file);
  });
};

var getGroups = function getGroups() {
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

var getServiceAuth = function getServiceAuth(scopes) {
  if (auth_promise) {
    return auth_promise;
  }
  auth_promise = require('./secrets').getSecret().then(function(secret) {
    return get_service_auth(secret,scopes);
  });
  return auth_promise;
};

exports.registerHook = registerHook;
exports.removeHook = removeHook;
exports.downloadFileIfNecessary = downloadFileIfNecessary;
exports.getFiles = getFiles;
exports.getServiceAuth = getServiceAuth;
exports.getGroups = getGroups;