/*
 * GET home page.
 */

exports.index = function (req, res) {
    res.render('index', { title: 'Jira Bot Password Server', fail: false, username: '' })
};
