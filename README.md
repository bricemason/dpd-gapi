# dpd-gapi
dpd-gapi is a custom resource for [deployd](http://deployd.com/), an open source platform for building APIs. This custom resource leverages the [Google APIs Node.js Client](https://github.com/google/google-api-nodejs-client/) to expose Google APIs to deployd.

## Installation
This is an example installation which enables requests to be executed against the Drive API of a Google account in deployd.

1. `dpd create my-app`
2. `cd my-app`
3. `git clone https://github.com/bricemason/dpd-gapi.git`
4. `npm install dpd-gapi`
5. `dpd`
6. Browse to *http://localhost:2403/dashboard*
7. Add a *Google API Resource* named */gapi*
8. Log in to your Google Developer Console account
9. Create a new project. Under *APIs & auth > Credentials* create a new Client ID of type *Web application*
10. Add *http://localhost:2403* as an authorized JavaScript origin
11. Add *http://localhost:2403/gapi/auth/v1/oauth2callback* as an authorized redirect URI
12. Enable the *Drive API* for your project
13. In your deployd dashboard, enter your Google project client ID, client secret, and the auth scope of *https://www.googleapis.com/auth/drive*
14. Check the *allowAnonymous* checkbox if you want the resource open to all users
15. Click **Save**
16. Navigate to *http://localhost:2403/gapi/auth/v1/init/*
17. Click **Accept** at the Google authorization screen
18. Installation is complete. You can now issue requests against your deployd Google API. Test your installation by navigating to *http://localhost:2403/gapi/drive/v2/about/get*
