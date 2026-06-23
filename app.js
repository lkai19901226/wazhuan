// ===== 挖赚网 - 数据驱动的APP推荐平台 =====

let siteData = null;
let _currentTab = 'home'; // 记录当前标签页，刷新时恢复
let _tagFilter = ''; // 标签搜索过滤关键词
var _lastRecommendIds = []; // 记录上次推荐展示的ID，刷新时优先展示新内容



// ===== 初始化：启动同步引擎并渲染 =====
async function init() {
  try {
    // 启动同步引擎（SSE 实时推送 + BroadcastChannel 跨标签页 + 30s轮询兜底）
    await SyncEngine.start();

    // 获取初始数据
    var freshData = SyncEngine.getData();
    if (!freshData) {
      loadFallbackData();
      return;
    }

    siteData = freshData;
    renderAll();

  } catch(e) {
    console.error('[app.js] 初始化失败:', e);
    if (!siteData) {
      loadFallbackData();
    }
    return;
  }

  // 监听数据更新事件——后台修改数据后自动重新渲染所有组件
  SyncEngine.on('dataUpdated', function (e) {
    siteData = e.data;
    _lastRecommendIds = []; // 数据更新后清空记忆，确保推荐内容刷新
    clearRecommendCache();  // 清除推荐缓存，重新随机
    renderAll();
    // 显示短暂的数据更新提示
    if (e.source !== 'manual') {
      showToast('内容已自动更新', 1200);
    }
  });
}

// ===== 轻量Toast（用于交互反馈） =====
function showToast(msg, duration) {
  duration = duration || 1800;
  var existing = document.querySelector('.sync-toast');
  if (existing) existing.remove();

  var toast = document.createElement('div');
  toast.className = 'sync-toast';
  toast.textContent = msg;
  document.body.appendChild(toast);

  requestAnimationFrame(function() {
    toast.classList.add('show');
  });

  setTimeout(function() {
    toast.classList.remove('show');
    setTimeout(function() { toast.remove(); }, 300);
  }, duration);
}

// 备用数据（当 data.json 无法加载时使用，仅包含结构，不含存量数据）
function loadFallbackData() {
  siteData = {
    siteInfo: {
      name: "挖赚",
      domain: "www.wazhuan.cn",
      email: "admin@wazhuan.cn",
      emailVisible: true,
      copyright: "挖赚网",
      icp: "渝ICP备2021014403号-4",
      police: "渝公网安备50023802000211号",
      logo: "",
      logoText: "挖赚网",
      logoSlogan: "手机赚钱APP推荐平台",
      footerLinks: [],
      friendLinks: []
    },
    navTabs: [
      { id: "home", name: "首页", active: true, icon: "", sort: 1 },
      { id: "game", name: "游戏玩试", active: false, icon: "", sort: 2 },
      { id: "task", name: "悬赏任务", active: false, icon: "", sort: 3 },
      { id: "special", name: "手赚专题", active: false, icon: "", sort: 4 }
    ],
    home: { recommend: [], latestApps: [] },
    game: { apps: [] },
    task: { apps: [] },
    special: { articles: [] }
  };
  renderAll();
}

// ===== 动态应用模块悬停背景色（从 siteInfo 读取） =====
function applyHoverColors() {
  var si = siteData && siteData.siteInfo;
  if (!si) return;
  var root = document.documentElement;
  root.style.setProperty('--hover-bg-recommend', si.hoverBgRecommend || 'transparent');
  root.style.setProperty('--hover-bg-special', si.hoverBgSpecial || 'transparent');
  root.style.setProperty('--hover-bg-latestApp', si.hoverBgLatestApp || 'transparent');
  root.style.setProperty('--hover-bg-related', si.hoverBgRelated || 'transparent');
}

// ===== 渲染所有组件 =====
function renderAll() {
  if (!siteData) return;
  applyHoverColors();
  renderLogo();
  renderNavTabs();
  renderMobileNav();
  renderRecommendGrid();
  renderHomeSpecialList();
  renderLatestAppList();
  renderGameAppList();
  renderTaskAppList();
  renderSpecialFullList();
  renderFooter();
  setupEvents();
  // 数据刷新后恢复当前标签页
  if (_currentTab && _currentTab !== 'home') {
    switchTab(_currentTab);
  }
  // 兜底：渲染完成后检查所有图片，加载失败的回退显示文字
  setTimeout(fixBrokenImages, 300);
}

// ===== 全局图片错误兜底处理 =====
function fixBrokenImages() {
  var allImgs = document.querySelectorAll('.app-icon-img, .recommend-icon img, .app-icon img, .nav-icon-img img, .site-mobile-nav-icon img');
  allImgs.forEach(function(img) {
    if (!img.complete) {
      var fallbackTimer = setTimeout(function() {
        handleImgError(img);
      }, 3000);
      img.addEventListener('load', function() {
        clearTimeout(fallbackTimer);
        img.style.display = 'block';
        var prev = img.previousElementSibling;
        if (prev && prev.classList.contains('icon-placeholder')) prev.style.display = 'none';
        var next = img.nextElementSibling;
        if (next && next.classList.contains('icon-fallback')) next.style.display = 'none';
      }, { once: true });
      img.addEventListener('error', function() {
        clearTimeout(fallbackTimer);
        handleImgError(img);
      }, { once: true });
    } else if (img.naturalWidth === 0) {
      handleImgError(img);
    }
  });
}

function handleImgError(img) {
  img.style.display = 'none';
  var prev = img.previousElementSibling;
  if (prev && prev.classList.contains('icon-placeholder')) prev.style.display = 'none';
  var next = img.nextElementSibling;
  if (next && next.classList.contains('icon-fallback')) next.style.display = 'flex';
}

// ===== SVG 图标映射 =====
var _navIcons = {
  home: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9.5L12 3l9 6.5V20a1 1 0 01-1 1h-5v-7H9v7H4a1 1 0 01-1-1V9.5z"/></svg>',
  game: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><rect x="2" y="6" width="20" height="12" rx="3" opacity="0.15" fill="currentColor"/><path d="M5 10h2v2H5zM9 8h2v2H9zM13 8h2v2h-2zM17 10h2v2h-2z"/><path d="M7 14h10a1 1 0 011 1v2a1 1 0 01-1 1H7a1 1 0 01-1-1v-2a1 1 0 011-1z" opacity="0.3"/><circle cx="10" cy="15" r="1.5"/><circle cx="14" cy="15" r="1.5"/></svg>',
  task: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>',
  special: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" opacity="0.15" fill="currentColor"/><line x1="8" y1="7" x2="16" y2="7"/><line x1="8" y1="11" x2="14" y2="11"/><line x1="8" y1="15" x2="12" y2="15"/></svg>'
};

var _mobileNavIcons = {
  home: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9.5L12 3l9 6.5V20a1 1 0 01-1 1h-5v-7H9v7H4a1 1 0 01-1-1V9.5z"/></svg>',
  game: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><rect x="2" y="6" width="20" height="12" rx="3" opacity="0.15" fill="currentColor"/><path d="M5 10h2v2H5zM9 8h2v2H9zM13 8h2v2h-2zM17 10h2v2h-2z"/><path d="M7 14h10a1 1 0 011 1v2a1 1 0 01-1 1H7a1 1 0 01-1-1v-2a1 1 0 011-1z" opacity="0.3"/><circle cx="10" cy="15" r="1.5"/><circle cx="14" cy="15" r="1.5"/></svg>',
  task: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>',
  special: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" opacity="0.15" fill="currentColor"/><line x1="8" y1="7" x2="16" y2="7"/><line x1="8" y1="11" x2="14" y2="11"/><line x1="8" y1="15" x2="12" y2="15"/></svg>'
};

var _downloadIconSvg = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12m0 0l-4-4m4 4l4-4"/><path d="M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2"/></svg>';
var _arrowRightSvg = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>';
var _articleIconSvg = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="12" y2="17"/></svg>';
var _searchIconSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';
var _closeIconSvg = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

// ===== 渲染Logo =====
function renderLogo() {
  var logoEl = document.querySelector('.logo');
  if (!logoEl || !siteData.siteInfo) return;

  var s = siteData.siteInfo;
  var logoUrl = s.logo || '';
  var logoText = s.logoText || s.name || '挖赚网';
  var logoSlogan = s.logoSlogan || '';

  if (logoUrl && (logoUrl.startsWith('uploads/') || (!logoUrl.startsWith('http') && !logoUrl.startsWith('/')))) {
    logoUrl = '/' + logoUrl;
  }

  var logoIconHtml = '';
  if (logoUrl) {
    logoIconHtml = '<span class="logo-icon">' +
      '<img src="' + logoUrl + '" alt="' + logoText + '" style="width:36px;height:36px;border-radius:14px;object-fit:cover;" ' +
      'onerror="this.style.display=\'none\';var f=this.parentElement.querySelector(\'.logo-fallback\');if(f)f.style.display=\'flex\';" ' +
      '>' +
      '<svg class="logo-fallback" viewBox="0 0 64 64" width="36" height="36" style="display:none;">' +
        '<defs><linearGradient id="lg" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#ff6b35"/><stop offset="100%" stop-color="#ff8f5e"/></linearGradient></defs>' +
        '<rect width="64" height="64" rx="14" fill="url(#lg)"/>' +
        '<text x="32" y="43" text-anchor="middle" font-size="30" font-weight="700" fill="#fff" font-family="Arial,sans-serif">' + logoText.substring(0, 1) + '</text>' +
      '</svg>' +
      '</span>';
  } else {
    logoIconHtml = '<span class="logo-icon">' +
      '<svg viewBox="0 0 64 64" width="36" height="36">' +
        '<defs><linearGradient id="lg" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#ff6b35"/><stop offset="100%" stop-color="#ff8f5e"/></linearGradient></defs>' +
        '<rect width="64" height="64" rx="14" fill="url(#lg)"/>' +
        '<text x="32" y="43" text-anchor="middle" font-size="30" font-weight="700" fill="#fff" font-family="Arial,sans-serif">' + logoText.substring(0, 1) + '</text>' +
      '</svg>' +
      '</span>';
  }

  // 动态设置Logo链接：有域名则跳转域名，否则回退到首页
  var logoHref = s.domain ? (s.domain.startsWith('http') ? s.domain : 'https://' + s.domain) : 'index.html';
  logoEl.href = logoHref;
  // 如果是外链则新窗口打开
  if (s.domain) {
    logoEl.setAttribute('target', '_blank');
    logoEl.setAttribute('rel', 'noopener noreferrer');
  } else {
    logoEl.removeAttribute('target');
    logoEl.removeAttribute('rel');
  }

  var sloganHtml = logoSlogan ? '<span class="logo-sub">' + logoSlogan + '</span>' : '';

  logoEl.innerHTML = logoIconHtml +
    '<span class="logo-text-group">' +
      '<span class="logo-text">' + logoText + '</span>' +
      sloganHtml +
    '</span>';
}

// ===== 获取导航标签图标HTML =====
function getNavTabIconHtml(tab) {
  if (tab.showIcon === false) {
    return '';
  }
  if (tab.iconVisible === false) {
    var svgIcon = _navIcons[tab.id] || '';
    return svgIcon ? '<span class="nav-icon">' + svgIcon + '</span>' : '';
  }
  var iconUrl = tab.icon || '';
  if (iconUrl && (iconUrl.startsWith('uploads/') || (!iconUrl.startsWith('http') && !iconUrl.startsWith('/')))) {
    iconUrl = '/' + iconUrl;
  }
  if (iconUrl) {
    return '<span class="nav-icon nav-icon-img">' +
      '<img src="' + iconUrl + '" alt="" style="width:16px;height:16px;object-fit:contain;vertical-align:middle;" ' +
      'onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'inline-flex\';">' +
      '<span class="nav-icon-fallback" style="display:none;">' + (_navIcons[tab.id] || '') + '</span>' +
      '</span>';
  } else {
    var svgIcon2 = _navIcons[tab.id] || '';
    return svgIcon2 ? '<span class="nav-icon">' + svgIcon2 + '</span>' : '';
  }
}

function renderNavTabs() {
  var navEl = document.getElementById('navTabs');
  if (!navEl || !siteData.navTabs) return;

  var sortedTabs = [].concat(siteData.navTabs).sort(function(a, b) {
    return (a.sort || 99) - (b.sort || 99);
  });

  navEl.innerHTML = sortedTabs.map(function(tab) {
    var iconHtml = getNavTabIconHtml(tab);
    return '<a class="nav-item ' + (tab.active ? 'active' : '') + '" data-tab="' + tab.id + '" href="#' + tab.id + '">' +
      iconHtml + tab.name + '</a>';
  }).join('');
}

function renderMobileNav() {
  var mobileNav = document.getElementById('mobileNav');
  if (!mobileNav || !siteData.navTabs) return;

  var sortedTabs = [].concat(siteData.navTabs).sort(function(a, b) {
    return (a.sort || 99) - (b.sort || 99);
  });

  mobileNav.innerHTML = '<div class="site-mobile-nav-items">' + sortedTabs.map(function(tab) {
    if (tab.showIcon === false) {
      return '<a class="site-mobile-nav-item ' + (tab.active ? 'active' : '') + '" data-tab="' + tab.id + '">' +
        '<span class="site-mobile-nav-label">' + tab.name + '</span></a>';
    }
    if (tab.iconVisible === false) {
      var svgIcon = _mobileNavIcons[tab.id] || _mobileNavIcons['home'];
      return '<a class="site-mobile-nav-item ' + (tab.active ? 'active' : '') + '" data-tab="' + tab.id + '">' +
        '<span class="site-mobile-nav-icon">' + svgIcon + '</span>' +
        '<span class="site-mobile-nav-label">' + tab.name + '</span></a>';
    }
    var iconHtml = '';
    var iconUrl = tab.icon || '';
    if (iconUrl && (iconUrl.startsWith('uploads/') || (!iconUrl.startsWith('http') && !iconUrl.startsWith('/')))) {
      iconUrl = '/' + iconUrl;
    }
    if (iconUrl) {
      iconHtml = '<span class="site-mobile-nav-icon">' +
        '<img src="' + iconUrl + '" alt="" style="width:22px;height:22px;object-fit:contain;" ' +
        'onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'inline-flex\';">' +
        '<span style="display:none;">' + (_mobileNavIcons[tab.id] || _mobileNavIcons['home']) + '</span>' +
        '</span>';
    } else {
      var svgIcon = _mobileNavIcons[tab.id] || _mobileNavIcons['home'];
      iconHtml = '<span class="site-mobile-nav-icon">' + svgIcon + '</span>';
    }
    return '<a class="site-mobile-nav-item ' + (tab.active ? 'active' : '') + '" data-tab="' + tab.id + '">' +
      iconHtml +
      '<span class="site-mobile-nav-label">' + tab.name + '</span></a>';
  }).join('') + '</div>';
}

// ===== 全局APP池（按 name 去重：同一 name 跨分类只保留一份，缺失字段补充合并） =====
// 注意：不能只按 id 去重，因为不同分类的 APP 可能共用数字 id（如 game 和 task 都有 id=1）
function getAllAppsPool() {
  var allRaw = [];
  if (siteData && siteData.home && siteData.home.recommend) allRaw = allRaw.concat(siteData.home.recommend);
  if (siteData && siteData.home && siteData.home.latestApps) allRaw = allRaw.concat(siteData.home.latestApps);
  if (siteData && siteData.game && siteData.game.apps) allRaw = allRaw.concat(siteData.game.apps);
  if (siteData && siteData.task && siteData.task.apps) allRaw = allRaw.concat(siteData.task.apps);



  var map = {};
  allRaw.forEach(function(a) {
    var key = a.name; // 按 name 去重
    if (!map[key]) {
      map[key] = a;
    } else {
      // 同 name 的条目：合并缺失字段
      var existing = map[key];
      if (!existing.desc && a.desc) existing.desc = a.desc;
      if (!existing.icon && a.icon) existing.icon = a.icon;
      if (!existing.url && a.url) existing.url = a.url;
      if (!existing.category && a.category) existing.category = a.category;
      if (!existing.platform && a.platform) existing.platform = a.platform;
      if (!existing.appSize && a.appSize) existing.appSize = a.appSize;
      if (!existing.developer && a.developer) existing.developer = a.developer;
      if (!existing.withdrawMethod && a.withdrawMethod) existing.withdrawMethod = a.withdrawMethod;
      if (!existing.content && a.content) existing.content = a.content;
      if (!existing.features && a.features) existing.features = a.features;
      if (!existing.screenshots && a.screenshots) existing.screenshots = a.screenshots;
      if (!existing.downloads && a.downloads) existing.downloads = a.downloads;
      if (!existing.name && a.name) existing.name = a.name;
      if (!existing.id && a.id) existing.id = a.id;
    }
  });
  return Object.values(map);
}

function shuffleArray(arr) {
  for (var i = arr.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

// 推荐缓存 key：F5 后恢复上次随机结果，只有点击刷新按钮才重新随机
var RECOMMEND_CACHE_KEY = 'wazhuan_recommend_cache_v2';

// 从 localStorage 读取缓存的推荐 name 列表
function getRecommendCache() {
  try {
    var cached = localStorage.getItem(RECOMMEND_CACHE_KEY);
    if (cached) return JSON.parse(cached);
  } catch(e) {}
  return null;
}

// 写入推荐缓存（存 name 列表，而非 id）
function setRecommendCache(names) {
  try {
    localStorage.setItem(RECOMMEND_CACHE_KEY, JSON.stringify(names));
  } catch(e) {}
}

// 清除推荐缓存（点击刷新按钮时调用）
function clearRecommendCache() {
  try {
    localStorage.removeItem(RECOMMEND_CACHE_KEY);
  } catch(e) {}
}

// 根据缓存的 name 列表从APP池中还原APP对象（按name去重，同一name只保留一条）
function restoreRecommendFromCache(count) {
  var cachedNames = getRecommendCache();
  if (!cachedNames || cachedNames.length === 0) return null;

  var allApps = getAllAppsPool();
  if (allApps.length === 0) return null;

  // 按 name 建立索引（name 在全局池中唯一）
  var nameMap = {};
  allApps.forEach(function(a) {
    if (!nameMap[a.name]) nameMap[a.name] = a;
  });

  var seenNames = {};
  var result = [];
  cachedNames.forEach(function(name) {
    var app = nameMap[name];
    if (app && !seenNames[app.name]) {
      seenNames[app.name] = true;
      result.push(app);
    }
  });
  if (result.length === 0) return null;
  return result.slice(0, count);
}

// 随机挑选推荐APP（优先用缓存，无缓存时重新随机）
// 规则：同一 name 去重，推荐网格中不出现相同名字的APP
function pickRandomRecommendApps(count) {
  // 有缓存 → 直接还原，F5 不变
  var cached = restoreRecommendFromCache(count);
  if (cached) return cached;

  // 无缓存 → 重新随机挑选
  var allApps = getAllAppsPool();
  if (allApps.length === 0) return [];

  // _lastRecommendIds 存的是 id，转为 name 集合用于比较
  var lastNames = {};
  _lastRecommendIds.forEach(function(id) {
    // 从 allApps 中反向查找 name
    allApps.forEach(function(a) {
      if (a.id === id) lastNames[a.name] = true;
    });
  });

  var freshPool = [];
  var repeatPool = [];
  var seenInFresh = {};
  var seenInRepeat = {};
  allApps.forEach(function(a) {
    if (lastNames[a.name]) {
      if (!seenInRepeat[a.name]) {
        seenInRepeat[a.name] = true;
        repeatPool.push(a);
      }
    } else {
      if (!seenInFresh[a.name]) {
        seenInFresh[a.name] = true;
        freshPool.push(a);
      }
    }
  });

  shuffleArray(freshPool);
  shuffleArray(repeatPool);

  // 从新鲜池挑选，确保不重复 name
  var seenNames = {};
  var result = [];
  for (var i = 0; i < freshPool.length && result.length < count; i++) {
    var app = freshPool[i];
    if (!seenNames[app.name]) {
      seenNames[app.name] = true;
      result.push(app);
    }
  }

  // 新鲜池不够时，从重复池补充（同样按 name 去重）
  if (result.length < count) {
    for (var j = 0; j < repeatPool.length && result.length < count; j++) {
      var rapp = repeatPool[j];
      if (!seenNames[rapp.name]) {
        seenNames[rapp.name] = true;
        result.push(rapp);
      }
    }
  }

  _lastRecommendIds = result.map(function(a) { return a.id; });

  // 随机后写入缓存（存 name，F5 不变）
  var finalResult = shuffleArray(result);
  setRecommendCache(finalResult.map(function(a) { return a.name; }));
  return finalResult;
}

function renderRecommendGrid() {
  const gridEl = document.getElementById('recommendGrid');
  if (!gridEl) return;

  var apps = pickRandomRecommendApps(10);

  // 最终渲染前去重保障：按 name 去重，同一 name 只保留第一条
  var seenNames = {};
  apps = apps.filter(function(a) {
    if (seenNames[a.name]) return false;
    seenNames[a.name] = true;
    return true;
  });

  if (_tagFilter) {
    apps = apps.filter(matchTagFilter);
  }

  if (apps.length === 0) {
    var hintMsg = _tagFilter
      ? '没有匹配 &quot;' + _tagFilter + '&quot; 的推荐APP'
      : '暂无推荐数据';
    gridEl.innerHTML = '<div class="empty-filter-hint">' + hintMsg + '</div>';
    return;
  }

  // 下载次数缩写格式化
  function fmtDownloads(n) {
    if (!n && n !== 0) return '0次下载';
    if (n >= 10000) return (n / 10000).toFixed(1).replace(/\.0$/, '') + '万次';
    if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + '千次';
    return n + '次';
  }

  var itemsHtml = apps.map(function(app, idx) {
    return '<a class="recommend-item" href="detail.html?id=' + app.id + '&from=home" style="animation:recommendFadeIn 0.3s ease forwards;animation-delay:' + (idx * 0.03) + 's;opacity:0;">' +
      '<div class="recommend-icon">' + getAppIconHtml(app) + '</div>' +
      '<div class="recommend-name">' + app.name + '</div>' +
      '<div class="recommend-downloads">' +
        '<span class="recommend-count">' + fmtDownloads(app.downloads) + '</span>' +
        '<span class="recommend-go-btn">查看' + _arrowRightSvg + '</span>' +
      '</div></a>';
  }).join('');
  gridEl.innerHTML = itemsHtml;
}

// ===== 被动式数据同步（在用户交互时静默触发） =====
var _pendingSyncTimer = null;

function triggerPassiveSync() {
  // 防抖：避免短时间内多次触发同步
  if (_pendingSyncTimer) return;
  _pendingSyncTimer = setTimeout(function() {
    _pendingSyncTimer = null;
    try {
      var freshData = SyncEngine.getData();
      if (freshData && freshData !== siteData) {
        siteData = freshData;
        _lastRecommendIds = [];
        clearRecommendCache();
        renderAll();
      }
    } catch(e) {
      // 静默失败，不影响用户操作
    }
  }, 300);
}

// 下拉刷新触发：静默同步数据并刷新推荐区
window.refreshRecommendPassive = function() {
  try {
    var freshData = SyncEngine.getData();
    if (freshData && freshData !== siteData) {
      siteData = freshData;
    }
    _lastRecommendIds = [];
    clearRecommendCache(); // 清除缓存，重新随机
    renderRecommendGrid();
  } catch(e) {
    // 静默失败
  }
};

// ===== 手动刷新推荐区域 =====
window.refreshRecommendGrid = async function() {
  var btn = document.getElementById('recommendRefreshBtn');
  if (btn) btn.classList.add('spinning');

  // 从 data.json 拉取最新数据
  await SyncEngine.refresh();

  var freshData = SyncEngine.getData();
  if (freshData) {
    siteData = freshData;
  }

  _lastRecommendIds = [];
  clearRecommendCache(); // 清除缓存，重新随机推荐
  renderRecommendGrid();

  if (btn) btn.classList.remove('spinning');
  showToast('推荐已刷新');
};

// ===== 渲染首页手赚专题（卡片式布局） =====
function renderHomeSpecialList() {
  const listEl = document.getElementById('homeSpecialList');
  if (!listEl) return;

  // 优先使用 topics 数据，兼容旧的 articles 格式
  var topics = (siteData.special && siteData.special.topics) ? siteData.special.topics : [];
  var articles = (siteData.special && siteData.special.articles) ? siteData.special.articles : [];

  // 如果 topics 有数据，用 topics 渲染卡片
  if (topics.length > 0) {
    var items = topics.slice(0, 4);
    listEl.innerHTML = items.map(function(topic) {
      var coverHtml = topic.coverImage
        ? '<div class="special-card-cover"><img src="' + topic.coverImage + '" alt="' + topic.title + '" loading="lazy" onerror="this.parentElement.style.display=\'none\'"></div>'
        : '';
      var tagsHtml = (topic.tags && topic.tags.length > 0)
        ? '<div class="special-card-tags">' + topic.tags.slice(0, 3).map(function(t) { return '<span class="special-card-tag">' + t + '</span>'; }).join('') + '</div>'
        : '';
      var appCountHtml = (topic.relatedApps && topic.relatedApps.length > 0)
        ? '<span class="special-card-count">' + topic.relatedApps.length + '款APP</span>'
        : '';
      return '<a class="special-card-item" href="' + (topic.url || ('special-detail.html?id=' + topic.id)) + '">' +
        coverHtml +
        '<div class="special-card-body">' +
          '<div class="special-card-header">' +
            '<h3 class="special-card-title">' + topic.title + '</h3>' +
            appCountHtml +
          '</div>' +
          '<p class="special-card-desc">' + (topic.summary || topic.subtitle || '') + '</p>' +
          '<div class="special-card-footer">' +
            tagsHtml +
            '<span class="special-card-time">' + (topic.publishTime ? topic.publishTime.slice(0, 10) : '') + '</span>' +
          '</div>' +
        '</div>' +
      '</a>';
    }).join('');
    return;
  }

  // 兼容旧的 articles 格式
  if (articles.length === 0) {
    listEl.innerHTML = '<div class="empty-hint">暂无专题数据</div>';
    return;
  }
  var showArticles = articles.slice(0, 4);
  listEl.innerHTML = showArticles.map(function(article) {
    return '<a class="special-card-item" href="' + article.url + '">' +
      '<div class="special-card-body">' +
        '<h3 class="special-card-title">' + article.title + '</h3>' +
        '<p class="special-card-desc">' + (article.desc || '') + '</p>' +
      '</div>' +
    '</a>';
  }).join('');
}

function renderLatestAppList() {
  const listEl = document.getElementById('latestAppList');
  if (!listEl) return;

  // 从全局APP池中获取所有APP，按发布时间降序排列，取最新的
  var allApps = getAllAppsPool();
  var appsWithTime = allApps.filter(function(a) { return a.publishTime; });

  // 按发布时间降序（最新的在前）
  appsWithTime.sort(function(a, b) {
    return (b.publishTime || '').localeCompare(a.publishTime || '');
  });

  var apps = appsWithTime.slice(0, 10); // 最多展示10条最新APP

  if (_tagFilter) {
    apps = apps.filter(matchTagFilter);
  }
  if (apps.length === 0) {
    listEl.innerHTML = '<div class="empty-hint">暂无最新APP，请先在后台添加内容</div>';
    return;
  }
  listEl.innerHTML = apps.map(app =>
    `<a class="app-item" href="detail.html?id=${app.id}&from=home">
      <div class="app-icon">${getAppIconHtml(app)}</div>
      <div class="app-info">
        <div class="app-name">${app.name}</div>
        <div class="app-desc">${app.desc || app.category || ''}</div>
        <div class="app-meta">${app.downloads}次下载 · ${app.publishTime ? app.publishTime.slice(0, 10) : ''}</div>
      </div>
      <span class="app-download-btn" data-url="${app.url}" data-name="${app.name}">${_downloadIconSvg}下载</span>
    </a>`
  ).join('');
}

function renderGameAppList() {
  const listEl = document.getElementById('gameAppList');
  if (!listEl || !siteData.game || !siteData.game.apps) return;
  var apps = siteData.game.apps;
  if (_tagFilter) {
    apps = apps.filter(matchTagFilter);
  }
  if (apps.length === 0) {
    listEl.innerHTML = '<div class="empty-filter-hint">没有匹配 &quot;' + _tagFilter + '&quot; 的游戏APP</div>';
    return;
  }
  listEl.innerHTML = apps.map(app =>
    `<a class="app-item" href="detail.html?id=${app.id}&from=game">
      <div class="app-icon">${getAppIconHtml(app)}</div>
      <div class="app-info">
        <div class="app-name">${app.name}</div>
        <div class="app-desc">${app.desc}</div>
        <div class="app-meta">${app.downloads}次下载</div>
      </div>
      <span class="app-download-btn" data-url="${app.url}" data-name="${app.name}">${_downloadIconSvg}下载</span>
    </a>`
  ).join('');
}

function renderTaskAppList() {
  const listEl = document.getElementById('taskAppList');
  if (!listEl || !siteData.task || !siteData.task.apps) return;
  var apps = siteData.task.apps;
  if (_tagFilter) {
    apps = apps.filter(matchTagFilter);
  }
  if (apps.length === 0) {
    listEl.innerHTML = '<div class="empty-filter-hint">没有匹配 &quot;' + _tagFilter + '&quot; 的悬赏APP</div>';
    return;
  }
  listEl.innerHTML = apps.map(app =>
    `<a class="app-item" href="detail.html?id=${app.id}&from=task">
      <div class="app-icon">${getAppIconHtml(app)}</div>
      <div class="app-info">
        <div class="app-name">${app.name}</div>
        <div class="app-desc">${app.desc}</div>
        <div class="app-meta">${app.downloads}次下载</div>
      </div>
      <span class="app-download-btn" data-url="${app.url}" data-name="${app.name}">${_downloadIconSvg}下载</span>
    </a>`
  ).join('');
}

function renderSpecialFullList() {
  const listEl = document.getElementById('specialFullList');
  if (!listEl) return;

  // 优先使用 topics 数据
  var topics = (siteData.special && siteData.special.topics) ? siteData.special.topics : [];
  var articles = (siteData.special && siteData.special.articles) ? siteData.special.articles : [];

  if (topics.length > 0) {
    listEl.innerHTML = topics.map(function(topic) {
      var coverHtml = topic.coverImage
        ? '<div class="special-full-cover"><img src="' + topic.coverImage + '" alt="' + topic.title + '" loading="lazy" onerror="this.parentElement.style.display=\'none\'"></div>'
        : '';
      var tagsHtml = (topic.tags && topic.tags.length > 0)
        ? '<div class="special-full-tags">' + topic.tags.map(function(t) { return '<span class="special-full-tag">' + t + '</span>'; }).join('') + '</div>'
        : '';
      var appCountHtml = (topic.relatedApps && topic.relatedApps.length > 0)
        ? '<span class="special-full-count">' + topic.relatedApps.length + '款APP</span>'
        : '';
      return '<a class="special-full-item" href="' + (topic.url || ('special-detail.html?id=' + topic.id)) + '">' +
        coverHtml +
        '<div class="special-full-body">' +
          '<div class="special-full-header">' +
            '<h3 class="special-full-title">' + topic.title + '</h3>' +
            appCountHtml +
          '</div>' +
          '<p class="special-full-desc">' + (topic.summary || topic.subtitle || '') + '</p>' +
          '<div class="special-full-footer">' +
            tagsHtml +
            '<span class="special-full-time">' + (topic.publishTime ? topic.publishTime.slice(0, 10) : '') + '</span>' +
          '</div>' +
        '</div>' +
      '</a>';
    }).join('');
    return;
  }

  // 兼容旧的 articles 格式
  if (articles.length === 0) {
    listEl.innerHTML = '<div class="empty-hint">暂无手赚专题数据</div>';
    return;
  }
  listEl.innerHTML = articles.map(article =>
    `<a class="special-full-item" href="${article.url}">
      <div class="special-full-body">
        <h3 class="special-full-title">${article.title}</h3>
        <p class="special-full-desc">${article.desc || ''}</p>
      </div>
    </a>`
  ).join('');
}

function renderFooter() {
  const footerLinksEl = document.getElementById('footerLinks');
  if (footerLinksEl && siteData.siteInfo && siteData.siteInfo.footerLinks) {
    footerLinksEl.innerHTML = siteData.siteInfo.footerLinks.map(link =>
      `<a href="${link.url}">${link.text}</a>`
    ).join('');
  }

  const friendLinksEl = document.getElementById('friendLinks');
  if (friendLinksEl && siteData.siteInfo && siteData.siteInfo.friendLinks) {
    friendLinksEl.innerHTML = '友情链接：' + siteData.siteInfo.friendLinks.map(link =>
      `<a href="${link.url}">${link.text}</a>`
    ).join(' | ');
  }

  const footerInfoEl = document.getElementById('footerInfo');
  if (footerInfoEl && siteData.siteInfo) {
    const emailVisible = siteData.siteInfo.emailVisible !== false;
    const email = emailVisible ? (siteData.siteInfo.email || '') : '';
    var mailIconSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 4l-10 8L2 4"/></svg>';
    const emailHtml = email ? '<span class="footer-email">' + mailIconSvg + ' <a href="mailto:' + email + '">' + email + '</a></span><br>' : '';
    footerInfoEl.innerHTML = `${emailHtml}${siteData.siteInfo.copyright}<br>${siteData.siteInfo.police} | ${siteData.siteInfo.icp}`;
  }

  const emailEl = document.getElementById('siteEmail');
  if (emailEl && siteData.siteInfo && siteData.siteInfo.email) {
    emailEl.textContent = siteData.siteInfo.email;
    emailEl.href = 'mailto:' + siteData.siteInfo.email;
  }
}

function getAppIconHtml(app) {
  if (!app) return '<span class="icon-fallback">APP</span>';
  if (app.icon && app.icon.trim()) {
    var src = app.icon.trim();
    // 统一处理路径：本地路径加 /，绝对URL保持不变
    if (src.startsWith('uploads/')) {
      src = '/' + src;
    } else if (!src.startsWith('/') && !src.startsWith('http://') && !src.startsWith('https://') && !src.startsWith('//') && !src.startsWith('data:')) {
      src = '/' + src;
    }
    return '<span class="icon-placeholder app-icon-placeholder"></span>' +
      '<img class="app-icon-img" src="' + src + '" alt="' + app.name + '" ' +
      'onload="this.style.display=\'block\';var p=this.previousElementSibling;if(p)p.style.display=\'none\';var f=this.nextElementSibling;if(f)f.style.display=\'none\';" ' +
      'onerror="this.style.display=\'none\';var p=this.previousElementSibling;if(p)p.style.display=\'none\';var f=this.nextElementSibling;if(f)f.style.display=\'flex\';" ' +
      '>' +
      '<span class="icon-fallback" style="display:none;">' + getAppIconText(app.name) + '</span>';
  }
  return '<span class="icon-fallback">' + getAppIconText(app.name) + '</span>';
}

function getAppIconText(name) {
  if (!name) return 'APP';
  return name.substring(0, 2);
}

// ===== 事件绑定 =====
function setupEvents() {
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', function(e) {
      e.preventDefault();
      switchTab(this.dataset.tab);
    });
  });

  document.querySelectorAll('.site-mobile-nav-item').forEach(item => {
    item.addEventListener('click', function(e) {
      e.preventDefault();
      switchTab(this.dataset.tab);
    });
  });

  document.querySelectorAll('.more-link').forEach(link => {
    link.addEventListener('click', function(e) {
      e.preventDefault();
      switchTab(this.dataset.tab);
    });
  });

  document.querySelectorAll('.app-download-btn').forEach(btn => {
    btn.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      // 下载按钮交互时被动同步数据
      triggerPassiveSync();
      const name = this.dataset.name || '';
      const url = this.dataset.url || '#';
      if (url && url !== '#') {
        window.open(url, '_blank');
      } else {
        alert('即将下载 ' + name + '，请稍候...');
      }
    });
  });

  var refreshBtn = document.getElementById('recommendRefreshBtn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', function(e) {
      e.preventDefault();
      window.refreshRecommendGrid();
    });
  }

  initPullToRefresh();
}

// ===== 下拉刷新 =====
var _pullToRefreshState = {
  enabled: false,
  startY: 0,
  pulling: false,
  threshold: 60,
  indicator: null,
  section: null
};

function initPullToRefresh() {
  var indicator = document.getElementById('recommendPullIndicator');
  var section = document.getElementById('recommendSection');
  if (!indicator || !section) return;

  _pullToRefreshState.indicator = indicator;
  _pullToRefreshState.section = section;
  _pullToRefreshState.enabled = true;

  section.addEventListener('touchstart', function(e) {
    if (!_pullToRefreshState.enabled) return;
    if (window.scrollY > 5) return;
    if (_currentTab !== 'home') return;
    _pullToRefreshState.startY = e.touches[0].clientY;
    _pullToRefreshState.pulling = false;
  }, { passive: true });

  section.addEventListener('touchmove', function(e) {
    if (!_pullToRefreshState.enabled) return;
    if (_pullToRefreshState.startY === 0) return;
    var currentY = e.touches[0].clientY;
    var diff = currentY - _pullToRefreshState.startY;

    if (diff > 15 && window.scrollY <= 5 && _currentTab === 'home') {
      _pullToRefreshState.pulling = true;
      var pullDistance = Math.min(diff * 0.5, 80);
      indicator.style.height = pullDistance + 'px';
      indicator.style.opacity = Math.min(pullDistance / _pullToRefreshState.threshold, 1);
      indicator.classList.add('visible');

      var pullText = indicator.querySelector('.pull-text');
      if (pullDistance >= _pullToRefreshState.threshold) {
        indicator.classList.add('ready');
        if (pullText) pullText.textContent = '松开立即刷新';
      } else {
        indicator.classList.remove('ready');
        if (pullText) pullText.textContent = '下拉刷新推荐';
      }
    }
  }, { passive: true });

  section.addEventListener('touchend', function(e) {
    if (!_pullToRefreshState.enabled) return;
    if (!_pullToRefreshState.pulling) {
      _pullToRefreshState.startY = 0;
      return;
    }
    _pullToRefreshState.pulling = false;
    _pullToRefreshState.startY = 0;

    var currentHeight = parseInt(indicator.style.height) || 0;

    if (currentHeight >= _pullToRefreshState.threshold) {
      indicator.style.height = '44px';
      indicator.classList.add('refreshing');
      indicator.classList.remove('ready');
      var pullText = indicator.querySelector('.pull-text');
      if (pullText) pullText.textContent = '正在刷新...';

      window.refreshRecommendPassive();

      setTimeout(function() {
        indicator.style.height = '0px';
        indicator.style.opacity = '0';
        indicator.classList.remove('visible', 'refreshing');
      }, 800);
    } else {
      indicator.style.height = '0px';
      indicator.style.opacity = '0';
      indicator.classList.remove('visible', 'ready', 'refreshing');
    }
  }, { passive: true });
}

// ===== 切换标签页 =====
function switchTab(tabId, keepFilter) {
  _currentTab = tabId;
  // 切换标签时被动同步数据
  triggerPassiveSync();

  if (!keepFilter && _tagFilter) {
    _tagFilter = '';
    var banner = document.getElementById('tagFilterBanner');
    if (banner) banner.remove();
  }

  document.querySelectorAll('.nav-item').forEach(item => {
    item.classList.toggle('active', item.dataset.tab === tabId);
  });

  document.querySelectorAll('.site-mobile-nav-item').forEach(item => {
    item.classList.toggle('active', item.dataset.tab === tabId);
  });

  document.querySelectorAll('.tab-page').forEach(page => {
    page.classList.toggle('active', page.id === `page-${tabId}`);
  });

  if (!keepFilter || !_tagFilter) {
    window.location.hash = tabId;
  }

  if (siteData.navTabs) {
    siteData.navTabs.forEach(tab => {
      tab.active = tab.id === tabId;
    });
  }

  // 滚动页面到顶部
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function handleHashChange() {
  var rawHash = window.location.hash.replace('#', '');
  var tagParam = '';
  var tabFromHash = rawHash;
  var qIdx = rawHash.indexOf('?');
  if (qIdx >= 0) {
    tabFromHash = rawHash.substring(0, qIdx);
    var queryStr = rawHash.substring(qIdx + 1);
    var params = new URLSearchParams(queryStr);
    tagParam = params.get('tag') || '';
  }

  var validTabs = siteData && siteData.navTabs ? siteData.navTabs.map(function(t) { return t.id; }) : ['home', 'game', 'task', 'special'];

  var targetTab = 'home';
  if (tabFromHash && validTabs.includes(tabFromHash)) {
    targetTab = tabFromHash;
  } else {
    if (siteData && siteData.navTabs) {
      var activeTab = siteData.navTabs.find(function(t) { return t.active; });
      if (activeTab) targetTab = activeTab.id;
    }
  }

  _tagFilter = tagParam ? decodeURIComponent(tagParam) : '';
  switchTab(targetTab, true);

  if (_tagFilter) {
    applyTagFilter(targetTab);
  }
}

function applyTagFilter(tabId) {
  if (tabId === 'home') {
    renderRecommendGrid();
    renderLatestAppList();
  } else if (tabId === 'game') {
    renderGameAppList();
  } else if (tabId === 'task') {
    renderTaskAppList();
  }
  showTagFilterBanner();
}

function showTagFilterBanner() {
  var existing = document.getElementById('tagFilterBanner');
  if (existing) existing.remove();
  if (!_tagFilter) return;

  var banner = document.createElement('div');
  banner.id = 'tagFilterBanner';
  banner.className = 'tag-filter-banner';
  banner.innerHTML = '<span class="tag-filter-icon">' + _searchIconSvg + '</span>' +
    '<span>搜索标签：<strong>' + _tagFilter + '</strong></span>' +
    '<button class="tag-filter-clear" onclick="clearTagFilter()" title="清除过滤">' + _closeIconSvg + ' 清除</button>';
  
  var mainEl = document.querySelector('.main-content');
  if (mainEl) {
    mainEl.insertBefore(banner, mainEl.firstChild);
  }
}

function clearTagFilter() {
  _tagFilter = '';
  var banner = document.getElementById('tagFilterBanner');
  if (banner) banner.remove();
  var hash = window.location.hash.replace('#', '');
  var qIdx = hash.indexOf('?');
  if (qIdx >= 0) {
    window.location.hash = hash.substring(0, qIdx);
  }
  renderAll();
}

function matchTagFilter(app) {
  if (!_tagFilter) return true;
  var keyword = _tagFilter.toLowerCase();
  var nameMatch = app.name && app.name.toLowerCase().indexOf(keyword) >= 0;
  var categoryMatch = app.category && app.category.toLowerCase().indexOf(keyword) >= 0;
  var nameAppMatch = app.name && (app.name + 'APP').toLowerCase().indexOf(keyword) >= 0;
  return nameMatch || categoryMatch || nameAppMatch;
}

// ===== 启动 =====
document.addEventListener('DOMContentLoaded', async function() {
  await init();
  handleHashChange();
});

window.addEventListener('hashchange', handleHashChange);
