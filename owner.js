import {
  deleteComment,
  fetchReports,
  getClient,
  isOwnerUser,
  resolveReport,
  signOutCurrentUser,
  startOwnerMagicLink
} from "./site-interactions.js";

const status = document.querySelector("[data-owner-page-status]");
const email = document.querySelector("[data-owner-page-email]");
const login = document.querySelector("[data-owner-page-login]");
const logout = document.querySelector("[data-owner-page-logout]");
const reportsStatus = document.querySelector("[data-owner-reports-status]");
const reportsList = document.querySelector("[data-owner-reports-list]");
const dateFormatter = new Intl.DateTimeFormat("ja-JP", {
  dateStyle: "short",
  timeStyle: "short"
});

function getConfig() {
  return window.CF_INTERACTIONS_CONFIG || {};
}

function formatDate(value) {
  try {
    return dateFormatter.format(new Date(value));
  } catch (error) {
    return "";
  }
}

function createElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) {
    element.className = className;
  }
  if (typeof text === "string") {
    element.textContent = text;
  }
  return element;
}

function setReportStatus(text) {
  if (reportsStatus) {
    reportsStatus.textContent = text;
  }
}

function clearReportList() {
  if (reportsList) {
    reportsList.innerHTML = "";
  }
}

function render(message) {
  const config = getConfig();
  if (email) {
    email.textContent = config.ownerEmail || "(ownerEmail 未設定)";
  }

  if (message) {
    status.textContent = message;
  }
}

async function loadReports() {
  clearReportList();
  setReportStatus("通報一覧を読み込み中...");

  try {
    const reports = await fetchReports();
    const unresolved = reports.filter(function (report) {
      return !report.resolved_at;
    });

    if (!unresolved.length) {
      setReportStatus("未解決の通報はない。平和。");
      return;
    }

    setReportStatus("未解決 " + unresolved.length + " 件");
    unresolved.forEach(function (report) {
      reportsList.appendChild(buildReportCard(report));
    });
  } catch (error) {
    setReportStatus(String(error.message || error));
  }
}

function buildReportCard(report) {
  const card = createElement("article", "report-card");
  const head = createElement("div", "report-head");
  const title = createElement("div", "report-title", report.item_label || "対象不明");
  const time = createElement("div", "report-time", formatDate(report.created_at));
  const meta = createElement(
    "div",
    "report-meta",
    "ページ: " +
      report.page_path +
      "\n投稿者: " +
      report.comment_author +
      (report.comment_id ? "" : "\nコメントはすでに削除済み")
  );
  const reasonLabel = createElement("div", "label", "通報理由");
  const reasonBox = createElement("div", "report-box", report.reason);
  const bodyLabel = createElement("div", "label", "通報対象コメント");
  const bodyBox = createElement("div", "report-box", report.comment_body);
  const actions = createElement("div", "report-actions");
  const openLink = createElement("a", "secondary", "対象ページを開く");
  openLink.href = report.page_path || "index.html";

  const resolveButton = createElement("button", "secondary", "解決済みにする");
  resolveButton.type = "button";
  resolveButton.addEventListener("click", async function () {
    resolveButton.disabled = true;
    setReportStatus("通報を解決済みにしてる...");

    try {
      await resolveReport(report.id);
      await loadReports();
    } catch (error) {
      setReportStatus(String(error.message || error));
      resolveButton.disabled = false;
    }
  });

  actions.appendChild(openLink);
  actions.appendChild(resolveButton);

  if (report.comment_id) {
    const deleteButton = createElement("button", "danger", "コメントを削除して解決");
    deleteButton.type = "button";
    deleteButton.addEventListener("click", async function () {
      const ok = window.confirm("このコメントを削除して、この通報も解決済みにする？");
      if (!ok) {
        return;
      }

      deleteButton.disabled = true;
      setReportStatus("コメント削除と通報解決を処理中...");

      try {
        await deleteComment(report.comment_id);
        await resolveReport(report.id);
        await loadReports();
      } catch (error) {
        setReportStatus(String(error.message || error));
        deleteButton.disabled = false;
      }
    });
    actions.appendChild(deleteButton);
  }

  head.appendChild(title);
  head.appendChild(time);
  card.appendChild(head);
  card.appendChild(meta);
  card.appendChild(reasonLabel);
  card.appendChild(reasonBox);
  card.appendChild(bodyLabel);
  card.appendChild(bodyBox);
  card.appendChild(actions);
  return card;
}

async function refresh() {
  const config = getConfig();
  if (!config.supabaseUrl || !config.supabaseAnonKey) {
    render("site-interactions-config.js の Supabase 設定がまだ空。");
    if (login) {
      login.disabled = true;
    }
    if (logout) {
      logout.disabled = true;
    }
    clearReportList();
    setReportStatus("Supabase 設定待ち。");
    return;
  }

  if (!config.ownerEmail) {
    status.textContent = "ownerEmail が未設定。ここに自分のメールを入れるまで削除権限は使えない。";
    login.hidden = false;
    login.disabled = true;
    logout.hidden = true;
    clearReportList();
    setReportStatus("ownerEmail を入れると通報一覧も使える。");
    return;
  }

  const client = await getClient();
  const result = await client.auth.getUser();
  const user = result.data.user;

  if (isOwnerUser(user)) {
    status.textContent = "オーナーとしてログイン中。このブラウザからコメント削除と通報確認ができる。";
    login.hidden = true;
    logout.hidden = false;
    await loadReports();
    return;
  }

  status.textContent = "まだ owner ログインしてない。magic link を送ればすぐ入れる。";
  login.hidden = false;
  logout.hidden = true;
  clearReportList();
  setReportStatus("owner ログインするとここに通報一覧が出る。");
}

document.addEventListener("DOMContentLoaded", function () {
  render();
  refresh().catch(function (error) {
    status.textContent = String(error.message || error);
    setReportStatus(String(error.message || error));
  });

  login.addEventListener("click", async function () {
    login.disabled = true;
    status.textContent = "magic link を送信中...";

    try {
      await startOwnerMagicLink();
      status.textContent =
        "メールを送った。届いたリンクをこのページかサイト上で開けば owner になる。";
      await refresh();
    } catch (error) {
      status.textContent = String(error.message || error);
    } finally {
      login.disabled = false;
    }
  });

  logout.addEventListener("click", async function () {
    logout.disabled = true;
    status.textContent = "ログアウト中...";

    try {
      await signOutCurrentUser();
      status.textContent = "ログアウトした。";
      await refresh();
    } catch (error) {
      status.textContent = String(error.message || error);
    } finally {
      logout.disabled = false;
    }
  });
});
