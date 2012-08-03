// Copyright 2011 Armagan Amcalar. All Rights Reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS-IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.


var rest = require('restler'),
    sys = require('util'),
    fs = require('fs'),
    path = require('path'),
    crypto = require('crypto'),
    jiraBotOpts = {};


jiraBotOpts.constructorFn = function (config) {
    if (!config) {
        try {
            var configFile = fs.readFileSync('./config.json');
            config = JSON.parse(configFile);
        }
        catch (e) {
            console.error("No configuration provided.");
            process.exit(1);
        }
    }

    config.handlersDirectory = config.handlersDirectory || 'handlers';

    this.baseURL = config.jira.host + '/rest/';
    this.defaults.headers = {};

    this.masterPassword = config.masterPassword;

    if (!this.masterPassword) {
        console.error("No master password provided.");
        process.exit(1);
    }

    this.initXmpp(config.xmpp);
    this.initHandlers(config.handlersDirectory);
    this.initChatHandler();

    this.passwordServerConfig = config.passwordServer;
    this.passwordsFileName = 'passwords';
    this.readPasswordsFromFile();
    this.initPasswordServer();
};

jiraBotOpts.defaults = {};


var JiraBot = rest.service(jiraBotOpts.constructorFn, jiraBotOpts.defaults);


JiraBot.prototype.encrypt = function (message) {
    var cipher = crypto.createCipher('aes-256-cbc', this.masterPassword);
    cipher.update(message, 'utf8', 'hex');
    return cipher.final('hex');
};


JiraBot.prototype.decrypt = function(message) {
    var decipher = crypto.createDecipher('aes-256-cbc', this.masterPassword);
    decipher.update(message, 'hex', 'utf8');
    return decipher.final('utf8');
};


JiraBot.prototype.readPasswordsFromFile = function() {
    // make sure there's a passwords file. If not found, create it.
    var passwordsFile = fs.openSync(this.passwordsFileName, 'a+');
    fs.closeSync(passwordsFile);

    // read passwords. if none found, use an empty object for the oncoming json parse operation.
    var passwordFileContents = fs.readFileSync(this.passwordsFileName, 'utf8') || '{}';

    this.passwords = JSON.parse(passwordFileContents);
};


JiraBot.prototype.initPasswordServer = function() {
    var that = this,
        app = require('../passServer/app.js');

    app.listen(this.passwordServerConfig.port, this.passwordServerConfig.host);
    console.log("Password server listening on port %d in %s mode", this.passwordServerConfig.port, app.settings.env);

    app.post('/', function(req, res) {
        var username = req.body.username;
        var password = req.body.password;

        that.login(req.body.username, req.body.password, function(error) {
            if (!error) {
                that.passwords[username] = that.encrypt(password);
                fs.writeFileSync('./' + that.passwordsFileName, JSON.stringify(that.passwords));

                res.render('success', { title: 'Jira Bot Password Registration Success', username: username });
            }
            else {
                res.render('index', { title : 'Jira Bot Password Registration Fail', fail : true, username: username })
            }
        }, false);
    });
};


JiraBot.prototype.initHandlers = function (dir) {
    dir = path.resolve(dir);
    this.handlers = [];

    var that = this;
    var files = fs.readdirSync(dir);

    files.forEach(function (file) {
        file = path.resolve(dir, file);

        var handler = require(file);
        var handlerName = path.basename(file, '.js');

        if (handlerName == 'default')
            that.defaultHandler = handler.callback;
        else
            that.handlers.push(handler);
    });
};


JiraBot.prototype.initChatHandler = function () {
    var that = this;

    this.xmpp.on('chat', function (from, message) {
        var commands = message.split('\n');
        var username = from.substr(0, from.indexOf('@'));
        var password = that.passwords[username];

        if (!password) {
            that.xmpp.send(from, 'Please visit http://' + that.passwordServerConfig.host +
                                 ':' + that.passwordServerConfig.port + ' for registering your password');
            return;
        }

        password = that.decrypt(password);

        commands.forEach(function(command) {
            var found = that.handlers.some(function (handler) {
                var matches = handler.regexp.exec(command);

                if (matches) {
                    that.defaults.username = username;
                    that.defaults.password = password;

                    handler.callback.call(that, from, command, matches);

                    that.defaults.username = null;
                    that.defaults.password = null;
                    return true;
                }
            });

            if (!found && that.defaultHandler) {
                that.defaults.username = username;
                that.defaults.password = password;

                that.defaultHandler.call(that, from, command);
                that.defaults.username = null;
                that.defaults.password = null;
            }
        });
    });
};


JiraBot.prototype.initXmpp = function (xmppOptions) {
    var that = this;
    this.xmpp = require('simple-xmpp');

    this.xmpp.on('online', function () {
        sys.puts("XMPP is online.");
    });

    this.xmpp.on('stanza', function (stanza) {
        if (stanza.name == 'presence' && stanza.attrs.type == 'subscribe') {
            var ack = {
                to:stanza.attrs.from,
                type:'subscribed'
            };

            var requestFriendship = {
                to:stanza.attrs.from,
                type:'subscribe'
            };

            that.xmpp.conn.send(new that.xmpp.Element('presence', ack));
            that.xmpp.conn.send(new that.xmpp.Element('presence', requestFriendship));
        }
    });

    this.xmpp.connect(xmppOptions);
};


JiraBot.prototype.login = function (user, pass, callback, disableSessions) {
    var that = this;
    this.json('POST', 'auth/latest/session', { username:user, password:pass }).on('complete', function (data) {
        if (!data.session) {
            return callback(new Error('Login failed'), data);
        }

        if (!disableSessions)
            that.defaults.headers['Cookie'] = data.session.name + '=' + data.session.value;

        callback(null, data);
    });
};


JiraBot.prototype.logout = function () {
    return this.del('auth/latest/session');
};


JiraBot.prototype.createIssue = function (issue) {
    var fields = {
            project:{
                key:issue.project
            },
            assignee:{
                name:issue.assignee
            },
            reporter:{
                name:issue.reporter
            },
            summary:issue.summary,
            issuetype:{
                name:issue.type
            },
            components:issue.components
        };

    if (issue.parent)
        fields.parent = {
            id: issue.parent
        }

        console.log(fields);
    return this.json('POST', 'api/latest/issue', {
        fields: fields
    });
};


JiraBot.prototype.commentOnIssue = function(data) {
    return this.json('POST', 'api/latest/issue/' + data.issue + '/comment', {
        body: data.body
    });
};


JiraBot.prototype.assignIssue = function(data) {
    return this.json('PUT', 'api/latest/issue/' + data.issue + '/assignee', {
        name: data.assignee
    });
};


JiraBot.prototype.getIssue = function (key) {
    return this.get('api/latest/issue/' + key);
};


JiraBot.prototype.getComponentsByProjectKey = function (key) {
    return this.get('api/latest/project/' + key + '/components');
};


JiraBot.prototype.addHandler = function (name, regexp, callback) {
    if (typeof name == 'function') {
        this.defaultHandler = name;
        return;
    }

    this.handlers.push({name:name, regexp:regexp, callback:callback });
};


module.exports = JiraBot;
