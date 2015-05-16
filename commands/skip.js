exports.names = ['.skip', '!skip'];
exports.hidden = true;
exports.enabled = true;
exports.matchStart = false;
exports.cd_all = 3;
exports.cd_user = 3;
exports.cd_manager = 3;
exports.handler = function (data) {
    if (data.from.role > 1 || data.from.id == bot.getDJ().id) {
        media = bot.getMedia();

        logger.warning('[SKIP] ' + data.from.username + ' skipped ' + bot.getDJ().username);

        if (data.from.id !== bot.getDJ().id) {
            var userData = {
                type: 'skip',
                details: 'Skipped by ' + data.from.username,
                user_id: bot.getDJ().id,
                mod_user_id: data.from.id
            };
            Karma.create(userData);
        }

        bot.moderateForceSkip();
        modMessage(data, 'Skipped the current song.');
    }
};

