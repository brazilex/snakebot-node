exports.names = ['ping', 'uptime'];
exports.hidden = true;
exports.enabled = true;
exports.matchStart = true;
exports.cd_all = 10;
exports.cd_user = 30;
exports.cd_manager = 5;
exports.min_role = PERMISSIONS.NONE;
exports.handler = function (data) {
    chatMessage('/me Pong! (time passed since last bug: ' + moment.utc(uptime.getTime()).fromNow() + ')');
};
