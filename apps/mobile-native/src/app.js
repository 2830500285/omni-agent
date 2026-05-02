const fields = {
  gatewayUrl: document.querySelector("#gatewayUrl"),
  endpointUrl: document.querySelector("#endpointUrl"),
  deviceId: document.querySelector("#deviceId"),
  secret: document.querySelector("#secret"),
  eventPayload: document.querySelector("#eventPayload"),
  output: document.querySelector("#output"),
};

const STORAGE_KEY = "omni-agent-mobile-node-settings";

loadSettings();
registerServiceWorker();

document.querySelector("#registerDevice")?.addEventListener("click", async () => {
  await runAction("register", async () => {
    const settings = readSettings();
    const response = await fetch(`${settings.gatewayUrl}/mobile-node/register`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${settings.secret}`,
      },
      body: JSON.stringify({
        deviceId: settings.deviceId,
        endpointUrl: settings.endpointUrl,
        capabilities: ["push", "event", "pwa"],
        platform: "pwa",
      }),
    });
    return readResponse(response);
  });
});

document.querySelector("#sendEvent")?.addEventListener("click", async () => {
  await runAction("event", async () => {
    const settings = readSettings();
    const response = await fetch(`${settings.gatewayUrl}/mobile-node/${encodeURIComponent(settings.deviceId)}/events`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${settings.secret}`,
      },
      body: fields.eventPayload.value,
    });
    return readResponse(response);
  });
});

for (const input of [fields.gatewayUrl, fields.endpointUrl, fields.deviceId, fields.secret, fields.eventPayload]) {
  input?.addEventListener("input", saveSettings);
}

async function runAction(action, callback) {
  try {
    const result = await callback();
    writeOutput({ action, ok: result.ok, status: result.status, body: result.body });
  } catch (error) {
    writeOutput({ action, ok: false, error: error instanceof Error ? error.message : String(error) });
  }
}

async function readResponse(response) {
  const text = await response.text();
  let body = text;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { ok: response.ok, status: response.status, body };
}

function readSettings() {
  const settings = {
    gatewayUrl: fields.gatewayUrl.value.trim().replace(/\/$/, ""),
    endpointUrl: fields.endpointUrl.value.trim(),
    deviceId: fields.deviceId.value.trim(),
    secret: fields.secret.value,
  };
  if (!settings.gatewayUrl || !settings.endpointUrl || !settings.deviceId || !settings.secret) {
    throw new Error("gatewayUrl, endpointUrl, deviceId, and secret are required.");
  }
  saveSettings();
  return settings;
}

function saveSettings() {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      gatewayUrl: fields.gatewayUrl.value,
      endpointUrl: fields.endpointUrl.value,
      deviceId: fields.deviceId.value,
      secret: fields.secret.value,
      eventPayload: fields.eventPayload.value,
    }),
  );
}

function loadSettings() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) {
    return;
  }
  try {
    const parsed = JSON.parse(saved);
    fields.gatewayUrl.value = typeof parsed.gatewayUrl === "string" ? parsed.gatewayUrl : "";
    fields.endpointUrl.value = typeof parsed.endpointUrl === "string" ? parsed.endpointUrl : "";
    fields.deviceId.value = typeof parsed.deviceId === "string" ? parsed.deviceId : "";
    fields.secret.value = typeof parsed.secret === "string" ? parsed.secret : "";
    fields.eventPayload.value = typeof parsed.eventPayload === "string" ? parsed.eventPayload : fields.eventPayload.value;
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }
}

function writeOutput(value) {
  fields.output.textContent = JSON.stringify(value, null, 2);
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return;
  }
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}
