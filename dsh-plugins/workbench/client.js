const css = `
.wb-root{position:fixed;inset:0;z-index:2147483000;pointer-events:none;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;}
.wb-panel{position:fixed;pointer-events:auto;background:var(--dsw-alias-bg-layer-1,#1e1e1e);border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.12));color:var(--dsw-alias-label-primary,#e8e8e8);box-shadow:0 8px 40px rgba(0,0,0,.5);display:flex;flex-direction:column;overflow:hidden;}
@media (max-width:700px){ .wb-panel{left:0;right:0;bottom:0;top:8%;border-radius:16px 16px 0 0;} }
@media (min-width:701px){ .wb-panel{top:0;right:0;bottom:0;width:460px;max-width:94vw;border-radius:0;} }
.wb-head{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.12));flex:none;}
.wb-title{font-weight:600;font-size:14px;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.wb-close{border:none;background:transparent;color:var(--dsw-alias-label-secondary,#aaa);font-size:18px;cursor:pointer;padding:4px 8px;border-radius:6px;}
.wb-close:hover{background:var(--dsw-alias-bg-layer-2,rgba(255,255,255,.08));}
.wb-tabs{display:flex;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.12));flex:none;}
.wb-tab{flex:1;padding:10px 4px;text-align:center;font-size:13px;font-weight:500;color:var(--dsw-alias-label-secondary,#aaa);background:none;border:none;cursor:pointer;border-bottom:2px solid transparent;}
.wb-tab.active{color:var(--dsw-alias-label-primary,#e8e8e8);border-bottom-color:var(--dsw-alias-brand-primary,#3b82f6);}
.wb-body{flex:1;overflow:auto;display:flex;flex-direction:column;min-height:0;}
.wb-toolbar{display:flex;gap:6px;padding:8px 10px;align-items:center;flex:none;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08));}
.wb-path{flex:1;font-size:12px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:var(--dsw-alias-label-secondary,#aaa);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;direction:rtl;text-align:left;}
.wb-btn{border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.15));background:var(--dsw-alias-bg-layer-2,rgba(255,255,255,.06));color:var(--dsw-alias-label-primary,#e8e8e8);font-size:12px;padding:5px 9px;border-radius:6px;cursor:pointer;white-space:nowrap;text-decoration:none;display:inline-block;}
.wb-btn:active{opacity:.8;}
.wb-btn.primary{background:var(--dsw-alias-brand-primary,#3b82f6);border-color:transparent;color:#fff;}
.wb-btn.danger{color:var(--dsw-alias-state-error-primary,#f87171);border-color:rgba(248,113,113,.4);}
.wb-input{flex:1;font-size:12px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;background:var(--dsw-alias-bg-layer-2,rgba(255,255,255,.06));border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.15));color:var(--dsw-alias-label-primary,#e8e8e8);padding:5px 8px;border-radius:6px;}
.wb-error{color:var(--dsw-alias-state-error-primary,#f87171);font-size:12px;padding:10px 12px;word-break:break-all;}
.wb-empty{color:var(--dsw-alias-label-secondary,#aaa);font-size:12px;padding:16px 12px;text-align:center;}
.wb-list{flex:1;overflow:auto;}
.wb-row{display:flex;align-items:center;gap:8px;padding:8px 12px;font-size:13px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.05));cursor:pointer;}
.wb-row:hover{background:var(--dsw-alias-bg-layer-2,rgba(255,255,255,.05));}
.wb-icon{width:18px;text-align:center;flex:none;}
.wb-name{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.wb-size{font-size:11px;color:var(--dsw-alias-label-secondary,#aaa);flex:none;}
.wb-back{display:flex;align-items:center;gap:6px;padding:8px 12px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08));flex:none;font-size:13px;color:var(--dsw-alias-brand-primary,#60a5fa);cursor:pointer;background:none;border-left:none;border-right:none;border-top:none;width:100%;text-align:left;}
.wb-code{flex:1;overflow:auto;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;line-height:1.5;}
.wb-code-line{display:flex;}
.wb-lineno{flex:none;width:44px;text-align:right;padding-right:10px;color:var(--dsw-alias-label-secondary,#666);user-select:none;background:var(--dsw-alias-bg-layer-2,rgba(255,255,255,.03));}
.wb-linetext{flex:1;white-space:pre-wrap;word-break:break-all;padding-right:12px;}
.wb-filehead{font-size:12px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:var(--dsw-alias-label-secondary,#aaa);padding:8px 12px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08));word-break:break-all;flex:none;}
.wb-job{padding:9px 12px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.06));cursor:pointer;}
.wb-job:hover{background:var(--dsw-alias-bg-layer-2,rgba(255,255,255,.05));}
.wb-job-top{display:flex;align-items:center;gap:8px;}
.wb-job-label{flex:1;min-width:0;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.wb-badge{font-size:10px;padding:2px 7px;border-radius:999px;flex:none;text-transform:uppercase;letter-spacing:.02em;}
.wb-badge.running{background:rgba(59,130,246,.18);color:#60a5fa;}
.wb-badge.completed{background:rgba(34,197,94,.16);color:#4ade80;}
.wb-badge.failed{background:rgba(239,68,68,.18);color:#f87171;}
.wb-badge.killed{background:rgba(239,68,68,.14);color:#fca5a5;}
.wb-badge.stopping{background:rgba(234,179,8,.16);color:#fbbf24;}
.wb-job-meta{font-size:11px;color:var(--dsw-alias-label-secondary,#aaa);margin-top:3px;display:flex;gap:10px;flex-wrap:wrap;}
.wb-out{padding:10px 12px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;white-space:pre-wrap;word-break:break-word;}
.wb-wscard{padding:12px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.06));cursor:pointer;}
.wb-wscard:hover{background:var(--dsw-alias-bg-layer-2,rgba(255,255,255,.05));}
.wb-ws-title{font-size:14px;font-weight:600;}
.wb-ws-path{font-size:11px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:var(--dsw-alias-label-secondary,#aaa);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.wb-ws-meta{font-size:11px;color:var(--dsw-alias-label-secondary,#aaa);margin-top:4px;}
.wb-sec{font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary,#bbb);padding:10px 12px 6px;flex:none;}
.wb-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;padding:0 12px 8px;}
.wb-thumb{position:relative;aspect-ratio:1/1;overflow:hidden;border-radius:8px;border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.1));background:var(--dsw-alias-bg-layer-2,rgba(255,255,255,.04));cursor:pointer;}
.wb-thumb img{width:100%;height:100%;object-fit:cover;display:block;}
.wb-media-row{display:flex;align-items:center;gap:10px;padding:8px 12px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.05));cursor:pointer;font-size:13px;}
.wb-media-row:hover{background:var(--dsw-alias-bg-layer-2,rgba(255,255,255,.05));}
.wb-preview{flex:1;display:flex;flex-direction:column;min-height:0;}
.wb-preview-stage{flex:1;display:flex;align-items:center;justify-content:center;overflow:auto;background:#000;min-height:0;}
.wb-preview-stage img,.wb-preview-stage video{max-width:100%;max-height:100%;}
.wb-preview-stage iframe{width:100%;height:100%;border:none;background:#fff;}
.wb-audio{padding:16px 12px;}
.wb-note{font-size:12px;color:var(--dsw-alias-label-secondary,#aaa);padding:10px 12px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.06));}
.wb-run{border-bottom:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.06));padding:8px 12px;}
.wb-sb{display:flex;align-items:center;justify-content:flex-start;gap:8px;background:none;border:none;color:var(--dsw-alias-label-primary,#e8e8e8);cursor:pointer;padding:6px 8px;border-radius:6px;width:100%;font-size:13px;}
.wb-sb:hover{background:var(--dsw-alias-bg-layer-2,rgba(255,255,255,.08));}
.wb-sb-ico{font-size:16px;line-height:1;}
`;

let panelOpen = true;
const panelSubs = [];
function emitPanel() { for (const fn of panelSubs.slice()) fn(); }
function togglePanel() { panelOpen = !panelOpen; emitPanel(); }
function closePanel() { if (panelOpen) { panelOpen = false; emitPanel(); } }
function usePanelOpen() {
  const [v, setV] = React.useState(panelOpen);
  React.useEffect(function () {
    const fn = function () { setV(panelOpen); };
    panelSubs.push(fn);
    return function () { const i = panelSubs.indexOf(fn); if (i >= 0) panelSubs.splice(i, 1); };
  }, []);
  return v;
}

function el(type, props) {
  const children = Array.prototype.slice.call(arguments, 2);
  return React.createElement.apply(React, [type, props].concat(children));
}

function fmtSize(n) {
  if (n === null || n === undefined) return '';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1024 / 1024).toFixed(1) + ' MB';
}

function fmtTime(ms) {
  if (ms === null || ms === undefined) return '';
  const d = new Date(ms);
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  return h + ':' + m + ':' + s;
}

function SidebarToggle(props) {
  return el('button', { className: 'wb-sb', title: '工作台', onClick: function (e) { if (e && e.stopPropagation) e.stopPropagation(); togglePanel(); } },
    el('span', { className: 'wb-sb-ico' }, '📊'),
    (props && props.wide) ? el('span', null, '工作台') : null,
  );
}

function Workbench(props) {
  const ctx = props.ctx;
  const useSessions = props.useSessions;
  const open = usePanelOpen();
  const currentId = useSessions ? useSessions(function (s) { return s.current; }) : undefined;
  const currentCwd = useSessions ? useSessions(function (s) { return (s.current && s.byId[s.current]) ? s.byId[s.current].cwd : undefined; }) : undefined;
  const currentTitle = useSessions ? useSessions(function (s) { return (s.current && s.byId[s.current]) ? s.byId[s.current].displayTitle : undefined; }) : undefined;

  const [topTab, setTopTab] = React.useState('this');
  const [reportData, setReportData] = React.useState(null);
  const [reportForId, setReportForId] = React.useState(null);
  const [reportErr, setReportErr] = React.useState('');
  const [workspaces, setWorkspaces] = React.useState([]);
  const [wsErr, setWsErr] = React.useState('');
  const [activeWs, setActiveWs] = React.useState(null);
  const [wsTab, setWsTab] = React.useState('overview');
  const [scan, setScan] = React.useState(null);
  const [scanErr, setScanErr] = React.useState('');
  const [preview, setPreview] = React.useState(null);
  const [textPreview, setTextPreview] = React.useState(null);
  const [changes, setChanges] = React.useState(null);
  const [changesErr, setChangesErr] = React.useState('');
  const [cwd, setCwd] = React.useState(null);
  const [parent, setParent] = React.useState(null);
  const [entries, setEntries] = React.useState([]);
  const [err, setErr] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [viewing, setViewing] = React.useState(null);
  const [pathInput, setPathInput] = React.useState('');
  const [jobs, setJobs] = React.useState([]);
  const [jobsErr, setJobsErr] = React.useState('');
  const [activeJob, setActiveJob] = React.useState(null);
  const [jobsFilter, setJobsFilter] = React.useState('all');

  function normPath(p) {
    if (!p) return '';
    return p.replace(/[\\/]+$/, '').toLowerCase();
  }

  const currentWs = (currentCwd && workspaces.length > 0)
    ? (workspaces.find(function (w) { return normPath(w.path) === normPath(currentCwd); }) || null)
    : null;

  async function loadReport() {
    if (!currentId) return;
    setReportForId(currentId);
    setReportData(null);
    setReportErr('');
    const res = await host.call('conv.report', { sessionId: currentId });
    if (res && res.ok) setReportData(res);
    else setReportErr((res && res.error) || 'failed');
  }

  async function loadWorkspaces() {
    try {
      const res = await host.call('ws.list', {});
      if (res && res.ok) {
        setWorkspaces(res.workspaces || []);
        setWsErr('');
      } else {
        setWsErr((res && res.error) || 'failed');
      }
    } catch (e) {
      setWsErr(String(e && e.message ? e.message : e));
    }
  }

  async function openWorkspace(ws) {
    setActiveWs(ws);
    setWsTab('overview');
    setScan(null);
    setScanErr('');
    setPreview(null);
    setTextPreview(null);
    setChanges(null);
    setChangesErr('');
    setCwd(null);
    setViewing(null);
    const res = await host.call('ws.scan', { id: ws.id });
    if (res && res.ok) {
      setScan(res);
    } else {
      setScanErr((res && res.error) || 'scan failed');
    }
  }

  async function loadChanges() {
    if (!activeWs) return;
    setChanges(null);
    setChangesErr('');
    const res = await host.call('ws.changes', { id: activeWs.id });
    if (res && res.ok) setChanges(res);
    else setChangesErr((res && res.error) || 'failed');
  }

  async function loadDir(path) {
    setLoading(true);
    setErr('');
    setViewing(null);
    try {
      const res = await host.call('fs.list', { path: path });
      if (res && res.ok) {
        setCwd(res.path);
        setParent(res.parent);
        setPathInput(res.path);
        setEntries(res.entries || []);
      } else {
        setErr((res && res.error) || 'failed');
      }
    } catch (e) {
      setErr(String(e && e.message ? e.message : e));
    } finally {
      setLoading(false);
    }
  }

  async function openFile(path) {
    setErr('');
    setViewing({ loading: true, path: path });
    try {
      const res = await host.call('fs.read', { path: path });
      if (res && res.ok) {
        setViewing({ path: res.path, text: res.text, tooLarge: !!res.tooLarge, size: res.size, loading: false });
      } else {
        setViewing(null);
        setErr((res && res.error) || 'failed');
      }
    } catch (e) {
      setViewing(null);
      setErr(String(e && e.message ? e.message : e));
    }
  }

  async function refreshJobs() {
    try {
      const res = await host.call('jobs.list', {});
      if (res && res.ok) {
        setJobs(res.jobs || []);
        setJobsErr('');
      } else {
        setJobsErr((res && res.error) || 'failed');
      }
    } catch (e) {
      setJobsErr(String(e && e.message ? e.message : e));
    }
  }

  async function openJob(job) {
    setActiveJob({ loading: true, id: job.id, ownerSession: job.ownerSession || null });
    try {
      const res = await host.call('jobs.read', { id: job.id, ownerSession: job.ownerSession || null });
      if (res && res.ok) {
        setActiveJob({ loading: false, id: job.id, ownerSession: job.ownerSession || null, text: res.text, snapshot: res.snapshot });
      } else {
        setActiveJob(null);
        setJobsErr((res && res.error) || 'failed');
      }
    } catch (e) {
      setActiveJob(null);
      setJobsErr(String(e && e.message ? e.message : e));
    }
  }

  async function killJob(job) {
    try {
      const res = await host.call('jobs.kill', { id: job.id, ownerSession: job.ownerSession || null });
      if (res && res.ok) refreshJobs();
      else setJobsErr((res && res.error) || 'failed');
    } catch (e) {
      setJobsErr(String(e && e.message ? e.message : e));
    }
  }

  async function openTextPreview(rec) {
    setTextPreview({ loading: true, name: rec.name, path: null });
    if (!activeWs) return;
    const abs = activeWs.path + '/' + rec.relPath;
    const res = await host.call('fs.read', { path: abs });
    if (res && res.ok) {
      setTextPreview({ loading: false, name: rec.name, path: res.path, text: res.text, tooLarge: !!res.tooLarge, size: res.size });
    } else {
      setTextPreview(null);
      setScanErr((res && res.error) || 'failed');
    }
  }

  function goPath() {
    const p = (pathInput || '').trim();
    if (p !== '') loadDir(p);
  }

  React.useEffect(function () {
    if (!open) return;
    if (topTab === 'this' && currentId && reportForId !== currentId) loadReport();
    if (topTab === 'workspaces' && workspaces.length === 0) loadWorkspaces();
  }, [open, topTab, currentId, reportForId]);

  React.useEffect(function () {
    if (!open || topTab !== 'jobs') return;
    refreshJobs();
    const stop = ctx.interval(function () { refreshJobs(); }, 3000);
    return stop;
  }, [open, topTab]);

  React.useEffect(function () {
    if (!open || !activeWs) return;
    if (wsTab === 'files' && cwd === null) loadDir(activeWs.path);
    if (wsTab === 'changes' && changes === null) loadChanges();
  }, [open, activeWs, wsTab]);

  function renderSection(title) {
    return el('div', { className: 'wb-sec' }, title);
  }

  function renderThisTurn() {
    if (!currentId) {
      return el('div', { className: 'wb-empty' }, '当前没有打开的对话。到「工作区」选一个工作区开始对话。');
    }
    if (reportErr) return el('div', { className: 'wb-error' }, reportErr);
    if (!reportData) return el('div', { className: 'wb-empty' }, '正在读取本次对话结果…');
    const r = reportData;
    return el('div', { className: 'wb-list' },
      el('div', { className: 'wb-toolbar', style: { borderBottom: '1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08))' } },
        el('span', { className: 'wb-title' }, currentTitle || '本次对话'),
        el('button', { className: 'wb-btn primary', onClick: loadReport }, '刷新'),
      ),
      r.summary ? el('div', null,
        renderSection('文字说明'),
        el('div', { className: 'wb-out' }, r.summary),
      ) : null,
      el('div', null,
        renderSection('本次改动文件（' + (r.fileChanges ? r.fileChanges.length : 0) + '）'),
        (r.fileChanges && r.fileChanges.length)
          ? r.fileChanges.map(function (p, i) { return el('div', { className: 'wb-code-line', key: i }, el('span', { className: 'wb-linetext' }, '✏️ ' + p)); })
          : el('div', { className: 'wb-empty' }, '本对话未通过 write/edit 改动文件'),
      ),
      el('div', null,
        renderSection('运行 / 测试结果（' + (r.runs ? r.runs.length : 0) + '）'),
        (r.runs && r.runs.length)
          ? r.runs.map(function (run, i) {
            const ok = !run.error;
            return el('div', { className: 'wb-run', key: i },
              el('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 } },
                el('span', { className: 'wb-badge ' + (ok ? 'completed' : 'failed') }, ok ? '成功' : '失败'),
                el('span', { style: { fontFamily: 'monospace', fontSize: 12, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, run.tool + '  ' + (run.command || '')),
              ),
              run.output ? el('pre', { className: 'wb-out', style: { margin: 0, maxHeight: 200, overflow: 'auto', whiteSpace: 'pre-wrap' } }, run.output) : null,
            );
          })
          : el('div', { className: 'wb-empty' }, '本对话未运行 bash/pwsh 命令（测试/构建结果会出现在这里）'),
      ),
      el('div', { style: { padding: '10px 12px', display: 'flex', gap: 8, flexWrap: 'wrap' } },
        currentWs ? el('button', { className: 'wb-btn primary', onClick: function () { setActiveWs(currentWs); setWsTab('overview'); setTopTab('workspaces'); } }, '查看产出 →') : null,
        currentWs ? el('button', { className: 'wb-btn', onClick: function () { setActiveWs(currentWs); setWsTab('changes'); setTopTab('workspaces'); } }, '查看 git 改动 →') : null,
      ),
    );
  }

  function renderSiteCard() {
    if (!scan || !scan.site) return null;
    return el('div', null,
      renderSection('站点'),
      el('div', { style: { padding: '0 12px 8px' } },
        el('button', { className: 'wb-btn primary', onClick: function () { setPreview({ kind: 'site', title: '站点预览', url: scan.site.url }); } }, '内嵌预览网站'),
        el('a', { className: 'wb-btn', href: scan.site.url, target: '_blank', rel: 'noreferrer', style: { marginLeft: 8 } }, '新标签打开 ↗'),
      ),
    );
  }

  function renderThumbGrid() {
    if (!scan || !scan.images || scan.images.length === 0) return null;
    return el('div', null,
      renderSection('图片（' + scan.images.length + '）'),
      el('div', { className: 'wb-grid' },
        scan.images.map(function (im) {
          return el('div', { className: 'wb-thumb', key: im.url, onClick: function () { setPreview({ kind: 'image', title: im.name, url: im.url }); } },
            el('img', { src: im.url, loading: 'lazy', alt: im.name }),
          );
        }),
      ),
    );
  }

  function renderMediaList(kind, list, label) {
    if (!list || list.length === 0) return null;
    return el('div', null,
      renderSection(label + '（' + list.length + '）'),
      list.map(function (rec) {
        return el('div', { className: 'wb-media-row', key: rec.url, onClick: function () { setPreview({ kind: kind, title: rec.name, url: rec.url }); } },
          el('span', { className: 'wb-icon' }, kind === 'video' ? '🎬' : '🎵'),
          el('span', { className: 'wb-name' }, rec.name),
          el('span', { className: 'wb-size' }, fmtSize(rec.size)),
        );
      }),
    );
  }

  function renderDocuments() {
    if (!scan || !scan.documents || scan.documents.length === 0) return null;
    return el('div', null,
      renderSection('文档（' + scan.documents.length + '）'),
      scan.documents.map(function (rec) {
        const isPdf = rec.name.toLowerCase().slice(-4) === '.pdf';
        return el('div', { className: 'wb-media-row', key: rec.url, onClick: function () { isPdf ? setPreview({ kind: 'pdf', title: rec.name, url: rec.url }) : openTextPreview(rec); } },
          el('span', { className: 'wb-icon' }, isPdf ? '📕' : '📄'),
          el('span', { className: 'wb-name' }, rec.name),
          el('span', { className: 'wb-size' }, fmtSize(rec.size)),
        );
      }),
    );
  }

  function renderOverview() {
    if (scanErr) return el('div', { className: 'wb-error' }, scanErr);
    if (!scan) return el('div', { className: 'wb-empty' }, '正在扫描产出…');
    const c = scan.counts || {};
    const hasAny = scan.site || (c.images + c.videos + c.audios + c.documents + c.code) > 0;
    return el('div', { className: 'wb-list' },
      el('div', { style: { padding: '10px 12px', fontSize: 12, color: 'var(--dsw-alias-label-secondary,#aaa)' } },
        '站点 ' + (scan.site ? 1 : 0) + ' · 图片 ' + (c.images || 0) + ' · 视频 ' + (c.videos || 0) + ' · 音频 ' + (c.audios || 0) + ' · 文档 ' + (c.documents || 0) + ' · 代码 ' + (c.code || 0),
      ),
      renderSiteCard(),
      renderThumbGrid(),
      renderMediaList('video', scan.videos, '视频'),
      renderMediaList('audio', scan.audios, '音频'),
      renderDocuments(),
      scan.code && scan.code.length > 0 ? el('div', null,
        renderSection('代码（' + scan.code.length + '）'),
        el('div', { style: { padding: '0 12px 12px' } },
          el('button', { className: 'wb-btn', onClick: function () { setWsTab('files'); } }, '在文件页查看代码 →'),
        ),
      ) : null,
      !hasAny ? el('div', { className: 'wb-empty' }, '该工作区暂未识别到可预览的产出') : null,
    );
  }

  function renderDiff(diffText) {
    const lines = (diffText || '').split('\n');
    return el('div', { className: 'wb-code' },
      lines.map(function (line, i) {
        let color;
        if (line.charAt(0) === '+') color = '#4ade80';
        else if (line.charAt(0) === '-') color = '#f87171';
        else if (line.charAt(0) === '@') color = '#60a5fa';
        return el('div', { className: 'wb-code-line', key: i },
          el('span', { className: 'wb-lineno' }, ''),
          el('span', { className: 'wb-linetext', style: color ? { color: color } : undefined }, line === '' ? ' ' : line),
        );
      }),
    );
  }

  function renderChanges() {
    if (changesErr) return el('div', { className: 'wb-error' }, changesErr);
    if (!changes) return el('div', { className: 'wb-empty' }, '正在读取改动…');
    if (!changes.isGit) {
      return el('div', { className: 'wb-list' },
        el('div', { className: 'wb-note' }, '该目录不是 git 仓库，按最近修改时间列出文件：'),
        (changes.recentFiles && changes.recentFiles.length)
          ? changes.recentFiles.map(function (f, i) { return el('div', { className: 'wb-code-line', key: i }, el('span', { className: 'wb-linetext' }, f)); })
          : el('div', { className: 'wb-empty' }, '未找到文件'),
      );
    }
    const files = changes.changedFiles || [];
    return el('div', { className: 'wb-list' },
      renderSection('改动文件（' + files.length + '）'),
      files.length === 0 ? el('div', { className: 'wb-empty' }, '工作区干净（无未提交改动）') :
        files.map(function (f, i) {
          const st = f.status || '';
          let color = '#60a5fa';
          if (st.indexOf('?') === 0) color = '#fbbf24';
          else if (st.indexOf('D') >= 0) color = '#f87171';
          else if (st.indexOf('A') >= 0) color = '#4ade80';
          return el('div', { className: 'wb-code-line', key: i },
            el('span', { className: 'wb-lineno' }, st),
            el('span', { className: 'wb-linetext', style: { color: color } }, f.path),
          );
        }),
      changes.diffStat ? el('div', null, renderSection('改动统计'), el('pre', { className: 'wb-out' }, changes.diffStat)) : null,
      changes.diff ? el('div', null, renderSection('差异 diff' + (changes.diffTruncated ? '（已截断）' : '')), renderDiff(changes.diff)) : null,
      changes.recentCommits && changes.recentCommits.length ? el('div', null, renderSection('最近提交'), changes.recentCommits.map(function (c, i) { return el('div', { className: 'wb-code-line', key: i }, el('span', { className: 'wb-linetext' }, c)); })) : null,
    );
  }

  function renderFiles() {
    if (viewing) {
      if (viewing.loading) return el('div', { className: 'wb-empty' }, '读取中…');
      if (viewing.tooLarge) {
        return el('div', null,
          el('button', { className: 'wb-back', onClick: function () { setViewing(null); } }, '← 返回目录'),
          el('div', { className: 'wb-filehead' }, viewing.path),
          el('div', { className: 'wb-empty' }, '文件过大（' + fmtSize(viewing.size) + '），无法预览。'),
        );
      }
      const lines = (viewing.text || '').split('\n');
      return el('div', { style: { display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 } },
        el('button', { className: 'wb-back', onClick: function () { setViewing(null); } }, '← 返回目录'),
        el('div', { className: 'wb-filehead' }, viewing.path + '  ·  ' + fmtSize(viewing.size)),
        el('div', { className: 'wb-code' },
          lines.map(function (line, i) {
            return el('div', { className: 'wb-code-line', key: i },
              el('span', { className: 'wb-lineno' }, String(i + 1)),
              el('span', { className: 'wb-linetext' }, line === '' ? ' ' : line),
            );
          }),
        ),
      );
    }
    return el('div', { style: { display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 } },
      el('div', { className: 'wb-toolbar' },
        el('button', { className: 'wb-btn', onClick: function () { if (parent) loadDir(parent); }, disabled: !parent, style: { opacity: parent ? 1 : 0.4 } }, '↑ 上级'),
        el('input', { className: 'wb-input', value: pathInput, placeholder: '输入路径…', onChange: function (e) { setPathInput(e.target.value); }, onKeyDown: function (e) { if (e.key === 'Enter') goPath(); } }),
        el('button', { className: 'wb-btn primary', onClick: goPath }, '跳转'),
      ),
      el('div', { className: 'wb-path', style: { direction: 'ltr', textAlign: 'left', padding: '4px 12px' } }, cwd || '—'),
      err ? el('div', { className: 'wb-error' }, err) : null,
      loading ? el('div', { className: 'wb-empty' }, '读取中…') : null,
      el('div', { className: 'wb-list' },
        entries.map(function (e) {
          const isDir = e.type === 'directory';
          return el('div', { className: 'wb-row', key: e.name + ':' + e.path, onClick: function () { isDir ? loadDir(e.path) : openFile(e.path); } },
            el('span', { className: 'wb-icon' }, isDir ? '📁' : '📄'),
            el('span', { className: 'wb-name' }, e.name),
            el('span', { className: 'wb-size' }, isDir ? '' : fmtSize(e.size)),
          );
        }),
        entries.length === 0 && !loading && !err ? el('div', { className: 'wb-empty' }, '空目录') : null,
      ),
    );
  }

  function renderWorkspaceDetail() {
    return el('div', { style: { display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 } },
      el('button', { className: 'wb-back', onClick: function () { setActiveWs(null); setScan(null); setPreview(null); setTextPreview(null); setChanges(null); setCwd(null); setViewing(null); } }, '← 所有工作区'),
      el('div', { className: 'wb-filehead' }, (activeWs.title || '') + '   ' + (activeWs.path || '')),
      el('div', { className: 'wb-tabs' },
        el('button', { className: 'wb-tab' + (wsTab === 'overview' ? ' active' : ''), onClick: function () { setWsTab('overview'); } }, '产出'),
        el('button', { className: 'wb-tab' + (wsTab === 'changes' ? ' active' : ''), onClick: function () { setWsTab('changes'); } }, '改动'),
        el('button', { className: 'wb-tab' + (wsTab === 'files' ? ' active' : ''), onClick: function () { setWsTab('files'); } }, '文件'),
      ),
      el('div', { className: 'wb-body' }, wsTab === 'overview' ? renderOverview() : wsTab === 'changes' ? renderChanges() : renderFiles()),
    );
  }

  function renderWorkspaceList() {
    if (wsErr) return el('div', { className: 'wb-error' }, wsErr);
    if (workspaces.length === 0) return el('div', { className: 'wb-empty' }, '暂无工作区');
    return el('div', { className: 'wb-list' },
      workspaces.map(function (ws) {
        return el('div', { className: 'wb-wscard', key: ws.id, onClick: function () { openWorkspace(ws); } },
          el('div', { className: 'wb-ws-title' }, ws.title || '(未命名)'),
          el('div', { className: 'wb-ws-path' }, ws.path),
          el('div', { className: 'wb-ws-meta' }, ws.sessionCount + ' 个对话  ·  ' + (ws.updatedAt ? ws.updatedAt.slice(0, 16).replace('T', ' ') : '')),
        );
      }),
    );
  }

  function renderPreviewOverlay() {
    if (!preview) return null;
    return el('div', { style: { display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 } },
      el('button', { className: 'wb-back', onClick: function () { setPreview(null); } }, '← 返回'),
      el('div', { className: 'wb-filehead' }, preview.title),
      el('div', { className: 'wb-preview-stage' },
        preview.kind === 'image' ? el('img', { src: preview.url, alt: preview.title })
        : preview.kind === 'video' ? el('video', { src: preview.url, controls: true, autoPlay: true })
        : preview.kind === 'site' || preview.kind === 'pdf' ? el('iframe', { src: preview.url, title: preview.title })
        : null,
      ),
      preview.kind === 'audio' ? el('div', { className: 'wb-audio' }, el('audio', { src: preview.url, controls: true, autoPlay: true })) : null,
    );
  }

  function renderTextPreviewOverlay() {
    if (!textPreview) return null;
    if (textPreview.loading) return el('div', { className: 'wb-empty' }, '读取中…');
    if (textPreview.tooLarge) {
      return el('div', null,
        el('button', { className: 'wb-back', onClick: function () { setTextPreview(null); } }, '← 返回'),
        el('div', { className: 'wb-empty' }, '文档过大（' + fmtSize(textPreview.size) + '），无法预览。'),
      );
    }
    const lines = (textPreview.text || '').split('\n');
    return el('div', { style: { display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 } },
      el('button', { className: 'wb-back', onClick: function () { setTextPreview(null); } }, '← 返回'),
      el('div', { className: 'wb-filehead' }, textPreview.name + '  ·  ' + fmtSize(textPreview.size)),
      el('div', { className: 'wb-code' },
        lines.map(function (line, i) {
          return el('div', { className: 'wb-code-line', key: i },
            el('span', { className: 'wb-lineno' }, String(i + 1)),
            el('span', { className: 'wb-linetext' }, line === '' ? ' ' : line),
          );
        }),
      ),
    );
  }

  function renderJobsTab() {
    if (activeJob) {
      if (activeJob.loading) return el('div', { className: 'wb-empty' }, '读取中…');
      const s = activeJob.snapshot || {};
      return el('div', { style: { display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 } },
        el('button', { className: 'wb-back', onClick: function () { setActiveJob(null); } }, '← 返回任务列表'),
        el('div', { className: 'wb-filehead' }, (s.kind || '') + '  ·  ' + (s.label || activeJob.id)),
        el('div', { className: 'wb-out' }, activeJob.text || '（无输出）'),
      );
    }
    const shown = (jobsFilter === 'current' && currentId) ? jobs.filter(function (j) { return j.ownerSession === currentId; }) : jobs;
    return el('div', { style: { display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 } },
      el('div', { className: 'wb-toolbar' },
        el('span', { className: 'wb-title' }, '后台任务（' + shown.length + '）'),
        currentId ? el('button', { className: 'wb-btn' + (jobsFilter === 'current' ? ' primary' : ''), onClick: function () { setJobsFilter(jobsFilter === 'current' ? 'all' : 'current'); } }, jobsFilter === 'current' ? '只看本次 ✓' : '只看本次') : null,
        el('button', { className: 'wb-btn primary', onClick: refreshJobs }, '刷新'),
      ),
      jobsErr ? el('div', { className: 'wb-error' }, jobsErr) : null,
      el('div', { className: 'wb-list' },
        shown.map(function (job) {
          const running = job.status === 'running' || job.status === 'stopping';
          return el('div', { className: 'wb-job', key: job.id, onClick: function () { openJob(job); } },
            el('div', { className: 'wb-job-top' },
              el('span', { className: 'wb-badge ' + job.status }, job.status),
              el('span', { className: 'wb-job-label' }, job.label || job.id),
              running ? el('button', { className: 'wb-btn danger', onClick: function (ev) { ev.stopPropagation(); killJob(job); } }, '停止') : null,
            ),
            el('div', { className: 'wb-job-meta' },
              el('span', null, job.kind),
              el('span', null, '#' + job.id),
              job.detail ? el('span', null, job.detail) : null,
              el('span', null, fmtTime(job.startedAt) + (job.finishedAt ? ' → ' + fmtTime(job.finishedAt) : '')),
            ),
          );
        }),
        shown.length === 0 && !jobsErr ? el('div', { className: 'wb-empty' }, '暂无后台任务') : null,
      ),
    );
  }

  function renderBody() {
    if (topTab === 'this') return renderThisTurn();
    if (topTab === 'jobs') return renderJobsTab();
    if (activeWs) {
      if (preview) return renderPreviewOverlay();
      if (textPreview) return renderTextPreviewOverlay();
      return renderWorkspaceDetail();
    }
    return renderWorkspaceList();
  }

  return el('div', { className: 'wb-root' },
    open ? el('div', { className: 'wb-panel' },
      el('div', { className: 'wb-head' },
        el('span', { className: 'wb-title' }, currentTitle ? ('工作台 · ' + currentTitle) : '工作台'),
        el('button', { className: 'wb-close', onClick: closePanel }, '✕'),
      ),
      el('div', { className: 'wb-tabs' },
        el('button', { className: 'wb-tab' + (topTab === 'this' ? ' active' : ''), onClick: function () { setTopTab('this'); } }, '本次'),
        el('button', { className: 'wb-tab' + (topTab === 'workspaces' ? ' active' : ''), onClick: function () { setTopTab('workspaces'); } }, '工作区'),
        el('button', { className: 'wb-tab' + (topTab === 'jobs' ? ' active' : ''), onClick: function () { setTopTab('jobs'); } }, '任务'),
      ),
      el('div', { className: 'wb-body' }, renderBody()),
    ) : null,
  );
}

return {
  inject: ['timer'],
  apply(ctx) {
    const slots = ctx.get('slots');
    if (slots === undefined) return;
    styles.insert(css);
    slots.inject('sidebar.footer.action', () => slots.register(
      { name: 'sidebar.footer.action', id: 'cordis-panel', order: 0, label: '工作台' },
      (props) => React.createElement(SidebarToggle, { wide: !!(props && props.wide) }),
    ));
    slots.inject('shell.overlay', () => slots.register(
      { name: 'shell.overlay', id: 'mobile-workbench', order: 10000, label: '工作台' },
      (props) => React.createElement(Workbench, { ctx: ctx, useSessions: props.useSessions, useWorkspaces: props.useWorkspaces }),
    ));
  },
};
