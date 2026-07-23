(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const config = window.SPU_WORK_HUB_CONFIG || {};
  const apiUrl = String(config.appsScriptUrl || '').trim().replace(/\/$/, '');
  const publicApiUrl = String(config.publicApiUrl || '').trim().replace(/\/$/, '');
  const apiConfigured = /^https:\/\/script\.google\.com\/macros\/s\/.+\/exec$/i.test(apiUrl);
  const publicApiConfigured = /^https:\/\//i.test(publicApiUrl);
  const statusMap = {
    open: ['เริ่มต้น', 'open'],
    in_progress: ['กำลังดำเนินการ', 'in_progress'],
    completed: ['เสร็จสิ้น', 'completed'],
    on_hold: ['พักงาน', 'on_hold']
  };
  const typeLabels = {
    html: 'HTML', pdf: 'PDF', word: 'WORD', excel: 'EXCEL',
    powerpoint: 'PPT', image: 'IMG', file: 'FILE'
  };

  let projects = [];
  let layout = 'card';
  let timelineScale = 'day';
  let timelineAnchor = startOfDay(new Date());
  const THAI_MONTHS = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
  const PROJECT_CACHE_KEY = 'spuWorkHubProjectsV1';
  const PROJECT_CACHE_MS = 2 * 60 * 1000;

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, char => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
    }[char]));
  }

  function formatDate(value) {
    if (!value) return 'ไม่ระบุ';
    const date = new Date(String(value).length === 10 ? value + 'T00:00:00' : value);
    if (Number.isNaN(date.getTime())) return String(value);
    return new Intl.DateTimeFormat('th-TH', { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
  }

  function formatDateTime(value) {
    if (!value) return 'ไม่ระบุ';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return new Intl.DateTimeFormat('th-TH', {
      day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
    }).format(date);
  }

  function formatBytes(bytes) {
    const value = Number(bytes || 0);
    if (value < 1024) return value + ' B';
    if (value < 1024 * 1024) return (value / 1024).toFixed(1) + ' KB';
    return (value / 1024 / 1024).toFixed(1) + ' MB';
  }

  function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function readProjectCache() {
    try {
      const cached = JSON.parse(localStorage.getItem(PROJECT_CACHE_KEY) || 'null');
      if (!cached || !cached.savedAt || !cached.result) return null;
      if (Date.now() - cached.savedAt > PROJECT_CACHE_MS) return null;
      return cached.result;
    } catch (_error) {
      return null;
    }
  }

  function writeProjectCache(result) {
    try {
      localStorage.setItem(PROJECT_CACHE_KEY, JSON.stringify({
        savedAt: Date.now(),
        result
      }));
    } catch (_error) {
      // localStorage อาจถูกปิดได้; ระบบยังโหลดผ่านเครือข่ายตามปกติ
    }
  }

  async function fetchJson(url, timeoutMs = 30000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method: 'GET',
        cache: 'default',
        signal: controller.signal
      });

      if (!response.ok) {
        const error = new Error('Public API ตอบกลับ HTTP ' + response.status);
        error.status = response.status;
        throw error;
      }

      return await response.json();
    } catch (error) {
      if (error && error.name === 'AbortError') {
        throw new Error('โหลดข้อมูลไม่สำเร็จภายใน 30 วินาที');
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async function fetchProjectsFromProxy(forceRefresh = false) {
    if (!forceRefresh) {
      const cached = readProjectCache();
      if (cached) return cached;
    }

    let lastError;
    const requestUrl = forceRefresh
      ? publicApiUrl + '/projects?refresh=1&_=' + Date.now()
      : publicApiUrl + '/projects';

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const result = await fetchJson(requestUrl);
        writeProjectCache(result);
        return result;
      } catch (error) {
        lastError = error;
        const canRetry = !error.status || error.status >= 500;
        if (attempt === 0 && canRetry) {
          await wait(1000);
          continue;
        }
        break;
      }
    }

    throw lastError;
  }


  async function loadProjects(forceRefresh = false) {
    if (!publicApiConfigured) {
      $('setupNotice').classList.remove('hidden');
      $('setupNotice').innerHTML = '<strong>ยังไม่ได้ตั้งค่า Public API</strong><span>กรุณาตรวจสอบ publicApiUrl ใน config.js</span>';
      $('adminLink').href = apiConfigured ? apiUrl + '?view=admin' : '#';
      renderAll();
      return;
    }

    $('setupNotice').classList.add('hidden');
    $('refreshButton').disabled = true;
    $('refreshButton').textContent = 'กำลังโหลด…';
    try {
      const result = await fetchProjectsFromProxy(forceRefresh);
      if (!result || !result.ok) throw new Error(result && result.error ? result.error : 'ข้อมูลตอบกลับไม่ถูกต้อง');
      projects = Array.isArray(result.projects) ? result.projects : [];
      $('lastUpdated').textContent = 'อัปเดต ' + formatDateTime(new Date().toISOString());
      $('adminLink').href = apiConfigured ? apiUrl + '?view=admin' : '#';
      renderAll();
    } catch (error) {
      projects = [];
      $('setupNotice').classList.remove('hidden');
      $('setupNotice').innerHTML = '<strong>โหลดข้อมูลไม่สำเร็จ</strong><span>' + escapeHtml(error.message) + ' กรุณากดรีเฟรชข้อมูลอีกครั้ง</span>';
      renderAll();
    } finally {
      $('refreshButton').disabled = false;
      $('refreshButton').textContent = '↻ รีเฟรชข้อมูล';
    }
  }

  function renderAll() {
    renderStats();
    renderTagOptions();
    renderProjects();
    renderTimeline();
  }

  function renderStats() {
    $('statTotal').textContent = projects.length;
    $('statProgress').textContent = projects.filter(project => project.status === 'in_progress').length;
    $('statCompleted').textContent = projects.filter(project => project.status === 'completed').length;
    $('statHold').textContent = projects.filter(project => project.status === 'on_hold').length;
  }

  function renderTagOptions() {
    const current = $('tagFilter').value || 'all';
    const tags = Array.from(new Set(projects.flatMap(project => project.tags || []).filter(Boolean)))
      .sort((a, b) => a.localeCompare(b, 'th'));
    $('tagFilter').innerHTML = '<option value="all">ทุกป้ายกำกับ</option>'
      + tags.map(tag => '<option value="' + escapeHtml(tag) + '">' + escapeHtml(tag) + '</option>').join('');
    if (tags.includes(current)) $('tagFilter').value = current;
  }

  function filteredProjects() {
    const query = $('searchInput').value.trim().toLowerCase();
    const tag = $('tagFilter').value;
    const status = $('statusFilter').value;
    const sort = $('sortSelect').value;
    const result = projects.filter(project => {
      const haystack = [project.title, project.description, project.owner].concat(project.tags || []).join(' ').toLowerCase();
      return (!query || haystack.includes(query))
        && (tag === 'all' || (project.tags || []).includes(tag))
        && (status === 'all' || project.status === status);
    });

    if (sort === 'progress') result.sort((a, b) => Number(b.progress || 0) - Number(a.progress || 0));
    if (sort === 'title') result.sort((a, b) => String(a.title).localeCompare(String(b.title), 'th'));
    if (sort === 'newest') result.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
    return result;
  }

  function statusBadge(project) {
    const entry = statusMap[project.status] || [project.status || 'ไม่ระบุ', 'open'];
    return '<span class="status-badge ' + entry[1] + '">' + escapeHtml(entry[0]) + '</span>';
  }

  function fileSummary(project) {
    const total = (project.mainFile ? 1 : 0) + (project.attachments || []).length;
    return total + ' ไฟล์';
  }

  function tags(project) {
    return (project.tags || []).slice(0, 4).map(tag => '<span class="tag">' + escapeHtml(tag) + '</span>').join('');
  }

  function projectCard(project, isLatest) {
    return `<article class="project-card ${isLatest ? 'latest' : ''}" tabindex="0" role="button" data-project="${escapeHtml(project.id)}">
      <div class="card-top">${statusBadge(project)}${isLatest ? '<span class="latest-badge">อัปเดตล่าสุด</span>' : ''}</div>
      <h3>${escapeHtml(project.title)}</h3>
      <p>${escapeHtml(project.description || 'ไม่มีรายละเอียด')}</p>
      <div class="tag-row">${tags(project)}</div>
      <div class="progress-row"><div class="progress-line"><span style="width:${Math.max(0, Math.min(100, Number(project.progress || 0)))}%"></span></div><strong>${Number(project.progress || 0)}%</strong></div>
      <div class="card-meta"><span>${escapeHtml(project.owner || 'ไม่ระบุผู้รับผิดชอบ')}</span><span>${fileSummary(project)}</span></div>
    </article>`;
  }

  function projectRow(project, isLatest) {
    const entry = statusMap[project.status] || [project.status || 'ไม่ระบุ', 'open'];
    return `<article class="project-list-row ${isLatest ? 'latest' : ''}" tabindex="0" role="button" data-project="${escapeHtml(project.id)}">
      <div><strong>${escapeHtml(project.title)} ${isLatest ? '<span class="latest-badge">อัปเดตล่าสุด</span>' : ''}</strong><small>${escapeHtml((project.tags || []).join(' · '))} · ${fileSummary(project)}</small></div>
      <span class="status-badge ${entry[1]}">${escapeHtml(entry[0])}</span>
      <span>${escapeHtml(project.owner || 'ไม่ระบุ')}</span>
      <div class="list-progress"><div class="progress-line"><span style="width:${Math.max(0, Math.min(100, Number(project.progress || 0)))}%"></span></div><strong>${Number(project.progress || 0)}%</strong></div>
      <span>${formatDate(project.updatedAt)}</span>
    </article>`;
  }

  function renderProjects() {
    const list = filteredProjects();
    const newestId = projects.length ? projects.slice().sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))[0].id : '';
    $('resultCount').textContent = list.length + ' รายการ';
    $('projectGrid').innerHTML = list.map(project => projectCard(project, project.id === newestId)).join('');
    $('projectList').innerHTML = list.length
      ? '<div class="project-list-head"><span>ผลงาน</span><span>สถานะ</span><span>ผู้รับผิดชอบ</span><span>ความคืบหน้า</span><span>อัปเดต</span></div>'
        + list.map(project => projectRow(project, project.id === newestId)).join('')
      : '';
    $('emptyState').classList.toggle('hidden', list.length > 0);
    bindProjectOpen();
  }

  function bindProjectOpen() {
    document.querySelectorAll('[data-project]').forEach(element => {
      element.addEventListener('click', () => openProject(element.dataset.project));
      element.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          openProject(element.dataset.project);
        }
      });
    });
  }

  function fileIcon(file) {
    const kind = file && file.kind ? file.kind : 'file';
    return '<span class="file-type ' + escapeHtml(kind) + '">' + escapeHtml(typeLabels[kind] || 'FILE') + '</span>';
  }

  function fileListItem(file, active) {
    return `<button class="file-item ${active ? 'active' : ''}" type="button" data-file="${escapeHtml(file.id)}">
      ${fileIcon(file)}<span><strong>${escapeHtml(file.name)}</strong><small>${file.role === 'main' ? 'ไฟล์หลัก' : 'ไฟล์รอง'} · ${formatBytes(file.size)}</small></span>
    </button>`;
  }

  function getPreviewUrl(file) {
    if (!file) return '';
    return file.previewUrl || file.openUrl || file.driveUrl || '';
  }

  function getOpenUrl(file) {
    if (!file) return '#';
    return file.openUrl || file.driveUrl || file.previewUrl || '#';
  }

  function isMobileViewport() {
    return window.matchMedia('(max-width: 760px)').matches;
  }

  function openProject(id) {
    const project = projects.find(item => item.id === id);
    if (!project) return;
    const main = project.mainFile || null;
    const attachments = project.attachments || [];
    const allFiles = [main].concat(attachments).filter(Boolean);
    const first = main || attachments[0] || null;
    const entry = statusMap[project.status] || [project.status || 'ไม่ระบุ', 'open'];

    $('dialogContent').innerHTML = `<div class="detail-head">
      <div><div class="detail-badges"><span class="status-badge ${entry[1]}">${escapeHtml(entry[0])}</span><span class="file-count-badge">${fileSummary(project)}</span></div><h2>${escapeHtml(project.title)}</h2><p>${escapeHtml(project.description || 'ไม่มีรายละเอียด')}</p></div>
      <div class="detail-progress"><span>ความคืบหน้า</span><strong>${Number(project.progress || 0)}%</strong></div>
    </div>
    <div class="detail-meta"><div><span>ผู้รับผิดชอบ</span><strong>${escapeHtml(project.owner || 'ไม่ระบุ')}</strong></div><div><span>อัปเดตล่าสุด</span><strong>${formatDate(project.updatedAt)}</strong></div><div><span>ครบกำหนด</span><strong>${formatDate(project.dueDate)}</strong></div></div>
    <div class="file-workspace">
      <aside class="file-sidebar">
        <div class="file-group"><h3>ไฟล์หลัก</h3>${main ? fileListItem(main, true) : '<div class="no-files">ไม่มีไฟล์หลัก</div>'}</div>
        <div class="file-group"><h3>ไฟล์รอง ${attachments.length ? '(' + attachments.length + ')' : ''}</h3>${attachments.length ? attachments.map(file => fileListItem(file, !main && file.id === first.id)).join('') : '<div class="no-files">ไม่มีไฟล์รอง</div>'}</div>
      </aside>
      <section class="file-viewer">
        <div class="viewer-toolbar">
          <div id="viewerFileInfo"></div>
          <div class="viewer-actions"><a id="openSourceButton" class="button ghost" href="#" target="_blank" rel="noopener">เปิดไฟล์ต้นฉบับ ↗</a></div>
        </div>
        <div id="previewArea"></div>
      </section>
    </div>`;

    const dialog = $('projectDialog');
    dialog.showModal();

    function selectFile(file) {
      if (!file) {
        $('viewerFileInfo').innerHTML = '<span>ไม่มีไฟล์สำหรับแสดงผล</span>';
        $('openSourceButton').classList.add('hidden');
        $('previewArea').innerHTML = '<div class="preview-empty">ไม่มีไฟล์สำหรับแสดงผล</div>';
        return;
      }
      dialog.querySelectorAll('[data-file]').forEach(button => button.classList.toggle('active', button.dataset.file === file.id));
      $('viewerFileInfo').innerHTML = fileIcon(file) + '<span><strong>' + escapeHtml(file.name) + '</strong><small>' + formatBytes(file.size) + '</small></span>';
      $('openSourceButton').classList.remove('hidden');
      const previewUrl = getPreviewUrl(file);
      const openUrl = getOpenUrl(file);
      $('openSourceButton').href = openUrl;

      const mobileExternalFirst = isMobileViewport()
        && ['word', 'excel', 'powerpoint'].includes(file.kind);

      if (mobileExternalFirst) {
        $('previewArea').innerHTML = `<div class="mobile-file-message">
          ${fileIcon(file)}
          <strong>${escapeHtml(file.name)}</strong>
          <span>เอกสารประเภทนี้เหมาะกับการเปิดผ่าน Google Drive บนมือถือมากกว่า</span>
          <a class="button primary" href="${escapeHtml(openUrl)}" target="_blank" rel="noopener">เปิดใน Google Drive ↗</a>
        </div>`;
      } else {
        $('previewArea').innerHTML = `<iframe class="preview-frame" title="ตัวอย่างไฟล์ ${escapeHtml(file.name)}" src="${escapeHtml(previewUrl)}" referrerpolicy="no-referrer" sandbox="allow-scripts allow-forms allow-popups allow-downloads allow-same-origin allow-popups-to-escape-sandbox"></iframe>`;
      }
    }

    dialog.querySelectorAll('[data-file]').forEach(button => button.addEventListener('click', () => {
      const file = allFiles.find(item => item.id === button.dataset.file);
      selectFile(file);
    }));
    selectFile(first);
  }

  function startOfDay(value) {
    const date = new Date(value);
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  function parseProjectDate(value) {
    const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]) - 1;
    const day = Number(match[3]);
    const date = new Date(year, month, day);
    return date.getFullYear() === year && date.getMonth() === month && date.getDate() === day
      ? date
      : null;
  }

  function addDays(value, amount) {
    const date = new Date(value);
    date.setDate(date.getDate() + amount);
    return date;
  }

  function addYears(value, amount) {
    const date = new Date(value);
    date.setFullYear(date.getFullYear() + amount);
    return date;
  }

  function isoDate(value) {
    const date = new Date(value);
    return date.getFullYear() + '-'
      + String(date.getMonth() + 1).padStart(2, '0') + '-'
      + String(date.getDate()).padStart(2, '0');
  }

  function timelineColumns() {
    if (timelineScale === 'day') {
      const start = addDays(timelineAnchor, -3);
      return Array.from({ length: 14 }, (_item, index) => {
        const date = addDays(start, index);
        return {
          start: date,
          end: addDays(date, 1),
          label: date.getDate() + ' ' + THAI_MONTHS[date.getMonth()],
          today: isoDate(date) === isoDate(new Date())
        };
      });
    }

    if (timelineScale === 'month') {
      const year = timelineAnchor.getFullYear();
      return Array.from({ length: 12 }, (_item, index) => ({
        start: new Date(year, index, 1),
        end: new Date(year, index + 1, 1),
        label: THAI_MONTHS[index] + ' ' + String(year + 543).slice(-2),
        today: year === new Date().getFullYear() && index === new Date().getMonth()
      }));
    }

    const firstYear = timelineAnchor.getFullYear() - 2;
    return Array.from({ length: 5 }, (_item, index) => ({
      start: new Date(firstYear + index, 0, 1),
      end: new Date(firstYear + index + 1, 0, 1),
      label: String(firstYear + index + 543),
      today: firstYear + index === new Date().getFullYear()
    }));
  }

  function timelinePeriodLabel(columns) {
    if (!columns.length) return '';
    const first = columns[0].start;
    const last = columns[columns.length - 1].start;

    if (timelineScale === 'day') {
      return first.getDate() + ' ' + THAI_MONTHS[first.getMonth()]
        + ' – ' + last.getDate() + ' ' + THAI_MONTHS[last.getMonth()]
        + ' ' + (last.getFullYear() + 543);
    }

    if (timelineScale === 'month') {
      return 'ปี ' + (timelineAnchor.getFullYear() + 543);
    }

    return 'ปี ' + (first.getFullYear() + 543)
      + ' – ' + (last.getFullYear() + 543);
  }

  function timelineRange(project) {
    let start = parseProjectDate(project.startDate);
    let due = parseProjectDate(project.dueDate);
    if (!start && !due) return null;
    if (!start) start = due;
    if (!due) due = start;
    if (due < start) {
      const swap = start;
      start = due;
      due = swap;
    }
    return { start, end: addDays(due, 1) };
  }

  function renderTimeline() {
    const columns = timelineColumns();
    const status = $('timelineStatusFilter').value;
    const list = projects
      .filter(project => status === 'all' || project.status === status)
      .sort((a, b) => {
        const aDate = a.startDate || a.dueDate || '9999-12-31';
        const bDate = b.startDate || b.dueDate || '9999-12-31';
        return aDate.localeCompare(bDate) || String(a.title).localeCompare(String(b.title), 'th');
      });

    $('timelineCount').textContent = list.length + ' งาน';
    $('timelinePeriodLabel').textContent = timelinePeriodLabel(columns);
    $('timelineScaleButtons').querySelectorAll('[data-scale]').forEach(button => {
      button.classList.toggle('active', button.dataset.scale === timelineScale);
    });

    const projectWidth = isMobileViewport() ? 220 : 260;
    const columnWidth = timelineScale === 'day' ? 76 : 88;
    const grid = $('timelineGrid');
    grid.style.gridTemplateColumns = projectWidth + 'px repeat('
      + columns.length + ',minmax(' + columnWidth + 'px,1fr))';

    let html = '<div class="timeline-corner" style="grid-column:1;grid-row:1">ผลงาน / ผู้รับผิดชอบ</div>';
    html += columns.map((column, index) => '<div class="timeline-head '
      + (column.today ? 'today' : '') + '" style="grid-column:' + (index + 2)
      + ';grid-row:1">' + escapeHtml(column.label) + '</div>').join('');

    if (!list.length) {
      html += '<div class="timeline-empty" style="grid-column:1/-1;grid-row:2">ยังไม่มีงานในเงื่อนไขนี้</div>';
      grid.innerHTML = html;
      return;
    }

    list.forEach((project, rowIndex) => {
      const row = rowIndex + 2;
      const entry = statusMap[project.status] || [project.status || 'ไม่ระบุ', 'open'];
      html += '<div class="timeline-project-cell" style="grid-column:1;grid-row:' + row + '">'
        + '<strong>' + escapeHtml(project.title) + '</strong>'
        + '<small>' + escapeHtml(project.owner || 'ไม่ระบุผู้รับผิดชอบ') + '</small>'
        + '<span class="timeline-status ' + escapeHtml(entry[1]) + '">' + escapeHtml(entry[0]) + '</span>'
        + '</div>';

      columns.forEach((column, index) => {
        html += '<div class="timeline-track-cell ' + (column.today ? 'today' : '')
          + '" style="grid-column:' + (index + 2) + ';grid-row:' + row + '"></div>';
      });

      const range = timelineRange(project);
      if (!range) {
        const endColumn = Math.min(columns.length + 2, 4);
        html += '<div class="timeline-bar no-date" style="grid-column:2/' + endColumn
          + ';grid-row:' + row + '">ยังไม่กำหนดช่วงเวลา</div>';
        return;
      }

      let first = -1;
      let last = -1;
      columns.forEach((column, index) => {
        const overlaps = range.start < column.end && range.end > column.start;
        if (!overlaps) return;
        if (first === -1) first = index;
        last = index;
      });

      if (first >= 0 && last >= first) {
        html += '<div class="timeline-bar ' + escapeHtml(entry[1])
          + '" style="grid-column:' + (first + 2) + '/' + (last + 3)
          + ';grid-row:' + row + '">' + escapeHtml(project.title) + '</div>';
      }
    });

    grid.innerHTML = html;
  }

  function moveTimeline(direction) {
    if (timelineScale === 'day') timelineAnchor = addDays(timelineAnchor, direction * 14);
    if (timelineScale === 'month') timelineAnchor = addYears(timelineAnchor, direction);
    if (timelineScale === 'year') timelineAnchor = addYears(timelineAnchor, direction * 5);
    renderTimeline();
  }

  function setLayout(next) {
    if (isMobileViewport()) next = 'card';
    layout = next;
    $('cardViewButton').classList.toggle('active', layout === 'card');
    $('listViewButton').classList.toggle('active', layout === 'list');
    $('projectGrid').classList.toggle('hidden', layout !== 'card');
    $('projectList').classList.toggle('hidden', layout !== 'list');
  }

  function setView(view) {
    document.querySelectorAll('[data-view]').forEach(button => button.classList.toggle('active', button.dataset.view === view));
    $('portfolioView').classList.toggle('hidden', view !== 'portfolio');
    $('timelineView').classList.toggle('hidden', view !== 'timeline');
    $('pageTitle').textContent = view === 'portfolio' ? 'ศูนย์รวมผลงาน' : 'แผนผังระยะเวลา';
    if (view === 'timeline') renderTimeline();
  }

  ['searchInput', 'tagFilter', 'statusFilter', 'sortSelect'].forEach(id => {
    $(id).addEventListener(id === 'searchInput' ? 'input' : 'change', renderProjects);
  });
  document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => setView(button.dataset.view)));
  $('cardViewButton').addEventListener('click', () => setLayout('card'));
  $('listViewButton').addEventListener('click', () => setLayout('list'));
  $('refreshButton').addEventListener('click', () => loadProjects(true));
  $('timelineScaleButtons').querySelectorAll('[data-scale]').forEach(button => {
    button.addEventListener('click', () => {
      timelineScale = button.dataset.scale;
      renderTimeline();
    });
  });
  $('timelinePrevButton').addEventListener('click', () => moveTimeline(-1));
  $('timelineNextButton').addEventListener('click', () => moveTimeline(1));
  $('timelineTodayButton').addEventListener('click', () => {
    timelineAnchor = startOfDay(new Date());
    renderTimeline();
  });
  $('timelineStatusFilter').addEventListener('change', renderTimeline);
  $('dialogClose').addEventListener('click', () => $('projectDialog').close());
  $('projectDialog').addEventListener('click', event => {
    if (event.target === $('projectDialog')) $('projectDialog').close();
  });

  if (isMobileViewport()) layout = 'card';
  loadProjects();
})();
