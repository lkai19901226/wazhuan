/**
 * 挖赚网 - 本地开发服务器
 * 功能：静态文件服务 + 实时预览 + 在线文件编辑 + 自动刷新
 * 特性：
 *   - 默认端口 8080，自动检测可用端口回退
 *   - 启动后自动在默认浏览器打开
 *   - 跨平台兼容（Windows/macOS/Linux）
 *   - 文件修改热重载（SSE + 轮询）
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const crypto = require('crypto');
const { execSync, spawn } = require('child_process');

// ===== 简易 ZIP 打包/解包（纯 Node.js 实现，零依赖） =====
// 使用 Node.js 内置 zlib + tar 风格的简易归档
const zlib = require('zlib');

// ===== 配置 =====
// 解析命令行参数（支持 --port=3000, --no-browser 等格式）
const argv = process.argv.slice(2);
const cliArgs = {};
argv.forEach(arg => {
  if (arg.startsWith('--')) {
    const eqIdx = arg.indexOf('=');
    if (eqIdx > 0) {
      cliArgs[arg.slice(2, eqIdx)] = arg.slice(eqIdx + 1);
    } else {
      cliArgs[arg.slice(2)] = true;
    }
  } else if (arg.startsWith('-')) {
    cliArgs[arg.slice(1)] = true;
  }
});

const PORT = parseInt(cliArgs.port || process.env.PORT || '8080', 10);
const ROOT_DIR = __dirname;
const WATCH_DEBOUNCE = 200; // 文件变更去抖(ms)
const AUTO_OPEN_BROWSER = !cliArgs['no-browser'] && process.env.NO_BROWSER !== '1';

// ===== 后台管理密码配置 =====
const ADMIN_PASSWORD = '229655082'; // 修改为你想要的密码
const ADMIN_SECRET = crypto.randomBytes(32).toString('hex'); // 动态生成的 token 密钥
const VALID_TOKENS = new Set(); // 已登录的 token 集合

// ===== MIME类型 =====
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.eot': 'application/vnd.ms-fontobject',
  '.otf': 'font/otf'
};

// ===== SSE 客户端列表（用于自动刷新推送） =====
let sseClients = [];

// ===== 获取文件MIME类型 =====
function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_TYPES[ext] || 'application/octet-stream';
}

// ===== 安全校验：确保路径在项目目录内 =====
function safePath(requestPath) {
  const resolved = path.resolve(ROOT_DIR, requestPath.replace(/^\/+/, ''));
  if (!resolved.startsWith(ROOT_DIR)) return null;
  return resolved;
}

// ===== 读取目录结构（文件树） =====
function readDirectoryTree(dir, basePath = '', depth = 0) {
  if (depth > 5) return [];
  const result = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    // 排除隐藏文件和node_modules
    const filtered = entries.filter(e => {
      if (e.name.startsWith('.') && e.name !== '.gitignore') return false;
      if (e.name === 'node_modules') return false;
      if (e.name === 'generated-images') return false;
      return true;
    });
    // 目录在前，文件在后
    const dirs = filtered.filter(e => e.isDirectory());
    const files = filtered.filter(e => e.isFile());
    for (const entry of [...dirs, ...files]) {
      const fullPath = path.join(dir, entry.name);
      const relPath = basePath ? basePath + '/' + entry.name : entry.name;
      const stat = fs.statSync(fullPath);
      const node = {
        name: entry.name,
        path: relPath,
        type: entry.isDirectory() ? 'directory' : 'file',
        size: stat.size,
        mtime: stat.mtime.toISOString()
      };
      if (entry.isDirectory()) {
        node.children = readDirectoryTree(fullPath, relPath, depth + 1);
      }
      result.push(node);
    }
  } catch (e) {
    // 忽略读取错误
  }
  return result;
}

// ===== 读取文件内容 =====
function readFileContent(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return content;
  } catch (e) {
    return null;
  }
}

// ===== 写入文件内容 =====
function writeFileContent(filePath, content) {
  try {
    fs.writeFileSync(filePath, content, 'utf8');
    return true;
  } catch (e) {
    return false;
  }
}

// ===== 发送SSE事件 =====
function broadcastSSE(event, data) {
  const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  sseClients.forEach(res => {
    try { res.write(message); } catch (e) {}
  });
}

// ===== 文件监控（简单轮询方式，跨平台兼容） =====
let fileWatcherTimer = null;
let fileSnapshots = {};

function initFileWatcher() {
  // 扫描所有项目文件并记录mtime
  function scanFiles(dir, basePath = '') {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
        const fullPath = path.join(dir, entry.name);
        const relPath = basePath ? basePath + '/' + entry.name : entry.name;
        if (entry.isDirectory()) {
          scanFiles(fullPath, relPath);
        } else {
          const stat = fs.statSync(fullPath);
          fileSnapshots[relPath] = stat.mtimeMs;
        }
      }
    } catch (e) {}
  }

  // 初次扫描
  scanFiles(ROOT_DIR);

  // 定期检查变更（降低频率，增加去抖）
  let lastBroadcastTime = 0;
  fileWatcherTimer = setInterval(() => {
    let changedFiles = [];
    function checkFiles(dir, basePath = '') {
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
          const fullPath = path.join(dir, entry.name);
          const relPath = basePath ? basePath + '/' + entry.name : entry.name;
          if (entry.isDirectory()) {
            checkFiles(fullPath, relPath);
          } else {
            try {
              const stat = fs.statSync(fullPath);
              const prev = fileSnapshots[relPath];
              // 容忍微小时间差（文件系统精度问题），且跳过新文件（prev === undefined）
              if (prev !== undefined && Math.abs(prev - stat.mtimeMs) > 10) {
                changedFiles.push(relPath);
              }
              fileSnapshots[relPath] = stat.mtimeMs;
            } catch (e) {}
          }
        }
      } catch (e) {}
    }
    checkFiles(ROOT_DIR);
    // 两次广播之间至少间隔 2 秒，避免死循环刷新
    const now = Date.now();
    if (changedFiles.length > 0 && (now - lastBroadcastTime) > 2000) {
      lastBroadcastTime = now;
      console.log('[文件变更]', changedFiles.join(', '));
      broadcastSSE('file-changed', { files: changedFiles });
    }
  }, 1500);
}

// ===== HTTP请求处理 =====
const server = http.createServer((req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  // ===== Token 校验辅助函数 =====
  function checkAdminAuth() {
    var token = req.headers['x-admin-token'] || '';
    if (!token || !VALID_TOKENS.has(token)) {
      res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, error: '未授权，请先登录后台' }));
      return false;
    }
    return true;
  }

  // ===== API 路由 =====

  // 文件树
  if (pathname === '/api/filetree' && req.method === 'GET') {
    const tree = readDirectoryTree(ROOT_DIR);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ success: true, data: tree }));
    return;
  }

  // 读取文件内容
  if (pathname === '/api/file' && req.method === 'GET') {
    const fileRelPath = parsedUrl.query.path;
    if (!fileRelPath) {
      res.writeHead(400);
      res.end(JSON.stringify({ success: false, error: '缺少文件路径' }));
      return;
    }
    const filePath = safePath('/' + fileRelPath);
    if (!filePath || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      res.writeHead(404);
      res.end(JSON.stringify({ success: false, error: '文件不存在' }));
      return;
    }
    const content = readFileContent(filePath);
    if (content === null) {
      res.writeHead(500);
      res.end(JSON.stringify({ success: false, error: '无法读取文件（可能是二进制文件）' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      success: true,
      data: {
        path: fileRelPath,
        content: content,
        size: fs.statSync(filePath).size,
        mtime: fs.statSync(filePath).mtime.toISOString()
      }
    }));
    return;
  }

  // 保存文件内容
  if (pathname === '/api/file' && req.method === 'POST') {
    if (!checkAdminAuth()) return;
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { filePath: relPath, content } = JSON.parse(body);
        if (!relPath) {
          res.writeHead(400);
          res.end(JSON.stringify({ success: false, error: '缺少文件路径' }));
          return;
        }
        const fullPath = safePath('/' + relPath);
        if (!fullPath || !fs.existsSync(fullPath)) {
          res.writeHead(404);
          res.end(JSON.stringify({ success: false, error: '文件不存在' }));
          return;
        }
        if (writeFileContent(fullPath, content)) {
          // 更新快照
          fileSnapshots[relPath] = fs.statSync(fullPath).mtimeMs;
          // 通知所有客户端文件已变更（data.json 变更会触发前端自动刷新）
          broadcastSSE('file-changed', { files: [relPath], source: 'editor' });
          console.log('[保存成功]', relPath);
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ success: true, message: '保存成功' }));
        } else {
          res.writeHead(500);
          res.end(JSON.stringify({ success: false, error: '写入失败' }));
        }
      } catch (e) {
        res.writeHead(500);
        res.end(JSON.stringify({ success: false, error: e.message }));
      }
    });
    return;
  }

  // ===== 专题 API：获取所有专题列表 =====
  if (pathname === '/api/topics' && req.method === 'GET') {
    try {
      var dataPath2 = path.join(ROOT_DIR, 'data.json');
      if (!fs.existsSync(dataPath2)) {
        res.writeHead(404);
        res.end(JSON.stringify({ success: false, error: 'data.json 不存在' }));
        return;
      }
      var raw2 = fs.readFileSync(dataPath2, 'utf8');
      var data2 = JSON.parse(raw2);
      var topics = (data2.special && data2.special.topics) ? data2.special.topics : [];
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: true, data: topics }));
    } catch (e) {
      res.writeHead(500);
      res.end(JSON.stringify({ success: false, error: '读取专题失败: ' + e.message }));
    }
    return;
  }

  // ===== 专题 API：获取单个专题详情 =====
  if (pathname === '/api/topic' && req.method === 'GET') {
    try {
      var topicId = parseInt(parsedUrl.query.id) || 0;
      var dataPath3 = path.join(ROOT_DIR, 'data.json');
      if (!fs.existsSync(dataPath3)) {
        res.writeHead(404);
        res.end(JSON.stringify({ success: false, error: 'data.json 不存在' }));
        return;
      }
      var raw3 = fs.readFileSync(dataPath3, 'utf8');
      var data3 = JSON.parse(raw3);
      var topics3 = (data3.special && data3.special.topics) ? data3.special.topics : [];
      var topic = topics3.find(function(t) { return t.id === topicId; });
      if (!topic) {
        res.writeHead(404);
        res.end(JSON.stringify({ success: false, error: '专题不存在' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: true, data: topic }));
    } catch (e) {
      res.writeHead(500);
      res.end(JSON.stringify({ success: false, error: '读取专题失败: ' + e.message }));
    }
    return;
  }

  // ===== 专题 API：保存/更新专题 =====
  if (pathname === '/api/topic' && req.method === 'POST') {
    if (!checkAdminAuth()) return;
    var body2 = '';
    req.on('data', function(chunk) { body2 += chunk; });
    req.on('end', function() {
      try {
        var topicData = JSON.parse(body2);
        if (!topicData || !topicData.id) {
          res.writeHead(400);
          res.end(JSON.stringify({ success: false, error: '缺少专题ID' }));
          return;
        }
        var dataPath4 = path.join(ROOT_DIR, 'data.json');
        if (!fs.existsSync(dataPath4)) {
          res.writeHead(404);
          res.end(JSON.stringify({ success: false, error: 'data.json 不存在' }));
          return;
        }
        var raw4 = fs.readFileSync(dataPath4, 'utf8');
        var data4 = JSON.parse(raw4);
        if (!data4.special) data4.special = {};
        if (!data4.special.topics) data4.special.topics = [];

        var idx = data4.special.topics.findIndex(function(t) { return t.id === topicData.id; });
        if (idx >= 0) {
          data4.special.topics[idx] = topicData;
        } else {
          data4.special.topics.push(topicData);
        }

        fs.writeFileSync(dataPath4, JSON.stringify(data4, null, 2), 'utf8');
        fileSnapshots['data.json'] = fs.statSync(dataPath4).mtimeMs;
        broadcastSSE('file-changed', { files: ['data.json'], source: 'topic-save' });
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: true, message: '专题保存成功', data: { id: topicData.id } }));
      } catch (e) {
        console.error('[专题保存错误]', e);
        res.writeHead(500);
        res.end(JSON.stringify({ success: false, error: '保存专题失败: ' + e.message }));
      }
    });
    return;
  }

  // ===== 专题 API：删除专题 =====
  if (pathname === '/api/topic' && req.method === 'DELETE') {
    if (!checkAdminAuth()) return;
    try {
      var delId = parseInt(parsedUrl.query.id) || 0;
      var dataPath5 = path.join(ROOT_DIR, 'data.json');
      if (!fs.existsSync(dataPath5)) {
        res.writeHead(404);
        res.end(JSON.stringify({ success: false, error: 'data.json 不存在' }));
        return;
      }
      var raw5 = fs.readFileSync(dataPath5, 'utf8');
      var data5 = JSON.parse(raw5);
      if (!data5.special || !data5.special.topics) {
        res.writeHead(404);
        res.end(JSON.stringify({ success: false, error: '没有专题数据' }));
        return;
      }
      var beforeLen = data5.special.topics.length;
      data5.special.topics = data5.special.topics.filter(function(t) { return t.id !== delId; });
      if (data5.special.topics.length === beforeLen) {
        res.writeHead(404);
        res.end(JSON.stringify({ success: false, error: '专题不存在' }));
        return;
      }
      fs.writeFileSync(dataPath5, JSON.stringify(data5, null, 2), 'utf8');
      fileSnapshots['data.json'] = fs.statSync(dataPath5).mtimeMs;
      broadcastSSE('file-changed', { files: ['data.json'], source: 'topic-delete' });
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: true, message: '专题已删除' }));
    } catch (e) {
      res.writeHead(500);
      res.end(JSON.stringify({ success: false, error: '删除专题失败: ' + e.message }));
    }
    return;
  }

  // ===== 全局配置 API：读取导航标签图标显示配置 =====
  if (pathname === '/api/config/nav-tab-icons' && req.method === 'GET') {
    try {
      const dataPath = path.join(ROOT_DIR, 'data.json');
      if (!fs.existsSync(dataPath)) {
        res.writeHead(404);
        res.end(JSON.stringify({ success: false, error: 'data.json 不存在' }));
        return;
      }
      const raw = fs.readFileSync(dataPath, 'utf8');
      const data = JSON.parse(raw);
      const config = (data.navTabs || []).map(function(tab) {
        return {
          id: tab.id,
          name: tab.name,
          icon: tab.icon || '',
          iconVisible: tab.iconVisible !== undefined ? tab.iconVisible : true,
          showIcon: tab.showIcon !== undefined ? tab.showIcon : true
        };
      });
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: true, data: config }));
    } catch (e) {
      res.writeHead(500);
      res.end(JSON.stringify({ success: false, error: '读取配置失败: ' + e.message }));
    }
    return;
  }

  // ===== 全局配置 API：保存导航标签图标显示配置 =====
  if (pathname === '/api/config/nav-tab-icons' && req.method === 'POST') {
    if (!checkAdminAuth()) return;
    let body = '';
    req.on('data', function(chunk) { body += chunk; });
    req.on('end', function() {
      try {
        var updates = JSON.parse(body);
        if (!updates || typeof updates !== 'object') {
          res.writeHead(400);
          res.end(JSON.stringify({ success: false, error: '请求数据格式错误' }));
          return;
        }
        var dataPath = path.join(ROOT_DIR, 'data.json');
        if (!fs.existsSync(dataPath)) {
          res.writeHead(404);
          res.end(JSON.stringify({ success: false, error: 'data.json 不存在' }));
          return;
        }
        var raw = fs.readFileSync(dataPath, 'utf8');
        var data = JSON.parse(raw);
        var tabs = data.navTabs || [];
        var updatedCount = 0;

        // 支持两种格式：
        // ① 批量更新：{ "tabs": [ {"id":"home","iconVisible":true}, ... ] }
        // ② 单个更新：{ "id":"home","iconVisible":true }
        var tabUpdates = updates.tabs;
        if (!tabUpdates) {
          // 单个更新格式
          tabUpdates = [updates];
        }

        tabUpdates.forEach(function(update) {
          var tab = tabs.find(function(t) { return t.id === update.id; });
          if (tab) {
            if (update.iconVisible !== undefined) {
              tab.iconVisible = !!update.iconVisible;
              updatedCount++;
            }
            if (update.showIcon !== undefined) {
              tab.showIcon = !!update.showIcon;
              updatedCount++;
            }
          }
        });

        // 写回 data.json
        var newJson = JSON.stringify(data, null, 2);
        // 保留原始格式（2空格缩进）
        fs.writeFileSync(dataPath, newJson, 'utf8');
        // 更新文件快照
        fileSnapshots['data.json'] = fs.statSync(dataPath).mtimeMs;

        // 通知SSE客户端数据已变更（双事件：config-changed + file-changed）
        broadcastSSE('config-changed', { updatedCount: updatedCount });
        broadcastSSE('file-changed', { files: ['data.json'], source: 'config-save' });

        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: true, data: { updatedCount: updatedCount } }));
      } catch (e) {
        console.error('[配置保存错误]', e);
        res.writeHead(500);
        res.end(JSON.stringify({ success: false, error: '保存配置失败: ' + e.message }));
      }
    });
    return;
  }

  // ===== 图片上传 API（支持 multipart / base64 / 纯二进制三种方式） =====
  if (pathname === '/api/upload/image' && req.method === 'POST') {
    if (!checkAdminAuth()) return;
    const uploadDir = path.join(ROOT_DIR, 'uploads', 'images');
    // 确保上传目录存在
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    // 检测魔数（Magic Bytes）判断真实文件类型
    function detectMimeByMagic(buffer) {
      if (buffer.length < 4) return null;
      const head = buffer.slice(0, 12);
      // PNG: 89 50 4E 47
      if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4E && head[3] === 0x47) return 'image/png';
      // JPEG: FF D8 FF
      if (head[0] === 0xFF && head[1] === 0xD8 && head[2] === 0xFF) return 'image/jpeg';
      // GIF: 47 49 46 38
      if (head[0] === 0x47 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x38) return 'image/gif';
      // WebP: 52 49 46 46 ... 57 45 42 50
      if (head[0] === 0x52 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x46 &&
          head[8] === 0x57 && head[9] === 0x45 && head[10] === 0x42 && head[11] === 0x50) return 'image/webp';
      // BMP: 42 4D
      if (head[0] === 0x42 && head[1] === 0x4D) return 'image/bmp';
      // ICO: 00 00 01 00
      if (head[0] === 0x00 && head[1] === 0x00 && head[2] === 0x01 && head[3] === 0x00) return 'image/x-icon';
      // SVG: 检查是否以 <svg 或 <?xml 开头（文本检测在外部进行）
      return null;
    }

    function mimeToExt(mime) {
      const map = {
        'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif',
        'image/webp': '.webp', 'image/bmp': '.bmp', 'image/x-icon': '.ico',
        'image/svg+xml': '.svg'
      };
      return map[mime] || '.png';
    }

    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      try {
        const buffer = Buffer.concat(chunks);
        const contentType = req.headers['content-type'] || '';

        if (contentType.includes('multipart/form-data')) {
          // multipart/form-data 上传 — 安全解析
          // 提取 boundary（去除可能的引号）
          const boundaryMatch = contentType.match(/boundary=("?)([^";]+)\1/);
          if (!boundaryMatch) {
            res.writeHead(400);
            res.end(JSON.stringify({ success: false, error: '无效的 multipart 请求' }));
            return;
          }
          const boundary = '--' + boundaryMatch[2];

          // 查找 boundary 在 buffer 中的位置来精确分割
          const boundaryBuffer = Buffer.from(boundary, 'utf8');
          const crlf = Buffer.from('\r\n', 'utf8');

          // 查找所有 boundary 的索引位置
          let startIdx = 0;
          let partRanges = [];
          while (true) {
            const idx = buffer.indexOf(boundaryBuffer, startIdx);
            if (idx === -1) break;
            partRanges.push(idx);
            startIdx = idx + boundaryBuffer.length;
          }

          if (partRanges.length < 2) {
            res.writeHead(400);
            res.end(JSON.stringify({ success: false, error: '未检测到文件数据' }));
            return;
          }

          let savedPath = '';

          // 遍历每个 part（跳过第一个 boundary 行和最后一个结束标记）
          for (let pi = 0; pi < partRanges.length - 1; pi++) {
            // part 内容从 boundary 后的 \r\n 开始，到下一个 boundary 前的 \r\n 结束
            const partStart = partRanges[pi] + boundaryBuffer.length;
            const partEnd = partRanges[pi + 1];

            // 提取这部分内容（跳过开头的 \r\n）
            let contentStart = partStart;
            if (buffer[contentStart] === 0x0D && buffer[contentStart + 1] === 0x0A) {
              contentStart += 2;
            }

            const partBuffer = buffer.slice(contentStart, partEnd);

            // 查找 header 和 body 的分界：\r\n\r\n
            const headerEndIdx = partBuffer.indexOf(Buffer.from('\r\n\r\n', 'utf8'));
            if (headerEndIdx === -1) continue;

            const headerStr = partBuffer.slice(0, headerEndIdx).toString('utf8');
            if (headerStr.indexOf('filename') === -1) continue;

            const filenameMatch = headerStr.match(/filename\s*=\s*"([^"]+)"/);
            if (!filenameMatch) continue;

            const originalName = filenameMatch[1];
            // 从原始文件名中提取扩展名
            let ext = path.extname(originalName).toLowerCase();
            const validExts = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.bmp'];
            if (!validExts.includes(ext)) {
              ext = '.png'; // 默认png
            }
            if (ext === '.jpeg') ext = '.jpg';

            // 精确提取二进制内容：headerEnd + 4（\r\n\r\n）
            let bodyStart = headerEndIdx + 4;
            let bodyEnd = partBuffer.length;

            // 去除末尾的 \r\n（boundary 前的换行）
            if (bodyEnd >= 2 && partBuffer[bodyEnd - 2] === 0x0D && partBuffer[bodyEnd - 1] === 0x0A) {
              bodyEnd -= 2;
            }

            const fileBuffer = partBuffer.slice(bodyStart, bodyEnd);

            // 校验文件大小
            if (fileBuffer.length === 0) continue;
            if (fileBuffer.length > 20 * 1024 * 1024) { // 20MB
              res.writeHead(400);
              res.end(JSON.stringify({ success: false, error: '文件过大，最大支持20MB' }));
              return;
            }

            const timestamp = Date.now();
            const random = Math.random().toString(36).substring(2, 8);
            const filename = 'img_' + timestamp + '_' + random + ext;
            const filePath = path.join(uploadDir, filename);
            fs.writeFileSync(filePath, fileBuffer);
            savedPath = 'uploads/images/' + filename;
            break;
          }

          if (savedPath) {
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ success: true, data: { path: savedPath, url: '/' + savedPath } }));
          } else {
            res.writeHead(400);
            res.end(JSON.stringify({ success: false, error: '未检测到有效图片文件，请选择 JPG/PNG/GIF/WebP/SVG 格式' }));
          }
        } else if (contentType.includes('application/json')) {
          // Base64 上传方式
          const body = JSON.parse(buffer.toString('utf8'));
          const { data: base64Data } = body;
          if (!base64Data) {
            res.writeHead(400);
            res.end(JSON.stringify({ success: false, error: '缺少图片数据' }));
            return;
          }

          // 检测图片类型
          let ext = '.png';
          if (base64Data.startsWith('data:image/')) {
            const mimeMatch = base64Data.match(/^data:image\/(\w+);/);
            if (mimeMatch) {
              const mimeExt = mimeMatch[1].toLowerCase();
              if (mimeExt === 'jpeg') ext = '.jpg';
              else if (['png', 'jpg', 'gif', 'webp', 'svg', 'ico', 'bmp'].includes(mimeExt)) {
                ext = '.' + mimeExt;
              }
            }
          }

          const pureBase64 = base64Data.replace(/^data:image\/\w+;base64,/, '');
          const imgBuffer = Buffer.from(pureBase64, 'base64');

          if (imgBuffer.length > 20 * 1024 * 1024) {
            res.writeHead(400);
            res.end(JSON.stringify({ success: false, error: '文件过大，最大支持20MB' }));
            return;
          }

          const savedFilename = 'img_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8) + ext;
          const filePath = path.join(uploadDir, savedFilename);
          fs.writeFileSync(filePath, imgBuffer);
          const savedPath = 'uploads/images/' + savedFilename;

          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ success: true, data: { path: savedPath, url: '/' + savedPath } }));
        } else {
          // 纯二进制上传 — 通过魔数检测类型
          const mime = detectMimeByMagic(buffer);
          if (!mime) {
            res.writeHead(400);
            res.end(JSON.stringify({ success: false, error: '无法识别的图片格式' }));
            return;
          }

          if (buffer.length > 20 * 1024 * 1024) {
            res.writeHead(400);
            res.end(JSON.stringify({ success: false, error: '文件过大，最大支持20MB' }));
            return;
          }

          const ext = mimeToExt(mime);
          const filename = 'img_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8) + ext;
          const filePath = path.join(uploadDir, filename);
          fs.writeFileSync(filePath, buffer);
          const savedPath = 'uploads/images/' + filename;
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ success: true, data: { path: savedPath, url: '/' + savedPath } }));
        }
      } catch (e) {
        console.error('[上传错误]', e);
        res.writeHead(500);
        res.end(JSON.stringify({ success: false, error: '上传失败: ' + e.message }));
      }
    });
    return;
  }

  // ===== 备份导出：打包 data.json + 所有静态资源 =====
  if (pathname === '/api/backup/export' && req.method === 'GET') {
    try {
      const backup = createBackupArchive();
      const manifest = generateBackupManifest(backup);

      // 返回 JSON 格式的完整备份数据（包含所有文本文件内容 + 二进制文件的 base64）
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': 'attachment; filename="wazhuan-backup-' + formatDate(new Date()) + '.json"'
      });
      res.end(JSON.stringify({
        success: true,
        data: {
          version: '1.0.0',
          exportedAt: new Date().toISOString(),
          project: 'wazhuan',
          manifest: manifest,
          files: backup
        }
      }, null, 2));
      console.log('[备份导出] 成功，共', Object.keys(backup).length, '个文件');
      return;
    } catch (e) {
      res.writeHead(500);
      res.end(JSON.stringify({ success: false, error: '备份失败: ' + e.message }));
      return;
    }
  }

  // ===== 备份导入：接收 JSON 备份数据并还原 =====
  if (pathname === '/api/backup/import' && req.method === 'POST') {
    if (!checkAdminAuth()) return;
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const backup = JSON.parse(body);
        const result = restoreFromBackup(backup);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: true, data: result }));
        console.log('[备份导入] 成功，还原了', result.restoredCount, '个文件');
      } catch (e) {
        res.writeHead(500);
        res.end(JSON.stringify({ success: false, error: '导入失败: ' + e.message }));
      }
    });
    return;
  }

  // ===== 备份下载（生成可下载的 .json 备份文件） =====
  if (pathname === '/api/backup/download' && req.method === 'GET') {
    try {
      const backup = createBackupArchive();
      const manifest = generateBackupManifest(backup);
      const jsonStr = JSON.stringify({
        version: '1.0.0',
        exportedAt: new Date().toISOString(),
        project: 'wazhuan',
        manifest: manifest,
        files: backup
      }, null, 2);

      res.writeHead(200, {
        'Content-Type': 'application/octet-stream; charset=utf-8',
        'Content-Disposition': 'attachment; filename="wazhuan-backup-' + formatDate(new Date()) + '.json"',
        'Content-Length': Buffer.byteLength(jsonStr, 'utf8')
      });
      res.end(jsonStr);
      console.log('[备份下载] 文件已生成');
      return;
    } catch (e) {
      res.writeHead(500);
      res.end(JSON.stringify({ success: false, error: '下载失败: ' + e.message }));
      return;
    }
  }

  // ===== 备份校验：检查备份数据的完整性 =====
  if (pathname === '/api/backup/verify' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const backup = JSON.parse(body);
        const result = verifyBackupIntegrity(backup);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: true, data: result }));
      } catch (e) {
        res.writeHead(400);
        res.end(JSON.stringify({ success: false, error: '校验失败: ' + e.message }));
      }
    });
    return;
  }

  // ===== 后台登录认证 =====
  if (pathname === '/api/auth' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        var { password } = JSON.parse(body);
        if (password === ADMIN_PASSWORD) {
          var token = crypto.createHmac('sha256', ADMIN_SECRET).update(Date.now().toString()).digest('hex');
          VALID_TOKENS.add(token);
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ success: true, token: token }));
        } else {
          res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ success: false, error: '密码错误' }));
        }
      } catch (e) {
        res.writeHead(400);
        res.end(JSON.stringify({ success: false, error: '请求格式错误' }));
      }
    });
    return;
  }

  // SSE 事件流（实时推送文件变更 + 自动刷新）
  if (pathname === '/api/events' && req.method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });
    res.write('event: connected\ndata: {"status":"ok"}\n\n');
    sseClients.push(res);
    req.on('close', () => {
      sseClients = sseClients.filter(c => c !== res);
    });
    return;
  }

  // 服务器状态
  if (pathname === '/api/status' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      success: true,
      data: {
        port: PORT,
        rootDir: ROOT_DIR,
        clients: sseClients.length,
        uptime: process.uptime()
      }
    }));
    return;
  }

  // ===== 静态文件服务 =====

  // 默认首页
  let requestPath = pathname;
  if (requestPath === '/') requestPath = '/index.html';

  const filePath = safePath(requestPath);

  // 安全校验
  if (!filePath) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  // 文件不存在
  if (!fs.existsSync(filePath)) {
    res.writeHead(404);
    res.end('404 Not Found');
    return;
  }

  // 目录 -> 列出文件
  if (fs.statSync(filePath).isDirectory()) {
    const tree = readDirectoryTree(filePath, requestPath.replace(/^\/+/, '').replace(/\/+$/, ''));
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ success: true, data: tree }));
    return;
  }

  // 对于HTML文件，注入自动刷新脚本
  const mimeType = getMimeType(filePath);
  const ext = path.extname(filePath).toLowerCase();

  if (ext === '.html') {
    try {
      let htmlContent = fs.readFileSync(filePath, 'utf8');
      // 注入自动刷新脚本（在</body>前）
      const refreshScript = `
<!-- 本地开发文件变更通知 + 数据同步触发 -->
<script>
(function() {
  // 防止重复初始化
  if (window.__livereload_inited) return;
  window.__livereload_inited = true;

  var es = new EventSource('/api/events');

  es.addEventListener('file-changed', function(e) {
    try {
      var data = JSON.parse(e.data);
      // 忽略编辑器自己触发的保存事件
      if (data.source === 'editor' && window.__is_editor) return;
      console.log('[DevNotify] 文件变更:', data.files);
      // data.json 变更 → 触发 SyncEngine 自动刷新
      var files = data.files || [];
      var dataChanged = files.some(function(f) { return f === 'data.json' || f.indexOf('data.json') >= 0; });
      if (dataChanged && typeof SyncEngine !== 'undefined') {
        console.log('[DevNotify] data.json 已更新，触发自动同步');
        SyncEngine.refresh();
      }
    } catch(ex) {}
  });

  es.addEventListener('config-changed', function(e) {
    try {
      var data = JSON.parse(e.data);
      if (data.updatedCount > 0 && typeof SyncEngine !== 'undefined') {
        console.log('[DevNotify] 配置已更新，触发自动同步');
        SyncEngine.refresh();
      }
    } catch(ex) {}
  });

  es.addEventListener('connected', function() {
    console.log('[DevNotify] 已连接');
  });

  // 断线时温和重连
  es.onerror = function() {
    console.log('[DevNotify] 连接断开，3秒后重连...');
    es.close();
    window.__livereload_inited = false;
    setTimeout(function() {
      if (document.visibilityState !== 'visible') return;
    }, 3000);
  };
})();
</script>
</body>`;
      htmlContent = htmlContent.replace('</body>', refreshScript);
      res.writeHead(200, { 'Content-Type': mimeType });
      res.end(htmlContent);
      return;
    } catch (e) {
      // 读取失败则直接发送原始文件
    }
  }

  // 普通静态文件
  const fileContent = fs.readFileSync(filePath);
  res.writeHead(200, { 'Content-Type': mimeType });
  res.end(fileContent);
});

// ===== 跨平台：自动打开浏览器 =====
function openBrowser(url) {
  const platform = process.platform;
  let command;

  try {
    if (platform === 'darwin') {
      // macOS
      command = `open "${url}"`;
    } else if (platform === 'win32') {
      // Windows：优先使用 start，兼容各种终端
      command = `start "" "${url}"`;
    } else {
      // Linux / 其他 Unix
      command = `xdg-open "${url}"`;
    }

    execSync(command, { stdio: 'ignore', timeout: 3000 });
    console.log('[自动打开] 已在默认浏览器中打开预览页面');
  } catch (e) {
    // 静默失败：某些环境可能没有 GUI 浏览器
    console.log('[提示] 请手动打开浏览器访问: ' + url);
  }
}

// ===== 启动服务器（支持端口自动回退） =====
let actualPort = PORT;

function tryListen(port) {
  const testServer = http.createServer();
  testServer.once('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.log(`端口 ${port} 已被占用，尝试端口 ${port + 1}...`);
      tryListen(port + 1);
    }
  });
  testServer.once('listening', () => {
    testServer.close();
    actualPort = port;
    startRealServer(port);
  });
  testServer.listen(port);
}

function startRealServer(port) {
  server.listen(port, () => {
    const localUrl = `http://localhost:${port}`;

    console.log('');
    console.log('╔══════════════════════════════════════════════╗');
    console.log('║       挖赚网 - 本地开发服务器已启动          ║');
    console.log('╠══════════════════════════════════════════════╣');
    console.log(`║  预览地址:  ${localUrl}             ║`);
    console.log(`║  编辑器:    ${localUrl}/editor.html         ║`);
    console.log(`║  后台管理:  ${localUrl}/admin.html          ║`);
    console.log(`║  专题编辑:  ${localUrl}/special-editor.html ║`);
    console.log(`║  专题详情:  ${localUrl}/special-detail.html ║`);
    console.log('╠══════════════════════════════════════════════╣');
    console.log('║  功能: 实时预览 | 在线编辑 | 自动刷新        ║');
    console.log(`║  平台:   ${process.platform}                        ║`);
    console.log('╚══════════════════════════════════════════════╝');
    console.log('');
    console.log('按 Ctrl+C 停止服务器');
    console.log('');

    // 启动文件监控
    initFileWatcher();

    // 自动打开浏览器（可通过 NO_BROWSER=1 环境变量禁用）
    if (AUTO_OPEN_BROWSER) {
      // 延迟 500ms 确保服务器完全就绪
      setTimeout(() => openBrowser(localUrl), 500);
    }
  });
}

// ===== 备份系统：核心函数 =====

// 备份时需要收集的文件扩展名（文本文件以 utf8 存储，二进制以 base64 存储）
const BACKUP_TEXT_EXTS = new Set([
  '.html', '.css', '.js', '.json', '.txt', '.md', '.xml', '.svg',
  '.htaccess', '.gitignore', '.bat', '.sh', '.toml', '.yaml', '.yml'
]);
const BACKUP_BINARY_EXTS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.bmp',
  '.woff', '.woff2', '.ttf', '.eot', '.otf',
  '.mp4', '.webm', '.mp3', '.wav', '.ogg',
  '.pdf', '.zip', '.tar', '.gz'
]);
const BACKUP_IGNORE_DIRS = new Set(['node_modules', '.git', '.codebuddy']);
const BACKUP_IGNORE_FILES = new Set(['server.log', 'package-lock.json', '.DS_Store', 'Thumbs.db']);

// 收集所有需要备份的文件
function collectBackupFiles(dir, basePath) {
  const files = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      if (entry.isDirectory() && BACKUP_IGNORE_DIRS.has(entry.name)) continue;
      if (entry.isFile() && BACKUP_IGNORE_FILES.has(entry.name)) continue;

      const fullPath = path.join(dir, entry.name);
      const relPath = basePath ? basePath + '/' + entry.name : entry.name;

      if (entry.isDirectory()) {
        files.push(...collectBackupFiles(fullPath, relPath));
      } else {
        const stat = fs.statSync(fullPath);
        const ext = path.extname(entry.name).toLowerCase();
        files.push({
          path: relPath,
          size: stat.size,
          mtime: stat.mtime.toISOString(),
          ext: ext
        });
      }
    }
  } catch (e) { /* 忽略读取错误 */ }
  return files;
}

// 创建备份存档
function createBackupArchive() {
  const fileList = collectBackupFiles(ROOT_DIR, '');
  const archive = {};

  for (const file of fileList) {
    const fullPath = path.join(ROOT_DIR, file.path);
    try {
      if (BACKUP_TEXT_EXTS.has(file.ext) || file.ext === '') {
        // 文本文件：直接存字符串
        archive[file.path] = {
          type: 'text',
          encoding: 'utf8',
          content: fs.readFileSync(fullPath, 'utf8'),
          size: file.size,
          mtime: file.mtime
        };
      } else if (BACKUP_BINARY_EXTS.has(file.ext)) {
        // 二进制文件：转 base64
        const buffer = fs.readFileSync(fullPath);
        archive[file.path] = {
          type: 'binary',
          encoding: 'base64',
          content: buffer.toString('base64'),
          size: file.size,
          mtime: file.mtime
        };
      } else {
        // 未知类型：尝试按文本读取，失败则按二进制
        try {
          archive[file.path] = {
            type: 'text',
            encoding: 'utf8',
            content: fs.readFileSync(fullPath, 'utf8'),
            size: file.size,
            mtime: file.mtime
          };
        } catch (e) {
          const buffer = fs.readFileSync(fullPath);
          archive[file.path] = {
            type: 'binary',
            encoding: 'base64',
            content: buffer.toString('base64'),
            size: file.size,
            mtime: file.mtime
          };
        }
      }
    } catch (e) {
      archive[file.path] = { type: 'error', error: e.message };
    }
  }

  return archive;
}

// 生成备份清单（文件数量、类型统计、哈希摘要）
function generateBackupManifest(archive) {
  const filePaths = Object.keys(archive);
  const stats = {
    totalFiles: filePaths.length,
    textFiles: 0,
    binaryFiles: 0,
    totalSize: 0,
    fileTypes: {}
  };

  const hashList = [];
  for (const fp of filePaths) {
    const entry = archive[fp];
    stats.totalSize += (entry.size || 0);

    if (entry.type === 'text') stats.textFiles++;
    else if (entry.type === 'binary') stats.binaryFiles++;

    const ext = path.extname(fp).toLowerCase() || '(无扩展名)';
    stats.fileTypes[ext] = (stats.fileTypes[ext] || 0) + 1;

    // 计算每个文件的哈希
    const hash = crypto.createHash('sha256');
    hash.update(typeof entry.content === 'string' ? entry.content : (entry.content || ''));
    hashList.push({ path: fp, sha256: hash.digest('hex') });
  }

  // 整体摘要哈希
  const totalHash = crypto.createHash('sha256');
  hashList.sort((a, b) => a.path.localeCompare(b.path));
  hashList.forEach(h => totalHash.update(h.sha256));
  const integrityHash = totalHash.digest('hex');

  return {
    project: 'wazhuan',
    generatedAt: new Date().toISOString(),
    fileCount: stats.totalFiles,
    textFiles: stats.textFiles,
    binaryFiles: stats.binaryFiles,
    totalSize: stats.totalSize,
    fileTypes: stats.fileTypes,
    fileHashes: hashList,
    integrityHash: integrityHash
  };
}

// 从备份数据还原文件
function restoreFromBackup(backup) {
  if (!backup || !backup.files) {
    throw new Error('无效的备份数据：缺少 files 字段');
  }

  const files = backup.files;
  const filePaths = Object.keys(files);
  let restoredCount = 0;
  let skippedCount = 0;
  const errors = [];
  const details = [];

  // 先在内存中更新 fileSnapshots，暂停文件监控通知
  const oldSnapshots = Object.assign({}, fileSnapshots);

  for (const relPath of filePaths) {
    const entry = files[relPath];
    if (!entry || entry.type === 'error') {
      skippedCount++;
      errors.push({ path: relPath, error: entry ? entry.error : '数据为空' });
      continue;
    }

    try {
      const fullPath = path.join(ROOT_DIR, relPath);
      // 确保父目录存在
      const dir = path.dirname(fullPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      if (entry.type === 'text') {
        fs.writeFileSync(fullPath, entry.content, 'utf8');
      } else if (entry.type === 'binary') {
        const buffer = Buffer.from(entry.content, 'base64');
        fs.writeFileSync(fullPath, buffer);
      }

      // 更新文件监控快照
      fileSnapshots[relPath] = fs.statSync(fullPath).mtimeMs;
      restoredCount++;
      details.push({ path: relPath, status: '已还原', size: entry.size });
    } catch (e) {
      errors.push({ path: relPath, error: e.message });
    }
  }

  // 广播文件变更通知
  broadcastSSE('file-changed', {
    files: filePaths,
    source: 'backup-restore',
    message: '备份数据已还原'
  });

  console.log('[备份还原]', restoredCount, '个文件已还原，', skippedCount, '个跳过，', errors.length, '个错误');

  return {
    restoredCount: restoredCount,
    skippedCount: skippedCount,
    totalCount: filePaths.length,
    errors: errors.length > 0 ? errors : undefined,
    details: details,
    message: `成功还原 ${restoredCount} 个文件` + (errors.length > 0 ? `，${errors.length} 个文件失败` : '')
  };
}

// 校验备份数据完整性
function verifyBackupIntegrity(backup) {
  if (!backup || !backup.files || !backup.manifest) {
    return { valid: false, reason: '备份数据结构不完整，缺少 files 或 manifest 字段' };
  }

  const files = backup.files;
  const manifest = backup.manifest;
  const results = [];

  // 1. 检查文件数量一致性
  const fileCount = Object.keys(files).length;
  if (fileCount !== manifest.fileCount) {
    results.push({ check: '文件数量', passed: false,
      expected: manifest.fileCount, actual: fileCount,
      message: '备份数据中的文件数与清单不一致' });
  } else {
    results.push({ check: '文件数量', passed: true, message: `共 ${fileCount} 个文件，与清单一致` });
  }

  // 2. 校验每个文件的哈希
  let hashMismatchCount = 0;
  if (manifest.fileHashes && Array.isArray(manifest.fileHashes)) {
    for (const hashEntry of manifest.fileHashes) {
      const fp = hashEntry.path;
      const entry = files[fp];
      if (!entry || !entry.content) {
        hashMismatchCount++;
        continue;
      }
      const hash = crypto.createHash('sha256');
      hash.update(typeof entry.content === 'string' ? entry.content : (entry.content || ''));
      const computedHash = hash.digest('hex');
      if (computedHash !== hashEntry.sha256) {
        hashMismatchCount++;
      }
    }
    results.push({
      check: '文件哈希校验',
      passed: hashMismatchCount === 0,
      total: manifest.fileHashes.length,
      mismatched: hashMismatchCount,
      message: hashMismatchCount === 0
        ? '所有文件哈希校验通过'
        : `${hashMismatchCount} 个文件哈希不匹配`
    });
  }

  // 3. 检查是否包含核心文件
  const coreFiles = ['data.json', 'index.html', 'admin.html', 'server.js', 'styles.css', 'app.js', 'sync-engine.js'];
  const missingCore = coreFiles.filter(f => !files[f]);
  results.push({
    check: '核心文件完整性',
    passed: missingCore.length === 0,
    missing: missingCore.length > 0 ? missingCore : undefined,
    message: missingCore.length === 0
      ? '所有核心文件均存在'
      : `缺少 ${missingCore.length} 个核心文件: ${missingCore.join(', ')}`
  });

  const allPassed = results.every(r => r.passed);
  return {
    valid: allPassed,
    checks: results,
    summary: allPassed ? '备份数据完整且有效，可以安全导入' : '备份数据存在问题，建议重新导出'
  };
}

// 格式化日期为文件名友好的格式
function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${y}${m}${d}-${h}${min}`;
}

tryListen(PORT);

// ===== 优雅退出 =====
process.on('SIGINT', () => {
  console.log('\n正在关闭服务器...');
  if (fileWatcherTimer) clearInterval(fileWatcherTimer);
  sseClients.forEach(res => res.end());
  server.close(() => {
    console.log('服务器已停止');
    process.exit(0);
  });
});
