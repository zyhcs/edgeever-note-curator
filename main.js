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

    let settings = {
      aiProvider: "edgeever",
      aiBaseUrl: "http://127.0.0.1:11434/v1",
      aiApiKey: "",
      aiModel: "deepseek-chat",
      autoPanguSpacing: true,
      autoFixHeadings: true,
      autoCodeDetect: true,
    };

    async function loadSettings() {
      try {
        const prov = await context.settings?.get?.("ai_provider");
        if (prov) settings.aiProvider = String(prov);
        const url = await context.settings?.get?.("ai_base_url");
        if (url) settings.aiBaseUrl = String(url);
        const key = await context.settings?.get?.("ai_api_key");
        if (key) settings.aiApiKey = String(key);
        const model = await context.settings?.get?.("ai_model");
        if (model) settings.aiModel = String(model);

        const pangu = await context.settings?.get?.("auto_pangu_spacing");
        if (pangu !== undefined && pangu !== null) settings.autoPanguSpacing = Boolean(pangu);
        const headings = await context.settings?.get?.("auto_fix_headings");
        if (headings !== undefined && headings !== null) settings.autoFixHeadings = Boolean(headings);
        const code = await context.settings?.get?.("auto_code_detect");
        if (code !== undefined && code !== null) settings.autoCodeDetect = Boolean(code);
      } catch (e) {
        console.warn("[Note Curator] loadSettings error:", e);
      }
    }

    loadSettings();

    const onSettingsChanged = context.events?.on?.("settings.changed", async () => {
      await loadSettings();
    });

    /**
     * 智能调用 AI 引擎（支持 EdgeEver 客户端原生已配置的 AI，以及自定义/本地代理）
     */
    async function callAi(prompt, systemPrompt, statusCallback = () => {}) {
      const provider = settings.aiProvider || "edgeever";

      // 1. 首选 EdgeEver 客户端原生已配置的 AI 模型
      if (provider === "edgeever") {
        if (!context.ai || typeof context.ai.generate !== "function") {
          throw new Error("当前 EdgeEver 版本未提供 context.ai 模块，请检查客户端版本或在设置中切换为「自定义/本地代理」模式。");
        }

        try {
          if (context.ai.status) {
            const status = await context.ai.status();
            if (status && status.configured === false) {
              throw new Error("EdgeEver 客户端尚未配置默认 AI 模型！请在 EdgeEver 工作区左下角「设置 -> AI」中配置大模型，或在插件设置中切换为「自定义/本地代理」。");
            }
          }
        } catch (e) {
          if (e.message && e.message.includes("尚未配置")) throw e;
        }

        statusCallback("正在调用 EdgeEver 客户端已配置的 AI 模型进行深度分析...");
        const res = await context.ai.generate({
          system: systemPrompt,
          prompt: prompt,
          maxOutputTokens: 6000,
        });

        if (!res || !res.text) {
          throw new Error("EdgeEver 客户端 AI 返回内容为空，请稍后重试。");
        }
        return res.text;
      }

      // 2. 自定义 OpenAI 兼容代理 / 本地代理 (Ollama / DeepSeek / LM Studio 等)
      statusCallback("正在连接自定义/本地 AI 代理...");
      const baseUrl = (settings.aiBaseUrl || "http://127.0.0.1:11434/v1").replace(/\/+$/, "");
      const apiKey = (settings.aiApiKey || "").trim();
      const model = (settings.aiModel || "deepseek-chat").trim();

      const isLocal = baseUrl.includes("localhost") || baseUrl.includes("127.0.0.1");
      if (!apiKey && !isLocal) {
        throw new Error("使用自定义云端 AI 时请在设置中配置有效 API Key（本地 Ollama / LM Studio 无需配置）。");
      }

      const endpoint = `${baseUrl}/chat/completions`;
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: prompt },
          ],
          temperature: 0.6,
          max_tokens: 4000,
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`AI 代理返回异常 (${response.status}): ${errText.slice(0, 150)}`);
      }

      const result = await response.json();
      const text = result?.choices?.[0]?.message?.content || "";
      if (!text) {
        throw new Error("AI 代理未返回任何有效文本内容。");
      }
      return text;
    }

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
     * 获取当前活动的活跃笔记 (全面覆盖 EdgeEver 官方规范与各种宿主版本)
     */
    async function resolveActiveNote() {
      try {
        // 1. 优先调用 context.editor.getDocument() (EdgeEver 官方标准编辑器文档 API)
        if (context.editor?.getDocument) {
          try {
            const doc = await context.editor.getDocument();
            if (doc) {
              const noteId = doc.noteId || doc.id;
              let note = null;
              if (noteId && context.notes?.get) {
                try {
                  note = await context.notes.get(noteId);
                } catch (e) {}
              }
              const content = doc.contentMarkdown ?? note?.contentMarkdown ?? doc.content ?? note?.content ?? "";
              const title = doc.title || note?.title || "未命名笔记";
              return {
                id: noteId || note?.id,
                noteId: noteId || note?.id,
                title,
                contentMarkdown: content,
                content: content,
                tags: note?.tags || doc?.tags || [],
                updatedAt: note?.updatedAt || doc?.updatedAt || Date.now(),
                createdAt: note?.createdAt || doc?.createdAt || Date.now(),
                ...note,
              };
            }
          } catch (e) {
            console.warn("[Note Curator] context.editor.getDocument 异常:", e);
          }
        }

        // 2. 尝试从 editor.getActiveNoteId 兜底
        if (context.editor?.getActiveNoteId) {
          try {
            const id = await context.editor.getActiveNoteId();
            if (id && context.notes?.get) {
              const note = await context.notes.get(id);
              if (note) return note;
            }
          } catch (e) {}
        }

        // 3. 尝试从 workspace.getActiveNote 兜底
        if (context.workspace?.getActiveNote) {
          try {
            const note = await context.workspace.getActiveNote();
            if (note) return note;
          } catch (e) {}
        }

        // 4. 兜底获取最近的一篇笔记 (通过 context.notes.query)
        if (context.notes?.query) {
          try {
            const qRes = await context.notes.query({ limit: 1 });
            const list = Array.isArray(qRes) ? qRes : qRes?.notes || [];
            if (list.length > 0) {
              const noteId = list[0].id;
              if (context.notes.get) {
                try {
                  const full = await context.notes.get(noteId);
                  if (full) return full;
                } catch (e) {}
              }
              return list[0];
            }
          } catch (e) {}
        }
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

      await loadSettings();

      // 拉取当前笔记与全库笔记
      currentNote = await resolveActiveNote();
      if (!currentNote) {
        if (context.ui?.showNotice) context.ui.showNotice("请先打开一篇需要整理的笔记", { type: "info" });
        return;
      }

      try {
        if (context.notes?.query) {
          const qRes = await context.notes.query({ limit: 300 });
          vaultNotes = Array.isArray(qRes) ? qRes : qRes?.notes || [];
        } else if (context.notes?.list) {
          vaultNotes = (await context.notes.list({ limit: 300 })) || [];
        }
      } catch (e) {
        vaultNotes = [];
      }

      // 执行诊断体检
      const auditResult = auditNote(currentNote, vaultNotes);
      // 执行本地排版格式化预计算
      const rawContent = currentNote.contentMarkdown || currentNote.content || currentNote.plainText || "";
      formattedCache = formatMarkdown(rawContent, settings);

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

                <div class="ee-audit-box is-ai-review" style="grid-column: 1 / -1;">
                  <div class="ee-audit-box-header" style="justify-content: space-between;">
                    <div style="display: flex; align-items: center; gap: 8px;">
                      <span>🤖 AI 专家深度技术体检与盲区诊断</span>
                      <span class="ee-curator-badge-pill" style="background: var(--ee-curator-purple-bg); color: var(--ee-curator-purple); font-size: 11px;">深度分析</span>
                    </div>
                    <button type="button" class="ee-btn-primary" id="ee-btn-trigger-ai-audit" style="height: 28px; padding: 0 12px; font-size: 12px; background: var(--ee-curator-purple);">
                      ✨ 启动 AI 深度评审
                    </button>
                  </div>
                  <div id="ee-ai-audit-content" style="font-size: 13px; line-height: 1.7; color: var(--ee-curator-text); padding-top: 6px;">
                    点击上方按钮，让 AI（支持 EdgeEver 客户端原生已配置的 AI 或本地 Ollama 代理）深度通读全文，从核心技术亮点、论述漏洞与潜在知识盲区进行专业客观评审。
                  </div>
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
                  <div class="ee-diff-body" id="ee-diff-original" data-code-pro-processed="true" data-no-code-pro="true">${escapeHtml(rawContent)}</div>
                </div>

                <div class="ee-diff-pane">
                  <div class="ee-diff-header">
                    <span>净化后效果 (预览)</span>
                    <span style="color: var(--ee-curator-success); font-size: 11px;">已规范化</span>
                  </div>
                  <div class="ee-diff-body" id="ee-diff-formatted" data-code-pro-processed="true" data-no-code-pro="true" style="background: rgba(45, 164, 78, 0.03);">${escapeHtml(formattedCache)}</div>
                </div>
              </div>
            </div>

            <!-- TAB 3: 内容重构与扩写 -->
            <div class="ee-curator-panel" id="tab-copilot">
              <div class="ee-copilot-card-grid">
                <div class="ee-copilot-action-card is-ai-card" data-action="ai-rewrite">
                  <div class="ee-copilot-card-icon">✨</div>
                  <div class="ee-copilot-card-title">AI 全文深度重构与润色</div>
                  <div class="ee-copilot-card-desc">智能重塑大纲逻辑、优化段落过渡与小节编号，补充知识归纳与排版规范。</div>
                </div>

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
                <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
                  <span style="font-weight: 700; font-size: 13.5px;" id="ee-copilot-box-title">重构内容预览</span>
                  <div style="display: flex; gap: 8px;">
                    <button type="button" class="ee-btn-primary" id="ee-copilot-replace-btn" style="display: none; background: var(--ee-curator-purple);">一键替换整篇正文</button>
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

      // 双栏平滑联动同步滚动
      const leftDiff = modalEl.querySelector("#ee-diff-original");
      const rightDiff = modalEl.querySelector("#ee-diff-formatted");
      if (leftDiff && rightDiff) {
        let isSyncing = false;
        leftDiff.addEventListener("scroll", () => {
          if (isSyncing) return;
          isSyncing = true;
          const maxLeft = leftDiff.scrollHeight - leftDiff.clientHeight;
          if (maxLeft > 0) {
            const ratio = leftDiff.scrollTop / maxLeft;
            const maxRight = rightDiff.scrollHeight - rightDiff.clientHeight;
            rightDiff.scrollTop = ratio * maxRight;
          }
          requestAnimationFrame(() => { isSyncing = false; });
        }, { passive: true });

        rightDiff.addEventListener("scroll", () => {
          if (isSyncing) return;
          isSyncing = true;
          const maxRight = rightDiff.scrollHeight - rightDiff.clientHeight;
          if (maxRight > 0) {
            const ratio = rightDiff.scrollTop / maxRight;
            const maxLeft = leftDiff.scrollHeight - leftDiff.clientHeight;
            leftDiff.scrollTop = ratio * maxLeft;
          }
          requestAnimationFrame(() => { isSyncing = false; });
        }, { passive: true });
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

      // 绑定 Tab 1 AI 专家体检评审
      const aiAuditBtn = modalEl.querySelector("#ee-btn-trigger-ai-audit");
      const aiAuditContent = modalEl.querySelector("#ee-ai-audit-content");
      if (aiAuditBtn && aiAuditContent) {
        aiAuditBtn.onclick = async () => {
          aiAuditBtn.classList.add("is-loading-ai");
          aiAuditBtn.disabled = true;
          aiAuditContent.innerHTML = `<span style="color: var(--ee-curator-primary);">🤖 正在连接 AI 引擎（模型: ${settings.aiProvider === "edgeever" ? "EdgeEver 客户端配置模型" : (settings.aiModel || "本地代理")}）进行全景审查评估...</span>`;

          const rawText = currentNote.contentMarkdown || currentNote.content || "";
          try {
            const sys = "你是一位资深的知识管理架构师与技术专家。请对这篇笔记进行全方位深度体检诊断。从【1. 核心亮点与技术沉淀价值】、【2. 知识盲区、漏洞与潜在风险】、【3. 下一步扩充与知识衍生建议】三个维度进行深度、专业、客观的剖析。使用 Markdown 格式直接输出诊断内容。";
            const pmt = `笔记标题：《${currentNote.title}》\n\n笔记正文：\n${rawText.slice(0, 4000)}`;
            const result = await callAi(pmt, sys, (msg) => {
              aiAuditContent.innerHTML = `<span style="color: var(--ee-curator-primary);">${escapeHtml(msg)}</span>`;
            });
            aiAuditContent.innerHTML = `<div style="white-space: pre-wrap; font-family: inherit; line-height: 1.7;">${escapeHtml(result)}</div>`;
          } catch (e) {
            aiAuditContent.innerHTML = `<span style="color: var(--ee-curator-warning);">⚠️ AI 体检未能完成: ${escapeHtml(e.message || "连接失败")}。已保留本地五维雷达诊断，您可在设置中检查客户端 AI 或配置本地 Ollama。</span>`;
          } finally {
            aiAuditBtn.classList.remove("is-loading-ai");
            aiAuditBtn.disabled = false;
          }
        };
      }

      // 绑定重构卡片点击
      const copilotCards = modalEl.querySelectorAll(".ee-copilot-action-card");
      const copilotBox = modalEl.querySelector("#ee-copilot-box");
      const copilotTitle = modalEl.querySelector("#ee-copilot-box-title");
      const copilotContent = modalEl.querySelector("#ee-copilot-content");
      const insertHeadBtn = modalEl.querySelector("#ee-copilot-insert-head-btn");
      const appendBtn = modalEl.querySelector("#ee-copilot-append-btn");
      const replaceBtn = modalEl.querySelector("#ee-copilot-replace-btn");
      let currentGeneratedText = "";

      copilotCards.forEach((card) => {
        card.onclick = async () => {
          const act = card.dataset.action;
          if (replaceBtn) {
            replaceBtn.style.display = act === "ai-rewrite" ? "inline-flex" : "none";
          }

          card.classList.add("is-loading-ai");
          copilotBox.style.display = "flex";
          copilotContent.innerHTML = `<span style="color: var(--ee-curator-primary);">🤖 正在连接 AI 引擎（${settings.aiProvider === "edgeever" ? "EdgeEver 客户端配置模型" : (settings.aiModel || "本地/自定义代理")}）生成中，请稍候...</span>`;

          const rawText = currentNote.contentMarkdown || currentNote.content || "";

          try {
            if (act === "ai-rewrite") {
              copilotTitle.textContent = "✨ AI 全文智能重构与深度润色";
              const sys = "你是一位知识库架构与技术文档撰写专家。请保持笔记核心逻辑、参数与代码不变，对整篇 Markdown 进行结构重构与表达润色，完善小节标题大纲（H1/H2/H3），规范中英文混排，直接输出润色后的 Markdown 正文，不要有任何多余闲聊。";
              const pmt = `笔记标题：《${currentNote.title}》\n\n笔记原始内容：\n${rawText}`;
              currentGeneratedText = await callAi(pmt, sys, (msg) => {
                copilotContent.innerHTML = `<span style="color: var(--ee-curator-primary);">${escapeHtml(msg)}</span>`;
              });
            } else if (act === "tldr") {
              copilotTitle.textContent = "⚡ AI 提炼 TL;DR 核心要点";
              const sys = "请为这篇笔记提炼一段高质量的 TL;DR 核心要点备忘卡片（采用 > [!NOTE] 引用块语法），包含【主题对象】、【核心概念与关键函数】、【3 条核心决策/实施要点】。直接输出 Markdown 引用块。";
              const pmt = `笔记标题：《${currentNote.title}》\n\n笔记内容：\n${rawText.slice(0, 3000)}`;
              currentGeneratedText = await callAi(pmt, sys, (msg) => {
                copilotContent.innerHTML = `<span style="color: var(--ee-curator-primary);">${escapeHtml(msg)}</span>`;
              });
            } else if (act === "troubleshoot") {
              copilotTitle.textContent = "🛠️ 智能排错与避坑对策";
              const sys = "请结合笔记主题，生成一份【常见异常排查与应急预案】Markdown 表格，包含【常见现象/报错】、【根本原因】、【推荐对策与排查路径】，重点聚焦实战避坑经验。直接输出 Markdown 表格。";
              const pmt = `笔记主题：《${currentNote.title}》\n\n笔记核心内容：\n${rawText.slice(0, 3000)}`;
              currentGeneratedText = await callAi(pmt, sys, (msg) => {
                copilotContent.innerHTML = `<span style="color: var(--ee-curator-primary);">${escapeHtml(msg)}</span>`;
              });
            } else if (act === "cheatsheet") {
              copilotTitle.textContent = "📋 生成参数与状态速查表";
              const sys = "请从以下笔记中提炼核心参数、关键表字段或配置项，整理为一份结构化 Markdown 对比速查表格（包含【配置项/字段】、【类型/默认值】、【取值说明】、【建议设定】）。直接输出 Markdown 表格。";
              const pmt = `笔记主题：《${currentNote.title}》\n\n笔记核心内容：\n${rawText.slice(0, 3000)}`;
              currentGeneratedText = await callAi(pmt, sys, (msg) => {
                copilotContent.innerHTML = `<span style="color: var(--ee-curator-primary);">${escapeHtml(msg)}</span>`;
              });
            }
          } catch (aiErr) {
            console.warn("[Note Curator] AI 生成失败，降级为本地规则模板:", aiErr);
            if (context.ui?.showNotice) {
              context.ui.showNotice(`AI 服务提示: ${aiErr.message || "未能连接"}，已自动降级为本地高精知识模板`, { type: "info" });
            }
            if (act === "ai-rewrite") {
              copilotTitle.textContent = "✨ 本地排版净化与大纲重构 (离线)";
              currentGeneratedText = formatMarkdown(rawText, settings);
            } else if (act === "tldr") {
              copilotTitle.textContent = "⚡ TL;DR 核心要点备忘 (本地规则)";
              const kws = extractKeywords(currentNote.title + " " + rawText, 5);
              currentGeneratedText = `> [!NOTE] 核心要点备忘 (TL;DR)\n> - **主题对象**：${currentNote.title}\n> - **关键术语**：${kws.map((k) => `\`${k}\``).join(" / ")}\n> - **核心目标**：提供规范化的技术实施路径与生产环境最佳实践。\n\n`;
            } else if (act === "troubleshoot") {
              copilotTitle.textContent = "🛠️ 异常排错与避坑指南 (离线模板)";
              currentGeneratedText = `\n\n### 4. 常见异常排查与应急预案\n| 常见现象 / 报错 | 根本原因 | 推荐对策与排查路径 |\n|---|---|---|\n| 权限校验失败 (AUTHORITY_CHECK) | 缺失对应业务对象授权 | 检查 SU53 权限日志，分配对应 PFCG 角色 |\n| 运行时数据类型不匹配 | 隐式转换或入参结构变动 | 使用 SE38 检查最新 DDIC 结构定义 |\n| 高并发性能堵针 | 缺少局部索引或全表扫描 | 优化 WHERE 条件索引覆盖，开启本地缓存机制 |\n`;
            } else if (act === "cheatsheet") {
              copilotTitle.textContent = "📋 参数与配置速查表 (离线模板)";
              currentGeneratedText = `\n\n### 5. 核心参数与状态速查\n| 配置项 / 参数 | 默认取值 | 取值范围 / 含义 | 建议设定 |\n|---|---|---|---|\n| ENABLE_SWITCH | \`ABAP_TRUE\` | 开启 / 关闭管控 | 生产常开 |\n| LOG_LEVEL | \`INFO\` | DEBUG / INFO / ERROR | 故障时切 DEBUG |\n| TIMEOUT_SEC | \`30\` | 毫秒/秒级超时阈值 | 建议 15~30s |\n`;
            }
          } finally {
            card.classList.remove("is-loading-ai");
          }

          copilotContent.textContent = currentGeneratedText;
        };
      });

      if (replaceBtn) {
        replaceBtn.onclick = async () => {
          if (!currentGeneratedText) return;
          await applyFormattedContent(currentGeneratedText);
        };
      }

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
          const noteId = currentNote.id || currentNote.noteId;
          if (noteId && context.notes?.update) {
            await context.notes.update(noteId, { tags });
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
        const noteId = currentNote.id || currentNote.noteId;
        if (noteId && context.notes?.update) {
          await context.notes.update(noteId, { contentMarkdown: newContent, content: newContent });
        }
        if (context.editor?.setContent) {
          await context.editor.setContent(newContent);
        } else if (noteId && context.editor?.openDocument) {
          await context.editor.openDocument({ noteId: noteId });
        }
        currentNote.contentMarkdown = newContent;
        currentNote.content = newContent;
        formattedCache = newContent;

        if (context.ui?.showNotice) {
          context.ui.showNotice("🎉 笔记排版与内容已成功优化并保存！", { type: "success" });
        }
        closeModal();
      } catch (err) {
        console.warn("[Note Curator] 写入笔记异常:", err);
        if (context.ui?.showNotice) {
          context.ui.showNotice("保存失败: " + (err.message || "请检查编辑权限"), { type: "error" });
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
