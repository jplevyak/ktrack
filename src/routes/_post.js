var levelup = require('levelup');
var leveldown = require('leveldown')

export var profile = levelup(leveldown('./profile'));

export async function do_post_internal(req, res, username, db, title, merge, make, finalize) {
  let data = req.body;
  var result = '';  // request nothing.
  db.get(username, function(err, value) {
    if (value != undefined) {
      value = JSON.parse(value);
      if (value == undefined) {
        console.log('bad json');
      }
    }
    if (err && !(err instanceof levelup.errors.NotFoundError)) {
      console.log(title + '.get', err, typeof err);
    } else {
      err = undefined;
    }
    if (data.value == undefined) {  // nothing sent and/or status request
      if (value == undefined) {
        result = make();  // request all
        delete result.updated;
      } else if (data.updated != value.updated) {
        result = value;  // send what we have
      } else {
        result = '';  // we are up to date, do nothing
      }
    } else if (data.value != undefined) {  // update sent
      if (value != undefined)
        result = merge(value, data.value);
      else
        result = data.value;
      // store if we have nothing or if it is different
      if (value == undefined || result.updated != value.updated) {
        let string_value = JSON.stringify(result);
        db.put(username, string_value, function(err) {
          if (err) console.log(title + '.put', err);
        });
      }
      if (value != undefined && result.updated == value.updated) {
        result = '';  // we have nothing to add, send nothing
      }
    }
    res.setHeader('Content-Type', 'application/json');
    if (err) {
      console.log('post err ', err);
      res.end(JSON.stringify({err: err}));
    } else {
      if (finalize != undefined) result = finalize(result);
      res.end(JSON.stringify({value: result}));
    }
  });
}

export async function do_post(req, res, db, title, merge, make, finalize) {
  let data = req.body;
  let username = data.username;
  let password = data.password;
  if (username == undefined || !username || typeof username.valueOf() !== 'string') {
    console.log('bad username');
    res.end(JSON.stringify({err: 'bad usernme'}));
    return;
  }
  if (password == undefined || !password || typeof password.valueOf() !== 'string') {
    console.log('bad password');
    res.end(JSON.stringify({err: 'bad password'}));
    return;
  }
  profile.get(username, function(err, value) {
    if (err || value == undefined) {
      console.log('profile missing');
      res.end(JSON.stringify({err: 'profile missing'}));
      return;
    }
    value = JSON.parse(value);
    if (value == undefined) {
      console.log('bad profile');
      res.end(JSON.stringify({err: 'bad profile'}));
      return;
    }
    if (value.username != username || value.password != password) {
      console.log('incorrect password');
      res.end(JSON.stringify({err: 'incorrect password'}));
      return;
    }
    return do_post_internal(req, res, username, db, title, merge, make, finalize);
  });
}
