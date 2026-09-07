import {
  SOURCES, isSource, splitKey, buildPostsUrl, buildAutocompleteUrl,
  buildCountUrl, buildTagCategoryUrl, buildPostLink, parsePosts, parseAutocomplete,
  parseCount, parseCountEnvelope, parseTagCategory, tagCategoryFromType,
  videoMimeType
} from './sources.js';
import { request, describeError } from './network.js';
import { storage } from './storage.js';
import { exportSnapshot, importSnapshot } from './backup.js';
import { saveJsonFile, saveMediaFile, cleanStaleCache } from './files.js';
import { openExternal } from './navigation.js';

export const app = {
  mode: '', page: 0, query: '', sort: 'new', currentView: 'home',
  infiniteScroll: true, isLoading: false, hasMore: true, favorites: [], blacklist: [], tracked: [],
  debounceTimer: null, currentPosts: [], currentViewerIndex: -1,
  fetchId: 0, searchController: null, seenIds: new Set(), savedTags: [], searchHistory: [], totalPostCount: 0,

  credentials: { r34: { uid: '', key: '' }, gel: { uid: '', key: '' } },

  settings: {
    vol: 1.0,
    muted: true,
    autoplayVideos: true,
    gridSize: 'medium',
    blurThumbs: false,
    themeColor: '#ff0055',
    themeRgb: '255, 0, 85'
  },

  async start() {
    this.bindEvents();

    try {
      await storage.open();
    } catch (e) {
      this.showStartupFailure(e);
      return;
    }

    await this.hydrate();
    this.applySettingsToUi();
    cleanStaleCache().catch(() => {});

    let requested = '';
    try {
      requested = new URLSearchParams(window.location.search).get('m') || '';
    } catch (e) {
      requested = '';
    }

    if (isSource(requested)) this.initMode(requested);
    else this.showGateway();
  },

  showGateway() {
    const gatewayScreen = document.getElementById('gateway-screen');
    const appLayout = document.getElementById('app-layout');
    if (gatewayScreen) gatewayScreen.style.display = 'flex';
    if (appLayout) appLayout.style.display = 'none';
    this.mode = '';
    this.invalidateRequests();
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete('m');
      this.safeReplaceState({}, url.href);
    } catch (e) { }
  },

  // Storage backs every list in the interface. A half-open database would show
  // a working app that silently drops each favorite, so refuse to start.
  showStartupFailure(err) {
    const gatewayScreen = document.getElementById('gateway-screen');
    if (!gatewayScreen) return;
    gatewayScreen.style.display = 'flex';
    const box = document.createElement('div');
    box.className = 'startup-error';
    const msg = document.createElement('p');
    msg.textContent = 'Local storage could not be opened: ' + ((err && err.message) || 'unknown error');
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'btn-outline-info';
    retry.textContent = 'Retry';
    retry.addEventListener('click', () => window.location.reload());
    box.append(msg, retry);
    gatewayScreen.prepend(box);
  },

  async hydrate() {
    const prefs = await storage.allPreferences();
    const read = (key, fallback) => (prefs[key] === undefined ? fallback : prefs[key]);

    this.favorites = read('favorites', []);
    this.blacklist = read('blacklist', []);
    this.tracked = read('tracked', []);
    this.savedTags = read('savedTags', []);
    this.searchHistory = read('searchHistory', []);
    this.seenIds = new Set(read('seenIds', []));
    this.infiniteScroll = read('infiniteScroll', true);
    Object.assign(this.settings, read('settings', {}));
    this._themeChosen = read('themeChosen', false);

    for (const source of Object.keys(SOURCES)) {
      this.credentials[source] = await storage.getCredentials(source);
    }
  },

  savePreference(key, value) {
    return storage.setPreference(key, value).catch(err => {
      this.toast('Could not save ' + key + ': ' + ((err && err.message) || 'storage error'));
    });
  },

  sourceCredentials(source = this.mode) {
    const creds = this.credentials[source];
    if (!creds || !creds.uid || !creds.key) return null;
    return creds;
  },

  // Every in-flight request carries the generation it started in. Bumping the
  // generation makes each late reply a no-op, which is the only defense on
  // native where a dispatched request cannot truly be cancelled.
  invalidateRequests() {
    this.fetchId = (this.fetchId || 0) + 1;
    this._acId = (this._acId || 0) + 1;
    this._viewerTagToken = null;
    if (this.searchController) {
      this.searchController.abort();
      this.searchController = null;
    }
    return this.fetchId;
  },

  toast(message) {
    const eor = document.getElementById('end-of-results');
    if (eor) {
      eor.textContent = message;
      eor.hidden = false;
    }
  },

  safePushState(state, url) {
    try { window.history.pushState(state, '', url); } catch (e) { }
  },

  safeReplaceState(state, url) {
    try { window.history.replaceState(state, '', url); } catch (e) { }
  },

  bindEvents() {
    document.querySelectorAll('.gw-card').forEach(btn => {
      btn.addEventListener('click', (e) => this.initMode(e.currentTarget.dataset.mode));
    });

    document.querySelectorAll('.nav-item[data-view]').forEach(btn => {
      btn.addEventListener('click', (e) => this.nav(e.currentTarget.dataset.view));
    });

    const switchDbBtn = document.getElementById('switch-db-btn');
    if (switchDbBtn) switchDbBtn.addEventListener('click', () => this.showGateway());

    const brandCompact = document.querySelector('.brand-compact');
    if (brandCompact) {
      brandCompact.style.cursor = 'pointer';
      brandCompact.addEventListener('click', () => this.showGateway());
    }

    const histBack = document.getElementById('history-back');
    const histFwd = document.getElementById('history-forward');
    if (histBack) histBack.addEventListener('click', () => { try { history.back(); } catch (e) { } });
    if (histFwd) histFwd.addEventListener('click', () => { try { history.forward(); } catch (e) { } });

    const searchInput = document.getElementById('search-input');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => this.handleAutocomplete(e.target.value));
      searchInput.addEventListener('focus', (e) => this.handleAutocomplete(e.target.value));
      searchInput.addEventListener('keydown', (e) => {
        const list = document.getElementById('suggestions-list');
        if (e.key === 'Enter') {
          const mv = document.getElementById('media-viewer');
          if (mv && mv.open) { e.preventDefault(); return; }
          e.preventDefault();
          this.executeSearch(searchInput.value.trim());
          if (list) list.hidden = true;
        } else if (e.key === 'Tab' && list && !list.hidden && list.firstElementChild) {
          e.preventDefault();
          list.firstElementChild.click();
        }
      });
      searchInput.addEventListener('blur', () => {
        setTimeout(() => {
          const list = document.getElementById('suggestions-list');
          if (list) list.hidden = true;
        }, 200);
      });
    }

    const settingsModal = document.getElementById('settings-modal');
    const settingsTrigger = document.getElementById('settings-trigger');
    const closeSettings = document.getElementById('close-settings');
    if (settingsModal) {
      if (settingsTrigger) settingsTrigger.addEventListener('click', () => settingsModal.showModal());
      if (closeSettings) closeSettings.addEventListener('click', () => settingsModal.close());
      settingsModal.addEventListener('click', (e) => {
        const rect = settingsModal.getBoundingClientRect();
        if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) {
          settingsModal.close();
        }
      });
    }

    const infScrollToggle = document.getElementById('inf-scroll-toggle');
    const blurThumbsToggle = document.getElementById('blur-thumbs-toggle');
    const muteToggle = document.getElementById('mute-videos-toggle');
    const autoplayToggle = document.getElementById('autoplay-videos-toggle');
    const gridSizeSelect = document.getElementById('grid-size-select');
    const sortSelect = document.getElementById('sort-select');

    if (infScrollToggle) infScrollToggle.addEventListener('click', () => {
      this.infiniteScroll = !this.infiniteScroll;
      this.savePreference('infiniteScroll', this.infiniteScroll);
      infScrollToggle.classList.toggle('active', this.infiniteScroll);
    });
    if (blurThumbsToggle) blurThumbsToggle.addEventListener('click', () => this.toggleBlurThumbs());
    if (muteToggle) muteToggle.addEventListener('click', () => this.toggleMuteVideos());
    if (autoplayToggle) autoplayToggle.addEventListener('click', () => this.toggleAutoplayVideos());
    if (gridSizeSelect) gridSizeSelect.addEventListener('change', (e) => this.setGridSize(e.target.value));
    if (sortSelect) sortSelect.addEventListener('change', (e) => this.setSort(e.target.value));

    document.querySelectorAll('.theme-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.theme-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.setTheme(btn.dataset.theme, btn.dataset.rgb);
      });
    });

    const viewer = document.getElementById('media-viewer');
    const closeViewerBtn = document.getElementById('close-viewer');
    if (closeViewerBtn) closeViewerBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); this.closeViewer(); });
    if (viewer) {
      viewer.addEventListener('click', (e) => {
        if (e.target.id === 'media-viewer' || e.target.id === 'lightbox-media-wrapper' || e.target.id === 'lightbox-media-container' || e.target.id === 'video-flex-container') {
          this.closeViewer();
        }
      });
    }

    const lbPrev = document.getElementById('lightbox-prev');
    const lbNext = document.getElementById('lightbox-next');
    if (lbPrev) lbPrev.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); this.prevMedia(); });
    if (lbNext) lbNext.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); this.nextMedia(); });

    const saveMediaBtn = document.getElementById('viewer-save-btn');
    if (saveMediaBtn) saveMediaBtn.addEventListener('click', () => this.saveCurrentMedia());

    document.addEventListener('keydown', (e) => {
      if (!viewer || !viewer.open) return;
      if (e.key === 'Escape') { e.preventDefault(); this.closeViewer(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); this.prevMedia(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); this.nextMedia(); }
    });

    const addFavBtn = document.getElementById('add-fav-btn');
    const addBlBtn = document.getElementById('add-bl-btn');
    const addTrackBtn = document.getElementById('add-track-btn');
    const favInput = document.getElementById('fav-input');
    const blInput = document.getElementById('bl-input');
    const trackInput = document.getElementById('track-input');
    const backupBtn = document.getElementById('backup-btn');
    const restoreBtn = document.getElementById('restore-btn');
    const restoreFileInput = document.getElementById('restore-file-input');
    const resetAlgoBtn = document.getElementById('reset-algo-btn');

    if (addFavBtn) addFavBtn.addEventListener('click', () => this.addFavoriteTag());
    if (addBlBtn) addBlBtn.addEventListener('click', () => this.addBlacklistTag());
    if (addTrackBtn) addTrackBtn.addEventListener('click', () => this.addTrackedTag());
    if (favInput) favInput.addEventListener('keydown', e => { if (e.key === 'Enter') this.addFavoriteTag(); });
    if (blInput) blInput.addEventListener('keydown', e => { if (e.key === 'Enter') this.addBlacklistTag(); });
    if (trackInput) trackInput.addEventListener('keydown', e => { if (e.key === 'Enter') this.addTrackedTag(); });

    if (backupBtn) backupBtn.addEventListener('click', () => this.backupData());
    if (restoreBtn) restoreBtn.addEventListener('click', () => { if (restoreFileInput) restoreFileInput.click(); });
    if (restoreFileInput) restoreFileInput.addEventListener('change', (e) => this.restoreData(e));
    if (resetAlgoBtn) resetAlgoBtn.addEventListener('click', () => this.resetAlgo());

    const gridViewContainer = document.getElementById('grid-view');
    if (gridViewContainer) {
      gridViewContainer.addEventListener('scroll', (e) => {
        const { scrollTop, scrollHeight, clientHeight } = e.target;
        if (scrollHeight - scrollTop - clientHeight < 1200) {
          if (this.infiniteScroll && this.hasMore && !this.isLoading && ['explore', 'home'].includes(this.currentView)) {
            this.nextPage();
          }
        }
      });
    }

    // Account settings, bound once here rather than inside loadSettings, which
    // used to re-add a listener every time it ran.
    for (const source of Object.keys(SOURCES)) {
      const saveBtn = document.getElementById(`save-${source}-creds-btn`);
      const clearBtn = document.getElementById(`clear-${source}-creds-btn`);
      if (saveBtn) saveBtn.addEventListener('click', () => this.saveCredentials(source));
      if (clearBtn) clearBtn.addEventListener('click', () => this.clearCredentials(source));
    }

    window.addEventListener('popstate', (e) => {
      const state = e.state || {};
      if (!isSource(this.mode)) {
        this.showGateway();
        return;
      }
      this.query = typeof state.query === 'string' ? state.query : '';
      const si = document.getElementById('search-input');
      if (si) si.value = this.query;
      this.loadView(this.knownView(state.view) ? state.view : 'home');
    });
  },

  knownView(view) {
    return ['home', 'explore', 'vault', 'keep_up', 'reels'].includes(view);
  },

  initMode(mode) {
    if (!isSource(mode)) {
      this.showGateway();
      return;
    }
    this.invalidateRequests();
    this.mode = mode;

    const source = SOURCES[mode];
    if (this._themeChosen) this.setTheme(this.settings.themeColor, this.settings.themeRgb, false);
    else this.setTheme(source.accent, source.accentRgb, false);

    const gatewayScreen = document.getElementById('gateway-screen');
    const appLayout = document.getElementById('app-layout');
    if (gatewayScreen) gatewayScreen.style.display = 'none';
    if (appLayout) appLayout.style.display = 'flex';

    const searchInput = document.getElementById('search-input');
    if (searchInput) searchInput.placeholder = `Search ${source.label} tags (space separated)...`;

    const vaultLabel = document.querySelector('#nav-media-vault .nav-label');
    if (vaultLabel) vaultLabel.textContent = 'Vault';

    try {
      const url = new URL(window.location.href);
      url.searchParams.set('m', mode);
      this.safeReplaceState({ view: 'home', query: '' }, url.href);
    } catch (e) { }

    this.nav('home', false);
  },

  /** Push hydrated settings into the interface. No storage reads happen here. */
  applySettingsToUi() {
    const setToggle = (id, on) => {
      const el = document.getElementById(id);
      if (el) el.classList.toggle('active', Boolean(on));
    };
    setToggle('mute-videos-toggle', this.settings.muted);
    setToggle('autoplay-videos-toggle', this.settings.autoplayVideos);
    setToggle('inf-scroll-toggle', this.infiniteScroll);
    setToggle('blur-thumbs-toggle', this.settings.blurThumbs);
    document.body.classList.toggle('blur-thumbs', Boolean(this.settings.blurThumbs));

    this.setGridSize(this.settings.gridSize || 'medium', false);
    const gSel = document.getElementById('grid-size-select');
    if (gSel) gSel.value = this.settings.gridSize || 'medium';

    this.setTheme(this.settings.themeColor, this.settings.themeRgb, false);
    document.querySelectorAll('.theme-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.theme === this.settings.themeColor);
    });

    this.renderChips('fav-tags-list', this.favorites, 'fav', tag => this.removeFavoriteTag(tag));
    this.renderChips('bl-tags-list', this.blacklist, 'bl', tag => this.removeBlacklistTag(tag));
    this.renderChips('track-tags-list', this.tracked, 'track', tag => this.removeTrackedTag(tag));
    this.renderSavedTagChips();
    this.renderSearchHistory();

    for (const source of Object.keys(SOURCES)) {
      const uidEl = document.getElementById(`${source}-uid-input`);
      const keyEl = document.getElementById(`${source}-key-input`);
      if (uidEl) uidEl.value = this.credentials[source].uid;
      if (keyEl) keyEl.value = this.credentials[source].key;
    }
  },

  async saveCredentials(source) {
    if (!isSource(source)) return;
    const status = document.getElementById(`${source}-creds-status`);
    const uid = (document.getElementById(`${source}-uid-input`) || {}).value || '';
    const key = (document.getElementById(`${source}-key-input`) || {}).value || '';
    try {
      await storage.setCredentials(source, { uid, key });
      this.credentials[source] = { uid: uid.trim(), key: key.trim() };
      // Anything already in flight was authorized with the old account.
      this.invalidateRequests();
      if (status) status.textContent = this.credentials[source].uid ? 'Saved.' : 'Cleared.';
    } catch (err) {
      if (status) status.textContent = (err && err.message) || 'Could not save those details.';
    }
  },

  async clearCredentials(source) {
    if (!isSource(source)) return;
    const status = document.getElementById(`${source}-creds-status`);
    try {
      await storage.clearCredentials(source);
      this.credentials[source] = { uid: '', key: '' };
      const uidEl = document.getElementById(`${source}-uid-input`);
      const keyEl = document.getElementById(`${source}-key-input`);
      if (uidEl) uidEl.value = '';
      if (keyEl) keyEl.value = '';
      this.invalidateRequests();
      if (status) status.textContent = 'Cleared.';
    } catch (err) {
      if (status) status.textContent = (err && err.message) || 'Could not clear those details.';
    }
  },

  saveSettings() {
    return this.savePreference('settings', { ...this.settings });
  },

  toggleBlurThumbs() {
    this.settings.blurThumbs = !this.settings.blurThumbs;
    this.saveSettings();
    const bt = document.getElementById('blur-thumbs-toggle');
    if (bt) bt.classList.toggle('active', this.settings.blurThumbs);
    document.body.classList.toggle('blur-thumbs', this.settings.blurThumbs);
  },

  toggleMuteVideos() {
    this.settings.muted = !this.settings.muted;
    this.saveSettings();
    const t = document.getElementById('mute-videos-toggle');
    if (t) t.classList.toggle('active', this.settings.muted);
  },

  toggleAutoplayVideos() {
    this.settings.autoplayVideos = !this.settings.autoplayVideos;
    this.saveSettings();
    const t = document.getElementById('autoplay-videos-toggle');
    if (t) t.classList.toggle('active', this.settings.autoplayVideos);
  },

  setGridSize(size, save = true) {
    this.settings.gridSize = ['small', 'medium', 'large'].includes(size) ? size : 'medium';
    const px = { small: '200px', medium: '280px', large: '350px' }[this.settings.gridSize];
    document.documentElement.style.setProperty('--grid-size', px);
    if (save) this.saveSettings();
  },

  setTheme(color, rgb, save = true) {
    this.settings.themeColor = color;
    this.settings.themeRgb = rgb;
    document.documentElement.style.setProperty('--accent', color);
    document.documentElement.style.setProperty('--accent-rgb', rgb);
    if (save) {
      this._themeChosen = true;
      this.saveSettings();
      this.savePreference('themeChosen', true);
    }
  },

  setSort(val) {
    this.sort = val;
    if (this.currentView === 'explore' || this.currentView === 'home') {
      this.resetFeed();
      this.fetchData();
    }
  },

  // Every fresh feed starts at page zero with an empty grid; only a successful
  // fetch is allowed to move the page forward.
  resetFeed() {
    this.invalidateRequests();
    this.page = 0;
    this.currentPosts = [];
    this.hasMore = true;
    this.isLoading = false;
    const grid = document.getElementById('media-grid');
    if (grid) grid.replaceChildren();
  },

  addTagTo(listName, inputId, containerId, typeClass, remove, weight) {
    const inp = document.getElementById(inputId);
    if (!inp) return;
    const val = inp.value.trim().toLowerCase();
    if (!val || this[listName].includes(val)) return;
    this[listName].push(val);
    this.savePreference(listName, this[listName]);
    this.renderChips(containerId, this[listName], typeClass, remove);
    if (weight) this.trackTags([val], weight);
    inp.value = '';
  },

  removeTagFrom(listName, tag, containerId, typeClass, remove) {
    this[listName] = this[listName].filter(t => t !== tag);
    this.savePreference(listName, this[listName]);
    this.renderChips(containerId, this[listName], typeClass, remove);
  },

  addFavoriteTag() {
    this.addTagTo('favorites', 'fav-input', 'fav-tags-list', 'fav', t => this.removeFavoriteTag(t), 50);
  },

  removeFavoriteTag(tag) {
    this.removeTagFrom('favorites', tag, 'fav-tags-list', 'fav', t => this.removeFavoriteTag(t));
  },

  addBlacklistTag() {
    this.addTagTo('blacklist', 'bl-input', 'bl-tags-list', 'bl', t => this.removeBlacklistTag(t), 0);
  },

  removeBlacklistTag(tag) {
    this.removeTagFrom('blacklist', tag, 'bl-tags-list', 'bl', t => this.removeBlacklistTag(t));
  },

  addTrackedTag() {
    this.addTagTo('tracked', 'track-input', 'track-tags-list', 'track', t => this.removeTrackedTag(t), 0);
  },

  removeTrackedTag(tag) {
    this.removeTagFrom('tracked', tag, 'track-tags-list', 'track', t => this.removeTrackedTag(t));
  },

  renderChips(containerId, list, typeClass, onClick) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.replaceChildren();
    const prefix = typeClass === 'fav' ? '★ ' : typeClass === 'track' ? '🔔 ' : '';
    list.forEach(tag => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `chip ${typeClass}`;
      // Tag text is user- and source-supplied; build it as text, never markup.
      btn.textContent = `${prefix}${tag} ✕`;
      btn.addEventListener('click', () => onClick(tag));
      container.appendChild(btn);
    });
  },

  isBlacklisted(post) {
    if (!post.tags || this.blacklist.length === 0) return false;
    const pt = typeof post.tags === 'string' ? post.tags.split(' ') : [];
    return this.blacklist.some(b => pt.includes(b));
  },

  async trackTags(tags, weight) {
    if (!Array.isArray(tags) || tags.length === 0) return;
    try {
      await storage.bumpTagStats(tags, weight);
    } catch (e) { }
  },

  weightedRandom(items) {
    if (items.length === 0) return null;
    const total = items.reduce((acc, item) => acc + item.score, 0);
    let r = Math.random() * total;
    for (const item of items) {
      r -= item.score;
      if (r <= 0) return item;
    }
    return items[0];
  },

  async executeSearch(term) {
    if (!isSource(this.mode)) return;
    this.query = String(term || '');
    this.saveSearchHistory(this.query);
    const si = document.getElementById('search-input');
    if (si) si.value = this.query;
    this.safePushState({ view: 'explore', query: this.query }, window.location.href);

    if (this.query) this.trackTags(this.query.split(/\s+/).filter(Boolean), 5);
    this.nav('explore', false);
  },

  async nav(view, push = true) {
    if (!this.knownView(view)) view = 'home';
    if (push) this.safePushState({ view, query: this.query }, window.location.href);
    return this.loadView(view);
  },

  async loadView(view) {
    if (!isSource(this.mode)) {
      this.showGateway();
      return;
    }
    if (!this.knownView(view)) view = 'home';
    this.currentView = view;

    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    const activeNav = document.querySelector(`.nav-item[data-view="${view}"]`);
    if (activeNav) activeNav.classList.add('active');

    const titleEl = document.getElementById('current-view-title');
    if (titleEl) titleEl.textContent = view.toUpperCase().replace('_', ' ');

    const countEl = document.getElementById('post-count-display');
    if (countEl) { countEl.style.display = 'none'; countEl.textContent = ''; }
    this.renderSearchHistory();

    const gridView = document.getElementById('grid-view');
    const keepUpView = document.getElementById('keep-up-view');
    const reelsView = document.getElementById('reels-view');

    const gridVisible = ['home', 'explore', 'vault'].includes(view);
    if (gridView) gridView.style.display = gridVisible ? 'block' : 'none';
    if (keepUpView) keepUpView.style.display = view === 'keep_up' ? 'block' : 'none';
    if (reelsView) reelsView.style.display = view === 'reels' ? 'block' : 'none';

    if (view !== 'reels') this.teardownReels();

    const eor = document.getElementById('end-of-results');
    if (eor) eor.hidden = true;
    this.resetFeed();

    if (view === 'vault') {
      // The vault shows the selected source only: Rule34 post 42 and Gelbooru
      // post 42 are separate rows and must not appear side by side here.
      const saved = await storage.postsBySource('likes', this.mode);
      this.currentPosts = saved;
      if (saved.length === 0) this.toast('No saved posts from ' + SOURCES[this.mode].label + ' yet.');
      else this.renderCards(saved);
    } else if (view === 'home') {
      this.loadSmartHome();
    } else if (view === 'explore') {
      this.fetchData();
    } else if (view === 'keep_up') {
      this.loadKeepUp();
    } else if (view === 'reels') {
      this.loadReels();
    }
  },

  // For You is a local weighted-tag pick from what the user has liked, saved and
  // watched. There is no model and no network call behind it.
  async loadSmartHome() {
    let stats = [];
    try {
      stats = (await storage.all('tag_stats')).filter(s => s && s.tag && Number(s.score) > 0);
    } catch (e) {
      stats = [];
    }

    const starterTags = [...this.favorites, ...this.tracked, ...this.savedTags]
      .filter(Boolean)
      .map(tag => ({ tag, score: 12 }));

    const blended = [...stats, ...starterTags].reduce((map, item) => {
      const key = String(item.tag).trim().toLowerCase();
      if (!key) return map;
      const prev = map.get(key) || { tag: key, score: 0 };
      prev.score += Number(item.score) || 1;
      map.set(key, prev);
      return map;
    }, new Map());

    const topTags = Array.from(blended.values()).sort((a, b) => b.score - a.score).slice(0, 12);

    if (topTags.length === 0) {
      this.toast('Explore, favorite, like, or save tags to train your For You feed. Showing fresh posts for now.');
      this.query = '';
      this.fetchData(true);
      return;
    }

    const pick = this.weightedRandom(topTags.slice(0, 8)) || topTags[0];

    const titleEl = document.getElementById('current-view-title');
    if (titleEl) {
      titleEl.replaceChildren();
      titleEl.append('FOR YOU ');
      const subtitle = document.createElement('span');
      subtitle.className = 'fyp-subtitle';
      subtitle.textContent = 'recommended from your likes, favorites, saved tags, and watched posts';
      const row = document.createElement('span');
      row.className = 'fyp-chip-row';
      topTags.slice(0, 5).forEach(t => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'fyp-chip';
        chip.textContent = String(t.tag).replace(/_/g, ' ');
        chip.addEventListener('click', () => this.executeSearch(t.tag));
        row.appendChild(chip);
      });
      titleEl.append(subtitle, row);
    }

    this.query = pick.tag;
    this.fetchData(true);
  },

  async loadKeepUp() {
    const container = document.getElementById('keep-up-content');
    const loader = document.getElementById('keep-up-loader');
    if (!container) return;

    container.innerHTML = '';
    if (!this.tracked || this.tracked.length === 0) {
      container.innerHTML = '<div class="end-msg" style="display:block;">You are not tracking any tags yet. Add some in settings!</div>';
      return;
    }

    if (loader) loader.hidden = false;
    const generation = this.fetchId;

    for (const tag of this.tracked) {
      const section = document.createElement('div');
      section.className = 'ku-section';

      const header = document.createElement('div');
      header.className = 'ku-header';

      const title = document.createElement('h3');
      title.className = 'ku-title';
      title.textContent = tag.replace(/_/g, ' ');
      title.addEventListener('click', () => this.executeSearch(tag));

      const viewAll = document.createElement('button');
      viewAll.type = 'button';
      viewAll.className = 'btn-outline-info ku-view-all';
      viewAll.textContent = 'View All';
      viewAll.addEventListener('click', () => this.executeSearch(tag));

      header.append(title, viewAll);

      const row = document.createElement('div');
      row.className = 'ku-row';
      row.appendChild(this.spinnerNode());

      section.append(header, row);
      container.appendChild(section);

      this.fetchKeepUpData(tag, row, generation);
    }

    if (loader) loader.hidden = true;
  },

  spinnerNode() {
    const wrap = document.createElement('div');
    wrap.className = 'row-spinner';
    const spinner = document.createElement('div');
    spinner.className = 'spinner';
    wrap.appendChild(spinner);
    return wrap;
  },

  rowMessage(row, text, tone) {
    row.replaceChildren();
    const msg = document.createElement('div');
    msg.className = 'ku-row-msg' + (tone ? ' ' + tone : '');
    msg.textContent = text;
    row.appendChild(msg);
  },

  async fetchKeepUpData(query, rowElement, generation) {
    const source = this.mode;
    try {
      const url = buildPostsUrl(source, { query, sort: 'new', page: 0, limit: 15 }, this.sourceCredentials(source));
      const raw = await request(url, { format: 'json' });
      if (this.fetchId !== generation) return;

      const posts = parsePosts(source, raw).filter(p => !this.isBlacklisted(p));

      if (posts.length === 0) {
        this.rowMessage(rowElement, 'No recent posts found for this track.');
        return;
      }

      rowElement.replaceChildren();
      const known = new Set(this.currentPosts.map(p => p.key));
      this.currentPosts.push(...posts.filter(p => !known.has(p.key)));
      this.renderCards(posts, rowElement, true);
    } catch (error) {
      if (this.fetchId !== generation) return;
      this.rowMessage(rowElement, describeError(error).message, 'is-error');
    }
  },

  /**
   * Render the feed's end state. `retry` re-runs the same page; `settings`
   * opens account setup. Neither clears the grid that is already on screen.
   */
  showFeedState(message, options = {}) {
    const eor = document.getElementById('end-of-results');
    if (!eor) return;
    eor.replaceChildren();

    const text = document.createElement('span');
    text.textContent = message;
    eor.appendChild(text);

    if (options.retry) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn-outline-info eor-action';
      btn.textContent = 'Retry';
      btn.addEventListener('click', () => {
        eor.hidden = true;
        this.isLoading = false;
        this.fetchData(options.isAuto);
      });
      eor.appendChild(btn);
    }
    if (options.settings) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn-outline-info eor-action';
      btn.textContent = 'Open settings';
      btn.addEventListener('click', () => {
        const modal = document.getElementById('settings-modal');
        if (modal && typeof modal.showModal === 'function') modal.showModal();
      });
      eor.appendChild(btn);
    }
    eor.hidden = false;
  },

  async fetchData(isAuto = false, filteredScanDepth = 0) {
    if (!isSource(this.mode) || this.isLoading) return;
    this.isLoading = true;

    const source = this.mode;
    const generation = ++this.fetchId;
    this.searchController = new AbortController();
    const signal = this.searchController.signal;
    const requestedPage = this.page;

    const loader = document.getElementById('loader');
    const eor = document.getElementById('end-of-results');
    if (loader) loader.hidden = false;
    if (eor) eor.hidden = true;

    try {
      const url = buildPostsUrl(
        source,
        { query: this.query, sort: this.sort, page: requestedPage, limit: 20 },
        this.sourceCredentials(source)
      );
      const raw = await request(url, { format: 'json', signal });
      if (this.fetchId !== generation) return;

      // A malformed or blocked response throws out of here. It is never
      // flattened into an empty page that would read as "no results".
      const posts = parsePosts(source, raw);
      const fetchedCount = posts.length;

      if (requestedPage === 0) this.updateCountForPage(source, raw, posts, generation);

      const visible = posts.filter(p => !this.isBlacklisted(p));

      // Sink already-seen posts on the recommendation feed only. A plain tag
      // search keeps the source order so a post does not appear to move.
      if (isAuto || this.currentView === 'home') {
        visible.sort((a, b) => Number(this.seenIds.has(a.key)) - Number(this.seenIds.has(b.key)));
      }

      if (fetchedCount === 0) {
        if (this.currentPosts.length === 0 && !this.sourceCredentials(source)) {
          this.showFeedState(
            'No results from ' + SOURCES[source].label + '. If you have an account there, add your user ID and API key in Settings, or try a different tag.',
            { settings: true }
          );
        } else {
          this.showFeedState(this.currentPosts.length === 0 ? 'No results found.' : 'End of results.');
        }
        this.hasMore = false;
        return;
      }

      this.currentPosts.push(...visible);
      const rendered = await this.renderCards(visible, document.getElementById('media-grid'));

      const gridView = document.getElementById('grid-view');
      const viewportNeedsMore = Boolean(
        gridView && gridView.clientHeight > 0 && gridView.scrollHeight <= gridView.clientHeight + 80
      );

      // The page advances only after a page that actually succeeded.
      if ((rendered < 10 || viewportNeedsMore) && this.infiniteScroll && this.hasMore && filteredScanDepth < 8) {
        this.page = requestedPage + 1;
        this.isLoading = false;
        return this.fetchData(isAuto, filteredScanDepth + 1);
      }

      if (rendered === 0 && this.currentPosts.length === 0) {
        const blockedTags = [...new Set(posts.flatMap(post => {
          const postTags = typeof post.tags === 'string' ? post.tags.split(' ') : [];
          return this.blacklist.filter(tag => postTags.includes(tag));
        }))];
        this.showFeedState(blockedTags.length
          ? 'Results found, but hidden by your blacklist: ' + blockedTags.slice(0, 4).join(', ') + '.'
          : 'No results found.');
      }
    } catch (error) {
      if (this.fetchId !== generation) return;
      const info = describeError(error);
      // Keep the loaded grid and the current page number: a failed page must
      // not look like the end of the results, and must not consume a page.
      this.page = requestedPage;
      this.hasMore = false;
      this.showFeedState(info.message, { retry: info.canRetry, settings: info.needsSettings, isAuto });
    } finally {
      if (this.fetchId === generation) {
        this.isLoading = false;
        if (loader) loader.hidden = true;
      }
    }
  },

  // Gelbooru reports the total in the same envelope; Rule34 needs a second XML
  // call. Either one failing is cosmetic and must not disturb loaded posts.
  updateCountForPage(source, raw, posts, generation) {
    if (source === 'gel') {
      const count = parseCountEnvelope(raw);
      if (count !== null) this.updatePostCount(count);
      else if (posts.length === 0) this.updatePostCount(0);
      return;
    }
    this.fetchR34Count(this.query, generation).catch(() => {});
  },

  async nextPage() {
    if (this.isLoading || !this.hasMore) return;
    this.page++;
    await this.fetchData();
  },

  /**
   * Build the grid cards. Everything here is created as DOM nodes: post tags
   * and media URLs come straight from the source API, and this app runs inside
   * a web view with the native bridge attached, so no source value is ever
   * interpolated into markup.
   */
  async renderCards(posts, targetContainer = document.getElementById('media-grid'), isKeepUp = false) {
    const grid = targetContainer;
    if (!Array.isArray(posts) || posts.length === 0 || !grid) return 0;

    let likedSet = new Set();
    let favedSet = new Set();
    try {
      // Cache the liked/saved key sets briefly so infinite scroll does not
      // re-read the whole store per page. Invalidated on every toggle.
      const now = Date.now();
      let cache = this._favCache;
      if (!cache || (now - cache.ts) > 4000) {
        const [hearts, likes] = await Promise.all([storage.all('hearts'), storage.all('likes')]);
        cache = this._favCache = {
          liked: new Set(hearts.map(r => r.key)),
          faved: new Set(likes.map(r => r.key)),
          ts: now
        };
      }
      likedSet = cache.liked;
      favedSet = cache.faved;
    } catch (e) { }

    // Collect the ids already in this grid once, rather than querying the DOM
    // per card: post keys contain a colon, which querySelector cannot take
    // unescaped, and that used to abort the render part-way through.
    const existing = new Set();
    for (const child of grid.children) {
      const el = isKeepUp ? (child.firstElementChild || child) : child;
      if (el && el.id) existing.add(el.id);
    }

    const fragment = document.createDocumentFragment();
    let count = 0;

    for (const p of posts) {
      const thumb = p.kind === 'video'
        ? (p.preview_url || p.sample_url)
        : (p.sample_url || p.preview_url || p.file_url);
      if (!thumb) continue;

      const elementId = `card-${p.key}${isKeepUp ? '-ku' : ''}`;
      if (existing.has(elementId)) continue;
      existing.add(elementId);

      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'media-card';
      card.id = elementId;
      card.dataset.key = p.key;
      card.style.animationDelay = `${(count % 10) * 0.05}s`;
      if (this.seenIds.has(p.key)) card.classList.add('seen-card');
      card.setAttribute('aria-label', `View ${p.kind} ${p.id} on ${SOURCES[p.source].label}`);
      card.addEventListener('click', () => this.openViewer(p));

      const img = document.createElement('img');
      img.loading = 'lazy';
      img.referrerPolicy = 'no-referrer';
      img.alt = p.tags ? p.tags.split(' ').slice(0, 5).join(' ') : 'Media content';
      img.src = thumb;
      const fallback = p.preview_url || p.sample_url || '';
      img.addEventListener('error', () => {
        // One fallback only, and no public image proxy: a failed thumbnail
        // fades out rather than being routed through a third party.
        if (fallback && img.src !== fallback && !img.dataset.fb) {
          img.dataset.fb = '1';
          img.src = fallback;
        } else {
          img.style.opacity = '0';
        }
      });
      card.appendChild(img);

      if (p.kind === 'video' || p.kind === 'gif') {
        const badge = document.createElement('div');
        badge.className = p.kind === 'video' ? 'badge-type video' : 'badge-type gif';
        badge.textContent = p.kind.toUpperCase();
        card.appendChild(badge);
      }

      const actions = document.createElement('div');
      actions.className = 'card-actions card-actions-br';
      if (likedSet.has(p.key)) actions.appendChild(this.iconNode('heart'));
      if (favedSet.has(p.key)) actions.appendChild(this.iconNode('star'));
      card.appendChild(actions);

      if (isKeepUp) {
        const wrapper = document.createElement('div');
        wrapper.className = 'ku-card-wrapper';
        wrapper.appendChild(card);
        fragment.appendChild(wrapper);
      } else {
        fragment.appendChild(card);
      }
      count++;
    }

    grid.appendChild(fragment);
    return count;
  },

  iconNode(name) {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'card-icon');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'currentColor');
    svg.style.color = name === 'heart' ? 'var(--heart)' : 'var(--star)';
    if (name === 'heart') {
      const path = document.createElementNS(NS, 'path');
      path.setAttribute('d', 'M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z');
      svg.appendChild(path);
    } else {
      const polygon = document.createElementNS(NS, 'polygon');
      polygon.setAttribute('points', '12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2');
      svg.appendChild(polygon);
    }
    return svg;
  },

  normalizeTagArray(tags) {
    if (Array.isArray(tags)) {
      const arr = tags.map(t => String(t || '').trim()).filter(Boolean);
      const mostlySingleChars = arr.length > 8 && arr.filter(t => t.length <= 1).length / arr.length > 0.7;
      if (!mostlySingleChars) return arr;
      tags = tags.map(t => String(t || '')).join('');
    }
    return String(tags || '')
      .split(/[\s,]+/)
      .map(t => t.trim())
      .filter(Boolean);
  },

  tagCategoryFromType(type) {
    return tagCategoryFromType(type);
  },

  tagCacheKey(source, tag) {
    return `${source}:${String(tag).toLowerCase()}`;
  },

  loadTagCategoryCache() {
    if (!this._tagCategoryCache) this._tagCategoryCache = new Map();
    if (this._tagCategoryCacheLoaded) return;
    this._tagCategoryCacheLoaded = true;
    storage.get('preferences', 'tagCategories').then(row => {
      const rows = row && Array.isArray(row.value) ? row.value : [];
      for (const entry of rows) {
        if (Array.isArray(entry) && entry[0] && entry[1]) this._tagCategoryCache.set(entry[0], entry[1]);
      }
    }).catch(() => {});
  },

  saveTagCategoryCacheSoon() {
    if (this._tagCategoryCacheSaveTimer) clearTimeout(this._tagCategoryCacheSaveTimer);
    this._tagCategoryCacheSaveTimer = setTimeout(() => {
      const rows = Array.from(this._tagCategoryCache || new Map()).filter(([, value]) => value).slice(-2500);
      this.savePreference('tagCategories', rows);
    }, 250);
  },

  // Offline guess used until (or instead of) the source's own tag metadata.
  guessTagCategory(tag) {
    const pretty = String(tag || '').replace(/_/g, ' ').toLowerCase().trim();
    if (!pretty) return 'General';
    if (/\b(video|animated|animation|gif|loop|sound|webm|mp4|watermark|third-party|edit|translation|subtitles?|4k|hd|shorter than|longer than|seconds?)\b/.test(pretty)) return 'Meta';
    if (/\b(game|comics?|anime|manga|movie|series|cartoon)\b/.test(pretty)) return 'Copyright';
    return 'General';
  },

  async fetchTagCategory(tag, source = this.mode) {
    const normalized = String(tag || '').trim();
    if (!normalized || !isSource(source)) return null;

    const cacheKey = this.tagCacheKey(source, normalized);
    this.loadTagCategoryCache();
    if (this._tagCategoryCache.has(cacheKey)) return this._tagCategoryCache.get(cacheKey);

    let category = null;
    try {
      const url = buildTagCategoryUrl(source, normalized, this.sourceCredentials(source));
      const raw = await request(url, { format: source === 'gel' ? 'json' : 'text' });
      category = parseTagCategory(source, raw, normalized);
    } catch (e) {
      // Tag categories are decoration. A failure here must never disturb the
      // post that is already open.
      category = null;
    }

    this._tagCategoryCache.set(cacheKey, category || this.guessTagCategory(normalized));
    this.saveTagCategoryCacheSoon();
    return this._tagCategoryCache.get(cacheKey);
  },

  /** Fill in real tag categories for the open post, four requests at a time. */
  async hydrateViewerTagCategories(tagsArr, token, source = this.mode) {
    if (!isSource(source)) return;
    const tags = this.normalizeTagArray(tagsArr).slice(0, 80);
    if (!tags.length) return;

    for (let i = 0; i < tags.length; i += 4) {
      if (token && this._viewerTagToken !== token) return;
      await Promise.all(tags.slice(i, i + 4).map(tag => this.fetchTagCategory(tag, source)));
    }
    if (token && this._viewerTagToken !== token) return;
    const viewerTags = document.getElementById('viewer-tags');
    if (viewerTags) this.renderViewerTags(viewerTags, tagsArr, source);
  },

  prevMedia() {
    if (this.currentViewerIndex > 0) {
      this.openViewer(this.currentPosts[this.currentViewerIndex - 1]);
    }
  },

  nextMedia() {
    if (this.currentViewerIndex < this.currentPosts.length - 1) {
      this.openViewer(this.currentPosts[this.currentViewerIndex + 1]);
    }
  },

  categorizeViewerTags(tags, source = this.mode) {
    this.loadTagCategoryCache();
    const groups = { Copyright: [], Character: [], Artist: [], General: [], Meta: [] };
    this.normalizeTagArray(tags).forEach(rawTag => {
      const tag = String(rawTag || '').trim();
      if (!tag) return;
      const fetched = this._tagCategoryCache && this._tagCategoryCache.get(this.tagCacheKey(source, tag));
      const category = (fetched && groups[fetched]) ? fetched : this.guessTagCategory(tag);
      (groups[category] || groups.General).push(tag);
    });
    return groups;
  },

  /** Fill `container` with the post's tags, grouped. Built as DOM, not markup. */
  renderViewerTags(container, tagsArr, source = this.mode) {
    const groups = this.categorizeViewerTags(tagsArr, source);
    container.replaceChildren();

    const entries = Object.entries(groups).filter(([, tags]) => tags.length);
    if (entries.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'tag-empty';
      empty.textContent = 'No tags on this post';
      container.appendChild(empty);
      return;
    }

    for (const [group, tags] of entries) {
      tags.sort((a, b) => String(a).localeCompare(String(b)));
      const section = document.createElement('div');
      section.className = `tag-group booru-tag-group booru-tag-group-${group.toLowerCase()}`;

      const heading = document.createElement('h4');
      heading.textContent = group;
      section.appendChild(heading);

      const list = document.createElement('div');
      list.className = 'tag-list booru-tag-list';
      for (const tag of tags) {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'tag-row booru-tag-row';
        row.dataset.tag = tag;

        const name = document.createElement('span');
        name.className = 'tag-name';
        name.textContent = tag.replace(/_/g, ' ');
        row.appendChild(name);

        const star = document.createElement('span');
        star.className = 'tag-action' + (this.favorites.includes(tag) ? ' active' : '');
        star.dataset.action = 'star';
        star.textContent = '★';
        star.title = 'Favorite this tag';

        const save = document.createElement('span');
        save.className = 'tag-action' + (this.savedTags.includes(tag) ? ' saved' : '');
        save.dataset.action = 'save';
        save.textContent = '📌';
        save.title = 'Save this tag';

        row.append(star, save);
        row.addEventListener('click', (e) => this.onViewerTagClick(e, tag));
        list.appendChild(row);
      }
      section.appendChild(list);
      container.appendChild(section);
    }
  },

  onViewerTagClick(event, tag) {
    const actionEl = event.target.closest('[data-action]');
    const action = actionEl ? actionEl.dataset.action : '';
    if (action === 'star') {
      event.stopPropagation();
      if (this.favorites.includes(tag)) {
        this.removeFavoriteTag(tag);
        actionEl.classList.remove('active');
      } else {
        this.favorites.push(tag);
        this.savePreference('favorites', this.favorites);
        this.renderChips('fav-tags-list', this.favorites, 'fav', t => this.removeFavoriteTag(t));
        this.trackTags([tag], 50);
        actionEl.classList.add('active');
      }
      return;
    }
    if (action === 'save') {
      event.stopPropagation();
      if (this.savedTags.includes(tag)) {
        this.removeSavedTag(tag);
        actionEl.classList.remove('saved');
      } else {
        this.saveTag(tag);
        actionEl.classList.add('saved');
      }
      return;
    }
    this.closeViewer();
    this.executeSearch(tag);
  },

  async openViewer(p) {
    const dialog = document.getElementById('media-viewer');
    const mediaContainer = document.getElementById('lightbox-media-container');
    if (!dialog || !mediaContainer || !p || !p.key) return;

    if (!dialog.open) dialog.showModal();

    this.currentViewerPost = p;
    this.markSeen(p.key);

    this.currentViewerIndex = this.currentPosts.findIndex(x => x.key === p.key);
    const lbPrev = document.getElementById('lightbox-prev');
    const lbNext = document.getElementById('lightbox-next');
    if (lbPrev) lbPrev.style.display = this.currentViewerIndex > 0 ? 'grid' : 'none';
    if (lbNext) lbNext.style.display = this.currentViewerIndex < this.currentPosts.length - 1 ? 'grid' : 'none';

    this.disposeViewerMedia();
    mediaContainer.replaceChildren(this.spinnerNode());

    const tagsArr = this.normalizeTagArray(p.tags);
    const viewerTagToken = `${p.key}:${Date.now()}`;
    this._viewerTagToken = viewerTagToken;
    this.trackTags(tagsArr, 3);

    const fallback = p.preview_url || p.sample_url || '';
    if (p.kind === 'video') this.renderViewerVideo(mediaContainer, p, fallback);
    else this.renderViewerImage(mediaContainer, p, fallback);

    const [faved, liked] = await Promise.all([
      storage.get('likes', p.key),
      storage.get('hearts', p.key)
    ]);

    const favBtn = document.getElementById('viewer-fav-btn');
    const likeBtn = document.getElementById('viewer-like-btn');
    if (favBtn && likeBtn) {
      // Replace the nodes so an earlier post's handlers cannot linger.
      const newFavBtn = favBtn.cloneNode(true);
      const newLikeBtn = likeBtn.cloneNode(true);
      newFavBtn.className = `action-btn ${faved ? 'faved' : ''}`;
      newLikeBtn.className = `action-btn ${liked ? 'liked' : ''}`;
      favBtn.replaceWith(newFavBtn);
      likeBtn.replaceWith(newLikeBtn);
      newFavBtn.addEventListener('click', () => this.toggleFavorite(p, newFavBtn));
      newLikeBtn.addEventListener('click', () => this.toggleLike(p, newLikeBtn));
    }

    const actionRow = document.querySelector('#lightbox-sidebar .action-row');
    if (actionRow) {
      const existingSource = document.getElementById('viewer-source-link');
      if (existingSource) existingSource.remove();

      // A button, not an anchor: an in-view-web navigation would run the source
      // site inside this app's origin, with the native bridge attached.
      const sourceLink = document.createElement('button');
      sourceLink.type = 'button';
      sourceLink.id = 'viewer-source-link';
      sourceLink.className = 'action-btn';
      sourceLink.title = `Open on ${SOURCES[p.source].label}`;
      sourceLink.setAttribute('aria-label', sourceLink.title);
      sourceLink.textContent = '↗';
      sourceLink.addEventListener('click', () => openExternal(buildPostLink(p.source, p.id)));
      actionRow.appendChild(sourceLink);
    }

    const viewerStats = document.getElementById('viewer-stats');
    if (viewerStats) {
      viewerStats.replaceChildren();
      const rows = [
        ['ID', `${SOURCES[p.source].label} ${p.id}`],
        ['Dimensions', `${p.width || '?'}x${p.height || '?'}`],
        ['Score', String(p.score || 0)],
        ['Rating', (p.rating || 'N/A').toUpperCase()]
      ];
      for (const [label, value] of rows) {
        const row = document.createElement('div');
        row.append(label);
        const span = document.createElement('span');
        span.textContent = value;
        row.appendChild(span);
        viewerStats.appendChild(row);
      }
    }

    const viewerTags = document.getElementById('viewer-tags');
    if (viewerTags) {
      this.renderViewerTags(viewerTags, tagsArr, p.source);
      this.hydrateViewerTagCategories(tagsArr, viewerTagToken, p.source);
    }
  },

  renderViewerImage(container, p, fallback) {
    container.replaceChildren();
    const img = document.createElement('img');
    img.className = 'viewer-image';
    img.referrerPolicy = 'no-referrer';
    img.src = p.file_url || p.sample_url || fallback;
    img.addEventListener('error', () => {
      if (fallback && img.src !== fallback && !img.dataset.fb) {
        img.dataset.fb = '1';
        img.src = fallback;
        return;
      }
      this.showMediaUnavailable(container, p);
    });
    container.appendChild(img);
  },

  renderViewerVideo(container, p, fallback) {
    container.replaceChildren();

    const flex = document.createElement('div');
    flex.id = 'video-flex-container';

    const spinner = document.createElement('div');
    spinner.className = 'spinner viewer-spinner';

    const poster = document.createElement('img');
    poster.id = 'viewer-poster';
    poster.referrerPolicy = 'no-referrer';
    if (fallback) poster.src = fallback;

    const video = document.createElement('video');
    video.id = 'viewer-video';
    video.controls = true;
    video.loop = true;
    video.playsInline = true;
    video.referrerPolicy = 'no-referrer';
    video.preload = 'metadata';
    video.volume = this.settings.vol;
    video.muted = this.settings.muted;

    const source = document.createElement('source');
    source.src = p.file_url;
    // Use the type the extension actually implies. Declaring everything as
    // video/mp4 makes WebKit refuse formats it can in fact play.
    const mime = videoMimeType(p.file_url);
    if (mime) source.type = mime;
    video.appendChild(source);

    video.addEventListener('volumechange', () => {
      this.settings.vol = video.volume;
      this.settings.muted = video.muted;
      this.saveSettings();
    });

    const reveal = () => {
      spinner.style.display = 'none';
      video.style.opacity = '1';
      poster.style.opacity = '0';
    };
    video.addEventListener('loadeddata', reveal, { once: true });
    video.addEventListener('canplay', reveal, { once: true });

    // A <video> with a <source> child reports a failed load on the source
    // element, not on the video, so listening only on the video leaves an
    // unplayable file spinning forever.
    const failed = () => this.showMediaUnavailable(container, p);
    source.addEventListener('error', failed, { once: true });
    video.addEventListener('error', failed, { once: true });

    flex.append(spinner, poster, video);
    container.appendChild(flex);

    if (this.settings.autoplayVideos) {
      const attempt = video.play();
      // iOS rejects autoplay in plenty of ordinary situations. That is not an
      // error state: leave the controls for the user and move on.
      if (attempt && typeof attempt.catch === 'function') attempt.catch(() => {});
    }
  },

  showMediaUnavailable(container, p) {
    container.replaceChildren();
    const box = document.createElement('div');
    box.className = 'media-unavailable';

    const msg = document.createElement('p');
    msg.textContent = 'This file could not be played here.';
    box.appendChild(msg);

    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'btn-outline-info';
    open.textContent = `Open on ${SOURCES[p.source].label}`;
    open.addEventListener('click', () => openExternal(buildPostLink(p.source, p.id)));
    box.appendChild(open);

    container.appendChild(box);
  },

  /** Saves the open post's file through the iOS share sheet. */
  async saveCurrentMedia() {
    const p = this.currentViewerPost;
    const status = document.getElementById('viewer-save-status');
    if (!p) return;
    const url = p.file_url || p.sample_url || p.preview_url;
    if (!url) {
      if (status) status.textContent = 'This post has no downloadable file.';
      return;
    }
    if (status) status.textContent = 'Saving…';
    try {
      const result = await saveMediaFile(url, `${p.source}-${p.id}`);
      if (status) status.textContent = result.shared ? 'Saved and shared.' : 'Saved to the app’s files.';
    } catch (error) {
      if (status) status.textContent = (error && error.message) || 'That file could not be saved.';
    }
  },

  disposeViewerMedia() {
    const mc = document.getElementById('lightbox-media-container');
    if (!mc) return;
    mc.querySelectorAll('video').forEach(vid => {
      vid.pause();
      vid.removeAttribute('src');
      vid.replaceChildren();
      vid.load();
    });
    mc.replaceChildren();
  },

  closeViewer() {
    this._viewerTagToken = null;
    this.currentViewerPost = null;
    const dialog = document.getElementById('media-viewer');
    if (dialog && dialog.open) {
      const active = document.activeElement;
      if (active && typeof active.blur === 'function') active.blur();
      dialog.close();
    }
    const status = document.getElementById('viewer-save-status');
    if (status) status.textContent = '';
    this.disposeViewerMedia();
  },

  _invalidateFavCache() {
    this._favCache = null;
  },

  async toggleLike(p, btn) {
    this._invalidateFavCache();
    try {
      const exists = await storage.get('hearts', p.key);
      if (exists) {
        await storage.del('hearts', p.key);
        btn.classList.remove('liked');
      } else {
        await storage.put('hearts', { ...p, date: Date.now() });
        btn.classList.add('liked');
        this.markSeen(p.key);
        this.trackTags(this.normalizeTagArray(p.tags), 30);
      }
    } catch (e) {
      // The class is only toggled after the write commits, so the button still
      // reflects what is actually stored.
      this.toast('Could not save that reaction: ' + ((e && e.message) || 'storage error'));
    }
  },

  async toggleFavorite(p, btn) {
    this._invalidateFavCache();
    try {
      const exists = await storage.get('likes', p.key);
      if (exists) {
        await storage.del('likes', p.key);
        btn.classList.remove('faved');
        if (this.currentView === 'vault') {
          const card = document.getElementById(`card-${p.key}`);
          if (card) card.remove();
          this.currentPosts = this.currentPosts.filter(x => x.key !== p.key);
        }
      } else {
        await storage.put('likes', { ...p, date: Date.now() });
        btn.classList.add('faved');
        this.markSeen(p.key);
        this.trackTags(this.normalizeTagArray(p.tags), 100);
      }
    } catch (e) {
      this.toast('Could not save that post: ' + ((e && e.message) || 'storage error'));
    }
  },

  handleAutocomplete(val) {
    const list = document.getElementById('suggestions-list');
    if (!list) return;
    if (!val || !isSource(this.mode)) { list.hidden = true; return; }

    clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(async () => {
      const terms = String(val).split(/\s+/);
      const currentTerm = terms[terms.length - 1].trim();
      if (currentTerm.length < 1) { list.hidden = true; return; }

      // Guard against out-of-order replies: a slow earlier request must not
      // overwrite the suggestions for a newer keystroke.
      const acId = (this._acId || 0) + 1;
      this._acId = acId;
      const source = this.mode;

      let suggestions = [];
      let remoteFailed = false;
      try {
        const url = buildAutocompleteUrl(source, currentTerm, this.sourceCredentials(source));
        const raw = await request(url, { format: 'json' });
        if (this._acId !== acId) return;
        suggestions = parseAutocomplete(source, raw).slice(0, 15);
      } catch (e) {
        if (this._acId !== acId) return;
        remoteFailed = true;
      }

      if (suggestions.length === 0) {
        const seen = new Set();
        suggestions = [...this.savedTags, ...this.favorites, ...this.tracked]
          .map(t => String(t || '').trim())
          .filter(t => t && t.toLowerCase().includes(currentTerm.toLowerCase()))
          .filter(t => {
            const key = t.toLowerCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          })
          .slice(0, 15)
          .map(t => ({ name: t, count: 'saved' }));
      }

      list.replaceChildren();
      if (remoteFailed) {
        // Say the remote lookup failed rather than passing local tags off as
        // the source's own suggestions.
        const notice = document.createElement('li');
        notice.className = 'sugg-notice';
        notice.textContent = suggestions.length
          ? 'Tag suggestions unavailable — showing your saved tags'
          : 'Tag suggestions unavailable';
        list.appendChild(notice);
      }
      if (suggestions.length === 0 && !remoteFailed) { list.hidden = true; return; }

      list.hidden = false;
      for (const item of suggestions) {
        if (!item.name) continue;
        const li = document.createElement('li');
        li.tabIndex = 0;

        const name = document.createElement('span');
        name.className = 'sugg-tag-name';
        name.textContent = item.name.replace(/_/g, ' ');

        const right = document.createElement('div');
        right.className = 'sugg-right';
        const count = document.createElement('span');
        count.className = 'suggestion-count';
        const numeric = Number(item.count);
        count.textContent = Number.isFinite(numeric) && item.count !== '' ? numeric.toLocaleString() : String(item.count || '');

        const saveBtn = document.createElement('button');
        saveBtn.type = 'button';
        saveBtn.className = 'sugg-save-btn' + (this.savedTags.includes(item.name) ? ' saved' : '');
        saveBtn.textContent = '📌';
        saveBtn.title = 'Save this tag';
        saveBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          e.preventDefault();
          if (this.savedTags.includes(item.name)) {
            this.removeSavedTag(item.name);
            saveBtn.classList.remove('saved');
          } else {
            this.saveTag(item.name);
            saveBtn.classList.add('saved');
          }
        });

        right.append(count, saveBtn);
        li.append(name, right);

        const selectTerm = () => {
          const parts = String(val).split(/\s+/);
          parts[parts.length - 1] = item.name;
          const si = document.getElementById('search-input');
          if (si) { si.value = parts.join(' ') + ' '; si.focus(); }
          list.hidden = true;
        };
        li.addEventListener('click', selectTerm);
        li.addEventListener('keydown', e => { if (e.key === 'Enter') selectTerm(); });
        list.appendChild(li);
      }
    }, 300);
  },

  async backupData() {
    const status = document.getElementById('backup-status');
    if (status) status.textContent = 'Preparing export…';
    try {
      const snapshot = await exportSnapshot(this);
      const stamp = new Date().toISOString().slice(0, 10);
      const result = await saveJsonFile(`nexus-backup-${stamp}.json`, JSON.stringify(snapshot, null, 2));
      if (status) status.textContent = result.shared ? 'Backup shared.' : 'Backup saved to the app’s files.';
    } catch (error) {
      if (status) status.textContent = (error && error.message) || 'Export failed.';
    }
  },

  async restoreData(e) {
    const input = e.target;
    const file = input.files && input.files[0];
    const status = document.getElementById('backup-status');
    if (!file) return;

    try {
      const text = await file.text();
      // Validation happens inside importSnapshot before any write begins, and
      // the write itself is one transaction, so a bad file changes nothing.
      await importSnapshot(text);
      await this.hydrate();
      this.applySettingsToUi();
      if (status) status.textContent = 'Backup restored.';
      if (isSource(this.mode)) this.loadView(this.currentView);
    } catch (error) {
      if (status) status.textContent = (error && error.message) || 'That backup could not be imported.';
    } finally {
      // Always clear, so re-picking the same file fires `change` again.
      input.value = '';
    }
  },

  markSeen(key) {
    if (!key || !splitKey(key)) return;
    if (this.seenIds.has(key)) return;
    this.seenIds.add(key);
    const MAX = 5000;
    let arr = Array.from(this.seenIds);
    if (arr.length > MAX) {
      arr = arr.slice(arr.length - MAX);
      this.seenIds = new Set(arr);
    }
    this.savePreference('seenIds', arr);
  },

  updatePostCount(total) {
    const n = Number(total);
    if (!Number.isFinite(n)) return;
    this.totalPostCount = n;
    const el = document.getElementById('post-count-display');
    if (el) {
      el.textContent = n.toLocaleString() + ' posts';
      el.style.display = 'inline';
    }
  },

  async fetchR34Count(query, generation) {
    const url = buildCountUrl('r34', query, this.sourceCredentials('r34'));
    const text = await request(url, { format: 'text' });
    if (this.fetchId !== generation) return false;
    const count = parseCount(text);
    if (count === null) return false;
    this.updatePostCount(count);
    return true;
  },

  saveTag(tag) {
    const t = String(tag || '').trim().toLowerCase();
    if (!t || this.savedTags.includes(t)) return;
    this.savedTags.push(t);
    this.savePreference('savedTags', this.savedTags);
    this.renderSavedTagChips();
  },

  removeSavedTag(tag) {
    this.savedTags = this.savedTags.filter(t => t !== tag);
    this.savePreference('savedTags', this.savedTags);
    this.renderSavedTagChips();
  },

  renderSavedTagChips() {
    const container = document.getElementById('saved-tags-list');
    if (!container) return;
    container.replaceChildren();
    if (this.savedTags.length === 0) {
      const empty = document.createElement('span');
      empty.className = 'muted-note';
      empty.textContent = 'No saved tags yet.';
      container.appendChild(empty);
      return;
    }
    this.savedTags.forEach(tag => {
      const wrap = document.createElement('div');
      wrap.className = 'saved-tag-chip';

      const searchBtn = document.createElement('button');
      searchBtn.type = 'button';
      searchBtn.className = 'chip saved';
      searchBtn.textContent = `📌 ${tag}`;
      searchBtn.addEventListener('click', () => {
        const modal = document.getElementById('settings-modal');
        if (modal && modal.open) modal.close();
        this.executeSearch(tag);
      });

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'saved-tag-remove';
      removeBtn.textContent = '✕';
      removeBtn.setAttribute('aria-label', `Remove saved tag ${tag}`);
      removeBtn.addEventListener('click', () => this.removeSavedTag(tag));

      wrap.append(searchBtn, removeBtn);
      container.appendChild(wrap);
    });
  },

  saveSearchHistory(term) {
    const q = String(term || '').trim();
    if (!q) return;
    const key = q.toLowerCase();
    const rest = this.searchHistory.filter(item => String(item.query || '').toLowerCase() !== key);
    this.searchHistory = [{ query: q, source: this.mode, ts: Date.now() }, ...rest].slice(0, 24);
    this.savePreference('searchHistory', this.searchHistory);
    this.renderSearchHistory();
  },

  clearSearchHistory() {
    this.searchHistory = [];
    this.savePreference('searchHistory', this.searchHistory);
    this.renderSearchHistory();
  },

  renderSearchHistory() {
    const panel = document.getElementById('previous-searches-panel');
    if (!panel) return;
    const items = this.searchHistory
      .filter(item => !item.source || item.source === this.mode)
      .slice(0, 10);

    if (!items.length || !['home', 'explore'].includes(this.currentView || 'home')) {
      panel.style.display = 'none';
      panel.replaceChildren();
      return;
    }

    panel.replaceChildren();
    panel.style.display = 'flex';

    const label = document.createElement('div');
    label.className = 'prev-searches-label';
    label.textContent = 'Previous searches';

    const list = document.createElement('div');
    list.className = 'prev-searches-list';
    items.forEach(item => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'prev-search-chip';
      btn.textContent = item.query;
      btn.addEventListener('click', () => this.executeSearch(item.query));
      list.appendChild(btn);
    });

    const clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'prev-search-clear';
    clear.textContent = 'Clear';
    clear.addEventListener('click', () => this.clearSearchHistory());

    panel.append(label, list, clear);
  },

  async loadReels() {
    const container = document.getElementById('reels-container');
    const loader = document.getElementById('reels-loader');
    if (!container || !isSource(this.mode)) return;
    container.replaceChildren();
    if (loader) loader.hidden = false;

    const showEmpty = (msg) => {
      container.replaceChildren();
      const box = document.createElement('div');
      box.className = 'reels-empty';
      const h = document.createElement('h2');
      h.textContent = 'Reels';
      const p = document.createElement('p');
      p.textContent = msg;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn-outline-info';
      btn.textContent = 'Go Explore';
      btn.addEventListener('click', () => this.nav('explore'));
      box.append(h, p, btn);
      container.appendChild(box);
    };

    this._wireReelsSkip();
    const source = this.mode;
    const generation = this.fetchId;

    try {
      const baseQuery = this.query || this.favorites[0] || this.tracked[0] || '';
      const posts = [];
      // Bounded scan: video posts are sparse, but this must not turn into an
      // unbounded crawl of the source.
      for (let page = 0; page < 6 && posts.length < 10; page++) {
        const url = buildPostsUrl(
          source,
          { query: baseQuery, sort: 'new', page, limit: 30, extraTags: 'video' },
          this.sourceCredentials(source)
        );
        const raw = await request(url, { format: 'json' });
        if (this.fetchId !== generation) return;
        const batch = parsePosts(source, raw)
          .filter(p => p.kind === 'video' && !this.isBlacklisted(p));
        if (batch.length === 0 && page > 0) break;
        posts.push(...batch);
      }

      const seen = new Set();
      const unique = posts.filter(p => {
        if (seen.has(p.key)) return false;
        seen.add(p.key);
        return true;
      }).slice(0, 16);

      if (!unique.length) {
        showEmpty('No playable videos found yet. Try searching a video tag first.');
        return;
      }
      this.currentPosts = unique;
      unique.forEach((p, idx) => this.renderReel(p, idx, container));
      this.setupReelObserver();
    } catch (error) {
      if (this.fetchId !== generation) return;
      showEmpty(describeError(error).message);
    } finally {
      if (loader) loader.hidden = true;
    }
  },

  renderReel(p, idx, container) {
    const section = document.createElement('section');
    section.className = 'reel-card';

    const video = document.createElement('video');
    video.className = 'reel-video';
    video.src = p.file_url;
    if (p.preview_url || p.sample_url) video.poster = p.preview_url || p.sample_url;
    video.loop = true;
    video.playsInline = true;
    video.controls = true;
    video.preload = 'metadata';
    video.muted = Boolean(this.settings.muted);
    video.referrerPolicy = 'no-referrer';

    const gradient = document.createElement('div');
    gradient.className = 'reel-gradient';

    const info = document.createElement('div');
    info.className = 'reel-info';

    const kicker = document.createElement('div');
    kicker.className = 'reel-kicker';
    kicker.textContent = `${SOURCES[p.source].label.toUpperCase()} REEL ${idx + 1}`;

    const title = document.createElement('h3');
    title.textContent = String(p.tags || 'video').split(' ').slice(0, 8).join(' ');

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn-outline-info';
    btn.textContent = 'Open details';
    btn.addEventListener('click', () => this.openViewer(p));

    info.append(kicker, title, btn);
    section.append(video, gradient, info);
    container.appendChild(section);
  },

  setupReelObserver() {
    const videos = document.querySelectorAll('.reel-video');
    if (!videos.length) return;
    if (this._reelObserver) this._reelObserver.disconnect();
    this._reelObserver = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        const vid = entry.target;
        if (entry.isIntersecting && entry.intersectionRatio > 0.65) {
          vid.volume = this.settings.vol;
          vid.muted = this.settings.muted;
          if (this.settings.autoplayVideos) {
            const attempt = vid.play();
            if (attempt && typeof attempt.catch === 'function') attempt.catch(() => {});
          }
        } else {
          vid.pause();
        }
      });
    }, { threshold: [0, 0.65, 1] });
    videos.forEach(v => this._reelObserver.observe(v));
  },

  // Leaving Reels must stop the observer and the videos; otherwise audio keeps
  // playing under the next view.
  teardownReels() {
    if (this._reelObserver) {
      this._reelObserver.disconnect();
      this._reelObserver = null;
    }
    document.querySelectorAll('.reel-video').forEach(vid => {
      vid.pause();
      vid.removeAttribute('src');
      vid.load();
    });
    const container = document.getElementById('reels-container');
    if (container) container.replaceChildren();
  },

  _wireReelsSkip() {
    const view = document.getElementById('reels-view');
    if (!view || view.querySelector('.reels-skip-controls')) return;

    const controls = document.createElement('div');
    controls.className = 'reels-skip-controls';
    for (const [id, label, dir] of [['reels-prev', 'Previous reel', -1], ['reels-next', 'Next reel', 1]]) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'reels-skip-btn';
      btn.id = id;
      btn.setAttribute('aria-label', label);
      btn.textContent = dir < 0 ? '▲' : '▼';
      btn.addEventListener('click', () => this.reelsSkip(dir));
      controls.appendChild(btn);
    }
    view.appendChild(controls);

    if (!this._reelsKeyBound) {
      this._reelsKeyBound = true;
      document.addEventListener('keydown', (e) => {
        if (this.currentView !== 'reels') return;
        const tag = (e.target && e.target.tagName) || '';
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;
        if (e.key === 'ArrowDown' || e.key === 'PageDown' || e.key === 'j') { e.preventDefault(); this.reelsSkip(1); }
        else if (e.key === 'ArrowUp' || e.key === 'PageUp' || e.key === 'k') { e.preventDefault(); this.reelsSkip(-1); }
      });
    }
  },

  reelsSkip(dir) {
    const container = document.getElementById('reels-container');
    if (!container) return;
    const cards = container.querySelectorAll('.reel-card');
    if (!cards.length) return;
    const cardH = cards[0].getBoundingClientRect().height || container.clientHeight;
    const idx = Math.round(container.scrollTop / cardH);
    const next = Math.max(0, Math.min(cards.length - 1, idx + dir));
    container.scrollTo({ top: next * cardH, behavior: 'smooth' });
  },

  async resetAlgo() {
    if (!window.confirm('Clear the personalized tag weights behind your For You feed?')) return;
    const status = document.getElementById('backup-status');
    try {
      await storage.clear('tag_stats');
      if (status) status.textContent = 'For You weights cleared.';
    } catch (error) {
      if (status) status.textContent = (error && error.message) || 'Could not clear the weights.';
    }
  }
};
