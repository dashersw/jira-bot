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
    jiraBotOpts = {};

jiraBotOpts.constructorFn = function (opts) {
    this.baseURL = opts.jira.host + '/rest/';
    this.defaults.username = opts.jira.username;
    this.defaults.password = opts.jira.password;
};

jiraBotOpts.defaults = {};


jiraBotOpts.createBot = function (username, password) {
    return new JiraBot(username, password);
};


var JiraBot = rest.service(jiraBotOpts.constructorFn, jiraBotOpts.defaults);


JiraBot.prototype.login = function (user, pass, callback) {
    var that = this;
    this.post('auth/latest/session', { data: JSON.stringify({ username:user, password:pass })}).on('complete', function (data) {
        if (!data.session) {
            return callback(new Error('Login failed'));
        }

        that.defaults.headers['Cookie'] = data.session.name + '=' + data.session.value;
        callback(null, data);
    });
};


JiraBot.prototype.logout = function () {
    return this.del('auth/latest/session');
}


JiraBot.prototype.createIssue = function (type, project, summary) {
    return this.post('api/latest/issue', {
        data:{
            fields:{
                project:{
                    key:project
                },
                summary:summary,
                issuetype:{
                    name:type
                }
            }
        }
    });
};


JiraBot.prototype.getIssue = function (key) {
    return this.get('api/latest/issue/' + key);
};


module.exports = JiraBot;