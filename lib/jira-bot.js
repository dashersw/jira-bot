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
    this.defaults.username = config.jira.username;
    this.defaults.password = config.jira.password;
    this.defaults.headers = {};

    this.initXmpp(config.xmpp);
    this.initHandlers(config.handlersDirectory);
    this.initChatHandler();
};

jiraBotOpts.defaults = {};


var JiraBot = rest.service(jiraBotOpts.constructorFn, jiraBotOpts.defaults);


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

        commands.forEach(function(command) {
            var found = that.handlers.some(function (handler) {
                var matches = handler.regexp.exec(command);

                if (matches) {
                    handler.callback.call(that, from, command, matches);
                    return true;
                }
            });

            if (!found && that.defaultHandler)
                that.defaultHandler.call(that, from, command);
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
    this.postJson('auth/latest/session', { username:user, password:pass }).on('complete', function (data) {
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
    return this.postJson('api/latest/issue', {
        fields:{
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
            }
        }
    });
};


JiraBot.prototype.commentOnIssue = function(data) {
    return this.postJson('api/latest/issue/' + data.issue + '/comment', {
        body: data.body
    });
};


JiraBot.prototype.getIssue = function (key) {
    return this.get('api/latest/issue/' + key);
};


JiraBot.prototype.addHandler = function (name, regexp, callback) {
    if (typeof name == 'function') {
        this.defaultHandler = name;
        return;
    }

    this.handlers.push({name:name, regexp:regexp, callback:callback });
};


module.exports = JiraBot;
