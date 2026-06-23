// ===== 挖赚网 - 统一内容管理系统 v2 =====

var siteData = null;
var currentModalType = '';
var currentEditIndex = -1;
var _currentSection = 'recommend'; // 当前选中的内容区域
var _searchQuery = '';
var _publishTimeTimer = null;
var _isInitialized = false;

// ===== 认证辅助：在所有请求中自动携带 token =====
function authHeaders(extra) {
  var headers = extra || {};
  var token = sessionStorage.getItem('admin_token');
  if (token) headers['X-Admin-Token'] = token;
  return headers;
}
function authFetch(url, options) {
  options = options || {};
  options.headers = authHeaders(options.headers || {});
  return fetch(url, options);
}

// ===== 区域定义 =====
var SECTIONS = {
  recommend: { name: '推荐APP', icon: '\u2764', color: 'recommend', array: function() { return siteData.home.recommend; }, fields: appFields },
  latestApps: { name: '最新APP', icon: '\uD83D\uDCF1', color: 'latest', array: function() { return siteData.home.latestApps; }, fields: appFieldsWithDesc },
  game: { name: '游戏玩试', icon: '\uD83C\uDFAE', color: 'game', array: function() { return siteData.game.apps; }, fields: appFieldsWithDesc },
  task: { name: '悬赏任务', icon: '\uD83D\uDCCB', color: 'task', array: function() { return siteData.task.apps; }, fields: appFieldsWithDesc },
  special: { name: '手赚专题', icon: '\uD83D\uDCDD', color: 'special', array: function() { return siteData.special.articles; }, fields: articleFields }
};

function appFields(item) {
  return [
    { key: 'name', label: 'APP名称', type: 'text', value: item ? item.name : '' },
    { key: 'downloads', label: '下载次数', type: 'number', value: item ? item.downloads : 0 },
    { key: 'url', label: '下载链接', type: 'text', value: item ? item.url : '#', hint: '填APP下载地址，或填#暂不链接' },
    { key: 'icon', label: 'APP图标', type: 'icon', value: item ? item.icon : '', hint: '支持URL链接或本地上传' },
    { key: 'platform', label: '支持平台', type: 'text', value: item ? (item.platform || 'Android/iOS') : 'Android/iOS' },
    { key: 'appSize', label: 'APP大小', type: 'text', value: item ? (item.appSize || '') : '' },
    { key: 'developer', label: '开发者', type: 'text', value: item ? (item.developer || '') : '' },
    { key: 'withdrawMethod', label: '提现方式', type: 'text', value: item ? (item.withdrawMethod || '微信/支付宝') : '微信/支付宝' },
    { key: 'category', label: '分类', type: 'category', value: item ? (item.category || '') : '', hint: '如：悬赏任务、游戏试玩' },
    { key: 'publishTime', label: '发布时间', type: 'publishTime', value: item ? (item.publishTime || '') : '' },
    { key: 'content', label: '文章正文', type: 'textarea-lg', value: item ? (item.content || '') : '', hint: '详情页展示的正文内容' },
    { key: 'features', label: '功能特点', type: 'textarea', value: item ? ((item.features || []).join('\n')) : '', hint: '每行一个特点' },
    { key: 'screenshots', label: '应用截图', type: 'screenshots', value: item ? (item.screenshots || []) : [] }
  ];
}

function appFieldsWithDesc(item) {
  var f = appFields(item);
  f.splice(2, 0, { key: 'desc', label: 'APP描述', type: 'textarea', value: item ? item.desc : '' });
  return f;
}

function articleFields(item) {
  return [
    { key: 'title', label: '文章标题', type: 'text', value: item ? item.title : '' },
    { key: 'desc', label: '文章摘要', type: 'textarea', value: item ? item.desc : '', hint: '在首页/专题列表显示的简短描述' },
    { key: 'content', label: '文章正文', type: 'textarea-lg', value: item ? (item.content || '') : '', hint: '支持HTML标签' },
    { key: 'url', label: '文章链接', type: 'text', value: item ? item.url : '', hint: '自动生成，一般不需修改' }
  ];
}

// ===== 初始化 =====
function init() {
  if (_isInitialized) return;
  _isInitialized = true;

  initMobileUI();

  if (typeof SyncEngine === 'undefined') {
    console.warn('[admin] SyncEngine 未加载，使用 localStorage 模式');
    loadFromLocalStorage();
    return;
  }

  SyncEngine.start().then(function() {
    SyncEngine.on('dataUpdated', function(e) {
      if (e.source !== 'admin') {
        siteData = e.data;
        renderAll();
        updateSyncStatus('synced-external');
        showToast('数据已从其他标签页同步', 'info');
      }
    });

    // 优先从 SyncEngine 获取最新数据（SyncEngine.start() 已从 data.json 加载）
    var engineData = SyncEngine.getData();
    if (engineData) {
      siteData = engineData;
      saveToStorage(false);
      renderAll();
      console.log('[admin] 已从 data.json 加载最新数据');
      return;
    }

    // data.json 不可用 → 回退到 localStorage 缓存
    var stored = localStorage.getItem('wazhuan_data');
    if (stored) {
      try {
        var parsed = JSON.parse(stored);
        if (parsed._lastModified) { siteData = parsed; renderAll(); console.log('[admin] 使用 localStorage 缓存'); return; }
      } catch(e) {}
    }

    // 无可用数据 → 使用默认结构
    siteData = getDefaultData();
    saveToStorage(false);
    renderAll();
    console.log('[admin] 使用默认数据');
  }).catch(function(err) {
    console.error('[admin] SyncEngine 启动失败:', err);
    loadFromLocalStorage();
  });
}

function loadFromLocalStorage() {
  var stored = localStorage.getItem('wazhuan_data');
  if (stored) {
    try {
      var parsed = JSON.parse(stored);
      if (parsed._lastModified) {
        siteData = parsed;
        renderAll();
        return;
      }
    } catch(e) {}
  }
  siteData = getDefaultData();
  renderAll();
}

function getDefaultData() {
  return {
    siteInfo: { name: "挖赚网", domain: "www.wazhuan.cn", email: "admin@wazhuan.cn", emailVisible: true, copyright: "Copyright \u00a9 2025 挖赚网", icp: "渝ICP备2021014403号-4", police: "渝公网安备50023802000211号", logo: "", logoText: "挖赚网", logoSlogan: "手机赚钱APP推荐平台", footerLinks: [], friendLinks: [] },
    navTabs: [{ id: "home", name: "首页", active: true, icon: "", iconVisible: true, showIcon: true, sort: 1 }, { id: "game", name: "游戏玩试", active: false, icon: "", iconVisible: true, showIcon: true, sort: 2 }, { id: "task", name: "悬赏任务", active: false, icon: "", iconVisible: true, showIcon: true, sort: 3 }, { id: "special", name: "手赚专题", active: false, icon: "", iconVisible: true, showIcon: true, sort: 4 }],
    home: { recommend: [], latestApps: [] },
    game: { apps: [] },
    task: { apps: [] },
    special: { articles: [] }
  };
}

function saveToStorage(showMsg) {
  if (!siteData) return;
  siteData._lastModified = Date.now();
  try {
    localStorage.setItem('wazhuan_data', JSON.stringify(siteData));
  } catch(e) {
    console.error('[admin] localStorage 写入失败:', e);
  }
  try {
    var userCache = Object.assign({}, siteData);
    userCache._lastModified = Date.now();
    localStorage.setItem('wazhuan_user_cache', JSON.stringify(userCache));
  } catch(e) {}
  if (typeof SyncEngine !== 'undefined') SyncEngine.notifyUpdate();
  persistToFile();
  updateSyncStatus('saved');
  if (showMsg !== false) {
    showToast('保存成功，前台页面将自动刷新', 'success');
  }
}

var _persistTimer = null;
function persistToFile() {
  clearTimeout(_persistTimer);
  _persistTimer = setTimeout(function() {
    try {
      var exportObj = {};
      for (var k in siteData) {
        if (siteData.hasOwnProperty(k) && k !== '_lastModified') {
          exportObj[k] = siteData[k];
        }
      }
      authFetch('/api/file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath: 'data.json', content: JSON.stringify(exportObj, null, 2) })
      }).then(function(res) { return res.json(); }).then(function(result) {
        if (!result.success) console.warn('[admin] data.json 写入失败:', result.error);
      }).catch(function(e) { console.error('[admin] data.json 写入异常:', e.message); });
    } catch(e) { console.error('[admin] persistToFile 异常:', e); }
  }, 500);
}

function showToast(msg, type) {
  type = type || 'success';
  var el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.className = 'toast toast-' + type + ' show';
  clearTimeout(el._toastTimer);
  el._toastTimer = setTimeout(function() { el.classList.remove('show'); }, 2500);
}

// ===== 顶部同步状态指示器 =====
function updateSyncStatus(status) {
  var dot = document.getElementById('syncDot');
  var text = document.getElementById('syncStatus');
  if (!dot || !text) return;

  if (status === 'saving') {
    dot.style.background = '#faad14';
    dot.style.animation = 'syncPulse 0.5s infinite';
    text.textContent = '正在保存...';
  } else if (status === 'saved') {
    dot.style.background = '#52c41a';
    dot.style.animation = 'syncPulse 2s infinite';
    text.textContent = '已同步';
    setTimeout(function() {
      if (text) text.textContent = '实时同步中';
    }, 1500);
  } else if (status === 'synced-external') {
    dot.style.background = '#1890ff';
    dot.style.animation = 'syncPulse 0.8s infinite';
    text.textContent = '已从外部同步';
    setTimeout(function() {
      if (text) text.textContent = '实时同步中';
      if (dot) {
        dot.style.background = '#52c41a';
        dot.style.animation = 'syncPulse 2s infinite';
      }
    }, 1500);
  } else if (status === 'error') {
    dot.style.background = '#ff4d4f';
    dot.style.animation = 'none';
    text.textContent = '同步失败';
  } else {
    dot.style.background = '#52c41a';
    dot.style.animation = 'syncPulse 2s infinite';
    text.textContent = '实时同步中';
  }
}

// ===== 手动刷新全部数据 =====
var _isRefreshing = false;
function refreshAllData() {
  if (_isRefreshing) return;
  _isRefreshing = true;

  updateSyncStatus('saving');

  try {
    if (typeof SyncEngine !== 'undefined') {
      SyncEngine.loadData().then(function(freshData) {
        _isRefreshing = false;
        if (freshData) {
          siteData = freshData;
          siteData._lastModified = Date.now();
          try { localStorage.setItem('wazhuan_data', JSON.stringify(siteData)); } catch(e) {}
          renderAll();
          updateSyncStatus('saved');
          showToast('数据已刷新');
        } else {
          updateSyncStatus('error');
          showToast('刷新失败，请检查网络', 'error');
        }
      }).catch(function(e) {
        _isRefreshing = false;
        updateSyncStatus('error');
        showToast('刷新失败: ' + e.message, 'error');
      });
    } else {
      _isRefreshing = false;
      showToast('离线模式，无需刷新', 'info');
    }
  } catch(e) {
    _isRefreshing = false;
    updateSyncStatus('error');
    showToast('刷新失败: ' + e.message, 'error');
  }
}

// ===== 渲染所有 =====
function renderAll() {
  if (!siteData) return;
  try {
    renderStats();
    renderListPanel();
    renderSettingsPanel();
    renderGlobalConfigPanel();
    renderBackupPanel();
  } catch(e) {
    console.error('[admin] renderAll 异常:', e);
  }
}

// ===== 统计卡片（按钮组）=====
function renderStats() {
  var el = document.getElementById('statsRow');
  if (!el) return;
  var sections = ['recommend', 'latestApps', 'game', 'task', 'special'];
  var counts = {};
  try {
    counts = {
      recommend: (siteData.home && siteData.home.recommend) ? siteData.home.recommend.length : 0,
      latestApps: (siteData.home && siteData.home.latestApps) ? siteData.home.latestApps.length : 0,
      game: (siteData.game && siteData.game.apps) ? siteData.game.apps.length : 0,
      task: (siteData.task && siteData.task.apps) ? siteData.task.apps.length : 0,
      special: (siteData.special && siteData.special.articles) ? siteData.special.articles.length : 0
    };
  } catch(e) {
    console.error('[admin] renderStats 计数异常:', e);
    return;
  }
  var settingsActive = ['settings','globalConfig','backup'].indexOf(_currentSection) >= 0;
  el.innerHTML = sections.map(function(s) {
    var sec = SECTIONS[s];
    return '<div class="stat-card' + (_currentSection === s ? ' selected' : '') + '" onclick="switchSection(\'' + s + '\')" role="button" tabindex="0">' +
      '<div class="stat-icon ' + sec.color + '">' + sec.icon + '</div>' +
      '<div class="stat-info"><div class="stat-value">' + (counts[s] || 0) + '</div><div class="stat-label">' + sec.name + '</div></div>' +
    '</div>';
  }).join('') +
  '<div class="stat-card" onclick="showAddTypeModal()" role="button" tabindex="0" style="border:2px dashed #ff6b35;background:#fff8f5;">' +
    '<div class="stat-icon" style="background:linear-gradient(135deg, #ff6b35, #ff8f5e);">+</div>' +
    '<div class="stat-info"><div class="stat-value" style="color:#ff6b35;">+</div><div class="stat-label" style="color:#ff6b35;font-weight:600;">添加内容</div></div>' +
  '</div>' +
  '<div class="stat-card" onclick="showSettings()" role="button" tabindex="0" style="' + (settingsActive ? 'border-color:#8c8c8c;background:#fafafa;' : '') + '">' +
    '<div class="stat-icon settings">\u2699</div>' +
    '<div class="stat-info"><div class="stat-value">' + (siteData.navTabs ? siteData.navTabs.length : 0) + '</div><div class="stat-label">系统设置</div></div>' +
  '</div>';
}

// ===== 区域切换 =====
function switchSection(section) {
  _currentSection = section;
  _searchQuery = '';
  var contentCard = document.getElementById('contentCard');
  var listPanel = document.getElementById('listPanel');
  var settingsCard = document.getElementById('settingsCard');
  var globalConfigCard = document.getElementById('globalConfigCard');
  var backupCard = document.getElementById('backupCard');
  // 显示列表面板
  if (listPanel) listPanel.style.display = '';
  if (contentCard) contentCard.style.display = 'none';
  if (settingsCard) settingsCard.style.display = 'none';
  if (globalConfigCard) globalConfigCard.style.display = 'none';
  if (backupCard) backupCard.style.display = 'none';
  renderStats();
  renderListPanel();
  updateMobileActiveState();
  if (typeof window !== 'undefined' && window.innerWidth <= 480) {
    closeSidebar();
  }
}

function showSettings() {
  _currentSection = 'settings';
  var contentCard = document.getElementById('contentCard');
  var listPanel = document.getElementById('listPanel');
  var settingsCard = document.getElementById('settingsCard');
  var globalConfigCard = document.getElementById('globalConfigCard');
  var backupCard = document.getElementById('backupCard');
  if (contentCard) contentCard.style.display = 'none';
  if (listPanel) listPanel.style.display = 'none';
  if (settingsCard) settingsCard.style.display = '';
  if (globalConfigCard) globalConfigCard.style.display = '';
  if (backupCard) backupCard.style.display = '';
  renderStats();
  renderSettingsPanel();
  renderGlobalConfigPanel();
  renderBackupPanel();
  updateMobileActiveState();
}

// ===== 列表面板（替代原大红框表格）=====
function renderListPanel() {
  var sec = SECTIONS[_currentSection];
  if (!sec) return;

  var panelEl = document.getElementById('listPanel');
  if (!panelEl) return;

  var arr = [];
  try { arr = sec.array(); } catch(e) { arr = []; }
  if (_searchQuery) {
    arr = arr.filter(function(item) {
      var searchStr = (item.name || item.title || '') + (item.desc || '') + (item.category || '');
      return searchStr.toLowerCase().indexOf(_searchQuery.toLowerCase()) >= 0;
    });
  }

  var isArticle = _currentSection === 'special';

  panelEl.innerHTML = 
    '<div class="card" style="margin-top:0;">' +
      '<div class="card-header">' +
        '<h3>' + sec.name + '列表（' + arr.length + '项）</h3>' +
        '<div style="display:flex;align-items:center;gap:10px;">' +
          '<div class="search-box" style="margin-bottom:0;min-width:180px;">' +
            '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="position:absolute;left:10px;top:50%;transform:translateY(-50%);color:#ccc;"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>' +
            '<input type="text" placeholder="搜索' + sec.name + '..." value="' + _searchQuery + '" oninput="_searchQuery=this.value;renderListPanel();" style="padding-left:34px;">' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="card-body">' +
        (arr.length === 0 
          ? '<div style="text-align:center;padding:40px 20px;color:#ccc;">' +
              '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" style="opacity:0.3;margin-bottom:12px;"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="9" x2="15" y2="15"/><line x1="15" y1="9" x2="9" y2="15"/></svg>' +
              '<p>' + (_searchQuery ? '没有匹配 "' + _searchQuery + '" 的内容' : '暂无数据，点击顶部「+ 添加内容」按钮添加') + '</p>' +
              (_searchQuery ? '<button class="btn btn-default btn-sm" onclick="_searchQuery=\'\';renderListPanel();" style="margin-top:12px;">清除搜索</button>' : '') +
            '</div>'
          : '<div class="table-wrap"><table class="table"><thead><tr>' +
              '<th class="col-id">ID</th>' +
              '<th class="col-name">' + (isArticle ? '标题' : '名称') + '</th>' +
              (isArticle ? '' : '<th>分类</th>') +
              '<th class="col-desc">' + (isArticle ? '摘要' : '描述') + '</th>' +
              (isArticle ? '' : '<th class="col-screenshots">截图</th>') +
              '<th class="col-actions">操作</th>' +
            '</tr></thead><tbody>' +
            arr.map(function(item, i) {
              var name = item.name || item.title || '';
              var desc = (item.desc || '').substring(0, 60);
              var cat = item.category || '';
              var ss = item.screenshots ? item.screenshots.length : 0;
              return '<tr>' +
                '<td class="col-id" data-label="ID">' + (item.id || '') + '</td>' +
                '<td class="col-name" data-label="' + (isArticle ? '标题' : '名称') + '">' + name + '</td>' +
                (isArticle ? '' : '<td class="col-tag" data-label="分类">' + (cat ? '<span class="tag-recommend">' + cat + '</span>' : '') + '</td>') +
                '<td class="col-desc" data-label="' + (isArticle ? '摘要' : '描述') + '" title="' + (item.desc || '') + '">' + desc + '</td>' +
                (isArticle ? '' : '<td class="col-screenshots" data-label="截图">' + ss + '张</td>') +
                '<td class="col-actions" data-label="操作">' +
                  '<button class="btn btn-default btn-sm" onclick="editItem(\'' + _currentSection + '\',' + i + ')">编辑</button> ' +
                  '<button class="btn btn-danger btn-sm" onclick="deleteItem(\'' + _currentSection + '\',' + i + ')">删除</button>' +
                '</td>' +
              '</tr>';
            }).join('') +
            '</tbody></table></div>'
        ) +
      '</div>' +
    '</div>';
}

// ===== 网站设置面板 =====
function renderSettingsPanel() {
  var s = siteData.siteInfo;
  if (!s) return;
  var el = document.getElementById('settingsBody');
  if (!el) return;
  el.innerHTML =
    '<div class="form-row">' +
      '<div class="form-group"><label class="form-label">网站名称</label><input class="form-input" id="si_name" value="' + (s.name || '') + '"></div>' +
      '<div class="form-group"><label class="form-label">域名</label><input class="form-input" id="si_domain" value="' + (s.domain || '') + '"></div>' +
    '</div>' +
    '<div class="form-row">' +
      '<div class="form-group"><label class="form-label">联系信箱</label><input class="form-input" id="si_email" value="' + (s.email || '') + '"></div>' +
      '<div class="form-group" style="flex:0 0 auto;min-width:130px"><label class="form-label">邮箱显示</label>' +
        '<label style="display:flex;align-items:center;gap:8px;height:42px;cursor:pointer;font-size:14px;">' +
          '<input type="checkbox" id="si_emailVisible" ' + (s.emailVisible !== false ? 'checked' : '') + ' onchange="siteData.siteInfo.emailVisible=this.checked;saveToStorage();" style="accent-color:#ff6b35;width:16px;height:16px;cursor:pointer;">在页脚显示</label></div>' +
    '</div>' +
    '<div class="form-row">' +
      '<div class="form-group"><label class="form-label">版权信息</label><input class="form-input" id="si_copyright" value="' + (s.copyright || '') + '"></div>' +
    '</div>' +
    '<div class="form-row">' +
      '<div class="form-group"><label class="form-label">ICP备案号</label><input class="form-input" id="si_icp" value="' + (s.icp || '') + '"></div>' +
      '<div class="form-group"><label class="form-label">公安备案号</label><input class="form-input" id="si_police" value="' + (s.police || '') + '"></div>' +
    '</div>' +
    '<div class="form-row">' +
      '<div class="form-group"><label class="form-label">Logo文字</label><input class="form-input" id="si_logoText" value="' + (s.logoText || '') + '" placeholder="挖赚网"></div>' +
      '<div class="form-group"><label class="form-label">标语</label><input class="form-input" id="si_logoSlogan" value="' + (s.logoSlogan || '') + '" placeholder="手机赚钱APP推荐平台"></div>' +
    '</div>' +
    '<div class="form-group"><label class="form-label">Logo图片</label>' + buildImageField('si_logo', 'Logo图片', s.logo || '', '支持URL或本地上传，留空显示首字', (s.logo && s.logo.startsWith('uploads/')) ? 'upload' : 'url') + '</div>' +
    '<h4 style="margin:20px 0 12px;font-size:15px;color:#555;">页脚链接</h4>' +
    '<div id="footerLinksList">' + renderLinkList('footer', s.footerLinks) + '</div>' +
    '<button class="btn btn-default btn-sm" onclick="addLink(\'footer\')" style="margin-top:8px;">+ 添加链接</button>' +
    '<h4 style="margin:20px 0 12px;font-size:15px;color:#555;">友情链接</h4>' +
    '<div id="friendLinksList">' + renderLinkList('friend', s.friendLinks) + '</div>' +
    '<button class="btn btn-default btn-sm" onclick="addLink(\'friend\')" style="margin-top:8px;">+ 添加链接</button>' +
    '<h4 style="margin:20px 0 12px;font-size:15px;color:#555;">模块悬停背景色</h4>' +
    '<div class="form-row">' +
      '<div class="form-group"><label class="form-label">推荐模块</label><input class="form-input" id="si_hoverBgRecommend" value="' + (s.hoverBgRecommend || 'transparent') + '" placeholder="transparent"></div>' +
      '<div class="form-group"><label class="form-label">手赚专题</label><input class="form-input" id="si_hoverBgSpecial" value="' + (s.hoverBgSpecial || 'transparent') + '" placeholder="transparent"></div>' +
    '</div>' +
    '<div class="form-row">' +
      '<div class="form-group"><label class="form-label">最新手赚APP</label><input class="form-input" id="si_hoverBgLatestApp" value="' + (s.hoverBgLatestApp || 'transparent') + '" placeholder="transparent"></div>' +
      '<div class="form-group"><label class="form-label">猜你喜欢</label><input class="form-input" id="si_hoverBgRelated" value="' + (s.hoverBgRelated || 'transparent') + '" placeholder="transparent"></div>' +
    '</div>' +
    '<p style="color:#999;font-size:12px;margin-top:4px;">支持颜色值（如 #fff5f0、rgba(255,0,0,0.1)），留空或填 transparent 表示透明</p>';
}

function renderLinkList(type, links) {
  if (!links) return '';
  return links.map(function(link, i) {
    return '<div class="link-item">' +
      '<input class="form-input" value="' + (link.text || '') + '" onchange="updateLink(\'' + type + '\',' + i + ',\'text\',this.value)" placeholder="链接文字" style="flex:1">' +
      '<input class="form-input" type="url" value="' + (link.url || '') + '" onchange="updateLink(\'' + type + '\',' + i + ',\'url\',this.value)" placeholder="链接地址（https://...）" style="flex:1">' +
      '<button class="btn btn-danger btn-sm" onclick="deleteLink(\'' + type + '\',' + i + ');renderSettingsPanel();">删除</button>' +
    '</div>';
  }).join('');
}

function addLink(type) {
  var arr = type === 'footer' ? siteData.siteInfo.footerLinks : siteData.siteInfo.friendLinks;
  arr.push({ text: '', url: '#' });
  saveToStorage();
  renderSettingsPanel();
}
function updateLink(type, i, key, val) {
  var arr = type === 'footer' ? siteData.siteInfo.footerLinks : siteData.siteInfo.friendLinks;
  arr[i][key] = val;
  saveToStorage();
}
function deleteLink(type, i) {
  var arr = type === 'footer' ? siteData.siteInfo.footerLinks : siteData.siteInfo.friendLinks;
  arr.splice(i, 1);
  saveToStorage();
}

function saveSiteSettings() {
  var s = siteData.siteInfo;
  var nameEl = document.getElementById('si_name');
  var domainEl = document.getElementById('si_domain');
  var emailEl = document.getElementById('si_email');
  var copyrightEl = document.getElementById('si_copyright');
  var icpEl = document.getElementById('si_icp');
  var policeEl = document.getElementById('si_police');
  var logoTextEl = document.getElementById('si_logoText');
  var logoSloganEl = document.getElementById('si_logoSlogan');
  if (nameEl) s.name = nameEl.value;
  if (domainEl) s.domain = domainEl.value;
  if (emailEl) s.email = emailEl.value;
  if (copyrightEl) s.copyright = copyrightEl.value;
  if (icpEl) s.icp = icpEl.value;
  if (policeEl) s.police = policeEl.value;
  if (logoTextEl) s.logoText = logoTextEl.value;
  if (logoSloganEl) s.logoSlogan = logoSloganEl.value;
  var logoInput = document.getElementById('modal_si_logo');
  var logoVal = logoInput ? logoInput.value.trim() : '';
  // 如果URL输入框为空，尝试从上传区域获取
  if (!logoVal) {
    var logoPreview = document.getElementById('img_preview_si_logo');
    if (logoPreview && logoPreview.classList.contains('visible') && logoPreview.src) {
      var src = logoPreview.src;
      var idx = src.indexOf('/uploads/');
      if (idx >= 0) logoVal = src.substring(idx + 1);
    }
  }
  s.logo = logoVal;
  var hbrEl = document.getElementById('si_hoverBgRecommend');
  var hbsEl = document.getElementById('si_hoverBgSpecial');
  var hblEl = document.getElementById('si_hoverBgLatestApp');
  var hbxEl = document.getElementById('si_hoverBgRelated');
  if (hbrEl) s.hoverBgRecommend = hbrEl.value.trim() || 'transparent';
  if (hbsEl) s.hoverBgSpecial = hbsEl.value.trim() || 'transparent';
  if (hblEl) s.hoverBgLatestApp = hblEl.value.trim() || 'transparent';
  if (hbxEl) s.hoverBgRelated = hbxEl.value.trim() || 'transparent';
  saveToStorage();
  renderAll();
}

// ===== 全局配置面板 =====
function renderGlobalConfigPanel() {
  var el = document.getElementById('globalConfigBody');
  if (!el) return;
  if (!siteData.navTabs || !siteData.navTabs.length) {
    el.innerHTML = '<p style="color:#999;text-align:center;padding:20px;">暂无导航标签</p>';
    return;
  }
  var sorted = [].concat(siteData.navTabs).sort(function(a, b) { return (a.sort || 99) - (b.sort || 99); });
  el.innerHTML = '<p class="form-hint" style="margin-bottom:16px;">控制每个导航标签前方图标的显示或隐藏。</p>' +
    sorted.map(function(tab) {
      var showIcon = tab.showIcon !== false;
      var iconVisible = tab.iconVisible !== false;
      return '<div class="toggle-switch-wrap">' +
        '<div class="toggle-switch-info">' +
          '<div class="toggle-switch-name">' + tab.name + '</div>' +
          '<div class="toggle-switch-id">#' + tab.id + '</div>' +
          '<div class="toggle-switch-status ' + (showIcon ? 'on' : 'off') + '">' + (showIcon ? '图标已显示' : '图标已隐藏') + '</div>' +
        '</div>' +
        '<label class="toggle-switch"><input type="checkbox" id="cfg_show_' + tab.id + '" ' + (showIcon ? 'checked' : '') + ' onchange="toggleShowIcon(\'' + tab.id + '\', this.checked)"><span class="toggle-slider"></span></label>' +
      '</div>' +
      '<div class="toggle-switch-wrap">' +
        '<div class="toggle-switch-info">' +
          '<div class="toggle-switch-name">' + tab.name + ' \u00b7 自定义图片</div>' +
          '<div class="toggle-switch-id">#' + tab.id + '</div>' +
          '<div class="toggle-switch-status ' + (iconVisible ? 'on' : 'off') + '">' + (iconVisible ? '自定义图标已启用' : '使用SVG默认图标') + '</div>' +
        '</div>' +
        '<label class="toggle-switch"><input type="checkbox" id="cfg_icon_' + tab.id + '" ' + (iconVisible ? 'checked' : '') + ' onchange="toggleIconVisible(\'' + tab.id + '\', this.checked)"><span class="toggle-slider"></span></label>' +
      '</div>';
    }).join('');
}

function toggleShowIcon(tabId, checked) {
  var tab = siteData.navTabs.find(function(t) { return t.id === tabId; });
  if (!tab) return;
  tab.showIcon = checked;
  saveToStorage();
  renderGlobalConfigPanel();
}
function toggleIconVisible(tabId, checked) {
  var tab = siteData.navTabs.find(function(t) { return t.id === tabId; });
  if (!tab) return;
  tab.iconVisible = checked;
  saveToStorage();
  renderGlobalConfigPanel();
}
function saveGlobalConfig() {
  saveToStorage();
  renderGlobalConfigPanel();
  showToast('全局配置已保存');
}

// ===== 备份面板 =====
function renderBackupPanel() {
  var el = document.getElementById('backupBody');
  if (!el) return;
  el.innerHTML =
    '<div class="btn-group" style="margin-bottom:20px;">' +
      '<button class="btn btn-primary btn-sm" onclick="backupExport()">导出完整备份</button>' +
      '<button class="btn btn-default btn-sm" onclick="backupDownload()">下载备份文件</button>' +
      '<button class="btn btn-danger btn-sm" onclick="resetData()">重置数据</button>' +
    '</div>' +
    '<div id="backupStatus" style="min-height:20px;margin-bottom:12px;font-size:13px;"></div>' +
    '<textarea class="form-textarea form-textarea-lg" id="exportJson" readonly placeholder="备份数据将显示在此处..."></textarea>' +
    '<h4 style="margin:20px 0 12px;font-size:15px;color:#555;">还原数据</h4>' +
    '<div id="backupDropZone" class="backup-zone" onclick="document.getElementById(\'backupFileInput\').click()">' +
      '<div style="font-size:32px;margin-bottom:8px;opacity:0.3;">\uD83D\uDCC1</div>' +
      '<div style="color:#666;">点击选择备份文件 或 拖拽到此处</div>' +
      '<div style="color:#999;font-size:12px;margin-top:4px;">支持 .json 格式</div>' +
      '<input type="file" id="backupFileInput" accept=".json" style="display:none;" onchange="handleBackupFileSelect(event)">' +
    '</div>' +
    '<textarea class="form-textarea" id="importJson" placeholder="或粘贴备份 JSON 内容..." style="margin-top:12px;min-height:120px;"></textarea>' +
    '<div class="btn-group" style="margin-top:12px;">' +
      '<button class="btn btn-default btn-sm" onclick="backupVerify()">校验备份</button>' +
      '<button class="btn btn-primary btn-sm" onclick="backupRestore()">还原数据</button>' +
    '</div>' +
    '<div id="restoreStatus" style="min-height:20px;margin-top:12px;font-size:13px;"></div>';

  setTimeout(function() {
    var zone = document.getElementById('backupDropZone');
    if (!zone) return;
    zone.addEventListener('dragover', function(e) { e.preventDefault(); zone.style.borderColor = '#ff6b35'; zone.style.background = '#fff5f0'; });
    zone.addEventListener('dragleave', function(e) { e.preventDefault(); zone.style.borderColor = '#d9d9d9'; zone.style.background = '#fafafa'; });
    zone.addEventListener('drop', function(e) {
      e.preventDefault();
      zone.style.borderColor = '#d9d9d9';
      zone.style.background = '#fafafa';
      var file = e.dataTransfer.files[0];
      if (file) readBackupFile(file);
    });
  }, 100);
}

// ===== 通用数据操作 =====
function addItem() {
  if (!SECTIONS[_currentSection]) {
    showToast('请先选择一个区域', 'error');
    return;
  }
  openModal(_currentSection, -1);
}

// ===== 全局添加内容（弹窗选择类型）=====
function globalAddItem() {
  showAddTypeModal();
}

function showAddTypeModal() {
  var overlay = document.getElementById('modalOverlay');
  var title = document.getElementById('modalTitle');
  var body = document.getElementById('modalBody');
  if (!overlay || !title || !body) return;

  title.textContent = '添加新内容';
  var tabs = siteData.navTabs || [];
  // 首页展开为 推荐APP + 最新APP
  var types = [];
  tabs.forEach(function(tab) {
    if (tab.id === 'home') {
      types.push({ id: 'recommend', name: '推荐APP', tab: '首页', icon: '\u2764', desc: '首页推荐区域' });
      types.push({ id: 'latestApps', name: '最新APP', tab: '首页', icon: '\uD83D\uDCF1', desc: '首页最新APP列表' });
    } else if (tab.id === 'game') {
      types.push({ id: 'game', name: '游戏玩试', tab: tab.name, icon: '\uD83C\uDFAE', desc: '游戏试玩专区' });
    } else if (tab.id === 'task') {
      types.push({ id: 'task', name: '悬赏任务', tab: tab.name, icon: '\uD83D\uDCCB', desc: '悬赏任务专区' });
    } else if (tab.id === 'special') {
      types.push({ id: 'special', name: '手赚专题', tab: tab.name, icon: '\uD83D\uDCDD', desc: '专题文章' });
    }
  });

  body.innerHTML = '<p style="color:#666;margin-bottom:16px;font-size:14px;">选择分类标签，添加对应内容：</p>' +
    '<div style="display:flex;flex-direction:column;gap:8px;">' +
      types.map(function(t) {
        return '<button class="btn btn-default" style="justify-content:flex-start;padding:14px 18px;text-align:left;width:100%;" onclick="closeModal();_currentSection=\'' + t.id + '\';renderAll();addItem();">' +
          '<span style="display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;border-radius:8px;font-size:18px;margin-right:12px;' + 
            (t.id === 'recommend' ? 'background:linear-gradient(135deg,#ff6b35,#ff8f5e);' : 
             t.id === 'latestApps' ? 'background:linear-gradient(135deg,#1890ff,#40a9ff);' : 
             t.id === 'game' ? 'background:linear-gradient(135deg,#722ed1,#9254de);' : 
             t.id === 'task' ? 'background:linear-gradient(135deg,#13c2c2,#36cfc9);' : 
             'background:linear-gradient(135deg,#fa8c16,#ffc069);') + '">' + t.icon + '</span>' +
          '<div style="flex:1;">' +
            '<div style="font-weight:600;font-size:15px;">' + t.name + '</div>' +
            '<div style="font-size:12px;color:#999;">分类标签：' + t.tab + ' · ' + t.desc + '</div>' +
          '</div>' +
          '<span style="color:#ccc;font-size:18px;">\u2192</span>' +
        '</button>';
      }).join('') +
    '</div>';

  overlay.classList.add('active');
  lockBodyScroll();
  document.getElementById('modalSaveBtn').style.display = 'none';
}

function editItem(section, index) {
  _currentSection = section;
  openModal(section, index);
}
function deleteItem(section, index) {
  var sec = SECTIONS[section];
  if (!sec) return;
  var arr;
  try { arr = sec.array(); } catch(e) { return; }
  var item = arr[index];
  if (!item) return;
  var name = item.name || item.title || '此项';
  if (!confirm('确定要删除 "' + name + '" 吗？此操作不可恢复。')) return;
  arr.splice(index, 1);
  saveToStorage();
  renderAll();
}

// ===== 获取分类值 =====
var _PRESET_CATEGORIES = ['悬赏任务', '游戏试玩', '应用赚钱', '问卷调查', '阅读赚钱', '视频赚钱', '走路赚钱', '合成游戏', '其他'];

function getAllCategories() {
  var cats = {};
  _PRESET_CATEGORIES.forEach(function(c) { cats[c] = true; });
  try {
    var allPools = [].concat(siteData.home.recommend || []).concat(siteData.home.latestApps || []).concat(siteData.game.apps || []).concat(siteData.task.apps || []);
    allPools.forEach(function(app) {
      if (app.category && app.category.trim()) {
        app.category.split(/[,，、/]/).forEach(function(p) {
          var t = p.trim();
          if (t) cats[t] = true;
        });
      }
    });
  } catch(e) {}
  return Object.keys(cats).sort();
}
function getCategoryValue() {
  var customInput = document.getElementById('modal_category_custom');
  var selectEl = document.getElementById('modal_category');
  if (customInput && customInput.style.display !== 'none') return customInput.value.trim();
  if (selectEl) return selectEl.value;
  return '';
}

// ===== 弹窗系统 =====
function openModal(type, index) {
  currentModalType = type;
  currentEditIndex = index;
  var overlay = document.getElementById('modalOverlay');
  var title = document.getElementById('modalTitle');
  var body = document.getElementById('modalBody');
  if (!overlay || !title || !body) return;

  var sec = SECTIONS[type];
  if (!sec) return;

  var arr;
  try { arr = sec.array(); } catch(e) { arr = []; }
  var item = index >= 0 ? arr[index] : null;
  title.textContent = index >= 0 ? '编辑' + sec.name : '添加' + sec.name;
  var fields = sec.fields(item);

  body.innerHTML = fields.map(function(f) {
    if (f.type === 'icon') {
      var iconVal = f.value || '';
      return buildImageField(f.key, f.label, iconVal, f.hint, iconVal.startsWith('uploads/') ? 'upload' : 'url');
    }
    if (f.type === 'screenshots') {
      var ss = f.value || [];
      return '<div class="form-group"><label class="form-label">' + f.label + '</label>' +
        '<div class="form-hint" style="margin-bottom:8px">支持URL或本地上传，可添加多张（触屏可长按拖拽排序）</div>' +
        '<div id="modal_screenshots_list">' + ss.map(function(url, i) { return buildScreenshotItem(i, url); }).join('') + '</div>' +
        '<button class="btn btn-default btn-sm" onclick="addScreenshot()" style="margin-top:8px;">+ 添加截图</button></div>';
    }
    if (f.key === 'category') {
      var cats = getAllCategories();
      var currentCat = f.value || '';
      var options = cats.map(function(c) {
        return '<option value="' + c + '"' + (c === currentCat ? ' selected' : '') + '>' + c + '</option>';
      }).join('');
      if (currentCat && cats.indexOf(currentCat) < 0) {
        options = '<option value="' + currentCat + '" selected>' + currentCat + '</option>' + options;
      }
      return '<div class="form-group"><label class="form-label">' + f.label + '</label>' +
        '<div style="display:flex;gap:8px;">' +
          '<select class="form-select" id="modal_category" style="flex:1;" onchange="onCategorySelect(this)">' +
            '<option value="">-- 请选择分类 --</option>' + options + '</select>' +
          '<input class="form-input" id="modal_category_custom" type="text" value="' + currentCat + '" placeholder="或输入新分类" style="flex:1;display:none;" onchange="onCategoryCustomChange(this.value)">' +
        '</div>' +
        '<div class="form-hint" style="margin-top:6px;display:flex;align-items:center;gap:6px;">' +
          '<label style="display:flex;align-items:center;gap:4px;cursor:pointer;font-size:12px;color:#666;">' +
            '<input type="checkbox" id="modal_category_custom_cb" onchange="toggleCategoryCustom(this.checked)" style="accent-color:#ff6b35;">输入新分类</label>' +
          '<span>' + (f.hint || '') + '</span></div></div>';
    }
    if (f.key === 'publishTime') {
      var now = new Date();
      var nowStr = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0') + '-' + String(now.getDate()).padStart(2,'0') + ' ' +
        String(now.getHours()).padStart(2,'0') + ':' + String(now.getMinutes()).padStart(2,'0') + ':' + String(now.getSeconds()).padStart(2,'0');
      var displayTime = f.value || nowStr;
      return '<div class="form-group"><label class="form-label">' + f.label + '</label>' +
        '<div style="display:flex;align-items:center;gap:8px;">' +
          '<input class="form-input" type="text" id="modal_publishTime" value="' + displayTime + '" readonly style="background:#f8f9fa;flex:1;font-family:monospace;">' +
          '<button class="btn btn-default btn-sm" onclick="refreshPublishTime()" style="flex-shrink:0;">' +
            '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg> 刷新</button></div>' +
        '<div class="form-hint">自动读取系统时间。<span id="modal_publishTime_live" style="color:#ff6b35;">当前时间：' + nowStr + '</span></div></div>';
    }
    return '<div class="form-group"><label class="form-label">' + f.label + '</label>' +
      (f.type === 'textarea' || f.type === 'textarea-lg'
        ? '<textarea class="form-textarea ' + (f.type === 'textarea-lg' ? 'form-textarea-lg' : '') + '" id="modal_' + f.key + '">' + f.value + '</textarea>'
        : '<input class="form-input" type="' + (f.type === 'number' ? 'number' : 'text') + '" id="modal_' + f.key + '" value="' + f.value + '">') +
      (f.hint ? '<div class="form-hint">' + f.hint + '</div>' : '') + '</div>';
  }).join('');

  overlay.classList.add('active');
  lockBodyScroll();
  document.getElementById('modalSaveBtn').style.display = '';
  document.getElementById('modalSaveBtn').onclick = function() { saveModal(); };

  setTimeout(function() {
    initDragDropUpload();
    initSsDragSort();
    startPublishTimeTimer();
  }, 100);
}

function lockBodyScroll() {
  var scrollY = window.scrollY || window.pageYOffset;
  document.body.style.position = 'fixed';
  document.body.style.top = '-' + scrollY + 'px';
  document.body.style.width = '100%';
  document.body.style.overflowY = 'scroll';
}
function unlockBodyScroll() {
  var scrollY = parseInt(document.body.style.top || '0', 10) * -1;
  document.body.style.position = '';
  document.body.style.top = '';
  document.body.style.width = '';
  document.body.style.overflow = '';
  document.body.style.overflowY = '';
  if (scrollY > 0) window.scrollTo(0, scrollY);
}

function closeModal() {
  document.getElementById('modalOverlay').classList.remove('active');
  unlockBodyScroll();
  stopPublishTimeTimer();
  document.getElementById('modalSaveBtn').style.display = '';
}

// 分类交互
function toggleCategoryCustom(checked) {
  var sel = document.getElementById('modal_category');
  var inp = document.getElementById('modal_category_custom');
  if (checked) {
    if (sel) sel.style.display = 'none';
    if (inp) { inp.style.display = 'block'; if (sel && sel.value) inp.value = sel.value; inp.focus(); }
  } else {
    if (sel) sel.style.display = 'block';
    if (inp) inp.style.display = 'none';
  }
}
function onCategorySelect(sel) {
  var inp = document.getElementById('modal_category_custom');
  if (inp) inp.value = sel.value;
}
function onCategoryCustomChange(val) {
  var sel = document.getElementById('modal_category');
  if (sel) {
    for (var i = 0; i < sel.options.length; i++) {
      if (sel.options[i].value === val) { sel.selectedIndex = i; return; }
    }
    sel.selectedIndex = 0;
  }
}

// 发布时间时钟
function startPublishTimeTimer() {
  stopPublishTimeTimer();
  _publishTimeTimer = setInterval(function() {
    var now = new Date();
    var nowStr = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0') + '-' + String(now.getDate()).padStart(2,'0') + ' ' +
      String(now.getHours()).padStart(2,'0') + ':' + String(now.getMinutes()).padStart(2,'0') + ':' + String(now.getSeconds()).padStart(2,'0');
    var liveEl = document.getElementById('modal_publishTime_live');
    if (liveEl) liveEl.textContent = '当前时间：' + nowStr;
  }, 1000);
}
function stopPublishTimeTimer() {
  if (_publishTimeTimer) { clearInterval(_publishTimeTimer); _publishTimeTimer = null; }
}
function refreshPublishTime() {
  var now = new Date();
  var nowStr = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0') + '-' + String(now.getDate()).padStart(2,'0') + ' ' +
    String(now.getHours()).padStart(2,'0') + ':' + String(now.getMinutes()).padStart(2,'0') + ':' + String(now.getSeconds()).padStart(2,'0');
  var inp = document.getElementById('modal_publishTime');
  if (inp) inp.value = nowStr;
  var liveEl = document.getElementById('modal_publishTime_live');
  if (liveEl) liveEl.textContent = '当前时间：' + nowStr;
}

// ===== URL 校验 =====
function isValidUrl(str) {
  if (!str || !str.trim()) return true;
  var s = str.trim();
  if (s.startsWith('uploads/') || s.startsWith('/uploads/')) return true;
  if (s.startsWith('/') || s.startsWith('./') || s.startsWith('../')) return true;
  if (/^https?:\/\/.+/.test(s)) return true;
  if (s === '#') return true;
  return false;
}

function getIconValue() {
  // 检查当前处于哪种模式
  var uploadArea = document.getElementById('img_upload_area_icon');
  var urlRow = document.getElementById('img_url_row_icon');
  var isUploadMode = uploadArea && uploadArea.style.display !== 'none';

  if (isUploadMode) {
    // 上传模式：优先从预览图获取路径
    var previewImg = document.getElementById('img_preview_icon');
    if (previewImg && previewImg.classList.contains('visible') && previewImg.src) {
      var src = previewImg.src;
      // 从完整URL中提取相对路径
      var idx = src.indexOf('/uploads/');
      if (idx >= 0) return src.substring(idx + 1);
      // 如果预览图src不包含/uploads/，检查是否是blob URL（未真正上传）
      if (src.startsWith('blob:')) {
        // blob URL表示用户选了文件但还没上传成功，检查URL输入框备用
        var urlInput = document.getElementById('modal_icon');
        if (urlInput && urlInput.value && urlInput.value.trim()) {
          return urlInput.value.trim();
        }
      }
    }
    // 上传模式下也检查URL输入框（可能通过URL模式切换过来有值）
    var urlInput2 = document.getElementById('modal_icon');
    if (urlInput2 && urlInput2.value && urlInput2.value.trim()) {
      var val = urlInput2.value.trim();
      if (val.startsWith('uploads/') || val.startsWith('/uploads/')) {
        return val.replace(/^\/+/, '');
      }
    }
  } else {
    // URL模式：直接从输入框获取
    var urlInput3 = document.getElementById('modal_icon');
    if (urlInput3 && urlInput3.value && urlInput3.value.trim()) {
      var val2 = urlInput3.value.trim();
      // 如果URL模式下填的是本地路径，去掉开头的/
      if (val2.startsWith('/uploads/')) return val2.substring(1);
      return val2;
    }
  }
  return '';
}

// ===== 保存弹窗 =====
function saveModal() {
  var type = currentModalType;
  var index = currentEditIndex;
  var sec = SECTIONS[type];
  if (!sec) return;
  var arr;
  try { arr = sec.array(); } catch(e) { return; }
  var newItem = {};

  if (type === 'special') {
    newItem = {
      id: index >= 0 ? arr[index].id : getNextId(arr),
      title: getFieldValue('modal_title'),
      desc: getFieldValue('modal_desc'),
      content: getFieldValue('modal_content'),
      url: getFieldValue('modal_url') || ('article.html?id=' + getNextId(arr))
    };
  } else {
    var iconVal = getIconValue();
    // 规范化图标路径：去掉开头的/
    if (iconVal && iconVal.startsWith('/')) iconVal = iconVal.substring(1);
    var urlVal = getFieldValue('modal_url');
    if (iconVal && !isValidUrl(iconVal)) {
      showToast('APP图标链接格式不正确，请输入有效的URL（如 https://...）', 'error');
      return;
    }
    if (urlVal && urlVal !== '#' && !isValidUrl(urlVal)) {
      showToast('下载链接格式不正确，请输入有效的URL或填#', 'error');
      return;
    }
    var ssUrls = collectScreenshots();
    for (var si = 0; si < ssUrls.length; si++) {
      if (!isValidUrl(ssUrls[si])) {
        showToast('第' + (si + 1) + '张截图链接格式不正确，请输入有效的URL或通过上传按钮上传', 'error');
        return;
      }
    }
    newItem = {
      id: index >= 0 ? arr[index].id : getNextId(arr),
      name: getFieldValue('modal_name'),
      downloads: parseInt(getFieldValue('modal_downloads')) || 0,
      url: urlVal || '#',
      icon: iconVal,
      platform: getFieldValue('modal_platform') || 'Android/iOS',
      appSize: getFieldValue('modal_appSize'),
      developer: getFieldValue('modal_developer'),
      withdrawMethod: getFieldValue('modal_withdrawMethod') || '微信/支付宝',
      category: getCategoryValue(),
      publishTime: getFieldValue('modal_publishTime'),
      content: getFieldValue('modal_content'),
      features: parseFeatures('modal_features'),
      screenshots: ssUrls
    };
    if (type === 'latestApps' || type === 'game' || type === 'task') {
      newItem.desc = getFieldValue('modal_desc');
    }
  }

  if (index >= 0) arr[index] = newItem;
  else arr.push(newItem);

  saveToStorage();
  closeModal();
  renderAll();
}

function getFieldValue(fieldId) {
  var el = document.getElementById(fieldId);
  return el ? el.value : '';
}

function getNextId(arr) {
  if (!arr.length) return 1;
  var allIds = [];
  try {
    [].concat(
      siteData.home.recommend || [],
      siteData.home.latestApps || [],
      siteData.game.apps || [],
      siteData.task.apps || [],
      siteData.special.articles || []
    ).forEach(function(item) {
      if (item.id) allIds.push(item.id);
    });
  } catch(e) {}
  if (allIds.length === 0) return 1;
  return Math.max.apply(null, allIds) + 1;
}
function parseFeatures(fieldId) {
  var el = document.getElementById(fieldId);
  if (!el || !el.value.trim()) return [];
  return el.value.split('\n').filter(function(line) { return line.trim(); });
}

// ===== 截图管理 =====
function buildScreenshotItem(index, url) {
  var isLocal = url && url.startsWith('uploads/');
  var hasVal = url && url.trim();
  var ssKey = 'ss_' + index;
  return '<div class="screenshot-item" data-ss-index="' + index + '" data-ss-key="' + ssKey + '" draggable="true">' +
    '<span class="ss-drag-handle" title="拖拽排序"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="16" y2="6"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="8" y1="18" x2="16" y2="18"/></svg></span>' +
    '<span class="ss-index-badge">' + (index + 1) + '</span>' +
    '<input class="form-input" value="' + (hasVal ? url : '') + '" placeholder="图片URL或上传" data-ss-index="' + index + '" style="flex:1;">' +
    '<input type="file" accept="image/*" style="display:none;" id="ss_file_' + ssKey + '" onchange="handleSsUpload(\'' + ssKey + '\',' + index + ',this)">' +
    '<button class="btn btn-default btn-sm" onclick="triggerSsFileInput(\'' + ssKey + '\')" title="上传">\u2191</button>' +
    '<button class="btn btn-danger btn-sm" onclick="removeScreenshot(' + index + ')">\u00d7</button>' +
    '</div>';
}
function addScreenshot() {
  var list = document.getElementById('modal_screenshots_list');
  if (!list) return;
  var div = document.createElement('div');
  div.innerHTML = buildScreenshotItem(list.children.length, '');
  list.appendChild(div.firstElementChild);
  setTimeout(function() { initSsDragSort(); }, 50);
}
function removeScreenshot(index) {
  var list = document.getElementById('modal_screenshots_list');
  if (!list) return;
  var item = list.querySelector('[data-ss-index="' + index + '"]');
  if (item) item.remove();
  reindexScreenshots();
}
function reindexScreenshots() {
  var list = document.getElementById('modal_screenshots_list');
  if (!list) return;
  Array.from(list.children).forEach(function(div, i) {
    var ssKey = 'ss_' + i;
    div.setAttribute('data-ss-index', i);
    div.setAttribute('data-ss-key', ssKey);

    var badge = div.querySelector('.ss-index-badge');
    if (badge) badge.textContent = i + 1;

    var delBtn = div.querySelector('.btn-danger');
    if (delBtn) delBtn.setAttribute('onclick', 'removeScreenshot(' + i + ')');

    var fileInput = div.querySelector('input[type="file"]');
    if (fileInput) {
      fileInput.id = 'ss_file_' + ssKey;
      fileInput.setAttribute('onchange', "handleSsUpload('" + ssKey + "'," + i + ",this)");
    }

    var uploadBtn = div.querySelector('.btn-default');
    if (uploadBtn) {
      uploadBtn.setAttribute('onclick', "triggerSsFileInput('" + ssKey + "')");
    }

    var textInput = div.querySelector('input[data-ss-index]');
    if (textInput) textInput.setAttribute('data-ss-index', i);
  });
}
function collectScreenshots() {
  var list = document.getElementById('modal_screenshots_list');
  if (!list) return [];
  var urls = [];
  Array.from(list.children).forEach(function(div) {
    var inp = div.querySelector('input[data-ss-index]');
    if (inp && inp.value.trim()) urls.push(inp.value.trim());
  });
  return urls;
}
function triggerSsFileInput(ssKey) {
  var fileInput = document.getElementById('ss_file_' + ssKey);
  if (fileInput) {
    fileInput.style.display = 'block';
    fileInput.click();
    fileInput.style.display = 'none';
  }
}
async function handleSsUpload(ssKey, index, fileInput) {
  var file = fileInput.files[0];
  if (!file) return;

  var validExts = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.bmp'];
  var ext = '.' + (file.name.split('.').pop() || '').toLowerCase();
  if (validExts.indexOf(ext) === -1) {
    showToast('不支持的文件格式，请选择 JPG/PNG/GIF/WebP/SVG', 'error');
    fileInput.value = '';
    return;
  }

  if (file.size > 20 * 1024 * 1024) {
    showToast('文件过大，最大支持20MB', 'error');
    fileInput.value = '';
    return;
  }

  showToast('正在上传截图...', 'info');
  var uploadBtn = fileInput.parentElement.querySelector('.btn-default');
  if (uploadBtn) {
    uploadBtn.textContent = '\u23F3';
    uploadBtn.disabled = true;
  }

  try {
    var formData = new FormData();
    formData.append('image', file, file.name);
    var res = await authFetch('/api/upload/image', { method: 'POST', body: formData });
    if (!res.ok) {
      var errText = await res.text();
      throw new Error('服务器错误 (HTTP ' + res.status + '): ' + errText);
    }
    var result = await res.json();
    if (!result.success) throw new Error(result.error || '上传失败');

    var inp = fileInput.parentElement.querySelector('input[data-ss-index]');
    if (inp) inp.value = result.data.path;
    showToast('截图上传成功');
  } catch(e) {
    showToast('上传失败: ' + e.message, 'error');
    console.error('[截图上传错误]', e);
  }
  if (uploadBtn) {
    uploadBtn.textContent = '\u2191';
    uploadBtn.disabled = false;
  }
  fileInput.value = '';
}

// ===== 截图触屏拖拽排序 =====
var _touchDragState = null;

function initSsDragSort() {
  var list = document.getElementById('modal_screenshots_list');
  if (!list) return;
  var items = list.querySelectorAll('.screenshot-item');

  var dragSrc = -1;
  items.forEach(function(item) {
    item.addEventListener('dragstart', function(e) {
      dragSrc = parseInt(this.getAttribute('data-ss-index'));
      this.style.opacity = '0.4';
      e.dataTransfer.effectAllowed = 'move';
    });
    item.addEventListener('dragend', function() {
      this.style.opacity = '1';
      dragSrc = -1;
    });
    item.addEventListener('dragover', function(e) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    });
    item.addEventListener('drop', function(e) {
      e.preventDefault();
      var dst = parseInt(this.getAttribute('data-ss-index'));
      if (dragSrc >= 0 && dragSrc !== dst) {
        var children = Array.from(list.children);
        var srcItem = children.find(function(el) { return parseInt(el.getAttribute('data-ss-index')) === dragSrc; });
        if (srcItem) {
          if (dragSrc < dst) list.insertBefore(srcItem, children[dst].nextElementSibling);
          else list.insertBefore(srcItem, children[dst]);
          reindexScreenshots();
          initSsDragSort();
        }
      }
    });

    item.addEventListener('touchstart', function(e) {
      var touch = e.touches[0];
      _touchDragState = {
        srcIndex: parseInt(this.getAttribute('data-ss-index')),
        startY: touch.clientY,
        startX: touch.clientX,
        element: this,
        clone: null,
        moved: false
      };
      this.style.transition = 'none';
    }, { passive: false });

    item.addEventListener('touchmove', function(e) {
      if (!_touchDragState || _touchDragState.srcIndex !== parseInt(this.getAttribute('data-ss-index'))) return;
      var touch = e.touches[0];
      var dy = touch.clientY - _touchDragState.startY;
      var dx = touch.clientX - _touchDragState.startX;
      if (Math.abs(dy) > 10 || Math.abs(dx) > 10) {
        _touchDragState.moved = true;
        e.preventDefault();
        this.style.opacity = '0.5';
        this.style.transform = 'translateY(' + dy + 'px)';
        this.style.zIndex = '10';
        this.style.position = 'relative';
      }
    }, { passive: false });

    item.addEventListener('touchend', function(e) {
      if (!_touchDragState) return;
      var state = _touchDragState;
      this.style.transition = 'all 0.2s';
      this.style.opacity = '1';
      this.style.transform = '';
      this.style.zIndex = '';
      this.style.position = '';

      if (state.moved) {
        var touch = e.changedTouches[0];
        var endY = touch.clientY;
        var allItems = Array.from(list.querySelectorAll('.screenshot-item'));
        var dstIndex = state.srcIndex;
        for (var i = 0; i < allItems.length; i++) {
          var rect = allItems[i].getBoundingClientRect();
          if (endY > rect.top && endY < rect.bottom) {
            dstIndex = parseInt(allItems[i].getAttribute('data-ss-index'));
            break;
          }
        }
        if (dstIndex >= 0 && dstIndex !== state.srcIndex) {
          var children = Array.from(list.children);
          var srcItem = children.find(function(el) { return parseInt(el.getAttribute('data-ss-index')) === state.srcIndex; });
          if (srcItem) {
            if (state.srcIndex < dstIndex) list.insertBefore(srcItem, children[dstIndex].nextElementSibling);
            else list.insertBefore(srcItem, children[dstIndex]);
            reindexScreenshots();
            initSsDragSort();
          }
        }
      }
      _touchDragState = null;
    });
  });
}

// ===== 图片上传组件 =====
function buildImageField(key, label, value, hint, defaultMode) {
  var isLocal = value && (value.startsWith('uploads/') || value.startsWith('/uploads/'));
  var hasValue = value && value.trim();
  // 规范化路径：去掉开头的/
  var cleanValue = value ? value.replace(/^\/+/, '') : '';
  var displayMode = isLocal ? 'upload' : (defaultMode || 'url');
  var fileInputId = 'img_file_' + key;
  return '<div class="form-group img-upload-group" data-img-key="' + key + '">' +
    '<label class="form-label">' + label + '</label>' +
    '<div class="img-mode-switch">' +
      '<button class="img-mode-btn ' + (displayMode === 'url' ? 'active' : '') + '" onclick="switchImgMode(\'' + key + '\',\'url\')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/></svg> 链接</button>' +
      '<button class="img-mode-btn ' + (displayMode === 'upload' ? 'active' : '') + '" onclick="switchImgMode(\'' + key + '\',\'upload\')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 16V4m0 0L8 8m4-4l4 4"/><path d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2"/></svg> 上传</button>' +
    '</div>' +
    '<div id="img_url_row_' + key + '" style="display:' + (displayMode === 'url' ? 'flex' : 'none') + '">' +
      '<div class="img-url-input-wrap"><svg class="img-url-input-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#999" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg>' +
      '<input class="form-input img-url-input" type="text" id="modal_' + key + '" value="' + (hasValue ? value : '') + '" placeholder="https://example.com/image.png"></div></div>' +
    '<label id="img_upload_area_' + key + '" class="img-upload-area ' + (isLocal ? 'has-image' : '') + '" style="display:' + (displayMode === 'upload' ? 'block' : 'none') + '" for="' + fileInputId + '">' +
      '<div class="img-upload-inner">' +
        (isLocal
          ? '<img src="/' + cleanValue + '" class="img-preview visible" id="img_preview_' + key + '" onerror="this.style.display=\'none\'" style="max-width:120px;display:block;">' +
            '<span style="font-size:12px;color:#666;">' + cleanValue + '</span><span style="font-size:11px;color:#ff6b35;">点击更换</span>'
          : '<div class="img-upload-placeholder"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#ccc" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg><span>点击上传图片</span></div>' +
          '<img src="" class="img-preview" id="img_preview_' + key + '" onerror="this.style.display=\'none\'">') +
      '</div>' +
    '</label>' +
    '<input type="file" id="' + fileInputId + '" accept="image/*" style="display:none;" onchange="handleImgUpload(\'' + key + '\', this)">' +
    '<div class="img-upload-progress" id="img_progress_' + key + '"><div class="img-progress-track"><div class="img-progress-bar" id="img_progress_bar_' + key + '"></div></div></div>' +
    (hint ? '<div class="form-hint">' + hint + '</div>' : '') +
  '</div>';
}
function triggerImgFileInput(key, evt) {
  if (evt) { evt.stopPropagation(); evt.preventDefault(); }
  var fileInput = document.getElementById('img_file_' + key);
  if (fileInput) {
    fileInput.style.display = 'block';
    fileInput.click();
    fileInput.style.display = 'none';
  }
}
function switchImgMode(key, mode) {
  var group = document.querySelector('.img-upload-group[data-img-key="' + key + '"]');
  if (group) {
    group.querySelectorAll('.img-mode-btn').forEach(function(b) { b.classList.remove('active'); });
    var target = group.querySelector('.img-mode-btn[onclick*="switchImgMode(\'' + key + '\',\'' + mode + '\')"]');
    if (target) target.classList.add('active');
  }
  var urlRow = document.getElementById('img_url_row_' + key);
  var uploadArea = document.getElementById('img_upload_area_' + key);
  var urlInput = document.getElementById('modal_' + key);
  var previewImg = document.getElementById('img_preview_' + key);

  if (mode === 'url') {
    // 切换到URL模式
    if (urlRow) urlRow.style.display = 'flex';
    if (uploadArea) uploadArea.style.display = 'none';
    // 如果URL输入框为空但预览图有内容，从预览图提取路径填入输入框
    if (urlInput && !urlInput.value.trim() && previewImg && previewImg.classList.contains('visible') && previewImg.src) {
      var src = previewImg.src;
      if (!src.startsWith('blob:')) {
        var idx = src.indexOf('/uploads/');
        if (idx >= 0) {
          urlInput.value = src.substring(idx + 1);
        } else {
          urlInput.value = src;
        }
      }
    }
  } else {
    // 切换到上传模式
    if (urlRow) urlRow.style.display = 'none';
    if (uploadArea) uploadArea.style.display = 'block';
    // 如果URL输入框中有本地路径，在上传区域显示预览
    if (urlInput && urlInput.value.trim()) {
      var val = urlInput.value.trim();
      var normalizedVal = val.replace(/^\/+/, '');
      if (normalizedVal.startsWith('uploads/')) {
        if (previewImg) {
          previewImg.src = '/' + normalizedVal;
          previewImg.classList.add('visible');
          previewImg.style.display = 'block';
        }
        if (uploadArea) {
          uploadArea.classList.add('has-image');
          var inner = uploadArea.querySelector('.img-upload-inner');
          if (inner) {
            inner.innerHTML = '<img src="/' + normalizedVal + '" class="img-preview visible" id="img_preview_' + key + '" style="max-width:120px;display:block;" onerror="this.style.display=\'none\'">' +
              '<span style="font-size:12px;color:#666;">' + normalizedVal + '</span><span style="font-size:11px;color:#ff6b35;">点击更换</span>';
          }
        }
      } else if (/^https?:\/\//.test(val)) {
        if (previewImg) {
          previewImg.src = val;
          previewImg.classList.add('visible');
          previewImg.style.display = 'block';
        }
        if (uploadArea) uploadArea.classList.add('has-image');
      }
    }
  }
}
async function handleImgUpload(key, fileInput) {
  var file = fileInput.files[0];
  if (!file) return;

  var validTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp', 'image/svg+xml', 'image/bmp', 'image/x-icon'];
  var ext = '.' + (file.name.split('.').pop() || '').toLowerCase();
  var validExts = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.bmp'];
  if (validTypes.indexOf(file.type) === -1 && validExts.indexOf(ext) === -1) {
    showToast('不支持的文件格式，请选择 JPG/PNG/GIF/WebP/SVG', 'error');
    fileInput.value = '';
    return;
  }

  if (file.size > 20 * 1024 * 1024) {
    showToast('文件过大，最大支持20MB', 'error');
    fileInput.value = '';
    return;
  }

  var progressEl = document.getElementById('img_progress_' + key);
  var progressBar = document.getElementById('img_progress_bar_' + key);
  var previewImg = document.getElementById('img_preview_' + key);
  var urlInput = document.getElementById('modal_' + key);
  var uploadArea = document.getElementById('img_upload_area_' + key);

  if (progressEl) progressEl.style.display = 'block';
  if (progressBar) progressBar.style.width = '30%';

  try {
    // 先显示本地预览
    var localUrl = URL.createObjectURL(file);
    if (previewImg) { previewImg.src = localUrl; previewImg.classList.add('visible'); previewImg.style.display = 'block'; }
    if (progressBar) progressBar.style.width = '60%';

    // 上传到服务器
    var formData = new FormData();
    formData.append('image', file, file.name);
    var res = await authFetch('/api/upload/image', { method: 'POST', body: formData });
    if (!res.ok) {
      var errText = await res.text();
      throw new Error('服务器错误 (HTTP ' + res.status + '): ' + errText);
    }
    var result = await res.json();
    if (!result.success) throw new Error(result.error || '上传失败');

    var imgPath = result.data.path; // 例如: "uploads/images/img_xxx.png"
    var imgUrl = '/' + imgPath;

    if (progressBar) progressBar.style.width = '100%';

    // 更新 URL 输入框（保存时优先读取此值）
    if (urlInput) urlInput.value = imgPath;

    // 更新预览图
    if (previewImg) {
      previewImg.src = imgUrl;
      previewImg.classList.add('visible');
      previewImg.style.display = 'block';
      previewImg.style.maxWidth = '120px';
    }

    // 更新上传区域的内部HTML，保留 img_preview 元素引用
    if (uploadArea) {
      uploadArea.classList.add('has-image');
      var inner = uploadArea.querySelector('.img-upload-inner');
      if (inner) {
        inner.innerHTML = '<img src="' + imgUrl + '" class="img-preview visible" id="img_preview_' + key + '" style="max-width:120px;display:block;" onerror="this.style.display=\'none\'">' +
          '<span style="font-size:12px;color:#666;">' + imgPath + '</span><span style="font-size:11px;color:#ff6b35;">点击更换</span>';
        // 刷新 previewImg 引用
        previewImg = document.getElementById('img_preview_' + key);
      }
    }

    showToast('图片上传成功');
  } catch(e) {
    showToast('上传失败: ' + e.message, 'error');
    console.error('[上传错误]', e);
  }
  setTimeout(function() { if (progressEl) progressEl.style.display = 'none'; if (progressBar) progressBar.style.width = '0%'; }, 1500);
  fileInput.value = '';
  // 释放本地预览 URL
  if (localUrl) URL.revokeObjectURL(localUrl);
}
function initDragDropUpload() {
  document.querySelectorAll('.img-upload-area').forEach(function(area) {
    if (area.dataset.dropInited) return;
    area.dataset.dropInited = '1';
    area.addEventListener('dragover', function(e) { e.preventDefault(); area.classList.add('drag-over'); });
    area.addEventListener('dragleave', function(e) { e.preventDefault(); area.classList.remove('drag-over'); });
    area.addEventListener('drop', function(e) {
      e.preventDefault();
      e.stopPropagation();
      area.classList.remove('drag-over');
      var files = e.dataTransfer.files;
      if (files.length > 0) {
        // 通过 label 的 for 属性找到关联的 file input
        var fileInput = document.getElementById(area.getAttribute('for'));
        if (!fileInput) fileInput = area.parentElement.querySelector('input[type="file"]');
        if (fileInput) {
          var file = files[0];
          var validTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp', 'image/svg+xml', 'image/bmp', 'image/x-icon'];
          var validExts = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.bmp'];
          var ext2 = '.' + (file.name.split('.').pop() || '').toLowerCase();
          if (validTypes.indexOf(file.type) === -1 && validExts.indexOf(ext2) === -1) {
            showToast('不支持的文件格式，请选择 JPG/PNG/GIF/WebP/SVG', 'error');
            return;
          }
          try {
            var dt = new DataTransfer();
            dt.items.add(file);
            fileInput.files = dt.files;
          } catch(ex) {
            fileInput.files = files;
          }
          fileInput.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
    });
  });
}

// ===== 备份功能 =====
async function backupExport() {
  var statusEl = document.getElementById('backupStatus');
  var textarea = document.getElementById('exportJson');
  if (!statusEl || !textarea) return;
  try {
    statusEl.innerHTML = '<span style="color:#ff6b35;">正在生成备份...</span>';
    var res = await authFetch('/api/backup/export');
    var result = await res.json();
    if (!result.success) throw new Error(result.error);
    textarea.value = JSON.stringify(result.data, null, 2);
    var m = result.data.manifest;
    statusEl.innerHTML = '<span style="color:#52c41a;">\u2705 备份成功！</span> 共 ' + m.fileCount + ' 个文件，总大小 ' + formatFileSize(m.totalSize);
    showToast('完整备份已生成');
  } catch(e) { statusEl.innerHTML = '<span style="color:#ff4d4f;">\u274c ' + e.message + '</span>'; }
}
async function backupDownload() {
  try {
    var res = await authFetch('/api/backup/download');
    var blob = await res.blob();
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'wazhuan-backup.json';
    a.click();
    URL.revokeObjectURL(url);
    showToast('备份文件已下载');
  } catch(e) { showToast('下载失败', 'error'); }
}
async function backupVerify() {
  var json = document.getElementById('importJson');
  var restoreEl = document.getElementById('restoreStatus');
  if (!json || !restoreEl) return;
  var jsonVal = json.value.trim();
  if (!jsonVal) { showToast('请先粘贴备份数据', 'error'); return; }
  try {
    var backup = JSON.parse(jsonVal);
    var res = await authFetch('/api/backup/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(backup) });
    var result = await res.json();
    if (result.success && result.data && result.data.valid) {
      restoreEl.innerHTML = '<span style="color:#52c41a;">\u2705 ' + result.data.summary + '</span>';
      showToast('备份数据校验通过');
    } else {
      restoreEl.innerHTML = '<span style="color:#ff4d4f;">\u274c ' + (result.data ? result.data.summary : '校验失败') + '</span>';
      showToast('备份数据存在问题', 'error');
    }
  } catch(e) { restoreEl.innerHTML = '<span style="color:#ff4d4f;">\u274c ' + e.message + '</span>'; }
}
async function backupRestore() {
  var json = document.getElementById('importJson');
  var restoreEl = document.getElementById('restoreStatus');
  if (!json || !restoreEl) return;
  var jsonVal = json.value.trim();
  if (!jsonVal) { showToast('请先粘贴备份数据', 'error'); return; }
  if (!confirm('还原备份将覆盖当前所有文件。确定要继续吗？')) return;
  try {
    restoreEl.innerHTML = '<span style="color:#ff6b35;">正在还原...</span>';
    var backup = JSON.parse(jsonVal);
    var res = await authFetch('/api/backup/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(backup) });
    var result = await res.json();
    if (result.success && result.data) {
      restoreEl.innerHTML = '<span style="color:#52c41a;">\u2705 ' + result.data.message + '</span>';
      showToast('数据已还原');
      setTimeout(function() { init(); }, 1000);
    } else throw new Error(result.error);
  } catch(e) { restoreEl.innerHTML = '<span style="color:#ff4d4f;">\u274c ' + e.message + '</span>'; }
}
function handleBackupFileSelect(event) {
  var file = event.target.files[0];
  if (file) readBackupFile(file);
}
function readBackupFile(file) {
  var reader = new FileReader();
  reader.onload = function(e) {
    try {
      var parsed = JSON.parse(e.target.result);
      var importEl = document.getElementById('importJson');
      var restoreEl = document.getElementById('restoreStatus');
      if (importEl) importEl.value = e.target.result;
      if (restoreEl) restoreEl.innerHTML = '<span style="color:#52c41a;">\u2705 文件加载成功</span> 项目: ' + (parsed.project || '未知');
      showToast('备份文件已加载');
    } catch(ex) { showToast('文件格式无效', 'error'); }
  };
  reader.readAsText(file);
}
function resetData() {
  if (!confirm('确定要重置为默认数据吗？所有修改将丢失！')) return;
  localStorage.removeItem('wazhuan_data');
  _isInitialized = false;
  init();
  showToast('已重置');
}
function formatFileSize(bytes) {
  if (!bytes) return '0 B';
  var units = ['B', 'KB', 'MB', 'GB'];
  var i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(1) + ' ' + units[i];
}

// ===== 移动端UI组件 =====
var _mobileSectionKeys = ['recommend', 'latestApps', 'game', 'task', 'special'];

function initMobileUI() {
  renderSidebarMenu();
  updateMobileActiveState();

  window.addEventListener('resize', debounce(function() {
    updateMobileActiveState();
  }, 200));

  if ('ontouchstart' in window) {
    document.addEventListener('touchstart', function(){}, { passive: true });
  }
}

function renderSidebarMenu() {
  var menuEl = document.getElementById('sidebarMenu');
  if (!menuEl) return;
  var html = '';
  _mobileSectionKeys.forEach(function(k) {
    var s = SECTIONS[k];
    if (!s) return;
    var icon = s.icon || '';
    html += '<button class="sidebar-menu-item" onclick="switchSection(\'' + k + '\');closeSidebar();" data-section="' + k + '">' +
      '<span>' + icon + '</span><span>' + s.name + '</span></button>';
  });
  html += '<div class="sidebar-divider"></div>';
  html += '<button class="sidebar-menu-item" onclick="showSettings();closeSidebar();" data-section="settings">' +
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>' +
    '<span>网站设置</span></button>';
  html += '<button class="sidebar-menu-item" onclick="showSettings();closeSidebar();" data-section="backup">' +
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>' +
    '<span>备份与迁移</span></button>';
  html += '<button class="sidebar-menu-item" onclick="window.open(\'index.html\',\'_blank\');closeSidebar();" data-section="preview">' +
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>' +
    '<span>预览网站</span></button>';
  menuEl.innerHTML = html;
}

function updateMobileActiveState() {
  var sidebarItems = document.querySelectorAll('.sidebar-menu-item[data-section]');
  sidebarItems.forEach(function(item) {
    item.classList.remove('active');
    if (item.getAttribute('data-section') === _currentSection) {
      item.classList.add('active');
    }
  });
  if (_currentSection === 'settings' || _currentSection === 'globalconfig' || _currentSection === 'backup') {
    var settingsItem = document.querySelector('.sidebar-menu-item[data-section="settings"]');
    if (settingsItem) settingsItem.classList.add('active');
  }
}

function toggleSidebar() {
  var sidebar = document.getElementById('sidebar');
  var overlay = document.getElementById('sidebarOverlay');
  if (!sidebar || !overlay) return;
  var isOpen = sidebar.classList.contains('open');
  if (isOpen) {
    closeSidebar();
  } else {
    sidebar.classList.add('open');
    overlay.classList.add('open');
    overlay.style.display = 'block';
    document.body.style.overflow = 'hidden';
  }
}

function closeSidebar() {
  var sidebar = document.getElementById('sidebar');
  var overlay = document.getElementById('sidebarOverlay');
  if (sidebar) sidebar.classList.remove('open');
  if (overlay) {
    overlay.classList.remove('open');
    overlay.style.display = 'none';
  }
  document.body.style.overflow = '';
}

function debounce(fn, delay) {
  var timer = null;
  return function() {
    var ctx = this, args = arguments;
    clearTimeout(timer);
    timer = setTimeout(function() { fn.apply(ctx, args); }, delay);
  };
}

// ===== 性能优化：图片懒加载 =====
function initLazyImages() {
  if ('IntersectionObserver' in window) {
    var observer = new IntersectionObserver(function(entries) {
      entries.forEach(function(entry) {
        if (entry.isIntersecting) {
          var img = entry.target;
          if (img.dataset.src) {
            img.src = img.dataset.src;
            img.onload = function() { img.classList.add('loaded'); };
            img.removeAttribute('data-src');
          }
          observer.unobserve(img);
        }
      });
    }, { rootMargin: '100px' });
    document.querySelectorAll('img[data-src]').forEach(function(img) {
      observer.observe(img);
    });
  } else {
    document.querySelectorAll('img[data-src]').forEach(function(img) {
      img.src = img.dataset.src;
      img.removeAttribute('data-src');
    });
  }
}

// ===== 移动端双击缩放防护 =====
document.addEventListener('dblclick', function(e) {
  if (window.innerWidth <= 768) {
    e.preventDefault();
  }
}, { passive: false });

// ===== 启动 =====
document.addEventListener('DOMContentLoaded', function() {
  try {
    init();
  } catch(e) {
    console.error('[admin] 初始化失败:', e);
    siteData = getDefaultData();
    initMobileUI();
    renderAll();
  }
});

if (document.readyState === 'interactive' || document.readyState === 'complete') {
  try {
    init();
  } catch(e) {
    console.error('[admin] 延迟初始化失败:', e);
    siteData = getDefaultData();
    initMobileUI();
    renderAll();
  }
}
