//http://stackoverflow.com/questions/32920443/why-does-my-apps-script-deployed-as-api-executable-return-permission-denied

function getgroups() {
  var groups = GroupsApp.getGroups();
  return groups.map(function(group) {
    var users = [];
    try {
      users = group.getUsers().map(function(user) {
        role = group.getRole(user);
        if (role == 'OWNER' || role == 'MANAGER') {
          role = 'superuser';
        }
        return { "id" : user.getEmail(), "email" : user.getEmail(), "role" : role };
      });
      Logger.log(users);
    } catch (e) {
    }
    return { 'groupid' : group.getEmail(), 'type' : 'googlegroup', 'members' : users
    };
  });
}