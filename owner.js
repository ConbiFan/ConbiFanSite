import { getClient, isOwnerUser, signOutCurrentUser, startOwnerMagicLink } from "./site-interactions.js";

const status = document.querySelector("[data-owner-page-status]");
const email = document.querySelector("[data-owner-page-email]");
const login = document.querySelector("[data-owner-page-login]");
const logout = document.querySelector("[data-owner-page-logout]");

function getConfig() {
  return window.CF_INTERACTIONS_CONFIG || {};
}

function render(message) {
  const config = getConfig();
  if (email) {
    email.textContent = config.ownerEmail || "(ownerEmail 未設定)";
  }

  if (message) {
    status.textContent = message;
    return;
  }
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
    return;
  }

  if (!config.ownerEmail) {
    status.textContent = "ownerEmail が未設定。ここに自分のメールを入れるまで削除権限は使えない。";
    login.hidden = false;
    login.disabled = true;
    logout.hidden = true;
    return;
  }

  const client = await getClient();
  const result = await client.auth.getUser();
  const user = result.data.user;

  if (isOwnerUser(user)) {
    status.textContent = "オーナーとしてログイン中。このブラウザからコメント削除ができる。";
    login.hidden = true;
    logout.hidden = false;
    return;
  }

  status.textContent = "まだ owner ログインしてない。magic link を送ればすぐ入れる。";
  login.hidden = false;
  logout.hidden = true;
}

document.addEventListener("DOMContentLoaded", function () {
  render();
  refresh().catch(function (error) {
    status.textContent = String(error.message || error);
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
