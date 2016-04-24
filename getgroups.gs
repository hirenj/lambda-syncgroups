//http://stackoverflow.com/questions/32920443/why-does-my-apps-script-deployed-as-api-executable-return-permission-denied

function getgroups() {
  var groups = GroupsApp.getGroups();
  return groups.map(function(group) {
    var users = [];
    try {
      users = group.getUsers().map(function(user) { return { "id" : user.getEmail(), "email" : user.getEmail() }; });
    } catch (e) {
    }
    return { 'groupid' : group.getEmail(), 'type' : 'googlegroup', 'members' : users
    };
  });
}