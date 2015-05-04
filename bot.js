var PlugAPI = require('plugapi');
var fs = require('fs');
path = require('path')
var config = require(path.resolve(__dirname, 'config.json'));

runBot(false, config.auth);

var roomHasActiveMods = false;
var skipTimer;
var motd_i = 0

function runBot(error, auth) {
    if (error) {
        logger.error("[INIT] An error occurred: " + err);
        return;
    }

    initializeModules(auth);

    sequelize.query('SELECT `id`, `type`, `value` FROM `settings`',
            { type: Sequelize.QueryTypes.SELECT })
        .then(function(rows) {
            _.each(rows, function(row) {
                var value = row['value'];

                switch (row['type']) {
                    case 'int':
                        value = parseInt(value);
                        break;

                    case 'list':
                        value = value.split(',');
                        break;
                }

                settings[row['id']] = value;
            });
        })
        .then(function() {
            bot.connect(config.roomName);
        });


    bot.on('roomJoin', function (data) {

        logger.success('[INIT] Joined room:' + data);

        if (config.responses.botConnect !== "") {
            bot.sendChat(config.responses.botConnect);
        }

        bot.getUsers().forEach(function (user) {
            updateDbUser(user);
        });
    });

    bot.on('chatDelete', function(data) {
        var username = 'PAJBOT';
        if (data.mi === 6281653) {
            logger.info('[CHATD]', 'PAJBOT deleted ' + data.c);
        } else {
            User.find(data.mi).on('success', function (db_user) {
                logger.info('[CHATD]', db_user.username + ' deleted ' + data.c);
            });
        }
    });

    bot.on('modBan', function(data) {
        var duration;
        switch (data.d) {
            case 'h': duration = '1 hour'; break;
            case 'd': duration = '24 hour'; break;
            case 'p': duration = 'permanently'; break;
            default: duration = '?? ('+data.d+')'; break;
        }
        logger.info('[BAN]', data.m + ' ' + duration + ' banned ' + data.t);
    });

    bot.on('chat', function (data) {
        if (config.verboseLogging) {
            logger.info('[CHAT]', JSON.stringify(data, null, 2));
        } else if (data.from !== undefined && data.from !== null) {
            logger.info('[CHAT]', '[' + data.id + '] ' + data.from.username + ': ' + data.message);
        }

        if (data.from !== undefined && data.from !== null) {
            data.message = data.message.trim();
            //if (data.msg == '.') {
            //    bot.moderateDeleteChat(data.id);
            //}
            //else {
            //    handleCommand(data);
            //}
            if (config.lockdown && data.from.role === 0) {
                bot.moderateDeleteChat(data.id);
            }
            handleCommand(data);
            User.update({last_active: new Date(), last_seen: new Date()}, {where: {id: data.from.id}});
        }
    });

    bot.on('userJoin', function (data) {
        if (config.verboseLogging) {
            logger.info('[JOIN]', JSON.stringify(data, null, 2));
        }

        var newUser = false;
        var message = "";

        if (data.username !== bot.getUser().username) {
            User.find(data.id).on('success', function (dbUser) {

                if (data.username == config.superAdmin && config.responses.welcome.superAdmin != null) {
                    message = config.responses.welcome.superAdmin.replace('{username}', data.username);
                    logger.info('[JOIN]', data.username + ' last seen ' + timeSince(dbUser.last_seen));
                }
                else if (dbUser == null) {
                    message = config.responses.welcome.newUser.replace('{username}', data.username);
                    newUser = true;
                    logger.info('[JOIN]', data.username + ' is a first-time visitor to the room!');
                }
                else {
                    message = config.responses.welcome.oldUser.replace('{username}', data.username);
                    logger.info('[JOIN]', data.username + ' last seen ' + timeSince(dbUser.last_seen));
                }

                // Greet with the theme if it's not the default
                RoomEvent.find({where: {starts_at: {lte: new Date()}, ends_at: {gte: new Date()}}}).on('success', function (row) {
                    if (row !== null) {
                        if (row.type == 'event') {
                            message += ' ** SPECIAL EVENT ** ' + row.title + ' - .event for details!';
                        }
                        else if (row.type == 'theme') {
                            message += ' Theme: ' + row.title + ' - .theme for details!';
                        }
                    }
                });

                if (!roomHasActiveMods) {
                    message += ' Type .help if you need it!';
                }

                if (message && (config.welcomeUsers == "NEW" || config.welcomeUsers == "ALL")) {
                    if (newUser) {
                        setTimeout(function () {
                            bot.sendChat(message)
                        }, 5000);
                    }
                    else if (config.welcomeUsers == "ALL" && secondsSince(dbUser.last_active) >= 900 && secondsSince(dbUser.last_seen) >= 900) {
                        setTimeout(function () {
                            bot.sendChat(message)
                        }, 5000);
                    }
                }
            });
            updateDbUser(data);
        }
    })

    bot.on('userLeave', function (data) {
        logger.info('[LEAVE]', 'User left: ' + data.username);
        User.update({last_seen: new Date()}, {where: {id: data.id}});
    });

    bot.on('userUpdate', function (data) {
        if (config.verboseLogging) {
            logger.info('[EVENT] USER_UPDATE', data);
        }
    });

    bot.on('grab', function (data) {
        var user = _.findWhere(bot.getUsers(), {id: data});
        if (user) {
            logger.info('[GRAB]', user.username + ' grabbed this song');
        }
    });

    bot.on('vote', function (data) {
        var user = _.findWhere(bot.getUsers(), {id: data.i});
        if (user && data.v === -1) {
            logger.info('[MEH]', user.username);
        } else if (user && data.v === 1) {
            logger.info('[WOOT]', user.username);
        } else if (user) {
            logger.info('[VOTE]', user.username + ': ' + data.v + ' ???? XXX');
        }
    });

    bot.on('advance', function (data) {
        if (config.verboseLogging) {
            logger.success('[EVENT] ADVANCE ', JSON.stringify(data, null, 2));
        }

        motd_advance();

        saveWaitList(true);

        // Writes current room state to outfile so it can be used for the web
        if (config.roomStateFile) {

            var JSONstats = {}

            JSONstats.media = bot.getMedia();
            JSONstats.dj = bot.getDJ();
            JSONstats.waitlist = bot.getWaitList();
            JSONstats.users = bot.getUsers();
            JSONstats.staff = bot.getStaff();

            fs.writeFile(
                config.roomStateFile,
                JSON.stringify(JSONstats, null, 2),
                function (err) {
                    if (err) {
                        logger.error(err);
                        return console.log(err);
                    }
                }
            );
        }

        // Write previous play data to DB
        if (data.lastPlay.media !== null && data.lastPlay.dj !== null) {
            Play.create({
                user_id: data.lastPlay.dj.id,
                song_id: data.lastPlay.media.id,
                positive: data.lastPlay.score.positive,
                negative: data.lastPlay.score.negative,
                grabs: data.lastPlay.score.grabs,
                listeners: data.lastPlay.score.listeners,
                skipped: data.lastPlay.score.skipped
            });
        }

        if (data.media != null) {

            if (data.currentDJ != null) {
                logger.success('********************************************************************');
                logger.success('[UPTIME]', 'Bot online ' + timeSince(startupTimestamp, true));
                logger.success('[SONG]', data.currentDJ.username + ' played: ' + data.media.author + ' - ' + data.media.title);
            }

            // Perform automatic song metadata correction
            if (config.autoSuggestCorrections) {
                correctMetadata();
            }

            // Auto skip for "stuck" songs
            clearTimeout(skipTimer);
            skipTimer = setTimeout(function () {
                if (bot.getMedia().cid == data.media.cid) {
                    if (config.autoSkip) {
                        bot.moderateForceSkip();
                        logger.info('[AUTOSKIP]', 'Song was autoskipped.');
                    }
                }
            }, (data.media.duration + 3) * 1000);

            // Write current song data to DB
            var songData = {
                id: data.media.id,
                author: data.media.author,
                title: data.media.title,
                format: data.media.format,
                cid: data.media.cid,
                duration: data.media.duration,
                image: data.media.image
            };
            Song.findOrCreate({where: {id: data.media.id, cid: data.media.cid}, defaults: songData}).spread(function (song) {
                song.updateAttributes(songData);
            });

            if (config.wootSongs == 'ALL') {
                bot.woot();
            }

            if (config.songResponses) {
                SongResponse.find({
                    where: Sequelize.or(
                               Sequelize.and({media_type: 'author', trigger: {like: data.media.author}, is_active: true}),
                               Sequelize.and({media_type: 'title', trigger: {like: data.media.title}, is_active: true})
                               )
                }).on('success', function (row) {
                    if (row !== null) {
                        if (row.response != '') {
                            bot.sendChat(row.response);
                        }
                        if (row.rate === 1) {
                            bot.woot();
                        }
                        else if (row.rate === -1) {
                            bot.meh();
                        }
                    }
                });
            }

            var maxIdleTime = config.activeDJTimeoutMins * 60;
            var idleDJs = [];
            roomHasActiveMods = false;

            if (config.removeInactiveDJs) {
            Promise.map(bot.getWaitList(), function (dj) {
                return User.find({
                    where: {id: dj.id},
                    include: {
                        model: Karma,
                        required: false,
                        where: {
                            type: 'warn',
                            created_at: {gte: moment.utc().subtract(config.activeDJTimeoutMins, 'minutes').toDate()}
                        },
                        limit: 1,
                        order: [['created_at', 'DESC']]
                    }
                }).on('success', function (dbUser) {
                    var position = bot.getWaitListPosition(dj.id);
                    if (dbUser !== null) {
                        if (secondsSince(dbUser.last_active) >= maxIdleTime && moment.utc().isAfter(moment.utc(startupTimestamp).add(config.activeDJTimeoutMins, 'minutes'))) {
                            logger.warning('[IDLE]', position + '. ' + dbUser.username + ' last active ' + timeSince(dbUser.last_active));
                            if (dbUser.Karmas.length > 0) {
                                logger.warning('[IDLE]', dbUser.username + ' was last warned ' + timeSince(dbUser.Karmas[0].created_at));
                                bot.moderateRemoveDJ(dj.id);
                                bot.sendChat('@' + dbUser.username + ' ' + config.responses.activeDJRemoveMessage);
                                var userData = {
                                    type: 'remove',
                                    details: 'Removed from position ' + position + ': AFK for ' + timeSince(dbUser.last_active, true),
                                    user_id: dj.id,
                                    mod_user_id: bot.getUser().id
                                };
                                Karma.create(userData);
                                User.update({waitlist_position: -1}, {where: {id: dj.id}});
                            }
                            else if (position > 1) {
                                var userData = {
                                    type: 'warn',
                                    details: 'Warned in position ' + position + ': AFK for ' + timeSince(dbUser.last_active, true),
                                    user_id: dj.id,
                                    mod_user_id: bot.getUser().id
                                };
                                Karma.create(userData);
                                idleDJs.push(dbUser.username);
                            }
                        }
                        else {
                            if (dj.role > 1) {
                                roomHasActiveMods = true;
                            }
                            logger.info('[ACTIVE]', position + '. ' + dbUser.username + ' last active ' + timeSince(dbUser.last_active));
                        }
                    }
                });
            }).then(function () {
                if (idleDJs.length > 0) {
                    var idleDJsList = idleDJs.join(' @');
                    bot.sendChat('@' + idleDJsList + ' ' + config.responses.activeDJReminder);
                }
            });
            }

            // Skip if the song has been blacklisted
            /*
             Song.find({where: {id: data.media.id, cid: data.media.cid, is_banned: true}}).on('success', function (row) {
             // need to only do this if results!
             logger.warning('[SKIP] Skipped ' + data.currentDJ.username + ' spinning a blacklisted song: ' + data.media.author + ' - ' + data.media.title + ' (id: ' + data.media.id + ')');
             bot.sendChat('Sorry @' + data.currentDJ.username + ', this song has been blacklisted (NSFW video or Out of Range) in our song database.');
             bot.moderateForceSkip();
             var userData = {
             type: 'skip',
             details: 'Skipped for playing a blacklisted song: ' + data.media.author + ' - ' + data.media.title + ' (id: ' + data.media.id + ')',
             user_id: data.currentDJ.id,
             mod_user_id: bot.getUser().id
             };
             Karma.create(userData);
             });
             */

            // Only police this if there aren't any mods around
            if (config.timeGuard && config.maxSongLengthSecs > 0 && data.media.duration > config.maxSongLengthSecs) {
                logger.warning('[SKIP] Skipped ' + data.currentDJ.username + ' spinning a song of ' + data.media.duration + ' seconds');
                bot.sendChat('Sorry @' + data.currentDJ.username + ', this song is over our maximum room length of ' + (config.maxSongLengthSecs / 60) + ' minutes.');
                bot.moderateForceSkip();
                var userData = {
                    type: 'skip',
                    details: 'Skipped for playing a song of ' + data.media.duration + ' (room configured for max of ' + config.maxSongLengthSecs + ')',
                    user_id: data.currentDJ.id,
                    mod_user_id: bot.getUser().id
                };
                Karma.create(userData);
            }

        }

    });

    bot.on('djListUpdate', function (data) {
        if (config.verboseLogging) {
            logger.success('[EVENT] DJ_LIST_UPDATE', JSON.stringify(data, null, 2));
        }
        saveWaitList(false);
    });

    bot.on('close', reconnect);
    bot.on('error', reconnect);


    if (config.telnet.listenOnIp && config.telnet.listenOnPort) {
        bot.tcpListen(config.telnet.listenOnPort, config.telnet.listenOnIp);
    }

    bot.on('tcpConnect', function (socket) {
        logger.info('[TCP] Connected!');
    });

    bot.on('tcpMessage', function (socket, msg) {
        if (typeof msg !== "undefined" && msg.length > 2) {
            logger.info('[TCP] ' + msg);
            // Convert into same format as incoming chat messages through the UI
            var data = {
                message: msg,
                from: bot.getUser()
            };

            if (data.message.indexOf('.') === 0) {
                handleCommand(data);
            }
            else {
                bot.sendChat(msg);
            }
        }
    });


    function saveWaitList(wholeRoom) {

        if (wholeRoom) {
            var userList = bot.getUsers();
        }
        else {
            var userList = bot.getWaitList();
        }
        userList.forEach(function (user) {
            var position = bot.getWaitListPosition(user.id);
            // user last seen in 900 seconds
            if (position > 0) {
                User.update({waitlist_position: position, last_seen: moment.utc().toDate()}, {where: {id: user.id}});
            }
            else {
                User.update({waitlist_position: -1}, {where: {id: user.id}});
            }
            if (config.verboseLogging) {
                logger.info('Wait List Update', user.username + ' => ' + position);
            }

        });
        User.update({waitlist_position: -1}, {
            where: {
                last_seen: {lte: moment.utc().subtract(15, 'minutes').toDate()},
                last_active: {lte: moment.utc().subtract(15, 'minutes').toDate()}
            }
        });

    }

    function updateDbUser(user) {

        var userData = {
            id: user.id,
            username: user.username,
            slug: user.slug,
            language: user.language,
            avatar_id: user.avatarID,
            badge: user.badge,
            blurb: user.blurb,
            global_role: user.gRole,
            role: user.role,
            level: user.level,
            joined: user.joined,
            last_seen: new Date()
        };

        User.findOrCreate({where: {id: user.id}, defaults: userData}).spread(function (dbUser) {

            // Reset the user's AFK timer if they've been gone for long enough (so we don't reset on disconnects)
            if (secondsSince(dbUser.last_seen) >= 900) {
                userData.last_active = new Date();
                userData.waitlist_position = bot.getWaitListPosition(user.id)
            }
            dbUser.updateAttributes(userData);
        }).catch(function (err) {
            logger.error('Error occurred', err);
        });

        //convertAPIUserID(user, function () {});

    }

    function convertAPIUserID(user, callback) {
        //db.get('SELECT userid FROM USERS WHERE username = ?', [user.username], function (error, row) {
        //    if (row != null && row.userid.length > 10) {
        //        logger.warning('Converting userid for ' + user.username + ': ' + row.userid + ' => ' + user.id);
        //        //db.run('UPDATE PLAYS SET userid = ? WHERE userid = ?', [user.id, row.userid]);
        //        //db.run('UPDATE USERS SET userid = ? WHERE userid = ?', [user.id, row.userid], function () {
        //        //    callback(true);
        //        //});
        //    }
        //    else {
        //        callback(true);
        //    }
        //});
    }

    function reconnect() {
        bot.connect(config.roomName);
    }

    function initializeModules(auth) {
        // load context
        require(path.resolve(__dirname, 'context.js'))({auth: auth, config: config});

        // Allow bot to perform multi-line chat
        bot.multiLine = true;
        bot.multiLineLimit = 5;

        loadCommands();
    }

    function handleCommand(data) {

        // unescape message
        data.message = S(data.message).unescapeHTML().s;

        data.message = data.message.replace(/&#39;/g, '\'');
        data.message = data.message.replace(/&#34;/g, '\"');
        data.message = data.message.replace(/&amp;/g, '\&');
        data.message = data.message.replace(/&lt;/gi, '\<');
        data.message = data.message.replace(/&gt;/gi, '\>');

        var command = commands.filter(function (cmd) {
            var found = false;
            for (i = 0; i < cmd.names.length; i++) {
                if (!found) {
                    found = (cmd.names[i] == data.message.toLowerCase() || (cmd.matchStart && data.message.toLowerCase().indexOf(cmd.names[i]) == 0));
                }
            }
            return found;
        })[0];

        if (command && command.enabled) {
            var cur_time = Date.now() / 1000;
            var time_diff = cur_time - command.last_run;
            var can_run_command = false;
            if (data.from.role > 2 || data.from.username == 'PAJLADA') {
                if (time_diff > command.cd_manager) {
                    can_run_command = true;
                } else {
                    console.error(data.from.username + ' cannot run the command, cuz of antispam (manager+) ' + time_diff);
                }
            } else {
                var time_diff_user = cur_time;
                if (data.from.username in command.last_run_users) {
                    time_diff_user -= command.last_run_users[data.from.username];
                }
                if (time_diff > command.cd_all && time_diff_user > command.cd_user) {
                    can_run_command = true;
                } else {
                    console.error(data.from.username + ' cannot run the command, cuz of antispam ' + time_diff + ', ' + time_diff_user);
                }
            }

            if (config.verboseLogging) {
                logger.info('[COMMAND]', JSON.stringify(data, null, 2));
            }

            // Don't allow @mention to the bot - prevent loopback
            data.message = data.message.replace('@' + bot.getUser().username, '');

            if (config.removeCommands && command.remove_command !== false) {
                bot.moderateDeleteChat(data.id);
            }

            if (can_run_command) {
                command.last_run = cur_time;
                command.last_run_users[data.from.username] = cur_time;
                command.handler(data);
            }
        } else if (config.cleverbot && data.message.indexOf('@' + bot.getUser().username) > -1) {
            mentionResponse(data);
        } else if (config.eventResponses && data.message.indexOf('.') === 0) {
            chatResponse(data);
        }
    }

    function correctMetadata() {
        media = bot.getMedia();

        // first, see if the song exists in the db
        //db.get('SELECT id FROM SONGS WHERE id = ?', [media.id], function (error, row) {
        //    if (row == null) {
        //        // if the song isn't in the db yet, check it for suspicious strings
        //        artistTitlePair = S((media.author + ' ' + media.title).toLowerCase());
        //        if (artistTitlePair.contains('official music video')
        //            || artistTitlePair.contains('lyrics')
        //            || artistTitlePair.contains('|')
        //            || artistTitlePair.contains('official video')
        //            || artistTitlePair.contains('[')
        //            || artistTitlePair.contains('"')
        //            || artistTitlePair.contains('*')
        //            || artistTitlePair.contains('(HD)')
        //            || artistTitlePair.contains('(HQ)')
        //            || artistTitlePair.contains('1080p')
        //            || artistTitlePair.contains('720p')
        //            || artistTitlePair.contains(' - ')
        //            || artistTitlePair.contains('full version')
        //            || artistTitlePair.contains('album version')) {
        //            suggestNewSongMetadata(media.author + ' ' + media.title);
        //        }
        //    }
        //});
    }

    function suggestNewSongMetadata(valueToCorrect) {
        media = bot.getMedia();
        // @FIXME - don't use the room. construct.
        //request('http://developer.echonest.com/api/v4/song/search?api_key=' + config.apiKeys.echoNest + '&format=json&results=1&combined=' + S(valueToCorrect).escapeHTML().stripPunctuation().s, function (error, response, body) {
        //    logger.info('echonest body', body);
        //    if (error) {
        //        bot.sendChat('An error occurred while connecting to EchoNest.');
        //        bot.error('EchoNest error', error);
        //    } else {
        //        response = JSON.parse(body).response;
        //
        //        room.media.suggested = {
        //            author: response.songs[0].artist_name,
        //            title: response.songs[0].title
        //        };
        //
        //        // log
        //        logger.info('[EchoNest] Original: "' + media.author + '" - "' + media.title + '". Suggestion: "' + room.media.suggested.author + '" - "' + room.media.suggested.title);
        //
        //        if (media.author != room.media.suggested.author || media.title != room.media.suggested.title) {
        //            bot.sendChat('Hey, the metadata for this song looks wrong! Suggested Artist: "' + room.media.suggested.author + '". Title: "' + room.media.suggested.title + '". Type ".fixsong yes" to use the suggested tags.');
        //        }
        //    }
        //});
    }

    function mentionResponse(data) {
        // How much ADHD does the bot have?
        if (!config.chatRandomnessPercentage) {
            chatRandomnessPercentage = 5;
        } else {
            chatRandomnessPercentage = config.chatRandomnessPercentage;
        }

        if (_.random(1, 100) > chatRandomnessPercentage) {
            cleverMessage = data.message.replace('@' + bot.getUser().username, '').trim();
            cleverbot.write(cleverMessage, function (response) {
                if (config.verboseLogging) {
                    logger.info('[CLEVERBOT]', JSON.stringify(response, null, 2));
                }
                bot.sendChat('@' + data.from.username + ' ' + response.message);

            });
        }
        else if (config.eventResponses) {
            EventResponse.find({
                where: Sequelize.and({event_type: 'mention', is_active: true}),
                order: 'RAND()'
            })
                .on('success', function (row) {
                    if (row === null) {
                        return;
                    }
                    else {
                        bot.sendChat(row.response.replace('{sender}', data.from.username));
                    }

                });
        }
    }

    function chatResponse(data) {
        EventResponse.find({
            where: Sequelize.and({event_type: 'chat', trigger: data.message.substring(1), is_active: true}),
            order: 'RAND()'
        })
            .on('success', function (row) {
                if (row === null) {
                    return;
                }
                else {
                    bot.sendChat(row.response.replace('{sender}', data.from.username));
                }

            });
    }

    function motd_advance()
    {
        if ('motd' in settings && 'motd_interval' in settings && settings['motd'].length > 0) {
            motd_i ++;

            if (motd_i == settings['motd_interval']) {
                motd_i = 0;
                bot.sendChat('/me ' + settings['motd']);
            }
        }
    }
}
