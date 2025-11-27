const STORAGE_KEY = "cookieCopyPaster.settings";
const MESSAGE_TYPE_COPY = "copyCookies";
const MESSAGE_TYPE_CLEAR = "clearCookies";
const MESSAGE_TYPE_AUTHORIZE = "authorize";
const SAVE_DEBOUNCE_MS = 300;
const REQUIRED_SELECTOR_PREFIXES = ["#", "."];
const AUTO_COPY_RETRY_COUNT = 3;
const AUTO_COPY_RETRY_DELAY_MS = 700;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const form = document.querySelector("#cookie-form");
const sourceUrlInput = document.querySelector("#source-url");
const destinationUrlInput = document.querySelector("#destination-url");
const keysInput = document.querySelector("#cookie-keys");
const copyAllCheckbox = document.querySelector("#copy-all");
const copyButton = document.querySelector("#copy-button");
const clearCookiesButton = document.querySelector("#clear-cookies-button");
const authorizeButton = document.querySelector("#authorize-button");
const statusSection = document.querySelector("#status");
const statusMessage = document.querySelector("#status-message");
const errorList = document.querySelector("#error-list");
const autoCopyAfterAuthCheckbox = document.querySelector("#auto-copy-after-auth");
const authAccordion = document.querySelector("#auth-accordion");
const authUrlInput = document.querySelector("#auth-url");
const authUsernameInput = document.querySelector("#auth-username");
const authPasswordInput = document.querySelector("#auth-password");
const authUsernameSelectorInput = document.querySelector("#auth-username-selector");
const authPasswordSelectorInput = document.querySelector("#auth-password-selector");
const authSubmitSelectorInput = document.querySelector("#auth-submit-selector");

const defaultSettings = {
  sourceUrl: "",
  destinationUrl: "https://localhost:5173/",
  keys: "",
  copyAll: true,
  autoCopyAfterAuth: true,
  authUrl: "",
  authUsername: "",
  authPassword: "",
  authUsernameSelector: "#USERNAME_FIELD-inner",
  authPasswordSelector: "#PASSWORD_FIELD-inner",
  authSubmitSelector: "#LOGIN_LINK",
};

let currentSettings = { ...defaultSettings };
let saveTimeoutId = null;

init().catch((error) => {
  console.error("Не удалось инициализировать окно расширения:", error);
  showStatus(`Не удалось загрузить настройки: ${error.message}`, true);
});

async function init() {
  await restoreFormState();
  handleCopyAllToggle();
  updateAuthorizeButtonState();

  sourceUrlInput.addEventListener("input", () =>
    updateSettings({ sourceUrl: sourceUrlInput.value })
  );

  destinationUrlInput.addEventListener("input", () =>
    updateSettings({ destinationUrl: destinationUrlInput.value })
  );

  keysInput.addEventListener("input", () =>
    updateSettings({ keys: keysInput.value })
  );

  copyAllCheckbox.addEventListener("change", handleCopyAllToggle);
  copyAllCheckbox.addEventListener("change", () =>
    updateSettings({ copyAll: copyAllCheckbox.checked })
  );

  autoCopyAfterAuthCheckbox?.addEventListener("change", () =>
    updateSettings({ autoCopyAfterAuth: autoCopyAfterAuthCheckbox.checked })
  );

  registerAuthInput(authUrlInput, "authUrl");
  registerAuthInput(authUsernameInput, "authUsername");
  registerAuthInput(authPasswordInput, "authPassword");
  registerAuthInput(authUsernameSelectorInput, "authUsernameSelector");
  registerAuthInput(authPasswordSelectorInput, "authPasswordSelector");
  registerAuthInput(authSubmitSelectorInput, "authSubmitSelector");

  clearCookiesButton.addEventListener("click", handleClearCookies);
  authorizeButton.addEventListener("click", handleAuthorize);

  form.addEventListener("submit", handleSubmit);
}

async function restoreFormState() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const settings = stored?.[STORAGE_KEY];

  // Всегда начинаем с defaultSettings
  currentSettings = { ...defaultSettings };

  // Если есть сохранённые настройки — объединяем (переопределяем дефолты)
  if (settings) {
    Object.assign(currentSettings, settings);
  }

  // Теперь устанавливаем значения в поля формы из currentSettings
  sourceUrlInput.value = currentSettings.sourceUrl;
  destinationUrlInput.value = currentSettings.destinationUrl;
  keysInput.value = currentSettings.keys;
  copyAllCheckbox.checked = currentSettings.copyAll;

  if (autoCopyAfterAuthCheckbox) {
    autoCopyAfterAuthCheckbox.checked = currentSettings.autoCopyAfterAuth;
  }

  if (authUrlInput) authUrlInput.value = currentSettings.authUrl;
  if (authUsernameInput) authUsernameInput.value = currentSettings.authUsername;
  if (authPasswordInput) authPasswordInput.value = currentSettings.authPassword;
  if (authUsernameSelectorInput) authUsernameSelectorInput.value = currentSettings.authUsernameSelector;
  if (authPasswordSelectorInput) authPasswordSelectorInput.value = currentSettings.authPasswordSelector;
  if (authSubmitSelectorInput) authSubmitSelectorInput.value = currentSettings.authSubmitSelector;
}

async function handleSubmit(event) {
  event.preventDefault();
  await copyCookies();
}
async function copyCookies({ mode = "manual", retries = 0, retryDelayMs = 500 } = {}) {
  const isManual = mode === "manual";
  if (isManual) {
    clearStatus();
  }
  const sourceUrl = sourceUrlInput.value.trim();
  const destinationUrl = destinationUrlInput.value.trim();
  const keys = keysInput.value.trim();
  const copyAll = copyAllCheckbox.checked;
  try {
    await saveSettings({ sourceUrl, destinationUrl, keys, copyAll });
  } catch (error) {
    if (isManual) {
      showStatus(`Не удалось сохранить настройки: ${error.message}`, true);
    }
    return { success: false, error };
  }
  if (isManual) {
    setCopyLoading(true);
  }
  let lastError = null;
  try {
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      if (!isManual && attempt > 0) {
        await delay(retryDelayMs);
      }

      try {
        const response = await chrome.runtime.sendMessage({
          type: MESSAGE_TYPE_COPY,
          payload: { sourceUrl, destinationUrl, keys, copyAll },
        });

        if (!response?.success) {
          throw new Error(response?.error ?? "Не удалось выполнить копирование.");
        }

        const result = response?.result ?? { copied: 0, attempted: 0, skipped: 0, errors: [] };

        if (!isManual && attempt < retries && (result.attempted ?? 0) === 0) {
          continue;
        }

        const summaryParts = [
          `Скопировано cookie: ${result.copied}`,
          `Попыток: ${result.attempted}`,
        ];

        if (result.skipped) {
          summaryParts.push(`Пропущено: ${result.skipped}`);
        }

        const summary = summaryParts.join(", ");

        if (isManual) {
          showStatus(summary);
          renderErrors(result.errors);
        }

        return { success: true, summary, errors: result.errors ?? [], details: result };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        console.error("Не удалось скопировать cookie:", lastError);

        if (isManual || attempt === retries) {
          if (isManual) {
            showStatus(lastError.message ?? String(lastError), true);
          }
          return { success: false, error: lastError };
        }
      }
    }
  } finally {
    if (isManual) {
      setCopyLoading(false);
    }
  }

  return {
    success: false,
    error: lastError ?? new Error("Не удалось скопировать cookie автоматически."),
  };
}
async function handleClearCookies() {
  clearStatus();

  setClearCookiesLoading(true);
  try {
    const queryTabs = (queryInfo) =>
      new Promise((resolve, reject) => {
        chrome.tabs.query(queryInfo, (tabs) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          resolve(tabs);
        });
      });

    let [activeTab] = await queryTabs({ active: true, lastFocusedWindow: true });

    if (!activeTab) {
      [activeTab] = await queryTabs({ active: true, currentWindow: true });
    }

    const url =
      typeof activeTab?.url === "string" ? activeTab.url.trim() : "";

    if (!url) {
      showStatus("Не удалось определить URL текущей вкладки.", true);
      return;
    }

    const response = await chrome.runtime.sendMessage({
      type: MESSAGE_TYPE_CLEAR,
      payload: { url },
    });

    if (!response?.success) {
      throw new Error(response?.error ?? "Не удалось очистить cookie.");
    }

    const { removed, total, host, errors } = response.result ?? {};
    const hostLabel = host ? ` (${host})` : "";
    showStatus(`Удалено cookie: ${removed ?? 0} из ${total ?? 0}${hostLabel}.`);
    renderErrors(errors);
  } catch (error) {
    console.error("Ошибка очистки cookie:", error);
    showStatus(error.message ?? String(error), true);
  } finally {
    setClearCookiesLoading(false);
  }
}

async function handleAuthorize() {
  clearStatus();

  if (authAccordion && !authAccordion.open) {
    authAccordion.open = true;
  }

  const authValues = getAuthValues();

  if (!areAuthFieldsValid(authValues)) {
    showStatus("Заполните все поля авторизации и селекторы.", true);
    updateAuthorizeButtonState();
    return;
  }

  const selectorValidation = validateSelectors(authValues);
  if (!selectorValidation.valid) {
    showStatus(selectorValidation.message, true);
    return;
  }

  try {
    await saveSettings({
      authUrl: authValues.url,
      authUsername: authValues.username,
      authPassword: authValues.password,
      authUsernameSelector: authValues.usernameSelector,
      authPasswordSelector: authValues.passwordSelector,
      authSubmitSelector: authValues.submitSelector,
    });
  } catch (error) {
    showStatus(`Не удалось сохранить настройки авторизации: ${error.message}`, true);
    return;
  }

  setAuthorizeLoading(true);
  try {
    const response = await chrome.runtime.sendMessage({
      type: MESSAGE_TYPE_AUTHORIZE,
      payload: {
        url: authValues.url,
        username: authValues.username,
        password: authValues.password,
        selectors: {
          username: authValues.usernameSelector,
          password: authValues.passwordSelector,
          submit: authValues.submitSelector,
        },
      },
    });

    if (!response?.success) {
      throw new Error(response?.error ?? "Не удалось выполнить авторизацию.");
    }

    const authMessage =
      response.result?.message ?? "Авторизация и заполнение формы выполнены.";
    const authErrors = response.result?.errors ?? [];

    let statusText = authMessage;
    let combinedErrors = [...authErrors];

    if (shouldAutoCopyAfterAuth()) {
      const autoCopyResult = await copyCookies({
        mode: "auto",
        retries: AUTO_COPY_RETRY_COUNT,
        retryDelayMs: AUTO_COPY_RETRY_DELAY_MS,
      });

      if (autoCopyResult.success) {
        statusText = `${authMessage} ${autoCopyResult.summary}`;
        if (autoCopyResult.errors?.length) {
          combinedErrors = [...authErrors, ...autoCopyResult.errors];
        }
      } else if (autoCopyResult.error) {
        statusText = `${authMessage} ${autoCopyResult.error.message ?? String(autoCopyResult.error)}`;
      }

      if (!autoCopyResult.success && autoCopyResult.errors?.length) {
        combinedErrors = [...authErrors, ...autoCopyResult.errors];
      }
    }

    showStatus(statusText);
    renderErrors(combinedErrors);
  } catch (error) {
    console.error("Ошибка автоматической авторизации:", error);
    showStatus(error.message ?? String(error), true);
  } finally {
    setAuthorizeLoading(false);
  }
}

function handleCopyAllToggle() {
  const copyAll = copyAllCheckbox.checked;
  keysInput.disabled = copyAll;
  if (copyAll) {
    keysInput.dataset.placeholder = keysInput.placeholder;
    keysInput.placeholder = "Список не используется";
  } else if (keysInput.dataset.placeholder) {
    keysInput.placeholder = keysInput.dataset.placeholder;
    delete keysInput.dataset.placeholder;
  }
}

function shouldAutoCopyAfterAuth() {
  if (!autoCopyAfterAuthCheckbox?.checked) {
    return false;
  }

  const sourceUrl = sourceUrlInput.value.trim();
  const destinationUrl = destinationUrlInput.value.trim();
  return Boolean(sourceUrl && destinationUrl);
}

async function saveSettings(settings) {
  await updateSettings(settings, { immediate: true });
}

async function updateSettings(partialSettings, options = {}) {
  currentSettings = { ...currentSettings, ...partialSettings };

  if (options.immediate) {
    await persistSettings();
    return;
  }

  schedulePersist();
}

function schedulePersist() {
  if (saveTimeoutId) {
    clearTimeout(saveTimeoutId);
  }

  saveTimeoutId = setTimeout(() => {
    persistSettings().catch((error) => {
      console.error("Не удалось сохранить настройки:", error);
    });
  }, SAVE_DEBOUNCE_MS);
}

async function persistSettings() {
  if (saveTimeoutId) {
    clearTimeout(saveTimeoutId);
    saveTimeoutId = null;
  }

  await chrome.storage.local.set({ [STORAGE_KEY]: currentSettings });
}

function showStatus(message, isError = false) {
  statusSection.hidden = false;
  statusSection.classList.toggle("error", isError);
  statusMessage.textContent = message;
}

function clearStatus() {
  statusSection.hidden = true;
  statusSection.classList.remove("error");
  statusMessage.textContent = "";
  errorList.innerHTML = "";
}

function renderErrors(errors = []) {
  errorList.innerHTML = "";
  if (!errors?.length) {
    return;
  }

  for (const { name, message } of errors) {
    const li = document.createElement("li");
    li.textContent = `${name}: ${message}`;
    errorList.appendChild(li);
  }
}

function registerAuthInput(element, key) {
  if (!element) {
    return;
  }

  element.addEventListener("input", () => {
    updateSettings({ [key]: element.value });
    updateAuthorizeButtonState();
  });
}

function updateAuthorizeButtonState() {
  if (!authorizeButton) {
    return;
  }

  if (authorizeButton.dataset.loading === "true") {
    authorizeButton.disabled = true;
    return;
  }

  authorizeButton.disabled = !areAuthFieldsValid(getAuthValues());
}

function areAuthFieldsValid(values) {
  return Boolean(
    values.url &&
      values.username &&
      values.password &&
      values.usernameSelector &&
      values.passwordSelector &&
      values.submitSelector
  );
}

function getAuthValues() {
  return {
    url: authUrlInput?.value.trim() ?? "",
    username: authUsernameInput?.value ?? "",
    password: authPasswordInput?.value ?? "",
    usernameSelector: authUsernameSelectorInput?.value.trim() ?? "",
    passwordSelector: authPasswordSelectorInput?.value.trim() ?? "",
    submitSelector: authSubmitSelectorInput?.value.trim() ?? "",
  };
}

function validateSelectors({ usernameSelector, passwordSelector, submitSelector }) {
  const checks = [
    { selector: usernameSelector, label: "Селектор поля логина" },
    { selector: passwordSelector, label: "Селектор поля пароля" },
    { selector: submitSelector, label: "Селектор кнопки входа" },
  ];

  for (const { selector, label } of checks) {
    if (!REQUIRED_SELECTOR_PREFIXES.some((prefix) => selector.startsWith(prefix))) {
      return {
        valid: false,
        message: `${label} должен начинаться с "${REQUIRED_SELECTOR_PREFIXES.join('" или "')}".`,
      };
    }
  }

  return { valid: true };
}

function setCopyLoading(isLoading) {
  setButtonLoading(copyButton, isLoading, "Копирование...");
}

function setClearCookiesLoading(isLoading) {
  setButtonLoading(clearCookiesButton, isLoading, "Очищаем...");
}

function setAuthorizeLoading(isLoading) {
  if (authorizeButton) {
    authorizeButton.dataset.loading = isLoading ? "true" : "false";
  }
  setButtonLoading(authorizeButton, isLoading, "Авторизация...");
  if (!isLoading) {
    updateAuthorizeButtonState();
  }
}

function setButtonLoading(button, isLoading, loadingText) {
  if (!button) {
    return;
  }

  if (isLoading) {
    if (!button.dataset.originalText) {
      button.dataset.originalText = button.textContent;
    }
    button.textContent = loadingText;
    button.disabled = true;
  } else {
    if (button.dataset.originalText) {
      button.textContent = button.dataset.originalText;
      delete button.dataset.originalText;
    }
    button.disabled = false;
  }
}
