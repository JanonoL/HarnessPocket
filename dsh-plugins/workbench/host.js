const MAX_READ = 128 * 1024;
const SCAN_MAX_FILES = 2500;
const SCAN_MAX_DIRS = 400;
const SCAN_MAX_DEPTH = 4;

const IMG = { png:1, jpg:1, jpeg:1, gif:1, webp:1, svg:1, avif:1, bmp:1, ico:1 };
const VID = { mp4:1, webm:1, mov:1, mkv:1, avi:1, m4v:1 };
const AUD = { mp3:1, wav:1, ogg:1, m4a:1, flac:1, aac:1 };
const DOC = { md:1, txt:1, pdf:1, doc:1, docx:1, ppt:1, pptx:1, xls:1, xlsx:1, csv:1, rtf:1 };
const CODE = { js:1, ts:1, jsx:1, tsx:1, py:1, go:1, rs:1, java:1, c:1, cc:1, cpp:1, h:1, hpp:1, rb:1, php:1, html:1, css:1, scss:1, vue:1, sql:1, sh:1, bat:1, ps1:1, yml:1, yaml:1, toml:1, json:1, xml:1 };
const SKIP_DIRS = { node_modules:1, '.git':1, '.next':1, '.nuxt':1, '.cache':1, '.venv':1, venv:1, __pycache__:1, target:1, '.idea':1, '.vscode':1 };

function extOf(name) {
  if (typeof name !== 'string') return '';
  const i = name.lastIndexOf('.');
  if (i < 0 || i === name.length - 1) return '';
  return name.slice(i + 1).toLowerCase();
}

function mimeFor(name) {
  const ext = extOf(name);
  const map = {
    html:'text/html', htm:'text/html', css:'text/css', js:'text/javascript', mjs:'text/javascript',
    json:'application/json', svg:'image/svg+xml', md:'text/markdown', txt:'text/plain', xml:'text/xml',
    png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg', gif:'image/gif', webp:'image/webp', avif:'image/avif', bmp:'image/bmp', ico:'image/x-icon',
    mp4:'video/mp4', webm:'video/webm', mov:'video/quicktime', mkv:'video/x-matroska', m4v:'video/mp4',
    mp3:'audio/mpeg', wav:'audio/wav', ogg:'audio/ogg', m4a:'audio/mp4', flac:'audio/flac', aac:'audio/aac',
    pdf:'application/pdf', woff2:'font/woff2', woff:'font/woff', ttf:'font/ttf', otf:'font/otf', map:'application/json', wasm:'application/wasm'
  };
  return map[ext] || 'application/octet-stream';
}

function isTextMime(mime) {
  return mime.indexOf('text/') === 0 || mime === 'application/json' || mime === 'application/javascript';
}

function capFor(mime) {
  if (mime.indexOf('video/') === 0) return 512 * 1024 * 1024;
  if (mime.indexOf('audio/') === 0) return 128 * 1024 * 1024;
  if (mime.indexOf('image/') === 0) return 50 * 1024 * 1024;
  return 32 * 1024 * 1024;
}

function errText(err) {
  if (err && typeof err === 'object' && typeof err.message === 'string') return err.message;
  return String(err);
}

function extractText(content) {
  const out = [];
  const walk = (arr) => {
    if (!Array.isArray(arr)) return;
    for (const b of arr) {
      if (!b || typeof b !== 'object') continue;
      if (b.type === 'text' && typeof b.text === 'string') out.push(b.text);
      if (Array.isArray(b.content)) walk(b.content);
    }
  };
  walk(content);
  return out.join('\n');
}

function argField(argsStr, keys) {
  try {
    const o = JSON.parse(argsStr);
    if (o && typeof o === 'object') {
      for (const k of keys) if (typeof o[k] === 'string') return o[k];
    }
  } catch (e) {}
  return '';
}

return {
  apply(ctx) {
    const fs = ctx.get('fs');
    const agents = ctx.get('agents');
    const jobs = ctx.get('jobs');
    const webServer = ctx.get('webServer');
    const workspaceRegistry = ctx.get('workspaceRegistry');
    const shell = ctx.get('shell');
    const sessionQuery = ctx.get('sessionQuery');

    if (fs === undefined) {
      console.error('[wb] fs service unavailable');
      return;
    }

    const workspacesJson = () => {
      if (workspaceRegistry === undefined || typeof workspaceRegistry.list !== 'function') return [];
      const out = [];
      for (const w of workspaceRegistry.list()) {
        if (!w || typeof w.path !== 'string') continue;
        out.push({
          id: (typeof w.id === 'string') ? w.id : '',
          title: (typeof w.title === 'string') ? w.title : '',
          path: w.path,
          updatedAt: (typeof w.updatedAt === 'string') ? w.updatedAt : '',
          sessionCount: (Array.isArray(w.sessionIds) ? w.sessionIds.length : 0),
        });
      }
      out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
      return out;
    };

    const workspaceById = (id) => {
      if (workspaceRegistry === undefined || typeof workspaceRegistry.list !== 'function') return undefined;
      for (const w of workspaceRegistry.list()) {
        if (w && typeof w.id === 'string' && w.id === id && typeof w.path === 'string') return w;
      }
      return undefined;
    };

    harness.handle('fs.list', async (args) => {
      try {
        const path = (args && typeof args.path === 'string') ? args.path : '';
        if (path === '') return { ok: false, error: 'path is required' };
        const target = await fs.resolve(path);
        const info = await fs.stat(target);
        if (info === undefined) return { ok: false, error: 'not found: ' + path };
        if (info.type !== 'directory') return { ok: false, error: 'not a directory: ' + path };
        const all = await fs.listDir(target);
        let parent = null;
        try {
          const parentTarget = await fs.resolve('..', { cwd: path });
          parent = (parentTarget && typeof parentTarget.displayPath === 'string') ? parentTarget.displayPath : null;
        } catch (e) { parent = null; }
        const mapped = all.map((e) => ({
          name: (typeof e.name === 'string') ? e.name : '',
          type: (e.type === 'directory' || e.type === 'file') ? e.type : 'other',
          size: (typeof e.size === 'number') ? e.size : null,
          path: (e.target && typeof e.target.displayPath === 'string') ? e.target.displayPath : null,
        }));
        mapped.sort((a, b) => {
          const ad = a.type === 'directory' ? 0 : 1;
          const bd = b.type === 'directory' ? 0 : 1;
          if (ad !== bd) return ad - bd;
          return a.name.localeCompare(b.name);
        });
        const total = mapped.length;
        const entries = mapped.slice(0, 1000);
        return {
          ok: true,
          path: (typeof target.displayPath === 'string') ? target.displayPath : path,
          parent: parent,
          total: total,
          truncated: total > entries.length,
          entries: entries,
        };
      } catch (err) {
        return { ok: false, error: errText(err) };
      }
    });

    harness.handle('fs.read', async (args) => {
      try {
        const path = (args && typeof args.path === 'string') ? args.path : '';
        if (path === '') return { ok: false, error: 'path is required' };
        const target = await fs.resolve(path);
        const info = await fs.stat(target);
        if (info === undefined) return { ok: false, error: 'not found: ' + path };
        if (info.type !== 'file') return { ok: false, error: 'not a file: ' + path };
        const displayPath = (typeof target.displayPath === 'string') ? target.displayPath : path;
        if (typeof info.size === 'number' && info.size > MAX_READ) {
          return { ok: true, path: displayPath, size: info.size, tooLarge: true, text: '' };
        }
        let text;
        try {
          text = await fs.readText(target);
        } catch (e) {
          const code = (e && typeof e === 'object') ? e.code : undefined;
          if (code === 'FS_NOT_TEXT') return { ok: false, error: 'binary file (not UTF-8 text)' };
          if (code === 'FS_TOO_LARGE') return { ok: true, path: displayPath, size: info.size, tooLarge: true, text: '' };
          throw e;
        }
        return { ok: true, path: displayPath, size: (typeof info.size === 'number') ? info.size : text.length, tooLarge: false, text: text };
      } catch (err) {
        return { ok: false, error: errText(err) };
      }
    });

    harness.handle('ws.list', async () => {
      try {
        return { ok: true, workspaces: workspacesJson() };
      } catch (err) {
        return { ok: false, error: errText(err) };
      }
    });

    harness.handle('ws.scan', async (args) => {
      try {
        const id = (args && typeof args.id === 'string') ? args.id : '';
        const ws = workspaceById(id);
        if (ws === undefined) return { ok: false, error: 'workspace not found: ' + id };
        const root = ws.path;
        const base = '/wb/p/' + encodeURIComponent(id);
        const images = [], videos = [], audios = [], documents = [], code = [];
        let site = null;
        let fileCount = 0, dirCount = 0;
        const queue = [{ rel: '', depth: 0 }];
        while (queue.length > 0 && fileCount < SCAN_MAX_FILES && dirCount < SCAN_MAX_DIRS) {
          const item = queue.shift();
          const dirPath = item.rel === '' ? root : root + '/' + item.rel;
          let entries;
          try {
            entries = await fs.listDir(await fs.resolve(dirPath));
          } catch (e) { continue; }
          for (const e of entries) {
            if (fileCount >= SCAN_MAX_FILES) break;
            if (typeof e.name !== 'string') continue;
            if (e.type === 'directory') {
              if (SKIP_DIRS[e.name]) continue;
              if (item.depth + 1 <= SCAN_MAX_DEPTH) {
                dirCount++;
                queue.push({ rel: item.rel === '' ? e.name : item.rel + '/' + e.name, depth: item.depth + 1 });
              }
            } else if (e.type === 'file') {
              fileCount++;
              const rel = item.rel === '' ? e.name : item.rel + '/' + e.name;
              const ext = extOf(e.name);
              const size = (typeof e.size === 'number') ? e.size : null;
              const url = base + '/' + rel.split('/').map(encodeURIComponent).join('/');
              const rec = { name: e.name, relPath: rel, size: size, url: url };
              if (ext === 'html' && e.name.toLowerCase() === 'index.html') {
                if (site === null) site = { relPath: rel, url: url };
              }
              if (IMG[ext]) { if (images.length < 200) images.push(rec); }
              else if (VID[ext]) { if (videos.length < 80) videos.push(rec); }
              else if (AUD[ext]) { if (audios.length < 80) audios.push(rec); }
              else if (DOC[ext]) { if (documents.length < 200) documents.push(rec); }
              else if (CODE[ext]) { if (code.length < 200) code.push(rec); }
            }
          }
        }
        return {
          ok: true,
          id: id,
          path: root,
          title: (typeof ws.title === 'string') ? ws.title : '',
          site: site,
          counts: { images: images.length, videos: videos.length, audios: audios.length, documents: documents.length, code: code.length },
          images: images, videos: videos, audios: audios, documents: documents, code: code,
          scannedFiles: fileCount,
        };
      } catch (err) {
        return { ok: false, error: errText(err) };
      }
    });

    if (shell !== undefined && typeof shell.run === 'function') {
      const runShell = async (command, workdir, timeoutMs, stdoutMaxBytes) => {
        const spec = shell.resolve({ command: command, workdir: workdir, timeoutMs: timeoutMs, stdoutMaxBytes: stdoutMaxBytes });
        return await shell.run(spec);
      };

      harness.handle('ws.changes', async (args) => {
        try {
          const id = (args && typeof args.id === 'string') ? args.id : '';
          const ws = workspaceById(id);
          if (ws === undefined) return { ok: false, error: 'workspace not found: ' + id };
          const root = ws.path;
          const res = { ok: true, id: id, path: root, isGit: false, changedFiles: [], diffStat: '', diff: '', diffTruncated: false, recentCommits: [], recentFiles: [] };
          let check;
          try { check = await runShell('git rev-parse --is-inside-work-tree', root, 10000, 4096); } catch (e) { check = undefined; }
          if (check && check.exitCode === 0 && (check.stdout.text || '').trim() === 'true') {
            res.isGit = true;
            try {
              const s = await runShell('git status --porcelain', root, 15000, 256 * 1024);
              if (s.exitCode === 0) {
                res.changedFiles = (s.stdout.text || '').split('\n').filter(Boolean).map((line) => ({ status: line.slice(0, 2), path: line.slice(3) })).slice(0, 500);
              }
            } catch (e) {}
            try {
              const s = await runShell('git -c color.ui=false diff --stat HEAD', root, 20000, 256 * 1024);
              if (s.exitCode === 0) res.diffStat = s.stdout.text || '';
            } catch (e) {}
            try {
              const s = await runShell('git -c color.ui=false diff HEAD --', root, 30000, 1024 * 1024);
              if (s.exitCode === 0) {
                res.diff = s.stdout.text || '';
                res.diffTruncated = !!(s.stdout && s.stdout.truncated);
              }
            } catch (e) {}
            try {
              const s = await runShell('git log --oneline -10', root, 15000, 64 * 1024);
              if (s.exitCode === 0) res.recentCommits = (s.stdout.text || '').split('\n').filter(Boolean);
            } catch (e) {}
          } else {
            try {
              const cmd = "Get-ChildItem -Recurse -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 40 | ForEach-Object { '{0:yyyy-MM-dd HH:mm:ss}  {1}' -f $_.LastWriteTime, $_.FullName }";
              const s = await runShell(cmd, root, 20000, 256 * 1024);
              if (s.exitCode === 0) res.recentFiles = (s.stdout.text || '').split('\n').filter(Boolean);
            } catch (e) {}
          }
          return res;
        } catch (err) {
          return { ok: false, error: errText(err) };
        }
      });
    }

    harness.handle('conv.report', async (args) => {
      try {
        const sessionId = (args && typeof args.sessionId === 'string') ? args.sessionId : '';
        if (sessionId === '') return { ok: false, error: 'sessionId is required' };
        if (sessionQuery === undefined || typeof sessionQuery.readSession !== 'function') return { ok: false, error: 'sessionQuery unavailable' };
        const snap = await sessionQuery.readSession(sessionId);
        const events = (snap && Array.isArray(snap.events)) ? snap.events : [];
        const summaries = [];
        const fileChanges = [];
        const runs = [];
        const callIndex = {};
        const capStr = (s, n) => (typeof s !== 'string' || s.length <= n) ? s : s.slice(0, n) + '…';
        for (const ev of events) {
          if (!ev || typeof ev !== 'object') continue;
          const d = ev.data;
          if (ev.type === 'assistant/message' && d && d.message) {
            const t = extractText(d.message.content);
            if (t.trim() !== '') summaries.push(t);
          } else if (ev.type === 'tool/call' && d) {
            callIndex[d.callId] = { name: (typeof d.name === 'string') ? d.name : '', arguments: (typeof d.arguments === 'string') ? d.arguments : '' };
          } else if (ev.type === 'tool/result' && d) {
            const call = callIndex[d.callId];
            if (!call) continue;
            const outText = extractText(d.message && d.message.content);
            const isError = !!(d.error);
            if (call.name === 'bash' || call.name === 'pwsh' || call.name === 'shell') {
              runs.push({ tool: call.name, command: capStr(argField(call.arguments, ['command']), 2000), output: capStr(outText, 20000), error: isError });
            } else if (call.name === 'write' || call.name === 'edit') {
              const p = argField(call.arguments, ['file_path', 'filePath', 'path']);
              if (p !== '') fileChanges.push(p);
            }
          }
        }
        return {
          ok: true,
          sessionId: sessionId,
          summary: summaries.length > 0 ? capStr(summaries[summaries.length - 1], 20000) : '',
          summaryCount: summaries.length,
          fileChanges: fileChanges.slice(-100),
          runs: runs.slice(-40),
        };
      } catch (err) {
        return { ok: false, error: errText(err) };
      }
    });

    if (jobs !== undefined) {
      const snapshotJson = (j) => ({
        id: (typeof j.id === 'string') ? j.id : '',
        kind: (typeof j.kind === 'string') ? j.kind : '',
        label: (typeof j.label === 'string') ? j.label : '',
        status: (typeof j.status === 'string') ? j.status : '',
        detail: (typeof j.detail === 'string') ? j.detail : null,
        startedAt: (typeof j.startedAt === 'number') ? j.startedAt : null,
        finishedAt: (typeof j.finishedAt === 'number') ? j.finishedAt : null,
        ownerSession: (typeof j.ownerSession === 'string') ? j.ownerSession : null,
      });

      harness.handle('jobs.list', async () => {
        try {
          const seen = {};
          const out = [];
          const push = (j) => {
            if (!j || typeof j.id !== 'string' || seen[j.id]) return;
            seen[j.id] = true;
            out.push(snapshotJson(j));
          };
          for (const j of jobs.list()) push(j);
          if (agents !== undefined && typeof agents.list === 'function') {
            for (const a of agents.list()) {
              let owned;
              try { owned = jobs.list(a); } catch (e) { owned = []; }
              for (const j of owned) push(j);
            }
          }
          return { ok: true, jobs: out };
        } catch (err) {
          return { ok: false, error: errText(err) };
        }
      });

      const callerFor = (ownerSession) => {
        if (ownerSession !== null && ownerSession !== undefined && typeof ownerSession === 'string' && agents !== undefined && typeof agents.get === 'function') {
          return agents.get(ownerSession);
        }
        return undefined;
      };

      harness.handle('jobs.read', async (args) => {
        try {
          const id = (args && typeof args.id === 'string') ? args.id : '';
          if (id === '') return { ok: false, error: 'job id is required' };
          const ownerSession = (args && typeof args.ownerSession === 'string') ? args.ownerSession : null;
          const read = jobs.read(id, callerFor(ownerSession));
          const text = (typeof read.text === 'string') ? read.text : '';
          const snap = read.snapshot || {};
          return { ok: true, text: text, snapshot: snapshotJson(snap) };
        } catch (err) {
          return { ok: false, error: errText(err) };
        }
      });

      harness.handle('jobs.kill', async (args) => {
        try {
          const id = (args && typeof args.id === 'string') ? args.id : '';
          if (id === '') return { ok: false, error: 'job id is required' };
          const ownerSession = (args && typeof args.ownerSession === 'string') ? args.ownerSession : null;
          const result = jobs.kill(id, callerFor(ownerSession));
          return { ok: true, result: (typeof result === 'string') ? result : String(result) };
        } catch (err) {
          return { ok: false, error: errText(err) };
        }
      });
    }

    if (webServer !== undefined && typeof webServer.register === 'function') {
      const route = {
        kind: 'prefix',
        path: '/wb/p',
        handler: async (req, res) => {
          try {
            const raw = (req && typeof req.url === 'string') ? req.url : '';
            const pathname = raw.split('?')[0] || '';
            const parts = pathname.split('/').filter((s) => s.length > 0);
            if (parts.length < 3 || parts[0] !== 'wb' || parts[1] !== 'p') {
              res.writeHead(404, { 'content-type': 'text/plain' });
              res.end('not found');
              return;
            }
            let wsId;
            try { wsId = decodeURIComponent(parts[2]); } catch (e) { wsId = parts[2]; }
            const ws = workspaceById(wsId);
            if (ws === undefined) {
              res.writeHead(404, { 'content-type': 'text/plain' });
              res.end('workspace not found');
              return;
            }
            let rel = '';
            if (parts.length > 3) {
              rel = parts.slice(3).map((s) => { try { return decodeURIComponent(s); } catch (e) { return s; } }).join('/');
            }
            const fullPath = rel === '' ? ws.path : ws.path + '/' + rel;
            const wsTarget = await fs.resolve(ws.path);
            const target = await fs.resolve(fullPath);
            if (!fs.contains(wsTarget, target)) {
              res.writeHead(403, { 'content-type': 'text/plain' });
              res.end('forbidden');
              return;
            }
            const info = await fs.stat(target);
            if (info === undefined) {
              res.writeHead(404, { 'content-type': 'text/plain' });
              res.end('not found');
              return;
            }
            let servePath = fullPath;
            if (info.type === 'directory') {
              const idxPath = fullPath.replace(/[\\/]+$/, '') + '/index.html';
              const idxTarget = await fs.resolve(idxPath);
              const idxInfo = await fs.stat(idxTarget);
              if (idxInfo !== undefined && idxInfo.type === 'file') {
                servePath = idxPath;
              } else {
                res.writeHead(404, { 'content-type': 'text/plain' });
                res.end('no index.html');
                return;
              }
            } else if (info.type !== 'file') {
              res.writeHead(404, { 'content-type': 'text/plain' });
              res.end('not a file');
              return;
            }
            const serveTarget = await fs.resolve(servePath);
            const serveInfo = await fs.stat(serveTarget);
            if (serveInfo === undefined) {
              res.writeHead(404, { 'content-type': 'text/plain' });
              res.end('not found');
              return;
            }
            const lastSeg = servePath.split('/').pop() || '';
            const name = lastSeg.split('\\').pop() || '';
            const mime = mimeFor(name);
            if (isTextMime(mime)) {
              const text = await fs.readText(serveTarget);
              const bytes = new TextEncoder().encode(text);
              res.writeHead(200, { 'content-type': mime + '; charset=utf-8', 'content-length': String(bytes.byteLength), 'cache-control': 'no-cache' });
              res.end(text);
            } else {
              const cap = capFor(mime);
              if (typeof serveInfo.size === 'number' && serveInfo.size > cap) {
                res.writeHead(413, { 'content-type': 'text/plain' });
                res.end('file too large for inline preview');
                return;
              }
              const bytes = await fs.readBytes(serveTarget, undefined, cap);
              res.writeHead(200, { 'content-type': mime, 'content-length': String(bytes.byteLength), 'cache-control': 'no-cache' });
              res.end(bytes);
            }
          } catch (err) {
            try {
              res.writeHead(500, { 'content-type': 'text/plain' });
              res.end(errText(err));
            } catch (e2) { /* socket gone */ }
          }
        },
      };
      ctx.effect(() => webServer.register(route));
    }
  },
};
