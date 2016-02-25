import logging
import httplib as http_client

http_client.HTTPConnection.debuglevel = 1
logging.basicConfig() 
logging.getLogger().setLevel(logging.DEBUG)
requests_log = logging.getLogger("requests.packages.urllib3")
requests_log.setLevel(logging.DEBUG)
requests_log.propagate = True

from oauth2client.service_account import ServiceAccountCredentials
from apiclient.discovery import build

scopes = ['https://www.googleapis.com/auth/admin.directory.group.readonly','https://www.googleapis.com/auth/admin.directory.group.member.readonly']

credentials = ServiceAccountCredentials.from_json_keyfile_name(
    'creds.json', scopes)

dg = credentials.create_delegated('[Valid user]')

client = build('admin', 'directory_v1',credentials=dg)
print client.members().list(groupKey='[group name]').execute()
