exports.names = ['.reward'];
exports.hidden = false;
exports.enabled = true;
exports.matchStart = true;
var tacos = ["a blunt :snoop:", "a leather mask :forsenddk:", "a trimmed mithril armor"];
var cookies = ["a chocolate chip cookie", "a sugar cookie", "an oatmeal raisin cookie", "a 'special' brownie", "an animal cracker", "a scooby snack", "a blueberry muffin", "a cupcake", "Strawberry Sunday", "Chocolate Chip Icecream Cone", "Cookie Dough Triple Scoop ", "Mint Chocolate Chip Icecream Cone", "Chocolate Icecream Sunday", "Banana Split with Whipped Cream", "Vanilla Icecream Cone with Sprinkles ", "Bubblegum Flavored Popcicle", "en bröllopstårta", "kladdkaka"];
exports.cd_all = 15;
exports.cd_user = 30;
exports.cd_manager = 10;
exports.handler = function (data) {
    if (data.from.role > 2 || data.from.username == 'PAJLADA' || data.from.username == 'Jeanny') {
        var params = _.rest(data.message.split(' '), 1);
        var username = '';
        if (params.length < 1) {
            var users = bot.getUsers();
            var randomUserIndex = _.random(1, users.length);
            username = '@' + users[(randomUserIndex - 1)].username;
        } else {
            console.log(params.join(' '));
            username_uf = params.join(' ').trim();
            username = username_uf.replace('@', '');
            console.log(username);
            var user = _.findWhere(bot.getUsers(), {username: username});
            if (user) {
                username = '@' + user.username;
            } else {
                bot.sendChat(username + ' is not here :biblethump:');
                return;
            }
        }

        var random_sentence = _.random(0, 10);
        var random_cookie = _.random(0, cookies.length - 1);
        var random_taco = _.random(0, tacos.length - 1);
        if (random_sentence <= 9) {
            bot.sendChat(username + ', ' + data.from.username + ' has rewarded you with ' + cookies[random_cookie] + '. Enjoy! :minik:');
        } else {
            bot.sendChat(username + ', ' + data.from.username + ' has rewarded you with ' + tacos[random_taco] + '. Enjoy! :minik:');
        }
    }
};