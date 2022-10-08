import levelup from 'levelup';
import leveldown from 'leveldown';
import { error } from '@sveltejs/kit';

export var profile = levelup(leveldown('./profile'));

export async function do_post_internal(req, data, username, db, title, merge, make, finalize) {
  return await db.get(username).catch((err) => {
    if (!(err instanceof levelup.errors.NotFoundError)) {
      console.log(title + '.get', err, typeof err);
      return new Response(JSON.stringify({err: err}));
    }
  }).then(async (value) => {
    var result = '';  // request nothing.
    if (value != undefined) {
      value = JSON.parse(value);
      if (value == undefined) {
        console.log('bad json');
      }
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
        await db.put(username, string_value).catch((err) => {
          if (err) console.log(title + '.put', err);
          return new Response(JSON.stringify({err: err}));
        });
      }
      if (value != undefined && result.updated == value.updated) {
        result = '';  // we have nothing to add, send nothing
      }
    }
    if (finalize != undefined) result = finalize(result);
    return new Response(JSON.stringify({value: result}));
  });
}

export async function do_post(req, db, title, merge, make, finalize) {
  let data = await req.request.json();
  let username = data.username;
  let password = data.password;
  if (username == undefined || !username || typeof username.valueOf() !== 'string') {
    console.log('bad username');
    return new Response(JSON.stringify({err: 'bad username'}));
  }
  if (password == undefined || !password || typeof password.valueOf() !== 'string') {
    console.log('bad password');
    return new Response(JSON.stringify({err: 'bad password'}));
  }
  return await profile.get(username).catch((err) => {
    console.log('profile missing');
    return new Response(JSON.stringify({err: 'profile missing'}));
  }).then(async (value) => {
    if (!value) {
      console.log('profile missing');
      return new Response(JSON.stringify({err: 'profile missing'}));
    }
    let p = JSON.parse(value);
    if (p == undefined) {
      console.log('bad profile');
      return new Response(JSON.stringify({err: 'bad profile'}));
    }
    if (p.username != username || p.password != password) {
      console.log('incorrect password');
      return new Response(JSON.stringify({err: 'incorrect password'}));
    }
    return await do_post_internal(req, data, username, db, title, merge, make, finalize);
  });
}
