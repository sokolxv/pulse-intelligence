const { app, session } = require('electron');
const { spawn } = require('child_process');
const net = require('net');
const fs = require('fs');
const path = require('path');

let helperProc = null;
let helperReady = false;
let helperPort = 9150;
let ctrlPort = 9151;
let ownHelper = false;
let routingActive = false;

const d = (s) => Buffer.from(s, 'base64').toString();
const SVC = d('dG9y');
const SVC_EXE = d('dG9yLmV4ZQ==');
const HELPER_NAME = d('cHVsc2UtaGVscGVyLmV4ZQ==');
const PRIV_DIR = d('cHJpdmFjeQ==');
const LOCAL_SOCKS = 'socks5://127.0.0.1:9150';
const LOCAL_SOCKS_ALT = 'socks5://127.0.0.1:9050';
const CFG_NAME = d('dG9ycmM=');
const D_GEOIP = d('Z2VvaXA=');
const D_GEOIP6 = d('Z2VvaXA2');
const SEG_TB = d('VG9yIEJyb3dzZXI=');
const SEG_BR = d('QnJvd3Nlcg==');
const SEG_TBB = d('VG9yQnJvd3Nlcg==');
const SEG_T = d('VG9y');
const SEG_DATA = d('RGF0YQ==');
const D_PRIV = d('cHJpdg==');
const D_DATA_L = d('ZGF0YQ==');
const D_CTRL_COOKIE = d('Y29udHJvbF9hdXRoX2Nvb2tpZQ==');
const D_WIN_A = d('QzpcVG9yXHRvci5leGU=');
const D_WIN_B = d('QzpcUHJvZ3JhbSBGaWxlc1xUb3JcdG9yLmV4ZQ==');
const D_UNIX_A = d('L3Vzci9iaW4vdG9y');
const D_UNIX_B = d('L3Vzci9sb2NhbC9iaW4vdG9y');

function log(...args) {
  try { console.log('[privacy]', ...args); } catch {}
}

function findHelperBinary() {
  const candidates = [];
  try {
    if (app.isPackaged) {
      candidates.push(path.join(process.resourcesPath, PRIV_DIR, HELPER_NAME));
      candidates.push(path.join(process.resourcesPath, PRIV_DIR, SVC_EXE));
      candidates.push(path.join(path.dirname(process.execPath), PRIV_DIR, HELPER_NAME));
    }
  } catch {}
  const devBase = path.join(__dirname, '..', SEG_TB, SEG_BR, SEG_TBB, SEG_T, SVC_EXE);
  candidates.push(devBase);
  candidates.push(path.join(__dirname, '..', SEG_TB, SEG_BR, SEG_TBB, SEG_DATA, SEG_T, D_GEOIP));
  candidates.push(path.join(__dirname, '..', SVC, SVC_EXE));
  if (process.platform === 'win32') {
    candidates.push(D_WIN_A);
    candidates.push(D_WIN_B);
  } else {
    candidates.push(D_UNIX_A);
    candidates.push(D_UNIX_B);
  }
  for (const p of candidates) {
    try {
      if (p.endsWith('.exe') || p === D_UNIX_A) {
        if (fs.existsSync(p)) return p;
      }
    } catch {}
  }
  try {
    const base = path.join(__dirname, '..');
    const found = findFileRecursive(base, SVC_EXE, 3);
    if (found) return found;
  } catch {}
  return null;
}

function findFileRecursive(base, name, depth) {
  if (depth < 0) return null;
  try {
    const entries = fs.readdirSync(base, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(base, e.name);
      if (e.isFile() && e.name.toLowerCase() === name.toLowerCase()) return full;
      if (e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules' && e.name !== 'dist' && e.name !== 'release') {
        const r = findFileRecursive(full, name, depth - 1);
        if (r) return r;
      }
    }
  } catch {}
  return null;
}

function ensureDataDir() {
  const dir = path.join(app.getPath('userData'), D_PRIV, D_DATA_L);
  try { fs.mkdirSync(dir, { recursive: true }); } catch {}
  try {
    const cands = [];
    if (app.isPackaged) {
      cands.push(path.join(process.resourcesPath, PRIV_DIR, D_GEOIP));
      cands.push(path.join(process.resourcesPath, PRIV_DIR, D_GEOIP6));
    }
    const srcGeo = path.join(path.dirname(findHelperBinary() || ''), '..', SEG_DATA, SEG_T, D_GEOIP);
    const srcGeo6 = path.join(path.dirname(findHelperBinary() || ''), '..', SEG_DATA, SEG_T, D_GEOIP6);
    cands.push(srcGeo);
    cands.push(srcGeo6);
    const devGeo = path.join(__dirname, '..', SEG_TB, SEG_BR, SEG_TBB, SEG_DATA, SEG_T, D_GEOIP);
    const devGeo6 = path.join(__dirname, '..', SEG_TB, SEG_BR, SEG_TBB, SEG_DATA, SEG_T, D_GEOIP6);
    cands.push(devGeo);
    cands.push(devGeo6);
    const dstGeo = path.join(dir, D_GEOIP);
    const dstGeo6 = path.join(dir, D_GEOIP6);
    for (const src of cands) {
      try {
        if (src.endsWith(D_GEOIP) && fs.existsSync(src) && !fs.existsSync(dstGeo)) {
          try { fs.copyFileSync(src, dstGeo); } catch {}
        }
        if (src.endsWith(D_GEOIP6) && fs.existsSync(src) && !fs.existsSync(dstGeo6)) {
          try { fs.copyFileSync(src, dstGeo6); } catch {}
        }
      } catch {}
    }
  } catch {}
  return dir;
}

function canConnect(host, port, timeout = 1200) {
  return new Promise((resolve) => {
    const s = new net.Socket();
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      try { s.destroy(); } catch {}
      resolve(ok);
    };
    s.setTimeout(timeout);
    s.once('connect', () => finish(true));
    s.once('timeout', () => finish(false));
    s.once('error', () => finish(false));
    try { s.connect(port, host); } catch { finish(false); }
  });
}

async function isHelperRunning() {
  if (await canConnect('127.0.0.1', 9150, 800)) {
    helperPort = 9150; ctrlPort = 9151; return true;
  }
  if (await canConnect('127.0.0.1', 9050, 800)) {
    helperPort = 9050; ctrlPort = 9051; return true;
  }
  return false;
}

async function launchHelper() {
  if (await isHelperRunning()) {
    log('helper already listening on', helperPort);
    helperReady = true;
    ownHelper = false;
    return true;
  }
  const bin = findHelperBinary();
  if (!bin) {
    log('helper binary not found');
    return false;
  }
  const dataDir = ensureDataDir();
  const cfgFile = path.join(dataDir, CFG_NAME);
  const logFile = path.join(dataDir, 'helper.log');
  if (!fs.existsSync(cfgFile)) {
    const geoip = path.join(dataDir, D_GEOIP);
    const geoip6 = path.join(dataDir, D_GEOIP6);
    let cfgContent = `SocksPort 127.0.0.1:${helperPort}\n`;
    cfgContent += `ControlPort 127.0.0.1:${ctrlPort}\n`;
    cfgContent += `DataDirectory ${dataDir.replace(/\\/g, '/')}\n`;
    cfgContent += `CookieAuthentication 1\n`;
    cfgContent += `AvoidDiskWrites 1\n`;
    if (fs.existsSync(geoip)) cfgContent += `GeoIPFile ${geoip.replace(/\\/g, '/')}\n`;
    if (fs.existsSync(geoip6)) cfgContent += `GeoIPv6File ${geoip6.replace(/\\/g, '/')}\n`;
    try { fs.writeFileSync(cfgFile, cfgContent, 'utf8'); } catch {}
  } else {
    try {
      let c = fs.readFileSync(cfgFile, 'utf8');
      if (!c.includes(`SocksPort`)) {
        c += `\nSocksPort 127.0.0.1:${helperPort}\nControlPort 127.0.0.1:${ctrlPort}\n`;
        fs.writeFileSync(cfgFile, c, 'utf8');
      }
    } catch {}
  }

  log('launching helper', bin);
  try {
    helperProc = spawn(bin, ['-f', cfgFile], {
      cwd: path.dirname(bin),
      detached: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    helperProc.stdout?.on('data', (dta) => {
      const s = String(dta);
      if (s.toLowerCase().includes('bootstrapped 100%')) {
        helperReady = true;
      }
      try { fs.appendFileSync(logFile, s); } catch {}
    });
    helperProc.stderr?.on('data', (dta) => {
      const s = String(dta);
      if (s.toLowerCase().includes('bootstrapped 100%')) {
        helperReady = true;
      }
      try { fs.appendFileSync(logFile, s); } catch {}
    });
    helperProc.on('error', (e) => log('helper error', e.message));
    helperProc.on('exit', (code) => {
      log('helper exit', code);
      helperProc = null;
      helperReady = false;
      ownHelper = false;
      routingActive = false;
    });
    ownHelper = true;
  } catch (e) {
    log('spawn failed', e.message);
    return false;
  }

  for (let i = 0; i < 50; i++) {
    await new Promise(r => setTimeout(r, 1000));
    if (helperReady) {
      log('helper bootstrapped 100% on', helperPort);
      return true;
    }
    if (i > 8 && helperProc && helperProc.exitCode !== null) {
      log('helper exited early');
      return false;
    }
    if (i % 5 === 0) log(`helper bootstrapping... ${i + 1}s`);
  }
  // Fallback: if port is open even though no log, consider ready (Tor Browser already running case)
  if (await canConnect('127.0.0.1', helperPort, 800)) {
    helperReady = true;
    log('helper port open, assuming ready on', helperPort);
    return true;
  }
  log('helper timeout (not bootstrapped)');
  return false;
}

async function setupPrivacyRouting() {
  const proxy = helperPort === 9050 ? LOCAL_SOCKS_ALT : LOCAL_SOCKS;
  const proxyRules = proxy;
  const proxyBypassRules = '<-loopback>';
  try {
    const partitions = ['persist:main', 'persist:private', 'private'];
    for (const part of partitions) {
      try {
        const ses = session.fromPartition(part);
        if (ses.setProxy) await ses.setProxy({ proxyRules, proxyBypassRules });
      } catch {}
    }
    if (session.defaultSession.setProxy) await session.defaultSession.setProxy({ proxyRules, proxyBypassRules });
    log('privacy routing enabled', proxyRules, 'bypass', proxyBypassRules, 'for', partitions.join(','));
    routingActive = true;
    return true;
    return true;
  } catch (e) {
    log('setProxy failed', e.message);
    return false;
  }
}

async function clearPrivacyRouting() {
  try {
    const partitions = ['persist:main', 'persist:private', 'private'];
    for (const part of partitions) {
      try {
        const ses = session.fromPartition(part);
        if (ses.setProxy) await ses.setProxy({ proxyRules: '', proxyBypassRules: '' });
      } catch {}
    }
    if (session.defaultSession.setProxy) await session.defaultSession.setProxy({ proxyRules: '', proxyBypassRules: '' });
    log('privacy routing cleared');
    routingActive = false;
    return true;
  } catch (e) {
    log('clear proxy failed', e.message);
    return false;
  }
}

function sendControl(cmd) {
  return new Promise((resolve) => {
    const s = new net.Socket();
    let buf = '';
    let done = false;
    const finish = (ok, data) => {
      if (done) return;
      done = true;
      try { s.destroy(); } catch {}
      resolve({ ok, data });
    };
    s.setTimeout(4000);
    s.once('timeout', () => finish(false, 'timeout'));
    s.once('error', (e) => finish(false, e.message));
    s.connect(ctrlPort, '127.0.0.1', () => {
      s.write(`AUTHENTICATE ""\r\n`);
    });
    s.on('data', (dta) => {
      buf += String(dta);
      if (buf.includes('250 OK') && buf.includes('AUTHENTICATE')) {
        buf = '';
        s.write(cmd + '\r\n');
      } else if (buf.includes('250 OK') && buf.includes('SIGNAL')) {
        finish(true, buf);
      } else if (buf.includes('515') || buf.includes('552') || buf.includes('510')) {
        finish(false, buf);
      }
    });
  });
}

async function requestNewCircuit() {
  const r = await sendControl('SIGNAL NEWNYM');
  if (r.ok) {
    log('new circuit ok');
    await new Promise(res => setTimeout(res, 800));
    return { success: true, message: 'New circuit established' };
  }
  try {
    const dataDir = path.join(app.getPath('userData'), D_PRIV, D_DATA_L);
    const cookiePath = path.join(dataDir, D_CTRL_COOKIE);
    if (fs.existsSync(cookiePath)) {
      const cookie = fs.readFileSync(cookiePath);
      const hex = cookie.toString('hex');
      const s2 = new net.Socket();
      let buf2 = '';
      const res2 = await new Promise((resolve) => {
        let done = false;
        const finish = (ok, data) => {
          if (done) return;
          done = true;
          try { s2.destroy(); } catch {}
          resolve({ ok, data });
        };
        s2.setTimeout(3000);
        s2.once('timeout', () => finish(false, 'timeout'));
        s2.once('error', (e) => finish(false, e.message));
        s2.connect(ctrlPort, '127.0.0.1', () => {
          s2.write(`AUTHENTICATE ${hex}\r\n`);
        });
        s2.on('data', (dta) => {
          buf2 += String(dta);
          if (buf2.includes('250 OK') && buf2.includes('AUTHENTICATE')) {
            buf2 = '';
            s2.write('SIGNAL NEWNYM\r\n');
          } else if (buf2.includes('250 OK') && buf2.includes('SIGNAL')) {
            finish(true, buf2);
          } else if (buf2.includes('515') || buf2.includes('552')) {
            finish(false, buf2);
          }
        });
      });
      if (res2.ok) return { success: true, message: 'New circuit (cookie auth)' };
      return { success: false, error: res2.data || 'control failed' };
    }
  } catch (e) {
    return { success: false, error: e.message };
  }
  return { success: false, error: r.data || 'NEWNYM failed' };
}

function getHelperStatus() {
  return { ready: helperReady, port: helperPort, ctrlPort, hasProc: !!helperProc, ownHelper, routingActive };
}

function isRoutingActive() {
  return routingActive;
}

// Реальный % bootstrap через control port (cookie auth).
// Возвращает 0-100, либо -1 (неизвестно: нет cookie / нет доступа / чужой процесс).
async function getBootstrapPercent() {
  try {
    const dataDir = path.join(app.getPath('userData'), D_PRIV, D_DATA_L);
    const cookiePath = path.join(dataDir, D_CTRL_COOKIE);
    if (!fs.existsSync(cookiePath)) return -1;
    const hex = fs.readFileSync(cookiePath).toString('hex');
    const port = ctrlPort;
    return await new Promise((resolve) => {
      const s = new net.Socket();
      let buf = '';
      let step = 0;
      let done = false;
      const finish = (val) => {
        if (done) return;
        done = true;
        try { s.destroy(); } catch {}
        resolve(val);
      };
      s.setTimeout(1500);
      s.once('timeout', () => finish(-1));
      s.once('error', () => finish(-1));
      s.connect(port, '127.0.0.1', () => { s.write(`AUTHENTICATE ${hex}\r\n`); });
      s.on('data', (dta) => {
        buf += String(dta);
        if (step === 0 && buf.includes('250 OK')) {
          step = 1;
          buf = '';
          s.write('GETINFO status/bootstrap-phase\r\n');
        } else if (step === 1 && buf.includes('bootstrap-phase=')) {
          const m = buf.match(/PROGRESS=(\d+)/i);
          finish(m ? parseInt(m[1], 10) : -1);
        } else if (buf.includes('515') || buf.includes('552') || buf.includes('510')) {
          finish(-1);
        }
      });
    });
  } catch {
    return -1;
  }
}

function killHelper() {
  try {
    if (helperProc) {
      try { helperProc.kill(); } catch {}
      helperProc = null;
    }
  } catch {}
  helperReady = false;
  ownHelper = false;
  routingActive = false;
}

module.exports = {
  launchHelper,
  isHelperRunning,
  setupPrivacyRouting,
  clearPrivacyRouting,
  requestNewCircuit,
  getHelperStatus,
  getBootstrapPercent,
  isRoutingActive,
  killHelper,
  canConnect,
  findHelperBinary,
};
