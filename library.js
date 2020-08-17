"use strict";

var customFields = {
        first_name : "",
        last_name : "",
        entity : "",
        country : ""
    },
    customData = [],
    user = require.main.require("./src/user"),
    db = require.main.require("./src/database"),
    async = require.main.require('async'),
    winston = require.main.require('winston'),
    batch = require.main.require('./src/batch'),
    plugins = require.main.require('./src/plugins'),
    plugin = {};

var createObjectKey = function (uid) {
    return 'user:' + uid + ':ns:custom_fields';
};

plugin.init = function(params, callback) {

	var app = params.router,
		middleware = params.middleware;

	app.get('/admin/itu-custom-registration-fields', middleware.admin.buildHeader, renderAdmin);
	app.get('/api/admin/itu-custom-registration-fields', renderAdmin);


    app.get('/generateFullCSV', [params.middleware.requireUser, params.middleware.applyCSRF], async function (req, res, next) {
        var referer = req.headers.referer;

        if (!referer || !referer.replace(nconf.get('url'), '').startsWith('/admin/')) {
            return res.status(403).send('[[error:invalid-origin]]');
        }

        const data = await plugin.getUsersCSV();
        res.attachment('users.csv');
        res.setHeader('Content-Type', 'text/csv');
        res.end(data);
    });

	callback();
};

plugin.addAdminNavigation = function(header, callback) {
	header.plugins.push({
		route: '/itu-custom-registration-fields',
		icon: 'fa-tint',
		name: 'ITU Custom Registration Fields'
	});

	callback(null, header);
};

plugin.customHeaders = function(headers, callback) {
    for(var key in customFields) {

        switch(key) {
            case 'first_name':
                var label = "First Name";
                break;

            case 'last_name':
                var label = "Last Name";
                break;

            case 'entity':
                var label = "Entity/Organization";
                break;

            case 'country':
                var label = "Country";
                break;
        }

        headers.headers.push({
            label: label
        });
    }

    callback(null, headers);
};

plugin.customFields = function(params, callback) {
    var users = params.users.map(function(user) {

        if (!user.customRows) {
            user.customRows = [];

            for(var key in customFields) {
                user.customRows.push({value: customFields[key]});
            }
        }

        return user;
    });

    callback(null, {users: users});
};

plugin.csvFields = function(params, callback) {

    callback(null, {fields: ['uid', 'email', 'username', 'first_name', 'last_name', 'entity', 'country', '']});
};

plugin.whitelistFields = function(params, callback) {
    for(var key in customFields) {
        params.whitelist.push(key);
    }
    return setImmediate(callback, null, params);
};

plugin.getUsers = function(users, callback) {
    console.log('getUsers called');
    async.map(users, plugin.addCustomFields , function(err, users1) {
        callback(null, users1);
    });
};

plugin.addField = function(params, callback) {
    for(var key in customFields) {

        if (key == "") {
            callback(null, params);
            return;
        }

        switch(key) {
            case 'first_name':
                var html = '<input class="form-control" type="text" name="first_name" id="first_name" placeholder="First Name"><span class="custom-feedback" id="first_name-notify"></span>';
                var label = "First Name";
                break;

            case 'last_name':
                var html = '<input class="form-control" type="text" name="last_name" id="last_name" placeholder="Last Name"><span class="custom-feedback" id="last_name-notify"></span>';
                var label = "Last Name";
                break;

            case 'entity':
                var html = '<input class="form-control" type="text" name="entity" id="entity" placeholder="Entity/Organization"><span class="custom-feedback" id="entity-notify"></span>';
                var label = "Entity/Organization";
                break;

            case 'country':
                var html = '<input class="form-control" type="text" name="country" id="country" placeholder="Country"><span class="custom-feedback" id="country-notify"></span>';
                var label = "Country";
                break;

        }

        var captcha = {
            label: label,
            html: html
        };

        if (params.templateData.regFormEntry && Array.isArray(params.templateData.regFormEntry)) {
            params.templateData.regFormEntry.push(captcha);
        } else {
            params.templateData.captcha = captcha;
        }
    }

    callback(null, params);
};

plugin.checkField = function(params, callback) {
    var userData = params.userData;
    var error = null;

    for(var key in customFields) {

        var value = userData[key];

        if (value == "" || value == undefined) {
            error = {message: 'Please complete all fields before registering.'};
        }
    }

    callback(error, params);
};

plugin.creatingUser = function(params, callback) {
    customData = params.data.customRows;

    callback(null, params);
};

plugin.createdUser = function(params) {
    var addCustomData = {
        first_name : customData[0].value,
        last_name : customData[1].value,
        entity : customData[2].value,
        country : customData[3].value
    };

    var keyID = 'user:' + params.user.uid + ':ns:custom_fields';

    db.setObject(keyID, addCustomData, function(err) {
        if (err) {
            return callback(err);
        }
    });
};

plugin.addToApprovalQueue = function(params, callback) {
    var data = params.data;
    var userData = params.userData;

    data.customRows = [];

    for (var key in customFields) {

        switch(key) {
            case 'first_name':
                var fieldData = params.userData['first_name'];
                break;

            case 'last_name':
                var fieldData = params.userData['last_name'];
                break;

            case 'entity':
                var fieldData = params.userData['entity'];
                break;

            case 'specialty':
                var country = params.userData['country'];
                break;
        }

        customFields[key] = fieldData;
        data.customRows.push({value: customFields[key]});
    }

    callback(null, {data: data, userData: userData});
};

plugin.getUsersCSV = async function () {

    const data = await plugins.fireHook('filter:user.csvFields', { fields: ['uid', 'email', 'username'] });
    let csvContent = data.fields.join(',') + '\n';
    await batch.processSortedSet('users:joindate', async (uids) => {
        const usersData = await user.getUsersFields(uids, data.fields);
        console.log(usersData);
        csvContent += usersData.reduce((memo, user) => {
            memo += user.email + ',' + user.username + ',' + user.uid + ',' + user.first_name + ',' + user.last_name + ',' + user.entity +',' + user.country + '\n';
            return memo;
        }, '');
    }, {});

    return csvContent;
};

plugin.getClientFields = function (uid, done) {
    db.getObject(createObjectKey(uid), done);
};

plugin.getFields = function (done) {
    async.waterfall([
        function (next) {
            //key, start, stop, callback
            db.getSortedSetRange('ns:custom_fields', 0, -1, next);
        },
        function (ids, next) {
            if (!ids.length) {
                return next(null, ids);
            }
            db.getObjects(ids.map(function (id) {
                return 'ns:custom_fields' + ':' + id;
            }), next);
        }
    ], done);
};

plugin.getCustomFields = function (uid, callback) {
    async.parallel({
        fields: async.apply(plugin.getFields),
        data  : async.apply(plugin.getClientFields, uid)
    }, function (error, result) {
        if (error) {
            return callback(error);
        }

        var customFields1 = {};

        if (result.data) {
            //Reduce to only populated fields
            var i = 0, len = result.fields.length, fieldMeta;
            for (i; i < len; ++i) {
                fieldMeta = result.fields[i];
                var value = result.data[fieldMeta.key];
                if (value) {
                    customFields1[fieldMeta.key] = value;
                }
            }
        }

        callback(null, customFields1);
    });
};

plugin.addCustomFields = function (user, callback) {
    var uid = user.uid;
    async.parallel({
        fields: async.apply(plugin.getFields),
        data  : async.apply(plugin.getClientFields, uid)
    }, function (error, result) {
        if (error) {
            return callback(error);
        }

        if (result.data) {
            //Reduce to only populated fields
            var i = 0, len = result.fields.length, fieldMeta;
            for (i; i < len; ++i) {
                fieldMeta = result.fields[i];
                var value = result.data[fieldMeta.key];
                if (value) {
                    user[fieldMeta.key] = value;
                }
            }
        }

        callback(null, user);
    });
};

function renderAdmin(req, res, next) {
	res.render('admin/itu-custom-registration-fields', {fields: customFields});
}

module.exports = plugin;
