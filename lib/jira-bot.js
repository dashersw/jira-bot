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

    this.baseURL = config.jira.host + '/rest/';
    this.defaults.username = config.jira.username;
    this.defaults.password = config.jira.password;
    this.defaults.headers = {};

    this.initXmpp(config.xmpp);
    this.initChatHandler();
};

jiraBotOpts.defaults = {};


var JiraBot = rest.service(jiraBotOpts.constructorFn, jiraBotOpts.defaults);


JiraBot.prototype.initChatHandler = function() {
    var that = this;

    this.xmpp.on('chat', function(from, message) {
        var found = that.handlers.some(function(handler) {
            var matches = handler.regexp.exec(message);

            if (matches) {
                handler.callback.call(that, from, message, matches);
                return true;
            }
        });

        if (!found && that.defaultHandler)
            that.defaultHandler.call(this, from, message);
    });
};


JiraBot.prototype.initXmpp = function(xmppOptions) {
    this.xmpp = require('simple-xmpp');

    this.xmpp.on('online', function() {
        sys.puts("I'm online.");
    });

    this.xmpp.connect(xmppOptions);
}


JiraBot.prototype.login = function (user, pass, callback) {
    var that = this;
    this.postJson('auth/latest/session', { username: user, password: pass }).on('complete', function (data) {
        if (!data.session) {
            return callback(new Error('Login failed'));
        }

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


JiraBot.prototype.getIssue = function (key) {
    return this.get('api/latest/issue/' + key);
};


JiraBot.prototype.addHandler = function(regexp, callback) {
    if (typeof regexp == 'function') {
        this.defaultHandler = regexp;
        return;
    }

    this.handlers.push({ regexp: regexp, callback: callback });
};


module.exports = JiraBot;
