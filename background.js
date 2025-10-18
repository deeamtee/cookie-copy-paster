const MESSAGE_TYPE_COPY = "copyCookies";

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== MESSAGE_TYPE_COPY) {
    return undefined;
  }

  copyCookies(message.payload)
    .then((result) => sendResponse({ success: true, result }))
    .catch((error) => {
      console.error("Не удалось скопировать cookie:", error);
      sendResponse({
        success: false,
        error: error.message ?? String(error),
      });
    });

  return true;
});

async function copyCookies({ sourceUrl, destinationUrl, copyAll, keys }) {
  validateUrl(sourceUrl, "URL источника");
  validateUrl(destinationUrl, "URL назначения");

  const trimmedKeys = (keys ?? "")
    .split(",")
    .map((key) => key.trim())
    .filter(Boolean);
  const keySet = copyAll ? null : new Set(trimmedKeys);

  const source = new URL(sourceUrl);
  const destination = new URL(destinationUrl);

  const cookies = await getCookies({ url: source.origin });
  const filteredCookies = cookies.filter((cookie) =>
    keySet ? keySet.has(cookie.name) : true
  );

  const summary = {
    attempted: filteredCookies.length,
    copied: 0,
    skipped: cookies.length - filteredCookies.length,
    errors: [],
  };

  for (const cookie of filteredCookies) {
    try {
      const setDetails = buildSetDetails(cookie, destination);
      await setCookie(setDetails);
      summary.copied += 1;
    } catch (error) {
      const message = error.message ?? String(error);
      summary.errors.push({ name: cookie.name, message });
      console.warn(`Cookie "${cookie.name}" не удалось сохранить: ${message}`);
    }
  }

  return summary;
}

function validateUrl(urlString, label) {
  if (!urlString) {
    throw new Error(`${label} не задан.`);
  }

  try {
    const url = new URL(urlString);
    if (!url.protocol.startsWith("http")) {
      throw new Error("должен использовать http или https.");
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : "некорректный формат";
    throw new Error(`${label} некорректен: ${reason}`);
  }
}

function buildSetDetails(cookie, destinationUrl) {
  const cookiePath = cookie.path || "/";
  const cookieUrl = `${destinationUrl.origin}${cookiePath}`;

  if (cookie.secure && destinationUrl.protocol !== "https:") {
    throw new Error(
      `Cookie "${cookie.name}" требует HTTPS, но URL назначения использует ${destinationUrl.protocol}`
    );
  }

  const details = {
    url: cookieUrl,
    name: cookie.name,
    value: cookie.value,
    path: cookiePath,
    secure: cookie.secure,
    httpOnly: cookie.httpOnly,
    sameSite: cookie.sameSite,
  };

  if (!cookie.hostOnly) {
    details.domain = destinationUrl.hostname;
  }

  if (!cookie.session && cookie.expirationDate) {
    details.expirationDate = cookie.expirationDate;
  }

  if (cookie.storeId) {
    details.storeId = cookie.storeId;
  }

  if (cookie.priority) {
    details.priority = cookie.priority;
  }

  if (cookie.sameParty) {
    details.sameParty = cookie.sameParty;
  }

  return details;
}

function getCookies(filter) {
  return new Promise((resolve, reject) => {
    chrome.cookies.getAll(filter, (cookies) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(cookies ?? []);
      }
    });
  });
}

function setCookie(details) {
  return new Promise((resolve, reject) => {
    chrome.cookies.set(details, (cookie) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(cookie);
      }
    });
  });
}
