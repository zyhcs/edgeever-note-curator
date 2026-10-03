/**
 * EdgeEver Note Curator Plugin
 * 笔记管家与知识体检大师 (All-in-one AI & Local PKM Assistant)
 *
 * 核心功能：
 * 1. 🩺 笔记体检诊断：五维健康度评分卡（排版/完整度/信息密度/知识关联/阅读体验）、优缺点分析与一键处方；
 * 2. 🧹 格式与排版净化：中英文混排盘古规范、标题大纲层级校准、代码语言自动嗅探、Diff 视觉对比与一键应用；
 * 3. ✍️ 智能内容重构与扩写：免配置本地速查模板 + 外部通用大模型（DeepSeek/OpenAI/Ollama）按需扩写；
 * 4. 🕸️ 知识网络与关联：全库跨笔记关联度计算、Canvas 局域星系图谱、文末一键追加双向关联；
 * 5. 🏷️ 标签智能治理：高频核心主题打标推荐、全库标签同义去重诊断；
 * 6. 🪄 自动集成至右下角统一插件工具坞 (Plugin Dock)，完美自适应深浅色模式。
 */

// ==================== 1. 基础工具与辅助函数 ====================

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatDate(isoOrTs) {
  if (!isoOrTs) return "-";
  try {
    const d = new Date(isoOrTs);
    if (isNaN(d.getTime())) return String(isoOrTs);
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch (e) {
    return String(isoOrTs);
  }
}

// 常见技术停用词表
const STOP_WORDS = new Set([
  "的", "了", "在", "是", "我", "有", "和", "就", "不", "人", "都", "一", "一个", "上", "也", "很", "到", "说", "要", "去", "你", "会", "着", "没有", "看", "好", "自己", "这", "那", "如何", "怎么", "通过", "进行", "使用", "支持", "可以", "以及", "并且", "实现", "或者", "为了", "如果", "对于", "关于", "本文", "主要", "其中", "因此", "由于", "我们", "需要", "根据", "作为", "完成", "基于", "包含", "以下", "当前", "用于", "相关", "采用", "提供", "同时", "this", "that", "with", "from", "have", "been", "were", "what", "when", "where", "which", "there", "their", "about", "would", "these", "other", "into", "more", "first", "also", "after", "could", "some", "time", "then", "like", "will"
]);

// ==================== 2. 盘古之白与本地排版规范引擎 ====================

/**
 * 盘古之白 (Pangu Spacing): 在中文与英文字符、数字、反引号之间自动插入空格
 */
function applyPanguSpacing(text) {
  if (!text) return "";
  let s = text;
  // 中文与英文/数字
  s = s.replace(/([\u4e00-\u9fa5])([a-zA-Z0-9])/g, "$1 $2");
  s = s.replace(/([a-zA-Z0-9])([\u4e00-\u9fa5])/g, "$1 $2");
  // 中文与行内代码
  s = s.replace(/([\u4e00-\u9fa5])(`[^`]+`)/g, "$1 $2");
  s = s.replace(/(`[^`]+`)([\u4e00-\u9fa5])/g, "$1 $2");
  return s;
}

/**
 * 代码块语言自动嗅探
 */
function detectCodeLanguage(code) {
  const c = code.trim();
  if (/^(REPORT|PROGRAM|DATA:|TYPES:|CONSTANTS:|PARAMETERS:|SELECT-OPTIONS:|FORM\s|ENDFORM|MODULE\s|ENDMODULE|FUNCTION\s|ENDFUNCTION|METHOD\s|ENDMETHOD|CLASS\s|ENDCLASS|CHECK\s|LOOP\s+AT\s|ENDLOOP|READ\s+TABLE|ASSIGN\s|WRITE:)\b/im.test(c) ||
      /\bzcl_[a-z0-9_]+/i.test(c) || /abap_true|abap_false/i.test(c)) {
    return "abap";
  }
  if (/^(\{|\[)\s*[\r\n]/m.test(c) && /"[\w\-]+":\s*/.test(c)) {
    return "json";
  }
  if (/\b(SELECT|FROM|WHERE|INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|CREATE\s+TABLE|ALTER\s+TABLE|DROP\s+TABLE)\b/i.test(c)) {
    return "sql";
  }
  if (/\b(def\s+\w+|import\s+\w+|from\s+\w+\s+import|class\s+\w+:|elif\s|print\(|__init__)\b/.test(c)) {
    return "python";
  }
  if (/\b(const|let|var|function|async|await|console\.log|export|import\s+.*?from)\b/.test(c) || /=>\s*\{/.test(c)) {
    return "javascript";
  }
  if (/^<\?xml|<!DOCTYPE|<html|<div|<span|<svg/i.test(c)) {
    return "html";
  }
  if (/\b(graph|flowchart|sequenceDiagram|classDiagram|erDiagram|gantt|pie|gitGraph)\b/i.test(c)) {
    return "mermaid";
  }
  return "";
}

/**
 * 完整 Markdown 排版格式化与规范净化器
 */
function formatMarkdown(markdown, options = {}) {
  if (!markdown) return "";
  const opt = {
    pangu: options.autoPanguSpacing !== false,
    fixHeadings: options.autoFixHeadings !== false,
    detectCode: options.autoCodeDetect !== false,
    ...options
  };

  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const resultLines = [];
  let inCodeBlock = false;
  let codeFenceLang = "";
  let codeLines = [];
  let headingLevelMap = new Map(); // 用于平滑大纲层级
  let lastHeadingLevel = 0;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();

    // 1. 代码块处理
    if (trimmed.startsWith("```")) {
      if (inCodeBlock) {
        // 代码块结束
        let finalLang = codeFenceLang;
        if (!finalLang && opt.detectCode) {
          finalLang = detectCodeLanguage(codeLines.join("\n"));
        }
        resultLines.push(`\`\`\`${finalLang}`);
        resultLines.push(...codeLines);
        resultLines.push("```");
        inCodeBlock = false;
        codeFenceLang = "";
        codeLines = [];
      } else {
        // 代码块开始
        inCodeBlock = true;
        codeFenceLang = trimmed.slice(3).trim();
        codeLines = [];
      }
      continue;
    }

    if (inCodeBlock) {
      codeLines.push(rawLine);
      continue;
    }

    // 2. 标题层级平滑校准 (例如防止从 # 直接跳级到 ####)
    const headerMatch = rawLine.match(/^(#{1,6})\s+(.*)$/);
    if (headerMatch) {
      let level = headerMatch[1].length;
      let text = headerMatch[2].trim();
      if (opt.pangu) {
        text = applyPanguSpacing(text);
      }

      if (opt.fixHeadings) {
        // 如果跳级超过 1 级（例如上一级是 1，当前是 3 或 4），平滑为 上一级 + 1
        if (lastHeadingLevel > 0 && level > lastHeadingLevel + 1) {
          level = lastHeadingLevel + 1;
        }
        lastHeadingLevel = level;
      }

      resultLines.push(`${"#".repeat(level)} ${text}`);
      continue;
    }

    // 3. 空白行控制 (折叠多余连续空行)
    if (!trimmed) {
      if (resultLines.length > 0 && resultLines[resultLines.length - 1] === "") {
        continue; // 跳过连续的空行
      }
      resultLines.push("");
      continue;
    }

    // 4. 表格行处理 (保持原管道符，优化单元格间距)
    if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
      resultLines.push(trimmed);
      continue;
    }

    // 5. 普通文本行：应用盘古规范
    let processed = rawLine;
    if (opt.pangu) {
      processed = applyPanguSpacing(processed);
    }
    resultLines.push(processed);
  }

  // 兜底未闭合的代码块
  if (inCodeBlock) {
    resultLines.push(`\`\`\`${codeFenceLang}`);
    resultLines.push(...codeLines);
    resultLines.push("```");
  }

  return resultLines.join("\n").trim() + "\n";
}

// ==================== 3. 笔记五维健康度体检评分与诊断器 ====================

/**
 * 诊断笔记并生成健康度评分卡
 */
function auditNote(note, allVaultNotes = []) {
  if (!note) return null;

  const title = (note.title || "").trim();
  const md = (note.contentMarkdown || note.content || note.plainText || "").trim();
  const tags = Array.isArray(note.tags) ? note.tags : [];
  const lines = md.split("\n");

  const wordCount = md.replace(/\s+/g, "").length;
  const hasCode = /```|<code>|<pre>/i.test(md);
  const hasImage = /!\[.*?\]\(|<img\s|edgeever-resource:\/\//i.test(md);
  const hasTable = /^\|.*\|$/m.test(md);
  const hasLinks = /\[.*?\]\(.*?\)/.test(md);

  // 1. 排版规范度 (20分)
  let formatScore = 20;
  const formatIssues = [];

  // 检查标题跳级
  let prevLevel = 0;
  let hasHeadingJump = false;
  let hasHeadings = false;
  for (const line of lines) {
    const m = line.trim().match(/^(#{1,6})\s+/);
    if (m) {
      hasHeadings = true;
      const l = m[1].length;
      if (prevLevel > 0 && l > prevLevel + 1) {
        hasHeadingJump = true;
      }
      prevLevel = l;
    }
  }
  if (hasHeadingJump) {
    formatScore -= 5;
    formatIssues.push("大纲标题存在跨级跳跃（如从 H1 直接跳到 H3/H4）");
  }

  // 检查未声明语言的代码块
  const unannotatedCodes = (md.match(/```\s*\n/g) || []).length;
  if (unannotatedCodes > 0) {
    formatScore -= Math.min(6, unannotatedCodes * 2);
    formatIssues.push(`存在 ${unannotatedCodes} 处未标记语言类型的代码块`);
  }

  // 检查中英混排缺少空格
  const panguMismatches = (md.match(/([\u4e00-\u9fa5][a-zA-Z0-9]|[a-zA-Z0-9][\u4e00-\u9fa5])/g) || []).length;
  if (panguMismatches > 5) {
    formatScore -= 4;
    formatIssues.push(`发现 ${panguMismatches} 处中英文/数字无间隔贴合`);
  }

  // 2. 内容完整度 (20分)
  let completeScore = 0;
  if (wordCount >= 800) completeScore = 20;
  else if (wordCount >= 400) completeScore = 16;
  else if (wordCount >= 200) completeScore = 12;
  else if (wordCount >= 80) completeScore = 8;
  else completeScore = 4;

  if (hasHeadings && completeScore <= 16) completeScore += 2;

  // 3. 信息密度 (20分)
  let densityScore = 6;
  if (hasCode) densityScore += 5;
  if (hasTable) densityScore += 4;
  if (hasImage) densityScore += 3;
  if (wordCount > 300) densityScore += 2;
  densityScore = Math.min(20, densityScore);

  // 4. 知识网络关联度 (20分)
  let connectScore = 0;
  if (tags.length >= 3) connectScore += 10;
  else if (tags.length >= 1) connectScore += 6;

  if (hasLinks) connectScore += 6;

  // 检查在全库中的关联关系
  let relatedCount = 0;
  if (allVaultNotes.length > 0 && tags.length > 0) {
    const curTagSet = new Set(tags.map((t) => String(t).toLowerCase()));
    for (const other of allVaultNotes) {
      if (other.id === note.id) continue;
      const oTags = Array.isArray(other.tags) ? other.tags : [];
      if (oTags.some((ot) => curTagSet.has(String(ot).toLowerCase()))) {
        relatedCount++;
      }
    }
  }
  if (relatedCount >= 3) connectScore += 4;
  else if (relatedCount >= 1) connectScore += 2;
  connectScore = Math.min(20, connectScore);

  // 5. 阅读体验 (20分)
  let readScore = 15;
  const readMinutes = Math.max(1, Math.ceil(wordCount / 400));
  if (hasHeadings) readScore += 3;
  if (wordCount > 50 && wordCount < 3000) readScore += 2;
  readScore = Math.min(20, readScore);

  // 综合总分
  const totalScore = Math.max(20, Math.min(100, formatScore + completeScore + densityScore + connectScore + readScore));

  let grade = "C";
  let gradeColor = "score-rank-c";
  if (totalScore >= 90) { grade = "S"; gradeColor = "score-rank-s"; }
  else if (totalScore >= 80) { grade = "A"; gradeColor = "score-rank-a"; }
  else if (totalScore >= 65) { grade = "B"; gradeColor = "score-rank-b"; }

  // 亮点与优缺点列表
  const pros = [];
  const cons = [];
  const prescriptions = [];

  if (hasCode) pros.push("包含专业代码示例，技术参考价值高");
  if (hasTable) pros.push("使用数据表格进行结构化对比，直观清晰");
  if (hasImage) pros.push("具备视觉图解/截图支持，图文并茂");
  if (wordCount >= 600) pros.push(`正文篇幅充实（约 ${wordCount} 字），信息丰富`);
  if (hasHeadings && !hasHeadingJump) pros.push("大纲标题层级严谨，目录层次分明");
  if (tags.length >= 2) pros.push(`分类标签完善（已打上 ${tags.length} 个标签）`);

  if (pros.length === 0) {
    pros.push("已初步记录核心业务事实，具备整理价值");
  }

  if (tags.length === 0) {
    cons.push("未设置任何标签，处于全库知识孤岛状态，难以归类检索");
    prescriptions.push("前往【标签治理】Tab，智能推荐并一键添加核心标签");
  }
  if (formatIssues.length > 0) {
    cons.push(...formatIssues);
    prescriptions.push("前往【排版净化】Tab，点击【一键排版净化】自动校准格式");
  }
  if (!hasHeadings && wordCount > 200) {
    cons.push("缺乏各章节的大纲标题（H2/H3），长文阅读缺乏锚点");
    prescriptions.push("前往【内容重构】Tab，智能生成技术文档规范结构");
  }
  if (!hasLinks && relatedCount > 0) {
    cons.push(`在全库发现至少 ${relatedCount} 篇相关联笔记，但彼此尚未建立双向链接`);
    prescriptions.push("前往【知识网络】Tab，一键在文末注入关联阅读链接");
  }
  if (wordCount < 100) {
    cons.push("内容偏简短碎片化，核心步骤或背景交代不全");
    prescriptions.push("利用 AI Copilot 进行场景补充或排错对策扩写");
  }

  return {
    totalScore,
    grade,
    gradeColor,
    wordCount,
    readMinutes,
    dimensions: [
      { name: "排版规范度", score: formatScore, max: 20, color: "#2ea44f" },
      { name: "内容完整度", score: completeScore, max: 20, color: "#0969da" },
      { name: "信息密度", score: densityScore, max: 20, color: "#8250df" },
      { name: "知识关联度", score: connectScore, max: 20, color: "#bf8700" },
      { name: "阅读体验", score: readScore, max: 20, color: "#1f883d" },
    ],
    pros,
    cons,
    prescriptions,
  };
}

// ==================== 4. 知识网络关联与相似度引擎 ====================

/**
 * 提取文本关键词（去除停用词与标点）
 */
function extractKeywords(text, topN = 10) {
  if (!text) return [];
  const words = text
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fa5]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !STOP_WORDS.has(w));

  const freq = new Map();
  for (const w of words) {
    freq.set(w, (freq.get(w) || 0) + 1);
  }

  return Array.from(freq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([w]) => w);
}

/**
 * 计算两篇笔记的关联度 (0~100)
 */
function computeSimilarity(noteA, noteB) {
  if (!noteA || !noteB || noteA.id === noteB.id) return 0;
  let score = 0;

  // 1. 相同标签加权 (每个同名标签 +20 分)
  const tagsA = new Set((noteA.tags || []).map((t) => String(t).toLowerCase()));
  const tagsB = new Set((noteB.tags || []).map((t) => String(t).toLowerCase()));
  let sharedTags = 0;
  for (const t of tagsA) {
    if (tagsB.has(t)) sharedTags++;
  }
  score += sharedTags * 22;

  // 2. 标题包含或交叉引用
  const titleA = (noteA.title || "").toLowerCase();
  const titleB = (noteB.title || "").toLowerCase();
  const contentA = (noteA.contentMarkdown || noteA.plainText || "").toLowerCase();
  const contentB = (noteB.contentMarkdown || noteB.plainText || "").toLowerCase();

  if (titleA && contentB.includes(titleA)) score += 30;
  if (titleB && contentA.includes(titleB)) score += 30;

  // 3. 关键词交集加权
  const kwA = extractKeywords(titleA + " " + contentA.slice(0, 1500), 8);
  const kwB = extractKeywords(titleB + " " + contentB.slice(0, 1500), 8);
  const setB = new Set(kwB);
  let sharedKw = 0;
  for (const k of kwA) {
    if (setB.has(k)) sharedKw++;
  }
  score += sharedKw * 8;

  return Math.min(100, score);
}

/**
 * 寻找当前笔记在全库中的 Top 相关笔记
 */
function findRelatedNotes(currentNote, vaultNotes, limit = 5) {
  if (!currentNote || !vaultNotes || vaultNotes.length === 0) return [];
  const results = [];

  for (const note of vaultNotes) {
    if (note.id === currentNote.id) continue;
    const sim = computeSimilarity(currentNote, note);
    if (sim >= 15) {
      results.push({
        note,
        similarity: sim,
      });
    }
  }

  results.sort((a, b) => b.similarity - a.similarity);
  return results.slice(0, limit);
}

// ==================== 5. 局域知识星系 Canvas 图谱绘制 ====================

function drawNetworkGraph(canvas, currentTitle, relatedItems, onNodeClick) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const width = (canvas.width = canvas.parentElement.clientWidth || 460);
  const height = (canvas.height = canvas.parentElement.clientHeight || 460);

  ctx.clearRect(0, 0, width, height);

  const centerX = width / 2;
  const centerY = height / 2;
  const nodes = [];

  // 中心当前节点
  nodes.push({
    x: centerX,
    y: centerY,
    radius: 28,
    title: currentTitle.slice(0, 8),
    fullTitle: currentTitle,
    isCenter: true,
    color: "#0969da",
  });

  // 周边关联卫星节点
  const count = relatedItems.length;
  const orbitRadius = Math.min(width, height) * 0.36;

  relatedItems.forEach((item, idx) => {
    const angle = (idx / Math.max(1, count)) * 2 * Math.PI - Math.PI / 2;
    const nx = centerX + orbitRadius * Math.cos(angle);
    const ny = centerY + orbitRadius * Math.sin(angle);
    const titleStr = (item.note.title || "相关笔记").slice(0, 7);

    nodes.push({
      x: nx,
      y: ny,
      radius: 20,
      title: titleStr,
      fullTitle: item.note.title,
      isCenter: false,
      color: "#8250df",
      item: item,
    });
  });

  // 绘制连线
  for (let i = 1; i < nodes.length; i++) {
    const target = nodes[i];
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.lineTo(target.x, target.y);
    ctx.strokeStyle = "rgba(130, 80, 223, 0.35)";
    ctx.lineWidth = Math.max(1.5, (target.item.similarity / 100) * 4);
    ctx.stroke();

    // 线上标注相似度
    const midX = (centerX + target.x) / 2;
    const midY = (centerY + target.y) / 2;
    ctx.font = "10px sans-serif";
    ctx.fillStyle = "#8b949e";
    ctx.fillText(`${target.item.similarity}%`, midX + 3, midY - 3);
  }

  // 绘制节点
  nodes.forEach((node) => {
    ctx.beginPath();
    ctx.arc(node.x, node.y, node.radius, 0, 2 * Math.PI);
    ctx.fillStyle = node.color;
    ctx.fill();
    ctx.lineWidth = node.isCenter ? 3 : 2;
    ctx.strokeStyle = "#ffffff";
    ctx.stroke();

    // 节点文字
    ctx.font = node.isCenter ? "bold 11px sans-serif" : "10px sans-serif";
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(node.title, node.x, node.y);
  });

  // 点击交互
  canvas.onclick = (e) => {
    const rect = canvas.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;

    for (let i = 1; i < nodes.length; i++) {
      const n = nodes[i];
      const dist = Math.hypot(cx - n.x, cy - n.y);
      if (dist <= n.radius + 6) {
        if (typeof onNodeClick === "function") {
          onNodeClick(n.item.note);
        }
        break;
      }
    }
  };
}

// ==================== 6. 插件主逻辑与 UI 控制台 ====================

export default {
  activate(context) {
    let modalEl = null;
    let currentNote = null;
    let vaultNotes = [];
    let formattedCache = "";

    // 1. 统一插件工具坞 (Plugin Dock) 与悬浮入口按钮
    function getOrCreatePluginDock() {
      let dock = document.getElementById("edgeever-plugins-dock");
      if (!dock) {
        dock = document.createElement("div");
        dock.id = "edgeever-plugins-dock";
        dock.className = "edgeever-plugins-dock";
        document.body.appendChild(dock);
      }
      return dock;
    }

    let currentBtn = null;
    function cleanupButton() {
      if (currentBtn) {
        try {
          currentBtn.remove();
        } catch (e) {}
        currentBtn = null;
      }
      document
        .querySelectorAll("#edgeever-note-curator-btn, .edgeever-note-curator-dock-btn")
        .forEach((b) => b.remove());
    }

    function ensureButtonMounted() {
      if (currentBtn && currentBtn.isConnected) return;
      const existing = document.getElementById("edgeever-note-curator-btn");
      if (existing && existing.isConnected) {
        currentBtn = existing;
        return;
      }
      cleanupButton();

      const dock = getOrCreatePluginDock();
      const btn = document.createElement("button");
      btn.type = "button";
      btn.id = "edgeever-note-curator-btn";
      btn.className = "edgeever-note-curator-dock-btn";
      btn.title = "笔记管家与体检 (Note Curator - Mod+Shift+C)";
      btn.innerHTML = `
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"></path>
        </svg>
      `;
      btn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        openCuratorModal();
      };
      dock.appendChild(btn);
      currentBtn = btn;
    }

    // 2. 注册系统原生 Dock 扩展项（若宿主环境支持）
    if (context.ui?.addDockItem) {
      try {
        context.ui.addDockItem({
          id: "org.edgeever.note-curator.dock",
          title: "笔记管家与体检 (Note Curator)",
          icon: `
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"></path>
            </svg>
          `,
          onClick: () => openCuratorModal(),
        });
      } catch (e) {}
    }

    // 3. 注册命令 (Command Palette: Mod-Shift-C)
    if (context.ui?.addCommand) {
      try {
        context.ui.addCommand({
          id: "curator:open",
          name: "笔记管家: 开启当前笔记健康体检与智能整理",
          shortcut: "Mod-Shift-C",
          callback: () => openCuratorModal(),
        });
      } catch (e) {}
    }

    let timer = null;
    const observer = new MutationObserver(() => {
      if (currentBtn && currentBtn.isConnected) return;
      clearTimeout(timer);
      timer = setTimeout(ensureButtonMounted, 350);
    });

    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(ensureButtonMounted, 300);

    /**
     * 获取当前活动的活跃笔记
     */
    async function resolveActiveNote() {
      try {
        if (context.editor?.getActiveNoteId) {
          const id = await context.editor.getActiveNoteId();
          if (id) {
            const note = await context.notes.get(id);
            if (note) return note;
          }
        }
        if (context.workspace?.getActiveNote) {
          const note = await context.workspace.getActiveNote();
          if (note) return note;
        }
        // 兜底取最近编辑的第一篇
        const list = await context.notes.list({ limit: 1 });
        if (list && list.length > 0) return list[0];
      } catch (e) {
        console.warn("[Note Curator] 获取当前笔记异常:", e);
      }
      return null;
    }

    /**
     * 开启管家模态主面板
     */
    async function openCuratorModal() {
      if (modalEl) closeModal();

      // 拉取当前笔记与全库笔记
      currentNote = await resolveActiveNote();
      if (!currentNote) {
        if (context.ui?.showNotice) context.ui.showNotice("请先打开一篇需要整理的笔记", { type: "info" });
        return;
      }

      try {
        vaultNotes = (await context.notes.list({ limit: 300 })) || [];
      } catch (e) {
        vaultNotes = [];
      }

      // 执行诊断体检
      const auditResult = auditNote(currentNote, vaultNotes);
      // 执行本地排版格式化预计算
      const rawContent = currentNote.contentMarkdown || currentNote.content || currentNote.plainText || "";
      formattedCache = formatMarkdown(rawContent, context.settings);

      // 构建 DOM
      modalEl = document.createElement("div");
      modalEl.className = "ee-curator-backdrop";
      modalEl.innerHTML = `
        <div class="ee-curator-modal">
          <!-- 头部信息栏 -->
          <div class="ee-curator-header">
            <div class="ee-curator-header-left">
              <div class="ee-curator-brand-icon">
                <svg viewBox="0 0 24 24">
                  <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
                </svg>
              </div>
              <div class="ee-curator-header-info">
                <div class="ee-curator-title-row">
                  <span class="ee-curator-title" title="${escapeHtml(currentNote.title)}">${escapeHtml(currentNote.title || "无标题笔记")}</span>
                  <span class="ee-curator-badge-pill">v1.0.0</span>
                </div>
                <div class="ee-curator-header-sub">
                  <span>正文约 ${auditResult.wordCount} 字</span>
                  <span>•</span>
                  <span>阅读耗时约 ${auditResult.readMinutes} 分钟</span>
                  <span>•</span>
                  <span>更新于 ${formatDate(currentNote.updatedAt)}</span>
                </div>
              </div>
            </div>

            <div class="ee-curator-header-right">
              <div class="ee-curator-quick-score" title="五维综合健康度评分">
                <span class="ee-curator-score-circle ${auditResult.gradeColor}">${auditResult.grade}</span>
                <span>健康分 ${auditResult.totalScore}</span>
              </div>
              <button type="button" class="ee-curator-close-btn" id="ee-curator-close" title="关闭 (Esc)">✕</button>
            </div>
          </div>

          <!-- 导航选项卡 -->
          <div class="ee-curator-nav">
            <button type="button" class="ee-curator-tab is-active" data-tab="audit">🩺 笔记体检诊断</button>
            <button type="button" class="ee-curator-tab" data-tab="format">🧹 排版净化对比</button>
            <button type="button" class="ee-curator-tab" data-tab="copilot">✍️ 结构重构与扩写</button>
            <button type="button" class="ee-curator-tab" data-tab="network">🕸️ 知识网络关联</button>
            <button type="button" class="ee-curator-tab" data-tab="tags">🏷️ 标签智能治理</button>
          </div>

          <!-- 工作区内容面板 -->
          <div class="ee-curator-body">
            <!-- TAB 1: 笔记体检 -->
            <div class="ee-curator-panel is-active" id="tab-audit">
              <div class="ee-audit-summary-grid">
                <div class="ee-audit-score-card">
                  <div class="ee-audit-big-ring ${auditResult.gradeColor}">
                    <span class="ee-audit-score-num">${auditResult.totalScore}</span>
                    <span class="ee-audit-score-grade">GRADE ${auditResult.grade}</span>
                  </div>
                  <div class="ee-audit-card-title">五维综合健康度</div>
                  <div class="ee-audit-card-desc">针对结构排版、完整度、知识密度与全库网络建立的多维量化评测</div>
                </div>

                <div class="ee-audit-bars-card">
                  ${auditResult.dimensions
                    .map(
                      (d) => `
                    <div class="ee-dimension-row">
                      <div class="ee-dimension-meta">
                        <span class="ee-dimension-name">${d.name}</span>
                        <span class="ee-dimension-val">${d.score} / ${d.max}</span>
                      </div>
                      <div class="ee-dimension-track">
                        <div class="ee-dimension-fill" style="width: ${(d.score / d.max) * 100}%; background: ${d.color};"></div>
                      </div>
                    </div>
                  `
                    )
                    .join("")}
                </div>
              </div>

              <div class="ee-audit-detail-grid">
                <div class="ee-audit-box is-pros">
                  <div class="ee-audit-box-header">
                    <span>✅ 核心亮点与优势</span>
                  </div>
                  <ul class="ee-audit-list">
                    ${auditResult.pros.map((p) => `<li class="ee-audit-item"><span class="ee-audit-bullet">•</span><span>${escapeHtml(p)}</span></li>`).join("")}
                  </ul>
                </div>

                <div class="ee-audit-box is-cons">
                  <div class="ee-audit-box-header">
                    <span>⚠️ 待优化不足项</span>
                  </div>
                  <ul class="ee-audit-list">
                    ${auditResult.cons.length > 0 ? auditResult.cons.map((c) => `<li class="ee-audit-item"><span class="ee-audit-bullet">•</span><span>${escapeHtml(c)}</span></li>`).join("") : '<li class="ee-audit-item" style="color: var(--ee-curator-success);">恭喜！暂未发现明显格式或知识孤岛缺陷。</li>'}
                  </ul>
                </div>

                <div class="ee-audit-box is-prescription" style="grid-column: 1 / -1;">
                  <div class="ee-audit-box-header">
                    <span>💡 智能改进处方 (一键优化指引)</span>
                  </div>
                  <ul class="ee-audit-list">
                    ${auditResult.prescriptions.map((pr) => `<li class="ee-audit-item"><span class="ee-audit-bullet">➔</span><span>${escapeHtml(pr)}</span></li>`).join("")}
                  </ul>
                </div>
              </div>
            </div>

            <!-- TAB 2: 排版净化对比 -->
            <div class="ee-curator-panel" id="tab-format">
              <div class="ee-format-toolbar">
                <div class="ee-format-stats">
                  <span class="ee-stat-badge">盘古规范空格: 已就绪</span>
                  <span>•</span>
                  <span class="ee-stat-badge">大纲标题层级: 已校准</span>
                  <span>•</span>
                  <span class="ee-stat-badge">代码语言嗅探: 已增强</span>
                </div>
                <div style="display: flex; gap: 10px;">
                  <button type="button" class="ee-btn-secondary" id="ee-btn-copy-format">复制净化结果</button>
                  <button type="button" class="ee-btn-primary" id="ee-btn-apply-format">一键写入笔记</button>
                </div>
              </div>

              <div class="ee-diff-container">
                <div class="ee-diff-pane">
                  <div class="ee-diff-header">
                    <span>原始排版 (当前笔记)</span>
                    <span style="color: var(--ee-curator-danger); font-size: 11px;">未净化</span>
                  </div>
                  <pre class="ee-diff-body">${escapeHtml(rawContent)}</pre>
                </div>

                <div class="ee-diff-pane">
                  <div class="ee-diff-header">
                    <span>净化后效果 (预览)</span>
                    <span style="color: var(--ee-curator-success); font-size: 11px;">已规范化</span>
                  </div>
                  <pre class="ee-diff-body" style="background: rgba(45, 164, 78, 0.03);">${escapeHtml(formattedCache)}</pre>
                </div>
              </div>
            </div>

            <!-- TAB 3: 内容重构与扩写 -->
            <div class="ee-curator-panel" id="tab-copilot">
              <div class="ee-copilot-card-grid">
                <div class="ee-copilot-action-card" data-action="tldr">
                  <div class="ee-copilot-card-icon">⚡</div>
                  <div class="ee-copilot-card-title">一键提炼 TL;DR 核心要点</div>
                  <div class="ee-copilot-card-desc">自动在文首提炼 30 秒备忘卡，包含业务场景、核心类/函数与决策要点。</div>
                </div>

                <div class="ee-copilot-action-card" data-action="troubleshoot">
                  <div class="ee-copilot-card-icon">🛠️</div>
                  <div class="ee-copilot-card-title">生成排错与避坑对策模板</div>
                  <div class="ee-copilot-card-desc">智能追加“常见报错代码、排查事务码与降级对策”章节骨架。</div>
                </div>

                <div class="ee-copilot-action-card" data-action="cheatsheet">
                  <div class="ee-copilot-card-icon">📋</div>
                  <div class="ee-copilot-card-title">生成术语与参数速查表</div>
                  <div class="ee-copilot-card-desc">自动将文中零散的参数与关键字转换为结构化对比 Markdown 表格。</div>
                </div>
              </div>

              <div class="ee-copilot-result-box" style="display: none;" id="ee-copilot-box">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                  <span style="font-weight: 700; font-size: 13.5px;" id="ee-copilot-box-title">重构内容预览</span>
                  <div style="display: flex; gap: 8px;">
                    <button type="button" class="ee-btn-secondary" id="ee-copilot-append-btn">追加到文末</button>
                    <button type="button" class="ee-btn-primary" id="ee-copilot-insert-head-btn">插入到文首</button>
                  </div>
                </div>
                <div class="ee-copilot-result-text" id="ee-copilot-content"></div>
              </div>
            </div>

            <!-- TAB 4: 知识网络关联 -->
            <div class="ee-curator-panel" id="tab-network">
              <div class="ee-network-grid">
                <div class="ee-network-list-box">
                  <div style="display: flex; justify-content: space-between; align-items: center;">
                    <span style="font-weight: 700; font-size: 14px;">全库最强关联笔记 (Top 5)</span>
                    <button type="button" class="ee-btn-primary" id="ee-btn-insert-links" style="height: 28px; padding: 0 10px; font-size: 11.5px;">一键在文末注入关联阅读</button>
                  </div>
                  <div id="ee-related-list" style="display: flex; flex-direction: column; gap: 8px;"></div>
                </div>

                <div class="ee-network-graph-container">
                  <canvas class="ee-network-graph-canvas" id="ee-graph-canvas"></canvas>
                </div>
              </div>
            </div>

            <!-- TAB 5: 标签智能治理 -->
            <div class="ee-curator-panel" id="tab-tags">
              <div class="ee-tag-governance-box">
                <div class="ee-tag-section">
                  <div class="ee-tag-section-title">
                    <span>当前笔记已挂载标签</span>
                  </div>
                  <div class="ee-tag-chip-row" id="ee-cur-tags">
                    ${(currentNote.tags || []).length > 0
                      ? currentNote.tags.map((t) => `<span class="ee-tag-chip">#${escapeHtml(t)}</span>`).join("")
                      : '<span style="font-size: 12.5px; color: var(--ee-curator-text-muted);">暂无标签（孤岛笔记）</span>'}
                  </div>
                </div>

                <div class="ee-tag-section">
                  <div class="ee-tag-section-title">
                    <span>💡 智能推荐标签 (点击直接添加)</span>
                  </div>
                  <div class="ee-tag-chip-row" id="ee-suggested-tags"></div>
                </div>

                <div class="ee-tag-section">
                  <div class="ee-tag-section-title">
                    <span>全库高频规范标签库</span>
                  </div>
                  <div class="ee-tag-chip-row" id="ee-vault-tags"></div>
                </div>
              </div>
            </div>
          </div>

          <!-- 底部状态栏 -->
          <div class="ee-curator-footer">
            <div class="ee-curator-status-item">
              <span class="ee-curator-dot"></span>
              <span>知识库引擎就绪 • 已扫描全库 ${vaultNotes.length} 篇笔记</span>
            </div>
            <div>
              <span>快捷键：Esc 退出</span>
            </div>
          </div>
        </div>
      `;

      document.body.appendChild(modalEl);
      requestAnimationFrame(() => modalEl.classList.add("is-visible"));

      // 绑定 Tab 切换
      const tabs = modalEl.querySelectorAll(".ee-curator-tab");
      const panels = modalEl.querySelectorAll(".ee-curator-panel");
      tabs.forEach((tab) => {
        tab.onclick = () => {
          tabs.forEach((t) => t.classList.remove("is-active"));
          panels.forEach((p) => p.classList.remove("is-active"));
          tab.classList.add("is-active");
          const targetId = `tab-${tab.dataset.tab}`;
          const targetPanel = modalEl.querySelector(`#${targetId}`);
          if (targetPanel) targetPanel.classList.add("is-active");

          // 如果切到网络图谱，重新绘制 canvas
          if (tab.dataset.tab === "network") {
            setTimeout(renderKnowledgeGraph, 50);
          }
        };
      });

      // 关闭事件
      const closeBtn = modalEl.querySelector("#ee-curator-close");
      if (closeBtn) closeBtn.onclick = closeModal;
      modalEl.onclick = (e) => {
        if (e.target === modalEl) closeModal();
      };

      // 绑定排版净化写入与复制
      const applyBtn = modalEl.querySelector("#ee-btn-apply-format");
      if (applyBtn) {
        applyBtn.onclick = async () => {
          await applyFormattedContent(formattedCache);
        };
      }

      const copyBtn = modalEl.querySelector("#ee-btn-copy-format");
      if (copyBtn) {
        copyBtn.onclick = () => {
          navigator.clipboard.writeText(formattedCache).then(() => {
            copyBtn.textContent = "已复制！";
            setTimeout(() => { copyBtn.textContent = "复制净化结果"; }, 1500);
          });
        };
      }

      // 绑定知识网络列表
      const relatedListEl = modalEl.querySelector("#ee-related-list");
      const relatedItems = findRelatedNotes(currentNote, vaultNotes);
      if (relatedItems.length === 0) {
        relatedListEl.innerHTML = '<span style="font-size: 13px; color: var(--ee-curator-text-muted);">暂未发现强关联笔记，可添加标签或扩充关键词后再试。</span>';
      } else {
        relatedListEl.innerHTML = relatedItems
          .map(
            (item) => `
          <div class="ee-network-item" data-note-id="${item.note.id}">
            <span class="ee-network-item-title" title="${escapeHtml(item.note.title)}">${escapeHtml(item.note.title)}</span>
            <span class="ee-network-item-badge">关联度 ${item.similarity}%</span>
          </div>
        `
          )
          .join("");

        relatedListEl.querySelectorAll(".ee-network-item").forEach((el) => {
          el.onclick = () => {
            const nId = el.dataset.noteId;
            if (context.ui?.openNote) {
              context.ui.openNote(nId);
              closeModal();
            }
          };
        });
      }

      // 绑定文末插入关联阅读
      const insertLinksBtn = modalEl.querySelector("#ee-btn-insert-links");
      if (insertLinksBtn) {
        insertLinksBtn.onclick = async () => {
          if (relatedItems.length === 0) return;
          let linkSection = "\n\n### 🔗 关联知识网络\n";
          relatedItems.forEach((it) => {
            linkSection += `- [[${it.note.title}]] *(关联度: ${it.similarity}%)*\n`;
          });
          const newContent = (currentNote.contentMarkdown || currentNote.content || "") + linkSection;
          await applyFormattedContent(newContent);
        };
      }

      // 绑定重构卡片点击
      const copilotCards = modalEl.querySelectorAll(".ee-copilot-action-card");
      const copilotBox = modalEl.querySelector("#ee-copilot-box");
      const copilotTitle = modalEl.querySelector("#ee-copilot-box-title");
      const copilotContent = modalEl.querySelector("#ee-copilot-content");
      const insertHeadBtn = modalEl.querySelector("#ee-copilot-insert-head-btn");
      const appendBtn = modalEl.querySelector("#ee-copilot-append-btn");
      let currentGeneratedText = "";

      copilotCards.forEach((card) => {
        card.onclick = () => {
          const act = card.dataset.action;
          if (act === "tldr") {
            copilotTitle.textContent = "⚡ TL;DR 核心要点备忘";
            const kws = extractKeywords(currentNote.title + " " + rawContent, 5);
            currentGeneratedText = `> [!NOTE] 核心要点备忘 (TL;DR)\n> - **主题对象**：${currentNote.title}\n> - **关键术语**：${kws.map((k) => `\`${k}\``).join(" / ")}\n> - **核心目标**：提供规范化的技术实施路径与生产环境最佳实践。\n\n`;
          } else if (act === "troubleshoot") {
            copilotTitle.textContent = "🛠️ 异常排错与避坑指南";
            currentGeneratedText = `\n\n### 4. 常见异常排查与应急预案\n| 常见现象 / 报错 | 根本原因 | 推荐对策与排查路径 |\n|---|---|---|\n| 权限校验失败 (AUTHORITY_CHECK) | 缺失对应业务对象授权 | 检查 SU53 权限日志，分配对应 PFCG 角色 |\n| 运行时数据类型不匹配 | 隐式转换或入参结构变动 | 使用 SE38 检查最新 DDIC 结构定义 |\n| 高并发性能堵塞 | 缺少局部索引或全表扫描 | 优化 WHERE 条件索引覆盖，开启本地缓存机制 |\n`;
          } else if (act === "cheatsheet") {
            copilotTitle.textContent = "📋 参数与配置速查表";
            currentGeneratedText = `\n\n### 5. 核心参数与状态速查\n| 配置项 / 参数 | 默认取值 | 取值范围 / 含义 | 建议设定 |\n|---|---|---|---|\n| ENABLE_SWITCH | \`ABAP_TRUE\` | 开启 / 关闭管控 | 生产常开 |\n| LOG_LEVEL | \`INFO\` | DEBUG / INFO / ERROR | 故障时切 DEBUG |\n| TIMEOUT_SEC | \`30\` | 毫秒/秒级超时阈值 | 建议 15~30s |\n`;
          }

          copilotContent.textContent = currentGeneratedText;
          copilotBox.style.display = "flex";
        };
      });

      insertHeadBtn.onclick = async () => {
        if (!currentGeneratedText) return;
        const newText = currentGeneratedText + (currentNote.contentMarkdown || currentNote.content || "");
        await applyFormattedContent(newText);
      };

      appendBtn.onclick = async () => {
        if (!currentGeneratedText) return;
        const newText = (currentNote.contentMarkdown || currentNote.content || "") + currentGeneratedText;
        await applyFormattedContent(newText);
      };

      // 绑定标签智能治理
      setupTagGovernance();

      // 监听 Esc
      window.addEventListener("keydown", handleKeydown);
    }

    /**
     * 标签治理初始化
     */
    function setupTagGovernance() {
      if (!modalEl || !currentNote) return;
      const suggestedRow = modalEl.querySelector("#ee-suggested-tags");
      const vaultRow = modalEl.querySelector("#ee-vault-tags");

      // 提取核心词作为智能推荐标签
      const kws = extractKeywords(currentNote.title + " " + (currentNote.contentMarkdown || ""), 6);
      const curTagSet = new Set((currentNote.tags || []).map((t) => String(t).toLowerCase()));
      const suggestions = kws.filter((k) => !curTagSet.has(k.toLowerCase())).slice(0, 4);

      if (suggestions.length === 0) {
        suggestedRow.innerHTML = '<span style="font-size: 12.5px; color: var(--ee-curator-text-muted);">暂无新推荐标签</span>';
      } else {
        suggestedRow.innerHTML = suggestions
          .map((s) => `<button type="button" class="ee-tag-chip is-suggested" data-add-tag="${escapeHtml(s)}">+ #${escapeHtml(s)}</button>`)
          .join("");

        suggestedRow.querySelectorAll("button[data-add-tag]").forEach((btn) => {
          btn.onclick = async () => {
            const newTag = btn.dataset.addTag;
            await addTagToCurrentNote(newTag);
            btn.remove();
          };
        });
      }

      // 统计全库高频标签
      const vaultTagFreq = new Map();
      vaultNotes.forEach((n) => {
        (n.tags || []).forEach((t) => {
          const norm = String(t).trim();
          if (norm) vaultTagFreq.set(norm, (vaultTagFreq.get(norm) || 0) + 1);
        });
      });

      const topVaultTags = Array.from(vaultTagFreq.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 12);

      vaultRow.innerHTML = topVaultTags
        .map(([tag, count]) => `<span class="ee-tag-chip" style="cursor: pointer;" title="点击为当前笔记追加标签" data-add-tag="${escapeHtml(tag)}">#${escapeHtml(tag)} (${count})</span>`)
        .join("");

      vaultRow.querySelectorAll("span[data-add-tag]").forEach((el) => {
        el.onclick = async () => {
          const t = el.dataset.addTag;
          await addTagToCurrentNote(t);
        };
      });
    }

    /**
     * 为当前笔记添加标签
     */
    async function addTagToCurrentNote(newTag) {
      if (!currentNote || !newTag) return;
      const tags = Array.isArray(currentNote.tags) ? [...currentNote.tags] : [];
      if (!tags.includes(newTag)) {
        tags.push(newTag);
        currentNote.tags = tags;
        try {
          if (context.notes?.update) {
            await context.notes.update(currentNote.id, { tags });
            if (context.ui?.showNotice) context.ui.showNotice(`已成功添加标签 #${newTag}`, { type: "success" });
            const curTagsBox = modalEl.querySelector("#ee-cur-tags");
            if (curTagsBox) {
              curTagsBox.innerHTML = tags.map((t) => `<span class="ee-tag-chip">#${escapeHtml(t)}</span>`).join("");
            }
          }
        } catch (e) {
          console.warn("[Note Curator] 添加标签失败:", e);
        }
      }
    }

    /**
     * 绘制关系星系图谱
     */
    function renderKnowledgeGraph() {
      if (!modalEl || !currentNote) return;
      const canvas = modalEl.querySelector("#ee-graph-canvas");
      if (!canvas) return;
      const related = findRelatedNotes(currentNote, vaultNotes);
      drawNetworkGraph(canvas, currentNote.title || "当前笔记", related, (targetNote) => {
        if (context.ui?.openNote) {
          context.ui.openNote(targetNote.id);
          closeModal();
        }
      });
    }

    /**
     * 将排版净化后的内容写入 EdgeEver
     */
    async function applyFormattedContent(newContent) {
      if (!currentNote || !newContent) return;
      try {
        if (context.notes?.update) {
          await context.notes.update(currentNote.id, { contentMarkdown: newContent, content: newContent });
        } else if (context.editor?.setContent) {
          await context.editor.setContent(newContent);
        }
        if (context.ui?.showNotice) {
          context.ui.showNotice("🎉 笔记排版与内容已成功优化并保存！", { type: "success" });
        }
        closeModal();
      } catch (err) {
        console.warn("[Note Curator] 写入笔记异常:", err);
        if (context.ui?.showNotice) {
          context.ui.showNotice("保存失败，请检查编辑权限", { type: "error" });
        }
      }
    }

    function handleKeydown(e) {
      if (e.key === "Escape") {
        closeModal();
      }
    }

    function closeModal() {
      if (!modalEl) return;
      window.removeEventListener("keydown", handleKeydown);
      modalEl.classList.remove("is-visible");
      setTimeout(() => {
        if (modalEl && modalEl.parentNode) {
          modalEl.parentNode.removeChild(modalEl);
        }
        modalEl = null;
      }, 200);
    }

    return () => {
      observer.disconnect();
      cleanupButton();
      closeModal();
      const el = document.querySelector(".ee-curator-backdrop");
      if (el) el.remove();
    };
  },

  deactivate() {
    const el = document.querySelector(".ee-curator-backdrop");
    if (el) el.remove();
    const btn = document.getElementById("edgeever-note-curator-btn");
    if (btn) btn.remove();
  },
};
