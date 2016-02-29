var google = require('googleapis');

var get_service_auth = function get_service_auth(secret,scopes) {
  return new Promise(function(resolve) {
    secret = JSON.parse(secret);
    var cert = secret.private_key;
    payload.iss = secret.client_email;
    if (secret.delegate) {
      payload.sub = secret.delegate;
    }
    var authClient = new google.auth.JWT(secret.client_email,null,secret.private_key,scopes,secret.delegate);
    authClient.authorize(function(err,tokens) {
      if (err) {
        throw err;
      }
      authClient.delegate = secret.delegate;
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
        return { 'id' : member.id, 'email' : member.email };
      });
      resolve(members_array);
    });
  });
};

var getGroups = function getGroups() {
  return getServiceAuth().then(function(auth) {
    return google_get_user_groups(auth,auth.delegate);
  }).then(function(groups) {
    return Promise.all(groups.map(function(group) {
      return google_get_group_membership(auth,group).then(function(members) {
        return {'group' : group, 'members' : members };
      });
    }));
  });
};


exports.getServiceAuth = getServiceAuth;
exports.getGroups = getGroups;