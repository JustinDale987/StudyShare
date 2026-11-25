/* ==========================================================================
   Firebase setup

   These values come from the Firebase console under Project settings >
   General > Your apps > SDK setup and configuration. They are safe to ship
   in front-end code; access is controlled by Firebase Authentication and
   your security rules.
   ========================================================================== */

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';

export const firebaseConfig = {
  apiKey: 'AIzaSyAolB10Uy2fb_qaNZMGLj3ire7kG-uxeNE',
  authDomain: 'study-share-e1b28.firebaseapp.com',
  projectId: 'study-share-e1b28',
  storageBucket: 'study-share-e1b28.firebasestorage.app',
  messagingSenderId: '367581569171',
  appId: '1:367581569171:web:6e87333d2efc6f02132d66',
};

// Lets the login screen explain what's missing instead of failing silently.
export const isFirebaseConfigured = !firebaseConfig.apiKey.startsWith('YOUR_');

export const auth = getAuth(initializeApp(firebaseConfig));
