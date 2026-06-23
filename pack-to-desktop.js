/**
 * 挖赚网项目打包脚本
 * 自动扫描所有网页及数据依赖，生成ZIP压缩包保存到桌面
 * 兼容 Windows / macOS / Linux
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// ===== 自动识别系统桌面路径 =====
function getDesktopPath() {
  const home = process.env.HOME || process.env.USERPROFILE || process.env.HOMEPATH;
  const platform = process.platform;

  if (platform === 'win32') {
    // Windows: 尝试读取注册表桌面路径，失败则用默认
    return path.join(home, 'Desktop');
  } else if (platform === 'darwin') {
    // macOS
    return path.join(home, 'Desktop');
  } else {
    // Linux
    return path.join(home, 'Desktop');
  }
}

// ===== 简易ZIP生成（不依赖外部库） =====
// ZIP文件格式参考: https://en.wikipedia.org/wiki/ZIP_(file_format)

function createZip(files) {
  const localHeaders = [];
  const centralHeaders = [];
  const dataBlocks = [];

  let offset = 0;

  for (const { name, data } of files) {
    const nameBytes = Buffer.from(name, 'utf8');
    const compressed = zlib.deflateRawSync(data);
    const crc32 = crc32calc(data);

    // Local file header (30 + name length)
    const local = Buffer.alloc(30 + nameBytes.length);
    local.writeUInt32LE(0x04034b50, 0);       // Signature
    local.writeUInt16LE(20, 4);                // Version needed
    local.writeUInt16LE(0x0800, 6);            // General purpose bit flag (bit 11 = UTF-8 names)
    local.writeUInt16LE(8, 8);                 // Compression method: deflate
    local.writeUInt16LE(0, 10);                // Mod time
    local.writeUInt16LE(0, 12);                // Mod date
    local.writeUInt32LE(crc32, 14);            // CRC-32
    local.writeUInt32LE(compressed.length, 18); // Compressed size
    local.writeUInt32LE(data.length, 22);      // Uncompressed size
    local.writeUInt16LE(nameBytes.length, 26); // File name length
    local.writeUInt16LE(0, 28);                // Extra field length
    nameBytes.copy(local, 30);

    localHeaders.push(local);
    dataBlocks.push(compressed);

    // Central directory header (46 + name length)
    const central = Buffer.alloc(46 + nameBytes.length);
    central.writeUInt32LE(0x02014b50, 0);      // Signature
    central.writeUInt16LE(20, 4);               // Version made by
    central.writeUInt16LE(20, 6);               // Version needed
    central.writeUInt16LE(0x0800, 8);           // General purpose bit flag
    central.writeUInt16LE(8, 10);               // Compression method
    central.writeUInt16LE(0, 12);               // Mod time
    central.writeUInt16LE(0, 14);               // Mod date
    central.writeUInt32LE(crc32, 16);           // CRC-32
    central.writeUInt32LE(compressed.length, 20); // Compressed size
    central.writeUInt32LE(data.length, 24);     // Uncompressed size
    central.writeUInt16LE(nameBytes.length, 28); // File name length
    central.writeUInt16LE(0, 30);               // Extra field length
    central.writeUInt16LE(0, 32);               // File comment length
    central.writeUInt16LE(0, 34);               // Disk number start
    central.writeUInt16LE(0, 36);               // Internal file attributes
    central.writeUInt32LE(0, 38);               // External file attributes
    central.writeUInt32LE(offset, 42);          // Relative offset of local header
    nameBytes.copy(central, 46);

    centralHeaders.push(central);
    offset += local.length + compressed.length;
  }

  // End of central directory record
  const centralSize = centralHeaders.reduce((s, b) => s + b.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);            // Signature
  eocd.writeUInt16LE(0, 4);                      // Disk number
  eocd.writeUInt16LE(0, 6);                      // Disk with central dir
  eocd.writeUInt16LE(files.length, 8);           // Entries on this disk
  eocd.writeUInt16LE(files.length, 10);          // Total entries
  eocd.writeUInt32LE(centralSize, 12);           // Central dir size
  eocd.writeUInt32LE(offset, 16);                // Offset of central dir
  eocd.writeUInt16LE(0, 20);                     // Comment length

  return Buffer.concat([
    ...localHeaders.map((h, i) => Buffer.concat([h, dataBlocks[i]])),
    ...centralHeaders,
    eocd
  ]);
}

// CRC-32 计算
function crc32calc(buf) {
  let crc = 0xFFFFFFFF;
  const table = crc32Table();
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xFF];
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function crc32Table() {
  const table = [];
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table.push(c >>> 0);
  }
  return table;
}

// ===== 主流程 =====
function main() {
  const projectDir = __dirname;
  const desktopPath = getDesktopPath();
  const zipFileName = '挖赚网-网页打包.zip';
  const zipFilePath = path.join(desktopPath, zipFileName);

  // 扫描项目文件（排除打包脚本自身和.node_modules等）
  const excludePatterns = ['pack-to-desktop.js', 'package.json', 'package-lock.json', '.git'];
  const extensions = ['.html', '.css', '.js', '.json', '.ico', '.png', '.jpg', '.gif', '.webp', '.svg'];

  const files = [];

  function scanDir(dir, prefix = '') {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relPath = prefix ? prefix + '/' + entry.name : entry.name;

      // 排除条件
      if (excludePatterns.includes(entry.name)) continue;
      if (entry.name.startsWith('.') && entry.name !== '.gitignore') continue;

      if (entry.isDirectory()) {
        // 不递归 node_modules 等无用目录
        if (['node_modules', '.codebuddy'].includes(entry.name)) continue;
        scanDir(fullPath, relPath);
      } else {
        // 只包含指定扩展名的文件
        const ext = path.extname(entry.name).toLowerCase();
        if (extensions.includes(ext) || entry.name === 'favicon.ico') {
          const data = fs.readFileSync(fullPath);
          files.push({ name: relPath, data });
          console.log(`  [包含] ${relPath} (${(data.length / 1024).toFixed(1)} KB)`);
        }
      }
    }
  }

  console.log('=== 挖赚网网页打包工具 ===');
  console.log(`项目目录: ${projectDir}`);
  console.log(`桌面路径: ${desktopPath}`);
  console.log(`输出文件: ${zipFilePath}`);
  console.log('');
  console.log('扫描项目文件...');

  scanDir(projectDir);

  console.log('');
  console.log(`共扫描到 ${files.length} 个文件`);
  console.log('正在生成ZIP压缩包...');

  const zipData = createZip(files);

  fs.writeFileSync(zipFilePath, zipData);

  const sizeMB = (zipData.length / 1024 / 1024).toFixed(2);
  console.log('');
  console.log('=== 打包完成! ===');
  console.log(`ZIP文件: ${zipFilePath}`);
  console.log(`压缩大小: ${sizeMB} MB`);
  console.log(`包含文件: ${files.length} 个`);
  console.log('');
  console.log('所有资源已内嵌/包含，解压后可直接离线访问。');
}

main();
