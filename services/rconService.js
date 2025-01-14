const {EmbedBuilder} = require("discord.js");
const {getServerPlayersInfo, kickPlayer, broadcastMessage} = require("../utils/palworld/palworldRCONWrapper");
const {logToGameLogChannel, logToWhitelistLogChannel} = require("../utils/discord/logger");

const config = require("../config.json");

async function startRCONService(client, db) {
    console.log(`Started RCON Service...`)
    setInterval(async () => {
        try {
            if (config.debug) {
                console.log(`[RCON Service]: Updating Status...`)
            }

            let palServers = db.get("PalServers");

            if (!palServers || palServers.length < 1) {
                if (config.debug) {
                    console.log(`[RCON Service]: Not Updating any Status since no servers are added...`)
                }
                return;
            }

            //Looping through each guild aka Server
            for (const palServersKey of palServers) {
                const palServerKeySplit = palServersKey.split("_");
                let guildId = palServerKeySplit[0];

                let guildPalServersKey = `${guildId}_PalServers`;
                let guildPalServers = db.get(guildPalServersKey);

                //Looping through each Server added in a Guild aka Server
                for (const guildPalServer of guildPalServers) {
                    let serverName = guildPalServer.serverName;
                    let host = guildPalServer.host;
                    let port = guildPalServer.port;

                    let statusChannelKey = `${guildId}_${serverName.replaceAll(" ", "_")}_StatusChannelId`;
                    const statusChannelId = db.get(statusChannelKey);

                    if (!statusChannelId) {
                        if (config.debug) {
                            console.log(`[RCON Service]: No Status Channel Set so skipping...`);
                        }
                        return;
                    }

                    let defaultServerData = {
                        online: false,
                        currentPlayers: 0,
                        maximumPlayers: 32,
                        peakPlayers: 0,
                        playerList: []
                    }

                    const serverDataKey = `${guildId}_${serverName.replaceAll(" ", "_")}_ServerData`;
                    let serverData = db.get(serverDataKey);

                    if (!serverData) {
                        serverData = defaultServerData;
                    }

                    db.set(serverDataKey, serverData);

                    const whitelistEnabledKey = `${guildId}_${serverName.replaceAll(" ", "_")}_PalServerWhitelistEnabled`;
                    let whitelistEnabled = db.get(whitelistEnabledKey);

                    if (!whitelistEnabled) {
                        whitelistEnabled = false;
                    }

                    const serverStatusEmbed = new EmbedBuilder()
                        .setTitle("PalWord Server Status")
                        .addFields(
                            {
                                name: "**Server IP:**",
                                value: `\`\`\`${host}:${port}\`\`\``,
                                inline: false
                            },
                            {
                                name: "Status:",
                                value: `${(serverData.online ? "✅Online" : "❌Offline")}`,
                                inline: true
                            },
                            {
                                name: "Online Players:",
                                value: `${serverData.currentPlayers}/${serverData.maximumPlayers}`,
                                inline: true
                            },
                            {
                                name: "Players Peak:",
                                value: `${serverData.peakPlayers}`,
                                inline: true
                            },
                            {
                                name: "Whitelisted:",
                                value: `\`${whitelistEnabled}\``,
                                inline: true
                            },
                            {
                                name: "Player List:",
                                value: (serverData.playerList.length > 0 ? serverData.playerList.map(playerData => `\`${playerData.name}\``).join("\n") : "No Players"),
                                inline: false
                            },
                        );

                    let statusMessageEdited = false;
                    let statusMessageIdKey = `${statusChannelId}_${serverName.replaceAll(" ", "_")}_StatusMessageId`;
                    let statusMessageId = db.get(statusMessageIdKey);

                    if (statusMessageId) {
                        if (config.debug) {
                            console.log(`[RCON Service]: Editing Status Message...`)
                        }

                        try {
                            let statusMessage = await client.channels.cache.get(statusChannelId).messages.fetch(statusMessageId);
                            if (statusMessage) {
                                statusMessage.edit({ embeds: [serverStatusEmbed] });
                                statusMessageEdited = true;
                            }
                        }catch (e) {
                            console.error(e);
                        }
                    }

                    if (!statusMessageEdited) {
                        if (config.debug) {
                            console.log(`[RCON Service]: No Status Message Exist, Creating New Status Message...`)
                        }
                        const statusChannel = await client.channels.cache.get(statusChannelId);
                        const statusMessage = await statusChannel.send({ embeds: [serverStatusEmbed] });
                        db.set(statusMessageIdKey, statusMessage.id);
                    }
                }
            }
        }catch (e) {
            console.error(e);
        }
    }, 10000);

    //Another Faster Interval to track Whitelist and Join/Leave Message
    setInterval(async () => {
        try {
            if (config.debug) {
                console.log(`[RCON Service]: Checking for Whitelist and Join/Leave Messages...`);
            }

            let palServers = db.get("PalServers");

            if (!palServers || palServers.length < 1) {
                if (config.debug) {
                    console.log(`[RCON Service]: Skipping Server Check since no servers are added...`)
                }
                return;
            }

            //Looping through each guild aka Server
            for (const palServersKey of palServers) {
                const palServerKeySplit = palServersKey.split("_");

                let guildId = palServerKeySplit[0];

                let guildPalServersKey = `${guildId}_PalServers`;
                let guildPalServers = db.get(guildPalServersKey);

                //Looping through each Server added in a Guild aka Server
                for (const guildPalServer of guildPalServers) {
                    let serverName = guildPalServer.serverName;
                    let host = guildPalServer.host;
                    let RCONPort = guildPalServer.RCONPort;
                    let password = guildPalServer.password;

                    let defaultServerData = {
                        online: false,
                        currentPlayers: 0,
                        maximumPlayers: 32,
                        peakPlayers: 0,
                        playerList: []
                    }

                    const serverDataKey = `${guildId}_${serverName.replaceAll(" ", "_")}_ServerData`;
                    let serverData = db.get(serverDataKey);

                    if (!serverData) {
                        serverData = defaultServerData;
                    }

                    let previousPlayersList = serverData.playerList;

                    let serverPlayersInfoResponse = await getServerPlayersInfo(host, RCONPort, password);

                    if (serverPlayersInfoResponse.status === "success") {
                        serverData.online = true;
                        serverData.currentPlayers = serverPlayersInfoResponse.data.playerList.length;
                        serverData.peakPlayers = serverData.currentPlayers > serverData.peakPlayers ? serverData.currentPlayers : serverData.peakPlayers;
                        serverData.playerList = serverPlayersInfoResponse.data.playerList.filter(player => player.playeruid !== "00000000");

                        if (serverData.currentPlayers > serverData.maximumPlayers) {
                            serverData.maximumPlayers = serverData.currentPlayers
                        }
                    }else {
                        if (config.debug) {
                            console.log(`[RCON Service]: Skipping Server Check since server is offline...`);
                        }
                        return
                    }

                    db.set(serverDataKey, serverData);

                    if (serverData.currentPlayers < 1 && previousPlayersList.length < 1) {
                        if (config.debug) {
                            console.log(`[RCON Service]: Skipping Server Check since no players are online...`)
                        }
                        return;
                    }

                    let previousPlayerSteamIds = previousPlayersList.map(previousPlayer => previousPlayer.steamid);
                    let previousPlayerUIds = previousPlayersList.map(previousPlayer => previousPlayer.playeruid);

                    let currentPlayerSteamIds = serverData.playerList.map(currentPlayer => currentPlayer.steamid);
                    let currentPlayerUIds = serverData.playerList.map(currentPlayer => currentPlayer.playeruid);

                    let newPlayersList = serverData.playerList.filter(
                        player => !previousPlayerSteamIds.includes(player.steamid) && !previousPlayerUIds.includes(player.playeruid));

                    let leftPlayersList = previousPlayersList.filter(previousPlayer => !currentPlayerSteamIds.includes(previousPlayer.steamid) && !currentPlayerUIds.includes(previousPlayer.playeruid));

                    //Whitelist checks and Join/Leave Messages
                    if (newPlayersList.length > 0 || leftPlayersList.length > 0) {
                        const whitelistEnabledKey = `${guildId}_${serverName.replaceAll(" ", "_")}_PalServerWhitelistEnabled`;
                        const whitelistEnabled = db.get(whitelistEnabledKey);

                        //Checking for Whitelist and showing only Whitelisted Players Join/Leave Messages
                        if (whitelistEnabled) {
                            if (config.debug) {
                                console.log(`[RCON Service]: Whitelist Enabled... Checking for Whitelisted Players...`)
                            }
                            const whitelistedPlayersListKey = `${guildId}_${serverName.replaceAll(" ", "_")}_WhitelistedPlayerList`;
                            let whitelistedPlayers = db.get(whitelistedPlayersListKey);

                            if (!whitelistedPlayers) {
                                whitelistedPlayers = [];
                            }

                            let whitelistedPlayerSteamIds = whitelistedPlayers.map(whitelistedPlayer => whitelistedPlayer.steamid);
                            let whitelistedPlayerUIds = whitelistedPlayers.map(whitelistedPlayer => whitelistedPlayer.playeruid);

                            //Checking for Players who are not whitelisted and are online
                            let nonWhitelistedPlayers = newPlayersList.filter(
                                newPlayer => !whitelistedPlayerSteamIds.includes(newPlayer.steamid) && !whitelistedPlayerUIds.includes(newPlayer.playeruid));

                            newPlayersList = newPlayersList.filter(newPlayer => whitelistedPlayerSteamIds.includes(newPlayer.steamid) && whitelistedPlayerUIds.includes(newPlayer.playeruid));

                            leftPlayersList = leftPlayersList.filter(leftPlayer => whitelistedPlayerSteamIds.includes(leftPlayer.steamid) && whitelistedPlayerUIds.includes(leftPlayer.playeruid));

                            if (nonWhitelistedPlayers.length > 0) {
                                //Non Whitelisted Players are online
                                for (const nonWhitelistedPlayer of nonWhitelistedPlayers) {
                                    kickPlayer(host, RCONPort, password, nonWhitelistedPlayer.steamid);

                                    let nonWhitelistedPlayerName = nonWhitelistedPlayer.name;
                                    let nonWhitelistedPlayerSteamId = nonWhitelistedPlayer.steamid;
                                    let nonWhitelistedPlayerUId = nonWhitelistedPlayer.playeruid;

                                    logToWhitelistLogChannel(client, guildId, serverName, "Non Whitelisted Player Kicked",
                                        `Player \`${nonWhitelistedPlayerName}\` with Steam ID \`${nonWhitelistedPlayerSteamId}\` 
                                            and UID \`${nonWhitelistedPlayerUId}\` has been Kicked from the server.`);
                                }
                            }
                        }else {
                            if (config.debug) {
                                console.log(`[RCON Service]: Whitelist Not Enabled... Skipping Whitelist Checks...`)
                            }
                        }

                        for (const newPlayer of newPlayersList) {
                            logToGameLogChannel(client, guildId, serverName, "Player Joined", `${newPlayer.name} has Joined the Server!`);
                            broadcastMessage(host, RCONPort, password, `${newPlayer.name} has Joined the Server!`);
                        }

                        for (const leftPlayer of leftPlayersList) {
                            logToGameLogChannel(client, guildId, serverName, "Player Left", `${leftPlayer.name} has Left the Server!`);
                            broadcastMessage(host, RCONPort, password, `${leftPlayer.name} has Left the Server!`);
                        }
                    }else {
                        if (config.debug) {
                            console.log(`[RCON Service]: No New Player Joined/Left so skipping...`)
                        }
                    }
                }
            }
        }catch (e) {
            console.error(e);
        }
    }, 2000);
}
module.exports = {startRCONService}