(() => {
  // src/webview/liveRunPanelScript.ts
  (function() {
    var vscodeApi = null;
    try {
      if (typeof acquireVsCodeApi === "function") {
        vscodeApi = acquireVsCodeApi();
      }
    } catch (e) {
    }
    var shell = document.getElementById("shell");
    var shellMain = document.getElementById("shellMain");
    var emptyPlaceholder = document.getElementById("emptyPlaceholder");
    var paneTree = document.getElementById("paneTree");
    var splitter = document.getElementById("splitter");
    var treeRoot = document.getElementById("treeRoot");
    var consoleOut = document.getElementById("consoleOut");
    var consoleFindBar = document.getElementById("consoleFindBar");
    var consoleFindInput = document.getElementById("consoleFindInput");
    var consoleFindCounts = document.getElementById("consoleFindCounts");
    var consoleFindUiIndex = -1;
    var consoleFindMarks = [];
    var featureBody = null;
    var featureRunCancelled = false;
    var featureFinishedKind = "";
    var liveFollowSelection = true;
    var currentScenarioSteps = null;
    var scenarioStepsBodyByKey = /* @__PURE__ */ Object.create(null);
    var logFeature = [];
    var logByScenario = /* @__PURE__ */ Object.create(null);
    var logByStep = /* @__PURE__ */ Object.create(null);
    var stepHeadlineByKey = /* @__PURE__ */ Object.create(null);
    var stepErrorByKey = /* @__PURE__ */ Object.create(null);
    var selectedEl = null;
    var anonStepSeq = 0;
    var TREE_CHILD_INDENT_PX = 14;
    var TREE_SCROLL_BOTTOM_EPS_PX = 48;
    function isTreeScrollNearBottom(el) {
      if (!el) {
        return true;
      }
      var maxScroll = el.scrollHeight - el.clientHeight;
      if (maxScroll <= 0) {
        return true;
      }
      return el.scrollTop >= maxScroll - TREE_SCROLL_BOTTOM_EPS_PX;
    }
    function scrollTreeRootToBottomIfWasFollowing(wasFollowing) {
      if (!treeRoot || !wasFollowing) {
        return;
      }
      treeRoot.scrollTop = treeRoot.scrollHeight;
    }
    function applyTreeRowBleed(el, ancestorTreeChildDepth, bleedReducePx) {
      var reduce = bleedReducePx || 0;
      var raw = ancestorTreeChildDepth * TREE_CHILD_INDENT_PX - reduce;
      var px = (raw > 0 ? raw : 0) + "px";
      el.style.setProperty("--tree-bleed-left", px);
    }
    function noteUserPinnedTreeSelection() {
      liveFollowSelection = false;
    }
    function syncRunLayoutVisibility() {
      var hasTree = treeRoot && treeRoot.childElementCount > 0;
      if (hasTree) {
        shell.classList.remove("hidden");
        emptyPlaceholder.classList.add("hidden");
      } else {
        shell.classList.add("hidden");
        emptyPlaceholder.classList.remove("hidden");
      }
    }
    var TREE_W_KEY = "behaveRunner.liveRun.treeWidthPx";
    var LIVE_PANEL_PROTOCOL_EXPECTED = 1;
    var livePanelProtocolOk = false;
    var featureIconEl = null;
    var scenarioIcons = /* @__PURE__ */ Object.create(null);
    var scenarioFailed = /* @__PURE__ */ Object.create(null);
    var scenarioSkipped = /* @__PURE__ */ Object.create(null);
    var scenarioDone = /* @__PURE__ */ Object.create(null);
    var scenarioDoneStatus = /* @__PURE__ */ Object.create(null);
    var scenarioRunningStepCount = /* @__PURE__ */ Object.create(null);
    var pendingStepRowByKey = /* @__PURE__ */ Object.create(null);
    function applyTreeWidth(px) {
      var rootW = shellMain && shellMain.clientWidth > 80 ? shellMain.clientWidth : 640;
      var w = Math.max(120, Math.min(px, rootW - 80));
      paneTree.style.flex = "0 0 " + w + "px";
      paneTree.style.width = w + "px";
    }
    var savedW = localStorage.getItem(TREE_W_KEY);
    if (savedW) {
      var parsed = parseInt(savedW, 10);
      if (!isNaN(parsed)) applyTreeWidth(parsed);
    }
    var dragStartX = 0;
    var dragStartW = 0;
    splitter.addEventListener("mousedown", function(e) {
      if (e.button !== 0) return;
      e.preventDefault();
      dragStartX = e.clientX;
      dragStartW = paneTree.getBoundingClientRect().width;
      splitter.classList.add("is-dragging");
      document.body.style.cursor = "col-resize";
      function onMove(e2) {
        var dx = e2.clientX - dragStartX;
        applyTreeWidth(dragStartW + dx);
      }
      function onUp() {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        splitter.classList.remove("is-dragging");
        document.body.style.cursor = "";
        localStorage.setItem(
          TREE_W_KEY,
          String(Math.round(paneTree.getBoundingClientRect().width))
        );
      }
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });
    function setRowIcon(iconSpan, kind) {
      iconSpan.textContent = "";
      var k = kind || "none";
      var base = "tree-row-icon icon-" + k;
      if (k === "pass") {
        iconSpan.className = base + " codicon codicon-pass";
      } else if (k === "fail") {
        iconSpan.className = base + " codicon codicon-error";
      } else if (k === "skip") {
        iconSpan.className = base + " codicon codicon-circle-slash";
      } else if (k === "pending") {
        iconSpan.className = base + " codicon codicon-loading codicon-modifier-spin";
      } else {
        iconSpan.className = base;
      }
    }
    function stepIsFail(status) {
      var s = (status || "").toLowerCase();
      return s === "failed" || s === "error" || s === "undefined";
    }
    function stepIsPassish(status) {
      var s = (status || "").toLowerCase();
      return s === "passed" || s === "pending";
    }
    function stepIsSkip(status) {
      var s = (status || "").toLowerCase();
      return s === "skipped";
    }
    function finalStatusKind(status) {
      var s = (status || "").toLowerCase();
      if (s === "failed" || s === "error" || s === "undefined" || s === "hook_error" || s === "cleanup_error") {
        return "fail";
      }
      if (s === "passed" || s === "pending") return "pass";
      if (s === "skipped") return "skip";
      return "";
    }
    function getRunningStepCount(sk) {
      var n = scenarioRunningStepCount[sk];
      return n == null || isNaN(n) ? 0 : n;
    }
    function bumpRunningStepCount(sk, delta) {
      if (!sk) return;
      var n = Math.max(0, getRunningStepCount(sk) + delta);
      scenarioRunningStepCount[sk] = n;
    }
    function isScenarioSettled(sk) {
      if (scenarioSkipped[sk]) return true;
      return !!scenarioDone[sk] && getRunningStepCount(sk) === 0;
    }
    function isScenarioIconPending(sk) {
      if (scenarioSkipped[sk] || scenarioDoneStatus[sk] === "skip") {
        return false;
      }
      if (scenarioFailed[sk] || scenarioDoneStatus[sk] === "fail") {
        return false;
      }
      return getRunningStepCount(sk) > 0 || !scenarioDone[sk];
    }
    function refreshScenarioIcon(sk) {
      var icon = scenarioIcons[sk];
      if (!icon) return;
      if (scenarioSkipped[sk] || scenarioDoneStatus[sk] === "skip") {
        setRowIcon(icon, "skip");
        return;
      }
      if (scenarioFailed[sk] || scenarioDoneStatus[sk] === "fail") {
        setRowIcon(icon, "fail");
        return;
      }
      if (isScenarioIconPending(sk)) {
        setRowIcon(icon, "pending");
        return;
      }
      if (scenarioDoneStatus[sk] === "pass") {
        setRowIcon(icon, "pass");
        return;
      }
      setRowIcon(icon, "none");
    }
    function refreshFeatureIcon() {
      if (!featureIconEl) return;
      var keys = Object.keys(scenarioIcons);
      if (keys.length === 0) {
        if (featureFinishedKind === "fail") {
          setRowIcon(featureIconEl, "fail");
          return;
        }
        if (featureFinishedKind === "pass") {
          setRowIcon(featureIconEl, "pass");
          return;
        }
        if (featureFinishedKind === "skip") {
          setRowIcon(featureIconEl, "skip");
          return;
        }
        setRowIcon(featureIconEl, featureRunCancelled ? "skip" : "pending");
        return;
      }
      var anyPendingChild = false;
      var anyScenarioSkipped = false;
      var anyScenarioFailed = false;
      var i;
      var k;
      for (i = 0; i < keys.length; i++) {
        k = keys[i];
        if (!isScenarioSettled(k)) anyPendingChild = true;
        if (scenarioSkipped[k] || scenarioDoneStatus[k] === "skip") {
          anyScenarioSkipped = true;
        }
        if (scenarioFailed[k] || scenarioDoneStatus[k] === "fail") {
          anyScenarioFailed = true;
        }
      }
      if (anyPendingChild) {
        setRowIcon(featureIconEl, "pending");
        return;
      }
      if (anyScenarioSkipped) {
        setRowIcon(featureIconEl, "skip");
        return;
      }
      if (anyScenarioFailed) {
        setRowIcon(featureIconEl, "fail");
        return;
      }
      var allPass = true;
      for (i = 0; i < keys.length; i++) {
        k = keys[i];
        if (scenarioDoneStatus[k] !== "pass") {
          allPass = false;
          break;
        }
      }
      setRowIcon(featureIconEl, allPass ? "pass" : "none");
    }
    function clearSelectionVisual() {
      if (selectedEl) {
        selectedEl.classList.remove("tree-item-selected");
        selectedEl = null;
      }
    }
    function setSelected(el) {
      clearSelectionVisual();
      if (el) {
        el.classList.add("tree-item-selected");
        selectedEl = el;
      }
    }
    function escapeHtml(s) {
      return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    }
    function setRowTooltip(el, text) {
      var t = text == null ? "" : String(text);
      if (t) {
        el.title = t;
      } else {
        el.removeAttribute("title");
      }
    }
    function splitHeuristicErrorTail(t) {
      if (!t) return { head: "", err: "" };
      var s = String(t).replace(/\r\n/g, "\n").replace(/^\n+/, "");
      var m = s.match(
        /^([\s\S]*?\n)(\s*(?:Traceback|During handling|AssertionError:|^Error:|\w+Error:)[\s\S]*)$/m
      );
      if (m && m[2] && m[2].trim()) {
        return { head: m[1], err: m[2] };
      }
      var ix = s.indexOf("\n\nTraceback");
      if (ix !== -1) {
        return { head: s.slice(0, ix + 1), err: s.slice(ix + 2) };
      }
      return { head: s, err: "" };
    }
    function pushLogSegment(arr, plain, err) {
      var p = plain || "";
      var e = (err || "").trim();
      if (!p && !e) return;
      arr.push({ p, e });
    }
    function appendLastSegmentErr(arr, text) {
      if (!arr || !arr.length || text == null || text === "") return;
      var last = arr[arr.length - 1];
      if (last && typeof last === "object" && "e" in last) {
        last.e = (last.e || "") + text;
      } else {
        arr.push({ p: "", e: String(text) });
      }
    }
    function unwrapConsoleFindMarks() {
      if (!consoleOut) return;
      var marks = consoleOut.querySelectorAll("mark.console-find-hit");
      for (var ui = marks.length - 1; ui >= 0; ui--) {
        var mk = marks[ui];
        var par = mk.parentNode;
        if (!par) continue;
        while (mk.firstChild) {
          par.insertBefore(mk.firstChild, mk);
        }
        par.removeChild(mk);
      }
      consoleOut.normalize();
    }
    function escapeRegExpForFind(s) {
      return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
    function highlightMatchesInTextNode(textNode, escapedPattern) {
      var text = textNode.nodeValue || "";
      if (!text.length) return;
      var execRe = new RegExp(escapedPattern, "gi");
      var last = 0;
      var chunks = [];
      var m;
      while ((m = execRe.exec(text)) !== null) {
        var st = m.index;
        var mat = m[0];
        if (st > last) {
          chunks.push({ slice: text.slice(last, st), mark: false });
        }
        chunks.push({ slice: mat, mark: true });
        last = st + mat.length;
        if (mat.length === 0) {
          execRe.lastIndex++;
          if (execRe.lastIndex > text.length) break;
        }
      }
      if (!chunks.length) return;
      if (last < text.length) {
        chunks.push({ slice: text.slice(last), mark: false });
      }
      var frag = document.createDocumentFragment();
      for (var ci = 0; ci < chunks.length; ci++) {
        var ch = chunks[ci];
        if (!ch.slice) continue;
        if (!ch.mark) {
          frag.appendChild(document.createTextNode(ch.slice));
        } else {
          var mrk = document.createElement("mark");
          mrk.className = "console-find-hit";
          mrk.appendChild(document.createTextNode(ch.slice));
          frag.appendChild(mrk);
        }
      }
      if (!frag.childNodes.length || !textNode.parentNode) return;
      textNode.parentNode.replaceChild(frag, textNode);
    }
    function syncConsoleFindIndex(idx) {
      if (!consoleFindCounts) return;
      if (!consoleFindMarks.length) {
        consoleFindCounts.textContent = "";
        consoleFindUiIndex = -1;
        return;
      }
      var len = consoleFindMarks.length;
      var i = idx % len;
      if (i < 0) i += len;
      for (var zi = 0; zi < len; zi++) {
        consoleFindMarks[zi].classList.toggle(
          "console-find-hit-current",
          zi === i
        );
      }
      consoleFindUiIndex = i;
      consoleFindCounts.textContent = String(i + 1) + " of " + String(len);
      try {
        consoleFindMarks[i].scrollIntoView({
          block: "nearest",
          inline: "nearest"
        });
      } catch (_) {
      }
    }
    function findConsoleNextMark() {
      if (!consoleFindMarks.length) return;
      syncConsoleFindIndex(consoleFindUiIndex + 1);
    }
    function findConsolePrevMark() {
      if (!consoleFindMarks.length) return;
      syncConsoleFindIndex(consoleFindUiIndex - 1);
    }
    function applyConsoleFindHighlights(rawQuery) {
      unwrapConsoleFindMarks();
      consoleFindMarks = [];
      consoleFindUiIndex = -1;
      var q = typeof rawQuery === "string" ? rawQuery.trim() : "";
      if (!consoleFindCounts || !consoleOut) return;
      if (!consoleOut.childNodes || consoleOut.childNodes.length === 0 || !q.length) {
        consoleFindCounts.textContent = "";
        return;
      }
      var esc = escapeRegExpForFind(q);
      var pile = [];
      var w = document.createTreeWalker(consoleOut, NodeFilter.SHOW_TEXT);
      var node;
      while (node = w.nextNode()) {
        pile.push(node);
      }
      for (var pi = pile.length - 1; pi >= 0; pi--) {
        highlightMatchesInTextNode(pile[pi], esc);
      }
      consoleFindMarks = Array.prototype.slice.call(
        consoleOut.querySelectorAll("mark.console-find-hit"),
        0
      );
      if (!consoleFindMarks.length) {
        consoleFindCounts.textContent = "No results";
        return;
      }
      syncConsoleFindIndex(0);
    }
    function hideConsoleFind(opts) {
      opts = opts || {};
      unwrapConsoleFindMarks();
      consoleFindMarks = [];
      consoleFindUiIndex = -1;
      if (consoleFindCounts) consoleFindCounts.textContent = "";
      if (consoleFindBar) {
        consoleFindBar.classList.add("console-find-bar--hidden");
      }
      if (opts.resetQuery && consoleFindInput instanceof HTMLInputElement) {
        consoleFindInput.value = "";
      }
    }
    function openConsoleFind() {
      if (!consoleFindBar || !shell || shell.classList.contains("hidden")) {
        return;
      }
      consoleFindBar.classList.remove("console-find-bar--hidden");
      applyConsoleFindHighlights(
        consoleFindInput instanceof HTMLInputElement ? consoleFindInput.value : ""
      );
      if (consoleFindInput instanceof HTMLInputElement) {
        consoleFindInput.focus();
        consoleFindInput.select();
      }
    }
    function syncConsoleFindAfterRender() {
      if (!consoleOut) return;
      var barOpen = !!consoleFindBar && !consoleFindBar.classList.contains("console-find-bar--hidden");
      unwrapConsoleFindMarks();
      consoleFindMarks = [];
      consoleFindUiIndex = -1;
      if (!barOpen) {
        if (consoleFindCounts) consoleFindCounts.textContent = "";
        return;
      }
      if (consoleFindCounts) consoleFindCounts.textContent = "";
      if (consoleFindInput instanceof HTMLInputElement && String(consoleFindInput.value || "").trim().length > 0) {
        applyConsoleFindHighlights(consoleFindInput.value);
      }
    }
    function isLiveShellVisible() {
      return !!shell && !shell.classList.contains("hidden") && !!emptyPlaceholder && emptyPlaceholder.classList.contains("hidden");
    }
    function renderLogSegments(parts, followTailIfNearBottom) {
      if (!parts || !parts.length) {
        if (consoleOut) consoleOut.textContent = "";
        syncConsoleFindAfterRender();
        return;
      }
      var html = "";
      for (var i = 0; i < parts.length; i++) {
        var seg = parts[i];
        var head = "";
        var err = "";
        if (typeof seg === "string") {
          var sp = splitHeuristicErrorTail(seg);
          head = sp.head;
          err = sp.err;
        } else if (seg && typeof seg === "object") {
          head = String(seg.p || "").replace(/\r\n/g, "\n").replace(/^\n+/, "");
          err = String(seg.e || "").replace(/\r\n/g, "\n").replace(/^\n+/, "");
        }
        if (head) {
          html += '<span class="console-line">' + escapeHtml(head) + "</span>";
        }
        if (err && err.trim()) {
          html += '<span class="console-err">' + escapeHtml(err) + "</span>";
        }
      }
      if (!html.trim()) {
        if (consoleOut) consoleOut.textContent = "";
        syncConsoleFindAfterRender();
        return;
      }
      if (consoleOut) {
        var follow = !!followTailIfNearBottom;
        var distFromBottom = 0;
        var preservePin = false;
        if (follow) {
          var maxScrollBefore = consoleOut.scrollHeight - consoleOut.clientHeight;
          var nearBottom = maxScrollBefore <= 0 || consoleOut.scrollTop >= maxScrollBefore - TREE_SCROLL_BOTTOM_EPS_PX;
          if (!nearBottom && maxScrollBefore > 0) {
            preservePin = true;
            distFromBottom = consoleOut.scrollHeight - consoleOut.scrollTop - consoleOut.clientHeight;
          }
        }
        consoleOut.innerHTML = html;
        syncConsoleFindAfterRender();
        if (follow) {
          if (preservePin) {
            var nh = consoleOut.scrollHeight - consoleOut.clientHeight;
            consoleOut.scrollTop = Math.max(0, nh - distFromBottom);
          } else {
            consoleOut.scrollTop = consoleOut.scrollHeight;
          }
        } else {
          consoleOut.scrollTop = 0;
        }
      } else {
        syncConsoleFindAfterRender();
      }
    }
    function showConsolePlain(text) {
      var t = (text || "").replace(/\r\n/g, "\n").replace(/^\n+/, "");
      if (!t.trim()) {
        if (consoleOut) consoleOut.textContent = "";
        syncConsoleFindAfterRender();
        return;
      }
      renderLogSegments([t]);
    }
    function showStepConsole(stepKey, followTailIfNearBottom) {
      var head = stepHeadlineByKey[stepKey];
      var err = (stepErrorByKey[stepKey] || "").replace(/\r\n/g, "\n").replace(/^\n+/, "");
      var joined = (logByStep[stepKey] || []).join("");
      if (head == null || head === "") {
        head = (joined.split("\n\n")[0] || "").trimEnd() + "\n";
        if (head === "\n") head = "";
      }
      if (head != null && head !== "") {
        head = String(head).replace(/^\n+/, "");
      }
      if (!err.trim()) {
        renderLogSegments([joined || head], followTailIfNearBottom);
        return;
      }
      if (!head) {
        renderLogSegments([joined], followTailIfNearBottom);
        return;
      }
      renderLogSegments([{ p: head, e: err }], followTailIfNearBottom);
    }
    function refreshConsoleIfLiveStepAppend() {
      if (!selectedEl || !selectedEl.dataset) return;
      var ds = selectedEl.dataset;
      if (ds.logScope === "feature") {
        renderLogSegments(logFeature, true);
      } else if (ds.logScope === "scenario" && ds.scenarioKey) {
        renderLogSegments(logByScenario[ds.scenarioKey] || [], true);
      } else if (selectedEl.classList && selectedEl.classList.contains("tree-step") && ds.stepKey) {
        showStepConsole(ds.stepKey, true);
      }
    }
    function bumpFeature(t) {
      if (t) pushLogSegment(logFeature, t, "");
    }
    function bumpScenario(k, t) {
      if (!k || !t) return;
      if (!logByScenario[k]) logByScenario[k] = [];
      pushLogSegment(logByScenario[k], t, "");
    }
    function bumpFeatureStepPart(plain, err) {
      pushLogSegment(logFeature, plain, err);
    }
    function bumpScenarioStepPart(k, plain, err) {
      if (!k) return;
      if (!logByScenario[k]) logByScenario[k] = [];
      pushLogSegment(logByScenario[k], plain, err);
    }
    function bumpStep(k, t) {
      if (!k || !t) return;
      if (!logByStep[k]) logByStep[k] = [];
      logByStep[k].push(t);
    }
    function wireExpandableDetails(detailsEl, summaryEl, onSingleSelect) {
      summaryEl.addEventListener("click", function(e) {
        var raw = e.target;
        var t = raw && raw.nodeType === 3 ? raw.parentElement : raw;
        if (t && t.closest && t.closest(".tree-chevron")) {
          e.preventDefault();
          e.stopPropagation();
          detailsEl.open = !detailsEl.open;
          return;
        }
        e.preventDefault();
        if (e.detail === 1) {
          onSingleSelect();
        }
      });
      summaryEl.addEventListener("dblclick", function(e) {
        var raw = e.target;
        var t = raw && raw.nodeType === 3 ? raw.parentElement : raw;
        if (t && t.closest && t.closest(".tree-chevron")) {
          return;
        }
        e.preventDefault();
        detailsEl.open = !detailsEl.open;
      });
    }
    function applyStepGotoDataset(lineEl, m) {
      var gp = m.gotoPath;
      var gl = m.gotoLine;
      if (gp != null && typeof gp === "string" && gp.length > 0 && gl != null && typeof gl === "number" && Number.isFinite(gl)) {
        lineEl.dataset.gotoPath = gp;
        lineEl.dataset.gotoLine = String(Math.floor(gl));
      } else {
        delete lineEl.dataset.gotoPath;
        delete lineEl.dataset.gotoLine;
      }
    }
    function findScenarioKeyForStepRow(row) {
      var det = row && row.closest && row.closest("details.tree-scenario");
      if (!det) return "";
      var sum = det.querySelector(":scope > summary");
      return sum && sum.dataset && sum.dataset.scenarioKey || "";
    }
    function findScenarioDetailsForKey(sk) {
      var icons = treeRoot.querySelectorAll("details.tree-scenario");
      var di;
      for (di = 0; di < icons.length; di++) {
        var sm = icons[di].querySelector(":scope > summary");
        if (sm && sm.dataset.scenarioKey === sk) {
          return icons[di];
        }
      }
      return null;
    }
    function applyFeatureFinishedSweep(featureStatus) {
      var kind = finalStatusKind(featureStatus);
      var stepKeys = Object.keys(pendingStepRowByKey);
      var si;
      for (si = 0; si < stepKeys.length; si++) {
        var stk = stepKeys[si];
        var row = pendingStepRowByKey[stk];
        if (!row) continue;
        var ic = row.querySelector(".tree-row-icon");
        if (ic) {
          if (kind === "fail") setRowIcon(ic, "fail");
          else if (kind === "skip") setRowIcon(ic, "skip");
          else if (kind === "pass") setRowIcon(ic, "pass");
          else setRowIcon(ic, "none");
        }
        if (kind === "fail") row.classList.add("tree-step-fail");
        var psk = findScenarioKeyForStepRow(row);
        if (psk) {
          bumpRunningStepCount(psk, -1);
          if (kind === "fail") scenarioFailed[psk] = true;
        }
        delete pendingStepRowByKey[stk];
      }
      var scenKeys = Object.keys(scenarioIcons);
      for (si = 0; si < scenKeys.length; si++) {
        var sk2 = scenKeys[si];
        if (scenarioDone[sk2]) continue;
        if (scenarioFailed[sk2]) {
          scenarioDone[sk2] = true;
          scenarioDoneStatus[sk2] = "fail";
        } else if (scenarioSkipped[sk2] || scenarioDoneStatus[sk2] === "skip") {
          scenarioDone[sk2] = true;
          scenarioDoneStatus[sk2] = "skip";
        } else if (kind === "fail") {
          scenarioDone[sk2] = true;
          scenarioDoneStatus[sk2] = "fail";
        } else if (kind === "skip") {
          scenarioDone[sk2] = true;
          scenarioDoneStatus[sk2] = "skip";
        } else {
          scenarioDone[sk2] = true;
          scenarioDoneStatus[sk2] = kind || "pass";
        }
        scenarioRunningStepCount[sk2] = 0;
        refreshScenarioIcon(sk2);
      }
      refreshFeatureIcon();
    }
    function applyRunCancelledSweep() {
      var stepKeys = Object.keys(pendingStepRowByKey);
      var si;
      for (si = 0; si < stepKeys.length; si++) {
        var stk = stepKeys[si];
        var row = pendingStepRowByKey[stk];
        if (!row) continue;
        var ic = row.querySelector(".tree-row-icon");
        if (ic) setRowIcon(ic, "skip");
        row.classList.remove("tree-step-fail");
        var psk = findScenarioKeyForStepRow(row);
        if (psk) bumpRunningStepCount(psk, -1);
        delete pendingStepRowByKey[stk];
      }
      var scenKeys = Object.keys(scenarioIcons);
      for (si = 0; si < scenKeys.length; si++) {
        var sk2 = scenKeys[si];
        var det = findScenarioDetailsForKey(sk2);
        var hasSkipStep = !!det && det.querySelector(".tree-step .tree-row-icon.icon-skip") !== null;
        var incomplete = !scenarioDone[sk2];
        scenarioSkipped[sk2] = !!(hasSkipStep || incomplete);
      }
      for (si = 0; si < scenKeys.length; si++) {
        refreshScenarioIcon(scenKeys[si]);
      }
      refreshFeatureIcon();
    }
    function bindStepLine(line, stepKey) {
      if (line.dataset.stepBound === "1") {
        return;
      }
      line.dataset.stepBound = "1";
      line.addEventListener("click", function(ev) {
        ev.stopPropagation();
        noteUserPinnedTreeSelection();
        setSelected(line);
        showStepConsole(stepKey);
      });
      line.addEventListener("dblclick", function(ev) {
        ev.preventDefault();
        ev.stopPropagation();
        if (!vscodeApi) return;
        var p = line.dataset.gotoPath;
        var lnStr = line.dataset.gotoLine;
        if (!p || lnStr === void 0 || lnStr === "") return;
        var lineNum = parseInt(lnStr, 10);
        if (isNaN(lineNum)) return;
        vscodeApi.postMessage({
          type: "revealStep",
          path: p,
          line: lineNum
        });
      });
    }
    function ensureStepListParentForScenario(sk, scenarioLabel) {
      if (sk && scenarioStepsBodyByKey[sk]) {
        return scenarioStepsBodyByKey[sk];
      }
      if (!featureBody) ensureFeatureBody("(feature)");
      var orphan = document.createElement("details");
      orphan.className = "tree-node tree-scenario";
      orphan.open = false;
      var orow = makeSummaryRow(scenarioLabel || "(scenario)");
      applyTreeRowBleed(orow.sum, 1);
      var ob = document.createElement("div");
      ob.className = "tree-children tree-steps";
      orphan.appendChild(orow.sum);
      orphan.appendChild(ob);
      featureBody.appendChild(orphan);
      if (sk) {
        scenarioStepsBodyByKey[sk] = ob;
      }
      currentScenarioSteps = ob;
      if (sk) {
        scenarioIcons[sk] = orow.icon;
        if (scenarioFailed[sk] === void 0) scenarioFailed[sk] = false;
        if (scenarioSkipped[sk] === void 0) scenarioSkipped[sk] = false;
        if (scenarioDone[sk] === void 0) scenarioDone[sk] = false;
        if (scenarioDoneStatus[sk] === void 0) scenarioDoneStatus[sk] = "";
        if (scenarioRunningStepCount[sk] === void 0) scenarioRunningStepCount[sk] = 0;
      }
      orow.sum.dataset.logScope = "scenario";
      orow.sum.dataset.scenarioKey = sk || "";
      wireExpandableDetails(orphan, orow.sum, function() {
        noteUserPinnedTreeSelection();
        setSelected(orow.sum);
        renderLogSegments(logByScenario[sk] || []);
      });
      if (sk) {
        refreshScenarioIcon(sk);
        refreshFeatureIcon();
      }
      return ob;
    }
    function makeSummaryRow(labelText) {
      var sum = document.createElement("summary");
      var chev = document.createElement("span");
      chev.className = "tree-chevron";
      chev.setAttribute("aria-hidden", "true");
      chev.textContent = String.fromCharCode(9654);
      var icon = document.createElement("span");
      icon.className = "tree-row-icon icon-none";
      icon.setAttribute("aria-hidden", "true");
      setRowIcon(icon, "pending");
      var lab = document.createElement("span");
      lab.className = "tree-row-label";
      lab.textContent = labelText;
      setRowTooltip(sum, labelText);
      sum.appendChild(chev);
      sum.appendChild(icon);
      sum.appendChild(lab);
      return { sum, icon };
    }
    function ensureFeatureBody(label) {
      var details = document.createElement("details");
      details.className = "tree-node tree-feature";
      details.open = true;
      var row = makeSummaryRow(label || "(feature)");
      featureIconEl = row.icon;
      var body = document.createElement("div");
      body.className = "tree-children";
      details.appendChild(row.sum);
      details.appendChild(body);
      treeRoot.appendChild(details);
      featureBody = body;
      currentScenarioSteps = null;
      scenarioStepsBodyByKey = /* @__PURE__ */ Object.create(null);
      row.sum.dataset.logScope = "feature";
      wireExpandableDetails(details, row.sum, function() {
        noteUserPinnedTreeSelection();
        setSelected(row.sum);
        renderLogSegments(logFeature);
      });
      setSelected(row.sum);
      renderLogSegments(logFeature);
      syncRunLayoutVisibility();
    }
    function handleLivePanelPayload(m) {
      if (!m || typeof m !== "object") return;
      if (m.type === "protocol") {
        livePanelProtocolOk = typeof m.version === "number" && m.version === LIVE_PANEL_PROTOCOL_EXPECTED;
        if (!livePanelProtocolOk && emptyPlaceholder) {
          emptyPlaceholder.textContent = "Behave Runner: Live panel protocol mismatch. Reinstall or rebuild the extension.";
          emptyPlaceholder.classList.remove("hidden");
          if (shell) shell.classList.add("hidden");
        }
        return;
      }
      if (!livePanelProtocolOk) {
        if (m.type === "replayCapture" || m.type === "clear" || m.type === "feature") {
          livePanelProtocolOk = true;
        } else {
          return;
        }
      }
      if (m.type === "replayCapture" && Array.isArray(m.messages)) {
        for (var ri = 0; ri < m.messages.length; ri++) {
          handleLivePanelPayload(m.messages[ri]);
        }
        syncRunLayoutVisibility();
        return;
      }
      if (m.type === "clear") {
        treeRoot.innerHTML = "";
        featureBody = null;
        currentScenarioSteps = null;
        logFeature.length = 0;
        logByScenario = /* @__PURE__ */ Object.create(null);
        logByStep = /* @__PURE__ */ Object.create(null);
        stepHeadlineByKey = /* @__PURE__ */ Object.create(null);
        stepErrorByKey = /* @__PURE__ */ Object.create(null);
        selectedEl = null;
        anonStepSeq = 0;
        scenarioStepsBodyByKey = /* @__PURE__ */ Object.create(null);
        featureIconEl = null;
        scenarioIcons = /* @__PURE__ */ Object.create(null);
        scenarioFailed = /* @__PURE__ */ Object.create(null);
        scenarioSkipped = /* @__PURE__ */ Object.create(null);
        scenarioDone = /* @__PURE__ */ Object.create(null);
        scenarioDoneStatus = /* @__PURE__ */ Object.create(null);
        scenarioRunningStepCount = /* @__PURE__ */ Object.create(null);
        pendingStepRowByKey = /* @__PURE__ */ Object.create(null);
        featureRunCancelled = false;
        featureFinishedKind = "";
        liveFollowSelection = true;
        hideConsoleFind({ resetQuery: true });
        if (consoleOut) consoleOut.textContent = "";
        syncRunLayoutVisibility();
        return;
      }
      if (m.type === "feature") {
        featureRunCancelled = false;
        featureFinishedKind = "";
        liveFollowSelection = true;
        ensureFeatureBody(m.label);
        refreshFeatureIcon();
        treeRoot.scrollTop = 0;
        return;
      }
      if (m.type === "scenario") {
        if (!featureBody) ensureFeatureBody("(feature)");
        var logLine = m.logLine || "\u2501\u2501 " + (m.name || "(scenario)") + " \u2501\u2501\n";
        bumpFeature(logLine);
        var sk = m.key;
        var selectKey = sk || "__scenario_nokey__";
        bumpScenario(selectKey, logLine);
        var existingBody = scenarioStepsBodyByKey[selectKey];
        if (existingBody) {
          currentScenarioSteps = existingBody;
          var existingDet = existingBody.parentElement;
          var mergeSum = null;
          if (existingDet && existingDet.classList.contains("tree-scenario")) {
            mergeSum = existingDet.querySelector(":scope > summary");
            if (mergeSum) {
              var elab = mergeSum.querySelector(".tree-row-label");
              var scenName = m.name || "(scenario)";
              if (elab) elab.textContent = scenName;
              setRowTooltip(mergeSum, scenName);
              mergeSum.dataset.logScope = "scenario";
              mergeSum.dataset.scenarioKey = selectKey;
              var mergeIcon = mergeSum.querySelector(".tree-row-icon");
              if (mergeIcon) scenarioIcons[selectKey] = mergeIcon;
            }
          }
          refreshScenarioIcon(selectKey);
          refreshFeatureIcon();
          if (liveFollowSelection && mergeSum) {
            setSelected(mergeSum);
          }
          refreshConsoleIfLiveStepAppend();
          return;
        }
        var sdet = document.createElement("details");
        sdet.className = "tree-node tree-scenario";
        sdet.open = false;
        var srow = makeSummaryRow(m.name || "(scenario)");
        applyTreeRowBleed(srow.sum, 1);
        var sbody = document.createElement("div");
        sbody.className = "tree-children tree-steps";
        sdet.appendChild(srow.sum);
        sdet.appendChild(sbody);
        featureBody.appendChild(sdet);
        currentScenarioSteps = sbody;
        scenarioStepsBodyByKey[selectKey] = sbody;
        scenarioIcons[selectKey] = srow.icon;
        scenarioFailed[selectKey] = false;
        scenarioSkipped[selectKey] = false;
        scenarioDone[selectKey] = false;
        scenarioDoneStatus[selectKey] = "";
        scenarioRunningStepCount[selectKey] = 0;
        refreshScenarioIcon(selectKey);
        refreshFeatureIcon();
        srow.sum.dataset.logScope = "scenario";
        srow.sum.dataset.scenarioKey = selectKey;
        wireExpandableDetails(sdet, srow.sum, function() {
          noteUserPinnedTreeSelection();
          setSelected(srow.sum);
          renderLogSegments(logByScenario[selectKey] || []);
        });
        if (liveFollowSelection) {
          setSelected(srow.sum);
        }
        refreshConsoleIfLiveStepAppend();
        return;
      }
      if (m.type === "scenario_finished") {
        var fsk = m.key;
        if (!fsk) return;
        scenarioDone[fsk] = true;
        scenarioDoneStatus[fsk] = finalStatusKind(m.status);
        if (scenarioDoneStatus[fsk] === "skip") {
          scenarioSkipped[fsk] = true;
        }
        refreshScenarioIcon(fsk);
        refreshFeatureIcon();
        return;
      }
      if (m.type === "feature_finished") {
        featureFinishedKind = finalStatusKind(m.status);
        applyFeatureFinishedSweep(m.status);
        return;
      }
      if (m.type === "runCancelled") {
        featureRunCancelled = true;
        applyRunCancelledSweep();
        return;
      }
      if (m.type === "hook_stdout") {
        var ht = m.text;
        if (ht == null || ht === "") return;
        bumpFeature(ht);
        var hsk = m.scenarioKey;
        if (hsk) bumpScenario(hsk, ht);
        refreshConsoleIfLiveStepAppend();
        return;
      }
      if (m.type === "step_log_append") {
        var apk = m.stepKey;
        var ask = m.scenarioKey;
        var atext = m.text;
        if (!apk || atext == null || atext === "") return;
        bumpFeature(atext);
        if (ask) bumpScenario(ask, atext);
        bumpStep(apk, atext);
        refreshConsoleIfLiveStepAppend();
        return;
      }
      if (m.type === "step_started") {
        var ssk = m.scenarioKey || "__orphan__";
        var startedKey = m.stepKey;
        if (!startedKey || pendingStepRowByKey[startedKey]) return;
        var followTreeTail = isTreeScrollNearBottom(treeRoot);
        var pstarted = ensureStepListParentForScenario(ssk, m.scenario || "(scenario)");
        var sline = document.createElement("div");
        sline.className = "tree-step";
        sline.dataset.stepKey = startedKey;
        var sic = document.createElement("span");
        sic.setAttribute("aria-hidden", "true");
        setRowIcon(sic, "pending");
        var slab = document.createElement("span");
        slab.className = "tree-row-label";
        var sstepLabel = ((m.keyword || "") + " " + (m.text || "")).replace(/\s+/g, " ").trim();
        var sstepDisplay = sstepLabel || "(step)";
        slab.textContent = sstepDisplay;
        setRowTooltip(sline, sstepDisplay);
        sline.appendChild(sic);
        sline.appendChild(slab);
        applyTreeRowBleed(sline, 2);
        applyStepGotoDataset(sline, m);
        pstarted.appendChild(sline);
        bindStepLine(sline, startedKey);
        pendingStepRowByKey[startedKey] = sline;
        bumpRunningStepCount(ssk, 1);
        refreshScenarioIcon(ssk);
        refreshFeatureIcon();
        scrollTreeRootToBottomIfWasFollowing(followTreeTail);
        return;
      }
      if (m.type === "step") {
        var followTreeTailStep = isTreeScrollNearBottom(treeRoot);
        var sk = m.scenarioKey || "__orphan__";
        var stepKey = m.stepKey || "anon-step-" + ++anonStepSeq;
        var logText = m.logText || (m.keyword || "") + " " + (m.text || "") + " \u2026 " + (m.status || "") + "\n";
        var headLine = m.logHeadline;
        if (headLine == null || headLine === "") {
          var ltParts = logText.split("\n\n");
          headLine = ltParts.length ? ltParts[0] : logText;
          if (headLine && !/\n$/.test(headLine)) {
            headLine += "\n";
          }
        }
        var stepErr = (m.error || "").trim();
        stepErrorByKey[stepKey] = stepErr;
        stepHeadlineByKey[stepKey] = headLine || "";
        bumpFeatureStepPart(headLine, stepErr);
        bumpScenarioStepPart(sk, headLine, stepErr);
        bumpStep(stepKey, logText);
        if (stepIsFail(m.status)) scenarioFailed[sk] = true;
        if (stepIsSkip(m.status)) scenarioSkipped[sk] = true;
        var parent = ensureStepListParentForScenario(sk, m.scenario || "(scenario)");
        var line = pendingStepRowByKey[stepKey];
        var hadLiveStart = line != null;
        delete pendingStepRowByKey[stepKey];
        if (hadLiveStart) {
          bumpRunningStepCount(sk, -1);
        }
        var ic;
        var lab;
        var stepLabel = ((m.keyword || "") + " " + (m.text || "")).replace(/\s+/g, " ").trim();
        var stepDisplay = stepLabel || "(step)";
        if (line) {
          line.className = "tree-step" + (stepIsFail(m.status) ? " tree-step-fail" : "");
          ic = line.querySelector(".tree-row-icon");
          lab = line.querySelector(".tree-row-label");
          if (ic) {
            if (stepIsSkip(m.status)) setRowIcon(ic, "skip");
            else if (stepIsFail(m.status)) setRowIcon(ic, "fail");
            else if (stepIsPassish(m.status)) setRowIcon(ic, "pass");
            else setRowIcon(ic, "none");
          }
          if (lab) lab.textContent = stepDisplay;
          setRowTooltip(line, stepDisplay);
          applyStepGotoDataset(line, m);
        } else {
          line = document.createElement("div");
          line.className = "tree-step" + (stepIsFail(m.status) ? " tree-step-fail" : "");
          line.dataset.stepKey = stepKey;
          ic = document.createElement("span");
          ic.setAttribute("aria-hidden", "true");
          if (stepIsSkip(m.status)) setRowIcon(ic, "skip");
          else if (stepIsFail(m.status)) setRowIcon(ic, "fail");
          else if (stepIsPassish(m.status)) setRowIcon(ic, "pass");
          else setRowIcon(ic, "none");
          lab = document.createElement("span");
          lab.className = "tree-row-label";
          lab.textContent = stepDisplay;
          setRowTooltip(line, stepDisplay);
          line.appendChild(ic);
          line.appendChild(lab);
          applyTreeRowBleed(line, 2);
          applyStepGotoDataset(line, m);
          parent.appendChild(line);
        }
        bindStepLine(line, stepKey);
        refreshScenarioIcon(sk);
        refreshFeatureIcon();
        scrollTreeRootToBottomIfWasFollowing(followTreeTailStep);
        refreshConsoleIfLiveStepAppend();
      }
    }
    window.addEventListener("message", function(e) {
      handleLivePanelPayload(e.data);
    });
    syncRunLayoutVisibility();
    document.addEventListener(
      "keydown",
      function(ev) {
        var k = String(ev.key || "").toLowerCase();
        var accelFind = (ev.ctrlKey || ev.metaKey) && k === "f" && !ev.shiftKey && !ev.altKey;
        var barOpen = !!consoleFindBar && !consoleFindBar.classList.contains("console-find-bar--hidden");
        if (accelFind) {
          if (barOpen || isLiveShellVisible()) {
            ev.preventDefault();
            ev.stopPropagation();
            if (barOpen) {
              hideConsoleFind({ resetQuery: false });
            } else {
              openConsoleFind();
            }
            return;
          }
        }
        if (barOpen && ev.key === "Escape") {
          ev.preventDefault();
          hideConsoleFind({ resetQuery: false });
          return;
        }
        if (barOpen && k === "f3") {
          ev.preventDefault();
          if (ev.shiftKey) findConsolePrevMark();
          else findConsoleNextMark();
        }
        if (barOpen && consoleFindInput instanceof HTMLInputElement && ev.key === "Enter" && document.activeElement === consoleFindInput) {
          ev.preventDefault();
          if (ev.shiftKey) findConsolePrevMark();
          else findConsoleNextMark();
        }
      },
      true
    );
    var btnRerun = document.getElementById("btnRerun");
    if (btnRerun && vscodeApi) {
      btnRerun.addEventListener("click", function() {
        vscodeApi.postMessage({ type: "rerunLastRun" });
      });
    }
    var btnStop = document.getElementById("btnStop");
    if (btnStop && vscodeApi) {
      btnStop.addEventListener("click", function() {
        vscodeApi.postMessage({ type: "stopRun" });
      });
    }
    var btnConsoleFind = document.getElementById("btnConsoleFind");
    if (btnConsoleFind) {
      btnConsoleFind.addEventListener("click", function() {
        if (consoleFindBar && !consoleFindBar.classList.contains("console-find-bar--hidden")) {
          if (consoleFindInput instanceof HTMLInputElement) {
            consoleFindInput.focus();
            consoleFindInput.select();
          }
        } else {
          openConsoleFind();
        }
      });
    }
    var bFindPrev = document.getElementById("consoleFindPrev");
    var bFindNext = document.getElementById("consoleFindNext");
    var bFindClose = document.getElementById("consoleFindClose");
    if (bFindPrev) bFindPrev.addEventListener("click", findConsolePrevMark);
    if (bFindNext) bFindNext.addEventListener("click", findConsoleNextMark);
    if (bFindClose)
      bFindClose.addEventListener("click", function() {
        hideConsoleFind({ resetQuery: false });
      });
    if (consoleFindInput instanceof HTMLInputElement) {
      var cfiIn = consoleFindInput;
      cfiIn.addEventListener("input", function() {
        applyConsoleFindHighlights(cfiIn.value);
      });
    }
    if (vscodeApi) {
      vscodeApi.postMessage({ type: "livePanelReady" });
    }
  })();
})();
