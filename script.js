import {
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
  updateProfile,
  updatePassword,
  reauthenticateWithCredential,
  EmailAuthProvider,
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import { auth, isFirebaseConfigured } from './firebase-config.js';
import { REPORT_EMAIL, isReportEmailConfigured } from './report-config.js';

/* ==========================================================================
   StudyShare

   1. Constants & state
   2. Storage (IndexedDB for files, localStorage for profiles)
   3. Helpers
   4. Theme (light / dark / navigation color)
   5. Navigation & sidebar
   6. Templates
   7. Page renderers
   8. Reviewer actions (view, like, download, edit, delete)
   9. Authentication (Firebase)
   10. Upload form
   11. Profile & settings
   12. Reporting a reviewer
   13. Event wiring & startup
   ========================================================================== */


/* ---------- 1. Constants & state ---------- */

const DB_NAME = 'studyshare_db';
const STORE_NAME = 'reviewers';

const STORAGE_KEYS = {
  users: 'ss_users', // profile details (name, username, about) keyed by Firebase uid
  themeMode: 'ss_theme_mode',
  navColor: 'ss_nav_color',
};

const DEFAULT_NAV_COLOR = '#1b329b';
const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 MB
const ALLOWED_FILE_TYPES = /\.(jpg|jpeg|png|gif|webp|pdf|doc|docx|ppt|pptx|txt|xls|xlsx|csv)$/i;
const ICON_COLORS = ['blue', 'green', 'orange', 'purple'];
const TOAST_DURATION = 2600;

// Every subject in the site comes from this list: the home tiles, the library
// filter and the upload form. Add a course here and it shows up everywhere.
// `featured` subjects also get a tile on the home page.
const SUBJECT_GROUPS = [
  { label: 'Computing & Technology', subjects: [
    { name: 'ICT', icon: '🖥️', featured: true },
    { name: 'Computer Science', icon: '💻', featured: true },
    { name: 'Information Technology', icon: '🌐' },
    { name: 'Programming', icon: '⌨️' },
    { name: 'Data Science', icon: '📊' },
  ] },
  { label: 'Math & Sciences', subjects: [
    { name: 'Math', icon: '➗', featured: true },
    { name: 'Statistics', icon: '📈' },
    { name: 'Science', icon: '🧪', featured: true },
    { name: 'Physics', icon: '⚛️' },
    { name: 'Chemistry', icon: '⚗️' },
    { name: 'Biology', icon: '🧬' },
    { name: 'Environmental Science', icon: '🌱' },
  ] },
  { label: 'Engineering & Architecture', subjects: [
    { name: 'Engineering', icon: '⚙️', featured: true },
    { name: 'Electrical Engineering', icon: '⚡' },
    { name: 'Mechanical Engineering', icon: '🔧' },
    { name: 'Civil Engineering', icon: '🏗️' },
    { name: 'Architecture', icon: '📐' },
  ] },
  { label: 'Business & Economics', subjects: [
    { name: 'Business Administration', icon: '💼', featured: true },
    { name: 'Accounting', icon: '🧾' },
    { name: 'Economics', icon: '💹' },
    { name: 'Finance', icon: '💰' },
    { name: 'Marketing', icon: '📣' },
    { name: 'Management', icon: '🗂️' },
    { name: 'Entrepreneurship', icon: '🚀' },
  ] },
  { label: 'Health & Medicine', subjects: [
    { name: 'Nursing', icon: '🩺', featured: true },
    { name: 'Medical Technology', icon: '🔬' },
    { name: 'Pharmacy', icon: '💊' },
    { name: 'Psychology', icon: '🧠', featured: true },
  ] },
  { label: 'Education & Humanities', subjects: [
    { name: 'English', icon: '📕', featured: true },
    { name: 'Literature', icon: '📚' },
    { name: 'Education', icon: '🍎' },
    { name: 'History', icon: '🏛️' },
    { name: 'Philosophy', icon: '💭' },
    { name: 'Communication', icon: '🎤' },
    { name: 'Political Science', icon: '🗳️' },
    { name: 'Sociology', icon: '👥' },
    { name: 'Criminology', icon: '🔎' },
  ] },
  { label: 'Arts & Design', subjects: [
    { name: 'Fine Arts', icon: '🎨' },
    { name: 'Graphic Design', icon: '✏️' },
    { name: 'Music', icon: '🎵' },
  ] },
  { label: null, subjects: [{ name: 'Other', icon: '•••' }] },
];

const DEFAULT_ABOUT = 'I love sharing reviewers and helping my classmates succeed!';

let currentUser = null;
let toastTimer = null;
let previewUrl = null;
let currentPage = null;
const pageHistory = []; // pages visited before the current one, newest last
let reportTarget = null; // the reviewer currently being reported
let pendingRegistration = null; // name/username typed on the register form, used when the profile is first created


/* ---------- 2. Storage ---------- */

// --- Reviewers (files) live in IndexedDB because they contain binary blobs ---

let databasePromise = null;

function openDatabase() {
  if (!databasePromise) {
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  return databasePromise;
}

async function runStoreRequest(mode, createRequest) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const store = db.transaction(STORE_NAME, mode).objectStore(STORE_NAME);
    const request = createRequest(store);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

const getReviewer = id => runStoreRequest('readonly', store => store.get(id));
const saveReviewer = reviewer => runStoreRequest('readwrite', store => store.put(reviewer));
const removeReviewer = id => runStoreRequest('readwrite', store => store.delete(id));

async function getAllReviewers() {
  const reviewers = await runStoreRequest('readonly', store => store.getAll());
  return reviewers.sort((a, b) => b.date - a.date); // newest first
}

// --- Profiles live in localStorage. Passwords are handled by Firebase, never stored here. ---

function loadUsers() {
  return JSON.parse(localStorage.getItem(STORAGE_KEYS.users) || '[]');
}

function saveUsers(users) {
  localStorage.setItem(STORAGE_KEYS.users, JSON.stringify(users));
}

// Older versions kept plain-text passwords in localStorage. Remove any that are left.
function removeLegacyPasswords() {
  const users = loadUsers();
  if (users.some(user => 'password' in user)) {
    saveUsers(users.map(({ password, ...profile }) => profile));
  }
}

function findUserById(id) {
  return loadUsers().find(user => user.id === id);
}

function updateCurrentUser(changes) {
  const users = loadUsers();
  const index = users.findIndex(user => user.id === currentUser.id);
  users[index] = { ...users[index], ...changes };
  saveUsers(users);
  currentUser = users[index];
}


/* ---------- 3. Helpers ---------- */

const $ = id => document.getElementById(id);

function showToast(message) {
  const toast = $('toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), TOAST_DURATION);
}

function setMessage(element, text, type = 'error') {
  element.textContent = text;
  element.className = type === 'success' ? 'message success' : 'message';
}

function escapeHTML(text = '') {
  const replacements = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return String(text).replace(/[&<>"']/g, char => replacements[char]);
}

function getInitials(name) {
  return (name || 'S')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map(word => word[0])
    .join('')
    .toUpperCase();
}

function formatDate(timestamp) {
  return new Date(timestamp).toLocaleDateString();
}

function sumBy(items, getValue) {
  return items.reduce((total, item) => total + getValue(item), 0);
}

function getFileSymbol(type) {
  if (type.startsWith('image/')) return '▧';
  if (type.includes('pdf')) return 'PDF';
  if (type.includes('word') || type.includes('document')) return 'W';
  if (type.includes('presentation')) return 'P';
  if (type.includes('sheet')) return 'X';
  return '▤';
}

// Shows the uploader's current name, even if they renamed themselves after uploading.
function getOwnerName(reviewer) {
  return findUserById(reviewer.ownerId)?.name ?? reviewer.ownerName;
}

// Likes are stored as a list of user ids so each person can like a file only once.
const getLikes = reviewer => reviewer.likedBy ?? [];
const hasLiked = reviewer => getLikes(reviewer).includes(currentUser.id);


/* ---------- 4. Theme ---------- */

function getSavedTheme() {
  return {
    mode: localStorage.getItem(STORAGE_KEYS.themeMode) || 'light',
    navColor: localStorage.getItem(STORAGE_KEYS.navColor) || DEFAULT_NAV_COLOR,
  };
}

// Picks white or dark text depending on how light the chosen navigation color is.
function getReadableTextColor(hexColor) {
  const red = parseInt(hexColor.slice(1, 3), 16);
  const green = parseInt(hexColor.slice(3, 5), 16);
  const blue = parseInt(hexColor.slice(5, 7), 16);
  const brightness = (red * 299 + green * 587 + blue * 114) / 1000 / 255;
  return brightness > 0.65 ? '#161a2b' : '#ffffff';
}

function applyTheme({ mode, navColor }) {
  const root = document.documentElement;
  root.dataset.theme = mode;
  root.style.setProperty('--nav-color', navColor);
  root.style.setProperty('--nav-text', getReadableTextColor(navColor));

  localStorage.setItem(STORAGE_KEYS.themeMode, mode);
  localStorage.setItem(STORAGE_KEYS.navColor, navColor);
  syncThemeControls();
}

function syncThemeControls() {
  const { mode, navColor } = getSavedTheme();
  $('navColor').value = navColor;
  $('lightThemeBtn').classList.toggle('selected', mode === 'light');
  $('darkThemeBtn').classList.toggle('selected', mode === 'dark');
}


/* ---------- 5. Navigation & sidebar ---------- */

const pageRenderers = {
  home: renderHome,
  library: renderLibrary,
  uploads: renderMyUploads,
  profile: renderProfile,
  settings: syncThemeControls,
};

const PAGE_TITLES = {
  home: 'Home',
  library: 'Reviewer Library',
  details: 'Reviewer',
  report: 'Report',
  upload: 'Upload Reviewer',
  uploads: 'My Uploads',
  profile: 'Profile',
  settings: 'Settings',
};
const MAX_HISTORY = 30;

// isBack: moving back through history. replace: leave the current page out of the history.
function navigate(page, { isBack = false, replace = false } = {}) {
  // Remember where the person came from so the Back button can return there.
  if (!isBack && !replace && currentPage && currentPage !== page) {
    pageHistory.push(currentPage);
    if (pageHistory.length > MAX_HISTORY) pageHistory.shift();
  }
  currentPage = page;

  document.querySelectorAll('.page').forEach(section => section.classList.add('hidden'));
  const section = $(`page-${page}`);
  section.classList.remove('hidden');
  updateBackButton(section);

  document.querySelectorAll('.nav-link[data-page]').forEach(link => {
    link.classList.toggle('active', link.dataset.page === page);
  });

  closeSidebar();
  pageRenderers[page]?.();
}

// One shared Back button is moved to the top of whichever page is open.
function updateBackButton(section) {
  const button = $('backBtn');
  const previous = pageHistory[pageHistory.length - 1];

  button.classList.toggle('hidden', !previous);
  if (!previous) return;

  button.textContent = `← Back to ${PAGE_TITLES[previous] ?? 'previous page'}`;
  section.prepend(button);
}

function goBack() {
  const previous = pageHistory.pop();
  if (previous) navigate(previous, { isBack: true });
}

// Drops pages from the history that no longer make sense to return to.
function forgetPages(...pages) {
  for (let index = pageHistory.length - 1; index >= 0; index--) {
    if (pages.includes(pageHistory[index])) pageHistory.splice(index, 1);
  }
}

function setSidebarOpen(isOpen) {
  $('sidebar').classList.toggle('open', isOpen);
  $('sidebarBackdrop').classList.toggle('show', isOpen);

  const toggle = $('menuToggle');
  toggle.classList.toggle('is-open', isOpen); // rotates the button 180°
  toggle.setAttribute('aria-expanded', String(isOpen));
  toggle.setAttribute('aria-label', isOpen ? 'Close navigation' : 'Open navigation');
}

const closeSidebar = () => setSidebarOpen(false);
const toggleSidebar = () => setSidebarOpen(!$('sidebar').classList.contains('open'));


/* ---------- 6. Templates ---------- */

function renderLikeButton(reviewer) {
  const liked = hasLiked(reviewer);
  return `
    <button class="like-btn ${liked ? 'liked' : ''}" data-action="like" data-id="${reviewer.id}"
            aria-pressed="${liked}" aria-label="${liked ? 'Unlike' : 'Like'}">
      <span class="like-icon">${liked ? '♥' : '♡'}</span>
      <span class="like-count">${getLikes(reviewer).length}</span>
    </button>`;
}

function renderReviewerCard(reviewer, index) {
  return `
    <article class="reviewer-card">
      <div class="file-icon ${ICON_COLORS[index % ICON_COLORS.length]}">${getFileSymbol(reviewer.type)}</div>
      <div class="card-info">
        <h4>${escapeHTML(reviewer.title)}</h4>
        <p>Subject: ${escapeHTML(reviewer.subject)}</p>
        <p>${escapeHTML(reviewer.category)} · ${formatDate(reviewer.date)}</p>
        <div class="card-actions">
          <button class="mini-btn" data-action="view" data-id="${reviewer.id}">VIEW</button>
          <button class="mini-btn download" data-action="download" data-id="${reviewer.id}">DOWNLOAD</button>
          ${renderLikeButton(reviewer)}
        </div>
      </div>
    </article>`;
}

function renderReviewerRow(reviewer, index, isOwner = false) {
  const ownerButtons = isOwner
    ? `<button class="mini-btn" data-action="edit" data-id="${reviewer.id}">EDIT</button>
       <button class="mini-btn" data-action="delete" data-id="${reviewer.id}">DELETE</button>`
    : '';

  return `
    <article class="reviewer-row">
      <div class="file-icon ${ICON_COLORS[index % ICON_COLORS.length]}">${getFileSymbol(reviewer.type)}</div>
      <div class="row-info">
        <h4>${escapeHTML(reviewer.title)}</h4>
        <p>Subject: ${escapeHTML(reviewer.subject)} &nbsp; Category: ${escapeHTML(reviewer.category)}</p>
        <p>
          Uploaded by: ${escapeHTML(getOwnerName(reviewer))} · ${formatDate(reviewer.date)}
          · ◉ ${reviewer.views || 0} views · ↓ ${reviewer.downloads || 0} downloads
        </p>
      </div>
      <div class="row-actions">
        <button class="mini-btn" data-action="view" data-id="${reviewer.id}">VIEW</button>
        <button class="mini-btn download" data-action="download" data-id="${reviewer.id}">DOWNLOAD</button>
        ${renderLikeButton(reviewer)}
        ${ownerButtons}
      </div>
    </article>`;
}

function renderPreview(reviewer) {
  if (previewUrl) URL.revokeObjectURL(previewUrl);

  if (reviewer.type.startsWith('image/')) {
    previewUrl = URL.createObjectURL(reviewer.blob);
    return `<img src="${previewUrl}" alt="Reviewer preview">`;
  }

  if (reviewer.type === 'application/pdf') {
    previewUrl = URL.createObjectURL(reviewer.blob);
    return `<iframe title="PDF preview" src="${previewUrl}"></iframe>`;
  }

  previewUrl = null;
  return `
    <div class="preview-placeholder">
      <div class="preview-icon">📄</div>
      <strong>${escapeHTML(reviewer.fileName)}</strong>
      <p>Preview is not available for this file type. Download to open it.</p>
    </div>`;
}

function renderDetails(reviewer) {
  const isOwner = reviewer.ownerId === currentUser.id;
  const deleteButton = isOwner
    ? `<button class="danger" data-action="delete" data-id="${reviewer.id}">DELETE</button>`
    : '';

  $('detailContent').innerHTML = `
    <div class="detail-head">
      <div>
        <h2>${escapeHTML(reviewer.title)}</h2>
        <div class="detail-meta">
          <span class="chip">Subject: ${escapeHTML(reviewer.subject)}</span>
          <span class="chip">Category: ${escapeHTML(reviewer.category)}</span>
        </div>
        <p class="muted">Uploaded by: ${escapeHTML(getOwnerName(reviewer))} · ${formatDate(reviewer.date)}</p>
      </div>
      <p class="muted">◉ ${reviewer.views} views &nbsp; ↓ ${reviewer.downloads || 0} downloads</p>
    </div>

    <h3>Preview</h3>
    <div class="preview-box">${renderPreview(reviewer)}</div>

    <div class="detail-buttons">
      <button class="primary" data-action="download" data-id="${reviewer.id}">⇩ DOWNLOAD</button>
      ${renderLikeButton(reviewer)}
      ${deleteButton}
      <button class="outline" data-action="report" data-id="${reviewer.id}">⚑ REPORT</button>
    </div>

    <h3>Description</h3>
    <p>${escapeHTML(reviewer.description || 'No description provided.')}</p>`;
}


/* ---------- 7. Page renderers ---------- */

async function renderHome() {
  const reviewers = await getAllReviewers();
  const mostLiked = [...reviewers].sort(
    (a, b) => getLikes(b).length - getLikes(a).length || (b.downloads || 0) - (a.downloads || 0)
  );

  $('welcomeName').textContent = currentUser.name.split(' ')[0];
  $('recentGrid').innerHTML =
    reviewers.slice(0, 3).map(renderReviewerCard).join('') ||
    '<p class="muted">No uploads yet. Be the first to share a reviewer!</p>';
  $('popularGrid').innerHTML =
    mostLiked.slice(0, 3).map(renderReviewerCard).join('') ||
    '<p class="muted">Popular reviewers will appear here.</p>';
}

async function renderLibrary() {
  const query = $('librarySearch').value.toLowerCase();
  const subject = $('subjectFilter').value;
  const category = $('categoryFilter').value;
  const sortBy = $('sortFilter').value;

  const reviewers = (await getAllReviewers()).filter(reviewer => {
    const searchableText = `${reviewer.title} ${reviewer.description} ${getOwnerName(reviewer)}`.toLowerCase();
    return (
      (!query || searchableText.includes(query)) &&
      (!subject || reviewer.subject === subject) &&
      (!category || reviewer.category === category)
    );
  });

  if (sortBy === 'liked') reviewers.sort((a, b) => getLikes(b).length - getLikes(a).length);
  if (sortBy === 'popular') reviewers.sort((a, b) => (b.views || 0) - (a.views || 0));
  if (sortBy === 'title') reviewers.sort((a, b) => a.title.localeCompare(b.title));

  $('libraryList').innerHTML = reviewers.map((reviewer, index) => renderReviewerRow(reviewer, index)).join('');
  $('emptyLibrary').classList.toggle('hidden', reviewers.length > 0);
}

async function renderMyUploads() {
  const myReviewers = (await getAllReviewers()).filter(reviewer => reviewer.ownerId === currentUser.id);

  $('myUploadsList').innerHTML = myReviewers
    .map((reviewer, index) => renderReviewerRow(reviewer, index, true))
    .join('');
  $('emptyUploads').classList.toggle('hidden', myReviewers.length > 0);
}

function renderTopAvatar() {
  $('topAvatar').textContent = getInitials(currentUser.name);
}

async function renderProfile() {
  const user = findUserById(currentUser.id);
  const myReviewers = (await getAllReviewers()).filter(reviewer => reviewer.ownerId === user.id);

  $('profileName').textContent = user.name;
  $('profileHandle').textContent = `@${user.username}`;
  $('profileEmail').textContent = user.email;
  $('profileAvatar').textContent = getInitials(user.name);
  $('aboutText').textContent = user.about || DEFAULT_ABOUT;
  $('joinedDate').textContent = `Joined: ${formatDate(user.joined)}`;

  // Both totals are calculated from the user's uploads, so they stay accurate
  // when files are liked, downloaded or deleted.
  $('uploadCount').textContent = myReviewers.length;
  $('downloadCount').textContent = sumBy(myReviewers, reviewer => reviewer.downloads || 0);
  $('likeCount').textContent = sumBy(myReviewers, reviewer => getLikes(reviewer).length);

  renderTopAvatar();
}


/* ---------- 8. Reviewer actions ---------- */

async function openDetails(id) {
  const reviewer = await getReviewer(id);
  if (!reviewer) return;

  reviewer.views = (reviewer.views || 0) + 1;
  await saveReviewer(reviewer);

  renderDetails(reviewer);
  navigate('details');
}

async function toggleLike(id) {
  const reviewer = await getReviewer(id);
  if (!reviewer) return;

  const likedBy = new Set(getLikes(reviewer));
  if (likedBy.has(currentUser.id)) {
    likedBy.delete(currentUser.id);
  } else {
    likedBy.add(currentUser.id);
  }
  reviewer.likedBy = [...likedBy];
  await saveReviewer(reviewer);

  // Update every like button for this file that is currently on screen.
  document.querySelectorAll(`[data-action="like"][data-id="${id}"]`).forEach(button => {
    button.outerHTML = renderLikeButton(reviewer);
  });
}

async function downloadReviewer(id) {
  const reviewer = await getReviewer(id);
  if (!reviewer) return;

  const url = URL.createObjectURL(reviewer.blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = reviewer.fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);

  reviewer.downloads = (reviewer.downloads || 0) + 1;
  await saveReviewer(reviewer);
  showToast('Download started.');
}

async function editReviewerTitle(id) {
  const reviewer = await getReviewer(id);
  if (!reviewer) return;

  const newTitle = prompt('Edit reviewer title:', reviewer.title)?.trim();
  if (!newTitle) return;

  reviewer.title = newTitle;
  await saveReviewer(reviewer);
  renderMyUploads();
  showToast('Reviewer updated.');
}

async function deleteReviewer(id) {
  const reviewer = await getReviewer(id);
  const isOwner = reviewer?.ownerId === currentUser.id;
  if (!isOwner || !confirm('Delete this upload?')) return;

  await removeReviewer(id);
  showToast('Upload deleted.');
  forgetPages('details', 'report'); // the reviewer they would return to is gone
  navigate('uploads', { replace: true });
}

const reviewerActions = {
  view: openDetails,
  like: toggleLike,
  download: downloadReviewer,
  edit: editReviewerTitle,
  delete: deleteReviewer,
  report: openReportPage,
};


/* ---------- 9. Authentication (Firebase) ---------- */

const AUTH_ERRORS = {
  'auth/invalid-email': 'Please enter a valid email address.',
  'auth/invalid-credential': 'Incorrect email or password.',
  'auth/user-not-found': 'Incorrect email or password.',
  'auth/wrong-password': 'Incorrect email or password.',
  'auth/email-already-in-use': 'An account with this email already exists.',
  'auth/weak-password': 'Password must be at least 6 characters.',
  'auth/too-many-requests': 'Too many attempts. Please wait a moment and try again.',
  'auth/network-request-failed': 'Network error. Check your connection and try again.',
  'auth/requires-recent-login': 'Please log in again before changing your password.',
};

const getAuthErrorMessage = error =>
  AUTH_ERRORS[error.code] ?? 'Something went wrong. Please try again.';

// Disables a form's submit button while a request is running to prevent double submits.
function setFormBusy(form, isBusy) {
  form.querySelector('[type="submit"], button:not([type])').disabled = isBusy;
}

function makeUniqueUsername(base, users) {
  const taken = new Set(users.map(user => user.username.toLowerCase()));
  let candidate = base;
  for (let number = 2; taken.has(candidate.toLowerCase()); number++) {
    candidate = `${base}${number}`;
  }
  return candidate;
}

// Finds (or creates) the local profile that belongs to a Firebase user.
function loadProfile(firebaseUser) {
  const users = loadUsers();
  let profile = users.find(user => user.id === firebaseUser.uid);

  if (!profile) {
    const emailName = firebaseUser.email.split('@')[0];
    profile = {
      id: firebaseUser.uid,
      name: pendingRegistration?.name || firebaseUser.displayName || emailName,
      username: pendingRegistration?.username || makeUniqueUsername(emailName, users),
      joined: Date.parse(firebaseUser.metadata.creationTime) || Date.now(),
      about: '',
    };
    users.push(profile);
  }

  profile.email = firebaseUser.email; // the email always comes from Firebase
  saveUsers(users);
  return profile;
}

function showScreen(id) {
  ['authScreen', 'registerScreen', 'appScreen'].forEach(screenId => $(screenId).classList.add('hidden'));
  $(id).classList.remove('hidden');
}

function startApp() {
  showScreen('appScreen');
  renderTopAvatar();
  pageHistory.length = 0; // a fresh login starts with a clean trail
  currentPage = null;
  navigate('home');
}

function logout() {
  signOut(auth);
}

async function handleLogin(event) {
  event.preventDefault();

  const form = $('loginForm');
  const email = $('loginEmail').value.trim();
  const password = $('loginPassword').value;
  const persistence = $('rememberMe').checked ? browserLocalPersistence : browserSessionPersistence;

  setFormBusy(form, true);
  try {
    await setPersistence(auth, persistence);
    await signInWithEmailAndPassword(auth, email, password);
    // onAuthStateChanged takes it from here.
  } catch (error) {
    setMessage($('loginMessage'), getAuthErrorMessage(error));
  } finally {
    setFormBusy(form, false);
  }
}

async function handleRegister(event) {
  event.preventDefault();

  const form = $('registerForm');
  const message = $('registerMessage');
  const name = $('regName').value.trim();
  const email = $('regEmail').value.trim();
  const username = $('regUsername').value.trim();

  const usernameTaken = loadUsers().some(user => user.username.toLowerCase() === username.toLowerCase());
  if (usernameTaken) {
    setMessage(message, 'That username is already taken.');
    return;
  }

  setFormBusy(form, true);
  pendingRegistration = { name, username };
  try {
    await setPersistence(auth, browserSessionPersistence);
    const { user } = await createUserWithEmailAndPassword(auth, email, $('regPassword').value);
    await updateProfile(user, { displayName: name });
    showToast('Account created successfully!');
  } catch (error) {
    setMessage(message, getAuthErrorMessage(error));
  } finally {
    pendingRegistration = null;
    setFormBusy(form, false);
  }
}

async function handleForgotPassword(event) {
  event.preventDefault();

  const message = $('loginMessage');
  const email = $('loginEmail').value.trim();
  if (!email) {
    setMessage(message, 'Enter your email above first, then click "Forgot Password?".');
    return;
  }

  try {
    await sendPasswordResetEmail(auth, email);
    setMessage(message, 'If an account exists for that email, a reset link is on its way.', 'success');
  } catch (error) {
    setMessage(message, getAuthErrorMessage(error));
  }
}

// Firebase remembers who is signed in, so this runs on every page load as well as on login/logout.
function watchAuthState() {
  if (!isFirebaseConfigured) {
    showScreen('authScreen');
    setMessage($('loginMessage'), 'Firebase is not set up yet. Add your project keys to firebase-config.js.');
    return;
  }

  onAuthStateChanged(auth, firebaseUser => {
    if (firebaseUser) {
      currentUser = loadProfile(firebaseUser);
      startApp();
      return;
    }

    currentUser = null;
    $('loginForm').reset();
    $('registerForm').reset();
    setMessage($('loginMessage'), '');
    setMessage($('registerMessage'), '');
    showScreen('authScreen');
  });
}


/* ---------- 10. Upload form ---------- */

function updateFileLabel(file) {
  $('fileName').textContent = file
    ? `${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`
    : 'No file selected';
}

function validateFile(file) {
  if (!file) return 'Please choose a file.';
  if (file.size > MAX_FILE_SIZE) return 'File is too large. Maximum size is 20MB.';
  if (!ALLOWED_FILE_TYPES.test(file.name)) return 'This file type is not supported.';
  return null;
}

async function handleUpload(event) {
  event.preventDefault();

  const file = $('reviewerFile').files[0];
  const problem = validateFile(file);
  if (problem) {
    setMessage($('uploadMessage'), problem);
    return;
  }

  const reviewer = {
    id: crypto.randomUUID(),
    title: $('reviewerTitle').value.trim(),
    subject: $('uploadSubject').value,
    category: $('uploadCategory').value,
    description: $('reviewerDescription').value.trim(),
    fileName: file.name,
    type: file.type || 'application/octet-stream',
    blob: file,
    ownerId: currentUser.id,
    ownerName: currentUser.name,
    date: Date.now(),
    views: 0,
    downloads: 0,
    likedBy: [],
  };

  try {
    await saveReviewer(reviewer);
    $('uploadForm').reset();
    setMessage($('uploadMessage'), 'Upload successful!', 'success');
    showToast('Reviewer uploaded successfully!');
    setTimeout(() => navigate('uploads'), 650);
  } catch (error) {
    setMessage($('uploadMessage'), 'Could not save the file. Your browser storage may be full.');
  }
}

function handleFileDrop(event) {
  event.preventDefault();
  $('dropZone').classList.remove('drag');

  const { files } = event.dataTransfer;
  if (files.length) {
    $('reviewerFile').files = files;
    updateFileLabel(files[0]);
  }
}


/* ---------- 11. Profile & settings ---------- */

function openEditProfile() {
  const user = findUserById(currentUser.id);
  $('editName').value = user.name;
  $('editUsername').value = user.username;
  $('editAbout').value = user.about || '';
  $('editDialog').showModal();
}

function handleProfileSave(event) {
  event.preventDefault();

  const username = $('editUsername').value.trim();
  const usernameTaken = loadUsers().some(user =>
    user.id !== currentUser.id && user.username.toLowerCase() === username.toLowerCase()
  );
  if (usernameTaken) {
    alert('Username already taken.');
    return;
  }

  updateCurrentUser({
    name: $('editName').value.trim(),
    username,
    about: $('editAbout').value.trim(),
  });
  $('editDialog').close();
  renderProfile();
  showToast('Profile updated.');
}

async function handlePasswordChange(event) {
  event.preventDefault();

  const form = $('passwordForm');
  const message = $('settingsMessage');
  if ($('newPassword').value !== $('confirmPassword').value) {
    setMessage(message, 'New passwords do not match.');
    return;
  }

  setFormBusy(form, true);
  try {
    // Firebase requires a fresh login before a sensitive change like this.
    const credential = EmailAuthProvider.credential(auth.currentUser.email, $('currentPassword').value);
    await reauthenticateWithCredential(auth.currentUser, credential);
    await updatePassword(auth.currentUser, $('newPassword').value);

    form.reset();
    setMessage(message, 'Password updated successfully.', 'success');
  } catch (error) {
    const wrongPassword = ['auth/invalid-credential', 'auth/wrong-password'].includes(error.code);
    setMessage(message, wrongPassword ? 'Current password is incorrect.' : getAuthErrorMessage(error));
  } finally {
    setFormBusy(form, false);
  }
}


/* ---------- 12. Reporting a reviewer ---------- */

const REPORT_COMMENT_LIMIT = 1000;

async function openReportPage(id) {
  const reviewer = await getReviewer(id);
  if (!reviewer) {
    showToast('That reviewer is no longer available.');
    return;
  }

  reportTarget = {
    id: reviewer.id,
    title: reviewer.title,
    subject: reviewer.subject,
    ownerId: reviewer.ownerId,
    ownerName: getOwnerName(reviewer),
  };

  $('reportTarget').innerHTML = `
    <strong>${escapeHTML(reviewer.title)}</strong>
    <span>Subject: ${escapeHTML(reviewer.subject)} · Uploaded by ${escapeHTML(getOwnerName(reviewer))}</span>`;

  $('reportForm').reset();
  setMessage($('reportMessage'), '');
  updateReportCounter();
  navigate('report');
}

function updateReportCounter() {
  $('reportCounter').textContent = `${$('reportComment').value.length} / ${REPORT_COMMENT_LIMIT}`;
}

async function handleReportSubmit(event) {
  event.preventDefault();

  const form = $('reportForm');
  const message = $('reportMessage');
  const violation = form.querySelector('input[name="violation"]:checked')?.value;
  const comment = $('reportComment').value.trim();

  if (!reportTarget) {
    setMessage(message, 'Open a reviewer first, then press Report.');
    return;
  }
  if (!violation) {
    setMessage(message, 'Please choose the violation that applies.');
    return;
  }
  if (!comment) {
    setMessage(message, 'Please add a comment about the content.');
    return;
  }
  if (!isReportEmailConfigured) {
    setMessage(message, 'Reports are not set up yet. Add your Gmail address to report-config.js.');
    return;
  }

  setFormBusy(form, true);
  setMessage(message, '');
  try {
    const response = await fetch(`https://formsubmit.co/ajax/${encodeURIComponent(REPORT_EMAIL)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        _subject: `StudyShare report: ${violation} - ${reportTarget.title}`,
        _template: 'table',
        _captcha: 'false',
        name: currentUser.name,
        email: currentUser.email, // lets you reply straight to the reporter
        Violation: violation,
        Comment: comment,
        'Reviewer title': reportTarget.title,
        'Reviewer ID': reportTarget.id,
        Subject: reportTarget.subject,
        'Uploaded by': `${reportTarget.ownerName} (${reportTarget.ownerId})`,
        'Reported at': new Date().toLocaleString(),
      }),
    });
    const result = await response.json();
    if (!response.ok || String(result.success) !== 'true') {
      throw new Error(result.message || 'The report could not be sent.');
    }

    showToast('Thank you. Your report has been sent.');
    reportTarget = null;
    forgetPages('report');
    navigate('library', { replace: true }); // a sent report shouldn't be reachable with Back
  } catch (error) {
    const offline = error instanceof TypeError; // fetch rejects with TypeError when the network is down
    setMessage(message, offline
      ? 'Network error. Check your connection and try again.'
      : (error.message || 'Something went wrong. Please try again.'));
  } finally {
    setFormBusy(form, false);
  }
}


/* ---------- Subject lists ---------- */

// Fills the library filter, the upload form and the home page tiles.
function renderSubjects() {
  [$('subjectFilter'), $('uploadSubject')].forEach(select => {
    SUBJECT_GROUPS.forEach(group => {
      const parent = group.label ? Object.assign(document.createElement('optgroup'), { label: group.label }) : select;
      group.subjects.forEach(({ name }) => parent.append(new Option(name, name)));
      if (group.label) select.append(parent);
    });
  });

  const featured = SUBJECT_GROUPS.flatMap(group => group.subjects).filter(subject => subject.featured);
  const tiles = featured.map(({ name, icon }) => `
    <button class="subject-tile" data-subject="${escapeHTML(name)}"><span>${icon}</span>${escapeHTML(name)}</button>`);
  tiles.push('<button class="subject-tile" data-more="true"><span>•••</span>More subjects</button>');
  $('subjectGrid').innerHTML = tiles.join('');
}


/* ---------- 13. Event wiring & startup ---------- */

function goToLibraryWith(searchText) {
  $('librarySearch').value = searchText;
  navigate('library');
}

function wireEvents() {
  // One click listener handles page links ([data-page], [data-goto]) and
  // reviewer buttons ([data-action]) so re-rendered lists keep working.
  document.addEventListener('click', event => {
    const pageLink = event.target.closest('[data-page], [data-goto]');
    if (pageLink) navigate(pageLink.dataset.page ?? pageLink.dataset.goto);

    const actionButton = event.target.closest('[data-action]');
    if (actionButton) reviewerActions[actionButton.dataset.action]?.(actionButton.dataset.id);
  });

  // Login / register
  $('loginForm').addEventListener('submit', handleLogin);
  $('registerForm').addEventListener('submit', handleRegister);
  $('showRegister').addEventListener('click', () => showScreen('registerScreen'));
  $('backToLogin').addEventListener('click', () => showScreen('authScreen'));
  $('logoutBtn').addEventListener('click', logout);
  $('profileLogout').addEventListener('click', logout);
  $('togglePassword').addEventListener('click', () => {
    const field = $('loginPassword');
    field.type = field.type === 'password' ? 'text' : 'password';
  });
  $('forgotLink').addEventListener('click', handleForgotPassword);

  // Report
  $('reportForm').addEventListener('submit', handleReportSubmit);
  $('reportComment').addEventListener('input', updateReportCounter);
  $('cancelReport').addEventListener('click', goBack);

  // Sidebar
  $('menuToggle').addEventListener('click', toggleSidebar);
  $('sidebarBackdrop').addEventListener('click', closeSidebar);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeSidebar();
  });
  $('backBtn').addEventListener('click', goBack);
  $('profileShortcut').addEventListener('click', () => navigate('profile'));

  // Search & filters
  ['librarySearch', 'subjectFilter', 'categoryFilter', 'sortFilter'].forEach(id => {
    $(id).addEventListener('input', renderLibrary);
  });
  $('homeSearchBtn').addEventListener('click', () => goToLibraryWith($('homeSearch').value));
  $('homeSearch').addEventListener('keydown', event => {
    if (event.key === 'Enter') goToLibraryWith($('homeSearch').value);
  });
  $('subjectGrid').addEventListener('click', event => {
    const tile = event.target.closest('.subject-tile');
    if (!tile) return;
    // "More subjects" opens the library with no subject picked, so every course is on offer.
    $('subjectFilter').value = tile.dataset.subject ?? '';
    navigate('library');
  });

  // Upload form
  const dropZone = $('dropZone');
  dropZone.addEventListener('click', () => $('reviewerFile').click());
  $('reviewerFile').addEventListener('change', event => updateFileLabel(event.target.files[0]));
  ['dragenter', 'dragover'].forEach(name => {
    dropZone.addEventListener(name, event => {
      event.preventDefault();
      dropZone.classList.add('drag');
    });
  });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag'));
  dropZone.addEventListener('drop', handleFileDrop);
  $('uploadForm').addEventListener('submit', handleUpload);
  $('uploadForm').addEventListener('reset', () => {
    // Wait for the form to clear before resetting the label and message.
    setTimeout(() => {
      updateFileLabel(null);
      setMessage($('uploadMessage'), '');
    }, 0);
  });

  // Profile & settings
  $('editProfileBtn').addEventListener('click', openEditProfile);
  $('profileEditForm').addEventListener('submit', handleProfileSave);
  $('cancelEditBtn').addEventListener('click', () => $('editDialog').close());
  $('passwordForm').addEventListener('submit', handlePasswordChange);

  // Appearance
  $('lightThemeBtn').addEventListener('click', () => {
    applyTheme({ ...getSavedTheme(), mode: 'light' });
  });
  $('darkThemeBtn').addEventListener('click', () => {
    applyTheme({ ...getSavedTheme(), mode: 'dark' });
  });
  $('navColor').addEventListener('input', event => {
    applyTheme({ ...getSavedTheme(), navColor: event.target.value });
  });
  $('resetThemeBtn').addEventListener('click', () => {
    applyTheme({ mode: 'light', navColor: DEFAULT_NAV_COLOR });
    showToast('Theme reset to default.');
  });
}

removeLegacyPasswords();
renderSubjects();
wireEvents();
applyTheme(getSavedTheme());
watchAuthState();
