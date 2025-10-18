const STORAGE_KEY = "cookieCopyPaster.settings";
const MESSAGE_TYPE_COPY = "copyCookies";

const form = document.querySelector("#cookie-form");
const sourceUrlInput = document.querySelector("#source-url");
const destinationUrlInput = document.querySelector("#destination-url");
const keysInput = document.querySelector("#cookie-keys");
const copyAllCheckbox = document.querySelector("#copy-all");
const copyButton = document.querySelector("#copy-button");
const statusSection = document.querySelector("#status");
const statusMessage = document.querySelector("#status-message");
const errorList = document.querySelector("#error-list");

init().catch((error) => {
  console.error("Ошибка инициализации всплывающего окна:", error);
  showStatus(`Не удалось загрузить настройки: ${error.message}`, true);
});

async function init() {
  await restoreFormState();
  handleCopyAllToggle();
  copyAllCheckbox.addEventListener("change", handleCopyAllToggle);
  form.addEventListener("submit", handleSubmit);
}

async function restoreFormState() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const settings = stored?.[STORAGE_KEY];

  if (!settings) {
    return;
  }

  if (typeof settings.sourceUrl === "string") {
    sourceUrlInput.value = settings.sourceUrl;
  }

  if (typeof settings.destinationUrl === "string") {
    destinationUrlInput.value = settings.destinationUrl;
  }

  if (typeof settings.keys === "string") {
    keysInput.value = settings.keys;
  }

  if (typeof settings.copyAll === "boolean") {
    copyAllCheckbox.checked = settings.copyAll;
  }
}

async function handleSubmit(event) {
  event.preventDefault();
  clearStatus();

  const sourceUrl = sourceUrlInput.value.trim();
  const destinationUrl = destinationUrlInput.value.trim();
  const keys = keysInput.value.trim();
  const copyAll = copyAllCheckbox.checked;

  try {
    await saveSettings({ sourceUrl, destinationUrl, keys, copyAll });
  } catch (error) {
    showStatus(`Не удалось сохранить настройки: ${error.message}`, true);
    return;
  }

  setLoading(true);
  try {
    const response = await chrome.runtime.sendMessage({
      type: MESSAGE_TYPE_COPY,
      payload: { sourceUrl, destinationUrl, keys, copyAll },
    });

    if (!response?.success) {
      throw new Error(response?.error ?? "Неизвестная ошибка");
    }

    const { result } = response;
    const summary = [
      `Скопировано: ${result.copied}`,
      `Проверено: ${result.attempted}`,
    ];

    if (result.skipped) {
      summary.push(`Пропущено: ${result.skipped}`);
    }

    showStatus(summary.join(" • "));
    renderErrors(result.errors);
  } catch (error) {
    console.error("Ошибка копирования cookie:", error);
    showStatus(error.message ?? String(error), true);
  } finally {
    setLoading(false);
  }
}

function handleCopyAllToggle() {
  const copyAll = copyAllCheckbox.checked;
  keysInput.disabled = copyAll;
  if (copyAll) {
    keysInput.dataset.placeholder = keysInput.placeholder;
    keysInput.placeholder = "Ключи не требуются";
  } else if (keysInput.dataset.placeholder) {
    keysInput.placeholder = keysInput.dataset.placeholder;
    delete keysInput.dataset.placeholder;
  }
}

async function saveSettings(settings) {
  await chrome.storage.local.set({ [STORAGE_KEY]: settings });
}

function setLoading(isLoading) {
  copyButton.disabled = isLoading;
  copyButton.textContent = isLoading ? "Копирование..." : "Скопировать";
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
