# StudyShare – Firebase login setup

1. Create a project at https://console.firebase.google.com
2. Build > Authentication > Get started > Sign-in method > enable **Email/Password**
3. Project settings > General > Your apps > add a **Web app**, then copy its config
   into `firebase-config.js`
4. Authentication > Settings > Authorized domains: add the domain you deploy to
   (`localhost` is already allowed)
5. Run the site through a local server (ES modules do not load from `file://`):

       python3 -m http.server 8000

   then open http://localhost:8000

## Report system

Open `report-config.js` and replace `YOUR_GMAIL_ADDRESS@gmail.com` with the Gmail
address that should receive reports. Send one test report and click the activation
link FormSubmit emails you; after that, every report arrives in your inbox.
