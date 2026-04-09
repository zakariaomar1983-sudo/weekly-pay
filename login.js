window.OPXAuth.init();

const sessionUser = window.OPXAuth.getSessionUser();
if (sessionUser) {
  const hasCRM = window.OPXAuth.canUser(sessionUser, "accessCRM");
  const hasLogs = window.OPXAuth.canUser(sessionUser, "accessLogs");
  window.location.href = hasCRM ? "./index.html" : hasLogs ? "./log.html" : "./control-panel.html";
}

const loginForm = document.getElementById("loginForm");
const loginError = document.getElementById("loginError");

loginForm.addEventListener("submit", (e) => {
  e.preventDefault();

  const username = document.getElementById("username").value.trim();
  const password = document.getElementById("password").value;

  const result = window.OPXAuth.login(username, password);
  if (!result.ok) {
    loginError.textContent = result.message;
    return;
  }

  const user = result.user;
  const hasCRM = window.OPXAuth.canUser(user, "accessCRM");
  const hasLogs = window.OPXAuth.canUser(user, "accessLogs");
  const hasCP = window.OPXAuth.canUser(user, "accessControlPanel");

  if (hasCRM) {
    window.location.href = "./index.html";
    return;
  }

  if (hasLogs) {
    window.location.href = "./log.html";
    return;
  }

  if (hasCP) {
    window.location.href = "./control-panel.html";
    return;
  }

  loginError.textContent = "This account has no page access assigned.";
  window.OPXAuth.logout();
});
