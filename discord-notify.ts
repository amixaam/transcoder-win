// discord-notifier.ts
import { Client, GatewayIntentBits } from "discord.js";

const botToken = process.env.DISCORD_BOT_TOKEN;
const userId = process.env.DISCORD_USER_ID;

if (!botToken || !userId) {
  console.error("Missing DISCORD_BOT_TOKEN or DISCORD_USER_ID in .env file.");
  process.exit(1);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.DirectMessages], // Specify required intents
});

client.once("ready", async () => {
  console.log("Discord bot is ready!");
});

async function sendCompletionNotification(message: string) {
  try {
    const user = await client.users.fetch(userId); // Fetch the user
    if (user) {
      await user.send(message); // Send the DM
      console.log(`Sent DM to ${user.tag}`);
    } else {
      console.error(`Could not find user with ID ${userId}`);
    }
  } catch (error) {
    console.error("Error sending Discord DM:", error);
  }
}

client.login(botToken);

export { sendCompletionNotification };
