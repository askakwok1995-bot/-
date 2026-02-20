"use strict";

/*
  ========== JavaScript 超细学习注释（先看这个） ==========
  1) 这个文件做了几件事：
     - 导航交互：点击导航滚动到章节 + 滚动时自动高亮当前章节。
     - 表单校验：输入不合规时给出错误提示，合规时给出成功提示。
     - 本地草稿：自动保存/恢复输入草稿。
     - 打卡记录：提交后生成记录并持久化。
     - 模态框：Esc 关闭、焦点陷阱、焦点恢复。

  2) 你会看到的核心 API：
     - document.querySelector / querySelectorAll：查找元素
     - addEventListener：监听事件
     - classList.add/remove：切换 CSS 类
     - scrollIntoView：滚动到指定元素
     - IntersectionObserver：观察元素是否进入视口
     - requestAnimationFrame：在浏览器下一帧执行（滚动优化常用）

  3) 代码入口在最底部：
     initNavInteraction();
     initFormValidation();
     initLocalDraft();
     initCheckinRecords();
     initModalDialog();

  4) 读代码建议顺序：
     - 先读 initNavInteraction（交互主线）
     - 再读 getIdFromHash（工具函数）
     - 最后读 initFormValidation（表单规则）
  =======================================================
*/

/*
  函数：initNavInteraction
  作用：初始化“左侧导航”的全部交互逻辑
*/
function initNavInteraction() {
  // 1) 找到左侧导航容器（只处理这个 nav，不影响页面其他链接）
  const nav = document.querySelector('nav[aria-label="学习阶段导航"]');

  // 如果导航不存在，直接结束函数，避免后面报错
  if (!nav) return;

  // 2) 定义允许跟踪的锚点规则（正则表达式）
  //    例如：#phase-1、#practice-form、#css-lab
  const targetPattern = /^#(?:phase-\d+|practice-[a-z0-9-]+|css-lab)$/;

  // 3) 从导航里找所有 href 以 # 开头的链接，再按规则过滤
  const navLinks = Array.from(nav.querySelectorAll('a[href^="#"]')).filter((link) =>
    targetPattern.test(link.getAttribute("href") || "")
  );

  // 没有可跟踪链接就退出
  if (navLinks.length === 0) return;

  // 4) 建立“章节 id -> 对应导航链接”的映射，后面高亮会用到
  const idToLink = new Map();

  // 记录参与滚动高亮的 section 元素列表
  const trackedSections = [];

  // 遍历导航链接，提取目标 id，并找到页面中对应的 section
  navLinks.forEach((link) => {
    // href="#phase-1" -> id "phase-1"
    const id = getIdFromHash(link.getAttribute("href") || "");

    // 用 id 查找文档里同名元素
    const section = document.getElementById(id);

    // 如果 id 为空或元素不存在，就跳过该项
    if (!id || !section) return;

    // 存映射关系：后面可通过 id 找到导航链接元素
    idToLink.set(id, link);

    // 把 section 加入跟踪列表
    trackedSections.push(section);
  });

  // 如果一个可跟踪的 section 都没有，也退出
  if (trackedSections.length === 0) return;

  // 5) 检测用户是否偏好“减少动态效果”
  //    若为 true，点击导航时不做 smooth 动画
  const reduceMotionMedia = window.matchMedia("(prefers-reduced-motion: reduce)");

  // 当前激活的 id（避免重复刷新同一个高亮）
  let activeId = "";

  /*
    内部函数：setActiveLink
    作用：设置当前高亮导航项（并确保同时只有一个高亮）
  */
  function setActiveLink(id) {
    // 如果 id 不在映射里，或和当前激活 id 相同，就不处理
    if (!idToLink.has(id) || activeId === id) return;

    // 先清掉所有导航项的激活状态
    idToLink.forEach((link) => link.classList.remove("is-active"));

    // 取出目标 id 对应的链接
    const nextActiveLink = idToLink.get(id);

    // 正常情况下会存在，这里做一次防御性判断
    if (nextActiveLink) {
      // 加上激活样式类（对应 CSS: nav a.is-active）
      nextActiveLink.classList.add("is-active");

      // 记录新的激活 id
      activeId = id;
    }
  }

  /*
    内部函数：getNearestSectionId
    输入：一组 section id
    输出：距离视口顶部最近的 id
    说明：滚动时可能多个 section 同时可见，用这个函数决定“当前章节”
  */
  function getNearestSectionId(sectionIds) {
    let nearestId = "";
    let nearestDistance = Number.POSITIVE_INFINITY;

    sectionIds.forEach((id) => {
      const section = document.getElementById(id);
      if (!section) return;

      // 元素顶部到视口顶部的距离（可能为负）
      const top = section.getBoundingClientRect().top;

      // 用绝对值比较“谁更接近顶部 0 点”
      const distanceToTop = Math.abs(top);

      if (distanceToTop < nearestDistance) {
        nearestDistance = distanceToTop;
        nearestId = id;
      }
    });

    return nearestId;
  }

  /*
    内部函数：getIdFromSections
    输入：section 元素列表
    输出：最接近顶部的 section id
  */
  function getIdFromSections(sections) {
    const ids = sections.map((section) => section.id);
    return getNearestSectionId(ids);
  }

  /*
    内部函数：syncActiveLinkByPosition
    作用：根据当前位置同步高亮导航
  */
  function syncActiveLinkByPosition() {
    const id = getIdFromSections(trackedSections);
    if (id) setActiveLink(id);
  }

  // =====================================================
  // 事件绑定：点击导航 -> 跳转章节 + 更新地址 + 设置高亮
  // =====================================================
  nav.addEventListener("click", (event) => {
    // closest：即使点到 a 内部文本，也能找到对应的 a
    const link = event.target.closest('a[href^="#"]');

    // 没找到链接，或链接不在 nav 内，就忽略
    if (!link || !nav.contains(link)) return;

    // 以下条件用于保留浏览器默认行为（比如 cmd/ctrl 新开）
    if (event.defaultPrevented) return;
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

    const rawHash = link.getAttribute("href") || "";

    // 只处理符合我们规则的锚点
    if (!targetPattern.test(rawHash)) return;

    const targetId = getIdFromHash(rawHash);
    const targetSection = document.getElementById(targetId);

    // 找不到目标元素就退出
    if (!targetSection) return;

    // 阻止默认锚点跳转，改用我们自定义滚动（支持平滑 + 降级）
    event.preventDefault();

    targetSection.scrollIntoView({
      behavior: reduceMotionMedia.matches ? "auto" : "smooth",
      block: "start",
    });

    // 更新地址栏 hash（不刷新页面）
    window.history.pushState(null, "", `#${encodeURIComponent(targetId)}`);

    // 立即更新一次高亮，提升交互反馈
    setActiveLink(targetId);
  });

  // =====================================================
  // 监听 hash 变化：支持手动改地址、前进后退等场景
  // =====================================================
  window.addEventListener("hashchange", () => {
    const hashId = getIdFromHash(window.location.hash);
    if (idToLink.has(hashId)) {
      setActiveLink(hashId);
    }
  });

  // =====================================================
  // 初始化首屏高亮：优先用 URL hash，否则默认第一个章节
  // =====================================================
  const initialHashId = getIdFromHash(window.location.hash);
  if (idToLink.has(initialHashId)) {
    setActiveLink(initialHashId);
  } else {
    const defaultId = trackedSections[0].id;
    setActiveLink(defaultId);
  }

  // =====================================================
  // 滚动高亮主逻辑：优先 IntersectionObserver，回退 scroll + rAF
  // =====================================================
  if ("IntersectionObserver" in window) {
    // 记录当前“进入观察区域”的 section id
    const visibleIds = new Set();

    // 创建观察器
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const id = entry.target.id;

          // isIntersecting=true 表示进入观察区域
          if (entry.isIntersecting) {
            visibleIds.add(id);
          } else {
            visibleIds.delete(id);
          }
        });

        // 在可见项里找“最靠近顶部”的那个
        const visibleNearestId = getNearestSectionId(Array.from(visibleIds));
        if (visibleNearestId) {
          setActiveLink(visibleNearestId);
          return;
        }

        // 如果可见集为空，就按所有 section 的位置兜底
        syncActiveLinkByPosition();
      },
      {
        root: null, // 以浏览器视口为观察根

        // rootMargin 调整“进入观察区”的判定区域
        // 顶部 -10%：更偏向顶部区域
        // 底部 -70%：减少底部区域干扰
        rootMargin: "-10% 0px -70% 0px",

        // threshold：不同可见比例触发回调
        threshold: [0, 0.25, 0.5, 0.75, 1],
      }
    );

    // 对每个 section 开始观察
    trackedSections.forEach((section) => observer.observe(section));

    // 下一帧做一次同步，避免首屏短暂不一致
    requestAnimationFrame(syncActiveLinkByPosition);
  } else {
    // ========== 回退方案：旧浏览器 ==========

    // ticking 用于节流：一帧内只计算一次
    let ticking = false;

    const onScrollOrResize = () => {
      if (ticking) return;
      ticking = true;

      requestAnimationFrame(() => {
        syncActiveLinkByPosition();
        ticking = false;
      });
    };

    // 滚动和窗口尺寸变化都可能影响“当前章节”
    window.addEventListener("scroll", onScrollOrResize, { passive: true });
    window.addEventListener("resize", onScrollOrResize);

    // 初始化时执行一次
    onScrollOrResize();
  }
}

/*
  工具函数：getIdFromHash
  输入："#phase-1"
  输出："phase-1"
*/
function getIdFromHash(hash) {
  // 不合法 hash 直接返回空字符串
  if (!hash || hash[0] !== "#") return "";

  // 去掉 # 前缀
  const rawId = hash.slice(1);

  try {
    // 解码 URL 编码（例如中文或特殊字符）
    return decodeURIComponent(rawId);
  } catch {
    // 解码失败时兜底返回原值，避免脚本中断
    return rawId;
  }
}

/*
  函数：initFormValidation
  作用：初始化表单校验和错误提示
*/
function initFormValidation() {
  // 先定位表单所在区块
  const formSection = document.getElementById("practice-form");
  if (!formSection) return;

  // 在区块内找 form
  const form = formSection.querySelector("form");
  if (!form) return;

  // 取出要校验的输入控件
  const dateInput = form.querySelector("#study-date");
  const topicInput = form.querySelector("#topic");
  const durationInput = form.querySelector("#duration");
  const statusSelect = form.querySelector("#status");
  const noteTextarea = form.querySelector("#note");

  // 取出每个字段对应的错误提示容器
  const dateError = form.querySelector("#study-date-error");
  const topicError = form.querySelector("#topic-error");
  const durationError = form.querySelector("#duration-error");

  // 取出表单整体状态提示容器
  const statusMessage = form.querySelector("#form-status-message");

  // 防御性判断：有任一关键节点缺失就退出
  if (
    !dateInput ||
    !topicInput ||
    !durationInput ||
    !statusSelect ||
    !noteTextarea ||
    !dateError ||
    !topicError ||
    !durationError ||
    !statusMessage
  ) {
    return;
  }

  /*
    字段配置表：把“控件 + 错误容器 + 校验函数”绑定在一起
    好处：统一循环处理，后续扩展字段更方便
  */
  const fieldConfigs = [
    {
      input: dateInput,
      errorEl: dateError,
      validate: (value) => (value.trim() ? "" : "请填写学习日期。"),
    },
    {
      input: topicInput,
      errorEl: topicError,
      validate: (value) => (value.trim() ? "" : "请填写学习主题。"),
    },
    {
      input: durationInput,
      errorEl: durationError,
      validate: (value) => {
        const trimmed = value.trim();

        // 必填校验
        if (!trimmed) return "请填写学习时长。";

        // 数值校验
        const minutes = Number(trimmed);
        if (!Number.isFinite(minutes) || !Number.isInteger(minutes)) return "学习时长必须是整数。";

        // 范围校验
        if (minutes < 10 || minutes > 300) return "学习时长需在 10 到 300 分钟之间。";

        // 步长校验（10 的倍数）
        if (minutes % 10 !== 0) return "学习时长步长必须为 10 分钟。";

        // 校验通过返回空字符串
        return "";
      },
    },
  ];

  /*
    工具函数：setFieldValidationResult
    作用：把单个字段的“校验结果”渲染到页面
  */
  function setFieldValidationResult(input, errorEl, message) {
    // 设置错误文案（为空表示无错误）
    errorEl.textContent = message;

    if (message) {
      // 有错误：加错误样式和无障碍标识
      input.classList.add("is-invalid");
      input.setAttribute("aria-invalid", "true");
      return false;
    }

    // 无错误：清除错误样式
    input.classList.remove("is-invalid");
    input.removeAttribute("aria-invalid");
    return true;
  }

  /* 校验单个字段 */
  function validateSingleField(config) {
    return setFieldValidationResult(config.input, config.errorEl, config.validate(config.input.value));
  }

  /* 校验全部字段 */
  function validateAllFields() {
    let isValid = true;

    fieldConfigs.forEach((config) => {
      const fieldValid = validateSingleField(config);
      if (!fieldValid) isValid = false;
    });

    return isValid;
  }

  /* 设置表单整体状态提示（成功或失败） */
  function setFormStatus(message, type) {
    statusMessage.textContent = message;

    // 先清空旧状态类
    statusMessage.classList.remove("is-error", "is-success");

    // 再按类型加新类
    if (type === "error") statusMessage.classList.add("is-error");
    if (type === "success") statusMessage.classList.add("is-success");
  }

  // =====================================================
  // 即时校验：输入中和失焦时都校验
  // =====================================================
  fieldConfigs.forEach((config) => {
    // 输入变化时实时校验
    config.input.addEventListener("input", () => {
      validateSingleField(config);

      // 只要继续输入，就先清掉“提交成功/失败”总提示
      if (statusMessage.textContent) {
        setFormStatus("", "");
      }
    });

    // 离开输入框时再校验一次
    config.input.addEventListener("blur", () => validateSingleField(config));
  });

  // =====================================================
  // 提交校验：不通过就提示错误，通过就提示成功
  // =====================================================
  form.addEventListener("submit", (event) => {
    // 阻止默认提交（我们先做前端校验）
    event.preventDefault();

    const isFormValid = validateAllFields();

    if (!isFormValid) {
      setFormStatus("提交失败：请先修正上方错误项。", "error");
      return;
    }

    /*
      校验通过后，发出“提交成功”自定义事件：
      - 让“打卡记录模块”接收并新增记录
      - 这种做法把“校验逻辑”和“记录逻辑”解耦，便于后续维护
    */
    form.dispatchEvent(
      new CustomEvent("checkin:submit-success", {
        detail: {
          studyDate: dateInput.value,
          topic: topicInput.value.trim(),
          duration: durationInput.value.trim(),
          status: statusSelect.value,
          note: noteTextarea.value.trim(),
        },
      })
    );

    setFormStatus("提交成功：表单校验已通过。", "success");
  });

  // =====================================================
  // 重置行为：重置输入值后，清掉错误状态和状态文案
  // =====================================================
  form.addEventListener("reset", () => {
    // reset 会先由浏览器修改输入值，放到下一帧再清状态更稳
    window.requestAnimationFrame(() => {
      fieldConfigs.forEach((config) => {
        setFieldValidationResult(config.input, config.errorEl, "");
      });
      setFormStatus("", "");
    });
  });
}

/*
  函数：initLocalDraft
  作用：把表单草稿自动保存到 localStorage，并在刷新后自动恢复

  里程碑 C 规则（固定）：
  - 存储键名必须是 learningFormDraft.v1
*/
function initLocalDraft() {
  // 固定键名：后续版本升级时可以通过 v2/v3 做兼容迁移
  const STORAGE_KEY = "learningFormDraft.v1";

  // 只在“表单练习区”工作，避免影响其他区域
  const formSection = document.getElementById("practice-form");
  if (!formSection) return;

  // 找到表单
  const form = formSection.querySelector("form");
  if (!form) return;

  // 找到需要保存/恢复的字段
  const dateInput = form.querySelector("#study-date");
  const topicInput = form.querySelector("#topic");
  const durationInput = form.querySelector("#duration");
  const statusSelect = form.querySelector("#status");
  const noteTextarea = form.querySelector("#note");

  // 找到“清空草稿”按钮和草稿状态文案容器
  const clearDraftButton = form.querySelector("#clear-draft-btn");
  const draftStatusMessage = form.querySelector("#draft-status-message");

  // 防御性判断：任一关键元素缺失就退出
  if (
    !dateInput ||
    !topicInput ||
    !durationInput ||
    !statusSelect ||
    !noteTextarea ||
    !clearDraftButton ||
    !draftStatusMessage
  ) {
    return;
  }

  /*
    工具函数：setDraftStatus
    作用：统一更新草稿状态提示文本
  */
  function setDraftStatus(message) {
    draftStatusMessage.textContent = message;
  }

  // 标记“当前是否由清空草稿按钮触发了 reset”
  let isClearingDraft = false;

  /*
    工具函数：collectDraft
    作用：读取当前表单值，组装成草稿对象
  */
  function collectDraft() {
    return {
      studyDate: dateInput.value,
      topic: topicInput.value,
      duration: durationInput.value,
      status: statusSelect.value,
      note: noteTextarea.value,
    };
  }

  /*
    工具函数：hasMeaningfulDraft
    作用：判断是否有“值得保存”的内容
    规则：
    - 日期/主题/时长/备注 只要有一个非空就算有内容
    - 状态不是默认值 done 也算有内容
  */
  function hasMeaningfulDraft(draft) {
    if (draft.studyDate.trim()) return true;
    if (draft.topic.trim()) return true;
    if (draft.duration.trim()) return true;
    if (draft.note.trim()) return true;
    if (draft.status !== "done") return true;
    return false;
  }

  /*
    工具函数：saveDraft
    作用：把当前草稿写入 localStorage
  */
  function saveDraft() {
    const draft = collectDraft();

    // 如果全部是默认/空值，就删除草稿，避免存无效数据
    if (!hasMeaningfulDraft(draft)) {
      localStorage.removeItem(STORAGE_KEY);
      setDraftStatus("草稿为空：未保存到本地。");
      return;
    }

    // 序列化为 JSON 字符串写入 localStorage
    localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
    setDraftStatus("已自动保存草稿（本地）。");
  }

  /*
    工具函数：restoreDraft
    作用：页面加载时读取并恢复草稿
  */
  function restoreDraft() {
    const raw = localStorage.getItem(STORAGE_KEY);

    // 没有草稿就给出提示并结束
    if (!raw) {
      setDraftStatus("当前没有本地草稿。");
      return;
    }

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // 数据损坏时删除，避免反复报错
      localStorage.removeItem(STORAGE_KEY);
      setDraftStatus("检测到损坏草稿，已自动清理。");
      return;
    }

    // 仅当字段类型是 string 时才恢复，避免脏数据污染表单
    if (typeof parsed.studyDate === "string") dateInput.value = parsed.studyDate;
    if (typeof parsed.topic === "string") topicInput.value = parsed.topic;
    if (typeof parsed.duration === "string") durationInput.value = parsed.duration;
    if (typeof parsed.status === "string") statusSelect.value = parsed.status;
    if (typeof parsed.note === "string") noteTextarea.value = parsed.note;

    setDraftStatus("已从本地恢复草稿。");
  }

  /*
    事件绑定：输入变化时自动保存
    - input：文本变化即时触发
    - change：下拉选择等在值提交时触发
  */
  [dateInput, topicInput, durationInput, statusSelect, noteTextarea].forEach((field) => {
    field.addEventListener("input", saveDraft);
    field.addEventListener("change", saveDraft);
  });

  /*
    重置表单后：下一帧再保存一次（此时值已被浏览器重置）
    这样刷新页面时不会恢复“重置前”的旧草稿
  */
  form.addEventListener("reset", () => {
    window.requestAnimationFrame(() => {
      // 若是“清空草稿”触发的 reset，则跳过自动保存，避免覆盖提示文案
      if (isClearingDraft) {
        isClearingDraft = false;
        return;
      }
      saveDraft();
    });
  });

  /*
    点击“清空草稿”：
    1) 删除 localStorage
    2) 重置表单
    3) 显示状态提示
  */
  clearDraftButton.addEventListener("click", () => {
    localStorage.removeItem(STORAGE_KEY);
    isClearingDraft = true;
    form.reset();
    setDraftStatus("已清空本地草稿。");
  });

  // 初始化时先尝试恢复草稿
  restoreDraft();
}

/*
  函数：initCheckinRecords
  作用：管理“提交打卡记录”的新增、渲染、持久化，以及远程 API 同步模式
*/
function initCheckinRecords() {
  // 固定存储键名：打卡记录专用（里程碑约定，不改名）
  const STORAGE_KEY = "learningCheckins.v1";
  const REMOTE_API_URL = "https://jsonplaceholder.typicode.com/posts";

  // 只在表单练习区生效
  const formSection = document.getElementById("practice-form");
  if (!formSection) return;

  // 找到表单、记录容器、状态文案、清空按钮
  const form = formSection.querySelector("form");
  const recordsBody = formSection.querySelector("#checkin-records-body");
  const recordStatus = formSection.querySelector("#checkin-record-status");
  const clearRecordsButton = formSection.querySelector("#clear-checkin-records-btn");
  const statusFilterSelect = formSection.querySelector("#checkin-status-filter");
  const syncModeSelect = formSection.querySelector("#checkin-sync-mode");
  const dataStateMessage = formSection.querySelector("#checkin-data-state");
  const retryRemoteLoadButton = formSection.querySelector("#retry-remote-load-btn");

  if (!form || !recordsBody || !recordStatus || !clearRecordsButton || !statusFilterSelect) return;

  // 当前筛选状态
  let currentFilter = statusFilterSelect.value || "all";

  // 当前同步模式：local（本地）/ remote（远程）
  let syncMode = syncModeSelect ? syncModeSelect.value : "local";

  // 当前正在编辑的记录 id（空字符串表示“没有行处于编辑态”）
  let editingRecordId = "";

  // 当前显示的记录列表（会和 localStorage 同步）
  let records = loadCheckinsLocally();

  function setRecordStatus(message) {
    recordStatus.textContent = message;
  }

  /*
    工具函数：setDataState
    作用：统一维护“数据状态文案”（loading / error / empty）
    说明：这个状态专门描述“数据请求过程”，与 recordStatus（操作反馈）分开
  */
  function setDataState(state, message) {
    if (!dataStateMessage) return;
    dataStateMessage.classList.remove("is-loading", "is-error", "is-empty");
    if (state === "loading") dataStateMessage.classList.add("is-loading");
    if (state === "error") dataStateMessage.classList.add("is-error");
    if (state === "empty") dataStateMessage.classList.add("is-empty");
    dataStateMessage.textContent = message;
  }

  /*
    工具函数：setRetryRemoteButtonVisible
    作用：控制“重试远程加载”按钮显隐
  */
  function setRetryRemoteButtonVisible(visible) {
    if (!retryRemoteLoadButton) return;
    retryRemoteLoadButton.hidden = !visible;
  }

  // 生成记录 id（保证是字符串，符合数据结构约定）
  function createRecordId(prefix) {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  // 把状态值翻译成人类可读中文
  function getStatusLabel(value) {
    if (value === "done") return "已完成";
    if (value === "doing") return "进行中";
    if (value === "todo") return "未开始";
    return value || "未设置";
  }

  /*
    工具函数：normalizeStatusInput
    作用：把可能来自不同来源的状态值统一成 done/doing/todo
  */
  function normalizeStatusInput(value) {
    const v = String(value || "").trim().toLowerCase();
    if (v === "done" || v === "已完成") return "done";
    if (v === "doing" || v === "进行中") return "doing";
    if (v === "todo" || v === "未开始") return "todo";
    return "";
  }

  /*
    工具函数：normalizeCheckinRecord
    作用：把任意输入对象整理成统一记录结构
  */
  function normalizeCheckinRecord(item, fallbackId) {
    const safeItem = item && typeof item === "object" ? item : {};
    const normalizedStatus = normalizeStatusInput(safeItem.status) || "done";
    return {
      id: typeof safeItem.id === "string" && safeItem.id ? safeItem.id : fallbackId,
      submittedAt:
        typeof safeItem.submittedAt === "string" && safeItem.submittedAt ? safeItem.submittedAt : new Date().toISOString(),
      studyDate: typeof safeItem.studyDate === "string" ? safeItem.studyDate : "",
      topic: typeof safeItem.topic === "string" ? safeItem.topic : "",
      duration: typeof safeItem.duration === "string" ? safeItem.duration : "",
      status: normalizedStatus,
      note: typeof safeItem.note === "string" ? safeItem.note : "",
    };
  }

  /*
    从 localStorage 读取记录：
    - 期望是一个数组
    - 读取失败或格式异常则回退为空数组
  */
  function loadCheckinsLocally() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];

    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];

      return parsed.map((item, index) => normalizeCheckinRecord(item, `legacy-${Date.now()}-${index}`));
    } catch {
      return [];
    }
  }

  // 把当前记录写回 localStorage
  function saveCheckinsLocally() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  }

  // 编辑态字段校验（和主表单规则保持一致）
  function validateEditableRecord(record) {
    if (!record.studyDate.trim()) return "学习日期不能为空。";
    if (!record.topic.trim()) return "学习主题不能为空。";
    if (!record.duration.trim()) return "学习时长不能为空。";

    const minutes = Number(record.duration);
    if (!Number.isFinite(minutes) || !Number.isInteger(minutes)) return "学习时长必须是整数。";
    if (minutes < 10 || minutes > 300) return "学习时长需在 10 到 300 分钟之间。";
    if (minutes % 10 !== 0) return "学习时长步长必须为 10 分钟。";
    if (!normalizeStatusInput(record.status)) return "完成状态只支持 done / doing / todo（或中文状态）。";
    return "";
  }

  /*
    工具函数：wait
    作用：在异步重试时做短暂等待（教学演示常用）
  */
  function wait(ms) {
    return new Promise((resolve) => {
      window.setTimeout(resolve, ms);
    });
  }

  /*
    工具函数：requestCheckinsApi
    作用：统一远程请求入口，集中处理：
    1) fetch 调用
    2) HTTP 错误判断
    3) 自动重试（默认 1 次）
    说明：页面其他地方不要直接写 fetch，统一走这个函数
  */
  async function requestCheckinsApi(options) {
    const method = options && options.method ? options.method : "GET";
    const payload = options && options.payload ? options.payload : null;
    const retryCount = options && Number.isInteger(options.retryCount) ? options.retryCount : 1;

    for (let attempt = 0; attempt <= retryCount; attempt += 1) {
      try {
        const response = await fetch(method === "GET" ? `${REMOTE_API_URL}?_limit=12` : REMOTE_API_URL, {
          method,
          headers: {
            "Content-Type": "application/json; charset=UTF-8",
          },
          body: method === "GET" ? undefined : JSON.stringify(payload),
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        return response.json();
      } catch (error) {
        if (attempt >= retryCount) {
          throw error;
        }
        // 重试前等待 600ms，便于观察“失败后重试”的流程
        await wait(600);
      }
    }

    throw new Error("请求失败：重试后仍未成功。");
  }

  /*
    工具函数：mapRemotePostToCheckin
    作用：把 JSONPlaceholder 的 post 数据转成当前项目的打卡结构
    说明：为了教学，我们把更多字段放在 body(JSON 字符串)里，读取时再反解析
  */
  function mapRemotePostToCheckin(post, index) {
    const fallbackId = `remote-${Date.now()}-${index}`;
    const safePost = post && typeof post === "object" ? post : {};
    const safeBody = typeof safePost.body === "string" ? safePost.body : "";
    const safeTitle = typeof safePost.title === "string" ? safePost.title : "";

    let parsedBody = {};
    try {
      parsedBody = safeBody ? JSON.parse(safeBody) : {};
    } catch {
      parsedBody = {};
    }
    const safeParsedBody = parsedBody && typeof parsedBody === "object" ? parsedBody : {};

    const today = new Date().toISOString().slice(0, 10);
    const candidateStatus = normalizeStatusInput(safeParsedBody.status);

    return normalizeCheckinRecord(
      {
        id:
          typeof safePost.id === "number" || (typeof safePost.id === "string" && safePost.id)
            ? `remote-${safePost.id}`
            : fallbackId,
        submittedAt:
          typeof safeParsedBody.submittedAt === "string" && safeParsedBody.submittedAt
            ? safeParsedBody.submittedAt
            : new Date().toISOString(),
        studyDate:
          typeof safeParsedBody.studyDate === "string" && safeParsedBody.studyDate ? safeParsedBody.studyDate : today,
        topic:
          typeof safeParsedBody.topic === "string" && safeParsedBody.topic ? safeParsedBody.topic : safeTitle || "远程学习记录",
        duration: typeof safeParsedBody.duration === "string" && safeParsedBody.duration ? safeParsedBody.duration : "30",
        status: candidateStatus || "todo",
        note:
          typeof safeParsedBody.note === "string" && safeParsedBody.note
            ? safeParsedBody.note
            : safeBody && !safeParsedBody.note
              ? safeBody.slice(0, 80)
              : "",
      },
      fallbackId
    );
  }

  /*
    工具函数：loadCheckinsFromRemote
    作用：从远程 API 加载记录；失败时自动回退本地模式
  */
  async function loadCheckinsFromRemote() {
    setRetryRemoteButtonVisible(false);
    setDataState("loading", "正在从远程 API 加载记录...");

    try {
      const remoteList = await requestCheckinsApi({ method: "GET", retryCount: 1 });
      if (!Array.isArray(remoteList)) {
        throw new Error("远程响应格式错误：不是数组。");
      }

      records = remoteList.map((item, index) => mapRemotePostToCheckin(item, index));
      editingRecordId = "";
      saveCheckinsLocally();
      renderCheckinRecords();

      if (records.length === 0) {
        setDataState("empty", "远程加载完成：暂无记录。");
      } else {
        setDataState("", "");
      }

      setRecordStatus(`远程加载成功：共 ${records.length} 条记录。`);
    } catch (error) {
      // 远程失败时，强制回退本地模式（这是里程碑 B 的关键验收点）
      syncMode = "local";
      if (syncModeSelect) syncModeSelect.value = "local";
      records = loadCheckinsLocally();
      editingRecordId = "";
      renderCheckinRecords();

      if (records.length === 0) {
        setDataState("error", "远程失败，已切本地模式；本地暂无记录。");
      } else {
        setDataState("error", "远程失败，已切本地模式。");
      }

      setRetryRemoteButtonVisible(true);
      setRecordStatus("远程失败，已切本地模式。");
      // 控制台保留错误，便于你用 DevTools 学调试
      console.warn("[checkin] 远程加载失败：", error);
    }
  }

  /*
    工具函数：submitCheckinToRemote
    作用：把新记录提交到远程 API，成功后返回“远程回执 + 本地字段”整合结果
  */
  async function submitCheckinToRemote(record) {
    const payload = {
      title: record.topic,
      body: JSON.stringify({
        studyDate: record.studyDate,
        topic: record.topic,
        duration: record.duration,
        status: record.status,
        note: record.note,
        submittedAt: record.submittedAt,
      }),
      userId: 1,
    };

    const created = await requestCheckinsApi({ method: "POST", payload, retryCount: 1 });
    const remoteId =
      created && (typeof created.id === "number" || (typeof created.id === "string" && created.id))
        ? `remote-${created.id}`
        : record.id;

    return {
      ...record,
      id: remoteId,
    };
  }

  /*
    工具函数：findRecordIndexById
    作用：根据记录 id 找到 records 数组中的位置，找不到返回 -1
  */
  function findRecordIndexById(id) {
    return records.findIndex((record) => record.id === id);
  }

  // 格式化提交时间为本地可读格式
  function formatSubmittedAt(isoString) {
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) return isoString || "未知时间";
    return new Intl.DateTimeFormat("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  }

  /*
    工具函数：createTextCell
    作用：快速创建普通文本 td，减少重复代码
  */
  function createTextCell(text) {
    const cell = document.createElement("td");
    cell.textContent = text;
    return cell;
  }

  /*
    工具函数：createEditableInput
    作用：创建“行内编辑”用的 input 控件，并挂上 data-field 方便保存时读取
  */
  function createEditableInput(field, type, value) {
    const input = document.createElement("input");
    input.type = type;
    input.value = value;
    input.dataset.field = field;
    input.className = "record-editor-input";

    // 时长输入沿用表单同样的规则（10-300，步长 10）
    if (field === "duration") {
      input.min = "10";
      input.max = "300";
      input.step = "10";
      input.inputMode = "numeric";
    }

    return input;
  }

  /*
    工具函数：createEditableStatusSelect
    作用：创建“完成状态”下拉框
  */
  function createEditableStatusSelect(value) {
    const select = document.createElement("select");
    select.dataset.field = "status";
    select.className = "record-editor-select";

    [
      { value: "done", label: "已完成" },
      { value: "doing", label: "进行中" },
      { value: "todo", label: "未开始" },
    ].forEach((optionData) => {
      const option = document.createElement("option");
      option.value = optionData.value;
      option.textContent = optionData.label;
      if (optionData.value === value) option.selected = true;
      select.appendChild(option);
    });

    return select;
  }

  /*
    工具函数：createEditableNote
    作用：创建“备注”多行输入框
  */
  function createEditableNote(value) {
    const textarea = document.createElement("textarea");
    textarea.dataset.field = "note";
    textarea.className = "record-editor-textarea";
    textarea.rows = 2;
    textarea.value = value;
    return textarea;
  }

  /*
    工具函数：appendEditorCell
    作用：给某一行添加“编辑态单元格”
  */
  function appendEditorCell(row, control) {
    const cell = document.createElement("td");
    cell.appendChild(control);
    row.appendChild(cell);
  }

  /*
    工具函数：getEditableFieldValue
    作用：从当前编辑行读取某个字段值
  */
  function getEditableFieldValue(row, field) {
    const element = row.querySelector(`[data-field="${field}"]`);
    if (!element) return "";
    if ("value" in element) return element.value;
    return "";
  }

  /*
    工具函数：focusFirstEditorField
    作用：进入编辑态后，把焦点放到第一列可编辑输入框，提升键盘可用性
  */
  function focusFirstEditorField(recordId) {
    if (!recordId) return;
    const row = recordsBody.querySelector(`tr[data-record-id="${recordId}"]`);
    if (!row) return;
    const firstField = row.querySelector("[data-field='studyDate']");
    if (firstField && typeof firstField.focus === "function") {
      firstField.focus();
    }
  }

  /*
    渲染函数：renderCheckinRecords
    - 有记录：按“最新在前”渲染
    - 无记录：显示占位行
  */
  function renderCheckinRecords() {
    recordsBody.innerHTML = "";
    const filteredRecords = records.filter((record) => currentFilter === "all" || record.status === currentFilter);

    if (filteredRecords.length === 0) {
      const emptyRow = document.createElement("tr");
      emptyRow.className = "checkin-record-empty";

      const emptyCell = document.createElement("td");
      emptyCell.colSpan = 7;
      emptyCell.textContent = records.length === 0 ? "暂无打卡记录。" : "当前筛选条件下暂无记录。";

      emptyRow.appendChild(emptyCell);
      recordsBody.appendChild(emptyRow);

      if (records.length === 0) {
        setDataState("empty", "当前暂无打卡记录。");
      }
      return;
    }

    setDataState("", "");

    const displayList = [...filteredRecords].reverse();
    displayList.forEach((record) => {
      const row = document.createElement("tr");
      row.dataset.recordId = record.id;

      // 第一列“提交时间”保持只读，不参与编辑
      row.appendChild(createTextCell(formatSubmittedAt(record.submittedAt)));

      // 如果这条记录正处于编辑态，渲染 input/select/textarea；否则渲染普通文本
      if (record.id === editingRecordId) {
        appendEditorCell(row, createEditableInput("studyDate", "date", record.studyDate));
        appendEditorCell(row, createEditableInput("topic", "text", record.topic));
        appendEditorCell(row, createEditableInput("duration", "number", record.duration));
        appendEditorCell(row, createEditableStatusSelect(record.status));
        appendEditorCell(row, createEditableNote(record.note));
      } else {
        row.appendChild(createTextCell(record.studyDate || "未填写"));
        row.appendChild(createTextCell(record.topic || "未填写"));
        row.appendChild(createTextCell(record.duration || "未填写"));
        row.appendChild(createTextCell(getStatusLabel(record.status)));
        row.appendChild(createTextCell(record.note || "（无）"));
      }

      const actionsCell = document.createElement("td");
      actionsCell.className = "checkin-record-actions";

      if (record.id === editingRecordId) {
        // 编辑态：显示“保存 + 取消”
        const saveButton = document.createElement("button");
        saveButton.type = "button";
        saveButton.className = "record-action-btn record-action-save";
        saveButton.dataset.action = "save";
        saveButton.dataset.id = record.id;
        saveButton.textContent = "保存";

        const cancelButton = document.createElement("button");
        cancelButton.type = "button";
        cancelButton.className = "record-action-btn";
        cancelButton.dataset.action = "cancel";
        cancelButton.dataset.id = record.id;
        cancelButton.textContent = "取消";

        actionsCell.appendChild(saveButton);
        actionsCell.appendChild(cancelButton);
      } else {
        // 普通态：显示“编辑 + 删除”
        const editButton = document.createElement("button");
        editButton.type = "button";
        editButton.className = "record-action-btn";
        editButton.dataset.action = "edit";
        editButton.dataset.id = record.id;
        editButton.textContent = "编辑";

        const deleteButton = document.createElement("button");
        deleteButton.type = "button";
        deleteButton.className = "record-action-btn record-action-delete";
        deleteButton.dataset.action = "delete";
        deleteButton.dataset.id = record.id;
        deleteButton.textContent = "删除";

        actionsCell.appendChild(editButton);
        actionsCell.appendChild(deleteButton);
      }

      row.appendChild(actionsCell);

      recordsBody.appendChild(row);
    });
  }

  // 监听“表单校验成功”事件：新增记录 + 持久化 + 重新渲染
  form.addEventListener("checkin:submit-success", async (event) => {
    const detail = event.detail || {};

    const nextRecord = {
      id: createRecordId("checkin"),
      submittedAt: new Date().toISOString(),
      studyDate: typeof detail.studyDate === "string" ? detail.studyDate : "",
      topic: typeof detail.topic === "string" ? detail.topic : "",
      duration: typeof detail.duration === "string" ? detail.duration : "",
      status: normalizeStatusInput(typeof detail.status === "string" ? detail.status : "") || "done",
      note: typeof detail.note === "string" ? detail.note : "",
    };

    if (syncMode === "remote") {
      setDataState("loading", "正在提交到远程 API...");

      try {
        const remoteRecord = await submitCheckinToRemote(nextRecord);
        records.push(remoteRecord);
        saveCheckinsLocally();
        renderCheckinRecords();
        setRetryRemoteButtonVisible(false);
        setRecordStatus(`远程提交成功，并已写入本地缓存。当前共 ${records.length} 条。`);
      } catch (error) {
        // 提交失败时回退本地，并确保用户输入不丢失
        syncMode = "local";
        if (syncModeSelect) syncModeSelect.value = "local";
        records.push(nextRecord);
        saveCheckinsLocally();
        renderCheckinRecords();
        setDataState("error", "远程提交失败，已切本地模式。");
        setRetryRemoteButtonVisible(true);
        setRecordStatus(`远程提交失败，已本地保存。当前共 ${records.length} 条。`);
        console.warn("[checkin] 远程提交失败：", error);
      }
      return;
    }

    records.push(nextRecord);
    saveCheckinsLocally();
    renderCheckinRecords();
    setRecordStatus(`已新增 1 条打卡记录（本地模式），当前共 ${records.length} 条。`);
  });

  // 点击按钮时清空全部记录
  clearRecordsButton.addEventListener("click", () => {
    records = [];
    editingRecordId = "";
    localStorage.removeItem(STORAGE_KEY);
    renderCheckinRecords();
    setRecordStatus("已清空全部打卡记录。");
    setDataState("empty", "当前暂无打卡记录。");
  });

  statusFilterSelect.addEventListener("change", () => {
    currentFilter = statusFilterSelect.value;
    // 切换筛选时退出编辑态，避免“当前编辑行被筛掉后看不到保存按钮”的困惑
    editingRecordId = "";
    renderCheckinRecords();
    setRecordStatus(currentFilter === "all" ? "已切换为“全部”记录。" : `已按状态筛选：${getStatusLabel(currentFilter)}。`);
  });

  // 同步模式切换：local <-> remote
  if (syncModeSelect) {
    syncModeSelect.addEventListener("change", async () => {
      syncMode = syncModeSelect.value === "remote" ? "remote" : "local";
      editingRecordId = "";

      if (syncMode === "remote") {
        await loadCheckinsFromRemote();
        return;
      }

      // 切回本地时，直接读取 localStorage
      records = loadCheckinsLocally();
      renderCheckinRecords();
      setRetryRemoteButtonVisible(false);
      if (records.length > 0) {
        setRecordStatus(`已切换本地模式，共 ${records.length} 条记录。`);
      } else {
        setRecordStatus("已切换本地模式，当前没有记录。");
      }
    });
  }

  // 重试按钮：只在远程模式有意义
  if (retryRemoteLoadButton) {
    retryRemoteLoadButton.addEventListener("click", async () => {
      if (syncMode !== "remote") {
        syncMode = "remote";
        if (syncModeSelect) syncModeSelect.value = "remote";
      }
      await loadCheckinsFromRemote();
    });
  }

  /*
    工具函数：cancelEditingRow
    作用：退出当前编辑态并刷新列表
  */
  function cancelEditingRow() {
    editingRecordId = "";
    renderCheckinRecords();
    setRecordStatus("已取消本次编辑。");
  }

  /*
    工具函数：saveEditingRow
    作用：把当前编辑行中的输入值校验后写回 records
    返回值：
    - true：保存成功
    - false：保存失败（例如校验不通过）
  */
  function saveEditingRow(recordId, row) {
    if (!recordId || !row) return false;

    const targetIndex = findRecordIndexById(recordId);
    if (targetIndex < 0) return false;

    const current = records[targetIndex];
    const draftRecord = {
      studyDate: getEditableFieldValue(row, "studyDate").trim(),
      topic: getEditableFieldValue(row, "topic").trim(),
      duration: getEditableFieldValue(row, "duration").trim(),
      status: getEditableFieldValue(row, "status").trim(),
      note: getEditableFieldValue(row, "note").trim(),
    };

    const message = validateEditableRecord(draftRecord);
    if (message) {
      setRecordStatus(`保存失败：${message}`);
      return false;
    }

    records[targetIndex] = {
      ...current,
      studyDate: draftRecord.studyDate,
      topic: draftRecord.topic,
      duration: draftRecord.duration,
      status: normalizeStatusInput(draftRecord.status),
      note: draftRecord.note,
    };

    saveCheckinsLocally();
    editingRecordId = "";
    renderCheckinRecords();
    setRecordStatus("记录已保存。");
    return true;
  }

  recordsBody.addEventListener("click", (event) => {
    const actionButton = event.target.closest("button[data-action]");
    if (!actionButton) return;

    const action = actionButton.dataset.action;
    const id = actionButton.dataset.id;
    if (!action || !id) return;

    const targetIndex = findRecordIndexById(id);
    if (targetIndex < 0) return;

    if (action === "edit") {
      // 进入编辑态：只允许一行被编辑，切换时覆盖旧编辑态
      editingRecordId = id;
      renderCheckinRecords();
      setRecordStatus("已进入行内编辑模式。快捷键：Enter 保存，Esc 取消。");

      // 下一帧聚焦第一项输入框，避免渲染未完成导致找不到元素
      window.requestAnimationFrame(() => {
        focusFirstEditorField(id);
      });
      return;
    }

    if (action === "cancel") {
      cancelEditingRow();
      return;
    }

    if (action === "delete") {
      const ok = window.confirm("确定删除这条打卡记录吗？");
      if (!ok) return;

      records.splice(targetIndex, 1);
      if (editingRecordId === id) {
        editingRecordId = "";
      }
      saveCheckinsLocally();
      renderCheckinRecords();
      setRecordStatus(`已删除 1 条记录，当前共 ${records.length} 条。`);
      return;
    }

    if (action === "save") {
      const row = actionButton.closest("tr");
      if (!row) return;
      saveEditingRow(id, row);
    }
  });

  /*
    键盘快捷键（编辑态）：
    - Enter：保存当前行
    - Esc：取消当前行编辑
    特别说明：
    - 在备注 textarea 中，Shift + Enter 保留“换行”，避免完全失去多行输入能力
  */
  recordsBody.addEventListener("keydown", (event) => {
    if (!editingRecordId) return;
    if (event.isComposing) return;

    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    const row = target.closest("tr[data-record-id]");
    if (!row) return;

    const rowId = row.dataset.recordId || "";
    if (!rowId || rowId !== editingRecordId) return;

    if (event.key === "Escape") {
      event.preventDefault();
      cancelEditingRow();
      return;
    }

    if (event.key !== "Enter") return;

    // 备注区允许 Shift+Enter 换行；其余 Enter 统一触发保存
    const isNoteTextarea = target.matches('textarea[data-field="note"]');
    if (isNoteTextarea && event.shiftKey) return;

    event.preventDefault();
    saveEditingRow(rowId, row);
  });

  // 首次加载：默认先走当前模式
  saveCheckinsLocally();
  renderCheckinRecords();
  setRetryRemoteButtonVisible(false);

  if (syncMode === "remote") {
    loadCheckinsFromRemote();
  } else if (records.length > 0) {
    setRecordStatus(`已加载 ${records.length} 条本地打卡记录。`);
  } else {
    setRecordStatus("当前没有打卡记录。");
    setDataState("empty", "当前暂无打卡记录。");
  }
}

/*
  函数：initModalDialog
  作用：初始化“模态框 + 键盘无障碍”交互
*/
function initModalDialog() {
  // 触发按钮：用于打开模态框
  const openButton = document.getElementById("open-learning-modal");

  // 遮罩层 + 对话框主体
  const overlay = document.getElementById("learning-modal-overlay");
  const dialog = document.getElementById("learning-modal");

  if (!openButton || !overlay || !dialog) return;

  // 所有带 data-modal-close="true" 的按钮都作为关闭按钮
  const closeButtons = Array.from(overlay.querySelectorAll('[data-modal-close="true"]'));

  // 记录“打开模态框之前”焦点在哪个元素，关闭后还原
  let lastFocusedElement = null;

  /*
    获取模态框内可聚焦元素（用于焦点陷阱）
    常见可聚焦元素：链接、按钮、输入框、下拉框、带 tabindex 的元素
  */
  function getFocusableElements() {
    const candidates = Array.from(
      dialog.querySelectorAll(
        'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    );

    // 过滤不可见元素（如 display: none）
    return candidates.filter((element) => {
      return element.offsetParent !== null || element === document.activeElement;
    });
  }

  // 打开模态框
  function openModal() {
    // 记录打开前焦点位置（通常是打开按钮）
    lastFocusedElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    // 显示遮罩层
    overlay.classList.remove("modal-hidden");
    overlay.setAttribute("aria-hidden", "false");

    // 给 body 打标记，禁用背景滚动（见 CSS: body.modal-open）
    document.body.classList.add("modal-open");

    // 打开后把焦点放进模态框
    const focusableElements = getFocusableElements();
    if (focusableElements.length > 0) {
      focusableElements[0].focus();
    } else {
      dialog.focus();
    }
  }

  // 关闭模态框
  function closeModal() {
    overlay.classList.add("modal-hidden");
    overlay.setAttribute("aria-hidden", "true");
    document.body.classList.remove("modal-open");

    // 把焦点还给打开按钮（或打开前聚焦元素）
    if (lastFocusedElement && typeof lastFocusedElement.focus === "function") {
      lastFocusedElement.focus();
    } else {
      openButton.focus();
    }
  }

  // 点击打开按钮 -> 打开模态框
  openButton.addEventListener("click", openModal);

  // 点击任意关闭按钮 -> 关闭模态框
  closeButtons.forEach((button) => {
    button.addEventListener("click", closeModal);
  });

  // 点击遮罩空白区（不是点到对话框内容）-> 关闭模态框
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) {
      closeModal();
    }
  });

  /*
    键盘无障碍：
    - Esc：关闭
    - Tab / Shift+Tab：焦点循环在模态框内部（焦点陷阱）
  */
  overlay.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeModal();
      return;
    }

    if (event.key !== "Tab") return;

    const focusableElements = getFocusableElements();

    // 没有可聚焦元素时，把焦点固定在对话框本体
    if (focusableElements.length === 0) {
      event.preventDefault();
      dialog.focus();
      return;
    }

    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];
    const currentActive = document.activeElement;

    // Shift + Tab：在第一个元素继续反向 Tab 时，跳到最后一个
    if (event.shiftKey) {
      if (currentActive === firstElement || currentActive === dialog) {
        event.preventDefault();
        lastElement.focus();
      }
      return;
    }

    // Tab：在最后一个元素继续正向 Tab 时，跳回第一个
    if (currentActive === lastElement) {
      event.preventDefault();
      firstElement.focus();
    }
  });
}

// ================= 启动入口 =================
// 页面加载后，依次初始化：导航交互 -> 表单校验 -> 本地草稿 -> 打卡记录 -> 模态框
initNavInteraction();
initFormValidation();
initLocalDraft();
initCheckinRecords();
initModalDialog();
