// ===== 挖赚网 - 统一数据同步引擎 =====
// 机制：BroadcastChannel 跨标签页实时推送 + 手动刷新 + 内部事件总线
// 性能：requestAnimationFrame 批量渲染防卡顿 + 去抖合并并发更新

const SyncEngine = (function () {
  // ===== 内部状态 =====
  let _data = null;           // 当前数据
  let _dataHash = '';         // 数据摘要（用于判断是否真的变了）
  let _listeners = {};        // 事件监听器 { eventName: [callbacks] }
  let _channel = null;        // BroadcastChannel 实例
  let _pendingUpdate = null;  // 待处理的更新（去抖）
  let _rafId = null;          // requestAnimationFrame ID
  let _started = false;       // 是否已启动

  // ===== 配置 =====
  const CONFIG = {
    DEBOUNCE_DELAY: 300,        // 去抖延迟 300ms
    DATA_URL: 'data.json',
    CHANNEL_NAME: 'wazhuan_sync'
  };

  // ===== 数据加载（统一入口） =====
  async function loadData() {
    if (window.location.protocol === 'file:') {
      return null; // file 协议无法 fetch，由各页面自行处理
    }
    try {
      const response = await fetch(CONFIG.DATA_URL);
      if (!response.ok) throw new Error('HTTP ' + response.status);
      return await response.json();
    } catch (e) {
      console.error('[SyncEngine] data.json 加载失败:', e);
      return null;
    }
  }

  // ===== 快速数据摘要（不碰撞时才更新，避免深比较大对象） =====
  function computeHash(obj) {
    const str = JSON.stringify(obj);
    const len = str.length;
    return len + ':' + str.slice(0, 200) + str.slice(-200);
  }

  // ===== 事件总线 =====
  function on(eventName, callback) {
    if (!_listeners[eventName]) _listeners[eventName] = [];
    _listeners[eventName].push(callback);
  }

  function off(eventName, callback) {
    if (!_listeners[eventName]) return;
    _listeners[eventName] = _listeners[eventName].filter(cb => cb !== callback);
  }

  function emit(eventName, payload) {
    if (!_listeners[eventName]) return;
    _listeners[eventName].forEach(cb => {
      try { cb(payload); } catch (e) { console.error('[SyncEngine] 事件回调异常:', e); }
    });
  }

  // ===== BroadcastChannel 跨标签页通信 =====
  function initChannel() {
    try {
      _channel = new BroadcastChannel(CONFIG.CHANNEL_NAME);
      _channel.onmessage = function (event) {
        const msg = event.data;
        if (msg.type === 'DATA_UPDATE') {
          console.log('[SyncEngine] 收到跨标签页更新通知');
          scheduleRefresh('broadcast');
        }
      };
    } catch (e) {
      console.warn('[SyncEngine] BroadcastChannel 不可用，请使用手动刷新');
    }
  }

  function broadcastUpdate() {
    if (_channel) {
      try {
        _channel.postMessage({ type: 'DATA_UPDATE', timestamp: Date.now() });
      } catch (e) {
        console.warn('[SyncEngine] BroadcastChannel 发送失败:', e);
      }
    }
  }

  // ===== SSE 服务器推送事件监听（文件变更实时通知） =====
  function initSSE() {
    // 只在 HTTP/HTTPS 协议下使用 SSE
    if (window.location.protocol === 'file:') return;
    try {
      var es = new EventSource('/api/events');
      es.addEventListener('file-changed', function(e) {
        try {
          var data = JSON.parse(e.data);
          // 检查是否有 data.json 变更
          var files = data.files || [];
          var dataChanged = files.some(function(f) { return f === 'data.json' || f.indexOf('data.json') >= 0; });
          if (dataChanged) {
            console.log('[SyncEngine] 检测到 data.json 文件变更（SSE），自动刷新');
            scheduleRefresh('sse');
          }
        } catch(ex) {}
      });
      // 也监听 config-changed 事件（批量配置更新后触发）
      es.addEventListener('config-changed', function(e) {
        try {
          var data = JSON.parse(e.data);
          if (data.updatedCount > 0) {
            console.log('[SyncEngine] 检测到配置变更（SSE），自动刷新');
            scheduleRefresh('sse-config');
          }
        } catch(ex) {}
      });
      es.addEventListener('connected', function() {
        console.log('[SyncEngine] SSE 已连接');
      });
      es.onerror = function() {
        // SSE 断线后静默重连（浏览器自动处理）
        console.log('[SyncEngine] SSE 连接断开');
      };
    } catch(e) {
      // SSE 不可用时静默忽略
    }
  }

// ===== 带去抖的刷新调度 =====
// 'manual'（用户点击刷新按钮）→ 自动应用更新
// 'broadcast'（跨标签页通知）→ 自动应用更新（后台更新后前端实时同步）
// 'storage'（localStorage变更）→ 自动应用更新
// 'sse'（服务器SSE推送）→ 自动应用更新
function scheduleRefresh(source) {
    if (_pendingUpdate) {
      _pendingUpdate.source = _pendingUpdate.source + '+' + source;
      return;
    }
    _pendingUpdate = { source: source };
    setTimeout(async function () {
      if (!_pendingUpdate) return;
      const currentSource = _pendingUpdate.source;
      _pendingUpdate = null;

      // 从 data.json 拉取最新数据，比对是否变化
      var newData = await loadData();
      if (!newData) return;

      var newHash = computeHash(newData);
      if (newHash === _dataHash) {
        console.log('[SyncEngine] 数据实际未变，跳过');
        return;
      }

      // 所有来源统一自动应用更新（后台更新后前端实时响应）
      console.log('[SyncEngine] 检测到新数据（来源：' + currentSource + '），自动应用更新');
      applyUpdate(newData, currentSource);
    }, CONFIG.DEBOUNCE_DELAY);
  }

  // ===== 用户缓存 key（独立于 admin 的 wazhuan_data） =====
  const CACHE_KEY = 'wazhuan_user_cache';

  // ===== 从 localStorage 读取用户手动刷新后的缓存 =====
  function readFromStorage() {
    try {
      var stored = localStorage.getItem(CACHE_KEY);
      if (stored) {
        var parsed = JSON.parse(stored);
        if (parsed._lastModified) {
          var cleanData = Object.assign({}, parsed);
          delete cleanData._lastModified;
          return cleanData;
        }
      }
    } catch(e) {
      console.warn('[SyncEngine] localStorage 读取失败:', e);
    }
    return null;
  }

  // ===== 将用户手动刷新的数据写入缓存（仅 refresh() 调用） =====
  function writeToStorage(data) {
    try {
      var toStore = Object.assign({}, data);
      toStore._lastModified = Date.now();
      localStorage.setItem(CACHE_KEY, JSON.stringify(toStore));
    } catch(e) {
      console.warn('[SyncEngine] localStorage 写入失败:', e);
    }
  }

  // ===== 应用数据更新（核心） =====
  function applyUpdate(newData, source) {
    _data = newData;
    _dataHash = computeHash(newData);
    // 更新后写入 localStorage，确保 F5 刷新后使用最新数据
    writeToStorage(newData);
    if (_rafId) cancelAnimationFrame(_rafId);
    _rafId = requestAnimationFrame(function () {
      emit('dataUpdated', { data: _data, source: source });
      _rafId = null;
    });
  }

  // ===== 页面可见性变化时主动拉取最新数据 =====
  var _visibilityTimer = null;
  function initVisibilityCheck() {
    document.addEventListener('visibilitychange', function() {
      if (!document.hidden) {
        // 页面从隐藏变为可见时，延迟检查数据更新
        clearTimeout(_visibilityTimer);
        _visibilityTimer = setTimeout(function() {
          console.log('[SyncEngine] 页面恢复可见，检查数据更新...');
          scheduleRefresh('visibility');
        }, 500);
      }
    });
  }

  // ===== 定时轮询兜底（低频率，作为SSE/BroadcastChannel的补充） =====
  var _pollTimer = null;
  var POLL_INTERVAL = 30000; // 30秒轮询一次作为兜底
  function initPollingFallback() {
    _pollTimer = setInterval(function() {
      if (document.hidden) return; // 页面隐藏时不轮询，节省资源
      // 静默检查更新，有变化则自动应用
      checkAndApply();
    }, POLL_INTERVAL);
  }

  async function checkAndApply() {
    var newData = await loadData();
    if (!newData) return;
    var newHash = computeHash(newData);
    if (newHash !== _dataHash) {
      console.log('[SyncEngine] 轮询检测到数据更新，自动应用');
      applyUpdate(newData, 'poll');
    }
  }

  // ===== 启动同步引擎 =====
  // 优先从 data.json 加载最新数据，确保后台编辑后前端实时同步
  // 网络不可用时回退到 localStorage 缓存
  async function start() {
    if (_started) return;
    _started = true;

    // 1. 尝试从 data.json 加载最新数据
    var freshData = await loadData();
    if (freshData) {
      _data = freshData;
      _dataHash = computeHash(_data);
      // 验证数据完整性：至少需要有基本的站点信息
      if (!_data.siteInfo || !_data.navTabs) {
        console.warn('[SyncEngine] data.json 数据不完整，尝试 localStorage 缓存');
        var storedData = readFromStorage();
        if (storedData && storedData.siteInfo && storedData.navTabs) {
          _data = storedData;
          _dataHash = computeHash(_data);
          console.log('[SyncEngine] 使用 localStorage 缓存（data.json 不完整）');
        } else {
          _data = freshData; // 即使不完整也使用，由 app.js 处理
          console.log('[SyncEngine] data.json 数据不完整，但无可用缓存');
        }
      } else {
        writeToStorage(freshData);
        console.log('[SyncEngine] 已从 data.json 加载最新数据, 数据摘要:', _dataHash.substring(0, 80));
      }
    } else {
      // 网络不可用 → 回退到 localStorage 缓存
      var storedData = readFromStorage();
      if (storedData) {
        _data = storedData;
        _dataHash = computeHash(_data);
        console.log('[SyncEngine] data.json 不可用，使用 localStorage 缓存');
      } else {
        _data = null;
        _dataHash = '';
        console.log('[SyncEngine] 无可用数据，页面将使用 fallback 数据');
      }
    }
    emit('dataLoaded', { data: _data });

    // 2. 初始化跨标签页通信
    initChannel();

    // 3. 监听 storage 事件（跨标签页用户缓存变化）
    window.addEventListener('storage', function (event) {
      if (event.key === CACHE_KEY) {
        console.log('[SyncEngine] 用户缓存跨标签页变化');
        scheduleRefresh('storage');
      }
    });

    // 4. 连接 SSE 事件流（服务器文件变更实时推送）
    initSSE();

    // 5. 页面可见性变化时主动同步
    initVisibilityCheck();

    // 6. 定时轮询兜底（30秒间隔，SSE/BroadcastChannel失效时的最后保障）
    initPollingFallback();

    console.log('[SyncEngine] 已启动 - 后台更新数据后前端自动刷新（SSE + BroadcastChannel + 轮询兜底）');
  }

  // ===== 手动刷新数据（用户主动触发） =====
  // 从 data.json 拉取最新数据并更新缓存
  async function refresh() {
    console.log('[SyncEngine] 手动刷新，从 data.json 拉取最新数据...');
    const newData = await loadData();
    if (newData) {
      const newHash = computeHash(newData);
      if (newHash !== _dataHash) {
        // 更新数据并写入 localStorage，确保 F5 后使用最新缓存
        writeToStorage(newData);
        applyUpdate(newData, 'manual');
        return true;
      } else {
        console.log('[SyncEngine] 数据未变化');
      }
    }
    return false;
  }

  // ===== 检查是否有数据更新 =====
  async function checkForUpdates() {
    const newData = await loadData();
    if (newData) {
      return computeHash(newData) !== _dataHash;
    }
    return false;
  }

  // ===== 手动触发更新通知（后台管理保存时调用） =====
  // 仅广播：只通知其他标签页，不自刷新（admin 已持有最新数据，无需重复读取）
  function broadcastOnly() {
    broadcastUpdate();
  }

  function notifyUpdate() {
    broadcastUpdate();
    scheduleRefresh('admin');
  }

  // ===== 获取当前数据 =====
  function getData() {
    return _data;
  }

  // ===== 销毁 =====
  function destroy() {
    if (_channel) _channel.close();
    if (_rafId) cancelAnimationFrame(_rafId);
    if (_pollTimer) clearInterval(_pollTimer);
    if (_visibilityTimer) clearTimeout(_visibilityTimer);
    _listeners = {};
    _started = false;
  }

  // ===== 公开接口 =====
  return {
    start,
    on,
    off,
    broadcastOnly,
    notifyUpdate,
    refresh,
    checkForUpdates,
    getData,
    loadData,
    destroy,
    CONFIG
  };
})();
